import { Injectable, Logger } from "@nestjs/common";
import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import { join } from "path";
import {
  DhcpSnapshot,
  DhcpSnapshotMetadata,
  DhcpSnapshotOrigin,
  DhcpSnapshotScopeEntry,
} from "./technitium.types";

@Injectable()
export class DhcpSnapshotService {
  private readonly logger = new Logger(DhcpSnapshotService.name);
  private readonly retentionLimit =
    Number.parseInt(process.env.DHCP_SNAPSHOT_RETENTION ?? "20", 10) || 20;

  private readonly baseDirCandidates: string[];
  private baseDir: string;

  constructor() {
    const envDir = process.env.DHCP_SNAPSHOT_DIR;
    const projectDataDir = join(
      process.cwd(),
      "apps",
      "backend",
      "data",
      "dhcp-snapshots",
    );
    const osTmpDir = join(os.tmpdir(), "tdc-dhcp-snapshots");
    const dockerDefaultDir = "/data/dhcp-snapshots";

    this.baseDirCandidates = [
      envDir,
      projectDataDir,
      osTmpDir,
      dockerDefaultDir,
    ].filter(Boolean) as string[];
    this.baseDir = this.baseDirCandidates[0];
  }

  private async ensureBaseDir(): Promise<void> {
    for (const dir of this.baseDirCandidates) {
      try {
        await fs.mkdir(dir, { recursive: true });
        this.baseDir = dir;
        return;
      } catch (error) {
        this.logger.warn(
          `Failed to initialize snapshot dir candidate ${dir}: ${(error as Error).message}`,
        );
      }
    }
    throw new Error("Unable to initialize DHCP snapshot directory");
  }

  private getNodeDir(nodeId: string): string {
    return join(this.baseDir, nodeId);
  }

  private getSnapshotPath(nodeId: string, snapshotId: string): string {
    return join(this.getNodeDir(nodeId), `${snapshotId}.json`);
  }

  private buildSnapshotId(scopes: DhcpSnapshotScopeEntry[]): string {
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(scopes))
      .digest("hex")
      .slice(0, 12);
    return `${Date.now()}-${hash}`;
  }

  async saveSnapshot(
    nodeId: string,
    scopes: DhcpSnapshotScopeEntry[],
    origin: DhcpSnapshotOrigin = "manual",
  ): Promise<DhcpSnapshotMetadata> {
    await this.ensureBaseDir();
    const snapshotId = this.buildSnapshotId(scopes);
    const nodeDir = this.getNodeDir(nodeId);
    await fs.mkdir(nodeDir, { recursive: true });

    const metadata: DhcpSnapshotMetadata = {
      id: snapshotId,
      nodeId,
      createdAt: new Date().toISOString(),
      scopeCount: scopes.length,
      origin,
      pinned: false,
      note: undefined,
    };

    const snapshot: DhcpSnapshot = { metadata, scopes };

    const payload = JSON.stringify(snapshot, null, 2);
    const snapshotPath = this.getSnapshotPath(nodeId, snapshotId);
    await fs.writeFile(snapshotPath, payload, "utf8");

    await this.applyRetention(nodeId);

    return metadata;
  }

  async deleteSnapshot(nodeId: string, snapshotId: string): Promise<boolean> {
    await this.ensureBaseDir();
    try {
      await fs.unlink(this.getSnapshotPath(nodeId, snapshotId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async updateSnapshotNote(
    nodeId: string,
    snapshotId: string,
    note: string | undefined,
  ): Promise<DhcpSnapshotMetadata | null> {
    const snapshot = await this.getSnapshot(nodeId, snapshotId);
    if (!snapshot) {
      return null;
    }

    snapshot.metadata.note = note?.trim() ? note.trim() : undefined;

    await fs.writeFile(
      this.getSnapshotPath(nodeId, snapshotId),
      JSON.stringify(snapshot, null, 2),
      "utf8",
    );

    return snapshot.metadata;
  }

  private normalizeSnapshot(snapshot: DhcpSnapshot): DhcpSnapshot {
    return {
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        origin: snapshot.metadata.origin ?? "manual",
        pinned: snapshot.metadata.pinned ?? false,
      },
    };
  }

  async listSnapshots(nodeId: string): Promise<DhcpSnapshotMetadata[]> {
    await this.ensureBaseDir();
    const nodeDir = this.getNodeDir(nodeId);
    try {
      const files = await fs.readdir(nodeDir);
      const snapshots: DhcpSnapshotMetadata[] = [];
      for (const file of files.filter((name) => name.endsWith(".json"))) {
        try {
          const raw = await fs.readFile(join(nodeDir, file), "utf8");
          const parsed = JSON.parse(raw) as DhcpSnapshot;
          if (parsed?.metadata) {
            snapshots.push(this.normalizeSnapshot(parsed).metadata);
          }
        } catch (error) {
          this.logger.warn(
            `Failed to read snapshot metadata ${file}: ${(error as Error).message}`,
          );
        }
      }
      return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async getSnapshot(
    nodeId: string,
    snapshotId: string,
  ): Promise<DhcpSnapshot | null> {
    await this.ensureBaseDir();
    try {
      const raw = await fs.readFile(
        this.getSnapshotPath(nodeId, snapshotId),
        "utf8",
      );
      return this.normalizeSnapshot(JSON.parse(raw) as DhcpSnapshot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async setPinned(
    nodeId: string,
    snapshotId: string,
    pinned: boolean,
  ): Promise<DhcpSnapshotMetadata | null> {
    const snapshot = await this.getSnapshot(nodeId, snapshotId);
    if (!snapshot) {
      return null;
    }
    snapshot.metadata.pinned = pinned;
    await fs.writeFile(
      this.getSnapshotPath(nodeId, snapshotId),
      JSON.stringify(snapshot, null, 2),
      "utf8",
    );
    return snapshot.metadata;
  }

  private async applyRetention(nodeId: string): Promise<void> {
    const snapshots = await this.listSnapshots(nodeId);
    const unpinned = snapshots.filter((s) => !s.pinned);
    if (unpinned.length <= this.retentionLimit) {
      return;
    }
    const excess = unpinned.slice(this.retentionLimit);
    for (const snap of excess) {
      try {
        await fs.unlink(this.getSnapshotPath(nodeId, snap.id));
      } catch (error) {
        this.logger.warn(
          `Failed to prune snapshot ${snap.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
