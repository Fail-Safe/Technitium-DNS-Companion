import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, rmSync, statSync } from "fs";
import { dirname } from "path";
import { createHash } from "crypto";

// ── SQLite query-log performance benchmarks ────────────────────────────────
//
// Opt-in benchmark harness for the query-logs DB. Not part of the default
// test run — gated by RUN_QLOG_BENCHMARKS=true. Each run produces a Markdown
// table of cold/warm timings for a fixed matrix of representative queries
// against a synthetic dataset, so results are directly comparable across
// optimization phases (baseline → tier 1 → tier 2).
//
// Usage:
//   RUN_QLOG_BENCHMARKS=true QLOG_BENCHMARK_PHASE=baseline \
//     cd apps/backend && npx jest query-log-sqlite.bench --no-coverage
//
// Env knobs:
//   QLOG_BENCHMARK_DB          Path to benchmark DB (default /tmp/bench-qlogs.sqlite)
//   QLOG_BENCHMARK_ROWS        Target row count (default 1_000_000)
//   QLOG_BENCHMARK_REGENERATE  Force regenerate even if DB exists (default false)
//   QLOG_BENCHMARK_PHASE       Label printed in the output header (default "baseline")
//   QLOG_BENCHMARK_APPLY_TIER1 Apply Tier 1 PRAGMA tunables to each connection
//   QLOG_BENCHMARK_USE_FTS     Use FTS5 table for domain/client substring queries
//
// Synthetic dataset shape mirrors what a household DNS resolver with
// ~36h retention and realistic family-of-5 traffic produces: power-law
// domain distribution, 8 named clients, diurnal time curve, typical qtype
// and responseType mixes.

const RUN = process.env.RUN_QLOG_BENCHMARKS === "true";
const BENCH_DB_PATH =
  process.env.QLOG_BENCHMARK_DB ?? "/tmp/bench-qlogs.sqlite";
const BENCH_ROWS = Number(
  process.env.QLOG_BENCHMARK_ROWS ?? String(1_000_000),
);
const REGEN = process.env.QLOG_BENCHMARK_REGENERATE === "true";
const PHASE = process.env.QLOG_BENCHMARK_PHASE ?? "baseline";
const APPLY_TIER1 = process.env.QLOG_BENCHMARK_APPLY_TIER1 === "true";
const USE_FTS = process.env.QLOG_BENCHMARK_USE_FTS === "true";

const describeOrSkip = RUN ? describe : describe.skip;

// ── Synthetic data configuration ───────────────────────────────────────────
const NOW_MS = Date.now();
const WINDOW_MS = 36 * 60 * 60 * 1000; // last 36h
const START_MS = NOW_MS - WINDOW_MS;
const UNIQUE_DOMAINS = 5_000;
const ZIPF_EXPONENT = 1.1; // standard DNS popularity distribution
const NODES = [
  { id: "nodeA", baseUrl: "https://nodeA.example.com:53443" },
  { id: "nodeB", baseUrl: "https://nodeB.example.com:53443" },
  { id: "nodeC", baseUrl: "https://nodeC.example.com:53443" },
];
const CLIENTS: Array<{ ip: string; name: string }> = [
  { ip: "10.0.1.10", name: "parent-laptop" },
  { ip: "10.0.1.11", name: "parent-phone" },
  { ip: "10.0.1.20", name: "kid1-phone" },
  { ip: "10.0.1.21", name: "kid1-laptop" },
  { ip: "10.0.1.22", name: "kid2-phone" },
  { ip: "10.0.1.30", name: "living-room-tv" },
  { ip: "10.0.1.31", name: "kitchen-speaker" },
  { ip: "10.0.1.99", name: "guest-laptop" },
];
const QTYPE_WEIGHTS: Array<[string, number]> = [
  ["A", 0.65],
  ["AAAA", 0.25],
  ["HTTPS", 0.04],
  ["PTR", 0.03],
  ["MX", 0.01],
  ["TXT", 0.01],
  ["SRV", 0.01],
];
const PROTOCOL_WEIGHTS: Array<[string, number]> = [
  ["Udp", 0.8],
  ["Tcp", 0.15],
  ["Tls", 0.04],
  ["Https", 0.01],
];
const RESPONSE_TYPE_WEIGHTS: Array<[string, number]> = [
  ["Allowed", 0.75],
  ["Blocked", 0.13],
  ["Recursive", 0.05],
  ["CacheHit", 0.04],
  ["BlockedEDNS", 0.02],
  ["Refused", 0.01],
];

// Seeded deterministic PRNG so runs are reproducible across machines/phases.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function weightedPick<T>(
  weights: Array<[T, number]>,
  rng: () => number,
): T {
  const r = rng();
  let acc = 0;
  for (const [value, weight] of weights) {
    acc += weight;
    if (r < acc) return value;
  }
  return weights[weights.length - 1][0];
}

function buildDomain(rank: number): string {
  // Distribute popular domains in a believable TLD mix. Include the
  // substrings our search queries will hunt for so benchmarks return
  // non-empty results (youtube, google, phone, etc.).
  const anchors = [
    // Multi-variant families matter for realistic dedup cost on popular
    // domains — the UI filter "youtube" should find 5-10 unique qnames, not 1.
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtube-nocookie.com",
    "youtube.googleapis.com",
    "youtubei.googleapis.com",
    "youtube-ui.l.google.com",
    "googlevideo.com",
    "google.com",
    "www.google.com",
    "mail.google.com",
    "googleapis.com",
    "play.google.com",
    "googletagmanager.com",
    "googleusercontent.com",
    "facebook.com",
    "www.facebook.com",
    "fbcdn.net",
    "instagram.com",
    "netflix.com",
    "nflxvideo.net",
    "amazon.com",
    "amazonaws.com",
    "apple.com",
    "icloud.com",
    "microsoft.com",
    "live.com",
    "twitter.com",
    "x.com",
    "tiktok.com",
    "tiktokcdn.com",
    "reddit.com",
    "redditmedia.com",
    "twitch.tv",
    "discord.com",
    "cloudflare.com",
    "akamaihd.net",
  ];
  if (rank < anchors.length) return anchors[rank];
  // Synthesize longer-tail domains. Include a few that contain "phone" so
  // the client-substring query has something to match against hostnames too.
  const subword =
    rank % 173 === 0 ? "phone-api" : rank % 97 === 0 ? "iphone" : `svc${rank}`;
  const root = rank % 7 === 0 ? "cdn" : rank % 5 === 0 ? "api" : "www";
  const tld =
    rank % 11 === 0
      ? "net"
      : rank % 13 === 0
        ? "io"
        : rank % 17 === 0
          ? "app"
          : "com";
  return `${root}.${subword}.example${rank}.${tld}`;
}

function zipfCdf(n: number, s: number): Float64Array {
  const cdf = new Float64Array(n);
  let sum = 0;
  for (let k = 1; k <= n; k++) sum += 1 / Math.pow(k, s);
  let acc = 0;
  for (let k = 1; k <= n; k++) {
    acc += 1 / Math.pow(k, s) / sum;
    cdf[k - 1] = acc;
  }
  return cdf;
}

function sampleZipf(cdf: Float64Array, rng: () => number): number {
  const r = rng();
  // Binary search for r in cdf. Return rank (0-based).
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cdf[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function generateSyntheticDb(path: string, rowCount: number): void {
  if (existsSync(path)) rmSync(path, { force: true });
  if (existsSync(`${path}-wal`)) rmSync(`${path}-wal`, { force: true });
  if (existsSync(`${path}-shm`)) rmSync(`${path}-shm`, { force: true });
  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.prepare("PRAGMA journal_mode=WAL").run();
  db.prepare("PRAGMA synchronous=NORMAL").run();

  // Schema mirrors apps/backend/src/technitium/query-log-sqlite.service.ts
  // initializeSchema() exactly so benchmark queries hit the same index
  // layout as production.
  db.prepare(
    `CREATE TABLE IF NOT EXISTS query_log_entries (
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
    )`,
  ).run();
  for (const idx of [
    "CREATE INDEX IF NOT EXISTS idx_query_log_ts ON query_log_entries(ts)",
    "CREATE INDEX IF NOT EXISTS idx_query_log_node_ts ON query_log_entries(nodeId, ts)",
    "CREATE INDEX IF NOT EXISTS idx_query_log_qnameLc_ts ON query_log_entries(qnameLc, ts)",
    "CREATE INDEX IF NOT EXISTS idx_query_log_clientIpLc_ts ON query_log_entries(clientIpLc, ts)",
    "CREATE INDEX IF NOT EXISTS idx_query_log_clientNameLc_ts ON query_log_entries(clientNameLc, ts)",
    "CREATE INDEX IF NOT EXISTS idx_query_log_responseType_ts ON query_log_entries(responseType, ts)",
    "CREATE INDEX IF NOT EXISTS idx_query_log_qtype_ts ON query_log_entries(qtype, ts)",
  ]) {
    db.prepare(idx).run();
  }

  const rng = makeRng(0xcafe_babe);
  const domainCdf = zipfCdf(UNIQUE_DOMAINS, ZIPF_EXPONENT);
  const domains: string[] = [];
  for (let i = 0; i < UNIQUE_DOMAINS; i++) domains.push(buildDomain(i));

  const insert = db.prepare(
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

  const BATCH = 10_000;
  const hasher = createHash.bind(null);
  let written = 0;
  while (written < rowCount) {
    const batchSize = Math.min(BATCH, rowCount - written);
    db.prepare("BEGIN").run();
    try {
      for (let i = 0; i < batchSize; i++) {
        // Diurnal curve: peak around 19:00 local, trough around 04:00.
        const tsBase = START_MS + rng() * WINDOW_MS;
        const hour = new Date(tsBase).getHours();
        const diurnalBoost = 0.5 + 0.5 * Math.cos(((hour - 19) / 12) * Math.PI);
        if (rng() > diurnalBoost * 0.85 + 0.15) {
          // Reroll with concentration toward waking hours.
          continue;
        }
        const ts = Math.floor(tsBase);
        const iso = new Date(ts).toISOString();
        const rank = sampleZipf(domainCdf, rng);
        const qname = domains[rank];
        const qnameLc = qname.toLowerCase();
        const client = CLIENTS[Math.floor(rng() * CLIENTS.length)];
        const qtype = weightedPick(QTYPE_WEIGHTS, rng);
        const protocol = weightedPick(PROTOCOL_WEIGHTS, rng);
        const responseType = weightedPick(RESPONSE_TYPE_WEIGHTS, rng);
        const isBlocked =
          responseType === "Blocked" || responseType === "BlockedEDNS";
        const rcode = isBlocked
          ? "Refused"
          : responseType === "Refused"
            ? "Refused"
            : "NoError";
        const node = NODES[Math.floor(rng() * NODES.length)];
        // entryHash must be unique per (nodeId, …) row to satisfy the PK.
        const h = hasher("sha256");
        h.update(`${node.id}|${ts}|${qname}|${client.ip}|${i}|${written}`);
        const entryHash = h.digest("hex").slice(0, 16);
        const data = JSON.stringify({
          timestamp: iso,
          qname,
          clientIpAddress: client.ip,
          clientName: client.name,
          protocol,
          responseType,
          rcode,
          qtype,
          qclass: "IN",
        });
        insert.run(
          node.id,
          node.baseUrl,
          ts,
          iso,
          qname,
          qnameLc,
          client.ip,
          client.ip,
          client.name,
          client.name.toLowerCase(),
          protocol,
          responseType,
          rcode,
          qtype,
          "IN",
          isBlocked ? 1 : 0,
          qtype === "A" ? 1 : 0,
          entryHash,
          data,
        );
        written++;
      }
      db.prepare("COMMIT").run();
    } catch (error) {
      db.prepare("ROLLBACK").run();
      throw error;
    }
  }
  db.prepare("ANALYZE").run();
  db.close();
}

// ── FTS5 auxiliary table for Tier 2 benchmarks ─────────────────────────────
function ensureFtsTable(db: DatabaseSync): void {
  // Contentless FTS5 table shadowing query_log_entries. Triggers keep it in
  // sync with inserts/deletes; since this DB is read-only for the benchmark
  // run we build it once via INSERT INTO ... SELECT.
  const existing = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='query_log_fts'",
    )
    .get() as { name?: string } | undefined;
  if (existing?.name === "query_log_fts") return;
  db.prepare(
    `CREATE VIRTUAL TABLE query_log_fts USING fts5(
      qnameLc, clientNameLc,
      content='query_log_entries', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    )`,
  ).run();
  // External-content FTS5 requires the 'rebuild' command; a manual
  // INSERT INTO ... SELECT registers rowids but doesn't actually tokenize
  // content. Earlier bench numbers were misleading because of this.
  db.prepare(`INSERT INTO query_log_fts(query_log_fts) VALUES('rebuild')`).run();
}

// ── Benchmark harness ──────────────────────────────────────────────────────

interface QueryCase {
  name: string;
  sql: string;
  params: Array<string | number>;
}

function buildQueryCases(): QueryCase[] {
  const startTs = NOW_MS - WINDOW_MS;
  const endTs = NOW_MS;
  const tsClause = "ts >= ? AND ts <= ?";
  const tsParams = [startTs, endTs];

  const ftsLikeSubquery = (column: "qnameLc" | "clientNameLc", term: string) =>
    USE_FTS
      ? `rowid IN (SELECT rowid FROM query_log_fts WHERE ${column} MATCH ?)`
      : `${column} LIKE ?`;
  // Mirror QueryLogSqliteService.buildFtsMatchExpression: split on
  // non-alphanumerics and prefix-star the last token. Without this, a term
  // like "google.com" crashes FTS5 with "syntax error near ." — which is
  // the bug that took down the test container last night.
  const ftsLikeParam = (term: string) => {
    if (!USE_FTS) return `%${term}%`;
    const tokens = term
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0);
    if (tokens.length === 0) return "*";
    return [
      ...tokens.slice(0, -1),
      `${tokens[tokens.length - 1]}*`,
    ].join(" ");
  };

  return [
    {
      name: "01 recent unfiltered page 1 (dedup off)",
      sql: `SELECT nodeId, data FROM query_log_entries WHERE ${tsClause} ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams],
    },
    {
      name: "02 recent unfiltered page 1 (dedup on)",
      sql: `WITH ranked AS (
        SELECT nodeId, data, ts,
          ROW_NUMBER() OVER (PARTITION BY qnameLc ORDER BY blockedRank DESC, aRank DESC, ts DESC) AS rn
        FROM query_log_entries WHERE ${tsClause} AND qnameLc IS NOT NULL
      ) SELECT nodeId, data FROM ranked WHERE rn = 1 ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams],
    },
    {
      name: "03 domain substring 'youtube' (dedup off)",
      sql: `SELECT nodeId, data FROM query_log_entries
            WHERE ${tsClause} AND ${ftsLikeSubquery("qnameLc", "youtube")}
            ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams, ftsLikeParam("youtube")],
    },
    {
      name: "04 domain substring 'youtube' (dedup on)",
      sql: `WITH ranked AS (
        SELECT nodeId, data, ts,
          ROW_NUMBER() OVER (PARTITION BY qnameLc ORDER BY blockedRank DESC, aRank DESC, ts DESC) AS rn
        FROM query_log_entries
        WHERE ${tsClause} AND qnameLc IS NOT NULL AND ${ftsLikeSubquery("qnameLc", "youtube")}
      ) SELECT nodeId, data FROM ranked WHERE rn = 1 ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams, ftsLikeParam("youtube")],
    },
    {
      name: "05 client substring 'phone' (dedup off)",
      sql: `SELECT nodeId, data FROM query_log_entries
            WHERE ${tsClause} AND ${ftsLikeSubquery("clientNameLc", "phone")}
            ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams, ftsLikeParam("phone")],
    },
    {
      name: "06 qtype=AAAA equality (dedup off)",
      sql: `SELECT nodeId, data FROM query_log_entries
            WHERE ${tsClause} AND qtype = ? ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams, "AAAA"],
    },
    {
      name: "07 blocked only (dedup off)",
      sql: `SELECT nodeId, data FROM query_log_entries
            WHERE ${tsClause} AND blockedRank = 1 ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams],
    },
    {
      name: "08 typical: domain 'google' + qtype A + dedup",
      sql: `WITH ranked AS (
        SELECT nodeId, data, ts,
          ROW_NUMBER() OVER (PARTITION BY qnameLc ORDER BY blockedRank DESC, aRank DESC, ts DESC) AS rn
        FROM query_log_entries
        WHERE ${tsClause} AND qnameLc IS NOT NULL AND ${ftsLikeSubquery("qnameLc", "google")} AND qtype = ?
      ) SELECT nodeId, data FROM ranked WHERE rn = 1 ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams, ftsLikeParam("google"), "A"],
    },
    {
      name: "09 deep pagination (dedup on, offset 2500)",
      sql: `WITH ranked AS (
        SELECT nodeId, data, ts,
          ROW_NUMBER() OVER (PARTITION BY qnameLc ORDER BY blockedRank DESC, aRank DESC, ts DESC) AS rn
        FROM query_log_entries WHERE ${tsClause} AND qnameLc IS NOT NULL
      ) SELECT nodeId, data FROM ranked WHERE rn = 1 ORDER BY ts DESC LIMIT 50 OFFSET 2500`,
      params: [...tsParams],
    },
    {
      name: "10 COUNT(*) window-scoped",
      sql: `SELECT COUNT(*) AS count FROM query_log_entries WHERE ${tsClause}`,
      params: [...tsParams],
    },
    // Rare-substring case: 'iphone' only appears in long-tail synthetic
    // domains (rank % 97 === 0) so the planner can't short-circuit via
    // LIMIT + ordered scan — it must exhaust most of the time window.
    {
      name: "11 rare domain substring 'iphone' (dedup off)",
      sql: `SELECT nodeId, data FROM query_log_entries
            WHERE ${tsClause} AND ${ftsLikeSubquery("qnameLc", "iphone")}
            ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams, ftsLikeParam("iphone")],
    },
    // No-match case: worst-case unsargable LIKE — must scan the full window.
    {
      name: "12 no-match substring 'zzznoexistxxx' (dedup off)",
      sql: `SELECT nodeId, data FROM query_log_entries
            WHERE ${tsClause} AND ${ftsLikeSubquery("qnameLc", "zzznoexistxxx")}
            ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams, ftsLikeParam("zzznoexistxxx")],
    },
    // Per-node COUNT(*) loop — UI runs one of these per configured node on
    // every page load (N+1 count pattern in the production code).
    {
      name: "13 per-node COUNT(*) (single node, window-scoped)",
      sql: `SELECT COUNT(*) AS count FROM query_log_entries WHERE nodeId = ? AND ${tsClause}`,
      params: ["nodeA", ...tsParams],
    },
    // Regression case for the crash the test container hit: a dotted
    // search term. Pre-sanitizer, the FTS MATCH expression was
    // "google.com*" which is a syntax error. With buildFtsMatchExpression
    // it becomes "google com*" and works.
    {
      name: "14 dotted domain 'google.com' (dedup on)",
      sql: `WITH ranked AS (
        SELECT nodeId, data, ts,
          ROW_NUMBER() OVER (PARTITION BY qnameLc ORDER BY blockedRank DESC, aRank DESC, ts DESC) AS rn
        FROM query_log_entries
        WHERE ${tsClause} AND qnameLc IS NOT NULL AND ${ftsLikeSubquery("qnameLc", "google.com")}
      ) SELECT nodeId, data FROM ranked WHERE rn = 1 ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams, ftsLikeParam("google.com")],
    },
    // The case that motivated last night's incident: client hostname
    // substring search with dedup enabled. The UI default sends dedup=true,
    // so this is the realistic path — not the dedup-off shortcut case 05.
    // Pre-heuristic-fix this was ~7-8s due to `LIKE … OR FTS …` forcing a
    // full scan on the IP side.
    {
      name: "15 client substring 'phone' + dedup on",
      sql: `WITH ranked AS (
        SELECT nodeId, data, ts,
          ROW_NUMBER() OVER (PARTITION BY qnameLc ORDER BY blockedRank DESC, aRank DESC, ts DESC) AS rn
        FROM query_log_entries
        WHERE ${tsClause} AND qnameLc IS NOT NULL AND ${ftsLikeSubquery("clientNameLc", "phone")}
      ) SELECT nodeId, data FROM ranked WHERE rn = 1 ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams, ftsLikeParam("phone")],
    },
    // Rare-client-substring + dedup: worst-case combination in production
    // — rare matches mean no LIMIT short-circuit, dedup means window
    // function over the full filtered result.
    {
      name: "16 client substring 'guest' + dedup on",
      sql: `WITH ranked AS (
        SELECT nodeId, data, ts,
          ROW_NUMBER() OVER (PARTITION BY qnameLc ORDER BY blockedRank DESC, aRank DESC, ts DESC) AS rn
        FROM query_log_entries
        WHERE ${tsClause} AND qnameLc IS NOT NULL AND ${ftsLikeSubquery("clientNameLc", "guest")}
      ) SELECT nodeId, data FROM ranked WHERE rn = 1 ORDER BY ts DESC LIMIT 50`,
      params: [...tsParams, ftsLikeParam("guest")],
    },
  ];
}

function openBenchmarkDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  if (APPLY_TIER1) {
    db.prepare("PRAGMA mmap_size = 268435456").run();
    db.prepare("PRAGMA cache_size = -65536").run();
    db.prepare("PRAGMA temp_store = MEMORY").run();
  }
  return db;
}

function timeQuery(
  db: DatabaseSync,
  sql: string,
  params: Array<string | number>,
): { durationMs: number; rows: number } {
  const stmt = db.prepare(sql);
  const start = performance.now();
  const rows = stmt.all(...params);
  const durationMs = performance.now() - start;
  return { durationMs, rows: rows.length };
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[idx];
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 1) return `${ms.toFixed(0)}ms`;
  return `${ms.toFixed(2)}ms`;
}

// ── Test entry points ──────────────────────────────────────────────────────

describeOrSkip("QueryLogSqliteService — SQLite query performance benchmarks", () => {
  beforeAll(() => {
    const needsRegen = REGEN || !existsSync(BENCH_DB_PATH);
    if (needsRegen) {
      console.log(
        `[bench] Generating synthetic DB at ${BENCH_DB_PATH} (${BENCH_ROWS.toLocaleString()} target rows)…`,
      );
      const start = Date.now();
      generateSyntheticDb(BENCH_DB_PATH, BENCH_ROWS);
      const elapsed = (Date.now() - start) / 1000;
      const size = statSync(BENCH_DB_PATH).size;
      console.log(
        `[bench] Generated in ${elapsed.toFixed(1)}s; DB size ${(size / 1024 / 1024).toFixed(1)} MB`,
      );
    } else {
      console.log(
        `[bench] Reusing DB at ${BENCH_DB_PATH} (set QLOG_BENCHMARK_REGENERATE=true to rebuild)`,
      );
    }
  }, 10 * 60 * 1000);

  it(`benchmark suite — phase="${PHASE}" tier1=${APPLY_TIER1} fts=${USE_FTS}`, () => {
    const cases = buildQueryCases();

    // Optionally prebuild FTS index in a copy-of-snapshot connection.
    if (USE_FTS) {
      const db = openBenchmarkDb(BENCH_DB_PATH);
      ensureFtsTable(db);
      // Sanity check: a freshly-built FTS index over a DB where at least
      // one query term appears should return non-zero matches for that
      // term. This catches the "FTS populated but not tokenized" bug we
      // hit in production — previously the bench was measuring a sparse
      // index and reporting bogus "FTS wins" numbers.
      const sanityRow = db
        .prepare(
          "SELECT COUNT(*) AS c FROM query_log_fts WHERE qnameLc MATCH 'google*'",
        )
        .get() as { c?: number } | undefined;
      const sanityCount = sanityRow?.c ?? 0;
      if (sanityCount === 0) {
        throw new Error(
          "FTS5 sanity check failed: 'google*' returned 0 matches after " +
            "ensureFtsTable(). Index is either empty or tokens weren't " +
            "built. Did the rebuild command fire correctly?",
        );
      }
      console.log(
        `[bench] FTS5 sanity: MATCH 'google*' returned ${sanityCount.toLocaleString()} rows.`,
      );
      db.close();
    }

    const results: Array<{
      name: string;
      coldMs: number;
      warmMedian: number;
      warmP95: number;
      rows: number;
    }> = [];

    for (const queryCase of cases) {
      // Cold: fresh connection, single sample.
      const coldDb = openBenchmarkDb(BENCH_DB_PATH);
      const cold = timeQuery(coldDb, queryCase.sql, queryCase.params);
      coldDb.close();

      // Warm: same connection, 5 samples after one priming call.
      const warmDb = openBenchmarkDb(BENCH_DB_PATH);
      timeQuery(warmDb, queryCase.sql, queryCase.params); // prime
      const warmSamples: number[] = [];
      for (let i = 0; i < 5; i++) {
        const { durationMs } = timeQuery(
          warmDb,
          queryCase.sql,
          queryCase.params,
        );
        warmSamples.push(durationMs);
      }
      warmDb.close();

      results.push({
        name: queryCase.name,
        coldMs: cold.durationMs,
        warmMedian: percentile(warmSamples, 50),
        warmP95: percentile(warmSamples, 95),
        rows: cold.rows,
      });
    }

    const nameWidth = Math.max(...results.map((r) => r.name.length), 20);
    const header = `| ${"Query".padEnd(nameWidth)} | Cold      | Warm med  | Warm p95  | Rows |`;
    const divider = `| ${"".padEnd(nameWidth, "-")} | --------- | --------- | --------- | ---- |`;
    const lines = results.map(
      (r) =>
        `| ${r.name.padEnd(nameWidth)} | ${formatMs(r.coldMs).padStart(9)} | ${formatMs(r.warmMedian).padStart(9)} | ${formatMs(r.warmP95).padStart(9)} | ${String(r.rows).padStart(4)} |`,
    );

    const stats = statSync(BENCH_DB_PATH);
    console.log(
      [
        "",
        `### Query-log SQLite benchmark — phase="${PHASE}"`,
        `DB: ${BENCH_DB_PATH} (${(stats.size / 1024 / 1024).toFixed(1)} MB)  `,
        `Tier1 PRAGMAs: ${APPLY_TIER1 ? "on" : "off"}  |  FTS5: ${USE_FTS ? "on" : "off"}`,
        "",
        header,
        divider,
        ...lines,
        "",
      ].join("\n"),
    );

    // Sanity: at least some queries should return non-empty results.
    const nonEmpty = results.filter((r) => r.rows > 0).length;
    expect(nonEmpty).toBeGreaterThan(0);
  }, 10 * 60 * 1000);
});
