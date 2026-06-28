import { AuthSessionService } from "./auth-session.service";

const ORIGINAL_ENV = { ...process.env };

function resetEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AUTH_SESSION_MAX_AGE_HOURS;
  delete process.env.AUTH_SESSION_IDLE_HOURS;
}

afterEach(() => {
  resetEnv();
  jest.useRealTimers();
});

describe("AuthSessionService — create + get + delete (baseline)", () => {
  it("creates a session with a UUID id and stores it for retrieval", () => {
    const service = new AuthSessionService();
    const session = service.create("alice", { node1: "tok-1" });
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(session.user).toBe("alice");
    expect(session.tokensByNodeId).toEqual({ node1: "tok-1" });
    expect(service.get(session.id)).toBe(session);
    service.onModuleDestroy();
  });

  it("returns undefined for an unknown session id", () => {
    const service = new AuthSessionService();
    expect(service.get("not-a-real-id")).toBeUndefined();
    service.onModuleDestroy();
  });

  it("delete removes the session", () => {
    const service = new AuthSessionService();
    const session = service.create("alice", {});
    expect(service.get(session.id)).toBe(session);
    service.delete(session.id);
    expect(service.get(session.id)).toBeUndefined();
    service.onModuleDestroy();
  });

  it("get refreshes lastSeenAt", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = new AuthSessionService();
    const session = service.create("alice", {});
    const created = session.lastSeenAt;

    jest.setSystemTime(new Date("2026-01-01T01:00:00Z"));
    const fetched = service.get(session.id);
    expect(fetched).toBeDefined();
    expect(fetched!.lastSeenAt).toBeGreaterThan(created);
    service.onModuleDestroy();
  });
});

describe("AuthSessionService — idle expiration", () => {
  it("expires a session after the default 8h idle window", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = new AuthSessionService();
    const session = service.create("alice", {});
    expect(service.get(session.id)).toBe(session);

    // Advance just past 8h — session must be evicted by get().
    jest.setSystemTime(new Date("2026-01-01T08:00:01Z"));
    expect(service.get(session.id)).toBeUndefined();
    expect(service.count()).toBe(0);
    service.onModuleDestroy();
  });

  it("does NOT expire when within the idle window", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = new AuthSessionService();
    const session = service.create("alice", {});

    // Just shy of 8h — should still be valid.
    jest.setSystemTime(new Date("2026-01-01T07:59:59Z"));
    expect(service.get(session.id)).toBe(session);
    service.onModuleDestroy();
  });

  it("rolling activity within idle window keeps the session alive", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = new AuthSessionService();
    const session = service.create("alice", {});

    // Every 6h, get() refreshes lastSeenAt — session should stay live for 24h
    // total (and only hit the ABSOLUTE max after that, not the idle limit).
    for (const hours of [6, 12, 18]) {
      jest.setSystemTime(
        new Date(`2026-01-01T${String(hours).padStart(2, "0")}:00:00Z`),
      );
      expect(service.get(session.id)).toBeDefined();
    }
    service.onModuleDestroy();
  });

  it("honors AUTH_SESSION_IDLE_HOURS env override", () => {
    process.env.AUTH_SESSION_IDLE_HOURS = "1";
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = new AuthSessionService();
    const session = service.create("alice", {});

    jest.setSystemTime(new Date("2026-01-01T01:00:01Z"));
    expect(service.get(session.id)).toBeUndefined();
    service.onModuleDestroy();
  });
});

describe("AuthSessionService — absolute expiration", () => {
  it("expires a session after the default 24h max age, even with rolling activity", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = new AuthSessionService();
    const session = service.create("alice", {});

    // Keep refreshing every 6h — would defeat idle expiration, but absolute
    // age still trips at 24h.
    for (const hours of [6, 12, 18]) {
      jest.setSystemTime(
        new Date(`2026-01-01T${String(hours).padStart(2, "0")}:00:00Z`),
      );
      expect(service.get(session.id)).toBeDefined();
    }
    // 24h + 1s past creation — absolute max triggers despite the rolling refreshes.
    jest.setSystemTime(new Date("2026-01-02T00:00:01Z"));
    expect(service.get(session.id)).toBeUndefined();
    service.onModuleDestroy();
  });

  it("honors AUTH_SESSION_MAX_AGE_HOURS env override", () => {
    // Set max age below idle, so absolute trips first.
    process.env.AUTH_SESSION_MAX_AGE_HOURS = "2";
    process.env.AUTH_SESSION_IDLE_HOURS = "8";
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = new AuthSessionService();
    const session = service.create("alice", {});

    // 1h in — still within both windows.
    jest.setSystemTime(new Date("2026-01-01T01:00:00Z"));
    expect(service.get(session.id)).toBeDefined();

    // 2h + 1s — absolute max trips even though idle window is 8h.
    jest.setSystemTime(new Date("2026-01-01T02:00:01Z"));
    expect(service.get(session.id)).toBeUndefined();
    service.onModuleDestroy();
  });

  it("falls back to defaults when env vars are non-numeric or non-positive", () => {
    process.env.AUTH_SESSION_MAX_AGE_HOURS = "not-a-number";
    process.env.AUTH_SESSION_IDLE_HOURS = "-5";
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = new AuthSessionService();
    const session = service.create("alice", {});

    // Defaults are 24h absolute / 8h idle. Jump straight past 8h idle with
    // no intervening get() — the bad env values should have been rejected.
    jest.setSystemTime(new Date("2026-01-01T08:00:01Z"));
    expect(service.get(session.id)).toBeUndefined();
    service.onModuleDestroy();
  });
});

describe("AuthSessionService — sweep + cleanup", () => {
  it("sweepExpired evicts stale entries even without get() calls", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const service = new AuthSessionService();
    const alice = service.create("alice", {});
    const bob = service.create("bob", {});
    const carol = service.create("carol", {});

    // Refresh carol mid-window so she stays live; alice & bob go idle.
    jest.setSystemTime(new Date("2026-01-01T07:00:00Z"));
    service.get(carol.id);

    // Advance past idle for alice + bob (but not carol since she just got
    // refreshed).
    jest.setSystemTime(new Date("2026-01-01T08:00:01Z"));
    const evicted = service.sweepExpired();
    expect(evicted).toBe(2);
    expect(service.count()).toBe(1);
    expect(service.get(carol.id)).toBeDefined();
    expect(service.get(alice.id)).toBeUndefined();
    expect(service.get(bob.id)).toBeUndefined();
    service.onModuleDestroy();
  });

  it("sweepExpired returns 0 when no entries are stale", () => {
    const service = new AuthSessionService();
    service.create("alice", {});
    expect(service.sweepExpired()).toBe(0);
    service.onModuleDestroy();
  });

  it("onModuleDestroy stops the sweep timer", () => {
    const service = new AuthSessionService();
    // Tear down — should be a no-throw and leave a clean state.
    expect(() => service.onModuleDestroy()).not.toThrow();
    // Idempotent.
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
