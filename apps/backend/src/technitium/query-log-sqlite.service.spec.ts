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
  runMaintenance: () => void;
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
    runSql(
      db,
      "CREATE TABLE query_log_entries (ts INTEGER, payload TEXT)",
    );

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
    expect(messages).toContain("Migrating query-logs SQLite to auto_vacuum=INCREMENTAL");
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

  it("runMaintenance is a safe no-op when the DB is closed", () => {
    internal.db = null;
    expect(() => internal.runMaintenance()).not.toThrow();
    expect(internal.logger.warn).not.toHaveBeenCalled();
  });
});
