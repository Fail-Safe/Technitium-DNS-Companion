import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { CompanionDbService } from "./companion-db.service";
import type {
  DnsTemporaryOverride,
  DnsTemporaryOverrideDraft,
} from "./dns-temporary-overrides.types";

type DnsTemporaryOverrideRow = {
  id: string;
  name: string;
  enabled: number;
  advanced_blocking_group_names_json: string;
  action: DnsTemporaryOverrideDraft["action"];
  domain_entries_json: string;
  domain_group_names_json: string;
  node_ids_json: string;
  flush_cache_on_change: number;
  notify_emails_json: string;
  notify_debounce_seconds: number;
  notify_message: string;
  notify_message_only: number;
  notify_subject_template: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type SqliteTableInfoRow = {
  name: string;
};

@Injectable()
export class DnsTemporaryOverridesService implements OnModuleInit {
  private readonly logger = new Logger(DnsTemporaryOverridesService.name);
  private schemaReady = false;

  constructor(private readonly companionDb: CompanionDbService) {}

  onModuleInit(): void {
    try {
      this.ensureSchema();
      this.logger.log(
        `DNS Temporary Overrides schema initialized in Companion SQLite at ${this.companionDb.dbPath}`,
      );
    } catch (error) {
      this.logger.error(
        "Failed to initialize DNS Temporary Overrides schema",
        error as Error,
      );
    }
  }

  private ensureSchema(): void {
    if (this.schemaReady) return;
    const db = this.companionDb.db;
    if (!db) return;
    db.exec(`
      CREATE TABLE IF NOT EXISTS dns_temporary_overrides (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_lc TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        advanced_blocking_group_names_json TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('block', 'allow')),
        domain_entries_json TEXT NOT NULL,
        domain_group_names_json TEXT NOT NULL,
        node_ids_json TEXT NOT NULL,
        flush_cache_on_change INTEGER NOT NULL DEFAULT 1,
        notify_emails_json TEXT NOT NULL DEFAULT '[]',
        notify_debounce_seconds INTEGER NOT NULL DEFAULT 300,
        notify_message TEXT NOT NULL DEFAULT '',
        notify_message_only INTEGER NOT NULL DEFAULT 0,
        notify_subject_template TEXT NOT NULL DEFAULT '',
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const existingColumns = new Set(
      (
        db
          .prepare(`PRAGMA table_info(dns_temporary_overrides)`)
          .all() as SqliteTableInfoRow[]
      ).map((row) => row.name),
    );
    const addColumnIfMissing = (name: string, definition: string) => {
      if (existingColumns.has(name)) return;
      db.exec(
        `ALTER TABLE dns_temporary_overrides ADD COLUMN ${name} ${definition}`,
      );
      existingColumns.add(name);
    };
    addColumnIfMissing("notify_emails_json", `TEXT NOT NULL DEFAULT '[]'`);
    addColumnIfMissing(
      "notify_debounce_seconds",
      `INTEGER NOT NULL DEFAULT 300`,
    );
    addColumnIfMissing("notify_message", `TEXT NOT NULL DEFAULT ''`);
    addColumnIfMissing("notify_message_only", `INTEGER NOT NULL DEFAULT 0`);
    addColumnIfMissing(
      "notify_subject_template",
      `TEXT NOT NULL DEFAULT ''`,
    );
    this.schemaReady = true;
  }

  listOverrides(): DnsTemporaryOverride[] {
    const db = this.companionDb.db;
    if (!db) return [];
    this.ensureSchema();
    const rows = db
      .prepare(
        `SELECT id, name, enabled, advanced_blocking_group_names_json, action,
                domain_entries_json, domain_group_names_json, node_ids_json,
                flush_cache_on_change, notify_emails_json,
                notify_debounce_seconds, notify_message, notify_message_only,
                notify_subject_template, expires_at, created_at, updated_at
         FROM dns_temporary_overrides
         ORDER BY enabled DESC, updated_at DESC, created_at DESC`,
      )
      .all() as DnsTemporaryOverrideRow[];
    return rows.map((row) => this.mapRow(row));
  }

  listActiveOverrides(now = new Date()): DnsTemporaryOverride[] {
    const nowMs = now.getTime();
    return this.listOverrides().filter((override) => {
      if (!override.enabled) return false;
      if (!override.expiresAt) return true;
      const expiresMs = Date.parse(override.expiresAt);
      return Number.isFinite(expiresMs) && expiresMs > nowMs;
    });
  }

  getOverride(id: string): DnsTemporaryOverride {
    const db = this.getDb();
    this.ensureSchema();
    const row = db
      .prepare(
        `SELECT id, name, enabled, advanced_blocking_group_names_json, action,
                domain_entries_json, domain_group_names_json, node_ids_json,
                flush_cache_on_change, notify_emails_json,
                notify_debounce_seconds, notify_message, notify_message_only,
                notify_subject_template, expires_at, created_at, updated_at
         FROM dns_temporary_overrides
         WHERE id = ?`,
      )
      .get(id) as DnsTemporaryOverrideRow | undefined;
    if (!row) throw new NotFoundException("Temporary override not found.");
    return this.mapRow(row);
  }

  createOverride(draft: DnsTemporaryOverrideDraft): DnsTemporaryOverride {
    const db = this.getDb();
    this.assertDraftValid(draft);
    const now = new Date().toISOString();
    const id = randomUUID();
    try {
      db.prepare(
        `INSERT INTO dns_temporary_overrides (
           id, name, name_lc, enabled, advanced_blocking_group_names_json, action,
           domain_entries_json, domain_group_names_json, node_ids_json,
           flush_cache_on_change, notify_emails_json, notify_debounce_seconds,
           notify_message, notify_message_only, notify_subject_template,
           expires_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        draft.name,
        draft.name.toLowerCase(),
        draft.enabled ? 1 : 0,
        JSON.stringify(draft.advancedBlockingGroupNames),
        draft.action,
        JSON.stringify(draft.domainEntries),
        JSON.stringify(draft.domainGroupNames),
        JSON.stringify(draft.nodeIds),
        draft.flushCacheOnChange ? 1 : 0,
        JSON.stringify(draft.notifyEmails),
        draft.notifyDebounceSeconds,
        draft.notifyMessage ?? "",
        draft.notifyMessageOnly ? 1 : 0,
        draft.notifySubjectTemplate ?? "",
        draft.expiresAt ?? null,
        now,
        now,
      );
    } catch (error) {
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new BadRequestException(
          "A temporary override with this name already exists.",
        );
      }
      throw error;
    }
    return this.getOverride(id);
  }

  updateOverride(
    id: string,
    draft: DnsTemporaryOverrideDraft,
  ): DnsTemporaryOverride {
    const db = this.getDb();
    this.assertDraftValid(draft);
    const now = new Date().toISOString();
    let result: { changes?: number | bigint };
    try {
      result = db
        .prepare(
          `UPDATE dns_temporary_overrides
         SET name = ?, name_lc = ?, enabled = ?,
             advanced_blocking_group_names_json = ?, action = ?,
             domain_entries_json = ?, domain_group_names_json = ?,
             node_ids_json = ?, flush_cache_on_change = ?,
             notify_emails_json = ?, notify_debounce_seconds = ?,
             notify_message = ?, notify_message_only = ?,
             notify_subject_template = ?, expires_at = ?, updated_at = ?
         WHERE id = ?`,
        )
        .run(
          draft.name,
          draft.name.toLowerCase(),
          draft.enabled ? 1 : 0,
          JSON.stringify(draft.advancedBlockingGroupNames),
          draft.action,
          JSON.stringify(draft.domainEntries),
          JSON.stringify(draft.domainGroupNames),
          JSON.stringify(draft.nodeIds),
          draft.flushCacheOnChange ? 1 : 0,
          JSON.stringify(draft.notifyEmails),
          draft.notifyDebounceSeconds,
          draft.notifyMessage ?? "",
          draft.notifyMessageOnly ? 1 : 0,
          draft.notifySubjectTemplate ?? "",
          draft.expiresAt ?? null,
          now,
          id,
        );
    } catch (error) {
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new BadRequestException(
          "A temporary override with this name already exists.",
        );
      }
      throw error;
    }
    if (Number(result.changes ?? 0) === 0) {
      throw new NotFoundException("Temporary override not found.");
    }
    return this.getOverride(id);
  }

  setOverrideEnabled(id: string, enabled: boolean): DnsTemporaryOverride {
    const db = this.getDb();
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE dns_temporary_overrides SET enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(enabled ? 1 : 0, now, id);
    if ((result.changes ?? 0) === 0) {
      throw new NotFoundException("Temporary override not found.");
    }
    return this.getOverride(id);
  }

  deleteOverride(id: string): { deleted: true; overrideId: string } {
    const db = this.getDb();
    const activeState = db
      .prepare(`SELECT 1 FROM dns_schedule_state WHERE schedule_id = ? LIMIT 1`)
      .get(id);
    if (activeState) {
      throw new BadRequestException(
        "End the temporary override before deleting it.",
      );
    }
    db
      .prepare(
        `DELETE FROM dns_schedule_applied_entries WHERE schedule_id = ?`,
      )
      .run(id);
    const result = db
      .prepare(`DELETE FROM dns_temporary_overrides WHERE id = ?`)
      .run(id);
    if ((result.changes ?? 0) === 0) {
      throw new NotFoundException("Temporary override not found.");
    }
    return { deleted: true, overrideId: id };
  }

  private mapRow(row: DnsTemporaryOverrideRow): DnsTemporaryOverride {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      advancedBlockingGroupNames: this.parseJsonStringArray(
        row.advanced_blocking_group_names_json,
      ),
      action: row.action,
      domainEntries: this.parseJsonStringArray(row.domain_entries_json),
      domainGroupNames: this.parseJsonStringArray(row.domain_group_names_json),
      nodeIds: this.parseJsonStringArray(row.node_ids_json),
      flushCacheOnChange: row.flush_cache_on_change === 1,
      notifyEmails: this.parseJsonStringArray(row.notify_emails_json),
      notifyDebounceSeconds: row.notify_debounce_seconds,
      notifyMessage: row.notify_message || undefined,
      notifyMessageOnly: row.notify_message_only === 1,
      notifySubjectTemplate: row.notify_subject_template || undefined,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private assertDraftValid(draft: DnsTemporaryOverrideDraft): void {
    if (!draft.name?.trim()) {
      throw new BadRequestException("name is required.");
    }
    if (!["block", "allow"].includes(draft.action)) {
      throw new BadRequestException("action must be 'block' or 'allow'.");
    }
    if (!Array.isArray(draft.advancedBlockingGroupNames)) {
      throw new BadRequestException(
        "advancedBlockingGroupNames must be an array.",
      );
    }
    if (draft.advancedBlockingGroupNames.length === 0) {
      throw new BadRequestException(
        "advancedBlockingGroupNames must contain at least one group.",
      );
    }
    if (
      !Array.isArray(draft.domainEntries) ||
      !Array.isArray(draft.domainGroupNames)
    ) {
      throw new BadRequestException(
        "domainEntries and domainGroupNames must be arrays.",
      );
    }
    if (
      draft.domainEntries.length === 0 &&
      draft.domainGroupNames.length === 0
    ) {
      throw new BadRequestException(
        "At least one domain entry or Domain Group is required.",
      );
    }
    if (!Array.isArray(draft.nodeIds)) {
      throw new BadRequestException("nodeIds must be an array.");
    }
    if (!Array.isArray(draft.notifyEmails)) {
      throw new BadRequestException("notifyEmails must be an array.");
    }
    if (
      !Number.isFinite(draft.notifyDebounceSeconds) ||
      draft.notifyDebounceSeconds < 0
    ) {
      throw new BadRequestException("notifyDebounceSeconds must be >= 0.");
    }
    if (draft.expiresAt) {
      const expiresMs = Date.parse(draft.expiresAt);
      if (!Number.isFinite(expiresMs)) {
        throw new BadRequestException("expiresAt must be an ISO timestamp.");
      }
    }
  }

  private parseJsonStringArray(value: string): string[] {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : [];
    } catch {
      return [];
    }
  }

  private getDb() {
    const db = this.companionDb.db;
    if (!db) {
      throw new BadRequestException("Companion SQLite is unavailable.");
    }
    this.ensureSchema();
    return db;
  }

  private isSqliteUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes("UNIQUE constraint failed") ||
        error.message.includes("SQLITE_CONSTRAINT_UNIQUE"))
    );
  }
}
