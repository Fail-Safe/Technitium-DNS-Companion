import { BadRequestException } from "@nestjs/common";
import { DnsSchedulesController } from "./dns-schedules.controller";
import type { DnsScheduleDraft } from "./dns-schedules.types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Call the private `parseDraft` method directly.
 * parseDraft does not invoke any injected service, so all four constructor
 * dependencies are passed as empty objects cast with `as never`.
 */
function makeParseDraft() {
  const controller = new DnsSchedulesController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return (body: unknown): DnsScheduleDraft =>
    (controller as unknown as { parseDraft(b: unknown): DnsScheduleDraft }).parseDraft(body);
}

// ── Spec ─────────────────────────────────────────────────────────────────────

describe("DnsSchedulesController — parseDraft", () => {
  let parseDraft: (body: unknown) => DnsScheduleDraft;

  beforeEach(() => {
    parseDraft = makeParseDraft();
  });

  // ── Non-object bodies ───────────────────────────────────────────────────────

  describe("invalid body type", () => {
    it("throws BadRequestException when body is null", () => {
      expect(() => parseDraft(null)).toThrow(BadRequestException);
    });

    it("throws BadRequestException when body is a string", () => {
      expect(() => parseDraft("bad")).toThrow(BadRequestException);
    });

    it("throws BadRequestException when body is a number", () => {
      expect(() => parseDraft(42)).toThrow(BadRequestException);
    });

    it("throws BadRequestException when body is an array", () => {
      expect(() => parseDraft([])).toThrow(BadRequestException);
    });
  });

  // ── name ────────────────────────────────────────────────────────────────────

  describe("name field", () => {
    function base() {
      return {
        advancedBlockingGroupNames: ["Kids"],
        action: "block",
        domainEntries: ["example.com"],
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("throws BadRequestException when name is missing", () => {
      expect(() => parseDraft(base())).toThrow(BadRequestException);
    });

    it("throws BadRequestException when name is whitespace-only", () => {
      expect(() => parseDraft({ ...base(), name: "   " })).toThrow(BadRequestException);
    });

    it("trims whitespace from name", () => {
      const result = parseDraft({ ...base(), name: "  Bedtime  " });
      expect(result.name).toBe("Bedtime");
    });

    it("throws BadRequestException when name is a non-string", () => {
      expect(() => parseDraft({ ...base(), name: 42 })).toThrow(BadRequestException);
    });
  });

  // ── advancedBlockingGroupNames ───────────────────────────────────────────────

  describe("advancedBlockingGroupNames field", () => {
    function base() {
      return {
        name: "Schedule",
        action: "block",
        domainEntries: ["example.com"],
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("throws BadRequestException when advancedBlockingGroupNames is missing", () => {
      expect(() => parseDraft(base())).toThrow(BadRequestException);
    });

    it("throws BadRequestException when advancedBlockingGroupNames is empty array", () => {
      expect(() =>
        parseDraft({ ...base(), advancedBlockingGroupNames: [] }),
      ).toThrow(BadRequestException);
    });

    it("throws BadRequestException when all entries are whitespace-only", () => {
      expect(() =>
        parseDraft({ ...base(), advancedBlockingGroupNames: ["   "] }),
      ).toThrow(BadRequestException);
    });

    it("trims whitespace from group names", () => {
      const result = parseDraft({ ...base(), advancedBlockingGroupNames: ["  Kids  ", " Parents "] });
      expect(result.advancedBlockingGroupNames).toEqual(["Kids", "Parents"]);
    });

    it("accepts multiple groups", () => {
      const result = parseDraft({ ...base(), advancedBlockingGroupNames: ["Kids", "Parents"] });
      expect(result.advancedBlockingGroupNames).toEqual(["Kids", "Parents"]);
    });
  });

  // ── action ──────────────────────────────────────────────────────────────────

  describe("action field", () => {
    function base() {
      return {
        name: "Schedule",
        advancedBlockingGroupNames: ["Kids"],
        domainEntries: ["example.com"],
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("throws BadRequestException when action is missing", () => {
      expect(() => parseDraft(base())).toThrow(BadRequestException);
    });

    it("throws BadRequestException when action is an unknown string", () => {
      expect(() => parseDraft({ ...base(), action: "deny" })).toThrow(BadRequestException);
    });

    it("accepts 'block'", () => {
      const result = parseDraft({ ...base(), action: "block" });
      expect(result.action).toBe("block");
    });

    it("accepts 'allow'", () => {
      const result = parseDraft({ ...base(), action: "allow" });
      expect(result.action).toBe("allow");
    });
  });

  // ── startTime / endTime ──────────────────────────────────────────────────────

  describe("startTime and endTime fields", () => {
    function base() {
      return {
        name: "Schedule",
        advancedBlockingGroupNames: ["Kids"],
        action: "block",
        domainEntries: ["example.com"],
        endTime: "06:00",
      };
    }

    it("throws BadRequestException when startTime is missing", () => {
      expect(() => parseDraft(base())).toThrow(BadRequestException);
    });

    it("throws BadRequestException when startTime is an empty string", () => {
      expect(() => parseDraft({ ...base(), startTime: "" })).toThrow(BadRequestException);
    });

    it("throws BadRequestException when endTime is missing", () => {
      const { endTime: _ignored, ...noEnd } = base();
      expect(() => parseDraft({ ...noEnd, startTime: "22:00" })).toThrow(BadRequestException);
    });
  });

  // ── enabled ──────────────────────────────────────────────────────────────────

  describe("enabled field", () => {
    function validBody() {
      return {
        name: "Schedule",
        advancedBlockingGroupNames: ["Kids"],
        action: "block",
        domainEntries: ["example.com"],
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("defaults enabled to true when not provided", () => {
      const result = parseDraft(validBody());
      expect(result.enabled).toBe(true);
    });

    it("respects enabled=false when explicitly set", () => {
      const result = parseDraft({ ...validBody(), enabled: false });
      expect(result.enabled).toBe(false);
    });

    it("treats any value other than false as true (truthy coercion)", () => {
      const result = parseDraft({ ...validBody(), enabled: null });
      expect(result.enabled).toBe(true);
    });
  });

  // ── domainEntries ────────────────────────────────────────────────────────────

  describe("domainEntries field", () => {
    function validBody() {
      return {
        name: "Schedule",
        advancedBlockingGroupNames: ["Kids"],
        action: "block",
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("defaults to an empty array when not provided", () => {
      const result = parseDraft({ ...validBody(), domainGroupNames: ["SocialMedia"] });
      expect(result.domainEntries).toEqual([]);
    });

    it("filters out non-string elements", () => {
      const result = parseDraft({
        ...validBody(),
        domainEntries: ["example.com", 42, null, true, "other.com"],
        domainGroupNames: ["SocialMedia"],
      });
      expect(result.domainEntries).toEqual(["example.com", "other.com"]);
    });

    it("trims whitespace from entries and removes empties", () => {
      const result = parseDraft({
        ...validBody(),
        domainEntries: ["  example.com  ", "   ", "other.com"],
        domainGroupNames: ["SocialMedia"],
      });
      expect(result.domainEntries).toEqual(["example.com", "other.com"]);
    });
  });

  // ── domainGroupNames ─────────────────────────────────────────────────────────

  describe("domainGroupNames field", () => {
    function validBody() {
      return {
        name: "Schedule",
        advancedBlockingGroupNames: ["Kids"],
        action: "block",
        domainEntries: ["example.com"],
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("defaults to an empty array when not provided", () => {
      const result = parseDraft(validBody());
      expect(result.domainGroupNames).toEqual([]);
    });

    it("filters out non-string elements", () => {
      const result = parseDraft({
        ...validBody(),
        domainGroupNames: ["SocialMedia", 99, null],
      });
      expect(result.domainGroupNames).toEqual(["SocialMedia"]);
    });

    it("trims and removes empty strings", () => {
      const result = parseDraft({
        ...validBody(),
        domainGroupNames: ["  SocialMedia  ", "  "],
      });
      expect(result.domainGroupNames).toEqual(["SocialMedia"]);
    });
  });

  // ── daysOfWeek ───────────────────────────────────────────────────────────────

  describe("daysOfWeek field", () => {
    function validBody() {
      return {
        name: "Schedule",
        advancedBlockingGroupNames: ["Kids"],
        action: "block",
        domainEntries: ["example.com"],
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("defaults to an empty array when not provided", () => {
      const result = parseDraft(validBody());
      expect(result.daysOfWeek).toEqual([]);
    });

    it("passes through valid day values 0–6", () => {
      const result = parseDraft({ ...validBody(), daysOfWeek: [0, 1, 6] });
      expect(result.daysOfWeek).toEqual([0, 1, 6]);
    });

    it("filters out values outside the 0–6 range", () => {
      const result = parseDraft({ ...validBody(), daysOfWeek: [-1, 0, 6, 7] });
      expect(result.daysOfWeek).toEqual([0, 6]);
    });

    it("filters out non-integer values", () => {
      const result = parseDraft({ ...validBody(), daysOfWeek: [1.5, 2, "3"] });
      expect(result.daysOfWeek).toEqual([2]);
    });
  });

  // ── timezone ─────────────────────────────────────────────────────────────────

  describe("timezone field", () => {
    function validBody() {
      return {
        name: "Schedule",
        advancedBlockingGroupNames: ["Kids"],
        action: "block",
        domainEntries: ["example.com"],
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("defaults to 'UTC' when not provided", () => {
      const result = parseDraft(validBody());
      expect(result.timezone).toBe("UTC");
    });

    it("defaults to 'UTC' when timezone is not a string", () => {
      const result = parseDraft({ ...validBody(), timezone: 42 });
      expect(result.timezone).toBe("UTC");
    });

    it("passes through the timezone string as-is (no format validation here)", () => {
      const result = parseDraft({ ...validBody(), timezone: "America/New_York" });
      expect(result.timezone).toBe("America/New_York");
    });
  });

  // ── nodeIds ──────────────────────────────────────────────────────────────────

  describe("nodeIds field", () => {
    function validBody() {
      return {
        name: "Schedule",
        advancedBlockingGroupNames: ["Kids"],
        action: "block",
        domainEntries: ["example.com"],
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("defaults to an empty array when not provided", () => {
      const result = parseDraft(validBody());
      expect(result.nodeIds).toEqual([]);
    });

    it("filters out non-strings and empties", () => {
      const result = parseDraft({
        ...validBody(),
        nodeIds: ["node-1", 42, "  ", "node-2"],
      });
      expect(result.nodeIds).toEqual(["node-1", "node-2"]);
    });
  });

  // ── flushCacheOnChange ───────────────────────────────────────────────────────

  describe("flushCacheOnChange field", () => {
    function validBody() {
      return {
        name: "Schedule",
        advancedBlockingGroupNames: ["Kids"],
        action: "block",
        domainEntries: ["example.com"],
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("defaults to false when not provided", () => {
      const result = parseDraft(validBody());
      expect(result.flushCacheOnChange).toBe(false);
    });

    it("is true only when exactly true is provided", () => {
      const result = parseDraft({ ...validBody(), flushCacheOnChange: true });
      expect(result.flushCacheOnChange).toBe(true);
    });

    it("is false for truthy non-boolean values like 1", () => {
      const result = parseDraft({ ...validBody(), flushCacheOnChange: 1 });
      expect(result.flushCacheOnChange).toBe(false);
    });
  });

  // ── notifyEmails / notifyDebounceSeconds ─────────────────────────────────────

  describe("notifyEmails and notifyDebounceSeconds fields", () => {
    function validBody() {
      return {
        name: "Schedule",
        advancedBlockingGroupNames: ["Kids"],
        action: "block",
        domainEntries: ["example.com"],
        startTime: "22:00",
        endTime: "06:00",
      };
    }

    it("notifyEmails defaults to empty array", () => {
      const result = parseDraft(validBody());
      expect(result.notifyEmails).toEqual([]);
    });

    it("notifyEmails trims and filters empties", () => {
      const result = parseDraft({
        ...validBody(),
        notifyEmails: ["  parent@example.com  ", "  ", "admin@example.com"],
      });
      expect(result.notifyEmails).toEqual(["parent@example.com", "admin@example.com"]);
    });

    it("notifyDebounceSeconds defaults to 300", () => {
      const result = parseDraft(validBody());
      expect(result.notifyDebounceSeconds).toBe(300);
    });

    it("notifyDebounceSeconds parses a numeric value", () => {
      const result = parseDraft({ ...validBody(), notifyDebounceSeconds: 600 });
      expect(result.notifyDebounceSeconds).toBe(600);
    });

    it("notifyDebounceSeconds rounds fractional seconds", () => {
      const result = parseDraft({ ...validBody(), notifyDebounceSeconds: 60.7 });
      expect(result.notifyDebounceSeconds).toBe(61);
    });

    it("notifyDebounceSeconds falls back to 300 for negative values", () => {
      const result = parseDraft({ ...validBody(), notifyDebounceSeconds: -1 });
      expect(result.notifyDebounceSeconds).toBe(300);
    });

    it("notifyDebounceSeconds falls back to 300 for non-numeric strings", () => {
      const result = parseDraft({ ...validBody(), notifyDebounceSeconds: "bad" });
      expect(result.notifyDebounceSeconds).toBe(300);
    });

    it("notifyDebounceSeconds of 0 is valid (no debounce)", () => {
      const result = parseDraft({ ...validBody(), notifyDebounceSeconds: 0 });
      expect(result.notifyDebounceSeconds).toBe(0);
    });
  });
});
