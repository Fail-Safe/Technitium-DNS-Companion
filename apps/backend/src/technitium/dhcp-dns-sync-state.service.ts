import { Injectable, Logger } from "@nestjs/common";
import { CompanionDbService } from "./companion-db.service";

export interface DhcpDnsSyncSeenLease {
  sourceNodeId: string;
  scopeName: string;
  ip: string;
  hostname: string;
  hardwareAddress?: string;
  forwardZoneName: string;
  lastSeenAt: string;
}

export interface DhcpDnsSyncSeenLeaseInput {
  sourceNodeId: string;
  scopeName: string;
  ip: string;
  hostname: string;
  hardwareAddress?: string;
  forwardZoneName: string;
}

@Injectable()
export class DhcpDnsSyncStateService {
  private readonly logger = new Logger(DhcpDnsSyncStateService.name);
  private initialized = false;

  constructor(private readonly companionDb: CompanionDbService) {}

  listSeenLeases(
    sourceNodeId: string,
    scopeName: string,
  ): DhcpDnsSyncSeenLease[] {
    if (!this.ensureInitialized()) {
      return [];
    }

    const rows = this.companionDb.db
      ?.prepare(
        `
          SELECT source_node_id, scope_name, ip, hostname, hardware_address,
                 forward_zone_name, last_seen_at
          FROM dhcp_dns_sync_seen_leases
          WHERE source_node_id = ? AND scope_name = ?
        `,
      )
      .all(sourceNodeId, scopeName) as Array<Record<string, unknown>>;

    return (rows ?? []).map((row) => ({
      sourceNodeId: this.readString(row.source_node_id),
      scopeName: this.readString(row.scope_name),
      ip: this.readString(row.ip),
      hostname: this.readString(row.hostname),
      hardwareAddress:
        typeof row.hardware_address === "string"
          ? row.hardware_address
          : undefined,
      forwardZoneName: this.readString(row.forward_zone_name),
      lastSeenAt: this.readString(row.last_seen_at),
    }));
  }

  markSeen(leases: DhcpDnsSyncSeenLeaseInput[], seenAt: string): void {
    if (leases.length === 0 || !this.ensureInitialized()) {
      return;
    }

    const db = this.companionDb.db;
    if (!db) {
      return;
    }

    const statement = db.prepare(
      `
        INSERT INTO dhcp_dns_sync_seen_leases (
          source_node_id,
          scope_name,
          ip,
          hostname,
          hardware_address,
          forward_zone_name,
          last_seen_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_node_id, scope_name, ip) DO UPDATE SET
          hostname = excluded.hostname,
          hardware_address = excluded.hardware_address,
          forward_zone_name = excluded.forward_zone_name,
          last_seen_at = excluded.last_seen_at
      `,
    );

    try {
      db.exec("BEGIN");
      for (const lease of leases) {
        statement.run(
          lease.sourceNodeId,
          lease.scopeName,
          lease.ip,
          lease.hostname,
          lease.hardwareAddress ?? null,
          lease.forwardZoneName,
          seenAt,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch (rollbackError) {
        this.logger.warn(
          `Failed to roll back DHCP DNS sync state write: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
      throw error;
    }
  }

  removeSeen(sourceNodeId: string, scopeName: string, ip: string): void {
    if (!this.ensureInitialized()) {
      return;
    }

    this.companionDb.db
      ?.prepare(
        `
          DELETE FROM dhcp_dns_sync_seen_leases
          WHERE source_node_id = ? AND scope_name = ? AND ip = ?
        `,
      )
      .run(sourceNodeId, scopeName, ip);
  }

  private ensureInitialized(): boolean {
    if (this.initialized) {
      return true;
    }

    const db = this.companionDb.db;
    if (!db) {
      this.logger.warn(
        "Companion SQLite is unavailable; DHCP DNS sync stale cleanup state is disabled.",
      );
      return false;
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS dhcp_dns_sync_seen_leases (
        source_node_id TEXT NOT NULL,
        scope_name TEXT NOT NULL,
        ip TEXT NOT NULL,
        hostname TEXT NOT NULL,
        hardware_address TEXT,
        forward_zone_name TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        PRIMARY KEY (source_node_id, scope_name, ip)
      );
    `);

    this.ensureColumn(
      "dhcp_dns_sync_seen_leases",
      "forward_zone_name",
      "TEXT NOT NULL DEFAULT ''",
    );

    this.initialized = true;
    return true;
  }

  private ensureColumn(
    tableName: string,
    columnName: string,
    definition: string,
  ): void {
    const db = this.companionDb.db;
    if (!db) {
      return;
    }

    const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
      name?: string;
    }>;
    const exists = rows.some((row) => row.name === columnName);
    if (!exists) {
      db.prepare(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`,
      ).run();
    }
  }

  private readString(value: unknown): string {
    return typeof value === "string" ? value : "";
  }
}
