import { DatabaseSync } from "node:sqlite";
import { AdvancedBlockingService } from "../../src/technitium/advanced-blocking.service";
import { DnsSchedulesEvaluatorService } from "../../src/technitium/dns-schedules-evaluator.service";
import { DnsSchedulesService } from "../../src/technitium/dns-schedules.service";
import { DnsTemporaryOverridesService } from "../../src/technitium/dns-temporary-overrides.service";
import type { DnsSchedule } from "../../src/technitium/dns-schedules.types";

/** Offline fixture: real storage/evaluator/writer, with DNS replaced at the transport. */
export class DnsScheduleRecoveryFixture {
  db!: DatabaseSync;
  schedules!: DnsSchedulesService;
  overrides!: DnsTemporaryOverridesService;
  evaluator!: DnsSchedulesEvaluatorService;
  source!: DnsSchedule;
  config = {
    enableBlocking: true,
    blockListUrlUpdateIntervalHours: 24,
    groups: [
      { name: "test", allowed: ["unrelated.test"], blocked: [] as string[] },
    ],
  };
  writes = 0;
  builtInActions: string[] = [];
  cacheFlushes: string[] = [];
  configuredNodeIds = ["primary", "other"];
  reads = 0;
  fault: "before-write" | "after-write" | "read" | undefined;
  available = true;
  readHook?: () => void | Promise<void>;
  writeHook?: () => void;
  groupEntries: string[] = [];
  targets = new Map([
    [
      "primary",
      { writeTarget: "primary", flushNodes: [], skippedFlushNodes: [] },
    ],
    ["other", { writeTarget: "other", flushNodes: [], skippedFlushNodes: [] }],
  ]);
  otherConfig = structuredClone(this.config);

  constructor(readonly dbPath: string) {
    this.open();
  }

  open(): void {
    this.db = new DatabaseSync(this.dbPath);
    const owner = { db: this.db };
    this.schedules = new DnsSchedulesService(owner as never);
    this.schedules.onModuleInit();
    this.overrides = new DnsTemporaryOverridesService(owner as never);
    this.overrides.onModuleInit();
    const transport = {
      getScheduleTokenStatus: () => ({ valid: true }),
      listNodes: () =>
        Promise.resolve(
          this.configuredNodeIds.map((id) => ({
            id,
            baseUrl: `https://${id}.invalid`,
          })),
        ),
      resolveClusterWriteTargets: () =>
        Promise.resolve({
          perCandidate: this.available ? this.targets : new Map(),
        }),
      executeAction: async (
        nodeId: string,
        request: { url: string; body?: string },
      ) => {
        if (request.url === "/api/cache/delete") {
          this.cacheFlushes.push(nodeId);
          return { status: "ok" };
        }
        if (/^\/api\/(allowed|blocked)\/(add|delete)$/.test(request.url)) {
          this.builtInActions.push(request.url);
          return { status: "ok" };
        }
        if (request.url === "/api/apps/config/get") {
          this.reads++;
          await this.readHook?.();
          if (this.fault === "read") throw new Error("injected read failure");
          return {
            status: "ok",
            response: {
              config: JSON.stringify(
                nodeId === "other" ? this.otherConfig : this.config,
              ),
            },
          };
        }
        if (request.url !== "/api/apps/config/set")
          throw new Error(`Unexpected API: ${request.url}`);
        this.writes++;
        if (this.fault === "before-write") {
          this.fault = undefined;
          throw new Error("injected before commit");
        }
        const updated = JSON.parse(
          new URLSearchParams(request.body).get("config")!,
        ) as typeof this.config;
        if (nodeId === "other") this.otherConfig = updated;
        else this.config = updated;
        this.writeHook?.();
        if (this.fault === "after-write") {
          this.fault = undefined;
          throw new Error("injected response loss after commit");
        }
        return { status: "ok" };
      },
    };
    this.evaluator = new DnsSchedulesEvaluatorService(
      this.schedules,
      new AdvancedBlockingService(transport as never),
      transport as never,
      { getExactEntriesByGroupNames: () => this.groupEntries } as never,
      { listRules: () => [] } as never,
      undefined,
      this.overrides,
    );
  }

  create(kind: "schedule" | "override" = "override"): void {
    const draft = {
      name: "Recovery test",
      enabled: true,
      action: "allow" as const,
      advancedBlockingGroupNames: ["test"],
      domainEntries: ["managed.test"],
      domainGroupNames: [],
      nodeIds: ["primary"],
      flushCacheOnChange: false,
      notifyEmails: [],
      notifyDebounceSeconds: 300,
    };
    this.source =
      kind === "schedule"
        ? this.schedules.createSchedule({
            ...draft,
            targetType: "advanced-blocking",
            daysOfWeek: [],
            startTime: "00:00",
            endTime: "23:59",
            timezone: "UTC",
          })
        : this.evaluator.temporaryOverrideToSchedule(
            this.overrides.createOverride({
              ...draft,
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            }),
          );
  }

  expire(): void {
    this.db
      .prepare("UPDATE dns_temporary_overrides SET expires_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 60_000).toISOString(), this.source.id);
    this.db
      .prepare("UPDATE dns_schedules SET enabled = 0 WHERE id = ?")
      .run(this.source.id);
  }

  reopen(): void {
    this.db.close();
    this.open();
  }
  close(): void {
    this.db.close();
  }
}
