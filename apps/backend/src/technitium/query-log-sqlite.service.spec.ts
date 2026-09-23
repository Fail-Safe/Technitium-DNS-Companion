/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access */
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";
import { QueryLogSqliteService } from "./query-log-sqlite.service";

// ── SQLite maintenance: auto_vacuum migration + nightly incremental vacuum ──
// The query-logs DB never reclaimed pages from retention prunes, so a 1.5 GB
// file could be ~99% dead pages. These tests pin the migration switching the
// DB to auto_vacuum=INCREMENTAL and the maintenance pass actually freeing
// pages back to the OS via incremental_vacuum + wal_checkpoint(TRUNCATE).

interface MaintenanceShape {
  db: DatabaseSync | null;
  logger: { warn: jest.Mock; log: jest.Mock; debug: jest.Mock };
  maybeMigrateAutoVacuum: () => void;
  optimizePlannerStats: (onOpen: boolean) => void;
  runMaintenance: () => void;
}

interface PollShape {
  logger: { warn: jest.Mock };
  pollOnce: jest.Mock<Promise<void>, []>;
  safePollOnce: () => Promise<void>;
}

interface DedupCountShape {
  db: DatabaseSync | null;
  countDeduplicatedEntries: (
    base: { whereSql: string; params: Array<string | number> },
    deduplicatePerClient: boolean,
  ) => number;
}

interface SchemaShape {
  db: DatabaseSync | null;
  initializeSchema: () => void;
}

interface HostnameBackfillShape extends SchemaShape {
  backfillMissingClientNames: (hostnames: Map<string, string>) => void;
}

interface DedupSelectShape extends SchemaShape {
  selectDeduplicatedRows: (
    base: { whereSql: string; params: Array<string | number> },
    deduplicatePerClient: boolean,
    useIndexedGrouping: boolean,
    sortDir: "ASC" | "DESC",
    entriesPerPage: number,
    offset: number,
  ) => Array<{ data: string }>;
  canUseIndexedDeduplication: (filters: Record<string, unknown>) => boolean;
}

function runSql(database: DatabaseSync, sql: string): void {
  database.prepare(sql).run();
}

function readPragmaNumber(database: DatabaseSync, pragma: string): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get() as
    | Record<string, number | undefined>
    | undefined;
  if (!row) return 0;
  // PRAGMA returns a single column; key matches the pragma name.
  const value = Object.values(row)[0];
  return typeof value === "number" ? value : 0;
}

describe("QueryLogSqliteService — SQLite maintenance", () => {
  let tmpDir: string;
  let dbPath: string;
  let db: DatabaseSync;
  let service: QueryLogSqliteService;
  let internal: MaintenanceShape;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.QUERY_LOG_SQLITE_AUTO_VACUUM_MIGRATION = "true";
    tmpDir = mkdtempSync(join(tmpdir(), "qlogs-spec-"));
    dbPath = join(tmpDir, "query-logs.sqlite");
    db = new DatabaseSync(dbPath);
    runSql(db, "PRAGMA journal_mode=WAL");
    // Schema mirroring the production table (just enough for the tests to
    // create + delete rows and observe page churn).
    runSql(db, "CREATE TABLE query_log_entries (ts INTEGER, payload TEXT)");

    service = new QueryLogSqliteService({} as never, [] as never);
    internal = service as unknown as MaintenanceShape;
    internal.db = db;
    internal.logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.QUERY_LOG_SQLITE_AUTO_VACUUM_MIGRATION;
  });

  it("migrates auto_vacuum from NONE (0) to INCREMENTAL (2) on first run", () => {
    expect(readPragmaNumber(db, "auto_vacuum")).toBe(0);

    internal.maybeMigrateAutoVacuum();

    expect(readPragmaNumber(db, "auto_vacuum")).toBe(2);
    expect(internal.logger.warn).toHaveBeenCalled();
    const messages = internal.logger.warn.mock.calls.map((c) => c[0]).join(" ");
    expect(messages).toContain(
      "Migrating query-logs SQLite to auto_vacuum=INCREMENTAL",
    );
    expect(messages).toContain("Migration complete");
  });

  it("is a no-op when auto_vacuum is already INCREMENTAL", () => {
    runSql(db, "PRAGMA auto_vacuum=INCREMENTAL");
    runSql(db, "VACUUM");
    expect(readPragmaNumber(db, "auto_vacuum")).toBe(2);

    internal.maybeMigrateAutoVacuum();

    expect(internal.logger.warn).not.toHaveBeenCalled();
  });

  it("skips migration when QUERY_LOG_SQLITE_AUTO_VACUUM_MIGRATION=false", () => {
    process.env.QUERY_LOG_SQLITE_AUTO_VACUUM_MIGRATION = "false";

    internal.maybeMigrateAutoVacuum();

    expect(readPragmaNumber(db, "auto_vacuum")).toBe(0);
    const warnMsgs = internal.logger.warn.mock.calls.map((c) => c[0]).join(" ");
    expect(warnMsgs).toContain("auto_vacuum migration disabled");
  });

  it("incremental_vacuum reclaims pages after retention-style deletes", () => {
    // Set up: migrate to INCREMENTAL, insert a bunch of rows, delete most of
    // them. Without maintenance, the page count stays high (free pages aren't
    // returned to the OS). After runMaintenance, free-page count drops.
    internal.maybeMigrateAutoVacuum();
    internal.logger.warn.mockClear();

    const insertStmt = db.prepare(
      "INSERT INTO query_log_entries (ts, payload) VALUES (?, ?)",
    );
    // 1000 rows × ~1KB each → enough churn for free pages to be observable.
    const bigPayload = "x".repeat(1024);
    for (let i = 0; i < 1000; i++) {
      insertStmt.run(i, bigPayload);
    }
    db.prepare("DELETE FROM query_log_entries WHERE ts < ?").run(900);

    const beforeFree = readPragmaNumber(db, "freelist_count");
    expect(beforeFree).toBeGreaterThan(0);

    internal.runMaintenance();

    const afterFree = readPragmaNumber(db, "freelist_count");
    expect(afterFree).toBeLessThan(beforeFree);
    const msgs = internal.logger.warn.mock.calls.map((c) => c[0]).join(" ");
    expect(msgs).toContain("SQLite maintenance complete");
    expect(msgs).toContain("WAL truncated");
  });

  it("creates planner statistics when optimizing a newly opened database", () => {
    runSql(db, "CREATE INDEX idx_query_log_ts ON query_log_entries(ts)");
    const insert = db.prepare(
      "INSERT INTO query_log_entries (ts, payload) VALUES (?, ?)",
    );
    for (let i = 0; i < 100; i++) {
      insert.run(i, `payload-${i}`);
    }

    internal.optimizePlannerStats(true);

    const statTable = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'sqlite_stat1'",
      )
      .get() as { name?: string } | undefined;
    const indexStat = db
      .prepare("SELECT stat FROM sqlite_stat1 WHERE idx = ?")
      .get("idx_query_log_ts") as { stat?: string } | undefined;
    expect(statTable?.name).toBe("sqlite_stat1");
    expect(indexStat?.stat).toBeTruthy();
  });

  it("runMaintenance is a safe no-op when the DB is closed", () => {
    internal.db = null;
    expect(() => internal.runMaintenance()).not.toThrow();
    expect(internal.logger.warn).not.toHaveBeenCalled();
  });
});

describe("QueryLogSqliteService — poll failure logging", () => {
  let service: QueryLogSqliteService;
  let internal: PollShape;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    service = new QueryLogSqliteService({} as never, [] as never);
    internal = service as unknown as PollShape;
    internal.logger = { warn: jest.fn() };
    internal.pollOnce = jest.fn(() => Promise.resolve());
  });

  it("logs SQLite busy poll failures as a single sanitized warning", async () => {
    const lockedError = Object.assign(new Error("database is locked"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 5,
      errstr: "database is locked",
    });
    internal.pollOnce.mockRejectedValueOnce(lockedError);

    await internal.safePollOnce();

    expect(internal.logger.warn).toHaveBeenCalledTimes(1);
    expect(internal.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("database is locked"),
    );
    expect(internal.logger.warn.mock.calls[0]).toHaveLength(1);
  });

  it("logs generic poll failures as a single sanitized warning", async () => {
    internal.pollOnce.mockRejectedValueOnce(new Error("boom"));

    await internal.safePollOnce();

    expect(internal.logger.warn).toHaveBeenCalledTimes(1);
    expect(internal.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("SQLite query log poll failed: Error: boom"),
    );
    expect(internal.logger.warn.mock.calls[0]).toHaveLength(1);
  });
});

describe("QueryLogSqliteService — deduplicated counts", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let internal: DedupCountShape;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    tmpDir = mkdtempSync(join(tmpdir(), "qlogs-count-spec-"));
    db = new DatabaseSync(join(tmpDir, "query-logs.sqlite"));
    runSql(
      db,
      `CREATE TABLE query_log_entries (
        ts INTEGER NOT NULL,
        qnameLc TEXT,
        groupId TEXT NOT NULL DEFAULT '__default__',
        clientIpLc TEXT
      )`,
    );
    const insert = db.prepare(
      "INSERT INTO query_log_entries (ts, qnameLc, clientIpLc) VALUES (?, ?, ?)",
    );
    insert.run(10, "one.example", "192.0.2.1");
    insert.run(11, "one.example", "192.0.2.1");
    insert.run(12, "one.example", "192.0.2.2");
    insert.run(13, "two.example", "192.0.2.1");
    insert.run(14, null, "192.0.2.3");

    internal = new QueryLogSqliteService(
      {} as never,
      [] as never,
    ) as unknown as DedupCountShape;
    internal.db = db;
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("counts distinct domains without a grouped subquery", () => {
    expect(
      internal.countDeduplicatedEntries(
        { whereSql: "WHERE ts >= ? AND ts <= ?", params: [0, 100] },
        false,
      ),
    ).toBe(2);
  });

  it("preserves grouped counting for per-client deduplication", () => {
    expect(
      internal.countDeduplicatedEntries(
        { whereSql: "WHERE ts >= ? AND ts <= ?", params: [0, 100] },
        true,
      ),
    ).toBe(3);
  });

  it("keeps identical private clients in different groups distinct", () => {
    db.prepare(
      "INSERT INTO query_log_entries (ts, qnameLc, groupId, clientIpLc) VALUES (?, ?, ?, ?)",
    ).run(15, "one.example", "site-b", "192.0.2.1");
    expect(
      internal.countDeduplicatedEntries(
        { whereSql: "WHERE ts >= ? AND ts <= ?", params: [0, 100] },
        true,
      ),
    ).toBe(4);
  });
});

describe("QueryLogSqliteService — query indexes", () => {
  let tmpDir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    tmpDir = mkdtempSync(join(tmpdir(), "qlogs-index-spec-"));
    db = new DatabaseSync(join(tmpDir, "query-logs.sqlite"));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a covering status-and-time index for existing databases", () => {
    const internal = new QueryLogSqliteService(
      {} as never,
      [] as never,
    ) as unknown as SchemaShape;
    internal.db = db;

    internal.initializeSchema();

    const index = db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'index' AND name = ?",
      )
      .get("idx_query_log_blockedRank_ts") as { name?: string } | undefined;
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT COUNT(*) FROM query_log_entries
         WHERE blockedRank = ? AND ts >= ? AND ts <= ?`,
      )
      .all(1, 0, 100) as Array<{ detail?: string }>;

    expect(index?.name).toBe("idx_query_log_blockedRank_ts");
    expect(plan.some((row) => row.detail?.includes(index.name ?? ""))).toBe(
      true,
    );
  });

  it("creates one priority index that supports both deduplication keys", () => {
    const internal = new QueryLogSqliteService(
      {} as never,
      [] as never,
    ) as unknown as SchemaShape;
    internal.db = db;

    internal.initializeSchema();

    const columns = db
      .prepare("PRAGMA index_xinfo('idx_query_log_dedup_rank')")
      .all() as Array<{ name?: string; desc?: number; key?: number }>;
    expect(
      columns
        .filter((column) => column.key === 1)
        .map((column) => [column.name, column.desc]),
    ).toEqual([
      ["qnameLc", 0],
      ["groupId", 0],
      ["clientIpLc", 0],
      ["blockedRank", 1],
      ["aRank", 1],
      ["ts", 1],
    ]);
  });

  it("migrates and synchronizes group IDs for existing databases", () => {
    runSql(
      db,
      `CREATE TABLE query_log_entries (
        nodeId TEXT NOT NULL, baseUrl TEXT NOT NULL, ts INTEGER NOT NULL,
        timestamp TEXT NOT NULL, qname TEXT, qnameLc TEXT,
        clientIpAddress TEXT, clientIpLc TEXT, clientName TEXT,
        clientNameLc TEXT, protocol TEXT, responseType TEXT, rcode TEXT,
        qtype TEXT, qclass TEXT,
        blockedRank INTEGER NOT NULL DEFAULT 0, aRank INTEGER NOT NULL DEFAULT 0,
        entryHash TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (nodeId, entryHash)
      )`,
    );
    db.prepare(
      "INSERT INTO query_log_entries (nodeId, baseUrl, ts, timestamp, entryHash, data) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("node-a", "https://node-a.example.test", 1, "ts", "hash", "{}");
    const internal = new QueryLogSqliteService(
      {} as never,
      [
        {
          id: "node-a",
          baseUrl: "https://node-a.example.test",
          token: "",
          groupId: "site-a",
        },
      ] as never,
    ) as unknown as SchemaShape;
    internal.db = db;
    internal.initializeSchema();

    expect(db.prepare("SELECT groupId FROM query_log_entries").get()).toEqual({
      groupId: "site-a",
    });

    const schemaVersionBefore = db.prepare("PRAGMA schema_version").get() as {
      schema_version: number;
    };
    internal.initializeSchema();
    const schemaVersionAfter = db.prepare("PRAGMA schema_version").get() as {
      schema_version: number;
    };
    expect(schemaVersionAfter.schema_version).toBe(
      schemaVersionBefore.schema_version,
    );
  });
});

describe("QueryLogSqliteService — deduplicated row selection", () => {
  let tmpDir: string;
  let db: DatabaseSync;
  let internal: DedupSelectShape;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    tmpDir = mkdtempSync(join(tmpdir(), "qlogs-dedup-spec-"));
    db = new DatabaseSync(join(tmpDir, "query-logs.sqlite"));
    internal = new QueryLogSqliteService(
      {} as never,
      [] as never,
    ) as unknown as DedupSelectShape;
    internal.db = db;
    internal.initializeSchema();

    const insert = db.prepare(
      `INSERT INTO query_log_entries (
        nodeId, baseUrl, ts, timestamp,
        qnameLc, clientIpLc,
        blockedRank, aRank,
        entryHash, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const add = (
      ts: number,
      qnameLc: string,
      clientIpLc: string,
      blockedRank: number,
      aRank: number,
      data: string,
    ) => {
      insert.run(
        "node-a",
        "https://node-a.example.test",
        ts,
        new Date(ts).toISOString(),
        qnameLc,
        clientIpLc,
        blockedRank,
        aRank,
        `${qnameLc}-${clientIpLc}-${ts}`,
        data,
      );
    };

    add(40, "one.example", "192.0.2.1", 0, 0, "newest-allowed");
    add(30, "one.example", "192.0.2.1", 0, 1, "allowed-a");
    add(20, "one.example", "192.0.2.1", 1, 0, "blocked-other");
    add(10, "one.example", "192.0.2.1", 1, 1, "blocked-a");
    add(50, "one.example", "192.0.2.2", 0, 0, "second-client");
    add(60, "two.example", "192.0.2.1", 0, 0, "second-domain");
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const base = { whereSql: "WHERE ts >= ? AND ts <= ?", params: [0, 100] };

  it("preserves blocked, A-record, then timestamp priority by domain", () => {
    const rows = internal.selectDeduplicatedRows(
      base,
      false,
      true,
      "DESC",
      50,
      0,
    );

    expect(rows.map((row) => row.data)).toEqual(["second-domain", "blocked-a"]);
  });

  it("uses the same priority independently for each domain-and-client pair", () => {
    const rows = internal.selectDeduplicatedRows(
      base,
      true,
      true,
      "DESC",
      50,
      0,
    );

    expect(rows.map((row) => row.data)).toEqual([
      "second-domain",
      "second-client",
      "blocked-a",
    ]);
  });

  it("preserves ascending order and offset pagination", () => {
    const rows = internal.selectDeduplicatedRows(base, true, true, "ASC", 1, 1);

    expect(rows.map((row) => row.data)).toEqual(["second-client"]);
  });

  it("keeps filtered deduplication on the filter-aware window path", () => {
    expect(
      internal.canUseIndexedDeduplication({
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-01-02T00:00:00.000Z",
        pageNumber: 2,
      }),
    ).toBe(true);
    expect(internal.canUseIndexedDeduplication({ qname: "example" })).toBe(
      false,
    );
    expect(internal.canUseIndexedDeduplication({ qtype: "AAAA" })).toBe(false);
    expect(
      internal.canUseIndexedDeduplication({ statusFilter: "blocked" }),
    ).toBe(false);

    const rows = internal.selectDeduplicatedRows(
      base,
      false,
      false,
      "DESC",
      50,
      0,
    );
    expect(rows.map((row) => row.data)).toEqual(["second-domain", "blocked-a"]);
  });
});

// ── buildWhereClause — LIKE vs FTS5 routing based on dedup flag ──────────
// Pins the Tier-2 conditional routing. When dedup is on and FTS is enabled,
// substring filters go through `rowid IN (SELECT rowid FROM query_log_fts
// WHERE … MATCH ?)`. When dedup is off, they stay on unsargable-but-fast-
// with-LIMIT `LIKE '%x%'`. Neither path is universally faster — the
// bench shows FTS wins for dedup-combined queries and LIKE wins for
// popular-substring queries with LIMIT short-circuit.

describe("QueryLogSqliteService — buildWhereClause FTS5 routing", () => {
  interface BuildShape {
    ftsEnabled: boolean;
    buildWhereClause: (
      filters: Record<string, unknown>,
      window: { startTs: number; endTs: number },
      nodeId?: string,
    ) => { whereSql: string; params: Array<string | number> };
  }

  let service: QueryLogSqliteService;
  let internal: BuildShape;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    service = new QueryLogSqliteService({} as never, [] as never);
    internal = service as unknown as BuildShape;
  });

  const window = { startTs: 1_700_000_000_000, endTs: 1_700_100_000_000 };

  it("uses LIKE for qname when dedup is off (preserves fast LIMIT short-circuit)", () => {
    internal.ftsEnabled = true;
    const { whereSql, params } = internal.buildWhereClause(
      { qname: "youtube", deduplicateDomains: false },
      window,
    );
    expect(whereSql).toContain("qnameLc LIKE ?");
    expect(whereSql).not.toContain("query_log_fts");
    expect(params).toContain("%youtube%");
  });

  it("uses FTS5 MATCH for qname when dedup is on AND fts is enabled", () => {
    internal.ftsEnabled = true;
    const { whereSql, params } = internal.buildWhereClause(
      { qname: "youtube", deduplicateDomains: true },
      window,
    );
    expect(whereSql).toContain(
      "rowid IN (SELECT rowid FROM query_log_fts WHERE qnameLc MATCH ?)",
    );
    expect(whereSql).not.toContain("qnameLc LIKE");
    expect(params).toContain("youtube*"); // FTS5 prefix match
  });

  it("falls back to LIKE when dedup is on but fts is unavailable", () => {
    internal.ftsEnabled = false;
    const { whereSql, params } = internal.buildWhereClause(
      { qname: "youtube", deduplicateDomains: true },
      window,
    );
    expect(whereSql).toContain("qnameLc LIKE ?");
    expect(whereSql).not.toContain("query_log_fts");
    expect(params).toContain("%youtube%");
  });

  it("routes hostname-like client search through FTS only (no unsargable LIKE scan)", () => {
    internal.ftsEnabled = true;
    const { whereSql, params } = internal.buildWhereClause(
      { clientIpAddress: "flore", deduplicateDomains: true },
      window,
    );
    // Hostname-looking term: only FTS, no IP-LIKE full scan.
    expect(whereSql).toContain(
      "rowid IN (SELECT rowid FROM query_log_fts WHERE clientNameLc MATCH ?)",
    );
    expect(whereSql).not.toContain("clientIpLc LIKE");
    expect(params).toContain("flore*");
    expect(params).not.toContain("%flore%");
  });

  it("routes IP-literal client search through LIKE only (no FTS lookup)", () => {
    internal.ftsEnabled = true;
    const { whereSql, params } = internal.buildWhereClause(
      { clientIpAddress: "10.0.1", deduplicateDomains: true },
      window,
    );
    expect(whereSql).toContain("clientIpLc LIKE ?");
    expect(whereSql).not.toContain("query_log_fts");
    expect(params).toContain("%10.0.1%");
  });

  it("keeps dedup-off client search on the original LIKE OR LIKE (fast via LIMIT short-circuit)", () => {
    internal.ftsEnabled = true;
    const { whereSql, params } = internal.buildWhereClause(
      { clientIpAddress: "flore", deduplicateDomains: false },
      window,
    );
    expect(whereSql).toContain("(clientIpLc LIKE ? OR clientNameLc LIKE ?)");
    expect(whereSql).not.toContain("query_log_fts");
    expect(params.filter((p) => p === "%flore%").length).toBe(2);
  });

  it("leaves non-substring filters (qtype, rcode, etc.) untouched regardless of fts", () => {
    internal.ftsEnabled = true;
    const { whereSql } = internal.buildWhereClause(
      { qtype: "AAAA", deduplicateDomains: true },
      window,
    );
    expect(whereSql).toContain("qtype = ?");
    expect(whereSql).not.toContain("query_log_fts");
  });

  // ── FTS5 MATCH sanitizer: dotted terms + empty-after-sanitize ─────────
  // Previously `${term}*` was passed verbatim, so "google.com" became
  // `google.com*` and crashed with `fts5: syntax error near "."`. The
  // sanitizer splits on non-alphanumerics and prefix-stars the last token.

  it("sanitizes dotted qname terms into valid FTS5 MATCH syntax", () => {
    internal.ftsEnabled = true;
    const { whereSql, params } = internal.buildWhereClause(
      { qname: "google.com", deduplicateDomains: true },
      window,
    );
    expect(whereSql).toContain(
      "rowid IN (SELECT rowid FROM query_log_fts WHERE qnameLc MATCH ?)",
    );
    // "google.com" → tokens ["google", "com"] → "google com*"
    expect(params).toContain("google com*");
    // Must NOT pass the raw dotted form that crashes FTS5.
    expect(params).not.toContain("google.com*");
  });

  it("sanitizes multi-dot qname terms (www.youtube.com)", () => {
    internal.ftsEnabled = true;
    const { params } = internal.buildWhereClause(
      { qname: "www.youtube.com", deduplicateDomains: true },
      window,
    );
    expect(params).toContain("www youtube com*");
  });

  it("skips qname FTS clause entirely when term has no alphanumeric content", () => {
    internal.ftsEnabled = true;
    const { whereSql, params } = internal.buildWhereClause(
      { qname: "!!!", deduplicateDomains: true },
      window,
    );
    // Nothing to search for → no FTS clause at all (just the ts window).
    expect(whereSql).not.toContain("query_log_fts");
    expect(whereSql).not.toContain("qnameLc LIKE");
    expect(params.every((p) => typeof p !== "string" || !p.includes("*"))).toBe(
      true,
    );
  });

  it("sanitizes dotted hostname-like client terms (kid-phone)", () => {
    internal.ftsEnabled = true;
    const { params } = internal.buildWhereClause(
      { clientIpAddress: "kid-phone", deduplicateDomains: true },
      window,
    );
    // Hyphen is a non-alphanumeric separator → tokens ["kid", "phone"]
    expect(params).toContain("kid phone*");
  });

  // ── Client heuristic: no more OR-with-LIKE-scan ──────────────────────
  // Last night's 7-8s regression came from an OR between FTS and unsargable
  // LIKE on clientIpLc. These pin the single-branch behavior.

  it("routes hostname-like client search through FTS only (no IP-LIKE OR)", () => {
    internal.ftsEnabled = true;
    const { whereSql } = internal.buildWhereClause(
      { clientIpAddress: "flore", deduplicateDomains: true },
      window,
    );
    // FTS clause present, IP LIKE absent.
    expect(whereSql).toContain(
      "rowid IN (SELECT rowid FROM query_log_fts WHERE clientNameLc MATCH ?)",
    );
    expect(whereSql).not.toContain("clientIpLc LIKE");
  });

  it("ambiguous-input client search falls back to IP LIKE only, not OR", () => {
    internal.ftsEnabled = true;
    // Pure punctuation: no letters, no digits. FTS expression would be empty.
    const { whereSql, params } = internal.buildWhereClause(
      { clientIpAddress: "!!!", deduplicateDomains: true },
      window,
    );
    // Falls back to IP LIKE branch (single clause, no OR, no FTS).
    expect(whereSql).toContain("clientIpLc LIKE ?");
    expect(whereSql).not.toContain("query_log_fts");
    expect(whereSql).not.toContain("clientNameLc LIKE");
    expect(params).toContain("%!!!%");
  });
});

describe("QueryLogSqliteService — stored hostname isolation", () => {
  let tmpDir: string;
  let db: DatabaseSync;

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("serves stored rows through cached enrichment without live DHCP calls", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "qlogs-stored-hostname-spec-"));
    db = new DatabaseSync(join(tmpDir, "query-logs.sqlite"));
    const cachedEnrichment = jest.fn((entries: unknown[]) => entries);
    const liveEnrichment = jest.fn(() =>
      Promise.reject(new Error("live DHCP must not be called")),
    );
    const service = new QueryLogSqliteService(
      {
        enrichQueryLogEntriesWithCachedHostnames: cachedEnrichment,
        enrichQueryLogEntriesWithHostnames: liveEnrichment,
      } as never,
      [] as never,
    );
    const internal = service as unknown as SchemaShape;
    internal.db = db;
    internal.initializeSchema();

    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    db.prepare(
      `INSERT INTO query_log_entries (
        nodeId, baseUrl, ts, timestamp,
        qname, qnameLc, clientIpAddress, clientIpLc,
        clientName, clientNameLc,
        blockedRank, aRank, entryHash, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "node-a",
      "https://node-a.example.test",
      now,
      timestamp,
      "example.test",
      "example.test",
      "192.0.2.40",
      "192.0.2.40",
      "stored-client",
      "stored-client",
      0,
      1,
      "entry-1",
      JSON.stringify({
        timestamp,
        qname: "example.test",
        clientIpAddress: "192.0.2.40",
        clientName: "stored-client",
      }),
    );

    const result = service.getStoredCombinedLogs({
      start: new Date(now - 1000).toISOString(),
      end: new Date(now + 1000).toISOString(),
      disableCache: true,
    });

    expect(result.entries).toHaveLength(1);
    expect(cachedEnrichment).toHaveBeenCalledTimes(1);
    expect(liveEnrichment).not.toHaveBeenCalled();
  });

  it("backfills a hostname only inside its group namespace", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "qlogs-group-backfill-spec-"));
    db = new DatabaseSync(join(tmpDir, "query-logs.sqlite"));
    const internal = new QueryLogSqliteService(
      {} as never,
      [] as never,
    ) as unknown as HostnameBackfillShape;
    internal.db = db;
    internal.initializeSchema();
    const insert = db.prepare(
      `INSERT INTO query_log_entries (
        nodeId, baseUrl, groupId, ts, timestamp,
        clientIpAddress, clientIpLc, entryHash, data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      "node-a",
      "https://node-a.example.test",
      "site-a",
      1,
      "ts-a",
      "192.168.1.20",
      "192.168.1.20",
      "a",
      "{}",
    );
    insert.run(
      "node-b",
      "https://node-b.example.test",
      "site-b",
      2,
      "ts-b",
      "192.168.1.20",
      "192.168.1.20",
      "b",
      "{}",
    );

    internal.backfillMissingClientNames(
      new Map([["site-a\u0000192.168.1.20", "client-at-site-a"]]),
    );
    expect(
      db
        .prepare(
          "SELECT groupId, clientName FROM query_log_entries ORDER BY groupId",
        )
        .all(),
    ).toEqual([
      { groupId: "site-a", clientName: "client-at-site-a" },
      { groupId: "site-b", clientName: null },
    ]);
  });
});
