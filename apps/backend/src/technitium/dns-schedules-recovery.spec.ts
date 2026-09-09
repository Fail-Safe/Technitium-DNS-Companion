import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DnsScheduleRecoveryFixture } from "../../test/fixtures/dns-schedules-recovery.fixture";

describe("durable schedule recovery", () => {
  let dir: string;
  let f: DnsScheduleRecoveryFixture;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-05T12:00:00Z"));
    dir = mkdtempSync(join(tmpdir(), "dns-recovery-"));
    f = new DnsScheduleRecoveryFixture(join(dir, "state.sqlite"));
  });
  afterEach(() => {
    f.close();
    rmSync(dir, { recursive: true, force: true });
    jest.useRealTimers();
  });

  it.each(["schedule", "override"] as const)(
    "preserves entries added after a completed empty %s capture and reopen",
    async (kind) => {
      f.create(kind);
      if (kind === "schedule") {
        f.schedules.updateSchedule(f.source.id, {
          ...f.source,
          domainEntries: [],
          domainGroupNames: ["dynamic-set"],
        });
      } else {
        const override = f.overrides.listOverrides()[0];
        f.overrides.updateOverride(override.id, {
          ...override,
          domainEntries: [],
          domainGroupNames: ["dynamic-set"],
        });
      }
      f.config.groups[0].allowed.push("outside.test");
      await f.evaluator.runNow(false);
      expect(f.writes).toBe(0);
      expect(f.schedules.listPendingRecovery()).toEqual([]);
      expect(f.schedules.listAppliedState()).toHaveLength(1);
      f.reopen();
      f.groupEntries = ["outside.test"];
      if (kind === "schedule")
        f.schedules.setScheduleEnabled(f.source.id, false);
      else f.overrides.setOverrideEnabled(f.source.id, false);
      await f.evaluator.runNow(false);
      expect(f.config.groups[0].allowed).toEqual([
        "unrelated.test",
        "outside.test",
      ]);
      expect(f.writes).toBe(0);
      expect(f.schedules.listTrackedTargets()).toEqual([]);
    },
  );

  it("preserves a completed empty capture after abrupt process exit", async () => {
    f.close();
    const configPath = join(dir, "dns.json");
    const child = spawnSync(
      process.execPath,
      [
        "-r",
        require.resolve("ts-node/register/transpile-only"),
        resolve(
          __dirname,
          "../../test/fixtures/dns-schedules-recovery-exit.cjs",
        ),
        f.dbPath,
        configPath,
        "empty-finalized",
      ],
      {
        env: {
          ...process.env,
          TS_NODE_PROJECT: resolve(__dirname, "../../tsconfig.json"),
        },
        timeout: 15_000,
        encoding: "utf8",
      },
    );
    f.open();
    expect({ status: child.status, error: child.error?.message }).toEqual({
      status: 71,
      error: undefined,
    });
    f.config = JSON.parse(readFileSync(configPath, "utf8")) as typeof f.config;
    const override = f.overrides.listOverrides()[0];
    expect(f.schedules.listPendingRecovery()).toEqual([]);
    expect(f.schedules.listAppliedState()).toHaveLength(1);
    f.groupEntries = ["outside.test"];
    f.overrides.setOverrideEnabled(override.id, false);
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual([
      "unrelated.test",
      "outside.test",
    ]);
    expect(f.writes).toBe(0);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
  });

  it("recaptures an active legacy empty state before later cleanup", async () => {
    f.create();
    const override = f.overrides.listOverrides()[0];
    f.overrides.updateOverride(override.id, {
      ...override,
      domainEntries: [],
      domainGroupNames: ["dynamic-set"],
    });
    f.schedules.markApplied(override.id, "primary");
    f.config.groups[0].allowed.push("outside.test");
    await f.evaluator.runNow(false);
    f.reopen();
    f.groupEntries = ["outside.test"];
    f.overrides.setOverrideEnabled(override.id, false);
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual([
      "unrelated.test",
      "outside.test",
    ]);
    expect(f.writes).toBe(0);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
  });

  it("preserves legacy cleanup when upgrading an uncaptured applied state", async () => {
    f.create();
    f.config.groups[0].allowed.push("managed.test");
    f.schedules.markApplied(f.source.id, "primary");
    f.db.exec("ALTER TABLE dns_schedule_state DROP COLUMN entries_captured");
    f.reopen();
    expect(f.schedules.hasCapturedEntries(f.source.id, "primary")).toBe(false);
    f.expire();
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
    expect(f.writes).toBe(1);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
  });

  it("rolls back the capture marker with failed finalization", () => {
    f.create();
    f.schedules.prepareRecovery(f.source.id, "primary", []);
    f.db.exec(`CREATE TRIGGER fail_capture BEFORE UPDATE OF entries_captured
      ON dns_schedule_state BEGIN SELECT RAISE(ABORT, 'capture failed'); END`);
    expect(() =>
      f.schedules.finalizeRecovery(f.source.id, "primary", []),
    ).toThrow("capture failed");
    f.reopen();
    expect(f.schedules.hasCapturedEntries(f.source.id, "primary")).toBe(false);
    expect(f.schedules.listAppliedState()).toEqual([]);
    expect(
      f.schedules.getPendingRecovery(f.source.id, "primary")?.entries,
    ).toEqual([]);
  });

  it("does not mark built-in applied state as an Advanced Blocking capture", () => {
    f.create("schedule");
    f.schedules.updateSchedule(f.source.id, {
      ...f.source,
      targetType: "built-in",
    });
    f.schedules.markApplied(f.source.id, "primary");
    expect(f.schedules.hasCapturedEntries(f.source.id, "primary")).toBe(false);
  });

  it.each(["expiry", "definition edit"])(
    "retains shared cleanup if the surviving source cannot read DNS after %s",
    async (retirement) => {
      f.create();
      await f.evaluator.runNow(false);
      const original = f.overrides.listOverrides()[0];
      const surviving = f.overrides.createOverride({
        ...original,
        name: "Surviving source",
        expiresAt: undefined,
      });
      if (retirement === "expiry") {
        f.expire();
        f.fault = "read";
      } else {
        f.overrides.updateOverride(original.id, {
          ...original,
          domainEntries: ["replacement.test"],
        });
        f.writeHook = () => {
          f.fault = "read";
        };
      }
      await f.evaluator.runNow(false);
      expect(f.schedules.listManagedEntries(surviving.id, "primary")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ domain: "managed.test" }),
        ]),
      );
      for (const source of f.overrides.listOverrides())
        f.overrides.setOverrideEnabled(source.id, false);
      f.fault = undefined;
      f.writeHook = undefined;
      f.reopen();
      await f.evaluator.runNow(false);
      expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
      expect(f.schedules.listTrackedTargets()).toEqual([]);
    },
  );

  it.each(["schedule", "override"] as const)(
    "recovers a %s after a lost response, expiry and restart",
    async (kind) => {
      f.create(kind);
      f.fault = "after-write";
      const first = await f.evaluator.runNow(false);
      expect(first.errored).toBe(1);
      expect(first.pendingRecoveryCount).toBe(1);
      expect(f.schedules.listAppliedState()).toEqual([]);
      expect(f.config.groups[0].allowed).toContain("managed.test");
      f.expire();
      f.reopen();
      expect(f.evaluator.getStatus().pendingRecoveryCount).toBe(1);
      expect((await f.evaluator.runNow(false)).errored).toBe(0);
      expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
      expect(f.schedules.listTrackedTargets()).toEqual([]);
      expect(f.evaluator.getStatus().pendingRecoveryCount).toBe(0);
      const writes = f.writes;
      await f.evaluator.runNow(false);
      expect(f.writes).toBe(writes);
    },
  );

  it("does not dispatch when durable preparation fails", async () => {
    f.create();
    jest.spyOn(f.schedules, "prepareRecovery").mockImplementation(() => {
      throw new Error("disk full");
    });
    expect((await f.evaluator.runNow(false)).errored).toBe(1);
    expect(f.writes).toBe(0);
  });

  it("retains pending evidence when the final transaction rolls back", async () => {
    f.create();
    f.db.exec(
      "CREATE TRIGGER fail_state BEFORE INSERT ON dns_schedule_state BEGIN SELECT RAISE(ABORT, 'injected state failure'); END;",
    );
    expect((await f.evaluator.runNow(false)).errored).toBe(1);
    expect(f.schedules.listAppliedEntries(f.source.id, "primary")).toEqual([]);
    expect(f.schedules.listAppliedState()).toEqual([]);
    expect(f.schedules.listPendingRecovery()).toHaveLength(1);
    f.db.exec("DROP TRIGGER fail_state");
    f.expire();
    f.reopen();
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
  });

  it("cleans up a no-POST first apply after failed local finalization", async () => {
    f.create();
    f.config.groups[0].allowed.push("managed.test");
    jest.spyOn(f.schedules, "finalizeRecovery").mockImplementationOnce(() => {
      throw new Error("injected finalization failure");
    });
    await f.evaluator.runNow(false);
    expect(f.writes).toBe(0);
    expect(f.schedules.listPendingRecovery()).toHaveLength(1);
    f.expire();
    f.reopen();
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
  });

  it("retries a removal whose response was lost", async () => {
    f.create();
    await f.evaluator.runNow(false);
    f.expire();
    f.fault = "after-write";
    expect((await f.evaluator.runNow(false)).errored).toBe(1);
    expect(f.schedules.listAppliedState()).toHaveLength(1);
    expect(f.schedules.listPendingRecovery()).toHaveLength(1);
    f.reopen();
    await f.evaluator.runNow(false);
    expect(f.writes).toBe(2);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
  });

  it("recovers harmlessly when dispatch failed before DNS commit", async () => {
    f.create();
    f.fault = "before-write";
    await f.evaluator.runNow(false);
    f.expire();
    f.reopen();
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
    expect(f.writes).toBe(1);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
  });

  it("retains old and replacement entries across uncertain definition edits", async () => {
    f.create();
    await f.evaluator.runNow(false);
    const override = f.overrides.listOverrides()[0];
    f.overrides.updateOverride(override.id, {
      ...override,
      domainEntries: ["replacement.test"],
    });
    f.fault = "after-write";
    await f.evaluator.runNow(false);
    expect(
      f.schedules
        .listPendingRecovery()[0]
        .entries.map((e) => e.domain)
        .sort(),
    ).toEqual(["managed.test", "replacement.test"]);
    f.expire();
    f.reopen();
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
  });

  it("cleans up the original target after deselection", async () => {
    f.create();
    f.fault = "after-write";
    await f.evaluator.runNow(false);
    const override = f.overrides.listOverrides()[0];
    f.overrides.updateOverride(override.id, {
      ...override,
      nodeIds: ["other"],
    });
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
    expect(f.otherConfig.groups[0].allowed).toContain("managed.test");
    expect(f.schedules.listTrackedTargets()).toEqual([
      { scheduleId: override.id, nodeId: "other" },
    ]);
  });

  it("preserves another active source on the same target during cleanup", async () => {
    f.create();
    f.fault = "after-write";
    await f.evaluator.runNow(false);
    const override = f.overrides.listOverrides()[0];
    f.overrides.createOverride({
      ...override,
      name: "Shared",
      expiresAt: undefined,
    });
    f.expire();
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toContain("managed.test");
    expect(f.schedules.listPendingRecovery()).toEqual([]);
  });

  it("does not protect tuples requested only on a different target", async () => {
    f.create();
    f.fault = "after-write";
    await f.evaluator.runNow(false);
    const override = f.overrides.listOverrides()[0];
    f.overrides.createOverride({
      ...override,
      name: "Other target",
      nodeIds: ["other"],
      expiresAt: undefined,
    });
    f.expire();
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
    expect(f.otherConfig.groups[0].allowed).toContain("managed.test");
  });

  it.each(["read", "routing"])(
    "retains recovery while %s is unavailable",
    async (unavailable) => {
      f.create();
      f.fault = "after-write";
      await f.evaluator.runNow(false);
      f.expire();
      if (unavailable === "read") f.fault = "read";
      else f.available = false;
      await f.evaluator.runNow(false);
      f.reopen();
      expect(f.evaluator.getStatus().pendingRecoveryCount).toBe(1);
      expect(f.config.groups[0].allowed).toContain("managed.test");
      f.fault = undefined;
      f.available = true;
      await f.evaluator.runNow(false);
      expect(f.schedules.listPendingRecovery()).toEqual([]);
    },
  );

  it.each(["schedule", "override"] as const)(
    "prevents deletion of a pending %s",
    async (kind) => {
      f.create(kind);
      f.fault = "after-write";
      await f.evaluator.runNow(false);
      const remove = () =>
        kind === "schedule"
          ? f.schedules.deleteSchedule(f.source.id)
          : f.overrides.deleteOverride(f.source.id);
      expect(remove).toThrow(/cleanup/);
      f.expire();
      await f.evaluator.runNow(false);
      expect(remove().deleted).toBe(true);
    },
  );

  it("prevents a first write if deletion won the initial read race", async () => {
    f.create();
    f.readHook = () => {
      f.readHook = undefined;
      f.overrides.deleteOverride(f.source.id);
    };
    expect((await f.evaluator.runNow(false)).errored).toBe(1);
    expect(f.writes).toBe(0);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
  });

  it("keeps dry runs read-only and unchanged runs free of tracking writes", async () => {
    f.create();
    await f.evaluator.runNow(true);
    expect(f.writes).toBe(0);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
    await f.evaluator.runNow(false);
    const prepare = jest.spyOn(f.schedules, "prepareRecovery");
    const finalize = jest.spyOn(f.schedules, "finalizeRecovery");
    await f.evaluator.runNow(false);
    expect(prepare).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    f.expire();
    await f.evaluator.runNow(true);
    expect(f.schedules.listAppliedState()).toHaveLength(1);
    expect(f.writes).toBe(1);
  });

  it.each(["before-dispatch", "after-commit", "before-finalization"])(
    "recovers after process exit %s",
    async (phase) => {
      f.close();
      const configPath = join(dir, "dns.json");
      const child = spawnSync(
        process.execPath,
        [
          "-r",
          require.resolve("ts-node/register/transpile-only"),
          resolve(
            __dirname,
            "../../test/fixtures/dns-schedules-recovery-exit.cjs",
          ),
          f.dbPath,
          configPath,
          phase,
        ],
        {
          env: {
            ...process.env,
            TS_NODE_PROJECT: resolve(__dirname, "../../tsconfig.json"),
          },
          timeout: 15_000,
          encoding: "utf8",
        },
      );
      f.open();
      expect({ status: child.status, error: child.error?.message }).toEqual({
        status: 71,
        error: undefined,
      });
      f.source = f.evaluator.temporaryOverrideToSchedule(
        f.overrides.listOverrides()[0],
      );
      f.config = JSON.parse(
        readFileSync(configPath, "utf8"),
      ) as typeof f.config;
      expect(f.schedules.listPendingRecovery()).toHaveLength(1);
      expect(f.schedules.listAppliedState()).toEqual([]);
      f.expire();
      await f.evaluator.runNow(false);
      expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
      expect(f.schedules.listTrackedTargets()).toEqual([]);
    },
  );

  it("waits for an in-flight apply before immediate deactivation", async () => {
    f.create("schedule");
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.readHook = () => {
      f.readHook = undefined;
      entered();
      return blocked;
    };
    f.fault = "after-write";
    const evaluation = f.evaluator.runNow(false);
    await started;
    const disabled = f.schedules.setScheduleEnabled(f.source.id, false);
    const deactivation = f.evaluator.deactivateScheduleIfApplied(disabled);
    expect(f.writes).toBe(0);
    release();
    await Promise.all([evaluation, deactivation]);
    expect(f.writes).toBe(2);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
    expect(f.evaluator.getStatus().running).toBe(false);
  });

  it("protects deletion while a prepared write is in flight", async () => {
    f.create();
    f.writeHook = () => {
      expect(() => f.overrides.deleteOverride(f.source.id)).toThrow(/cleanup/);
    };
    await f.evaluator.runNow(false);
    expect(f.schedules.listAppliedState()).toHaveLength(1);
  });

  it("upgrades an existing database without changing tracking", () => {
    f.create();
    f.schedules.markApplied(f.source.id, "primary");
    f.schedules.setAppliedEntries(f.source.id, "primary", [
      {
        advancedBlockingGroupName: "test",
        action: "allow",
        domain: "managed.test",
      },
    ]);
    f.db.exec("DROP TABLE dns_schedule_pending_recovery");
    f.reopen();
    f.reopen();
    expect(f.schedules.listPendingRecovery()).toEqual([]);
    expect(f.schedules.listAppliedState()).toHaveLength(1);
    expect(f.schedules.listAppliedEntries(f.source.id, "primary")).toHaveLength(
      1,
    );
    expect(() => f.overrides.deleteOverride(f.source.id)).toThrow(/cleanup/);
  });

  it("prevents deletion of entry-only tracking from older deployments", () => {
    f.create();
    f.schedules.setAppliedEntries(f.source.id, "primary", [
      {
        advancedBlockingGroupName: "test",
        action: "allow",
        domain: "managed.test",
      },
    ]);
    expect(() => f.overrides.deleteOverride(f.source.id)).toThrow(/cleanup/);
  });

  it("finalizes an acknowledged write even if its optional readback fails", async () => {
    f.create();
    f.writeHook = () => {
      f.fault = "read";
    };
    expect((await f.evaluator.runNow(false)).errored).toBe(0);
    expect(f.schedules.listPendingRecovery()).toEqual([]);
    expect(f.schedules.listAppliedState()).toHaveLength(1);
    f.fault = undefined;
    f.writeHook = undefined;
    f.expire();
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
  });

  it("keeps group and action changes recoverable", async () => {
    f.create();
    await f.evaluator.runNow(false);
    f.config.groups.push({ name: "replacement", allowed: [], blocked: [] });
    const override = f.overrides.listOverrides()[0];
    f.groupEntries = ["group.test"];
    f.overrides.updateOverride(override.id, {
      ...override,
      action: "block",
      advancedBlockingGroupNames: ["replacement"],
      domainEntries: [],
      domainGroupNames: ["dynamic"],
    });
    f.fault = "after-write";
    await f.evaluator.runNow(false);
    f.expire();
    f.reopen();
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
    expect(f.config.groups[1].blocked).toEqual([]);
  });

  it("cleans a pending first apply when a recurring window closes", async () => {
    f.create("schedule");
    f.fault = "after-write";
    await f.evaluator.runNow(false);
    jest.setSystemTime(new Date("2026-09-05T23:59:00Z"));
    await f.evaluator.runNow(false);
    expect(f.schedules.listSchedules()[0].enabled).toBe(true);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
  });

  it("retains old alias tracking if cleanup fails before a new Primary apply", async () => {
    f.create();
    await f.evaluator.runNow(false);
    f.otherConfig = structuredClone(f.config);
    f.targets.set("primary", {
      writeTarget: "other",
      flushNodes: [],
      skippedFlushNodes: [],
    });
    const override = f.overrides.listOverrides()[0];
    f.overrides.updateOverride(override.id, {
      ...override,
      domainEntries: ["replacement.test"],
    });
    f.readHook = () => {
      f.readHook = undefined;
      throw new Error("injected alias cleanup read failure");
    };
    expect((await f.evaluator.runNow(false)).errored).toBe(1);
    expect(f.schedules.listAppliedEntries(override.id, "primary")).toHaveLength(
      1,
    );
    expect(f.schedules.listAppliedEntries(override.id, "other")).toHaveLength(
      1,
    );
    await f.evaluator.runNow(false);
    expect(f.otherConfig.groups[0].allowed).toEqual([
      "unrelated.test",
      "replacement.test",
    ]);
    expect(f.schedules.listAppliedEntries(override.id, "primary")).toEqual([]);
  });

  it("cleans pending Advanced Blocking entries after switching to built-in mode", async () => {
    f.create("schedule");
    f.fault = "after-write";
    await f.evaluator.runNow(false);
    const source = f.schedules.listSchedules()[0];
    f.schedules.updateSchedule(source.id, {
      ...source,
      targetType: "built-in",
    });
    await f.evaluator.runNow(false);
    expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
    expect(f.builtInActions).toEqual(["/api/allowed/add"]);
    expect(f.schedules.listPendingRecovery()).toEqual([]);
    expect(f.schedules.isApplied(source.id, "primary")).toBe(true);
  });

  it("preserves immediate deactivation for built-in schedules", async () => {
    f.create("schedule");
    f.schedules.updateSchedule(f.source.id, {
      ...f.source,
      targetType: "built-in",
    });
    await f.evaluator.runNow(false);
    const disabled = f.schedules.setScheduleEnabled(f.source.id, false);
    await f.evaluator.deactivateScheduleIfApplied(disabled);
    expect(f.builtInActions).toEqual([
      "/api/allowed/add",
      "/api/allowed/delete",
    ]);
    expect(f.writes).toBe(0);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
  });

  it.each(["immediate deactivation", "scheduled cleanup", "retry"])(
    "defers built-in mode until uncertain Advanced Blocking cleanup completes: %s",
    async (nextStep) => {
      f.create("schedule");
      f.fault = "after-write";
      await f.evaluator.runNow(false);
      f.schedules.updateSchedule(f.source.id, {
        ...f.source,
        targetType: "built-in",
      });
      f.fault = "read";
      const deferred = await f.evaluator.runNow(false);
      expect(deferred.results).toContainEqual(
        expect.objectContaining({
          action: "skipped",
          reason: "deferred-advanced-blocking-cleanup",
        }),
      );
      expect(f.builtInActions).toEqual([]);
      expect(f.schedules.listPendingRecovery()).toHaveLength(1);
      f.fault = undefined;
      if (nextStep === "retry") {
        await f.evaluator.runNow(false);
        expect(f.builtInActions).toEqual(["/api/allowed/add"]);
      }
      const disabled = f.schedules.setScheduleEnabled(f.source.id, false);
      if (nextStep === "immediate deactivation")
        await f.evaluator.deactivateScheduleIfApplied(disabled);
      else await f.evaluator.runNow(false);
      expect(f.builtInActions).toEqual(
        nextStep === "retry" ? ["/api/allowed/add", "/api/allowed/delete"] : [],
      );
      expect(f.config.groups[0].allowed).toEqual(["unrelated.test"]);
      expect(f.schedules.listTrackedTargets()).toEqual([]);
    },
  );

  it.each([true, false])(
    "honors cache flushing (%s) after no-POST recovery",
    async (flushCacheOnChange) => {
      f.create();
      const source = f.overrides.listOverrides()[0];
      f.overrides.updateOverride(source.id, { ...source, flushCacheOnChange });
      f.targets.set("primary", {
        writeTarget: "primary",
        flushNodes: ["primary"],
        skippedFlushNodes: ["other"],
      });
      f.fault = "after-write";
      await f.evaluator.runNow(false);
      expect(f.cacheFlushes).toEqual([]);
      const recovered = await f.evaluator.runNow(false);
      expect(f.writes).toBe(1);
      expect(f.cacheFlushes).toEqual(flushCacheOnChange ? ["primary"] : []);
      if (flushCacheOnChange)
        expect(recovered.results[0].cacheFlush).toEqual({
          flushedNodeIds: ["primary"],
          skippedNodeIds: ["other"],
        });
      expect(f.schedules.listPendingRecovery()).toEqual([]);
      await f.evaluator.runNow(false);
      expect(f.cacheFlushes).toHaveLength(flushCacheOnChange ? 1 : 0);
    },
  );

  it.each(["routing", "removed node", "no nodes"])(
    "reports a deferred first apply with %s",
    async (missing) => {
      f.create();
      if (missing === "routing") f.available = false;
      else {
        const source = f.overrides.listOverrides()[0];
        f.overrides.updateOverride(source.id, {
          ...source,
          nodeIds: missing === "removed node" ? ["removed"] : [],
        });
        if (missing === "no nodes") f.configuredNodeIds = [];
      }
      const result = await f.evaluator.runNow(false);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        action: "skipped",
        reason:
          missing === "routing"
            ? "no-validated-primary"
            : missing === "removed node"
              ? "node-not-configured"
              : "no-configured-nodes",
      });
      expect(result.applied).toBe(0);
      expect(f.writes).toBe(0);
    },
  );

  it("keeps an unapplied inactive schedule harmless when routing is unavailable", async () => {
    f.create("schedule");
    jest.setSystemTime(new Date("2026-09-05T23:59:00Z"));
    f.available = false;
    const result = await f.evaluator.runNow(false);
    expect(result.results).toEqual([
      expect.objectContaining({
        action: "skipped",
        reason: "already-inactive",
      }),
    ]);
    expect(f.schedules.listTrackedTargets()).toEqual([]);
    expect(f.writes).toBe(0);
  });

  it.each(["retry", "deactivate"])(
    "clears recorded empty recovery without legacy removal: %s",
    async (nextStep) => {
      f.create("schedule");
      f.config.groups[0].allowed.push("managed.test");
      f.schedules.updateSchedule(f.source.id, {
        ...f.source,
        domainEntries: [],
        domainGroupNames: ["empty"],
      });
      jest.spyOn(f.schedules, "finalizeRecovery").mockImplementationOnce(() => {
        throw new Error("injected finalization failure");
      });
      await f.evaluator.runNow(false);
      expect(f.schedules.listPendingRecovery()[0].entries).toEqual([]);
      f.schedules.updateSchedule(f.source.id, {
        ...f.source,
        targetType: "built-in",
      });
      if (nextStep === "retry") {
        await f.evaluator.runNow(false);
        expect(f.builtInActions).toEqual(["/api/allowed/add"]);
        expect(f.schedules.listPendingRecovery()).toEqual([]);
      }
      const disabled = f.schedules.setScheduleEnabled(f.source.id, false);
      await f.evaluator.deactivateScheduleIfApplied(disabled);
      expect(f.builtInActions).toEqual(
        nextStep === "retry" ? ["/api/allowed/add", "/api/allowed/delete"] : [],
      );
      expect(f.config.groups[0].allowed).toEqual([
        "unrelated.test",
        "managed.test",
      ]);
      expect(f.writes).toBe(0);
      expect(f.schedules.listTrackedTargets()).toEqual([]);
    },
  );
});
