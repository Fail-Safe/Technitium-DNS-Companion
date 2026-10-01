import { DatabaseSync } from "node:sqlite";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import { AdvancedBlockingPauseService } from "./advanced-blocking-pause.service";
import { AdvancedBlockingPauseStateService } from "./advanced-blocking-pause-state.service";
import { DomainGroupsService } from "./domain-groups.service";
import { DnsFilteringSnapshotService } from "./dns-filtering-snapshot.service";
import { ConfigSyncSchedulerService } from "./config-sync-scheduler.service";
import { TechnitiumService } from "./technitium.service";
import { DhcpSnapshotService } from "./dhcp-snapshot.service";
import {
  calculateAdvancedBlockingConfigRevision,
  parseAdvancedBlockingJsonc,
} from "./advanced-blocking-jsonc";
import type { TechnitiumNodeSummary } from "./technitium.types";

describe("Advanced Blocking pause recovery and writer integration", () => {
  let db: DatabaseSync;
  let state: AdvancedBlockingPauseStateService;
  let advanced: AdvancedBlockingService;
  let pause: AdvancedBlockingPauseService;
  let tech: TechnitiumService;
  let nodes: TechnitiumNodeSummary[];
  let raw: Record<string, string>;
  let reads: number;
  let editOnRead: number;
  let failedRead: boolean;
  let failOnRead: number;
  let failedWrite: boolean;
  let ignoredWrite: boolean;
  let posts: string[];
  const initial =
    '{\n // keep live comments\n "enableBlocking":true,"groups":[],"localEndPointGroupMap":{},"networkGroupMap":{},"futureSetting":"keep"\n}';

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    state = new AdvancedBlockingPauseStateService({ db } as never);
    state.onModuleInit();
    nodes = ["a", "b"].map((id) => ({
      id,
      name: id,
      baseUrl: "https://" + id + ".invalid",
      groupId: "default",
      isPrimary: false,
      clusterState: {
        initialized: false,
        type: "Standalone",
        topologyKnown: true,
      },
    }));
    tech = new TechnitiumService(
      nodes.map(({ id, baseUrl }) => ({ id, baseUrl, token: "test-token" })),
      new DhcpSnapshotService(),
    );
    jest
      .spyOn(tech, "listNodes")
      .mockImplementation(() => Promise.resolve(nodes));
    jest.spyOn(tech, "assertSessionConfigWriteTargets").mockResolvedValue();
    jest
      .spyOn(tech, "getNodeApps")
      .mockResolvedValue({ hasAdvancedBlocking: true } as never);
    raw = { a: initial, b: initial };
    failedRead = failedWrite = ignoredWrite = false;
    reads = 0;
    failOnRead = -1;
    editOnRead = -1;
    posts = [];
    jest.spyOn(tech, "executeAction").mockImplementation((id, request) => {
      if (request.method === "GET") {
        if (++reads === editOnRead)
          raw[id] = raw[id].replace('"keep"', '"concurrent"');
        return failedRead || reads === failOnRead
          ? { status: "error", errorMessage: "read failed" }
          : { status: "ok", response: { config: raw[id] } };
      }
      posts.push(id);
      if (failedWrite) return { status: "error", errorMessage: "write failed" };
      if (!ignoredWrite)
        raw[id] = new URLSearchParams(request.body).get("config")!;
      return { status: "ok" };
    });
    advanced = new AdvancedBlockingService(tech, undefined, undefined, state);
    pause = new AdvancedBlockingPauseService(
      state,
      advanced,
      {
        runNow: () => Promise.resolve({ errored: 0, pendingRecoveryCount: 0 }),
      } as never,
      tech,
    );
  });

  afterEach(() => {
    tech.onModuleDestroy();
    db.close();
    jest.restoreAllMocks();
  });

  async function activate(id = "a") {
    state.beginPause(
      "node:" + id,
      id,
      new Date(Date.now() + 600_000).toISOString(),
    );
    await advanced.activatePauseRoot(id, "schedule");
  }
  const rootFlag = (id: string) =>
    (parseAdvancedBlockingJsonc(raw[id]) as { enableBlocking?: boolean })
      .enableBlocking;
  const tick = () => pause["reconcile"]();

  it("suppresses remote writes on unsuccessful or missing config reads", async () => {
    state.beginPause(
      "node:a",
      "a",
      new Date(Date.now() + 600_000).toISOString(),
    );
    failedRead = true;
    await expect(advanced.activatePauseRoot("a", "schedule")).rejects.toThrow(
      "read failed",
    );
    expect(posts).toEqual([]);
    expect(raw.a).toBe(initial);
    expect(state.get("node:a")?.previousEnableBlockingPresent).toBeUndefined();
    failedRead = false;
    raw.a = "";
    await expect(advanced.activatePauseRoot("a", "schedule")).rejects.toThrow(
      "no configuration",
    );
    expect(posts).toEqual([]);
  });

  it.each([true, false, undefined])(
    "restores original %s and preserves concurrent JSONC edits",
    async (original) => {
      raw.a = initial.replace(
        '"enableBlocking":true,',
        original === undefined
          ? ""
          : '"enableBlocking":' + String(original) + ",",
      );
      await activate();
      raw.a = raw.a.replace('"keep"', '"changed"');
      await pause.resumeNow();
      expect(rootFlag("a")).toBe(original);
      expect(raw.a).toContain("// keep live comments");
      expect(parseAdvancedBlockingJsonc(raw.a)).toMatchObject({
        futureSetting: "changed",
      });
      expect(state.list()).toEqual([]);
    },
  );

  it.each(["error envelope", "unconfirmed write"])(
    "retains ownership after a restore %s",
    async (scenario) => {
      await activate();
      failedWrite = scenario === "error envelope";
      ignoredWrite = scenario === "unconfirmed write";
      const result = await pause.resumeNow();
      expect(rootFlag("a")).toBe(false);
      expect(result.targets[0].lastError).toBeDefined();
      expect(result.targets[0].status).toBe("resume-pending");
      failedWrite = ignoredWrite = false;
      await tick();
      expect(rootFlag("a")).toBe(true);
      expect(state.list()).toEqual([]);
    },
  );

  it.each([true, undefined])(
    "confirms an already-restored %s root without another POST after ambiguous confirmation",
    async (original) => {
      if (original === undefined)
        raw.a = initial.replace('"enableBlocking":true,', "");
      await activate();
      failOnRead = reads + 2;
      await pause.resumeNow();
      expect(state.get("node:a")?.status).toBe("resume-pending");
      expect(rootFlag("a")).toBe(original);
      const count = posts.length;
      raw.a = raw.a.replace('"keep"', '"operator-edit"');
      await tick();
      expect(posts).toHaveLength(count);
      expect(raw.a).toContain('"operator-edit"');
      expect(state.list()).toEqual([]);
    },
  );

  it("skips intentionally disabled roots without ownership", async () => {
    raw.a = initial.replace('"enableBlocking":true', '"enableBlocking":false');
    await pause.pause(5);
    expect(posts).toEqual(["b"]);
    expect(state.get("node:a")).toBeUndefined();
    expect(rootFlag("a")).toBe(false);
    expect(state.get("node:b")?.status).toBe("active");
  });

  it("recovers activation after write success and failed confirmation without recapturing false", async () => {
    failOnRead = 2;
    await expect(activate()).rejects.toThrow("read failed");
    expect(rootFlag("a")).toBe(false);
    expect(state.get("node:a")?.previousEnableBlockingValue).toBe(true);
    state = new AdvancedBlockingPauseStateService({ db } as never);
    state.onModuleInit();
    advanced = new AdvancedBlockingService(tech, undefined, undefined, state);
    pause = new AdvancedBlockingPauseService(
      state,
      advanced,
      {
        runNow: () => Promise.resolve({ errored: 0, pendingRecoveryCount: 0 }),
      } as never,
      tech,
    );
    await tick();
    expect(state.get("node:a")?.status).toBe("active");
    expect(state.get("node:a")?.previousEnableBlockingValue).toBe(true);
    state.requestResume("node:a");
    await tick();
    expect(rootFlag("a")).toBe(true);
    expect(state.list()).toEqual([]);
  });

  it("cancels expired new-format uncaptured intent without a config write", async () => {
    state.beginPause("node:a", "a", new Date(0).toISOString());
    await tick();
    expect(posts).toEqual([]);
    expect(state.list()).toEqual([]);
    expect(raw.a).toBe(initial);
  });

  it("quarantines unknown legacy baselines without enforcing false or recapturing", async () => {
    db.prepare(
      "INSERT INTO advanced_blocking_pauses (write_target_node_id, anchor_node_id, status, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("node:a", "a", "resume-pending", new Date(0).toISOString(), "old");
    await tick();
    expect(state.isEnforced("node:a")).toBe(false);
    expect(state.get("node:a")?.lastError).toContain("manual recovery");
    await expect(
      advanced.setRawConfig(
        "a",
        initial,
        calculateAdvancedBlockingConfigRevision(raw.a),
      ),
    ).rejects.toThrow("Legacy pause");
    await expect(advanced.activatePauseRoot("a", "schedule")).rejects.toThrow(
      "Legacy pause",
    );
    expect(posts).toEqual([]);
  });

  it("persists early resume intent and retries restore after reconstructing services", async () => {
    await activate();
    failedWrite = true;
    await pause.resumeNow();
    state = new AdvancedBlockingPauseStateService({ db } as never);
    state.onModuleInit();
    advanced = new AdvancedBlockingService(tech, undefined, undefined, state);
    pause = new AdvancedBlockingPauseService(
      state,
      advanced,
      {
        runNow: () => Promise.resolve({ errored: 0, pendingRecoveryCount: 0 }),
      } as never,
      tech,
    );
    failedWrite = false;
    await tick();
    expect(rootFlag("a")).toBe(true);
    expect(state.list()).toEqual([]);
  });

  it("marks failed active verification as unconfirmed and clears it after recovery", async () => {
    await activate();
    failedRead = true;
    await tick();
    expect(pause.getStatus()).toMatchObject({
      paused: false,
      pendingTargetCount: 1,
    });
    failedRead = false;
    await tick();
    expect(pause.getStatus()).toMatchObject({
      paused: true,
      pendingTargetCount: 0,
    });
  });

  it("reports unreadable targets without admitting them to unattended work", async () => {
    jest
      .spyOn(advanced, "verifyPauseRoot")
      .mockRejectedValueOnce(new Error("offline"));
    const result = await pause.pause(5);
    expect(result.probeErrors).toEqual([{ nodeId: "a", error: "offline" }]);
    expect(posts).toEqual(["b"]);
    expect(state.get("node:a")).toBeUndefined();
  });

  it("suppresses pause, extension, and resume writes when exact session admission fails", async () => {
    const admission = jest.spyOn(tech, "assertSessionConfigWriteTargets");
    admission.mockRejectedValue(new Error("forbidden"));
    await expect(pause.pause(5)).rejects.toThrow("forbidden");
    expect(posts).toEqual([]);
    expect(state.list()).toEqual([]);
    admission.mockResolvedValue();
    await pause.pause(5);
    const before = state.list();
    const count = posts.length;
    admission.mockRejectedValue(new Error("forbidden"));
    await expect(pause.pause(15)).rejects.toThrow("forbidden");
    await expect(pause.resumeNow()).rejects.toThrow("forbidden");
    expect(posts).toHaveLength(count);
    expect(state.list().map((row) => row.expiresAt)).toEqual(
      before.map((row) => row.expiresAt),
    );
  });

  it("rejects ordinary saves as well as pauses when topology is unknown", async () => {
    state.beginPause("cluster:default:dns.test", "a", "2030-01-01");
    state.captureOriginal("cluster:default:dns.test", "a", true, true);
    state.activate("cluster:default:dns.test", "a", true, true);
    nodes = nodes.map((node) => ({
      ...node,
      clusterState: { initialized: false, topologyKnown: false },
    }));
    await expect(
      advanced.setRawConfig(
        "a",
        initial,
        calculateAdvancedBlockingConfigRevision(raw.a),
      ),
    ).rejects.toThrow("No admitted");
    const activation = advanced.activatePauseRoot("a", "schedule");
    await expect(activation).rejects.toMatchObject({ status: 503 });
    await expect(activation).rejects.toThrow("Cluster topology is unavailable");
    expect(posts).toEqual([]);
  });

  it("suppresses a queued save after the validated Primary changes", async () => {
    nodes = nodes.map((node) => ({
      ...node,
      isPrimary: node.id === "a",
      clusterState: {
        initialized: true,
        domain: "dns.test",
        topologyKnown: true,
        type: node.id === "a" ? "Primary" : "Secondary",
      },
    }));
    let release!: () => void;
    advanced["mutationTails"].set(
      "cluster:default:dns.test",
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const save = advanced.setRawConfig(
      "a",
      initial,
      calculateAdvancedBlockingConfigRevision(raw.a),
    );
    const rejection = expect(save).rejects.toThrow("changed while waiting");
    await new Promise<void>((resolve) => setImmediate(resolve));
    nodes = nodes.map((node) => ({
      ...node,
      isPrimary: node.id === "b",
      clusterState: {
        ...node.clusterState,
        type: node.id === "b" ? "Primary" : "Secondary",
      },
    }));
    release();
    await rejection;
    expect(posts).toEqual([]);
  });

  it("keeps normal and scheduled saves behind a pause and rejects stale revisions", async () => {
    await activate();
    const snapshot = await advanced.getSnapshot("a");
    const desired = { ...snapshot.config!, enableBlocking: true };
    await advanced.setConfigWithAuth(
      "a",
      desired,
      "schedule",
      snapshot.configRevision,
    );
    expect(rootFlag("a")).toBe(false);
    const revision = calculateAdvancedBlockingConfigRevision(raw.a);
    await advanced.setRawConfig(
      "a",
      raw.a.replace('"futureSetting":"keep"', '"futureSetting":"edited"'),
      revision,
    );
    expect(rootFlag("a")).toBe(false);
    const count = posts.length;
    await expect(advanced.setConfig("a", desired, revision)).rejects.toThrow(
      "changed after",
    );
    expect(posts).toHaveLength(count);
  });

  it("does not copy a source pause into another target's captured baseline", async () => {
    const savedSource = process.env.CONFIG_SYNC_SOURCE_NODE;
    const savedTargets = process.env.CONFIG_SYNC_TARGET_NODES;
    process.env.CONFIG_SYNC_SOURCE_NODE = "a";
    process.env.CONFIG_SYNC_TARGET_NODES = "b";
    try {
      const sync = new ConfigSyncSchedulerService(
        advanced,
        { saveSnapshot: jest.fn() } as never,
        {} as never,
      );
      await activate("a");
      await sync.runNow();
      await activate("b");
      expect(state.get("node:b")?.previousEnableBlockingValue).toBe(true);
      await pause.resumeNow();
      expect(rootFlag("a")).toBe(true);
      expect(rootFlag("b")).toBe(true);
      expect(state.list()).toEqual([]);
    } finally {
      if (savedSource === undefined) delete process.env.CONFIG_SYNC_SOURCE_NODE;
      else process.env.CONFIG_SYNC_SOURCE_NODE = savedSource;
      if (savedTargets === undefined)
        delete process.env.CONFIG_SYNC_TARGET_NODES;
      else process.env.CONFIG_SYNC_TARGET_NODES = savedTargets;
    }
  });

  it("reports activation failures that occur before ownership is written", async () => {
    jest
      .spyOn(advanced, "activatePauseRoot")
      .mockRejectedValueOnce(new Error("Primary changed"));
    const result = await pause.pause(5);
    expect(result.probeErrors).toEqual([
      { nodeId: "a", error: "Primary changed" },
    ]);
    expect(posts).toEqual(["b"]);
    expect(state.get("node:a")).toBeUndefined();
  });

  function domainFixture() {
    raw.a = JSON.stringify({
      enableBlocking: true,
      futureSetting: "keep",
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [
        {
          name: "default",
          blocked: ["old.test"],
          allowed: [],
          blockedRegex: ["ads"],
          allowedRegex: [],
        },
      ],
    });
    const domains = new DomainGroupsService({ db } as never, advanced, tech, {
      saveSnapshot: jest.fn().mockResolvedValue({}),
    } as never);
    domains.onModuleInit();
    return domains;
  }

  it("preserves pause ownership through Domain Groups import/apply, optimizer, comments, and History restore", async () => {
    const domains = domainFixture();
    await activate();
    const imported = await domains.importUnifiedConfig({
      nodeId: "a",
      domainsMode: "merge",
      domainGroupsMode: "merge",
      data: { groups: { default: { blockDomains: ["imported.test"] } } },
    });
    expect(imported.domains.errors).toEqual([]);
    expect(rootFlag("a")).toBe(false);
    const dg = domains.createDomainGroup({ name: "managed" });
    domains.addEntry(dg.id, { matchType: "exact", value: "managed.test" });
    domains.addBinding(dg.id, {
      advancedBlockingGroupName: "default",
      action: "block",
    });
    await domains.applyMaterialization({ nodeIds: ["a"] });
    expect(rootFlag("a")).toBe(false);
    await advanced.applyGroupRuleOptimization("a", "default", {
      targetList: "blockedRegex",
      regexPattern: "ads",
      proposedDomainEntry: "ads.test",
      takeSnapshot: false,
    });
    expect(rootFlag("a")).toBe(false);
    const live = await advanced.getRawConfig("a", false);
    await advanced.mutateDomainComment("a", {
      action: "add",
      configRevision: live.configRevision,
      groupName: "default",
      field: "blocked",
      value: "imported.test",
      occurrence: 0,
      text: "pause-safe comment",
      style: "line",
    });
    expect(raw.a).toContain("pause-safe comment");
    const snapshot = await advanced.getSnapshot("a");
    const history = new DnsFilteringSnapshotService({} as never, advanced);
    jest.spyOn(history, "getSnapshot").mockResolvedValue({
      metadata: { method: "advanced-blocking" },
      advancedBlocking: {
        config: { ...snapshot.config!, enableBlocking: true },
      },
    } as never);
    await history.restoreSnapshot("a", "saved");
    expect(rootFlag("a")).toBe(false);
    await pause.resumeNow();
    expect(rootFlag("a")).toBe(true);
    const restored = parseAdvancedBlockingJsonc(raw.a) as {
      groups: Array<{ blocked: string[] }>;
    };
    expect(restored.groups[0].blocked).toEqual(
      expect.arrayContaining(["imported.test", "managed.test", "ads.test"]),
    );
  });

  it.each(["import", "optimizer"])(
    "suppresses stale %s writes after a concurrent config edit",
    async (writer) => {
      const domains = domainFixture();
      await activate();
      const count = posts.length;
      editOnRead = reads + 2;
      if (writer === "import") {
        const result = await domains.importUnifiedConfig({
          nodeId: "a",
          domainsMode: "merge",
          domainGroupsMode: "merge",
          data: { groups: { default: { blockDomains: ["imported.test"] } } },
        });
        expect(result.domains.errors[0].error).toContain("changed after");
      } else {
        await expect(
          advanced.applyGroupRuleOptimization("a", "default", {
            targetList: "blockedRegex",
            regexPattern: "ads",
            proposedDomainEntry: "ads.test",
            takeSnapshot: false,
          }),
        ).rejects.toThrow("changed after");
      }
      expect(posts).toHaveLength(count);
      expect(parseAdvancedBlockingJsonc(raw.a)).toMatchObject({
        futureSetting: "concurrent",
        enableBlocking: false,
      });
    },
  );
});
