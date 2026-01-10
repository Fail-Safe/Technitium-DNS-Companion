import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { createHash } from "crypto";
import { mkdirSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "path";
import { TECHNITIUM_NODES_TOKEN } from "./technitium.constants";
import { TechnitiumService } from "./technitium.service";
import type {
  TechnitiumCombinedQueryLogEntry,
  TechnitiumCombinedQueryLogPage,
  TechnitiumNodeConfig,
  TechnitiumQueryLogEntry,
  TechnitiumQueryLogFilters,
  TechnitiumQueryLogPage,
} from "./technitium.types";

export interface QueryLogSqliteStatus {
  enabled: boolean;
  ready: boolean;
  retentionHours: number;
  pollIntervalMs: number;
  responseCache?: {
    enabled: boolean;
    ttlMs: number;
    maxEntries: number;
    size: number;
    hits: number;
    misses: number;
    expired: number;
    evictions: number;
    sets: number;
  };
}

type StoredLogRow = { nodeId: string; baseUrl: string; data: string };

type StoredLogRowWithClient = {
  nodeId: string;
  baseUrl: string;
  clientIpAddress: string | null;
  clientName: string | null;
  data: string;
};

@Injectable()
export class QueryLogSqliteService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueryLogSqliteService.name);

  private db: DatabaseSync | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;

  private readonly enabled = process.env.QUERY_LOG_SQLITE_ENABLED === "true";
  private readonly retentionHours = Math.max(
    1,
    Number.parseInt(process.env.QUERY_LOG_SQLITE_RETENTION_HOURS ?? "24", 10) ||
      24,
  );
  private readonly pollIntervalMs = Math.max(
    1000,
    Number.parseInt(
      process.env.QUERY_LOG_SQLITE_POLL_INTERVAL_MS ?? "10000",
      10,
    ) || 10000,
  );
  private readonly overlapSeconds = Math.max(
    0,
    Number.parseInt(process.env.QUERY_LOG_SQLITE_OVERLAP_SECONDS ?? "60", 10) ||
      60,
  );
  private readonly maxEntriesPerPoll = Math.max(
    100,
    Number.parseInt(
      process.env.QUERY_LOG_SQLITE_MAX_ENTRIES_PER_POLL ?? "20000",
      10,
    ) || 20000,
  );

  // Response caching (small TTL) for stored log endpoints.
  // These endpoints may be polled frequently (e.g. 3s auto-refresh). Even a short
  // cache reduces repeated JSON parsing + hostname enrichment overhead substantially.
  private readonly responseCacheTtlMs = Math.max(
    0,
    Number.parseInt(
      process.env.QUERY_LOG_SQLITE_RESPONSE_CACHE_TTL_MS ?? "15000",
      10,
    ) || 15000,
  );
  private readonly responseCacheMaxEntries = Math.max(
    1,
    Number.parseInt(
      process.env.QUERY_LOG_SQLITE_RESPONSE_CACHE_MAX_ENTRIES ?? "150",
      10,
    ) || 150,
  );
  private readonly responseCache = new Map<
    string,
    { expiresAt: number; value: unknown }
  >();

  private responseCacheHits = 0;
  private responseCacheMisses = 0;
  private responseCacheExpired = 0;
  private responseCacheEvictions = 0;
  private responseCacheSets = 0;

  // Track per-node cursor based on the newest timestamp we've successfully ingested.
  private readonly lastIngestedTsByNode = new Map<string, number>();

  // Expose minimal snapshot info for UI/debug.
  private readonly lastPollAtByNode = new Map<string, string>();

  constructor(
    private readonly technitiumService: TechnitiumService,
    @Inject(TECHNITIUM_NODES_TOKEN)
    private readonly nodeConfigs: TechnitiumNodeConfig[],
  ) {}

  getStatus(): QueryLogSqliteStatus {
    return {
      enabled: this.enabled,
      ready: this.getIsEnabled(),
      retentionHours: this.retentionHours,
      pollIntervalMs: this.pollIntervalMs,
      responseCache: {
        enabled: this.responseCacheTtlMs > 0,
        ttlMs: this.responseCacheTtlMs,
        maxEntries: this.responseCacheMaxEntries,
        size: this.responseCache.size,
        hits: this.responseCacheHits,
        misses: this.responseCacheMisses,
        expired: this.responseCacheExpired,
        evictions: this.responseCacheEvictions,
        sets: this.responseCacheSets,
      },
    };
  }

  getIsEnabled(): boolean {
    return this.enabled && this.db !== null;
  }

  onModuleInit(): void {
    // Avoid background tasks in tests.
    if (process.env.NODE_ENV === "test") {
      return;
    }

    if (!this.enabled) {
      this.logger.log(
        "SQLite query log storage is disabled (QUERY_LOG_SQLITE_ENABLED!=true).",
      );
      return;
    }

    if (this.nodeConfigs.length === 0) {
      this.logger.warn(
        "SQLite query log storage enabled but no nodes are configured; skipping.",
      );
      return;
    }

    const dbPath =
      (process.env.QUERY_LOG_SQLITE_PATH ?? "").trim() ||
      "/app/config/query-logs.sqlite";

    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new DatabaseSync(dbPath);

    // Concurrency-friendly settings: WAL allows concurrent readers while writing.
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA synchronous=NORMAL;");
    this.db.exec("PRAGMA temp_store=MEMORY;");

    this.initializeSchema();

    this.logger.log(
      `SQLite query log storage enabled (path=${dbPath}, retention=${this.retentionHours}h, poll=${this.pollIntervalMs}ms).`,
    );

    // Initial poll + schedule.
    void this.safePollOnce();
    this.pollTimer = setInterval(() => {
      void this.safePollOnce();
    }, this.pollIntervalMs);

    // Run retention cleanup periodically.
    const retentionIntervalMs = Math.max(60_000, this.pollIntervalMs);
    this.retentionTimer = setInterval(() => {
      this.safeApplyRetention();
    }, retentionIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }

    if (this.db) {
      try {
        this.db.close();
      } catch (error) {
        this.logger.warn("Failed to close SQLite DB", error as Error);
      }
      this.db = null;
    }
  }

  private initializeSchema(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS query_log_entries (
        nodeId TEXT NOT NULL,
        baseUrl TEXT NOT NULL,
        ts INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        qname TEXT,
        qnameLc TEXT,
        clientIpAddress TEXT,
        clientIpLc TEXT,
        clientName TEXT,
        clientNameLc TEXT,
        protocol TEXT,
        responseType TEXT,
        rcode TEXT,
        qtype TEXT,
        qclass TEXT,
        blockedRank INTEGER NOT NULL DEFAULT 0,
        aRank INTEGER NOT NULL DEFAULT 0,
        entryHash TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (nodeId, entryHash)
      );

      CREATE INDEX IF NOT EXISTS idx_query_log_ts ON query_log_entries(ts);
      CREATE INDEX IF NOT EXISTS idx_query_log_node_ts ON query_log_entries(nodeId, ts);
      CREATE INDEX IF NOT EXISTS idx_query_log_qnameLc_ts ON query_log_entries(qnameLc, ts);
      CREATE INDEX IF NOT EXISTS idx_query_log_clientIpLc_ts ON query_log_entries(clientIpLc, ts);
      CREATE INDEX IF NOT EXISTS idx_query_log_clientNameLc_ts ON query_log_entries(clientNameLc, ts);
      CREATE INDEX IF NOT EXISTS idx_query_log_responseType_ts ON query_log_entries(responseType, ts);
      CREATE INDEX IF NOT EXISTS idx_query_log_qtype_ts ON query_log_entries(qtype, ts);
    `);
  }

  private safeApplyRetention(): void {
    try {
      this.applyRetention();
    } catch (error) {
      this.logger.warn("SQLite retention cleanup failed", error as Error);
    }
  }

  private applyRetention(): void {
    if (!this.db) return;

    const cutoff = Date.now() - this.retentionHours * 60 * 60 * 1000;
    const stmt = this.db.prepare("DELETE FROM query_log_entries WHERE ts < ?");
    const result = stmt.run(cutoff);

    const maybeChanges = (result as { changes?: unknown }).changes;
    if (typeof maybeChanges === "number" && maybeChanges > 0) {
      this.logger.debug(
        `SQLite retention deleted ${maybeChanges} rows older than ${this.retentionHours}h.`,
      );
    }
  }

  private async safePollOnce(): Promise<void> {
    try {
      await this.pollOnce();
    } catch (error) {
      this.logger.warn("SQLite query log poll failed", error as Error);
    }
  }

  private async pollOnce(): Promise<void> {
    if (!this.db) return;

    const pollStartedAt = new Date().toISOString();
    const retentionWindowStart =
      Date.now() - this.retentionHours * 60 * 60 * 1000;

    const hostnamesByIpLc = new Map<string, string>();

    for (const node of this.nodeConfigs) {
      const nodeStartTs = Math.max(
        retentionWindowStart,
        (this.lastIngestedTsByNode.get(node.id) ?? retentionWindowStart) -
          this.overlapSeconds * 1000,
      );

      const filters: TechnitiumQueryLogFilters = {
        start: new Date(nodeStartTs).toISOString(),
        end: new Date().toISOString(),
        descendingOrder: true,
      };

      const { entries } =
        await this.technitiumService.fetchQueryLogEntriesForNode(
          node.id,
          filters,
          {
            totalEntriesToFetch: this.maxEntriesPerPoll,
            entriesPerPage: 100,
            authMode: "background",
          },
        );

      if (entries.length === 0) {
        this.lastPollAtByNode.set(node.id, pollStartedAt);
        continue;
      }

      // Persist best-known hostnames at ingest time so SQLite server-side
      // filtering can match hostnames historically (IP may change).
      const enrichedEntries =
        await this.technitiumService.enrichQueryLogEntriesWithHostnames(
          entries,
          { authMode: "background" },
        );

      let newestTs = this.lastIngestedTsByNode.get(node.id) ?? 0;

      // Batch insert.
      this.db.exec("BEGIN");
      try {
        const insert = this.db.prepare(
          `INSERT OR IGNORE INTO query_log_entries (
            nodeId, baseUrl, ts, timestamp,
            qname, qnameLc,
            clientIpAddress, clientIpLc,
            clientName, clientNameLc,
            protocol, responseType, rcode, qtype, qclass,
            blockedRank, aRank,
            entryHash, data
          ) VALUES (
            ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?
          )`,
        );

        for (const entry of enrichedEntries) {
          const ts = Date.parse(entry.timestamp ?? "");
          if (!Number.isFinite(ts)) {
            continue;
          }

          const qname = entry.qname ?? null;
          const qnameLc = qname ? qname.toLowerCase() : null;

          const clientIpAddress = entry.clientIpAddress ?? null;
          const clientIpLc =
            clientIpAddress ? clientIpAddress.toLowerCase() : null;

          const clientName = entry.clientName ?? null;
          const clientNameLc = clientName ? clientName.toLowerCase() : null;

          if (
            clientIpLc &&
            clientName &&
            clientName.trim().length > 0 &&
            (!clientIpAddress || clientName !== clientIpAddress)
          ) {
            hostnamesByIpLc.set(clientIpLc, clientName);
          }

          const responseType = entry.responseType ?? null;
          const isBlocked =
            responseType === "Blocked" || responseType === "BlockedEDNS";
          const blockedRank = isBlocked ? 1 : 0;

          const qtype = entry.qtype ?? null;
          const aRank = qtype === "A" ? 1 : 0;

          const entryHash = this.computeEntryHash(node.id, entry);

          insert.run(
            node.id,
            node.baseUrl,
            ts,
            entry.timestamp ?? "",
            qname,
            qnameLc,
            clientIpAddress,
            clientIpLc,
            clientName,
            clientNameLc,
            entry.protocol ?? null,
            responseType,
            entry.rcode ?? null,
            qtype,
            entry.qclass ?? null,
            blockedRank,
            aRank,
            entryHash,
            JSON.stringify(entry),
          );

          if (ts > newestTs) {
            newestTs = ts;
          }
        }

        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }

      if (newestTs > 0) {
        this.lastIngestedTsByNode.set(node.id, newestTs);
      }

      this.lastPollAtByNode.set(node.id, pollStartedAt);
    }

    this.backfillMissingClientNames(hostnamesByIpLc);

    this.safeApplyRetention();
  }

  private backfillMissingClientNames(
    hostnamesByIpLc: Map<string, string>,
  ): void {
    if (!this.db) return;
    if (hostnamesByIpLc.size === 0) return;

    // Guardrail: avoid doing too much work in a single poll cycle.
    const MAX_UPDATES_PER_POLL = 200;

    const update = this.db.prepare(
      `UPDATE query_log_entries
       SET clientName = ?, clientNameLc = ?
       WHERE clientIpLc = ?
         AND (
           clientName IS NULL OR clientName = '' OR clientName = clientIpAddress
           OR clientNameLc IS NULL OR clientNameLc = '' OR clientNameLc = clientIpLc
         )`,
    );

    let updatedIps = 0;

    for (const [ipLc, hostname] of hostnamesByIpLc.entries()) {
      if (updatedIps >= MAX_UPDATES_PER_POLL) {
        this.logger.debug(
          `Hostname backfill capped at ${MAX_UPDATES_PER_POLL} IPs per poll (skipped ${hostnamesByIpLc.size - updatedIps}).`,
        );
        break;
      }

      const name = hostname.trim();
      if (!name) continue;

      update.run(name, name.toLowerCase(), ipLc);
      updatedIps += 1;
    }
  }

  private computeEntryHash(
    nodeId: string,
    entry: TechnitiumQueryLogEntry,
  ): string {
    const key = [
      nodeId,
      entry.timestamp ?? "",
      entry.qname ?? "",
      entry.qtype ?? "",
      entry.qclass ?? "",
      entry.protocol ?? "",
      entry.clientIpAddress ?? "",
      entry.responseType ?? "",
      entry.rcode ?? "",
    ].join("|");

    return createHash("sha1").update(key).digest("hex");
  }

  private buildResponseCacheKey(
    kind: "combined" | "node",
    filters: TechnitiumQueryLogFilters,
    nodeId?: string,
  ): string {
    // Exclude disableCache from the cache key; it controls whether we use the cache at all.
    const { disableCache: _disableCache, ...rest } = filters ?? {};

    // Stable stringify by sorting keys.
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(rest).sort()) {
      normalized[key] = (rest as Record<string, unknown>)[key];
    }

    const hash = createHash("sha1")
      .update(JSON.stringify(normalized))
      .digest("hex");

    return `${kind}:${nodeId ?? "-"}:${hash}`;
  }

  private getFromResponseCache<T>(key: string): T | null {
    if (this.responseCacheTtlMs <= 0) return null;

    const entry = this.responseCache.get(key);
    if (!entry) {
      this.responseCacheMisses += 1;
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.responseCache.delete(key);
      this.responseCacheExpired += 1;
      this.responseCacheMisses += 1;
      return null;
    }

    this.responseCacheHits += 1;
    return entry.value as T;
  }

  private setResponseCache<T>(key: string, value: T): void {
    if (this.responseCacheTtlMs <= 0) return;

    this.responseCache.set(key, {
      expiresAt: Date.now() + this.responseCacheTtlMs,
      value,
    });

    this.responseCacheSets += 1;

    // Simple bound: evict oldest insertion(s) if we exceed max.
    while (this.responseCache.size > this.responseCacheMaxEntries) {
      const oldestKey = this.responseCache.keys().next().value as
        | string
        | undefined;
      if (!oldestKey) break;
      this.responseCache.delete(oldestKey);
      this.responseCacheEvictions += 1;
    }
  }

  private buildWindowBounds(filters: TechnitiumQueryLogFilters): {
    startTs: number;
    endTs: number;
  } {
    const now = Date.now();
    const retentionStart = now - this.retentionHours * 60 * 60 * 1000;

    const startTs = filters.start ? Date.parse(filters.start) : retentionStart;
    const endTs = filters.end ? Date.parse(filters.end) : now;

    return {
      startTs:
        Number.isFinite(startTs) ?
          Math.max(retentionStart, startTs)
        : retentionStart,
      endTs: Number.isFinite(endTs) ? endTs : now,
    };
  }

  private buildWhereClause(
    filters: TechnitiumQueryLogFilters,
    window: { startTs: number; endTs: number },
    nodeId?: string,
  ): { whereSql: string; params: Array<string | number> } {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (nodeId) {
      clauses.push("nodeId = ?");
      params.push(nodeId);
    }

    clauses.push("ts >= ?");
    params.push(window.startTs);

    clauses.push("ts <= ?");
    params.push(window.endTs);

    const qname = filters.qname?.trim();
    if (qname) {
      clauses.push("qnameLc LIKE ?");
      params.push(`%${qname.toLowerCase()}%`);
    }

    const client = filters.clientIpAddress?.trim();
    if (client) {
      // Match either client IP or hostname.
      clauses.push("(clientIpLc LIKE ? OR clientNameLc LIKE ?)");
      const needle = `%${client.toLowerCase()}%`;
      params.push(needle, needle);
    }

    if (filters.protocol) {
      clauses.push("protocol = ?");
      params.push(filters.protocol);
    }

    if (filters.responseType) {
      clauses.push("responseType = ?");
      params.push(filters.responseType);
    }

    if (filters.rcode) {
      clauses.push("rcode = ?");
      params.push(filters.rcode);
    }

    if (filters.qtype) {
      clauses.push("qtype = ?");
      params.push(filters.qtype);
    }

    if (filters.qclass) {
      clauses.push("qclass = ?");
      params.push(filters.qclass);
    }

    const statusFilter = filters.statusFilter;
    if (statusFilter === "blocked") {
      clauses.push("blockedRank = 1");
    } else if (statusFilter === "allowed") {
      clauses.push("blockedRank = 0");
    }

    return {
      whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      params,
    };
  }

  private parseRowsToEntries(
    rows: Array<StoredLogRow | StoredLogRowWithClient>,
  ): TechnitiumCombinedQueryLogEntry[] {
    const entries: TechnitiumCombinedQueryLogEntry[] = [];

    const isRecord = (value: unknown): value is Record<string, unknown> => {
      return typeof value === "object" && value !== null;
    };

    for (const row of rows) {
      try {
        const parsedUnknown: unknown = JSON.parse(row.data);
        if (!isRecord(parsedUnknown)) continue;

        // If a row has been backfilled with a hostname (clientName column),
        // reflect it in the returned entry even if the JSON blob is older.
        const clientNameFromRow =
          (row as Partial<StoredLogRowWithClient>).clientName ?? null;
        const clientIpFromRow =
          (row as Partial<StoredLogRowWithClient>).clientIpAddress ?? null;

        const parsedName = parsedUnknown["clientName"];
        const parsedIp = parsedUnknown["clientIpAddress"];

        const parsedNameStr =
          typeof parsedName === "string" ? parsedName.trim() : "";
        const parsedIpStr = typeof parsedIp === "string" ? parsedIp.trim() : "";

        const merged: Record<string, unknown> = {
          ...parsedUnknown,
          nodeId: row.nodeId,
          baseUrl: row.baseUrl,
        };

        if (
          clientNameFromRow &&
          (!parsedNameStr ||
            (parsedIpStr && parsedNameStr === parsedIpStr) ||
            (clientIpFromRow && parsedNameStr === clientIpFromRow))
        ) {
          merged["clientName"] = clientNameFromRow;
        }

        entries.push(merged as unknown as TechnitiumCombinedQueryLogEntry);
      } catch {
        // ignore corrupt row
      }
    }

    return entries;
  }

  async getStoredCombinedLogs(
    filters: TechnitiumQueryLogFilters = {},
  ): Promise<TechnitiumCombinedQueryLogPage> {
    if (!this.db) {
      throw new Error("SQLite query log storage is not enabled.");
    }

    const db = this.db;

    const disableCache = !!filters.disableCache;
    const cacheKey =
      !disableCache ?
        this.buildResponseCacheKey("combined", filters)
      : undefined;

    if (cacheKey) {
      const cached =
        this.getFromResponseCache<TechnitiumCombinedQueryLogPage>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const pageNumber = Math.max(filters.pageNumber ?? 1, 1);
    const entriesPerPage = filters.entriesPerPage ?? 50;
    const descendingOrder = filters.descendingOrder ?? true;

    const window = this.buildWindowBounds(filters);

    // Total entries in the window (ignores other filters).
    const windowWhere = this.buildWhereClause({}, window);
    const totalEntriesRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM query_log_entries ${windowWhere.whereSql}`,
      )
      .get(...windowWhere.params) as { count: number };
    const totalEntries = totalEntriesRow?.count ?? 0;

    const base = this.buildWhereClause(filters, window);

    const deduplicateDomains = !!filters.deduplicateDomains;

    let totalMatchingEntries = 0;
    let duplicatesRemoved: number | undefined;

    if (!deduplicateDomains) {
      const countRow = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM query_log_entries ${base.whereSql}`,
        )
        .get(...base.params) as { count: number };
      totalMatchingEntries = countRow?.count ?? 0;
    } else {
      // Count of unique domains in the filtered set (ignoring NULL qname).
      const countRow = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM (
            SELECT qnameLc
            FROM query_log_entries
            ${base.whereSql}
            AND qnameLc IS NOT NULL
            GROUP BY qnameLc
          )`,
        )
        .get(...base.params) as { count: number };
      totalMatchingEntries = countRow?.count ?? 0;

      const preDedupCountRow = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM query_log_entries ${base.whereSql}`,
        )
        .get(...base.params) as { count: number };
      const preDedupCount = preDedupCountRow?.count ?? 0;
      duplicatesRemoved =
        Math.max(0, preDedupCount - totalMatchingEntries) || undefined;
    }

    const totalPages =
      entriesPerPage > 0 ?
        Math.max(1, Math.ceil(totalMatchingEntries / entriesPerPage))
      : 1;
    const offset = entriesPerPage > 0 ? (pageNumber - 1) * entriesPerPage : 0;

    const sortDir = descendingOrder ? "DESC" : "ASC";

    let rows: StoredLogRowWithClient[] = [];

    if (!deduplicateDomains) {
      rows = this.db
        .prepare(
          `SELECT nodeId, baseUrl, clientIpAddress, clientName, data
           FROM query_log_entries
           ${base.whereSql}
           ORDER BY ts ${sortDir}
           LIMIT ? OFFSET ?`,
        )
        .all(
          ...base.params,
          entriesPerPage,
          offset,
        ) as StoredLogRowWithClient[];
    } else {
      // Deduplicate by domain using a rank that approximates existing behavior:
      // 1) blocked over allowed, 2) A over non-A, 3) newest timestamp.
      rows = this.db
        .prepare(
          `WITH ranked AS (
            SELECT nodeId, baseUrl, clientIpAddress, clientName, data, ts,
              ROW_NUMBER() OVER (
                PARTITION BY qnameLc
                ORDER BY blockedRank DESC, aRank DESC, ts DESC
              ) AS rn
            FROM query_log_entries
            ${base.whereSql}
            AND qnameLc IS NOT NULL
          )
          SELECT nodeId, baseUrl, clientIpAddress, clientName, data
          FROM ranked
          WHERE rn = 1
          ORDER BY ts ${sortDir}
          LIMIT ? OFFSET ?`,
        )
        .all(
          ...base.params,
          entriesPerPage,
          offset,
        ) as StoredLogRowWithClient[];
    }

    const entries = this.parseRowsToEntries(rows);
    const enriched =
      await this.technitiumService.enrichQueryLogEntriesWithHostnames(entries);

    const nodeSnapshots = this.nodeConfigs.map((node) => {
      const nodeWindowWhere = this.buildWhereClause({}, window, node.id);
      const nodeTotalEntriesRow = db
        .prepare(
          `SELECT COUNT(*) AS count FROM query_log_entries ${nodeWindowWhere.whereSql}`,
        )
        .get(...nodeWindowWhere.params) as { count: number };
      const nodeTotalEntries = nodeTotalEntriesRow?.count ?? 0;

      const nodeTotalPages =
        entriesPerPage > 0 ?
          nodeTotalEntries > 0 ?
            Math.ceil(nodeTotalEntries / entriesPerPage)
          : 0
        : 0;

      return {
        nodeId: node.id,
        baseUrl: node.baseUrl,
        fetchedAt:
          this.lastPollAtByNode.get(node.id) ?? new Date().toISOString(),
        totalEntries: nodeTotalEntries,
        totalPages: nodeTotalPages,
        durationMs: undefined,
        error: undefined,
      };
    });

    const result: TechnitiumCombinedQueryLogPage = {
      fetchedAt: new Date().toISOString(),
      pageNumber,
      entriesPerPage,
      totalPages,
      totalMatchingEntries,
      hasMorePages: false,
      duplicatesRemoved,
      totalEntries,
      descendingOrder,
      entries: enriched,
      nodes: nodeSnapshots,
    };

    if (cacheKey) {
      this.setResponseCache(cacheKey, result);
    }

    return result;
  }

  async getStoredNodeLogs(
    nodeId: string,
    filters: TechnitiumQueryLogFilters = {},
  ): Promise<TechnitiumStatusEnvelopeForStoredNodeLogs> {
    if (!this.db) {
      throw new Error("SQLite query log storage is not enabled.");
    }

    const disableCache = !!filters.disableCache;
    const cacheKey =
      !disableCache ?
        this.buildResponseCacheKey("node", filters, nodeId)
      : undefined;

    if (cacheKey) {
      const cached =
        this.getFromResponseCache<TechnitiumStatusEnvelopeForStoredNodeLogs>(
          cacheKey,
        );
      if (cached) {
        return cached;
      }
    }

    const pageNumber = Math.max(filters.pageNumber ?? 1, 1);
    const entriesPerPage = filters.entriesPerPage ?? 50;
    const descendingOrder = filters.descendingOrder ?? true;

    const window = this.buildWindowBounds(filters);

    // Total entries in window for this node.
    const windowWhere = this.buildWhereClause({}, window, nodeId);
    const totalEntriesRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM query_log_entries ${windowWhere.whereSql}`,
      )
      .get(...windowWhere.params) as { count: number };
    const totalEntries = totalEntriesRow?.count ?? 0;

    const base = this.buildWhereClause(filters, window, nodeId);

    const deduplicateDomains = !!filters.deduplicateDomains;

    let totalMatchingEntries = 0;
    let duplicatesRemoved: number | undefined;

    if (!deduplicateDomains) {
      const countRow = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM query_log_entries ${base.whereSql}`,
        )
        .get(...base.params) as { count: number };
      totalMatchingEntries = countRow?.count ?? 0;
    } else {
      const countRow = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM (
            SELECT qnameLc
            FROM query_log_entries
            ${base.whereSql}
            AND qnameLc IS NOT NULL
            GROUP BY qnameLc
          )`,
        )
        .get(...base.params) as { count: number };
      totalMatchingEntries = countRow?.count ?? 0;

      const preDedupCountRow = this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM query_log_entries ${base.whereSql}`,
        )
        .get(...base.params) as { count: number };
      const preDedupCount = preDedupCountRow?.count ?? 0;
      duplicatesRemoved =
        Math.max(0, preDedupCount - totalMatchingEntries) || undefined;
    }

    const totalPages =
      entriesPerPage > 0 ?
        Math.max(1, Math.ceil(totalMatchingEntries / entriesPerPage))
      : 1;
    const offset = entriesPerPage > 0 ? (pageNumber - 1) * entriesPerPage : 0;

    const sortDir = descendingOrder ? "DESC" : "ASC";

    let rows: StoredLogRowWithClient[] = [];

    if (!deduplicateDomains) {
      rows = this.db
        .prepare(
          `SELECT nodeId, baseUrl, clientIpAddress, clientName, data
           FROM query_log_entries
           ${base.whereSql}
           ORDER BY ts ${sortDir}
           LIMIT ? OFFSET ?`,
        )
        .all(
          ...base.params,
          entriesPerPage,
          offset,
        ) as StoredLogRowWithClient[];
    } else {
      rows = this.db
        .prepare(
          `WITH ranked AS (
            SELECT nodeId, baseUrl, clientIpAddress, clientName, data, ts,
              ROW_NUMBER() OVER (
                PARTITION BY qnameLc
                ORDER BY blockedRank DESC, aRank DESC, ts DESC
              ) AS rn
            FROM query_log_entries
            ${base.whereSql}
            AND qnameLc IS NOT NULL
          )
          SELECT nodeId, baseUrl, clientIpAddress, clientName, data
          FROM ranked
          WHERE rn = 1
          ORDER BY ts ${sortDir}
          LIMIT ? OFFSET ?`,
        )
        .all(
          ...base.params,
          entriesPerPage,
          offset,
        ) as StoredLogRowWithClient[];
    }

    const entries = this.parseRowsToEntries(rows);
    const enriched =
      await this.technitiumService.enrichQueryLogEntriesWithHostnames(entries);

    const data: TechnitiumQueryLogPage = {
      pageNumber,
      totalPages,
      totalEntries,
      totalMatchingEntries,
      hasMorePages: false,
      entries: enriched,
    };

    const result: TechnitiumStatusEnvelopeForStoredNodeLogs = {
      nodeId,
      fetchedAt: new Date().toISOString(),
      data,
      duplicatesRemoved,
    };

    if (cacheKey) {
      this.setResponseCache(cacheKey, result);
    }

    return result;
  }
}

// Narrow envelope shape for stored per-node logs (keeps frontend compatibility).
export interface TechnitiumStatusEnvelopeForStoredNodeLogs {
  nodeId: string;
  fetchedAt: string;
  data: TechnitiumQueryLogPage;
  duplicatesRemoved?: number;
}
