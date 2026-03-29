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
  LogAlertRule,
  LogAlertRuleDraft,
  LogAlertRulesStorageStatus,
} from "./log-alerts.types";

type LogAlertRuleRow = {
  id: string;
  name: string;
  display_name: string | null;
  notify_message: string | null;
  notify_message_only: number;
  enabled: number;
  outcome_mode: LogAlertRuleDraft["outcomeMode"];
  domain_pattern: string;
  domain_pattern_type: LogAlertRuleDraft["domainPatternType"];
  client_identifier: string | null;
  advanced_blocking_group_names: string | null;
  debounce_seconds: number;
  email_recipients_json: string;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class LogAlertsRulesService implements OnModuleInit {
  private readonly logger = new Logger(LogAlertsRulesService.name);

  private readonly enabled =
    (process.env.LOG_ALERT_RULES_ENABLED ?? "true").trim().toLowerCase() !==
    "false";

  private schemaReady = false;

  constructor(private readonly companionDb: CompanionDbService) {}

  /**
   * Idempotent schema bootstrap — safe to call before onModuleInit.
   * The evaluator service reads settings in its own onModuleInit, which may
   * fire before this service's onModuleInit due to NestJS lifecycle ordering.
   * Calling ensureSchema() at the top of any read method prevents the
   * "no such table" crash on first boot or fresh databases.
   */
  private ensureSchema(): void {
    if (this.schemaReady) return;
    const db = this.companionDb.db;
    if (!db) return;
    this.initializeSchema();
    this.migrateSchema();
    this.schemaReady = true;
  }

  getStatus(): LogAlertRulesStorageStatus {
    return {
      enabled: this.enabled,
      ready: this.enabled && this.companionDb.db !== null,
      dbPath: this.enabled ? this.companionDb.dbPath : undefined,
    };
  }

  onModuleInit(): void {
    this.logger.log(
      `Log Alerts Rules config: enabled=${this.enabled}, dbPath=${this.companionDb.dbPath}`,
    );

    if (!this.enabled) {
      this.logger.log(
        "Log alert rules are disabled (LOG_ALERT_RULES_ENABLED=false).",
      );
      return;
    }

    try {
      this.ensureSchema();
      this.logger.log(
        `Log alert rules schema initialized in Companion SQLite at ${this.companionDb.dbPath}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize log alert rules schema`,
        error as Error,
      );
    }
  }

  listRules(): LogAlertRule[] {
    const db = this.getDb();
    const rows = db
      .prepare(
        `
        SELECT
          id,
          name,
          display_name,
          notify_message,
          notify_message_only,
          enabled,
          outcome_mode,
          domain_pattern,
          domain_pattern_type,
          client_identifier,
          advanced_blocking_group_names,
          debounce_seconds,
          email_recipients_json,
          created_at,
          updated_at
        FROM log_alert_rules
        ORDER BY updated_at DESC, created_at DESC
      `,
      )
      .all() as LogAlertRuleRow[];

    return rows.map((row) => this.mapRow(row));
  }

  createRule(rule: LogAlertRuleDraft): LogAlertRule {
    const db = this.getDb();
    this.assertRuleMaxLengths(rule);
    const now = new Date().toISOString();
    const id = randomUUID();
    const nameLc = rule.name.toLowerCase();

    try {
      db.prepare(
        `
        INSERT INTO log_alert_rules (
          id,
          name,
          name_lc,
          display_name,
          notify_message,
          notify_message_only,
          enabled,
          outcome_mode,
          domain_pattern,
          domain_pattern_type,
          client_identifier,
          advanced_blocking_group_names,
          debounce_seconds,
          email_recipients_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        rule.name,
        nameLc,
        rule.displayName?.trim() || null,
        rule.notifyMessage?.trim() || null,
        rule.notifyMessageOnly ? 1 : 0,
        rule.enabled ? 1 : 0,
        rule.outcomeMode,
        rule.domainPattern,
        rule.domainPatternType,
        rule.clientIdentifier ?? null,
        rule.advancedBlockingGroupNames &&
          rule.advancedBlockingGroupNames.length > 0
          ? JSON.stringify(rule.advancedBlockingGroupNames)
          : null,
        rule.debounceSeconds,
        JSON.stringify(rule.emailRecipients),
        now,
        now,
      );
    } catch (error) {
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new BadRequestException(
          "A log alert rule with this name already exists.",
        );
      }
      throw error;
    }

    return this.getRule(id);
  }

  updateRule(ruleId: string, rule: LogAlertRuleDraft): LogAlertRule {
    const db = this.getDb();
    this.assertRuleMaxLengths(rule);
    const now = new Date().toISOString();
    const nameLc = rule.name.toLowerCase();

    try {
      const result = db
        .prepare(
          `
          UPDATE log_alert_rules
          SET name = ?,
              name_lc = ?,
              display_name = ?,
              notify_message = ?,
              notify_message_only = ?,
              enabled = ?,
              outcome_mode = ?,
              domain_pattern = ?,
              domain_pattern_type = ?,
              client_identifier = ?,
              advanced_blocking_group_names = ?,
              debounce_seconds = ?,
              email_recipients_json = ?,
              updated_at = ?
          WHERE id = ?
        `,
        )
        .run(
          rule.name,
          nameLc,
          rule.displayName?.trim() || null,
          rule.notifyMessage?.trim() || null,
          rule.notifyMessageOnly ? 1 : 0,
          rule.enabled ? 1 : 0,
          rule.outcomeMode,
          rule.domainPattern,
          rule.domainPatternType,
          rule.clientIdentifier ?? null,
          rule.advancedBlockingGroupNames &&
            rule.advancedBlockingGroupNames.length > 0
            ? JSON.stringify(rule.advancedBlockingGroupNames)
            : null,
          rule.debounceSeconds,
          JSON.stringify(rule.emailRecipients),
          now,
          ruleId,
        );

      if ((result.changes ?? 0) === 0) {
        throw new NotFoundException("Log alert rule not found.");
      }
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new BadRequestException(
          "A log alert rule with this name already exists.",
        );
      }
      throw error;
    }

    return this.getRule(ruleId);
  }

  setRuleEnabled(ruleId: string, enabled: boolean): LogAlertRule {
    const db = this.getDb();
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `
        UPDATE log_alert_rules
        SET enabled = ?, updated_at = ?
        WHERE id = ?
      `,
      )
      .run(enabled ? 1 : 0, now, ruleId);

    if ((result.changes ?? 0) === 0) {
      throw new NotFoundException("Log alert rule not found.");
    }

    return this.getRule(ruleId);
  }

  deleteRule(ruleId: string): { deleted: true; ruleId: string } {
    const db = this.getDb();
    const result = db
      .prepare("DELETE FROM log_alert_rules WHERE id = ?")
      .run(ruleId);

    if ((result.changes ?? 0) === 0) {
      throw new NotFoundException("Log alert rule not found.");
    }

    return { deleted: true, ruleId };
  }

  private getDb(): DatabaseSync {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        "Log alert rules are disabled. Set LOG_ALERT_RULES_ENABLED=true or unset it to enable this feature.",
      );
    }

    const db = this.companionDb.db;
    if (!db) {
      throw new ServiceUnavailableException(
        "Log alert rules storage is unavailable.",
      );
    }

    return db;
  }

  private migrateSchema(): void {
    const db = this.getDb();
    const cols = db.prepare(`PRAGMA table_info(log_alert_rules)`).all() as {
      name: string;
    }[];
    const hasOld = cols.some((c) => c.name === "advanced_blocking_group_name");
    const hasNew = cols.some((c) => c.name === "advanced_blocking_group_names");
    if (hasOld && !hasNew) {
      db.exec(
        `ALTER TABLE log_alert_rules RENAME COLUMN advanced_blocking_group_name TO advanced_blocking_group_names`,
      );
      this.logger.log(
        "Migrated log_alert_rules: renamed advanced_blocking_group_name → advanced_blocking_group_names",
      );
    }
    const newColumns = [
      `ALTER TABLE log_alert_rules ADD COLUMN display_name TEXT`,
      `ALTER TABLE log_alert_rules ADD COLUMN notify_message TEXT`,
      `ALTER TABLE log_alert_rules ADD COLUMN notify_message_only INTEGER NOT NULL DEFAULT 0`,
    ];
    for (const sql of newColumns) {
      try {
        db.prepare(sql).run();
      } catch {
        // Column already present — no action needed.
      }
    }
  }

  private initializeSchema(): void {
    const db = this.getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS log_alert_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_lc TEXT NOT NULL UNIQUE,
        display_name TEXT,
        notify_message TEXT,
        notify_message_only INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        outcome_mode TEXT NOT NULL CHECK (outcome_mode IN ('blocked-only', 'all-outcomes')),
        domain_pattern TEXT NOT NULL,
        domain_pattern_type TEXT NOT NULL CHECK (domain_pattern_type IN ('exact', 'wildcard', 'regex')),
        client_identifier TEXT,
        advanced_blocking_group_names TEXT,
        debounce_seconds INTEGER NOT NULL,
        email_recipients_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_log_alert_rules_updated_at
        ON log_alert_rules(updated_at);

      CREATE TABLE IF NOT EXISTS log_alert_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  getEvaluatorEnabled(): boolean | null {
    const db = this.companionDb.db;
    if (!db) {
      return null;
    }
    this.ensureSchema();
    const row = db
      .prepare(
        `SELECT value FROM log_alert_settings WHERE key = 'evaluator_enabled'`,
      )
      .get() as { value: string } | undefined;
    if (!row) {
      return null;
    }
    return row.value === "true";
  }

  setEvaluatorEnabled(enabled: boolean): void {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO log_alert_settings (key, value) VALUES ('evaluator_enabled', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(enabled ? "true" : "false");
  }

  getEvaluatorIntervalMs(): number | null {
    const db = this.companionDb.db;
    if (!db) {
      return null;
    }
    this.ensureSchema();
    const row = db
      .prepare(
        `SELECT value FROM log_alert_settings WHERE key = 'evaluator_interval_ms'`,
      )
      .get() as { value: string } | undefined;
    if (!row) {
      return null;
    }
    const parsed = Number.parseInt(row.value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  setEvaluatorIntervalMs(intervalMs: number): void {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO log_alert_settings (key, value) VALUES ('evaluator_interval_ms', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(intervalMs));
  }

  getEvaluatorLookbackSeconds(): number | null {
    const db = this.companionDb.db;
    if (!db) {
      return null;
    }
    this.ensureSchema();
    const row = db
      .prepare(
        `SELECT value FROM log_alert_settings WHERE key = 'evaluator_lookback_seconds'`,
      )
      .get() as { value: string } | undefined;
    if (!row) {
      return null;
    }
    const parsed = Number.parseInt(row.value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  setEvaluatorLookbackSeconds(seconds: number): void {
    const db = this.getDb();
    db.prepare(
      `INSERT INTO log_alert_settings (key, value) VALUES ('evaluator_lookback_seconds', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(String(seconds));
  }

  private parseGroupNames(raw: string | null): string[] | undefined {
    if (!raw) return undefined;
    // Try JSON array first (new format: ["Group1","Group2"])
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const names = parsed
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0);
        return names.length > 0 ? names : undefined;
      }
    } catch {
      // Fall through to legacy string handling
    }
    // Legacy single-string value stored without JSON wrapping
    const trimmed = raw.trim();
    return trimmed.length > 0 ? [trimmed] : undefined;
  }

  private mapRow(row: LogAlertRuleRow): LogAlertRule {
    let emailRecipients: string[];
    try {
      const parsed = JSON.parse(row.email_recipients_json) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("invalid-recipient-array");
      }

      const recipients: string[] = [];
      for (const value of parsed as unknown[]) {
        if (typeof value !== "string") {
          throw new Error("invalid-recipient-array");
        }
        recipients.push(value);
      }
      emailRecipients = recipients;
    } catch {
      throw new ServiceUnavailableException(
        `Stored log alert rule "${row.id}" has invalid recipient data.`,
      );
    }

    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name ?? undefined,
      notifyMessage: row.notify_message ?? undefined,
      notifyMessageOnly: row.notify_message_only === 1,
      enabled: row.enabled === 1,
      outcomeMode: row.outcome_mode,
      domainPattern: row.domain_pattern,
      domainPatternType: row.domain_pattern_type,
      clientIdentifier: row.client_identifier ?? undefined,
      advancedBlockingGroupNames: this.parseGroupNames(
        row.advanced_blocking_group_names,
      ),
      debounceSeconds: row.debounce_seconds,
      emailRecipients,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getRule(ruleId: string): LogAlertRule {
    const db = this.getDb();
    const row = db
      .prepare(
        `
        SELECT
          id,
          name,
          display_name,
          notify_message,
          notify_message_only,
          enabled,
          outcome_mode,
          domain_pattern,
          domain_pattern_type,
          client_identifier,
          advanced_blocking_group_names,
          debounce_seconds,
          email_recipients_json,
          created_at,
          updated_at
        FROM log_alert_rules
        WHERE id = ?
      `,
      )
      .get(ruleId) as LogAlertRuleRow | undefined;

    if (!row) {
      throw new NotFoundException("Log alert rule not found.");
    }

    return this.mapRow(row);
  }

  private assertRuleMaxLengths(rule: LogAlertRuleDraft): void {
    this.assertMaxLength("Rule name", rule.name, 120);
    this.assertMaxLength("Display name", rule.displayName, 120);
    this.assertMaxLength("Domain pattern", rule.domainPattern, 300);
    this.assertMaxLength("Client identifier", rule.clientIdentifier, 200);
    this.assertMaxLength("Notify message", rule.notifyMessage, 2000);
    for (const groupName of rule.advancedBlockingGroupNames ?? []) {
      this.assertMaxLength("Advanced Blocking group", groupName, 200);
    }
    for (const recipient of rule.emailRecipients) {
      this.assertMaxLength("Email recipient", recipient, 320);
    }
  }

  private assertMaxLength(
    label: string,
    value: string | undefined,
    max: number,
  ): void {
    if (!value) {
      return;
    }

    if (value.length > max) {
      throw new BadRequestException(
        `${label} cannot exceed ${max} characters.`,
      );
    }
  }

  private isSqliteUniqueConstraintError(error: unknown): boolean {
    const sqliteError = error as {
      code?: string;
      errcode?: number;
      errstr?: string;
      message?: string;
    };

    if (sqliteError.code === "ERR_SQLITE_CONSTRAINT_UNIQUE") {
      return true;
    }

    if (sqliteError.errcode === 2067) {
      return true;
    }

    return (
      sqliteError.errstr?.includes("UNIQUE constraint failed") === true ||
      sqliteError.message?.includes("UNIQUE constraint failed") === true
    );
  }
}
