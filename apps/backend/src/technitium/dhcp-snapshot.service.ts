import { Injectable, Logger } from "@nestjs/common";
import type {
  DhcpSnapshot,
  DhcpSnapshotMetadata,
  DhcpSnapshotOrigin,
  DhcpSnapshotScopeEntry,
} from "./technitium.types";
import { SnapshotFileStore } from "./snapshot-file-store";

@Injectable()
export class DhcpSnapshotService extends SnapshotFileStore<
  DhcpSnapshot,
  DhcpSnapshotMetadata
> {
  protected readonly logger = new Logger(DhcpSnapshotService.name);
  protected readonly retentionLimit =
    Number.parseInt(process.env.DHCP_SNAPSHOT_RETENTION ?? "20", 10) || 20;

  constructor() {
    super();
    this.initCandidates("DHCP_SNAPSHOT_DIR", "dhcp-snapshots");
  }

  async listSnapshots(nodeId: string): Promise<DhcpSnapshotMetadata[]> {
    return this.listAllSnapshots(nodeId);
  }

  async saveSnapshot(
    nodeId: string,
    scopes: DhcpSnapshotScopeEntry[],
    origin: DhcpSnapshotOrigin = "manual",
  ): Promise<DhcpSnapshotMetadata> {
    await this.ensureNodeDir(nodeId);
    const snapshotId = this.buildSnapshotId(scopes);

    const metadata: DhcpSnapshotMetadata = {
      id: snapshotId,
      nodeId,
      createdAt: new Date().toISOString(),
      scopeCount: scopes.length,
      origin,
      pinned: false,
      note: undefined,
    };

    await this.writeSnapshot(nodeId, snapshotId, { metadata, scopes });
    await this.applyRetentionToList(nodeId, await this.listAllSnapshots(nodeId));
    return metadata;
  }
}
