import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { DatabaseSync } from "node:sqlite";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import type {
  AdvancedBlockingConfig,
  AdvancedBlockingGroup,
} from "./advanced-blocking.types";
import { CompanionDbService } from "./companion-db.service";
import { DnsFilteringSnapshotService } from "./dns-filtering-snapshot.service";
import type {
  DomainGroup,
  DomainGroupBinding,
  DomainGroupBindingAction,
  DomainGroupBindingSummary,
  DomainGroupConflict,
  DomainGroupDetails,
  DomainGroupEntry,
  DomainGroupEntryMatchType,
  DomainGroupMaterializationPreview,
  DomainGroupMaterializedGroup,
  DomainGroupOwnedPair,
  DomainGroupTrackedPair,
  DomainGroupsApplyRequest,
  DomainGroupsApplyResult,
  DomainGroupsStatus,
  UnifiedExportAbGroup,
  UnifiedExportDg,
  UnifiedExportData,
  UnifiedImportDomainsMode,
  UnifiedImportRequest,
  UnifiedImportResult,
} from "./domain-groups.types";
import { TechnitiumService } from "./technitium.service";

type DomainGroupRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type DomainGroupEntryRow = {
  id: string;
  domain_group_id: string;
  match_type: DomainGroupEntryMatchType;
  value: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type DomainGroupBindingRow = {
  id: string;
  domain_group_id: string;
  advanced_blocking_group_name: string;
  action: DomainGroupBindingAction;
  created_at: string;
  updated_at: string;
};

type MaterializationRow = {
  domain_group_id: string;
  domain_group_name: string;
  advanced_blocking_group_name: string;
  action: DomainGroupBindingAction;
  match_type: DomainGroupEntryMatchType;
  value: string;
  normalized_value: string;
};

@Injectable()
export class DomainGroupsService implements OnModuleInit {
  private readonly logger = new Logger(DomainGroupsService.name);
  private readonly enabled =
    (process.env.DOMAIN_GROUPS_ENABLED ?? "true").trim().toLowerCase() !==
    "false";

  constructor(
    private readonly companionDb: CompanionDbService,
    private readonly advancedBlockingService: AdvancedBlockingService,
    private readonly technitiumService: TechnitiumService,
    private readonly dnsFilteringSnapshotService: DnsFilteringSnapshotService,
  ) {}

  getStatus(): DomainGroupsStatus {
    return {
      enabled: this.enabled,
      ready: this.enabled && this.companionDb.db !== null,
      dbPath: this.enabled ? this.companionDb.dbPath : undefined,
    };
  }

  onModuleInit(): void {
    this.logger.log(
      `Domain Groups config: enabled=${this.enabled}, dbPath=${this.companionDb.dbPath}`,
    );

    if (!this.enabled) {
      this.logger.log(
        "Domain Groups are disabled (DOMAIN_GROUPS_ENABLED=false).",
      );
      return;
    }

    try {
      this.initializeSchema();
      this.logger.log(
        `Domain Groups schema initialized in Companion SQLite at ${this.companionDb.dbPath}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize Domain Groups schema`,
        error as Error,
      );
    }
  }

  private getDb(): DatabaseSync {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        "Domain Groups are disabled. Set DOMAIN_GROUPS_ENABLED=true or unset it to enable this feature.",
      );
    }

    const db = this.companionDb.db;
    if (!db) {
      throw new ServiceUnavailableException(
        "Domain Groups storage is unavailable.",
      );
    }
    return db;
  }

  private initializeSchema(): void {
    const db = this.getDb();

    db.exec(`
      CREATE TABLE IF NOT EXISTS domain_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_lc TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS domain_group_entries (
        id TEXT PRIMARY KEY,
        domain_group_id TEXT NOT NULL,
        match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'regex')),
        value TEXT NOT NULL,
        normalized_value TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (domain_group_id) REFERENCES domain_groups(id) ON DELETE CASCADE,
        UNIQUE (domain_group_id, match_type, normalized_value)
      );

      CREATE INDEX IF NOT EXISTS idx_domain_group_entries_group_id
        ON domain_group_entries(domain_group_id);

      CREATE TABLE IF NOT EXISTS domain_group_bindings (
        id TEXT PRIMARY KEY,
        domain_group_id TEXT NOT NULL,
        advanced_blocking_group_name TEXT NOT NULL,
        advanced_blocking_group_name_lc TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('allow', 'block')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (domain_group_id) REFERENCES domain_groups(id) ON DELETE CASCADE,
        UNIQUE (domain_group_id, advanced_blocking_group_name_lc, action)
      );

      CREATE INDEX IF NOT EXISTS idx_domain_group_bindings_group_id
        ON domain_group_bindings(domain_group_id);

      CREATE TABLE IF NOT EXISTS domain_group_applied_entries (
        advanced_blocking_group_name_lc TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('allow', 'block')),
        value TEXT NOT NULL,
        PRIMARY KEY (advanced_blocking_group_name_lc, action, value)
      );
    `);
  }

  private normalizeGroupName(value: string): string {
    return value.trim();
  }

  private requireString(value: unknown, label: string): string {
    if (typeof value !== "string") {
      throw new BadRequestException(`${label} is required.`);
    }

    return value;
  }

  private validateMatchType(input: unknown): DomainGroupEntryMatchType {
    if (typeof input !== "string" || (input !== "exact" && input !== "regex")) {
      throw new BadRequestException('matchType must be "exact" or "regex".');
    }
    return input;
  }

  private normalizeDescription(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private isValidExactDomain(value: string): boolean {
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(
      value,
    );
  }

  private getExactDomainValidationError(value: string): string | null {
    if (value.startsWith(".")) {
      return 'Exact domain cannot start with ".".';
    }

    if (value.includes("*")) {
      return 'Exact domain cannot include wildcard "*". Use regex match type for wildcard-style patterns.';
    }

    if (value.includes("..")) {
      return "Exact domain cannot contain consecutive dots.";
    }

    if (!/^[a-z0-9.-]+$/i.test(value)) {
      return "Exact domain can only contain letters, numbers, dots, and hyphens.";
    }

    const labels = value.split(".");
    for (const label of labels) {
      if (!label) {
        return "Exact domain cannot contain empty labels.";
      }

      if (label.startsWith("-") || label.endsWith("-")) {
        return "Exact domain labels cannot start or end with a hyphen.";
      }
    }

    if (!this.isValidExactDomain(value)) {
      return "Exact domain value is invalid. Example valid values: example.com, sub.example.com, local-host.";
    }

    return null;
  }

  private normalizeEntryValue(
    matchType: DomainGroupEntryMatchType,
    value: string,
  ): { value: string; normalizedValue: string } {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      throw new BadRequestException("Entry value is required.");
    }

    if (matchType === "exact") {
      const normalized = trimmed.toLowerCase().replace(/\.+$/, "");
      if (normalized.length === 0) {
        throw new BadRequestException("Exact domain value is invalid.");
      }

      const exactDomainValidationError =
        this.getExactDomainValidationError(normalized);
      if (exactDomainValidationError) {
        throw new BadRequestException(exactDomainValidationError);
      }

      return { value: normalized, normalizedValue: normalized };
    }

    try {
      void new RegExp(trimmed);
    } catch {
      throw new BadRequestException("Regex entry is invalid.");
    }

    return { value: trimmed, normalizedValue: trimmed };
  }

  private normalizeNote(value: unknown): string | undefined {
    if (typeof value !== "string") {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
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

    const message = (sqliteError.message ?? "").toLowerCase();
    if (message.includes("unique constraint failed")) {
      return true;
    }

    const errstr = (sqliteError.errstr ?? "").toLowerCase();
    return errstr.includes("constraint failed");
  }

  private mapDomainGroup(row: DomainGroupRow): DomainGroup {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapDomainGroupEntry(row: DomainGroupEntryRow): DomainGroupEntry {
    return {
      id: row.id,
      domainGroupId: row.domain_group_id,
      matchType: row.match_type,
      value: row.value,
      note: row.note ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapDomainGroupBinding(
    row: DomainGroupBindingRow,
  ): DomainGroupBinding {
    return {
      id: row.id,
      domainGroupId: row.domain_group_id,
      advancedBlockingGroupName: row.advanced_blocking_group_name,
      action: row.action,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private ensureGroupExists(groupId: string): DomainGroupRow {
    const db = this.getDb();
    const row = db
      .prepare("SELECT * FROM domain_groups WHERE id = ?")
      .get(groupId) as DomainGroupRow | undefined;

    if (!row) {
      throw new NotFoundException(`Domain Group "${groupId}" was not found.`);
    }

    return row;
  }

  listDomainGroups(): DomainGroup[] {
    const db = this.getDb();
    const rows = db
      .prepare("SELECT * FROM domain_groups ORDER BY name_lc ASC")
      .all() as DomainGroupRow[];
    return rows.map((row) => this.mapDomainGroup(row));
  }

  getDomainGroup(groupId: string): DomainGroupDetails {
    const db = this.getDb();
    const group = this.ensureGroupExists(groupId);

    const entries = db
      .prepare(
        "SELECT * FROM domain_group_entries WHERE domain_group_id = ? ORDER BY match_type ASC, normalized_value ASC",
      )
      .all(groupId) as DomainGroupEntryRow[];

    const bindings = db
      .prepare(
        "SELECT * FROM domain_group_bindings WHERE domain_group_id = ? ORDER BY advanced_blocking_group_name_lc ASC, action ASC",
      )
      .all(groupId) as DomainGroupBindingRow[];

    return {
      ...this.mapDomainGroup(group),
      entries: entries.map((row) => this.mapDomainGroupEntry(row)),
      bindings: bindings.map((row) => this.mapDomainGroupBinding(row)),
    };
  }

  createDomainGroup(input: {
    name?: unknown;
    description?: unknown;
  }): DomainGroupDetails {
    const db = this.getDb();
    const name = this.normalizeGroupName(
      this.requireString(input.name, "Domain Group name"),
    );
    if (!name) {
      throw new BadRequestException("Domain Group name is required.");
    }
    this.assertMaxLength("Domain Group name", name, 80);

    const description = this.normalizeDescription(input.description);
    this.assertMaxLength("Domain Group description", description, 1000);

    const now = new Date().toISOString();
    const id = randomUUID();

    try {
      db.prepare(
        "INSERT INTO domain_groups (id, name, name_lc, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, name, name.toLowerCase(), description ?? null, now, now);
    } catch (error) {
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new ConflictException(
          `Domain Group name "${name}" already exists.`,
        );
      }
      throw error;
    }

    return this.getDomainGroup(id);
  }

  updateDomainGroup(
    groupId: string,
    input: { name?: unknown; description?: unknown },
  ): DomainGroup {
    const db = this.getDb();
    const existing = this.ensureGroupExists(groupId);

    const nextName =
      input.name === undefined
        ? existing.name
        : this.normalizeGroupName(
            this.requireString(input.name, "Domain Group name"),
          );
    if (!nextName) {
      throw new BadRequestException("Domain Group name is required.");
    }
    this.assertMaxLength("Domain Group name", nextName, 80);

    const nextDescription =
      input.description === undefined
        ? (existing.description ?? undefined)
        : this.normalizeDescription(input.description);
    this.assertMaxLength("Domain Group description", nextDescription, 1000);

    const now = new Date().toISOString();

    try {
      db.prepare(
        "UPDATE domain_groups SET name = ?, name_lc = ?, description = ?, updated_at = ? WHERE id = ?",
      ).run(
        nextName,
        nextName.toLowerCase(),
        nextDescription ?? null,
        now,
        groupId,
      );
    } catch (error) {
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new ConflictException(
          `Domain Group name "${nextName}" already exists.`,
        );
      }
      throw error;
    }

    const row = db
      .prepare("SELECT * FROM domain_groups WHERE id = ?")
      .get(groupId) as DomainGroupRow;
    return this.mapDomainGroup(row);
  }

  deleteDomainGroup(groupId: string): { deleted: boolean } {
    const db = this.getDb();
    this.ensureGroupExists(groupId);
    db.prepare("DELETE FROM domain_groups WHERE id = ?").run(groupId);
    return { deleted: true };
  }

  addEntry(
    groupId: string,
    input: { matchType?: unknown; value?: unknown; note?: unknown },
  ): DomainGroupEntry {
    const db = this.getDb();
    this.ensureGroupExists(groupId);

    const matchType = this.validateMatchType(input.matchType);

    const { value, normalizedValue } = this.normalizeEntryValue(
      matchType,
      this.requireString(input.value, "Entry value"),
    );

    const note = this.normalizeNote(input.note);
    this.assertMaxLength("Entry note", note, 1000);

    const now = new Date().toISOString();
    const id = randomUUID();

    try {
      db.prepare(
        "INSERT INTO domain_group_entries (id, domain_group_id, match_type, value, normalized_value, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        groupId,
        matchType,
        value,
        normalizedValue,
        note ?? null,
        now,
        now,
      );
    } catch (error) {
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new ConflictException(
          `Entry "${value}" (${matchType}) already exists in this Domain Group.`,
        );
      }
      throw error;
    }

    const row = db
      .prepare("SELECT * FROM domain_group_entries WHERE id = ?")
      .get(id) as DomainGroupEntryRow;
    return this.mapDomainGroupEntry(row);
  }

  updateEntry(
    groupId: string,
    entryId: string,
    input: { matchType?: unknown; value?: unknown; note?: unknown },
  ): DomainGroupEntry {
    const db = this.getDb();
    this.ensureGroupExists(groupId);

    const existing = db
      .prepare(
        "SELECT * FROM domain_group_entries WHERE id = ? AND domain_group_id = ?",
      )
      .get(entryId, groupId) as DomainGroupEntryRow | undefined;

    if (!existing) {
      throw new NotFoundException(
        `Entry "${entryId}" was not found in Domain Group "${groupId}".`,
      );
    }

    const nextMatchType =
      input.matchType === undefined
        ? existing.match_type
        : this.validateMatchType(input.matchType);

    const { value, normalizedValue } = this.normalizeEntryValue(
      nextMatchType,
      input.value === undefined
        ? existing.value
        : this.requireString(input.value, "Entry value"),
    );

    const nextNote =
      input.note === undefined
        ? (existing.note ?? undefined)
        : this.normalizeNote(input.note);
    this.assertMaxLength("Entry note", nextNote, 1000);

    const now = new Date().toISOString();

    try {
      db.prepare(
        "UPDATE domain_group_entries SET match_type = ?, value = ?, normalized_value = ?, note = ?, updated_at = ? WHERE id = ? AND domain_group_id = ?",
      ).run(
        nextMatchType,
        value,
        normalizedValue,
        nextNote ?? null,
        now,
        entryId,
        groupId,
      );
    } catch (error) {
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new ConflictException(
          `Entry "${value}" (${nextMatchType}) already exists in this Domain Group.`,
        );
      }
      throw error;
    }

    const row = db
      .prepare("SELECT * FROM domain_group_entries WHERE id = ?")
      .get(entryId) as DomainGroupEntryRow;
    return this.mapDomainGroupEntry(row);
  }

  removeEntry(groupId: string, entryId: string): { deleted: boolean } {
    const db = this.getDb();
    const result = db
      .prepare(
        "DELETE FROM domain_group_entries WHERE id = ? AND domain_group_id = ?",
      )
      .run(entryId, groupId);

    if (result.changes === 0) {
      throw new NotFoundException(
        `Entry "${entryId}" was not found in Domain Group "${groupId}".`,
      );
    }

    return { deleted: true };
  }

  addBinding(
    groupId: string,
    input: { advancedBlockingGroupName?: unknown; action?: unknown },
  ): DomainGroupBinding {
    const db = this.getDb();
    this.ensureGroupExists(groupId);

    const advancedBlockingGroupName = this.requireString(
      input.advancedBlockingGroupName,
      "advancedBlockingGroupName",
    ).trim();
    if (!advancedBlockingGroupName) {
      throw new BadRequestException("advancedBlockingGroupName is required.");
    }
    this.assertMaxLength(
      "Advanced Blocking group name",
      advancedBlockingGroupName,
      120,
    );

    if (typeof input.action !== "string") {
      throw new BadRequestException('action must be "allow" or "block".');
    }

    const action = input.action as DomainGroupBindingAction;
    if (action !== "allow" && action !== "block") {
      throw new BadRequestException('action must be "allow" or "block".');
    }

    const now = new Date().toISOString();
    const id = randomUUID();

    try {
      db.prepare(
        "INSERT INTO domain_group_bindings (id, domain_group_id, advanced_blocking_group_name, advanced_blocking_group_name_lc, action, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        groupId,
        advancedBlockingGroupName,
        advancedBlockingGroupName.toLowerCase(),
        action,
        now,
        now,
      );
    } catch (error) {
      if (this.isSqliteUniqueConstraintError(error)) {
        throw new ConflictException(
          `Binding already exists for group "${advancedBlockingGroupName}" with action "${action}".`,
        );
      }
      throw error;
    }

    const row = db
      .prepare("SELECT * FROM domain_group_bindings WHERE id = ?")
      .get(id) as DomainGroupBindingRow;
    return this.mapDomainGroupBinding(row);
  }

  removeBinding(groupId: string, bindingId: string): { deleted: boolean } {
    const db = this.getDb();
    const result = db
      .prepare(
        "DELETE FROM domain_group_bindings WHERE id = ? AND domain_group_id = ?",
      )
      .run(bindingId, groupId);

    if (result.changes === 0) {
      throw new NotFoundException(
        `Binding "${bindingId}" was not found in Domain Group "${groupId}".`,
      );
    }

    return { deleted: true };
  }

  getMaterializationPreview(): DomainGroupMaterializationPreview {
    const db = this.getDb();
    const rows = db
      .prepare(
        `
          SELECT
            g.id AS domain_group_id,
            g.name AS domain_group_name,
            b.advanced_blocking_group_name,
            b.action,
            e.match_type,
            e.value,
            e.normalized_value
          FROM domain_groups g
          JOIN domain_group_bindings b
            ON b.domain_group_id = g.id
          JOIN domain_group_entries e
            ON e.domain_group_id = g.id
        `,
      )
      .all() as MaterializationRow[];

    type Accumulated = {
      advancedBlockingGroupName: string;
      matchType: DomainGroupEntryMatchType;
      value: string;
      normalizedValue: string;
      actions: Set<DomainGroupBindingAction>;
      domainGroupIds: Set<string>;
      domainGroupNames: Set<string>;
    };

    const byKey = new Map<string, Accumulated>();

    for (const row of rows) {
      const key = [
        row.advanced_blocking_group_name.toLowerCase(),
        row.match_type,
        row.normalized_value,
      ].join("||");

      const current = byKey.get(key);
      if (current) {
        current.actions.add(row.action);
        current.domainGroupIds.add(row.domain_group_id);
        current.domainGroupNames.add(row.domain_group_name);
        continue;
      }

      byKey.set(key, {
        advancedBlockingGroupName: row.advanced_blocking_group_name,
        matchType: row.match_type,
        value: row.value,
        normalizedValue: row.normalized_value,
        actions: new Set([row.action]),
        domainGroupIds: new Set([row.domain_group_id]),
        domainGroupNames: new Set([row.domain_group_name]),
      });
    }

    const conflicts: DomainGroupConflict[] = [];
    const groupsByName = new Map<
      string,
      {
        advancedBlockingGroupName: string;
        allowed: Set<string>;
        blocked: Set<string>;
        allowedRegex: Set<string>;
        blockedRegex: Set<string>;
      }
    >();

    for (const item of byKey.values()) {
      const actions = [...item.actions].sort();
      if (actions.length > 1) {
        conflicts.push({
          advancedBlockingGroupName: item.advancedBlockingGroupName,
          matchType: item.matchType,
          value: item.value,
          actions,
          domainGroupIds: [...item.domainGroupIds].sort(),
          domainGroupNames: [...item.domainGroupNames].sort(),
        });
        continue;
      }

      const action = actions[0];
      const nameKey = item.advancedBlockingGroupName.toLowerCase();
      const bucket = groupsByName.get(nameKey) ?? {
        advancedBlockingGroupName: item.advancedBlockingGroupName,
        allowed: new Set<string>(),
        blocked: new Set<string>(),
        allowedRegex: new Set<string>(),
        blockedRegex: new Set<string>(),
      };

      if (item.matchType === "exact") {
        if (action === "allow") {
          bucket.allowed.add(item.value);
        } else {
          bucket.blocked.add(item.value);
        }
      } else if (action === "allow") {
        bucket.allowedRegex.add(item.value);
      } else {
        bucket.blockedRegex.add(item.value);
      }

      groupsByName.set(nameKey, bucket);
    }

    const ownedPairRows = db
      .prepare(
        `SELECT DISTINCT advanced_blocking_group_name, action
         FROM domain_group_bindings
         ORDER BY advanced_blocking_group_name_lc ASC, action ASC`,
      )
      .all() as {
      advanced_blocking_group_name: string;
      action: "allow" | "block";
    }[];

    const allBindingRows = db
      .prepare(
        `SELECT b.id as binding_id, b.domain_group_id, dg.name as domain_group_name,
                b.advanced_blocking_group_name, b.action
         FROM domain_group_bindings b
         JOIN domain_groups dg ON dg.id = b.domain_group_id
         ORDER BY dg.name_lc ASC`,
      )
      .all() as {
      binding_id: string;
      domain_group_id: string;
      domain_group_name: string;
      advanced_blocking_group_name: string;
      action: "allow" | "block";
    }[];

    const allTrackedRows = db
      .prepare(
        `SELECT advanced_blocking_group_name_lc, action, value
         FROM domain_group_applied_entries
         ORDER BY advanced_blocking_group_name_lc ASC, action ASC, value ASC`,
      )
      .all() as {
      advanced_blocking_group_name_lc: string;
      action: "allow" | "block";
      value: string;
    }[];

    const trackedMap = new Map<string, string[]>();
    for (const row of allTrackedRows) {
      const key = `${row.advanced_blocking_group_name_lc}||${row.action}`;
      if (!trackedMap.has(key)) trackedMap.set(key, []);
      trackedMap.get(key)!.push(row.value);
    }

    return {
      generatedAt: new Date().toISOString(),
      hasConflicts: conflicts.length > 0,
      conflicts: conflicts.sort((a, b) => {
        const groupCompare = a.advancedBlockingGroupName.localeCompare(
          b.advancedBlockingGroupName,
        );
        if (groupCompare !== 0) {
          return groupCompare;
        }

        const matchCompare = a.matchType.localeCompare(b.matchType);
        if (matchCompare !== 0) {
          return matchCompare;
        }

        return a.value.localeCompare(b.value);
      }),
      groups: [...groupsByName.values()]
        .map((group) => ({
          advancedBlockingGroupName: group.advancedBlockingGroupName,
          allowed: [...group.allowed].sort((a, b) => a.localeCompare(b)),
          blocked: [...group.blocked].sort((a, b) => a.localeCompare(b)),
          allowedRegex: [...group.allowedRegex].sort((a, b) =>
            a.localeCompare(b),
          ),
          blockedRegex: [...group.blockedRegex].sort((a, b) =>
            a.localeCompare(b),
          ),
        }))
        .sort((a, b) =>
          a.advancedBlockingGroupName.localeCompare(
            b.advancedBlockingGroupName,
          ),
        ),
      ownedPairs: ownedPairRows.map(
        (row): DomainGroupOwnedPair => ({
          advancedBlockingGroupName: row.advanced_blocking_group_name,
          action: row.action,
        }),
      ),
      pendingPairs: ownedPairRows
        .filter((row): boolean => {
          const nameLc = row.advanced_blocking_group_name.toLowerCase();
          const matBucket = groupsByName.get(nameLc);
          const matValues =
            row.action === "allow"
              ? [
                  ...(matBucket?.allowed ?? []),
                  ...(matBucket?.allowedRegex ?? []),
                ]
              : [
                  ...(matBucket?.blocked ?? []),
                  ...(matBucket?.blockedRegex ?? []),
                ];

          const tracked = trackedMap.get(`${nameLc}||${row.action}`) ?? [];

          if (tracked.length !== matValues.length) return true;
          const trackedSet = new Set(tracked);
          return matValues.some((v) => !trackedSet.has(v));
        })
        .map(
          (row): DomainGroupOwnedPair => ({
            advancedBlockingGroupName: row.advanced_blocking_group_name,
            action: row.action,
          }),
        ),
      allBindings: allBindingRows.map(
        (row): DomainGroupBindingSummary => ({
          bindingId: row.binding_id,
          domainGroupId: row.domain_group_id,
          domainGroupName: row.domain_group_name,
          advancedBlockingGroupName: row.advanced_blocking_group_name,
          action: row.action,
        }),
      ),
      trackedGroups: ownedPairRows.map(
        (row): DomainGroupTrackedPair => ({
          advancedBlockingGroupName: row.advanced_blocking_group_name,
          action: row.action,
          values:
            trackedMap.get(
              `${row.advanced_blocking_group_name.toLowerCase()}||${row.action}`,
            ) ?? [],
        }),
      ),
    };
  }

  private createEmptyAdvancedBlockingGroup(
    name: string,
  ): AdvancedBlockingGroup {
    return {
      name,
      blockingAddresses: [],
      allowed: [],
      blocked: [],
      allowListUrls: [],
      blockListUrls: [],
      allowedRegex: [],
      blockedRegex: [],
      regexAllowListUrls: [],
      regexBlockListUrls: [],
      adblockListUrls: [],
    };
  }

  private normalizeNodeIds(nodeIds: unknown): string[] {
    if (!Array.isArray(nodeIds)) {
      return [];
    }

    const unique = new Set<string>();
    for (const nodeId of nodeIds) {
      if (typeof nodeId !== "string") {
        continue;
      }
      const trimmed = nodeId.trim();
      if (!trimmed) {
        continue;
      }
      unique.add(trimmed);
    }

    return [...unique];
  }

  private applyMaterializedGroupsToConfig(
    config: AdvancedBlockingConfig,
    materializedGroups: DomainGroupMaterializedGroup[],
    ownedPairs: DomainGroupOwnedPair[],
  ): {
    nextConfig: AdvancedBlockingConfig;
    updatedGroups: string[];
    skippedGroups: string[];
    commitTracking: () => void;
  } {
    const db = this.getDb();
    const groups = [...(config.groups ?? [])];
    const groupByNameLc = new Map(
      groups.map((group) => [group.name.toLowerCase(), group]),
    );

    const updatedGroups: string[] = [];
    const skippedGroups: string[] = [];

    // Pending tracking mutations — applied after a successful setConfig call.
    const trackingWrites: Array<{
      nameLc: string;
      action: "allow" | "block";
      values: string[];
    }> = [];
    const trackingDeletes: Array<{
      nameLc: string;
      action: "allow" | "block";
    }> = [];

    // Build a lookup Set of owned (AB group, action) pairs for O(1) checks.
    const ownedKeys = new Set(
      ownedPairs.map(
        (p) => `${p.advancedBlockingGroupName.toLowerCase()}||${p.action}`,
      ),
    );

    // Pre-load all tracked entries once to avoid per-call DB queries.
    const allAppliedRows = db
      .prepare(
        `SELECT advanced_blocking_group_name_lc, action, value
         FROM domain_group_applied_entries`,
      )
      .all() as {
      advanced_blocking_group_name_lc: string;
      action: string;
      value: string;
    }[];
    const appliedMap = new Map<string, Set<string>>();
    for (const row of allAppliedRows) {
      const key = `${row.advanced_blocking_group_name_lc}||${row.action}`;
      if (!appliedMap.has(key)) appliedMap.set(key, new Set());
      appliedMap.get(key)!.add(row.value);
    }
    const getTracked = (nameLc: string, action: string): Set<string> =>
      appliedMap.get(`${nameLc}||${action}`) ?? new Set();

    // Track which AB group names were processed in the first pass.
    const processedKeys = new Set<string>();

    // --- First pass: process materialized groups ---
    for (const materialized of materializedGroups) {
      const key = materialized.advancedBlockingGroupName.toLowerCase();
      const existing = groupByNameLc.get(key);
      const isAllowOwned = ownedKeys.has(`${key}||allow`);
      const isBlockOwned = ownedKeys.has(`${key}||block`);

      processedKeys.add(key);

      if (!existing) {
        // New AB group — create it with DG entries directly.
        const nextGroup = this.createEmptyAdvancedBlockingGroup(
          materialized.advancedBlockingGroupName,
        );
        nextGroup.allowed = materialized.allowed;
        nextGroup.blocked = materialized.blocked;
        nextGroup.allowedRegex = materialized.allowedRegex;
        nextGroup.blockedRegex = materialized.blockedRegex;
        groups.push(nextGroup);
        groupByNameLc.set(key, nextGroup);
        updatedGroups.push(materialized.advancedBlockingGroupName);
        if (isAllowOwned)
          trackingWrites.push({
            nameLc: key,
            action: "allow",
            values: [...materialized.allowed, ...materialized.allowedRegex],
          });
        if (isBlockOwned)
          trackingWrites.push({
            nameLc: key,
            action: "block",
            values: [...materialized.blocked, ...materialized.blockedRegex],
          });
        continue;
      }

      const beforeSignature = JSON.stringify({
        allowed: existing.allowed,
        blocked: existing.blocked,
        allowedRegex: existing.allowedRegex,
        blockedRegex: existing.blockedRegex,
      });

      // Allow side: tracking-aware merge for owned pairs, plain merge otherwise.
      if (isAllowOwned) {
        const prevDg = getTracked(key, "allow");
        const manualAllowed = (existing.allowed ?? []).filter(
          (v) => !prevDg.has(v),
        );
        const manualAllowedRegex = (existing.allowedRegex ?? []).filter(
          (v) => !prevDg.has(v),
        );
        existing.allowed = [
          ...new Set([...manualAllowed, ...materialized.allowed]),
        ];
        existing.allowedRegex = [
          ...new Set([...manualAllowedRegex, ...materialized.allowedRegex]),
        ];
        trackingWrites.push({
          nameLc: key,
          action: "allow",
          values: [...materialized.allowed, ...materialized.allowedRegex],
        });
      } else {
        existing.allowed = [
          ...new Set([...(existing.allowed ?? []), ...materialized.allowed]),
        ];
        existing.allowedRegex = [
          ...new Set([
            ...(existing.allowedRegex ?? []),
            ...materialized.allowedRegex,
          ]),
        ];
      }

      // Block side: tracking-aware merge for owned pairs, plain merge otherwise.
      if (isBlockOwned) {
        const prevDg = getTracked(key, "block");
        const manualBlocked = (existing.blocked ?? []).filter(
          (v) => !prevDg.has(v),
        );
        const manualBlockedRegex = (existing.blockedRegex ?? []).filter(
          (v) => !prevDg.has(v),
        );
        existing.blocked = [
          ...new Set([...manualBlocked, ...materialized.blocked]),
        ];
        existing.blockedRegex = [
          ...new Set([...manualBlockedRegex, ...materialized.blockedRegex]),
        ];
        trackingWrites.push({
          nameLc: key,
          action: "block",
          values: [...materialized.blocked, ...materialized.blockedRegex],
        });
      } else {
        existing.blocked = [
          ...new Set([...(existing.blocked ?? []), ...materialized.blocked]),
        ];
        existing.blockedRegex = [
          ...new Set([
            ...(existing.blockedRegex ?? []),
            ...materialized.blockedRegex,
          ]),
        ];
      }

      const afterSignature = JSON.stringify({
        allowed: existing.allowed,
        blocked: existing.blocked,
        allowedRegex: existing.allowedRegex,
        blockedRegex: existing.blockedRegex,
      });

      if (beforeSignature === afterSignature) {
        skippedGroups.push(materialized.advancedBlockingGroupName);
      } else {
        updatedGroups.push(materialized.advancedBlockingGroupName);
      }
    }

    // --- Second pass: owned pairs with no materialized entries ---
    // A DG is still bound but all its entries were removed or conflicted.
    // Remove any entries this pair previously contributed.
    for (const pair of ownedPairs) {
      const key = pair.advancedBlockingGroupName.toLowerCase();
      if (processedKeys.has(key)) continue; // handled in first pass

      const prevDg = getTracked(key, pair.action);
      // Always write to tracking to mark this pair as known (even if now empty).
      trackingWrites.push({ nameLc: key, action: pair.action, values: [] });

      if (prevDg.size === 0) continue; // nothing was previously DG-applied

      const existing = groupByNameLc.get(key);
      if (!existing) continue;

      const before = JSON.stringify([
        existing.allowed,
        existing.blocked,
        existing.allowedRegex,
        existing.blockedRegex,
      ]);

      if (pair.action === "allow") {
        existing.allowed = (existing.allowed ?? []).filter(
          (v) => !prevDg.has(v),
        );
        existing.allowedRegex = (existing.allowedRegex ?? []).filter(
          (v) => !prevDg.has(v),
        );
      } else {
        existing.blocked = (existing.blocked ?? []).filter(
          (v) => !prevDg.has(v),
        );
        existing.blockedRegex = (existing.blockedRegex ?? []).filter(
          (v) => !prevDg.has(v),
        );
      }

      const after = JSON.stringify([
        existing.allowed,
        existing.blocked,
        existing.allowedRegex,
        existing.blockedRegex,
      ]);

      const origName =
        groups.find((g) => g.name.toLowerCase() === key)?.name ??
        pair.advancedBlockingGroupName;
      (before !== after ? updatedGroups : skippedGroups).push(origName);
    }

    // --- Third pass: unbound pairs with tracking data ---
    // A binding was removed — clean up only the DG-contributed entries.
    const allTrackedPairRows = db
      .prepare(
        `SELECT DISTINCT advanced_blocking_group_name_lc, action
         FROM domain_group_applied_entries`,
      )
      .all() as {
      advanced_blocking_group_name_lc: string;
      action: "allow" | "block";
    }[];

    for (const trackedPair of allTrackedPairRows) {
      const key = trackedPair.advanced_blocking_group_name_lc;
      if (ownedKeys.has(`${key}||${trackedPair.action}`)) continue; // still owned

      const prevDg = getTracked(key, trackedPair.action);
      trackingDeletes.push({ nameLc: key, action: trackedPair.action });

      if (prevDg.size === 0) continue;

      const existing = groupByNameLc.get(key);
      if (!existing) continue;

      const before = JSON.stringify([
        existing.allowed,
        existing.blocked,
        existing.allowedRegex,
        existing.blockedRegex,
      ]);

      if (trackedPair.action === "allow") {
        existing.allowed = (existing.allowed ?? []).filter(
          (v) => !prevDg.has(v),
        );
        existing.allowedRegex = (existing.allowedRegex ?? []).filter(
          (v) => !prevDg.has(v),
        );
      } else {
        existing.blocked = (existing.blocked ?? []).filter(
          (v) => !prevDg.has(v),
        );
        existing.blockedRegex = (existing.blockedRegex ?? []).filter(
          (v) => !prevDg.has(v),
        );
      }

      const after = JSON.stringify([
        existing.allowed,
        existing.blocked,
        existing.allowedRegex,
        existing.blockedRegex,
      ]);

      const origName =
        groups.find((g) => g.name.toLowerCase() === key)?.name ?? key;
      (before !== after ? updatedGroups : skippedGroups).push(origName);
    }

    // commitTracking writes tracking mutations after a successful setConfig.
    const commitTracking = (): void => {
      const deleteStmt = db.prepare(
        `DELETE FROM domain_group_applied_entries
         WHERE advanced_blocking_group_name_lc = ? AND action = ?`,
      );
      const insertStmt = db.prepare(
        `INSERT INTO domain_group_applied_entries
         (advanced_blocking_group_name_lc, action, value) VALUES (?, ?, ?)`,
      );
      for (const write of trackingWrites) {
        deleteStmt.run(write.nameLc, write.action);
        for (const value of write.values) {
          insertStmt.run(write.nameLc, write.action, value);
        }
      }
      for (const del of trackingDeletes) {
        deleteStmt.run(del.nameLc, del.action);
      }
    };

    return {
      nextConfig: { ...config, groups },
      updatedGroups: [...new Set(updatedGroups)].sort((a, b) =>
        a.localeCompare(b),
      ),
      skippedGroups: [...new Set(skippedGroups)].sort((a, b) =>
        a.localeCompare(b),
      ),
      commitTracking,
    };
  }

  async applyMaterialization(
    input: DomainGroupsApplyRequest,
  ): Promise<DomainGroupsApplyResult> {
    const preview = this.getMaterializationPreview();

    if (preview.hasConflicts) {
      throw new ConflictException({
        message:
          "Domain Groups materialization has allow/block conflicts at the same specificity. Resolve conflicts before apply.",
        conflicts: preview.conflicts,
      });
    }

    const summaries = await this.technitiumService.listNodes();
    const requestedNodeIds = this.normalizeNodeIds(input.nodeIds);
    const dryRun = input.dryRun === true;

    if (
      Object.prototype.hasOwnProperty.call(input, "allowSecondaryWrites") &&
      (input as { allowSecondaryWrites?: boolean }).allowSecondaryWrites ===
        true
    ) {
      throw new BadRequestException(
        "allowSecondaryWrites is not supported. In cluster mode, Domain Groups apply is restricted to Primary nodes only.",
      );
    }

    const primaryNodeIds = summaries
      .filter((summary) => summary.isPrimary === true)
      .map((summary) => summary.id);
    const primaryNodeIdSetLc = new Set(
      primaryNodeIds.map((nodeId) => nodeId.toLowerCase()),
    );
    const clusterPrimaryGuardActive = primaryNodeIds.length > 0;

    const selectedNodeIds =
      requestedNodeIds.length > 0
        ? requestedNodeIds
        : clusterPrimaryGuardActive
          ? primaryNodeIds
          : summaries.map((summary) => summary.id);

    const summaryByIdLc = new Map(
      summaries.map((summary) => [summary.id.toLowerCase(), summary]),
    );

    for (const nodeId of selectedNodeIds) {
      if (!summaryByIdLc.has(nodeId.toLowerCase())) {
        throw new BadRequestException(
          `Node "${nodeId}" is not configured in TECHNITIUM_NODES.`,
        );
      }
    }

    if (clusterPrimaryGuardActive) {
      const nonPrimaryTargets = selectedNodeIds.filter(
        (nodeId) => !primaryNodeIdSetLc.has(nodeId.toLowerCase()),
      );

      if (nonPrimaryTargets.length > 0) {
        throw new BadRequestException(
          `Cluster write guard: apply is restricted to Primary nodes. Non-primary targets: ${nonPrimaryTargets.join(", ")}.`,
        );
      }
    }

    const nodeResults: DomainGroupsApplyResult["nodes"] = [];

    for (const nodeId of selectedNodeIds) {
      const summary = summaryByIdLc.get(nodeId.toLowerCase());
      if (!summary) {
        continue;
      }

      try {
        const snapshot = await this.advancedBlockingService.getSnapshot(
          summary.id,
        );

        if (!snapshot.config) {
          nodeResults.push({
            nodeId: summary.id,
            updatedGroups: [],
            skippedGroups: [],
            error:
              snapshot.error ||
              "Advanced Blocking config is unavailable on this node.",
          });
          continue;
        }

        const { nextConfig, updatedGroups, skippedGroups, commitTracking } =
          this.applyMaterializedGroupsToConfig(
            snapshot.config,
            preview.groups,
            preview.ownedPairs,
          );

        if (!dryRun) {
          if (updatedGroups.length > 0) {
            try {
              await this.dnsFilteringSnapshotService.saveSnapshot(
                summary.id,
                "advanced-blocking",
                "domain-groups",
              );
            } catch (snapshotError) {
              this.logger.warn(
                `Failed to save pre-apply snapshot for node ${summary.id}: ${(snapshotError as Error).message}`,
              );
            }
            await this.advancedBlockingService.setConfig(
              summary.id,
              nextConfig,
            );
          }
          // Update tracking after successful setConfig (or immediately if no changes).
          commitTracking();
        }

        nodeResults.push({ nodeId: summary.id, updatedGroups, skippedGroups });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        nodeResults.push({
          nodeId: summary.id,
          updatedGroups: [],
          skippedGroups: [],
          error: message,
        });
      }
    }

    const appliedNodeIds = nodeResults
      .filter((result) => !result.error)
      .map((result) => result.nodeId)
      .sort((a, b) => a.localeCompare(b));

    const skippedNodeIds = summaries
      .map((summary) => summary.id)
      .filter(
        (nodeId) =>
          !selectedNodeIds.some(
            (selectedNodeId) =>
              selectedNodeId.toLowerCase() === nodeId.toLowerCase(),
          ),
      )
      .sort((a, b) => a.localeCompare(b));

    return {
      generatedAt: new Date().toISOString(),
      dryRun,
      appliedNodeIds,
      skippedNodeIds,
      conflicts: preview.conflicts,
      nodes: nodeResults,
    };
  }

  private findGroupByNameLc(
    db: DatabaseSync,
    nameLc: string,
  ): { id: string } | null {
    return (
      (db
        .prepare(`SELECT id FROM domain_groups WHERE name_lc = ?`)
        .get(nameLc) as { id: string } | undefined) ?? null
    );
  }

  async exportUnifiedConfig(nodeId: string): Promise<UnifiedExportData> {
    const snapshot = await this.advancedBlockingService.getSnapshot(nodeId);
    if (!snapshot.config) {
      throw new BadRequestException(
        "No Advanced Blocking config available for this node",
      );
    }
    return this.buildUnifiedExportData(snapshot.config.groups);
  }

  private buildUnifiedExportData(
    abGroups: AdvancedBlockingGroup[],
  ): UnifiedExportData {
    const db = this.getDb();

    // 1. DG-tracked entries — exclude these from plain domain lists
    const tracked = db
      .prepare(
        `SELECT advanced_blocking_group_name_lc, action, value FROM domain_group_applied_entries`,
      )
      .all() as {
      advanced_blocking_group_name_lc: string;
      action: "allow" | "block";
      value: string;
    }[];
    const trackedBlocked = new Map<string, Set<string>>();
    const trackedAllowed = new Map<string, Set<string>>();
    for (const t of tracked) {
      const map = t.action === "block" ? trackedBlocked : trackedAllowed;
      if (!map.has(t.advanced_blocking_group_name_lc))
        map.set(t.advanced_blocking_group_name_lc, new Set());
      map.get(t.advanced_blocking_group_name_lc)!.add(t.value);
    }

    // 2. Bindings — derive blockDomainGroups / allowDomainGroups per AB group
    const bindings = db
      .prepare(
        `SELECT b.advanced_blocking_group_name_lc, b.action, dg.name AS dg_name
         FROM domain_group_bindings b JOIN domain_groups dg ON dg.id = b.domain_group_id
         ORDER BY dg.name_lc ASC`,
      )
      .all() as {
      advanced_blocking_group_name_lc: string;
      action: "allow" | "block";
      dg_name: string;
    }[];
    const blockDgsByGroup = new Map<string, string[]>();
    const allowDgsByGroup = new Map<string, string[]>();
    for (const b of bindings) {
      const map = b.action === "block" ? blockDgsByGroup : allowDgsByGroup;
      if (!map.has(b.advanced_blocking_group_name_lc))
        map.set(b.advanced_blocking_group_name_lc, []);
      map.get(b.advanced_blocking_group_name_lc)!.push(b.dg_name);
    }

    // 3. Build groups Record
    const groups: Record<string, UnifiedExportAbGroup> = {};
    for (const g of abGroups) {
      const lc = g.name.toLowerCase();
      groups[g.name] = {
        blockDomains: g.blocked.filter((v) => !trackedBlocked.get(lc)?.has(v)),
        allowDomains: g.allowed.filter((v) => !trackedAllowed.get(lc)?.has(v)),
        blockRegex: g.blockedRegex,
        allowRegex: g.allowedRegex,
        blockDomainGroups: blockDgsByGroup.get(lc) ?? [],
        allowDomainGroups: allowDgsByGroup.get(lc) ?? [],
      };
    }

    // 4. Build domainGroups Record (bulk queries)
    const dgs = db
      .prepare(
        `SELECT id, name, description FROM domain_groups ORDER BY name_lc ASC`,
      )
      .all() as { id: string; name: string; description: string | null }[];
    const dgEntries = db
      .prepare(
        `SELECT domain_group_id, match_type, value, note FROM domain_group_entries ORDER BY value ASC`,
      )
      .all() as {
      domain_group_id: string;
      match_type: "exact" | "regex";
      value: string;
      note: string | null;
    }[];

    const entriesByGroup = new Map<string, typeof dgEntries>();
    for (const e of dgEntries) {
      if (!entriesByGroup.has(e.domain_group_id))
        entriesByGroup.set(e.domain_group_id, []);
      entriesByGroup.get(e.domain_group_id)!.push(e);
    }

    const domainGroups: Record<string, UnifiedExportDg> = {};
    for (const dg of dgs) {
      domainGroups[dg.name] = {
        ...(dg.description ? { description: dg.description } : {}),
        entries: (entriesByGroup.get(dg.id) ?? []).map((e) => ({
          value: e.value,
          type: e.match_type,
          ...(e.note ? { note: e.note } : {}),
        })),
      };
    }

    return { groups, domainGroups };
  }

  private buildAbConfigForImport(
    currentConfig: import("./advanced-blocking.types").AdvancedBlockingConfig,
    importGroups: UnifiedImportRequest["data"]["groups"],
    mode: UnifiedImportDomainsMode,
  ): {
    config: import("./advanced-blocking.types").AdvancedBlockingConfig;
    updatedGroups: string[];
    skippedGroups: string[];
  } {
    if (!importGroups || mode === "skip") {
      return { config: currentConfig, updatedGroups: [], skippedGroups: [] };
    }

    const db = this.getDb();
    const tracked = db
      .prepare(
        `SELECT advanced_blocking_group_name_lc, action, value FROM domain_group_applied_entries`,
      )
      .all() as {
      advanced_blocking_group_name_lc: string;
      action: "allow" | "block";
      value: string;
    }[];
    const dgBlockedByGroup = new Map<string, string[]>();
    const dgAllowedByGroup = new Map<string, string[]>();
    for (const t of tracked) {
      const map = t.action === "block" ? dgBlockedByGroup : dgAllowedByGroup;
      if (!map.has(t.advanced_blocking_group_name_lc))
        map.set(t.advanced_blocking_group_name_lc, []);
      map.get(t.advanced_blocking_group_name_lc)!.push(t.value);
    }

    const updatedGroups: string[] = [];
    const skippedGroups: string[] = [];

    const newGroups = currentConfig.groups.map((g) => {
      const importGroup = importGroups[g.name];
      if (!importGroup) {
        skippedGroups.push(g.name);
        return g;
      }
      updatedGroups.push(g.name);
      const lc = g.name.toLowerCase();

      if (mode === "merge") {
        return {
          ...g,
          blocked: [
            ...new Set([...g.blocked, ...(importGroup.blockDomains ?? [])]),
          ],
          allowed: [
            ...new Set([...g.allowed, ...(importGroup.allowDomains ?? [])]),
          ],
          blockedRegex: [
            ...new Set([...g.blockedRegex, ...(importGroup.blockRegex ?? [])]),
          ],
          allowedRegex: [
            ...new Set([...g.allowedRegex, ...(importGroup.allowRegex ?? [])]),
          ],
        };
      } else {
        // replace — keep DG-tracked entries
        const dgBlocked = dgBlockedByGroup.get(lc) ?? [];
        const dgAllowed = dgAllowedByGroup.get(lc) ?? [];
        return {
          ...g,
          blocked: [
            ...new Set([...(importGroup.blockDomains ?? []), ...dgBlocked]),
          ],
          allowed: [
            ...new Set([...(importGroup.allowDomains ?? []), ...dgAllowed]),
          ],
          blockedRegex: importGroup.blockRegex ?? [],
          allowedRegex: importGroup.allowRegex ?? [],
        };
      }
    });

    return {
      config: { ...currentConfig, groups: newGroups },
      updatedGroups,
      skippedGroups,
    };
  }

  async importUnifiedConfig(input: {
    nodeId?: unknown;
    domainsMode?: unknown;
    domainGroupsMode?: unknown;
    data?: unknown;
  }): Promise<UnifiedImportResult> {
    if (
      input.domainsMode !== "skip" &&
      input.domainsMode !== "merge" &&
      input.domainsMode !== "replace"
    ) {
      throw new BadRequestException(
        'domainsMode must be "skip", "merge", or "replace".',
      );
    }
    if (
      input.domainGroupsMode !== "merge" &&
      input.domainGroupsMode !== "replace"
    ) {
      throw new BadRequestException(
        'domainGroupsMode must be "merge" or "replace".',
      );
    }
    if (input.domainsMode !== "skip") {
      if (typeof input.nodeId !== "string" || !input.nodeId.trim()) {
        throw new BadRequestException(
          "nodeId is required when domainsMode is not skip.",
        );
      }
    }

    const domainsMode = input.domainsMode as UnifiedImportDomainsMode;
    const domainGroupsMode = input.domainGroupsMode;
    const data = (input.data ?? {}) as UnifiedImportRequest["data"];

    const result: UnifiedImportResult = {
      domains: {
        mode: domainsMode,
        groupsUpdated: [],
        groupsSkipped: [],
        errors: [],
      },
      domainGroups: {
        mode: domainGroupsMode,
        created: [],
        updated: [],
        replaced: [],
        skipped: [],
        errors: [],
      },
    };

    // --- Domains import ---
    if (domainsMode !== "skip") {
      const nodeId = (input.nodeId as string).trim();
      try {
        const snapshot = await this.advancedBlockingService.getSnapshot(nodeId);
        if (!snapshot.config) {
          result.domains.errors.push({
            group: nodeId,
            error: "No Advanced Blocking config available for this node.",
          });
        } else {
          const {
            config: newConfig,
            updatedGroups,
            skippedGroups,
          } = this.buildAbConfigForImport(
            snapshot.config,
            data.groups,
            domainsMode,
          );
          await this.advancedBlockingService.setConfig(nodeId, newConfig);
          result.domains.groupsUpdated = updatedGroups;
          result.domains.groupsSkipped = skippedGroups;
        }
      } catch (err) {
        result.domains.errors.push({
          group: nodeId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // --- DomainGroups import ---
    const db = this.getDb();
    for (const [name, rawDg] of Object.entries(data.domainGroups ?? {})) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        result.domainGroups.errors.push({
          name,
          error: "Group name must be non-empty.",
        });
        continue;
      }
      if (trimmedName.length > 80) {
        result.domainGroups.errors.push({
          name: trimmedName,
          error: "Group name cannot exceed 80 characters.",
        });
        continue;
      }

      const dg = rawDg as {
        description?: string;
        entries?: Array<{ value: string; type?: string; note?: string }>;
      };
      const description =
        typeof dg.description === "string" && dg.description.trim()
          ? dg.description.trim()
          : undefined;
      const rawEntries = Array.isArray(dg.entries) ? dg.entries : [];

      const existing = this.findGroupByNameLc(db, trimmedName.toLowerCase());

      if (!existing) {
        // Create new group
        let createdGroup: DomainGroupDetails;
        try {
          createdGroup = this.createDomainGroup({
            name: trimmedName,
            description,
          });
        } catch (err) {
          result.domainGroups.errors.push({
            name: trimmedName,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        for (const rawEntry of rawEntries) {
          if (!rawEntry.value || typeof rawEntry.value !== "string") continue;
          try {
            this.addEntry(createdGroup.id, {
              matchType: rawEntry.type === "regex" ? "regex" : "exact",
              value: rawEntry.value,
              note: rawEntry.note,
            });
          } catch (err) {
            result.domainGroups.errors.push({
              name: `${trimmedName} (entry: ${rawEntry.value})`,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        result.domainGroups.created.push(trimmedName);
      } else if (domainGroupsMode === "merge") {
        let addedCount = 0;

        for (const rawEntry of rawEntries) {
          if (!rawEntry.value || typeof rawEntry.value !== "string") continue;
          try {
            this.addEntry(existing.id, {
              matchType: rawEntry.type === "regex" ? "regex" : "exact",
              value: rawEntry.value,
              note: rawEntry.note,
            });
            addedCount++;
          } catch (err) {
            if (err instanceof ConflictException) {
              // duplicate — skip silently
            } else {
              result.domainGroups.errors.push({
                name: `${trimmedName} (entry: ${rawEntry.value})`,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }

        if (addedCount > 0) {
          result.domainGroups.updated.push(trimmedName);
        } else {
          result.domainGroups.skipped.push(trimmedName);
        }
      } else {
        // replace mode
        db.prepare(
          `DELETE FROM domain_group_entries WHERE domain_group_id = ?`,
        ).run(existing.id);

        for (const rawEntry of rawEntries) {
          if (!rawEntry.value || typeof rawEntry.value !== "string") continue;
          try {
            this.addEntry(existing.id, {
              matchType: rawEntry.type === "regex" ? "regex" : "exact",
              value: rawEntry.value,
              note: rawEntry.note,
            });
          } catch (err) {
            result.domainGroups.errors.push({
              name: `${trimmedName} (entry: ${rawEntry.value})`,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        result.domainGroups.replaced.push(trimmedName);
      }
    }

    // --- Bindings (always merge) ---
    for (const [groupName, importGroup] of Object.entries(data.groups ?? {})) {
      const actions: Array<{ dgNames: string[]; action: "allow" | "block" }> = [
        { dgNames: importGroup.blockDomainGroups ?? [], action: "block" },
        { dgNames: importGroup.allowDomainGroups ?? [], action: "allow" },
      ];
      for (const { dgNames, action } of actions) {
        for (const dgName of dgNames) {
          const dgRow = this.findGroupByNameLc(db, dgName.toLowerCase());
          if (!dgRow) {
            result.domainGroups.errors.push({
              name: `(binding) ${dgName}`,
              error: `Domain group "${dgName}" not found; cannot bind to "${groupName}".`,
            });
            continue;
          }
          try {
            this.addBinding(dgRow.id, {
              advancedBlockingGroupName: groupName,
              action,
            });
          } catch (err) {
            if (!(err instanceof ConflictException)) {
              result.domainGroups.errors.push({
                name: `(binding) ${dgName} → ${groupName}`,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        }
      }
    }

    return result;
  }
}
