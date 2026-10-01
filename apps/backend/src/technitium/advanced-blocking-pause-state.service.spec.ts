import { DatabaseSync } from "node:sqlite";
import { AdvancedBlockingPauseStateService } from "./advanced-blocking-pause-state.service";

describe("Advanced Blocking pause SQLite migration", () => {
  it("rolls back a failed rebuild and permits a clean initialization retry", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        "CREATE TABLE advanced_blocking_pauses (write_target_node_id TEXT PRIMARY KEY, status TEXT, expires_at TEXT, previous_enable_blocking_present INTEGER, previous_enable_blocking_value INTEGER, last_error TEXT, updated_at TEXT)",
      );
      db.exec(
        "INSERT INTO advanced_blocking_pauses VALUES ('dns1', 'pause-pending', '2030-01-01', 1, 1, NULL, 'old')",
      );
      const state = new AdvancedBlockingPauseStateService({ db } as never);
      const nativeExec = db.exec.bind(db) as (sql: string) => void;
      const exec = jest.spyOn(db, "exec").mockImplementation((sql: string) => {
        nativeExec(sql);
        if (sql.includes("CREATE TABLE advanced_blocking_pauses_next"))
          throw new Error(
            "simulated migration failure after table replacement",
          );
      });
      expect(() => state.onModuleInit()).toThrow("simulated migration failure");
      exec.mockRestore();
      expect(
        db.prepare("SELECT status FROM advanced_blocking_pauses").get(),
      ).toMatchObject({ status: "pause-pending" });
      expect(
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE name = 'advanced_blocking_pauses_next'",
          )
          .get(),
      ).toBeUndefined();
      state.onModuleInit();
      expect(state.get("dns1")).toMatchObject({
        status: "activation-pending",
        previousEnableBlockingValue: true,
      });
    } finally {
      db.close();
    }
  });

  it("marks extensions pending and clears errors until reverified", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const state = new AdvancedBlockingPauseStateService({ db } as never);
      state.onModuleInit();
      state.beginPause("node:dns1", "dns1", "2030-01-01");
      state.activate("node:dns1", "dns1", true, true);
      state.markVerificationFailed(
        "node:dns1",
        "offline",
        state.get("node:dns1")!.updatedAt,
      );
      state.beginPause("node:dns1", "dns1", "2030-01-02");
      expect(state.get("node:dns1")).toMatchObject({
        status: "activation-pending",
        expiresAt: "2030-01-02",
        previousEnableBlockingValue: true,
      });
      expect(state.get("node:dns1")?.lastError).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("rebuilds the legacy constraint idempotently and preserves true, false, and absent baselines", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(
        "CREATE TABLE advanced_blocking_pauses (write_target_node_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('pause-pending','active','resume-pending')), expires_at TEXT NOT NULL, previous_enable_blocking_present INTEGER, previous_enable_blocking_value INTEGER, last_error TEXT, updated_at TEXT NOT NULL)",
      );
      const insert = db.prepare(
        "INSERT INTO advanced_blocking_pauses VALUES (?, 'pause-pending', '2030-01-01', ?, ?, NULL, 'old')",
      );
      insert.run("true", 1, 1);
      insert.run("false", 1, 0);
      insert.run("absent", 0, null);
      insert.run("unknown", null, null);
      const state = new AdvancedBlockingPauseStateService({ db } as never);
      state.onModuleInit();
      state.onModuleInit();
      for (const id of ["true", "false", "absent", "unknown"])
        state.migrateLegacyKey(id, "node:" + id);
      expect(state.get("node:true")?.previousEnableBlockingValue).toBe(true);
      expect(state.get("node:false")?.previousEnableBlockingValue).toBe(false);
      expect(state.get("node:absent")?.previousEnableBlockingPresent).toBe(
        false,
      );
      expect(state.get("node:unknown")?.captureBeforeWrite).toBe(false);
      expect(state.isEnforced("node:unknown")).toBe(false);
      state.beginPause("node:new", "new", "2030-01-01");
      expect(state.get("node:new")?.captureBeforeWrite).toBe(true);
    } finally {
      db.close();
    }
  });
});
