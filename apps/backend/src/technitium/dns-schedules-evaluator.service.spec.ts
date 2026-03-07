import { DnsSchedulesEvaluatorService } from "./dns-schedules-evaluator.service";
import { DnsSchedule } from "./dns-schedules.types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSchedule(overrides: Partial<DnsSchedule> = {}): DnsSchedule {
  return {
    id: "test-id",
    name: "Test Schedule",
    enabled: true,
    targetType: "advanced-blocking",
    advancedBlockingGroupNames: ["social"],
    action: "block",
    domainEntries: ["example.com"],
    domainGroupNames: [],
    daysOfWeek: [],
    startTime: "09:00",
    endTime: "17:00",
    timezone: "UTC",
    nodeIds: [],
    flushCacheOnChange: false,
    notifyEmails: [],
    notifyDebounceSeconds: 300,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a Date at the given UTC wall-clock time. Month is 1-based. */
function utcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

// ── Spec ─────────────────────────────────────────────────────────────────────

describe("DnsSchedulesEvaluatorService — isWindowActive", () => {
  let service: DnsSchedulesEvaluatorService;

  beforeEach(() => {
    // isWindowActive is pure Intl-based logic — none of the injected services
    // are called by this method. Pass empty objects cast with `as never` to
    // satisfy the constructor signature without pulling in the real service types.
    service = new DnsSchedulesEvaluatorService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  // ── Same-day window ─────────────────────────────────────────────────────────

  describe("same-day window (09:00 – 17:00 UTC)", () => {
    const s = () =>
      makeSchedule({ startTime: "09:00", endTime: "17:00", timezone: "UTC" });

    it("returns true inside the window", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 12, 0))).toBe(true);
    });

    it("returns true at the exact start boundary (inclusive)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 9, 0))).toBe(true);
    });

    it("returns false at the exact end boundary (exclusive)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 17, 0))).toBe(false);
    });

    it("returns false one minute before the window", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 8, 59))).toBe(false);
    });

    it("returns false one minute after the window", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 17, 1))).toBe(false);
    });
  });

  // ── Overnight window ────────────────────────────────────────────────────────

  describe("overnight window (22:00 – 06:00 UTC)", () => {
    const s = () =>
      makeSchedule({ startTime: "22:00", endTime: "06:00", timezone: "UTC" });

    it("returns true at the exact start boundary (22:00)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 22, 0))).toBe(true);
    });

    it("returns true just after start (pre-midnight)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 23, 30))).toBe(true);
    });

    it("returns true just before end (post-midnight)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 16, 5, 59))).toBe(true);
    });

    it("returns false at the exact end boundary (06:00 is exclusive)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 16, 6, 0))).toBe(false);
    });

    it("returns false in the inactive gap between 06:00 and 22:00", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 12, 0))).toBe(false);
    });

    it("returns false one minute after end (06:01)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 16, 6, 1))).toBe(false);
    });
  });

  // ── Day-of-week filtering ───────────────────────────────────────────────────

  describe("day-of-week filtering (09:00 – 17:00 UTC)", () => {
    // 2024-01-15 is a Monday (DOW = 1)
    const monday = utcDate(2024, 1, 15, 12, 0);

    it("returns true when daysOfWeek is empty (every day)", () => {
      const s = makeSchedule({ startTime: "09:00", endTime: "17:00", daysOfWeek: [] });
      expect(service.isWindowActive(s, monday)).toBe(true);
    });

    it("returns true when current day is in the list", () => {
      const s = makeSchedule({ startTime: "09:00", endTime: "17:00", daysOfWeek: [1] }); // Mon
      expect(service.isWindowActive(s, monday)).toBe(true);
    });

    it("returns false when current day is not in the list", () => {
      const s = makeSchedule({ startTime: "09:00", endTime: "17:00", daysOfWeek: [0, 6] }); // Sat+Sun
      expect(service.isWindowActive(s, monday)).toBe(false);
    });

    it("returns false even inside the time window when day does not match", () => {
      const s = makeSchedule({ startTime: "09:00", endTime: "17:00", daysOfWeek: [2, 3, 4] }); // Tue–Thu
      expect(service.isWindowActive(s, monday)).toBe(false);
    });
  });

  // ── Overnight + day-of-week ─────────────────────────────────────────────────

  describe("overnight window + day-of-week (22:00 – 06:00 UTC, daysOfWeek=[1]=Mon)", () => {
    // Window starts on Monday 22:00 and ends Tuesday 06:00.
    // daysOfWeek=[1] means "only activate windows that start on Monday."
    const s = makeSchedule({
      startTime: "22:00",
      endTime: "06:00",
      daysOfWeek: [1],
      timezone: "UTC",
    });

    it("active at Monday 23:00 — after start, activeDow=Mon matches", () => {
      expect(service.isWindowActive(s, utcDate(2024, 1, 15, 23, 0))).toBe(true);
    });

    it("active at Tuesday 02:00 — before end, activeDow=yesterday=Mon matches", () => {
      // The window started Monday, so activeDow is still Monday (1).
      expect(service.isWindowActive(s, utcDate(2024, 1, 16, 2, 0))).toBe(true);
    });

    it("inactive at Tuesday 23:00 — activeDow=Tue=2, does not match [1]", () => {
      expect(service.isWindowActive(s, utcDate(2024, 1, 16, 23, 0))).toBe(false);
    });

    it("inactive at Wednesday 02:00 — activeDow=Tue=2, does not match [1]", () => {
      expect(service.isWindowActive(s, utcDate(2024, 1, 17, 2, 0))).toBe(false);
    });

    it("also handles the Sun → Mon overnight boundary correctly (DOW wraps)", () => {
      // Window starts Sunday (0) 22:00 → Monday 06:00. daysOfWeek=[0].
      const sunToMon = makeSchedule({
        startTime: "22:00",
        endTime: "06:00",
        daysOfWeek: [0],
        timezone: "UTC",
      });
      // Monday 02:00: before end, activeDow = yesterday = Sunday (0) ✓
      expect(service.isWindowActive(sunToMon, utcDate(2024, 1, 15, 2, 0))).toBe(true);
      // Sunday 22:00: after start, activeDow = Sunday (0) ✓
      expect(service.isWindowActive(sunToMon, utcDate(2024, 1, 14, 22, 0))).toBe(true);
    });
  });

  // ── Timezone handling ───────────────────────────────────────────────────────

  describe("timezone handling", () => {
    // In January, America/New_York is EST = UTC−5.

    it("window active at UTC 14:00 for a 09:00–17:00 ET schedule (14:00 UTC = 09:00 ET)", () => {
      const s = makeSchedule({
        startTime: "09:00",
        endTime: "17:00",
        timezone: "America/New_York",
        daysOfWeek: [],
      });
      expect(service.isWindowActive(s, utcDate(2024, 1, 15, 14, 0))).toBe(true);
    });

    it("window inactive at UTC 13:00 for the same schedule (13:00 UTC = 08:00 ET)", () => {
      const s = makeSchedule({
        startTime: "09:00",
        endTime: "17:00",
        timezone: "America/New_York",
        daysOfWeek: [],
      });
      expect(service.isWindowActive(s, utcDate(2024, 1, 15, 13, 0))).toBe(false);
    });

    it("falls back to UTC on an invalid timezone without throwing", () => {
      const s = makeSchedule({
        startTime: "09:00",
        endTime: "17:00",
        timezone: "Not/AReal_Zone",
        daysOfWeek: [],
      });
      // Should not throw
      expect(() => service.isWindowActive(s, utcDate(2024, 1, 15, 12, 0))).not.toThrow();
      // 12:00 UTC falls inside 09:00–17:00 UTC (fallback behavior)
      expect(service.isWindowActive(s, utcDate(2024, 1, 15, 12, 0))).toBe(true);
    });

    it("UTC timezone works correctly as a plain string", () => {
      const s = makeSchedule({
        startTime: "10:00",
        endTime: "11:00",
        timezone: "UTC",
        daysOfWeek: [],
      });
      expect(service.isWindowActive(s, utcDate(2024, 1, 15, 10, 30))).toBe(true);
      expect(service.isWindowActive(s, utcDate(2024, 1, 15, 9, 59))).toBe(false);
    });
  });
});
