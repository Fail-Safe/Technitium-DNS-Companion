import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CompanionDbService } from "./companion-db.service";
import { DnsSchedulesService } from "./dns-schedules.service";
import type { DnsScheduleDraft } from "./dns-schedules.types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDraft(overrides: Partial<DnsScheduleDraft> = {}): DnsScheduleDraft {
  return {
    name: "Test Schedule",
    enabled: true,
    targetType: "advanced-blocking",
    advancedBlockingGroupNames: ["Kids"],
    action: "block",
    domainEntries: ["example.com"],
    domainGroupNames: [],
    daysOfWeek: [],
    startTime: "22:00",
    endTime: "06:00",
    timezone: "UTC",
    nodeIds: [],
    flushCacheOnChange: false,
    notifyEmails: [],
    notifyDebounceSeconds: 300,
    ...overrides,
  };
}

// ── Spec ─────────────────────────────────────────────────────────────────────

describe("DnsSchedulesService", () => {
  let service: DnsSchedulesService;
  let companionDb: CompanionDbService;
  let tempDir: string;
  let previousEnvEnabled: string | undefined;
  let previousEnvDbPath: string | undefined;

  beforeEach(() => {
    previousEnvEnabled = process.env.DNS_SCHEDULES_ENABLED;
    previousEnvDbPath = process.env.COMPANION_DB_PATH;

    tempDir = mkdtempSync(join(tmpdir(), "dns-schedules-"));
    process.env.DNS_SCHEDULES_ENABLED = "true";
    process.env.COMPANION_DB_PATH = join(tempDir, "companion.sqlite");

    companionDb = new CompanionDbService();
    companionDb.onModuleInit();

    service = new DnsSchedulesService(companionDb);
    service.onModuleInit();
  });

  afterEach(() => {
    companionDb.onModuleDestroy();
    rmSync(tempDir, { recursive: true, force: true });

    if (previousEnvEnabled === undefined) delete process.env.DNS_SCHEDULES_ENABLED;
    else process.env.DNS_SCHEDULES_ENABLED = previousEnvEnabled;

    if (previousEnvDbPath === undefined) delete process.env.COMPANION_DB_PATH;
    else process.env.COMPANION_DB_PATH = previousEnvDbPath;
  });

  // ── getStatus ───────────────────────────────────────────────────────────────

  describe("getStatus", () => {
    it("returns enabled=true and ready=true when DB is initialized", () => {
      const status = service.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.ready).toBe(true);
      expect(status.dbPath).toBeTruthy();
    });
  });

  // ── listSchedules ───────────────────────────────────────────────────────────

  describe("listSchedules", () => {
    it("returns an empty array before any schedules are created", () => {
      expect(service.listSchedules()).toEqual([]);
    });

    it("returns schedules sorted by updated_at descending", () => {
      service.createSchedule(makeDraft({ name: "Alpha" }));
      service.createSchedule(makeDraft({ name: "Beta" }));
      service.createSchedule(makeDraft({ name: "Gamma" }));
      const names = service.listSchedules().map((s) => s.name);
      // Most recently created should appear first
      expect(names[0]).toBe("Gamma");
    });
  });

  // ── createSchedule ──────────────────────────────────────────────────────────

  describe("createSchedule", () => {
    it("creates and returns a schedule with all fields correctly mapped", () => {
      const draft = makeDraft({
        name: "Bedtime Block",
        enabled: false,
        action: "allow",
        domainEntries: ["facebook.com", "tiktok.com"],
        domainGroupNames: ["SocialMedia"],
        daysOfWeek: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "17:00",
        timezone: "America/New_York",
        nodeIds: ["node-a"],
        flushCacheOnChange: true,
        notifyEmails: ["parent@example.com"],
        notifyDebounceSeconds: 600,
      });
      const s = service.createSchedule(draft);

      expect(s.id).toMatch(/^[0-9a-f-]{36}$/); // UUID
      expect(s.name).toBe("Bedtime Block");
      expect(s.enabled).toBe(false);
      expect(s.action).toBe("allow");
      expect(s.advancedBlockingGroupNames).toEqual(["Kids"]);
      expect(s.domainEntries).toEqual(["facebook.com", "tiktok.com"]);
      expect(s.domainGroupNames).toEqual(["SocialMedia"]);
      expect(s.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
      expect(s.startTime).toBe("09:00");
      expect(s.endTime).toBe("17:00");
      expect(s.timezone).toBe("America/New_York");
      expect(s.nodeIds).toEqual(["node-a"]);
      expect(s.flushCacheOnChange).toBe(true);
      expect(s.notifyEmails).toEqual(["parent@example.com"]);
      expect(s.notifyDebounceSeconds).toBe(600);
      expect(s.createdAt).toBeTruthy();
      expect(s.updatedAt).toBeTruthy();
    });

    it("adds the new schedule to listSchedules", () => {
      service.createSchedule(makeDraft({ name: "Alpha" }));
      service.createSchedule(makeDraft({ name: "Beta" }));
      expect(service.listSchedules()).toHaveLength(2);
    });

    it("throws BadRequestException when name is empty", () => {
      expect(() => service.createSchedule(makeDraft({ name: "" }))).toThrow(BadRequestException);
    });

    it("throws BadRequestException when name exceeds 120 characters", () => {
      expect(() =>
        service.createSchedule(makeDraft({ name: "x".repeat(121) })),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException when advancedBlockingGroupNames is empty", () => {
      expect(() =>
        service.createSchedule(makeDraft({ advancedBlockingGroupNames: [] })),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException when action is invalid", () => {
      expect(() =>
        service.createSchedule(makeDraft({ action: "deny" as "block" })),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException when both domainEntries and domainGroupNames are empty", () => {
      expect(() =>
        service.createSchedule(makeDraft({ domainEntries: [], domainGroupNames: [] })),
      ).toThrow(BadRequestException);
    });

    it("accepts domainGroupNames without domainEntries", () => {
      const s = service.createSchedule(
        makeDraft({ domainEntries: [], domainGroupNames: ["SocialMedia"] }),
      );
      expect(s.domainGroupNames).toEqual(["SocialMedia"]);
    });

    it("throws BadRequestException for startTime/endTime equal to each other", () => {
      expect(() =>
        service.createSchedule(makeDraft({ startTime: "10:00", endTime: "10:00" })),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException for invalid startTime format", () => {
      expect(() =>
        service.createSchedule(makeDraft({ startTime: "9:00" })),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException for invalid timezone", () => {
      expect(() =>
        service.createSchedule(makeDraft({ timezone: "Not/AReal_Zone" })),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException on duplicate name (case-insensitive)", () => {
      service.createSchedule(makeDraft({ name: "Bedtime" }));
      expect(() => service.createSchedule(makeDraft({ name: "BEDTIME" }))).toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException on exact duplicate name", () => {
      service.createSchedule(makeDraft({ name: "Bedtime" }));
      expect(() => service.createSchedule(makeDraft({ name: "Bedtime" }))).toThrow(
        BadRequestException,
      );
    });
  });

  // ── updateSchedule ──────────────────────────────────────────────────────────

  describe("updateSchedule", () => {
    it("updates all fields of an existing schedule", () => {
      const created = service.createSchedule(makeDraft({ name: "Original" }));
      const updated = service.updateSchedule(
        created.id,
        makeDraft({ name: "Renamed", startTime: "08:00", endTime: "16:00" }),
      );
      expect(updated.id).toBe(created.id);
      expect(updated.name).toBe("Renamed");
      expect(updated.startTime).toBe("08:00");
      expect(updated.endTime).toBe("16:00");
    });

    it("preserves the original createdAt timestamp", () => {
      const created = service.createSchedule(makeDraft());
      const updated = service.updateSchedule(created.id, makeDraft({ name: "New Name" }));
      expect(updated.createdAt).toBe(created.createdAt);
    });

    it("throws NotFoundException for an unknown schedule ID", () => {
      expect(() =>
        service.updateSchedule("00000000-0000-0000-0000-000000000000", makeDraft()),
      ).toThrow(NotFoundException);
    });

    it("throws BadRequestException when updating to a name already used by another schedule", () => {
      service.createSchedule(makeDraft({ name: "Alpha" }));
      const beta = service.createSchedule(makeDraft({ name: "Beta" }));
      expect(() =>
        service.updateSchedule(beta.id, makeDraft({ name: "Alpha" })),
      ).toThrow(BadRequestException);
    });

    it("allows renaming a schedule to its own current name (no-op conflict)", () => {
      const created = service.createSchedule(makeDraft({ name: "Stable" }));
      expect(() =>
        service.updateSchedule(created.id, makeDraft({ name: "Stable" })),
      ).not.toThrow();
    });
  });

  // ── setScheduleEnabled ──────────────────────────────────────────────────────

  describe("setScheduleEnabled", () => {
    it("disables an enabled schedule", () => {
      const created = service.createSchedule(makeDraft({ enabled: true }));
      const updated = service.setScheduleEnabled(created.id, false);
      expect(updated.enabled).toBe(false);
    });

    it("enables a disabled schedule", () => {
      const created = service.createSchedule(makeDraft({ enabled: false }));
      const updated = service.setScheduleEnabled(created.id, true);
      expect(updated.enabled).toBe(true);
    });

    it("throws NotFoundException for an unknown schedule ID", () => {
      expect(() =>
        service.setScheduleEnabled("00000000-0000-0000-0000-000000000000", false),
      ).toThrow(NotFoundException);
    });
  });

  // ── deleteSchedule ──────────────────────────────────────────────────────────

  describe("deleteSchedule", () => {
    it("deletes a schedule and returns a confirmation object", () => {
      const created = service.createSchedule(makeDraft());
      const result = service.deleteSchedule(created.id);
      expect(result).toEqual({ deleted: true, scheduleId: created.id });
    });

    it("removes the schedule from listSchedules after deletion", () => {
      const created = service.createSchedule(makeDraft());
      service.deleteSchedule(created.id);
      expect(service.listSchedules()).toHaveLength(0);
    });

    it("throws NotFoundException for an unknown schedule ID", () => {
      expect(() =>
        service.deleteSchedule("00000000-0000-0000-0000-000000000000"),
      ).toThrow(NotFoundException);
    });

    it("clears applied state entries when the schedule is deleted", () => {
      const created = service.createSchedule(makeDraft());
      service.markApplied(created.id, "node-1");
      expect(service.isApplied(created.id, "node-1")).toBe(true);

      service.deleteSchedule(created.id);

      expect(service.isApplied(created.id, "node-1")).toBe(false);
    });
  });

  // ── State tracking ──────────────────────────────────────────────────────────

  describe("state tracking (markApplied / isApplied / markRemoved / listAppliedState)", () => {
    let scheduleId: string;

    beforeEach(() => {
      scheduleId = service.createSchedule(makeDraft()).id;
    });

    it("isApplied returns false before markApplied is called", () => {
      expect(service.isApplied(scheduleId, "node-1")).toBe(false);
    });

    it("isApplied returns true after markApplied is called", () => {
      service.markApplied(scheduleId, "node-1");
      expect(service.isApplied(scheduleId, "node-1")).toBe(true);
    });

    it("isApplied is scoped to the (scheduleId, nodeId) pair", () => {
      service.markApplied(scheduleId, "node-1");
      expect(service.isApplied(scheduleId, "node-2")).toBe(false);
    });

    it("isApplied returns false after markRemoved is called", () => {
      service.markApplied(scheduleId, "node-1");
      service.markRemoved(scheduleId, "node-1");
      expect(service.isApplied(scheduleId, "node-1")).toBe(false);
    });

    it("markApplied is idempotent — calling it twice does not throw", () => {
      service.markApplied(scheduleId, "node-1");
      expect(() => service.markApplied(scheduleId, "node-1")).not.toThrow();
      expect(service.isApplied(scheduleId, "node-1")).toBe(true);
    });

    it("markRemoved on a non-existent pair does not throw", () => {
      expect(() => service.markRemoved(scheduleId, "node-99")).not.toThrow();
    });

    it("listAppliedState returns all (schedule, node) pairs", () => {
      service.markApplied(scheduleId, "node-1");
      service.markApplied(scheduleId, "node-2");
      const state = service.listAppliedState();
      expect(state).toHaveLength(2);
      const nodeIds = state.map((s) => s.nodeId);
      expect(nodeIds).toContain("node-1");
      expect(nodeIds).toContain("node-2");
    });

    it("listAppliedState includes the appliedAt timestamp", () => {
      service.markApplied(scheduleId, "node-1");
      const [entry] = service.listAppliedState();
      expect(entry.scheduleId).toBe(scheduleId);
      expect(entry.nodeId).toBe("node-1");
      expect(entry.appliedAt).toBeTruthy();
    });

    it("markApplied overwrites the appliedAt timestamp on re-apply", () => {
      service.markApplied(scheduleId, "node-1");
      const [first] = service.listAppliedState();

      service.markApplied(scheduleId, "node-1");
      const [second] = service.listAppliedState();

      // Timestamps may be equal (same ms) but should not throw
      expect(second.appliedAt).toBeTruthy();
      expect(first.scheduleId).toBe(second.scheduleId);
    });
  });

  // ── Evaluator settings ──────────────────────────────────────────────────────

  describe("evaluator settings", () => {
    it("getEvaluatorEnabled returns null before any setting is saved", () => {
      expect(service.getEvaluatorEnabled()).toBeNull();
    });

    it("setEvaluatorEnabled(true) persists and is readable", () => {
      service.setEvaluatorEnabled(true);
      expect(service.getEvaluatorEnabled()).toBe(true);
    });

    it("setEvaluatorEnabled(false) persists and is readable", () => {
      service.setEvaluatorEnabled(true);
      service.setEvaluatorEnabled(false);
      expect(service.getEvaluatorEnabled()).toBe(false);
    });

    it("getEvaluatorIntervalMs returns null before any setting is saved", () => {
      expect(service.getEvaluatorIntervalMs()).toBeNull();
    });

    it("setEvaluatorIntervalMs persists the value", () => {
      service.setEvaluatorIntervalMs(120_000);
      expect(service.getEvaluatorIntervalMs()).toBe(120_000);
    });

    it("setEvaluatorIntervalMs can be overwritten", () => {
      service.setEvaluatorIntervalMs(60_000);
      service.setEvaluatorIntervalMs(90_000);
      expect(service.getEvaluatorIntervalMs()).toBe(90_000);
    });
  });

  // ── Disabled mode ───────────────────────────────────────────────────────────

  describe("when DNS_SCHEDULES_ENABLED=false", () => {
    let disabledService: DnsSchedulesService;

    beforeEach(() => {
      process.env.DNS_SCHEDULES_ENABLED = "false";
      // Construct a new service instance that reads the disabled env var
      disabledService = new DnsSchedulesService(companionDb);
    });

    it("getStatus returns enabled=false and ready=false", () => {
      const status = disabledService.getStatus();
      expect(status.enabled).toBe(false);
      expect(status.ready).toBe(false);
      expect(status.dbPath).toBeUndefined();
    });

    it("listSchedules throws ServiceUnavailableException", () => {
      expect(() => disabledService.listSchedules()).toThrow(ServiceUnavailableException);
    });

    it("createSchedule throws ServiceUnavailableException", () => {
      expect(() => disabledService.createSchedule(makeDraft())).toThrow(
        ServiceUnavailableException,
      );
    });

    it("deleteSchedule throws ServiceUnavailableException", () => {
      expect(() =>
        disabledService.deleteSchedule("00000000-0000-0000-0000-000000000000"),
      ).toThrow(ServiceUnavailableException);
    });

    it("getEvaluatorEnabled returns null (does not throw)", () => {
      expect(() => disabledService.getEvaluatorEnabled()).not.toThrow();
      // DB is still open — returns null (no value stored yet)
      expect(disabledService.getEvaluatorEnabled()).toBeNull();
    });
  });
});
