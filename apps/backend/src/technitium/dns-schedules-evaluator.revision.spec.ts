import { DatabaseSync } from "node:sqlite";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import { DnsSchedulesEvaluatorService } from "./dns-schedules-evaluator.service";
import { DnsSchedulesService } from "./dns-schedules.service";
import { DnsTemporaryOverridesService } from "./dns-temporary-overrides.service";

describe("schedule configuration revisions", () => {
  let db: DatabaseSync;
  let schedules: DnsSchedulesService;
  let overrides: DnsTemporaryOverridesService;
  let evaluator: DnsSchedulesEvaluatorService;
  let config: {
    enableBlocking: boolean;
    blockListUrlUpdateIntervalHours: number;
    groups: { name: string; allowed: string[]; blocked: string[] }[];
  };
  let reads: number;
  let writes: number;
  let editOnRead: number;
  let sourceId: string;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-05T12:00:00Z"));
    db = new DatabaseSync(":memory:");
    const owner = { db };
    schedules = new DnsSchedulesService(owner as never);
    schedules.onModuleInit();
    overrides = new DnsTemporaryOverridesService(owner as never);
    overrides.onModuleInit();
    reads = writes = 0;
    editOnRead = -1;
    config = {
      enableBlocking: true,
      blockListUrlUpdateIntervalHours: 24,
      groups: [{ name: "test", allowed: [], blocked: [] }],
    };
    const transport = {
      listNodes: () =>
        Promise.resolve([{ id: "primary", baseUrl: "https://dns.invalid" }]),
      resolveClusterWriteTargets: () =>
        Promise.resolve({
          perCandidate: new Map([
            [
              "primary",
              { writeTarget: "primary", flushNodes: [], skippedFlushNodes: [] },
            ],
          ]),
        }),
      executeAction: (
        nodeId: string,
        request: { url: string; body?: string },
      ) => {
        expect(nodeId).toBe("primary");
        if (request.url === "/api/apps/config/get") {
          if (++reads === editOnRead)
            config.blockListUrlUpdateIntervalHours = 48;
          return Promise.resolve({
            status: "ok",
            response: { config: JSON.stringify(config) },
          });
        }
        expect(request.url).toBe("/api/apps/config/set");
        writes++;
        config = JSON.parse(
          new URLSearchParams(request.body).get("config")!,
        ) as typeof config;
        return Promise.resolve({ status: "ok" });
      },
    };
    const blocking = new AdvancedBlockingService(transport as never);
    evaluator = new DnsSchedulesEvaluatorService(
      schedules,
      blocking,
      transport as never,
      {} as never,
      { listRules: () => [] } as never,
      undefined,
      overrides,
    );
    sourceId = overrides.createOverride({
      name: "Test",
      enabled: true,
      action: "allow",
      advancedBlockingGroupNames: ["test"],
      domainEntries: ["example.test"],
      domainGroupNames: [],
      nodeIds: ["primary"],
      flushCacheOnChange: false,
      notifyEmails: [],
      notifyDebounceSeconds: 300,
      expiresAt: "2026-09-05T12:05:00Z",
    }).id;
  });

  afterEach(() => {
    db.close();
    jest.useRealTimers();
  });

  it("rejects stale apply, then retries from fresh configuration", async () => {
    editOnRead = 2;
    expect((await evaluator.runNow(false)).errored).toBe(1);
    expect(writes).toBe(0);
    expect(schedules.listAppliedState()).toEqual([]);
    expect(config.blockListUrlUpdateIntervalHours).toBe(48);
    expect((await evaluator.runNow(false)).errored).toBe(0);
    expect(config.groups[0].allowed).toEqual(["example.test"]);
    expect(config.blockListUrlUpdateIntervalHours).toBe(48);
    expect(schedules.listAppliedEntries(sourceId, "primary")).toHaveLength(1);
  });

  it("retains removal tracking on conflict and cleans up on retry", async () => {
    await evaluator.runNow(false);
    editOnRead = reads + 2;
    jest.setSystemTime(new Date("2026-09-05T12:06:00Z"));
    expect((await evaluator.runNow(false)).errored).toBe(1);
    expect(writes).toBe(1);
    expect(schedules.listAppliedState()).toHaveLength(1);
    expect(schedules.listAppliedEntries(sourceId, "primary")).toHaveLength(1);
    expect((await evaluator.runNow(false)).errored).toBe(0);
    expect(config.groups[0].allowed).toEqual([]);
    expect(config.blockListUrlUpdateIntervalHours).toBe(48);
    expect(schedules.listAppliedState()).toEqual([]);
    expect(schedules.listAppliedEntries(sourceId, "primary")).toEqual([]);
  });

  it("accepts matching revisions and avoids unchanged writes", async () => {
    expect((await evaluator.runNow(false)).errored).toBe(0);
    expect(writes).toBe(1);
    await evaluator.runNow(false);
    expect(writes).toBe(1);
    jest.setSystemTime(new Date("2026-09-05T12:06:00Z"));
    await evaluator.runNow(false);
    expect(writes).toBe(2);
    expect(config.groups[0].allowed).toEqual([]);
  });
});
