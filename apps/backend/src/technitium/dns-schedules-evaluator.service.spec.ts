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
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 12, 0))).toBe(
        true,
      );
    });

    it("returns true at the exact start boundary (inclusive)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 9, 0))).toBe(
        true,
      );
    });

    it("returns false at the exact end boundary (exclusive)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 17, 0))).toBe(
        false,
      );
    });

    it("returns false one minute before the window", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 8, 59))).toBe(
        false,
      );
    });

    it("returns false one minute after the window", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 17, 1))).toBe(
        false,
      );
    });
  });

  // ── Overnight window ────────────────────────────────────────────────────────

  describe("overnight window (22:00 – 06:00 UTC)", () => {
    const s = () =>
      makeSchedule({ startTime: "22:00", endTime: "06:00", timezone: "UTC" });

    it("returns true at the exact start boundary (22:00)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 22, 0))).toBe(
        true,
      );
    });

    it("returns true just after start (pre-midnight)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 23, 30))).toBe(
        true,
      );
    });

    it("returns true just before end (post-midnight)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 16, 5, 59))).toBe(
        true,
      );
    });

    it("returns false at the exact end boundary (06:00 is exclusive)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 16, 6, 0))).toBe(
        false,
      );
    });

    it("returns false in the inactive gap between 06:00 and 22:00", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 15, 12, 0))).toBe(
        false,
      );
    });

    it("returns false one minute after end (06:01)", () => {
      expect(service.isWindowActive(s(), utcDate(2024, 1, 16, 6, 1))).toBe(
        false,
      );
    });
  });

  // ── Day-of-week filtering ───────────────────────────────────────────────────

  describe("day-of-week filtering (09:00 – 17:00 UTC)", () => {
    // 2024-01-15 is a Monday (DOW = 1)
    const monday = utcDate(2024, 1, 15, 12, 0);

    it("returns true when daysOfWeek is empty (every day)", () => {
      const s = makeSchedule({
        startTime: "09:00",
        endTime: "17:00",
        daysOfWeek: [],
      });
      expect(service.isWindowActive(s, monday)).toBe(true);
    });

    it("returns true when current day is in the list", () => {
      const s = makeSchedule({
        startTime: "09:00",
        endTime: "17:00",
        daysOfWeek: [1],
      }); // Mon
      expect(service.isWindowActive(s, monday)).toBe(true);
    });

    it("returns false when current day is not in the list", () => {
      const s = makeSchedule({
        startTime: "09:00",
        endTime: "17:00",
        daysOfWeek: [0, 6],
      }); // Sat+Sun
      expect(service.isWindowActive(s, monday)).toBe(false);
    });

    it("returns false even inside the time window when day does not match", () => {
      const s = makeSchedule({
        startTime: "09:00",
        endTime: "17:00",
        daysOfWeek: [2, 3, 4],
      }); // Tue–Thu
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
      expect(service.isWindowActive(s, utcDate(2024, 1, 16, 23, 0))).toBe(
        false,
      );
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
      expect(service.isWindowActive(sunToMon, utcDate(2024, 1, 15, 2, 0))).toBe(
        true,
      );
      // Sunday 22:00: after start, activeDow = Sunday (0) ✓
      expect(
        service.isWindowActive(sunToMon, utcDate(2024, 1, 14, 22, 0)),
      ).toBe(true);
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
      expect(service.isWindowActive(s, utcDate(2024, 1, 15, 13, 0))).toBe(
        false,
      );
    });

    it("falls back to UTC on an invalid timezone without throwing", () => {
      const s = makeSchedule({
        startTime: "09:00",
        endTime: "17:00",
        timezone: "Not/AReal_Zone",
        daysOfWeek: [],
      });
      // Should not throw
      expect(() =>
        service.isWindowActive(s, utcDate(2024, 1, 15, 12, 0)),
      ).not.toThrow();
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
      expect(service.isWindowActive(s, utcDate(2024, 1, 15, 10, 30))).toBe(
        true,
      );
      expect(service.isWindowActive(s, utcDate(2024, 1, 15, 9, 59))).toBe(
        false,
      );
    });
  });
});

// ── Snapshot-error handling (apply + remove symmetry) ───────────────────────
// Regression: when `getSnapshotWithAuth` returned `{ error, config: undefined }`
// (e.g. transient ECONNRESET), remove used to silently no-op and the caller
// would still call `markRemoved` — orphaning entries live in Technitium. Apply
// already threw in this case; these tests pin both paths to the same behavior.

describe("DnsSchedulesEvaluatorService — snapshot-error handling", () => {
  function makeService(
    getSnapshotWithAuth: jest.Mock,
    options: {
      trackedEntries?: Array<{
        advancedBlockingGroupName: string;
        action: "block" | "allow";
        domain: string;
      }>;
    } = {},
  ) {
    const setConfigWithAuth = jest.fn();
    const listAppliedEntries = jest.fn().mockReturnValue(
      (options.trackedEntries ?? []).map((e) => ({
        scheduleId: "test-id",
        nodeId: "nodeA",
        ...e,
        appliedAt: "2024-01-15T00:00:00Z",
      })),
    );
    const setAppliedEntries = jest.fn();
    const clearAppliedEntries = jest.fn();
    const service = new DnsSchedulesEvaluatorService(
      {
        listAppliedEntries,
        setAppliedEntries,
        clearAppliedEntries,
      } as never,
      { getSnapshotWithAuth, setConfigWithAuth } as never,
      {} as never,
      { getExactEntriesByGroupNames: () => [] } as never,
      {} as never,
    );
    return {
      service,
      setConfigWithAuth,
      listAppliedEntries,
      setAppliedEntries,
      clearAppliedEntries,
    };
  }

  const failingSnapshot = {
    nodeId: "nodeA",
    baseUrl: "https://nodeA.test",
    fetchedAt: "2024-01-15T00:00:00Z",
    metrics: {},
    error: "read ECONNRESET",
  };

  it("remove throws when snapshot has an error (no silent markRemoved)", async () => {
    const getSnapshotWithAuth = jest.fn().mockResolvedValue(failingSnapshot);
    // Tracking populated so the refactored code actually consults the
    // snapshot (empty tracking takes an early-return no-op path).
    const { service, setConfigWithAuth } = makeService(getSnapshotWithAuth, {
      trackedEntries: [
        {
          advancedBlockingGroupName: "social",
          action: "block",
          domain: "example.com",
        },
      ],
    });

    await expect(
      // Private method under test — the evaluator's own try/catch in
      // evaluateScheduleForNode will observe the throw and skip markRemoved.
      (
        service as unknown as {
          removeAdvancedBlockingScheduleFromNode: (
            s: DnsSchedule,
            n: string,
          ) => Promise<void>;
        }
      ).removeAdvancedBlockingScheduleFromNode(makeSchedule(), "nodeA"),
    ).rejects.toThrow(/nodeA.*ECONNRESET/);

    expect(setConfigWithAuth).not.toHaveBeenCalled();
  });

  it("apply throws with the underlying error surfaced in the message", async () => {
    const getSnapshotWithAuth = jest.fn().mockResolvedValue(failingSnapshot);
    const { service, setConfigWithAuth } = makeService(getSnapshotWithAuth);

    await expect(
      (
        service as unknown as {
          applyAdvancedBlockingScheduleToNode: (
            s: DnsSchedule,
            n: string,
          ) => Promise<boolean>;
        }
      ).applyAdvancedBlockingScheduleToNode(makeSchedule(), "nodeA"),
    ).rejects.toThrow(/nodeA.*ECONNRESET/);

    expect(setConfigWithAuth).not.toHaveBeenCalled();
  });

  it("remove proceeds normally when snapshot is healthy with a non-empty config", async () => {
    const getSnapshotWithAuth = jest.fn().mockResolvedValue({
      nodeId: "nodeA",
      baseUrl: "https://nodeA.test",
      fetchedAt: "2024-01-15T00:00:00Z",
      metrics: {},
      config: {
        enableBlocking: true,
        localEndPointGroupMap: {},
        networkGroupMap: {},
        groups: [
          {
            name: "social",
            blockingAddresses: [],
            allowed: [],
            blocked: ["example.com", "keep.me"],
            allowListUrls: [],
            blockListUrls: [],
            allowedRegex: [],
            blockedRegex: [],
            regexAllowListUrls: [],
            regexBlockListUrls: [],
            adblockListUrls: [],
          },
        ],
      },
    });
    // Tracking records that this schedule previously wrote example.com to
    // social.blocked. Remove flow now reads from tracking, not from the
    // schedule's current resolved set.
    const { service, setConfigWithAuth } = makeService(getSnapshotWithAuth, {
      trackedEntries: [
        {
          advancedBlockingGroupName: "social",
          action: "block",
          domain: "example.com",
        },
      ],
    });

    await (
      service as unknown as {
        removeAdvancedBlockingScheduleFromNode: (
          s: DnsSchedule,
          n: string,
        ) => Promise<void>;
      }
    ).removeAdvancedBlockingScheduleFromNode(
      makeSchedule({
        advancedBlockingGroupNames: ["social"],
        domainEntries: ["example.com"],
      }),
      "nodeA",
    );

    expect(setConfigWithAuth).toHaveBeenCalledTimes(1);
    const [, nextConfig] = setConfigWithAuth.mock.calls[0];
    expect(nextConfig.groups[0].blocked).toEqual(["keep.me"]);
  });
});

describe("DnsSchedulesEvaluatorService — cluster state aliases", () => {
  function makeGroup(
    name: string,
    blocked: string[] = [],
    allowed: string[] = [],
  ) {
    return {
      name,
      blockingAddresses: [],
      allowed,
      blocked,
      allowListUrls: [],
      blockListUrls: [],
      allowedRegex: [],
      blockedRegex: [],
      regexAllowListUrls: [],
      regexBlockListUrls: [],
      adblockListUrls: [],
    };
  }

  function makeService(options: {
    appliedNodeIds: string[];
    trackedEntries?: Array<{
      nodeId: string;
      advancedBlockingGroupName: string;
      action: "block" | "allow";
      domain: string;
    }>;
  }) {
    const markApplied = jest.fn();
    const markRemoved = jest.fn();
    const clearAppliedEntries = jest.fn();
    const setAppliedEntries = jest.fn();
    const listAppliedEntries = jest.fn((scheduleId: string, nodeId: string) =>
      (options.trackedEntries ?? [])
        .filter((e) => e.nodeId === nodeId)
        .map((e) => ({
          scheduleId,
          nodeId,
          advancedBlockingGroupName: e.advancedBlockingGroupName,
          action: e.action,
          domain: e.domain,
          appliedAt: "2026-06-24T01:00:00.000Z",
        })),
    );
    const isApplied = jest.fn((_scheduleId: string, nodeId: string) =>
      options.appliedNodeIds.includes(nodeId),
    );
    const setConfigWithAuth = jest.fn();
    const getSnapshotWithAuth = jest.fn().mockResolvedValue({
      nodeId: "nodeA",
      baseUrl: "https://node-a.test",
      fetchedAt: "2026-06-25T00:15:00.000Z",
      metrics: {},
      config: {
        enableBlocking: true,
        localEndPointGroupMap: {},
        networkGroupMap: {},
        groups: [makeGroup("GroupA", ["youtube.com", "keep.me"], [])],
      },
    });
    const service = new DnsSchedulesEvaluatorService(
      {
        isApplied,
        markApplied,
        markRemoved,
        listAppliedEntries,
        setAppliedEntries,
        clearAppliedEntries,
      } as never,
      { getSnapshotWithAuth, setConfigWithAuth } as never,
      {} as never,
      { getExactEntriesByGroupNames: () => ["youtube.com"] } as never,
      {} as never,
    );
    return {
      service,
      markApplied,
      markRemoved,
      clearAppliedEntries,
      setAppliedEntries,
      setConfigWithAuth,
    };
  }

  it("inactive window removes once from the write target and clears legacy state aliases", async () => {
    const { service, markRemoved, clearAppliedEntries, setConfigWithAuth } =
      makeService({
        appliedNodeIds: ["nodeA", "nodeB"],
        trackedEntries: [
          {
            nodeId: "nodeA",
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "youtube.com",
          },
        ],
      });

    const result = await (
      service as unknown as {
        evaluateScheduleForNode: (
          s: DnsSchedule,
          n: string,
          flushNodeIds: string[],
          stateNodeIds: string[],
          now: Date,
          dryRun: boolean,
        ) => Promise<{ action: string }>;
      }
    ).evaluateScheduleForNode(
      makeSchedule({
        name: "Nighttime Block",
        advancedBlockingGroupNames: ["GroupA"],
        domainEntries: [],
        domainGroupNames: ["YouTube"],
        startTime: "21:00",
        endTime: "08:00",
        timezone: "America/New_York",
      }),
      "nodeA",
      ["nodeA", "nodeB", "nodeC"],
      ["nodeA", "nodeB"],
      new Date("2026-06-25T00:15:00.000Z"),
      false,
    );

    expect(result.action).toBe("removed");
    expect(setConfigWithAuth).toHaveBeenCalledTimes(1);
    const [, nextConfig] = setConfigWithAuth.mock.calls[0];
    expect(nextConfig.groups[0].blocked).toEqual(["keep.me"]);
    expect(markRemoved).toHaveBeenCalledWith("test-id", "nodeA");
    expect(markRemoved).toHaveBeenCalledWith("test-id", "nodeB");
    expect(clearAppliedEntries).toHaveBeenCalledWith("test-id", "nodeA");
    expect(clearAppliedEntries).toHaveBeenCalledWith("test-id", "nodeB");
  });

  it("active window migrates legacy state aliases onto the canonical write target", async () => {
    const { service, markApplied, markRemoved, setAppliedEntries } =
      makeService({
        appliedNodeIds: ["nodeB"],
        trackedEntries: [
          {
            nodeId: "nodeB",
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "youtube.com",
          },
        ],
      });

    const result = await (
      service as unknown as {
        evaluateScheduleForNode: (
          s: DnsSchedule,
          n: string,
          flushNodeIds: string[],
          stateNodeIds: string[],
          now: Date,
          dryRun: boolean,
        ) => Promise<{ action: string; reason?: string }>;
      }
    ).evaluateScheduleForNode(
      makeSchedule({
        name: "Nighttime Block",
        advancedBlockingGroupNames: ["GroupA"],
        domainEntries: [],
        domainGroupNames: ["YouTube"],
        startTime: "21:00",
        endTime: "08:00",
        timezone: "America/New_York",
      }),
      "nodeA",
      ["nodeA", "nodeB", "nodeC"],
      ["nodeA", "nodeB"],
      new Date("2026-06-25T01:15:00.000Z"),
      false,
    );

    expect(result).toMatchObject({
      action: "skipped",
      reason: "already-applied",
    });
    expect(markApplied).toHaveBeenCalledWith("test-id", "nodeA");
    expect(markRemoved).toHaveBeenCalledWith("test-id", "nodeB");
    expect(setAppliedEntries).toHaveBeenCalledWith("test-id", "nodeA", [
      {
        advancedBlockingGroupName: "GroupA",
        action: "block",
        domain: "youtube.com",
      },
    ]);
  });

  it("does not remove entries still required by another active source", async () => {
    const { service, clearAppliedEntries, setConfigWithAuth } = makeService({
      appliedNodeIds: ["nodeA"],
      trackedEntries: [
        {
          nodeId: "nodeA",
          advancedBlockingGroupName: "GroupA",
          action: "block",
          domain: "youtube.com",
        },
      ],
    });

    await (
      service as unknown as {
        removeAdvancedBlockingScheduleFromNode: (
          s: DnsSchedule,
          n: string,
          protectedTupleKeys: Set<string>,
        ) => Promise<void>;
      }
    ).removeAdvancedBlockingScheduleFromNode(
      makeSchedule({
        advancedBlockingGroupNames: ["GroupA"],
        action: "block",
        domainEntries: ["youtube.com"],
        domainGroupNames: [],
      }),
      "nodeA",
      new Set(["GroupA\0block\0youtube.com"]),
    );

    expect(setConfigWithAuth).not.toHaveBeenCalled();
    expect(clearAppliedEntries).toHaveBeenCalledWith("test-id", "nodeA");
  });
});

// ── Phase B: drift detection counter + alert behavior ─────────────────────
// When an applied schedule's re-apply observes `changed=true`, that's drift
// (another process mutated the AB config between ticks). These tests pin the
// counter increment/reset logic and the one-email-per-episode debounce.

describe("DnsSchedulesEvaluatorService — drift detection", () => {
  interface DriftInternals {
    driftCounters: Map<string, number>;
    driftAlertedEpisodes: Set<string>;
    driftAlertThreshold: number;
    driftAlertRecipients: string[];
    intervalMs: number;
    logger: { warn: jest.Mock; log: jest.Mock; debug: jest.Mock };
    logAlertsEmailService: { sendScheduleDriftAlert: jest.Mock };
    domainGroupsService: { getExactEntriesByGroupNames: jest.Mock };
    recordDriftTick: (s: DnsSchedule, nodeId: string) => void;
    resetDriftState: (scheduleId: string, nodeId: string) => void;
  }

  function makeService(
    options: { threshold?: number; recipients?: string[] } = {},
  ): {
    service: DnsSchedulesEvaluatorService;
    internal: DriftInternals;
    emailMock: jest.Mock;
  } {
    const emailMock = jest.fn().mockResolvedValue({ messageId: "ok" });
    const service = new DnsSchedulesEvaluatorService(
      {} as never,
      {} as never,
      {} as never,
      { getExactEntriesByGroupNames: () => ["example.com"] } as never,
      {} as never,
      { sendScheduleDriftAlert: emailMock } as never,
    );
    const internal = service as unknown as DriftInternals;
    if (options.threshold !== undefined) {
      internal.driftAlertThreshold = options.threshold;
    }
    internal.driftAlertRecipients = options.recipients ?? ["admin@example.com"];
    internal.logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
    return { service, internal, emailMock };
  }

  it("increments the counter on each drift tick", () => {
    const { internal } = makeService({ threshold: 3 });
    const schedule = makeSchedule({ id: "s1" });
    internal.recordDriftTick(schedule, "nodeA");
    internal.recordDriftTick(schedule, "nodeA");
    expect(internal.driftCounters.get("s1:nodeA")).toBe(2);
  });

  it("logs WARN and sends one email when counter crosses the threshold", () => {
    const { internal, emailMock } = makeService({ threshold: 3 });
    const schedule = makeSchedule({
      id: "s1",
      name: "Nighttime Block",
    });

    internal.recordDriftTick(schedule, "nodeA"); // 1 - silent
    internal.recordDriftTick(schedule, "nodeA"); // 2 - silent
    expect(internal.logger.warn).not.toHaveBeenCalled();
    expect(emailMock).not.toHaveBeenCalled();

    internal.recordDriftTick(schedule, "nodeA"); // 3 - threshold crossed
    expect(internal.logger.warn).toHaveBeenCalledTimes(1);
    expect(internal.logger.warn.mock.calls[0][0]).toContain(
      'Configuration drift detected for schedule "Nighttime Block"',
    );
    expect(emailMock).toHaveBeenCalledTimes(1);
    expect(emailMock.mock.calls[0][0]).toMatchObject({
      scheduleName: "Nighttime Block",
      nodeId: "nodeA",
      consecutiveTicks: 3,
      recipients: ["admin@example.com"],
    });
  });

  it("does not re-send email within the same drift episode (debounce)", () => {
    const { internal, emailMock } = makeService({ threshold: 2 });
    const schedule = makeSchedule({ id: "s1" });

    internal.recordDriftTick(schedule, "nodeA");
    internal.recordDriftTick(schedule, "nodeA"); // threshold
    internal.recordDriftTick(schedule, "nodeA"); // still in episode
    internal.recordDriftTick(schedule, "nodeA"); // still in episode

    // Counter climbs but only the first threshold-crossing fired email/warn.
    expect(internal.driftCounters.get("s1:nodeA")).toBe(4);
    expect(internal.logger.warn).toHaveBeenCalledTimes(1);
    expect(emailMock).toHaveBeenCalledTimes(1);
  });

  it("skips the email entirely when DNS_SCHEDULES_DRIFT_ALERT_RECIPIENTS is empty", () => {
    const { internal, emailMock } = makeService({
      threshold: 2,
      recipients: [],
    });
    const schedule = makeSchedule({ id: "s1" });

    internal.recordDriftTick(schedule, "nodeA");
    internal.recordDriftTick(schedule, "nodeA"); // threshold

    expect(internal.logger.warn).toHaveBeenCalledTimes(1); // WARN still fires
    expect(emailMock).not.toHaveBeenCalled(); // but no email
  });

  it("never uses schedule.notifyEmails as drift recipients (notification safety)", () => {
    const { internal, emailMock } = makeService({
      threshold: 2,
      recipients: ["admin@example.com"],
    });
    const schedule = makeSchedule({
      id: "s1",
      notifyEmails: ["schedule-owner@example.com"],
    });

    internal.recordDriftTick(schedule, "nodeA");
    internal.recordDriftTick(schedule, "nodeA"); // threshold

    expect(emailMock).toHaveBeenCalledTimes(1);
    const call = emailMock.mock.calls[0][0] as { recipients: string[] };
    expect(call.recipients).toEqual(["admin@example.com"]);
    expect(call.recipients).not.toContain("schedule-owner@example.com");
  });

  it("resetDriftState clears both counter and alerted-episode flag", () => {
    const { internal, emailMock } = makeService({ threshold: 2 });
    const schedule = makeSchedule({ id: "s1" });

    internal.recordDriftTick(schedule, "nodeA");
    internal.recordDriftTick(schedule, "nodeA"); // threshold crossed, alerted
    expect(emailMock).toHaveBeenCalledTimes(1);

    internal.resetDriftState("s1", "nodeA");
    expect(internal.driftCounters.has("s1:nodeA")).toBe(false);
    expect(internal.driftAlertedEpisodes.has("s1:nodeA")).toBe(false);

    // New episode can alert again.
    internal.recordDriftTick(schedule, "nodeA");
    internal.recordDriftTick(schedule, "nodeA"); // threshold crossed again
    expect(emailMock).toHaveBeenCalledTimes(2);
  });

  it("isolates counters per (schedule, node) pair", () => {
    const { internal, emailMock } = makeService({ threshold: 2 });
    const schedule = makeSchedule({ id: "s1" });

    internal.recordDriftTick(schedule, "nodeA"); // 1 on nodeA
    internal.recordDriftTick(schedule, "nodeB"); // 1 on nodeB (separate counter)
    expect(internal.driftCounters.get("s1:nodeA")).toBe(1);
    expect(internal.driftCounters.get("s1:nodeB")).toBe(1);
    expect(emailMock).not.toHaveBeenCalled();

    internal.recordDriftTick(schedule, "nodeA"); // crosses threshold on nodeA only
    expect(emailMock).toHaveBeenCalledTimes(1);
    expect(emailMock.mock.calls[0][0].nodeId).toBe("nodeA");
  });
});

// ── Orphan prevention (per-entry tracking + apply/remove diff) ───────────────
//
// The four trigger vectors that historically orphaned entries when a schedule
// was edited mid-window:
//   1. domainGroupNames swap (e.g. Video → Music)
//   2. advancedBlockingGroupNames swap (target GroupA → GroupB)
//   3. action flip (block ↔ allow)
//   4. domainEntries edit (manual list change)
//
// In every case the OLD behavior re-resolved the schedule's *current*
// definition on remove, so anything written under the previous definition
// became unreachable garbage. These tests pin the NEW behavior: the apply
// diff cleans the old tuples first, then writes the new ones.

describe("DnsSchedulesEvaluatorService — orphan prevention", () => {
  type Tracked = {
    advancedBlockingGroupName: string;
    action: "block" | "allow";
    domain: string;
  };

  function makeGroup(
    name: string,
    blocked: string[] = [],
    allowed: string[] = [],
  ) {
    return {
      name,
      blockingAddresses: [],
      allowed,
      blocked,
      allowListUrls: [],
      blockListUrls: [],
      allowedRegex: [],
      blockedRegex: [],
      regexAllowListUrls: [],
      regexBlockListUrls: [],
      adblockListUrls: [],
    };
  }

  function makeService(options: {
    groups: ReturnType<typeof makeGroup>[];
    trackedEntries?: Tracked[];
    domainGroupsLookup?: (names: string[]) => string[];
  }) {
    const setConfigWithAuth = jest.fn();
    const getSnapshotWithAuth = jest.fn().mockResolvedValue({
      nodeId: "nodeA",
      baseUrl: "https://nodeA.test",
      fetchedAt: "2024-01-15T00:00:00Z",
      metrics: {},
      config: {
        enableBlocking: true,
        localEndPointGroupMap: {},
        networkGroupMap: {},
        groups: options.groups,
      },
    });
    const listAppliedEntries = jest.fn().mockReturnValue(
      (options.trackedEntries ?? []).map((e) => ({
        scheduleId: "test-id",
        nodeId: "nodeA",
        ...e,
        appliedAt: "2024-01-15T00:00:00Z",
      })),
    );
    const setAppliedEntries = jest.fn();
    const clearAppliedEntries = jest.fn();
    const service = new DnsSchedulesEvaluatorService(
      {
        listAppliedEntries,
        setAppliedEntries,
        clearAppliedEntries,
      } as never,
      { getSnapshotWithAuth, setConfigWithAuth } as never,
      {} as never,
      {
        getExactEntriesByGroupNames: options.domainGroupsLookup ?? (() => []),
      } as never,
      {} as never,
    );
    return {
      service,
      setConfigWithAuth,
      listAppliedEntries,
      setAppliedEntries,
      clearAppliedEntries,
    };
  }

  async function apply(
    service: DnsSchedulesEvaluatorService,
    schedule: DnsSchedule,
  ): Promise<boolean> {
    return (
      service as unknown as {
        applyAdvancedBlockingScheduleToNode: (
          s: DnsSchedule,
          n: string,
        ) => Promise<boolean>;
      }
    ).applyAdvancedBlockingScheduleToNode(schedule, "nodeA");
  }

  async function remove(
    service: DnsSchedulesEvaluatorService,
    schedule: DnsSchedule,
  ): Promise<void> {
    return (
      service as unknown as {
        removeAdvancedBlockingScheduleFromNode: (
          s: DnsSchedule,
          n: string,
        ) => Promise<void>;
      }
    ).removeAdvancedBlockingScheduleFromNode(schedule, "nodeA");
  }

  describe("vector 1: domainGroupNames swap (Video → Music)", () => {
    it("removes old DG entries and adds new DG entries in one apply pass", async () => {
      // Tracking records the schedule previously wrote Video entries to
      // GroupA.blocked. Now the schedule's domainGroupNames is ["Music"];
      // the DG lookup resolves to music entries.
      const { service, setConfigWithAuth, setAppliedEntries } = makeService({
        groups: [
          makeGroup(
            "GroupA",
            ["youtube.com", "googlevideo.com", "manually-added.com"],
            [],
          ),
        ],
        trackedEntries: [
          {
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "youtube.com",
          },
          {
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "googlevideo.com",
          },
        ],
        domainGroupsLookup: (names) =>
          names.includes("Music") ? ["music.example", "media.example"] : [],
      });

      const updatedSchedule = makeSchedule({
        advancedBlockingGroupNames: ["GroupA"],
        action: "block",
        domainGroupNames: ["Music"],
        domainEntries: [],
      });
      const changed = await apply(service, updatedSchedule);

      expect(changed).toBe(true);
      expect(setConfigWithAuth).toHaveBeenCalledTimes(1);
      const [, nextConfig] = setConfigWithAuth.mock.calls[0];
      const groupA = nextConfig.groups.find(
        (g: { name: string }) => g.name === "GroupA",
      );
      // YouTube/googlevideo orphans gone, manually-added.com preserved,
      // Music entries added.
      expect(groupA.blocked.sort()).toEqual(
        ["manually-added.com", "media.example", "music.example"].sort(),
      );
      // Tracking now reflects the new desired state.
      expect(setAppliedEntries).toHaveBeenCalledTimes(1);
      const [, , newTracking] = setAppliedEntries.mock.calls[0];
      expect(newTracking).toEqual(
        expect.arrayContaining([
          {
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "music.example",
          },
          {
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "media.example",
          },
        ]),
      );
      expect(newTracking).toHaveLength(2);
    });
  });

  describe("vector 2: advancedBlockingGroupNames swap (GroupA → GroupB)", () => {
    it("removes entries from old AB group and adds to new AB group", async () => {
      const { service, setConfigWithAuth } = makeService({
        groups: [
          makeGroup("GroupA", ["youtube.com", "keep.me"], []),
          makeGroup("GroupB", ["pre-existing.com"], []),
        ],
        trackedEntries: [
          {
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "youtube.com",
          },
        ],
      });

      const updatedSchedule = makeSchedule({
        advancedBlockingGroupNames: ["GroupB"],
        action: "block",
        domainEntries: ["youtube.com"],
        domainGroupNames: [],
      });
      await apply(service, updatedSchedule);

      const [, nextConfig] = setConfigWithAuth.mock.calls[0];
      const groupA = nextConfig.groups.find(
        (g: { name: string }) => g.name === "GroupA",
      );
      const groupB = nextConfig.groups.find(
        (g: { name: string }) => g.name === "GroupB",
      );
      // Orphan stripped from GroupA, fresh write to GroupB preserving its
      // pre-existing entry.
      expect(groupA.blocked).toEqual(["keep.me"]);
      expect(groupB.blocked.sort()).toEqual([
        "pre-existing.com",
        "youtube.com",
      ]);
    });
  });

  describe("vector 3: action flip (block → allow)", () => {
    it("removes from blocked list and adds to allowed list of same group", async () => {
      const { service, setConfigWithAuth } = makeService({
        groups: [makeGroup("GroupA", ["youtube.com"], [])],
        trackedEntries: [
          {
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "youtube.com",
          },
        ],
      });

      const updatedSchedule = makeSchedule({
        advancedBlockingGroupNames: ["GroupA"],
        action: "allow",
        domainEntries: ["youtube.com"],
        domainGroupNames: [],
      });
      await apply(service, updatedSchedule);

      const [, nextConfig] = setConfigWithAuth.mock.calls[0];
      const groupA = nextConfig.groups[0];
      expect(groupA.blocked).toEqual([]);
      expect(groupA.allowed).toEqual(["youtube.com"]);
    });
  });

  describe("vector 4: domainEntries edit", () => {
    it("removes dropped entries and keeps still-desired ones", async () => {
      const { service, setConfigWithAuth } = makeService({
        groups: [
          makeGroup(
            "GroupA",
            ["youtube.com", "tiktok.com", "untouched.com"],
            [],
          ),
        ],
        trackedEntries: [
          {
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "youtube.com",
          },
          {
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "tiktok.com",
          },
        ],
      });

      const updatedSchedule = makeSchedule({
        advancedBlockingGroupNames: ["GroupA"],
        action: "block",
        domainEntries: ["youtube.com"], // dropped tiktok.com
        domainGroupNames: [],
      });
      await apply(service, updatedSchedule);

      const [, nextConfig] = setConfigWithAuth.mock.calls[0];
      const groupA = nextConfig.groups[0];
      // tiktok.com (no longer desired) removed; youtube.com (still desired)
      // and untouched.com (never ours) both preserved.
      expect(groupA.blocked.sort()).toEqual(["untouched.com", "youtube.com"]);
    });
  });

  describe("multi-schedule overlap (live-state self-heal)", () => {
    it("re-adds desired tuples missing from live state, even when prev tracking matches desired", async () => {
      // Scenario from production incident: two schedules target the same
      // advanced-blocking group with the same domain group. Both have tracking
      // populated with the same tuples. The duplicate schedule's remove pass
      // stripped those entries from the shared group. Now the original
      // schedule's tick runs:
      //   - prev (tracking) = desired tuples  ← still believes applied
      //   - desired         = desired tuples  ← schedule unchanged
      //   - live state      = []              ← other schedule removed them
      // Pre-fix: toAdd = desired \ prev = ∅ → nothing re-added → domains
      //         remain allowed during the active window.
      // Post-fix: toAdd = desired \ live = YouTube tuples → re-added.
      const { service, setConfigWithAuth, setAppliedEntries } = makeService({
        groups: [makeGroup("SharedGroup", [], [])], // emptied by other schedule
        trackedEntries: [
          {
            advancedBlockingGroupName: "SharedGroup",
            action: "block",
            domain: "youtube.com",
          },
          {
            advancedBlockingGroupName: "SharedGroup",
            action: "block",
            domain: "googlevideo.com",
          },
        ],
      });

      const schedule = makeSchedule({
        advancedBlockingGroupNames: ["SharedGroup"],
        action: "block",
        domainEntries: ["youtube.com", "googlevideo.com"],
        domainGroupNames: [],
      });
      const changed = await apply(service, schedule);

      // Live state restored
      expect(changed).toBe(true);
      const [, nextConfig] = setConfigWithAuth.mock.calls[0];
      expect(nextConfig.groups[0].blocked.sort()).toEqual(
        ["googlevideo.com", "youtube.com"].sort(),
      );
      // Tracking write skipped — prev already matches desired, so no SQL
      // churn just because we had to do a live re-add.
      expect(setAppliedEntries).not.toHaveBeenCalled();
    });

    it("does not duplicate when desired tuples are already live", async () => {
      // Steady state: tracking matches desired, live matches desired. Pure
      // no-op tick — no setConfig, no setAppliedEntries.
      const { service, setConfigWithAuth, setAppliedEntries } = makeService({
        groups: [makeGroup("SharedGroup", ["youtube.com"], [])],
        trackedEntries: [
          {
            advancedBlockingGroupName: "SharedGroup",
            action: "block",
            domain: "youtube.com",
          },
        ],
      });

      const changed = await apply(
        service,
        makeSchedule({
          advancedBlockingGroupNames: ["SharedGroup"],
          action: "block",
          domainEntries: ["youtube.com"],
          domainGroupNames: [],
        }),
      );

      expect(changed).toBe(false);
      expect(setConfigWithAuth).not.toHaveBeenCalled();
      expect(setAppliedEntries).not.toHaveBeenCalled();
    });
  });

  describe("migration safety: first apply with empty tracking", () => {
    it("writes new entries without removing anything, even if old entries match", async () => {
      // Simulates a deployment upgrade: schedule was applied under the old
      // (untracked) code, leaving entries in Technitium. First apply under
      // the new code has prev=[] tracking. It must add (or skip already-
      // present) but must NEVER remove the existing entries.
      const { service, setConfigWithAuth, setAppliedEntries } = makeService(
        {
          groups: [
            makeGroup("GroupA", ["youtube.com", "pre-existing.com"], []),
          ],
          trackedEntries: [], // empty — pre-tracking-table state
        },
      );

      const schedule = makeSchedule({
        advancedBlockingGroupNames: ["GroupA"],
        action: "block",
        domainEntries: ["youtube.com"],
        domainGroupNames: [],
      });
      const changed = await apply(service, schedule);

      // youtube.com already there, no write needed; pre-existing.com left
      // alone because we have no record of having written it.
      expect(changed).toBe(false);
      expect(setConfigWithAuth).not.toHaveBeenCalled();
      // Tracking now seeded with the desired state going forward.
      const [, , newTracking] = setAppliedEntries.mock.calls[0];
      expect(newTracking).toEqual([
        {
          advancedBlockingGroupName: "GroupA",
          action: "block",
          domain: "youtube.com",
        },
      ]);
    });
  });

  describe("window-close remove uses tracking not current definition", () => {
    it("strips entries the schedule WROTE even after definition changed mid-window", async () => {
      // Simulates the user's bug: window-close triggers remove after a
      // mid-window domainGroupNames swap. Schedule.domainGroupNames is now
      // ["Music"], but the entries actually in Technitium (and tracked)
      // are YouTube domains from before the swap.
      const { service, setConfigWithAuth, clearAppliedEntries } = makeService({
        groups: [makeGroup("GroupA", ["youtube.com", "googlevideo.com"], [])],
        trackedEntries: [
          {
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "youtube.com",
          },
          {
            advancedBlockingGroupName: "GroupA",
            action: "block",
            domain: "googlevideo.com",
          },
        ],
        domainGroupsLookup: (names) =>
          names.includes("Music") ? ["music.example"] : [],
      });

      const scheduleAfterEdit = makeSchedule({
        advancedBlockingGroupNames: ["GroupA"],
        action: "block",
        domainGroupNames: ["Music"],
        domainEntries: [],
      });
      await remove(service, scheduleAfterEdit);

      // Remove cleans up what we ACTUALLY wrote (YouTube tuples), not what
      // the current definition resolves to (Music).
      const [, nextConfig] = setConfigWithAuth.mock.calls[0];
      expect(nextConfig.groups[0].blocked).toEqual([]);
      // Tracking cleared so the next apply starts from empty baseline.
      expect(clearAppliedEntries).toHaveBeenCalledTimes(1);
    });

    it("legacy fallback: empty tracking + non-empty schedule definition removes via resolve-from-definition", async () => {
      // Migration path: user upgrades while a schedule is currently applied.
      // Tracking is empty (was never populated by the old code) but the
      // schedule's domain set is non-empty. We must fall back to the legacy
      // "re-resolve current definition" cleanup, otherwise the previously-
      // written entries leak forever.
      const { service, setConfigWithAuth, clearAppliedEntries } = makeService({
        groups: [makeGroup("GroupA", ["youtube.com", "untouched.com"], [])],
        trackedEntries: [],
      });

      await remove(
        service,
        makeSchedule({
          advancedBlockingGroupNames: ["GroupA"],
          action: "block",
          domainEntries: ["youtube.com"],
          domainGroupNames: [],
        }),
      );

      // youtube.com (resolvable from current definition) stripped;
      // untouched.com (not part of the schedule) preserved.
      const [, nextConfig] = setConfigWithAuth.mock.calls[0];
      expect(nextConfig.groups[0].blocked).toEqual(["untouched.com"]);
      expect(clearAppliedEntries).toHaveBeenCalledTimes(1);
    });

    it("is a true no-op when both tracking and resolved set are empty", async () => {
      // Schedule has no domain entries and no domain groups, and we have
      // no tracking. There's genuinely nothing to clean up.
      const { service, setConfigWithAuth, clearAppliedEntries } = makeService({
        groups: [makeGroup("GroupA", ["pre-existing.com"], [])],
        trackedEntries: [],
      });

      await remove(
        service,
        makeSchedule({
          advancedBlockingGroupNames: ["GroupA"],
          domainEntries: [],
          domainGroupNames: [],
        }),
      );

      expect(setConfigWithAuth).not.toHaveBeenCalled();
      expect(clearAppliedEntries).not.toHaveBeenCalled();
    });
  });
});

// ── buildAlertDomainPattern length handling ─────────────────────────────────
//
// Previously, the auto-generated regex of all schedule domains exceeded the
// linked alert rule's 300-char pattern cap for large Domain Groups (e.g.
// YouTube), causing syncLinkedAlertRule to fail and silently suppress
// notifications. Two fixes: cap raised to 8000 in the rule storage, and a
// wildcard fallback here for the rare case where even 8000 is exceeded.

describe("DnsSchedulesEvaluatorService — buildAlertDomainPattern", () => {
  function makeServiceWithDomainGroups(
    dgLookup: (names: string[]) => string[],
  ): DnsSchedulesEvaluatorService {
    return new DnsSchedulesEvaluatorService(
      {} as never,
      {} as never,
      {} as never,
      { getExactEntriesByGroupNames: dgLookup } as never,
      {} as never,
    );
  }

  it("returns wildcard for an empty schedule (no manual entries, no DGs)", () => {
    const service = makeServiceWithDomainGroups(() => []);
    const result = service.buildAlertDomainPattern(
      makeSchedule({ domainEntries: [], domainGroupNames: [] }),
    );
    expect(result).toEqual({ pattern: "*", type: "wildcard" });
  });

  it("returns a precise regex for a few manual entries", () => {
    const service = makeServiceWithDomainGroups(() => []);
    const result = service.buildAlertDomainPattern(
      makeSchedule({
        domainEntries: ["youtube.com", "googlevideo.com"],
        domainGroupNames: [],
      }),
    );
    expect(result.type).toBe("regex");
    expect(result.pattern).toContain("youtube\\.com");
    expect(result.pattern).toContain("googlevideo\\.com");
    expect(result.pattern.length).toBeLessThan(100);
  });

  it("accepts a moderately large DG (200 domains) as a single regex", () => {
    // 200 distinct ~20-char domains → ~4500-char pattern, comfortably
    // under both the 7500 internal cap and the 8000 storage cap.
    const domains = Array.from(
      { length: 200 },
      (_, i) => `subdomain${i}-of-example.com`,
    );
    const service = makeServiceWithDomainGroups(() => domains);
    const result = service.buildAlertDomainPattern(
      makeSchedule({
        domainEntries: [],
        domainGroupNames: ["BigDG"],
      }),
    );
    expect(result.type).toBe("regex");
    expect(result.pattern.length).toBeLessThan(8000);
    // Sanity: still contains a sample of the encoded domains
    expect(result.pattern).toContain("subdomain0-of-example\\.com");
    expect(result.pattern).toContain("subdomain199-of-example\\.com");
  });

  it("falls back to wildcard when the regex would exceed the safety cap", () => {
    // 1000 domains × ~30 chars each → ~30,000-char pattern, well over 7500.
    const domains = Array.from(
      { length: 1000 },
      (_, i) => `very-long-subdomain-name-${i}.example.com`,
    );
    const service = makeServiceWithDomainGroups(() => domains);
    const result = service.buildAlertDomainPattern(
      makeSchedule({
        domainEntries: [],
        domainGroupNames: ["HugeDG"],
      }),
    );
    expect(result).toEqual({ pattern: "*", type: "wildcard" });
  });

  it("deduplicates entries before building the regex", () => {
    const service = makeServiceWithDomainGroups(() => ["youtube.com"]);
    const result = service.buildAlertDomainPattern(
      makeSchedule({
        // youtube.com appears in both sources — should only show up once
        domainEntries: ["youtube.com"],
        domainGroupNames: ["SomeDG"],
      }),
    );
    expect(result.type).toBe("regex");
    // Only one occurrence of the escaped domain
    const matches = result.pattern.split("youtube\\.com").length - 1;
    expect(matches).toBe(1);
  });
});

describe("DnsSchedulesEvaluatorService — temporary override alert window", () => {
  it("toggles the temporary override linked alert rule namespace", () => {
    const updateRule = jest.fn();
    const service = new DnsSchedulesEvaluatorService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        listRules: () => [
          {
            id: "rule-1",
            name: "__temporary-override:override-1__",
            displayName: "YouTube now",
            enabled: false,
            outcomeMode: "blocked-only",
            domainPattern: "*",
            domainPatternType: "wildcard",
            advancedBlockingGroupNames: ["GroupA"],
            debounceSeconds: 300,
            emailRecipients: ["recipient@example.com"],
            createdAt: "2026-06-24T00:00:00.000Z",
            updatedAt: "2026-06-24T00:00:00.000Z",
          },
        ],
        updateRule,
      } as never,
      {} as never,
    );

    (
      service as unknown as {
        syncAlertRuleWindow: (
          id: string,
          name: string,
          active: boolean,
          prefix: "__temporary-override",
        ) => void;
      }
    ).syncAlertRuleWindow(
      "override-1",
      "YouTube now",
      true,
      "__temporary-override",
    );

    expect(updateRule).toHaveBeenCalledWith(
      "rule-1",
      expect.objectContaining({
        name: "__temporary-override:override-1__",
        displayName: "YouTube now",
        enabled: true,
      }),
    );
  });
});
