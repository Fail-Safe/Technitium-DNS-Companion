import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthSession } from "./auth.types";

const ONE_HOUR_MS = 60 * 60 * 1000;
/**
 * Default absolute session lifetime — after this many hours since creation,
 * a session expires regardless of activity. Bounds a captured-session-ID
 * replay window.
 */
const DEFAULT_MAX_AGE_HOURS = 24;
/**
 * Default idle lifetime — after this many hours since `lastSeenAt`, a
 * session expires. Matches the cookie `maxAge` default of 8h.
 */
const DEFAULT_IDLE_HOURS = 8;
/**
 * How often the sweep timer scans `sessions` for expired entries and evicts
 * them. The sweep is purely a memory-bounding mechanism — `get()` already
 * lazily evicts on read.
 */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class AuthSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthSessionService.name);
  private readonly sessions = new Map<string, AuthSession>();
  private readonly maxAgeMs: number;
  private readonly maxIdleMs: number;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.maxAgeMs = readEnvHours(
      "AUTH_SESSION_MAX_AGE_HOURS",
      DEFAULT_MAX_AGE_HOURS,
    );
    this.maxIdleMs = readEnvHours(
      "AUTH_SESSION_IDLE_HOURS",
      DEFAULT_IDLE_HOURS,
    );
    this.startSweepTimer();
  }

  onModuleDestroy(): void {
    this.stopSweepTimer();
  }

  create(user: string, tokensByNodeId: Record<string, string>): AuthSession {
    const id = randomUUID();
    const now = Date.now();
    const session: AuthSession = {
      id,
      user,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: now,
      tokensByNodeId,
    };

    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string): AuthSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const now = Date.now();
    if (this.isExpired(session, now)) {
      // Lazy eviction on read — independent of the sweep timer so a captured
      // session ID stops authenticating the moment it goes stale, not at the
      // next sweep tick.
      this.sessions.delete(sessionId);
      return undefined;
    }

    session.lastSeenAt = now;
    return session;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Test seam — current count of in-memory sessions. Not exposed via any
   * controller or DTO; intended for sweep-behavior assertions.
   */
  count(): number {
    return this.sessions.size;
  }

  private isExpired(session: AuthSession, now: number): boolean {
    const createdAtMs = Date.parse(session.createdAt);
    if (
      Number.isFinite(createdAtMs) &&
      now - createdAtMs > this.maxAgeMs
    ) {
      return true;
    }
    if (now - session.lastSeenAt > this.maxIdleMs) {
      return true;
    }
    return false;
  }

  private startSweepTimer(): void {
    this.sweepTimer = setInterval(() => {
      this.sweepExpired();
    }, SWEEP_INTERVAL_MS);
    // Don't keep the Node process alive solely for this timer — it should be
    // cooperative with shutdown, not block it.
    if (this.sweepTimer && typeof this.sweepTimer.unref === "function") {
      this.sweepTimer.unref();
    }
  }

  private stopSweepTimer(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * Visible for testing — scans the session map and evicts expired entries.
   * Logs a single line when at least one entry was evicted, so operators can
   * see steady-state churn without spam during idle periods.
   */
  sweepExpired(): number {
    const now = Date.now();
    let evicted = 0;
    for (const [id, session] of this.sessions) {
      if (this.isExpired(session, now)) {
        this.sessions.delete(id);
        evicted++;
      }
    }
    if (evicted > 0) {
      this.logger.log(`Evicted ${evicted} expired session(s) from memory.`);
    }
    return evicted;
  }
}

function readEnvHours(name: string, defaultHours: number): number {
  const raw = process.env[name];
  if (!raw) return defaultHours * ONE_HOUR_MS;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultHours * ONE_HOUR_MS;
  }
  return parsed * ONE_HOUR_MS;
}
