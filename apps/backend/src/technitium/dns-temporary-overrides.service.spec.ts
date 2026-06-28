import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { BadRequestException } from "@nestjs/common";
import { CompanionDbService } from "./companion-db.service";
import { DnsSchedulesService } from "./dns-schedules.service";
import { DnsTemporaryOverridesService } from "./dns-temporary-overrides.service";
import type { DnsTemporaryOverrideDraft } from "./dns-temporary-overrides.types";

function makeDraft(
  overrides: Partial<DnsTemporaryOverrideDraft> = {},
): DnsTemporaryOverrideDraft {
  return {
    name: "Temporary YouTube block",
    enabled: true,
    advancedBlockingGroupNames: ["Florence"],
    action: "block",
    domainEntries: ["youtube.com"],
    domainGroupNames: ["YouTube"],
    nodeIds: [],
    flushCacheOnChange: true,
    notifyEmails: [],
    notifyDebounceSeconds: 300,
    expiresAt: null,
    ...overrides,
  };
}

describe("DnsTemporaryOverridesService", () => {
  let companionDb: CompanionDbService;
  let schedulesService: DnsSchedulesService;
  let service: DnsTemporaryOverridesService;
  let tempDir: string;
  let previousDbPath: string | undefined;

  beforeEach(() => {
    previousDbPath = process.env.COMPANION_DB_PATH;
    tempDir = mkdtempSync(join(tmpdir(), "dns-temporary-overrides-"));
    process.env.COMPANION_DB_PATH = join(tempDir, "companion.sqlite");

    companionDb = new CompanionDbService();
    companionDb.onModuleInit();

    schedulesService = new DnsSchedulesService(companionDb);
    schedulesService.onModuleInit();

    service = new DnsTemporaryOverridesService(companionDb);
    service.onModuleInit();
  });

  afterEach(() => {
    companionDb.onModuleDestroy();
    rmSync(tempDir, { recursive: true, force: true });

    if (previousDbPath === undefined) delete process.env.COMPANION_DB_PATH;
    else process.env.COMPANION_DB_PATH = previousDbPath;
  });

  it("persists temporary override notification settings", () => {
    const created = service.createOverride(
      makeDraft({
        notifyEmails: ["parent@example.com"],
        notifyDebounceSeconds: 600,
        notifyMessage: "Temporary override {overrideName} matched {domain}.",
        notifyMessageOnly: true,
        notifySubjectTemplate: "[Override] {overrideName}: {domain}",
      }),
    );

    const reloaded = service.getOverride(created.id);

    expect(reloaded.notifyEmails).toEqual(["parent@example.com"]);
    expect(reloaded.notifyDebounceSeconds).toBe(600);
    expect(reloaded.notifyMessage).toBe(
      "Temporary override {overrideName} matched {domain}.",
    );
    expect(reloaded.notifyMessageOnly).toBe(true);
    expect(reloaded.notifySubjectTemplate).toBe(
      "[Override] {overrideName}: {domain}",
    );
  });

  it("rejects deleting an override while it still has applied state", () => {
    const created = service.createOverride(makeDraft());
    companionDb.db
      ?.prepare(
        `INSERT INTO dns_schedule_state (schedule_id, node_id, applied_at)
         VALUES (?, ?, ?)`,
      )
      .run(created.id, "node-a", "2026-06-24T00:00:00.000Z");

    expect(() => service.deleteOverride(created.id)).toThrow(
      BadRequestException,
    );
  });
});
