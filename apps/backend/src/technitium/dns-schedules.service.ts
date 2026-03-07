import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { DatabaseSync } from "node:sqlite";
import { CompanionDbService } from "./companion-db.service";
import type {
  DnsSchedule,
  DnsScheduleDraft,
  DnsScheduleStateEntry,
  DnsSchedulesStorageStatus,
} from "./dns-schedules.types";

type DnsScheduleRow = {
  id: string;
  name: string;
  enabled: number;
  advanced_blocking_group_name: string;
  action: DnsScheduleDraft["action"];
  domain_entries_json: string;
  domain_group_names_json: string;
  days_of_week_json: string;
  start_time: string;
  end_time: string;
  timezone: string;
  node_ids_json: string;
  flush_cache_on_change: number;
  notify_emails_json: string;
  notify_debounce_seconds: number;
  created_at: string;
  updated_at: string;
};

type DnsScheduleStateRow = {
  schedule_id: string;
  node_id: string;
  applied_at: string;
};

@Injectable()
export class DnsSchedulesService implements OnModuleInit {
  private readonly logger = new Logger(DnsSchedulesService.name);

  private readonly enabled =
    (process.env.DNS_SCHEDULES_ENABLED ?? "true").trim().toLowerCase() !==
    "false";

  private schemaReady = false;

  constructor(private readonly companionDb: CompanionDbService) {}

  /**
   * Idempotent schema bootstrap. Called lazily to tolerate NestJS
   * onModuleInit ordering — the evaluator may call getters before
   * this service's onModuleInit fires.
   */
  private ensureSchema(): void {
    if (this.schemaReady) return;
    const db = this.companionDb.db;
    if (!db) return;
    this.initializeSchema();
    this.schemaReady = true;
  }

  getStatus(): DnsSchedulesStorageStatus {
    return {
      enabled: this.enabled,
      ready: this.enabled && this.companionDb.db !== null,
      dbPath: this.enabled ? this.companionDb.dbPath : undefined,
    };
  }

  onModuleInit(): void {
    this.logger.log(
      `DNS Schedules config: enabled=${this.enabled}, dbPath=${this.companionDb.dbPath}`,
    );

    if (!this.enabled) {
      this.logger.log("DNS Schedules are disabled (DNS_SCHEDULES_ENABLED=false).");
      return;
    }

    try {
      this.ensureSchema();
      this.logger.log(
        `DNS Schedules schema initialized in Companion SQLite at ${this.companionDb.dbPath}`,
      );
    } catch (error) {
      this.logger.error(`Failed to initialize DNS Schedules schema`, error as Error);
    }
  }

  listSchedules(): DnsSchedule[] {
    const db = this.getDb();
    this.ensureSchema();
    const rows = db
      .prepare(
        `SELECT id, name, enabled, advanced_blocking_group_name, action,
                domain_entries_json, domain_group_names_json, days_of_week_json, start_time, end_time,
                timezone, node_ids_json, flush_cache_on_change,
                notify_emails_json, notify_debounce_seconds, created_at, updated_at
         FROM dns_schedules
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all() as DnsScheduleRow[];
    return rows.map((row) => this.mapRow(row));
  }

  createSchedule(draft: DnsScheduleDraft): DnsSchedule {
    const db = this.getDb();
    this.assertDraftValid(draft);
    const now = new Date().toISOString();
    const id = randomUUID();
    const nameLc = draft.name.toLowerCase();

    try {
      db.prepare(
        `INSERT INTO dns_schedules (
           id, name, name_lc, enabled, advanced_blocking_group_name, action,
           domain_entries_json, domain_group_names_json, days_of_week_json, start_time, end_time,
           timezone, node_ids_json, flush_cache_on_change,
           notify_emails_json, notify_debounce_seconds, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        draft.name,
        nameLc,
        draft.enabled ? 1 : 0,
        draft.advancedBlockingGroupName,
        draft.action,
        JSON.stringify(draft.domainEntries),
        JSON.stringify(draft.domainGroupNames ?? []),
        JSON.stringify(draft.daysOfWeek),
        draft.startTime,
        draft.endTime,
        draft.timezone,
        JSON.stringify(draft.nodeIds),
        draft.flushCacheOnChange ? 1 : 0,
        JSON.stringify(draft.notifyEmails ?? []),
        draft.notifyDebounceSeconds ?? 300,
        now,
        now,
      );
    } catch (error) {
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new BadRequestException("A DNS schedule with this name already exists.");
      }
      throw error;
    }

    return this.getSchedule(id);
  }

  updateSchedule(scheduleId: string, draft: DnsScheduleDraft): DnsSchedule {
    const db = this.getDb();
    this.assertDraftValid(draft);
    const now = new Date().toISOString();
    const nameLc = draft.name.toLowerCase();

    try {
      const result = db
        .prepare(
          `UPDATE dns_schedules
           SET name = ?, name_lc = ?, enabled = ?,
               advanced_blocking_group_name = ?, action = ?,
               domain_entries_json = ?, domain_group_names_json = ?, days_of_week_json = ?,
               start_time = ?, end_time = ?, timezone = ?,
               node_ids_json = ?, flush_cache_on_change = ?,
               notify_emails_json = ?, notify_debounce_seconds = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          draft.name,
          nameLc,
          draft.enabled ? 1 : 0,
          draft.advancedBlockingGroupName,
          draft.action,
          JSON.stringify(draft.domainEntries),
          JSON.stringify(draft.domainGroupNames ?? []),
          JSON.stringify(draft.daysOfWeek),
          draft.startTime,
          draft.endTime,
          draft.timezone,
          JSON.stringify(draft.nodeIds),
          draft.flushCacheOnChange ? 1 : 0,
          JSON.stringify(draft.notifyEmails ?? []),
          draft.notifyDebounceSeconds ?? 300,
          now,
          scheduleId,
        );

      if ((result.changes ?? 0) === 0) {
        throw new NotFoundException("DNS schedule not found.");
      }
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new BadRequestException("A DNS schedule with this name already exists.");
      }
      throw error;
    }

    return this.getSchedule(scheduleId);
  }

  setScheduleEnabled(scheduleId: string, enabled: boolean): DnsSchedule {
    const db = this.getDb();
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE dns_schedules SET enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, now, scheduleId);

    if ((result.changes ?? 0) === 0) {
      throw new NotFoundException("DNS schedule not found.");
    }

    return this.getSchedule(scheduleId);
  }

  deleteSchedule(scheduleId: string): { deleted: true; scheduleId: string } {
    const db = this.getDb();
    // Also clear any tracked state for this schedule
    db.prepare(`DELETE FROM dns_schedule_state WHERE schedule_id = ?`).run(scheduleId);
    const result = db
      .prepare(`DELETE FROM dns_schedules WHERE id = ?`)
      .run(scheduleId);

    if ((result.changes ?? 0) === 0) {
      throw new NotFoundException("DNS schedule not found.");
    }

    return { deleted: true, scheduleId };
  }

  // ── State tracking (used by evaluator) ─────────────────────────────────────

  listAppliedState(): DnsScheduleStateEntry[] {
    const db = this.companionDb.db;
    if (!db) return [];
    this.ensureSchema();
    const rows = db
      .prepare(
        `SELECT schedule_id, node_id, applied_at FROM dns_schedule_state`,
      )
      .all() as DnsScheduleStateRow[];
    return rows.map((row) => ({
      scheduleId: row.schedule_id,
      nodeId: row.node_id,
      appliedAt: row.applied_at,
    }));
  }

  isApplied(scheduleId: string, nodeId: string): boolean {
    const db = this.companionDb.db;
    if (!db) return false;
    this.ensureSchema();
    const row = db
      .prepare(
        `SELECT 1 FROM dns_schedule_state WHERE schedule_id = ? AND node_id = ?`,
      )
      .get(scheduleId, nodeId);
    return row !== undefined;
  }

  markApplied(scheduleId: string, nodeId: string): void {
    const db = this.companionDb.db;
    if (!db) return;
    this.ensureSchema();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO dns_schedule_state (schedule_id, node_id, applied_at)
       VALUES (?, ?, ?)
       ON CONFLICT(schedule_id, node_id) DO UPDATE SET applied_at = excluded.applied_at`,
    ).run(scheduleId, nodeId, now);
  }

  markRemoved(scheduleId: string, nodeId: string): void {
    const db = this.companionDb.db;
    if (!db) return;
    this.ensureSchema();
    db.prepare(
      `DELETE FROM dns_schedule_state WHERE schedule_id = ? AND node_id = ?`,
    ).run(scheduleId, nodeId);
  }

  // ── Evaluator settings ──────────────────────────────────────────────────────

  getEvaluatorEnabled(): boolean | null {
    const db = this.companionDb.db;
    if (!db) return null;
    this.ensureSchema();
    const row = db
      .prepare(
        `SELECT value FROM dns_schedule_settings WHERE key = 'evaluator_enabled'`,
      )
      .get() as { value: string } | undefined;
    return row ? row.value === "true" : null;
  }

  setEvaluatorEnabled(enabled: boolean): void {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO dns_schedule_settings (key, value) VALUES ('evaluator_enabled', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(enabled ? "true" : "false");
  }

  getEvaluatorIntervalMs(): number | null {
    const db = this.companionDb.db;
    if (!db) return null;
    this.ensureSchema();
    const row = db
      .prepare(
        `SELECT value FROM dns_schedule_settings WHERE key = 'evaluator_interval_ms'`,
      )
      .get() as { value: string } | undefined;
    if (!row) return null;
    const parsed = Number.parseInt(row.value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  setEvaluatorIntervalMs(intervalMs: number): void {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO dns_schedule_settings (key, value) VALUES ('evaluator_interval_ms', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(intervalMs));
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private getDb(): DatabaseSync {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        "DNS Schedules are disabled. Set DNS_SCHEDULES_ENABLED=true or unset it to enable this feature.",
      );
    }
    const db = this.companionDb.db;
    if (!db) {
      throw new ServiceUnavailableException("DNS Schedules storage is unavailable.");
    }
    this.ensureSchema();
    return db;
  }

  private initializeSchema(): void {
    const db = this.companionDb.db;
    if (!db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS dns_schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_lc TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        advanced_blocking_group_name TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('block', 'allow')),
        domain_entries_json TEXT NOT NULL,
        domain_group_names_json TEXT NOT NULL DEFAULT '[]',
        days_of_week_json TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        timezone TEXT NOT NULL,
        node_ids_json TEXT NOT NULL,
        flush_cache_on_change INTEGER NOT NULL DEFAULT 0,
        notify_emails_json TEXT NOT NULL DEFAULT '[]',
        notify_debounce_seconds INTEGER NOT NULL DEFAULT 300,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_dns_schedules_updated_at
        ON dns_schedules(updated_at);

      CREATE TABLE IF NOT EXISTS dns_schedule_state (
        schedule_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (schedule_id, node_id)
      );

      CREATE TABLE IF NOT EXISTS dns_schedule_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // Migrations for existing deployments — swallow errors when column already exists.
    for (const migration of [
      `ALTER TABLE dns_schedules ADD COLUMN domain_group_names_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE dns_schedules ADD COLUMN flush_cache_on_change INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE dns_schedules ADD COLUMN notify_emails_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE dns_schedules ADD COLUMN notify_debounce_seconds INTEGER NOT NULL DEFAULT 300`,
    ]) {
      try {
        db.exec(migration);
      } catch {
        // Column already present — no action needed.
      }
    }
  }

  private getSchedule(scheduleId: string): DnsSchedule {
    const db = this.getDb();
    const row = db
      .prepare(
        `SELECT id, name, enabled, advanced_blocking_group_name, action,
                domain_entries_json, domain_group_names_json, days_of_week_json, start_time, end_time,
                timezone, node_ids_json, flush_cache_on_change,
                notify_emails_json, notify_debounce_seconds, created_at, updated_at
         FROM dns_schedules WHERE id = ?`,
      )
      .get(scheduleId) as DnsScheduleRow | undefined;

    if (!row) {
      throw new NotFoundException("DNS schedule not found.");
    }

    return this.mapRow(row);
  }

  private mapRow(row: DnsScheduleRow): DnsSchedule {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      advancedBlockingGroupName: row.advanced_blocking_group_name,
      action: row.action,
      domainEntries: this.parseJsonStringArray(row.domain_entries_json, "domainEntries"),
      domainGroupNames: this.parseJsonStringArray(row.domain_group_names_json ?? "[]", "domainGroupNames"),
      daysOfWeek: this.parseJsonNumberArray(row.days_of_week_json, "daysOfWeek"),
      startTime: row.start_time,
      endTime: row.end_time,
      timezone: row.timezone,
      nodeIds: this.parseJsonStringArray(row.node_ids_json, "nodeIds"),
      flushCacheOnChange: (row.flush_cache_on_change ?? 0) === 1,
      notifyEmails: this.parseJsonStringArray(row.notify_emails_json ?? "[]", "notifyEmails"),
      notifyDebounceSeconds: row.notify_debounce_seconds ?? 300,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private parseJsonStringArray(raw: string, field: string): string[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      // fall through
    }
    this.logger.warn(`Invalid JSON for field "${field}" in dns_schedules: ${raw}`);
    return [];
  }

  private parseJsonNumberArray(raw: string, field: string): number[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is number => typeof v === "number");
      }
    } catch {
      // fall through
    }
    this.logger.warn(`Invalid JSON for field "${field}" in dns_schedules: ${raw}`);
    return [];
  }

  private assertDraftValid(draft: DnsScheduleDraft): void {
    if (!draft.name?.trim()) {
      throw new BadRequestException("name is required.");
    }
    if (draft.name.length > 120) {
      throw new BadRequestException("name cannot exceed 120 characters.");
    }
    if (!draft.advancedBlockingGroupName?.trim()) {
      throw new BadRequestException("advancedBlockingGroupName is required.");
    }
    if (draft.advancedBlockingGroupName.length > 200) {
      throw new BadRequestException("advancedBlockingGroupName cannot exceed 200 characters.");
    }
    if (!["block", "allow"].includes(draft.action)) {
      throw new BadRequestException("action must be 'block' or 'allow'.");
    }
    const hasDomainEntries = Array.isArray(draft.domainEntries) && draft.domainEntries.length > 0;
    const hasDomainGroups = Array.isArray(draft.domainGroupNames) && draft.domainGroupNames.length > 0;
    if (!hasDomainEntries && !hasDomainGroups) {
      throw new BadRequestException(
        "At least one domainEntry or domainGroupName is required.",
      );
    }
    for (const entry of (draft.domainEntries ?? [])) {
      if (typeof entry !== "string" || !entry.trim()) {
        throw new BadRequestException("Each domain entry must be a non-empty string.");
      }
      if (entry.length > 300) {
        throw new BadRequestException("Domain entry cannot exceed 300 characters.");
      }
    }
    if (!Array.isArray(draft.daysOfWeek)) {
      throw new BadRequestException("daysOfWeek must be an array.");
    }
    for (const day of draft.daysOfWeek) {
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        throw new BadRequestException("daysOfWeek values must be integers 0–6.");
      }
    }
    if (!this.isValidTime(draft.startTime)) {
      throw new BadRequestException("startTime must be in HH:MM format.");
    }
    if (!this.isValidTime(draft.endTime)) {
      throw new BadRequestException("endTime must be in HH:MM format.");
    }
    if (draft.startTime === draft.endTime) {
      throw new BadRequestException("startTime and endTime cannot be the same.");
    }
    if (!draft.timezone?.trim()) {
      throw new BadRequestException("timezone is required.");
    }
    if (!this.isValidTimezone(draft.timezone)) {
      throw new BadRequestException(
        `timezone "${draft.timezone}" is not a recognized IANA timezone.`,
      );
    }
    if (!Array.isArray(draft.nodeIds)) {
      throw new BadRequestException("nodeIds must be an array.");
    }
  }

  private isValidTime(value: string): boolean {
    if (typeof value !== "string") return false;
    return /^\d{2}:\d{2}$/.test(value.trim()) &&
      (() => {
        const [h, m] = value.trim().split(":").map(Number);
        return (h ?? 25) >= 0 && (h ?? 25) <= 23 && (m ?? 60) >= 0 && (m ?? 60) <= 59;
      })();
  }

  private isValidTimezone(tz: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }

  private isSqliteUniqueConstraintError(error: unknown): boolean {
    const e = error as { code?: string; errcode?: number; message?: string };
    if (e.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") return true;
    if (e.errcode === 2067) return true;
    return (e.message?.includes("UNIQUE constraint failed") ?? false);
  }
}
