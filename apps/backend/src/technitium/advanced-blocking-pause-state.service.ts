import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { CompanionDbService } from "./companion-db.service";
import type {
  AdvancedBlockingPauseTarget,
  AdvancedBlockingPauseTargetStatus,
} from "./advanced-blocking-pause.types";

type PauseRow = {
  write_target_node_id: string;
  anchor_node_id: string | null;
  last_resolved_node_id: string | null;
  status: AdvancedBlockingPauseTargetStatus;
  expires_at: string;
  previous_enable_blocking_present: number | null;
  previous_enable_blocking_value: number | null;
  last_error: string | null;
  updated_at: string;
  capture_before_write: number;
};

/** Durable state for Companion-owned root Advanced Blocking pauses. */
@Injectable()
export class AdvancedBlockingPauseStateService implements OnModuleInit {
  private readonly logger = new Logger(AdvancedBlockingPauseStateService.name);
  constructor(private readonly companionDb: CompanionDbService) {}

  onModuleInit(): void {
    const db = this.companionDb.db;
    if (!db) {
      this.logger.error(
        "Advanced Blocking pause state is unavailable because Companion SQLite is unavailable.",
      );
      return;
    }
    db.exec(`CREATE TABLE IF NOT EXISTS advanced_blocking_pauses (
      write_target_node_id TEXT PRIMARY KEY, anchor_node_id TEXT, last_resolved_node_id TEXT,
      capture_before_write INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('activation-pending', 'active', 'resume-pending')),
      expires_at TEXT NOT NULL, previous_enable_blocking_present INTEGER CHECK (previous_enable_blocking_present IN (0, 1)),
      previous_enable_blocking_value INTEGER CHECK (previous_enable_blocking_value IN (0, 1)), last_error TEXT, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_advanced_blocking_pauses_expiry ON advanced_blocking_pauses(expires_at);`);
    const names = new Set(
      (
        db
          .prepare("PRAGMA table_info(advanced_blocking_pauses)")
          .all() as Array<{ name: string }>
      ).map((column) => column.name),
    );
    // The initial feature schema used a stricter status CHECK constraint, so
    // upgrade it by rebuilding once instead of issuing an invalid UPDATE.
    if (!names.has("anchor_node_id")) {
      db.exec("BEGIN;");
      try {
        db.exec(`
        CREATE TABLE advanced_blocking_pauses_next (
          write_target_node_id TEXT PRIMARY KEY, anchor_node_id TEXT,
          last_resolved_node_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('activation-pending', 'active', 'resume-pending')),
          expires_at TEXT NOT NULL,
          previous_enable_blocking_present INTEGER CHECK (previous_enable_blocking_present IN (0, 1)),
          previous_enable_blocking_value INTEGER CHECK (previous_enable_blocking_value IN (0, 1)),
          last_error TEXT, updated_at TEXT NOT NULL
        );
        INSERT INTO advanced_blocking_pauses_next
          SELECT write_target_node_id, write_target_node_id, NULL,
            CASE WHEN status = 'pause-pending' THEN 'activation-pending' ELSE status END,
            expires_at, previous_enable_blocking_present, previous_enable_blocking_value, last_error, updated_at
          FROM advanced_blocking_pauses;
        DROP TABLE advanced_blocking_pauses;
        ALTER TABLE advanced_blocking_pauses_next RENAME TO advanced_blocking_pauses;
        CREATE INDEX IF NOT EXISTS idx_advanced_blocking_pauses_expiry ON advanced_blocking_pauses(expires_at);
      `);
        db.exec("COMMIT;");
      } catch (error) {
        db.exec("ROLLBACK;");
        throw error;
      }
    } else {
      if (!names.has("last_resolved_node_id"))
        db.exec(
          "ALTER TABLE advanced_blocking_pauses ADD COLUMN last_resolved_node_id TEXT;",
        );
      db.exec(
        "UPDATE advanced_blocking_pauses SET anchor_node_id = write_target_node_id WHERE anchor_node_id IS NULL;",
      );
    }
    if (!names.has("capture_before_write")) {
      db.exec(
        "ALTER TABLE advanced_blocking_pauses ADD COLUMN capture_before_write INTEGER NOT NULL DEFAULT 0;",
      );
    }
  }
  list(): AdvancedBlockingPauseTarget[] {
    return (
      this.requireDb()
        .prepare(
          "SELECT * FROM advanced_blocking_pauses ORDER BY write_target_node_id",
        )
        .all() as PauseRow[]
    ).map((row) => this.toTarget(row));
  }
  get(targetKey: string): AdvancedBlockingPauseTarget | undefined {
    const row = this.requireDb()
      .prepare(
        "SELECT * FROM advanced_blocking_pauses WHERE write_target_node_id = ?",
      )
      .get(targetKey) as PauseRow | undefined;
    return row ? this.toTarget(row) : undefined;
  }
  isEnforced(targetKey: string): boolean {
    return this.get(targetKey)?.previousEnableBlockingPresent !== undefined;
  }
  beginPause(targetKey: string, anchorNodeId: string, expiresAt: string): void {
    const now = new Date().toISOString();
    this.requireDb()
      .prepare(
        `INSERT INTO advanced_blocking_pauses (write_target_node_id, anchor_node_id, status, expires_at, updated_at, capture_before_write) VALUES (?, ?, 'activation-pending', ?, ?, 1) ON CONFLICT(write_target_node_id) DO UPDATE SET anchor_node_id = excluded.anchor_node_id, expires_at = excluded.expires_at, status = 'activation-pending', last_error = NULL, updated_at = excluded.updated_at`,
      )
      .run(targetKey, anchorNodeId, expiresAt, now);
  }
  captureOriginal(
    targetKey: string,
    resolvedNodeId: string,
    previousPresent: boolean,
    previousValue: boolean | undefined,
  ): void {
    this.requireDb()
      .prepare(
        `UPDATE advanced_blocking_pauses
          SET last_resolved_node_id = ?,
              previous_enable_blocking_present = COALESCE(previous_enable_blocking_present, ?),
              previous_enable_blocking_value = CASE
                WHEN previous_enable_blocking_present IS NULL THEN ?
                ELSE previous_enable_blocking_value
              END,
              updated_at = ?
          WHERE write_target_node_id = ?`,
      )
      .run(
        resolvedNodeId,
        previousPresent ? 1 : 0,
        previousValue === undefined ? null : previousValue ? 1 : 0,
        new Date().toISOString(),
        targetKey,
      );
    if (
      this.requireDb()
        .prepare(
          "SELECT 1 FROM advanced_blocking_pauses WHERE write_target_node_id = ?",
        )
        .get(targetKey) === undefined
    ) {
      throw new Error(
        "Advanced Blocking pause ownership was removed before its baseline could be recorded.",
      );
    }
  }

  markVerified(targetKey: string, resolvedNodeId: string): void {
    this.requireDb()
      .prepare(
        `UPDATE advanced_blocking_pauses
          SET last_resolved_node_id = ?, last_error = NULL
          WHERE write_target_node_id = ?`,
      )
      .run(resolvedNodeId, targetKey);
  }
  activate(
    targetKey: string,
    resolvedNodeId: string,
    previousPresent: boolean,
    previousValue: boolean | undefined,
  ): void {
    this.requireDb()
      .prepare(
        `UPDATE advanced_blocking_pauses SET status = 'active', last_resolved_node_id = ?, previous_enable_blocking_present = COALESCE(previous_enable_blocking_present, ?), previous_enable_blocking_value = CASE WHEN previous_enable_blocking_present IS NULL THEN ? ELSE previous_enable_blocking_value END, last_error = NULL, updated_at = ? WHERE write_target_node_id = ?`,
      )
      .run(
        resolvedNodeId,
        previousPresent ? 1 : 0,
        previousValue === undefined ? null : previousValue ? 1 : 0,
        new Date().toISOString(),
        targetKey,
      );
    if (
      this.requireDb()
        .prepare(
          "SELECT 1 FROM advanced_blocking_pauses WHERE write_target_node_id = ?",
        )
        .get(targetKey) === undefined
    ) {
      throw new Error(
        "Advanced Blocking pause ownership was removed before activation could be recorded.",
      );
    }
  }
  /** Adopt a validated replacement Primary without changing pause ownership. */
  adoptResolvedAnchor(targetKey: string, resolvedNodeId: string): void {
    this.requireDb()
      .prepare(
        `UPDATE advanced_blocking_pauses
          SET anchor_node_id = ?, last_resolved_node_id = ?
          WHERE write_target_node_id = ?`,
      )
      .run(resolvedNodeId, resolvedNodeId, targetKey);
  }
  migrateLegacyKey(oldTargetKey: string, newTargetKey: string): void {
    if (oldTargetKey === newTargetKey) return;
    const db = this.requireDb();
    db.exec("BEGIN;");
    try {
      const existing = db
        .prepare(
          "SELECT 1 FROM advanced_blocking_pauses WHERE write_target_node_id = ?",
        )
        .get(newTargetKey);
      if (existing) {
        throw new Error(
          "A durable pause already exists for the resolved ownership key.",
        );
      }
      db.prepare(
        "UPDATE advanced_blocking_pauses SET write_target_node_id = ?, updated_at = ? WHERE write_target_node_id = ?",
      ).run(newTargetKey, new Date().toISOString(), oldTargetKey);
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
  requestResume(targetKey: string): void {
    const now = new Date().toISOString();
    this.requireDb()
      .prepare(
        "UPDATE advanced_blocking_pauses SET expires_at = ?, status = 'resume-pending', last_error = NULL, updated_at = ? WHERE write_target_node_id = ?",
      )
      .run(now, now, targetKey);
  }
  markVerificationFailed(
    targetKey: string,
    error: string,
    expectedUpdatedAt: string,
  ): void {
    this.requireDb()
      .prepare(
        "UPDATE advanced_blocking_pauses SET last_error = ? WHERE write_target_node_id = ? AND updated_at = ?",
      )
      .run(error, targetKey, expectedUpdatedAt);
  }
  markActivationPending(targetKey: string, error: string): void {
    this.mark(targetKey, "activation-pending", error);
  }
  markResumePending(
    targetKey: string,
    error: string,
    expectedUpdatedAt?: string,
  ): void {
    this.mark(targetKey, "resume-pending", error, expectedUpdatedAt);
  }
  remove(targetKey: string): void {
    this.requireDb()
      .prepare(
        "DELETE FROM advanced_blocking_pauses WHERE write_target_node_id = ?",
      )
      .run(targetKey);
  }
  private mark(
    targetKey: string,
    status: AdvancedBlockingPauseTargetStatus,
    error: string,
    expectedUpdatedAt?: string,
  ): void {
    this.requireDb()
      .prepare(
        "UPDATE advanced_blocking_pauses SET status = ?, last_error = ?, updated_at = ? WHERE write_target_node_id = ? AND (? IS NULL OR updated_at = ?)",
      )
      .run(
        status,
        error,
        new Date().toISOString(),
        targetKey,
        expectedUpdatedAt ?? null,
        expectedUpdatedAt ?? null,
      );
  }
  private requireDb() {
    const db = this.companionDb.db;
    if (!db)
      throw new Error(
        "Companion SQLite is unavailable; Advanced Blocking pauses cannot be managed safely.",
      );
    return db;
  }
  private toTarget(row: PauseRow): AdvancedBlockingPauseTarget {
    return {
      writeTargetNodeId: row.write_target_node_id,
      anchorNodeId: row.anchor_node_id ?? row.write_target_node_id,
      ...(row.last_resolved_node_id
        ? { lastResolvedNodeId: row.last_resolved_node_id }
        : {}),
      status: row.status,
      captureBeforeWrite: row.capture_before_write === 1,
      expiresAt: row.expires_at,
      ...(row.previous_enable_blocking_present === null
        ? {}
        : {
            previousEnableBlockingPresent:
              row.previous_enable_blocking_present === 1,
          }),
      ...(row.previous_enable_blocking_value === null
        ? {}
        : {
            previousEnableBlockingValue:
              row.previous_enable_blocking_value === 1,
          }),
      ...(row.last_error ? { lastError: row.last_error } : {}),
      updatedAt: row.updated_at,
    };
  }
}
