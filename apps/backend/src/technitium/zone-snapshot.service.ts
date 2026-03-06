import { Injectable, Logger } from "@nestjs/common";
import type {
  ZoneSnapshot,
  ZoneSnapshotMetadata,
  ZoneSnapshotOrigin,
  ZoneSnapshotZoneEntry,
} from "./technitium.types";
import { SnapshotFileStore } from "./snapshot-file-store";

@Injectable()
export class ZoneSnapshotService extends SnapshotFileStore<
  ZoneSnapshot,
  ZoneSnapshotMetadata
> {
  protected readonly logger = new Logger(ZoneSnapshotService.name);
  protected readonly retentionLimit =
    Number.parseInt(process.env.ZONE_SNAPSHOT_RETENTION ?? "20", 10) || 20;

  constructor() {
    super();
    this.initCandidates("ZONE_SNAPSHOT_DIR", "zone-snapshots");
  }

  async listSnapshots(nodeId: string): Promise<ZoneSnapshotMetadata[]> {
    return this.listAllSnapshots(nodeId);
  }

  async saveSnapshot(
    nodeId: string,
    zones: ZoneSnapshotZoneEntry[],
    origin: ZoneSnapshotOrigin = "manual",
    note?: string,
  ): Promise<ZoneSnapshotMetadata> {
    await this.ensureNodeDir(nodeId);
    const snapshotId = this.buildSnapshotId(zones);

    const metadata: ZoneSnapshotMetadata = {
      id: snapshotId,
      nodeId,
      createdAt: new Date().toISOString(),
      zoneCount: zones.length,
      origin,
      pinned: false,
      note: note?.trim() ? note.trim() : undefined,
    };

    await this.writeSnapshot(nodeId, snapshotId, { metadata, zones });
    await this.applyRetentionToList(nodeId, await this.listAllSnapshots(nodeId));
    return metadata;
  }
}
