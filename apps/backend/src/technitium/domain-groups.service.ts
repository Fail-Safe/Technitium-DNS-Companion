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
import type {
    DomainGroup,
    DomainGroupBinding,
    DomainGroupBindingAction,
    DomainGroupConflict,
    DomainGroupDetails,
    DomainGroupEntry,
    DomainGroupEntryMatchType,
    DomainGroupMaterializationPreview,
    DomainGroupMaterializedGroup,
    DomainGroupsApplyRequest,
    DomainGroupsApplyResult,
    DomainGroupsStatus,
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
      input.name === undefined ?
        existing.name
      : this.normalizeGroupName(
          this.requireString(input.name, "Domain Group name"),
        );
    if (!nextName) {
      throw new BadRequestException("Domain Group name is required.");
    }
    this.assertMaxLength("Domain Group name", nextName, 80);

    const nextDescription =
      input.description === undefined ?
        (existing.description ?? undefined)
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

    if (typeof input.matchType !== "string") {
      throw new BadRequestException('matchType must be "exact" or "regex".');
    }

    const matchType = input.matchType as DomainGroupEntryMatchType;
    if (matchType !== "exact" && matchType !== "regex") {
      throw new BadRequestException('matchType must be "exact" or "regex".');
    }

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
      input.matchType === undefined ?
        existing.match_type
      : (this.requireString(
          input.matchType,
          "matchType",
        ) as DomainGroupEntryMatchType);
    if (nextMatchType !== "exact" && nextMatchType !== "regex") {
      throw new BadRequestException('matchType must be "exact" or "regex".');
    }

    const { value, normalizedValue } = this.normalizeEntryValue(
      nextMatchType,
      input.value === undefined ?
        existing.value
      : this.requireString(input.value, "Entry value"),
    );

    const nextNote =
      input.note === undefined ?
        (existing.note ?? undefined)
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
  ): {
    nextConfig: AdvancedBlockingConfig;
    updatedGroups: string[];
    skippedGroups: string[];
  } {
    const groups = [...(config.groups ?? [])];
    const groupByNameLc = new Map(
      groups.map((group) => [group.name.toLowerCase(), group]),
    );

    const updatedGroups: string[] = [];
    const skippedGroups: string[] = [];

    for (const materialized of materializedGroups) {
      const key = materialized.advancedBlockingGroupName.toLowerCase();
      const existing = groupByNameLc.get(key);

      if (!existing) {
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
        continue;
      }

      const beforeSignature = JSON.stringify({
        allowed: existing.allowed,
        blocked: existing.blocked,
        allowedRegex: existing.allowedRegex,
        blockedRegex: existing.blockedRegex,
      });

      existing.allowed = materialized.allowed;
      existing.blocked = materialized.blocked;
      existing.allowedRegex = materialized.allowedRegex;
      existing.blockedRegex = materialized.blockedRegex;

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

    return {
      nextConfig: { ...config, groups },
      updatedGroups: [...new Set(updatedGroups)].sort((a, b) =>
        a.localeCompare(b),
      ),
      skippedGroups: [...new Set(skippedGroups)].sort((a, b) =>
        a.localeCompare(b),
      ),
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
      requestedNodeIds.length > 0 ? requestedNodeIds
      : clusterPrimaryGuardActive ? primaryNodeIds
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

        const { nextConfig, updatedGroups, skippedGroups } =
          this.applyMaterializedGroupsToConfig(snapshot.config, preview.groups);

        if (!dryRun && updatedGroups.length > 0) {
          await this.advancedBlockingService.setConfig(summary.id, nextConfig);
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
}
