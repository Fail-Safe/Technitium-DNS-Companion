import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import { join } from "path";
import type { Logger } from "@nestjs/common";

export abstract class SnapshotFileStore<
  TSnapshot extends { metadata: TMeta },
  TMeta extends {
    id: string;
    pinned?: boolean;
    createdAt: string;
    note?: string;
    origin?: string;
  },
> {
  protected abstract readonly logger: Logger;
  protected abstract readonly retentionLimit: number;

  protected baseDirCandidates: string[] = [];
  protected baseDir = "";
  private dirLabel = "snapshot";

  protected initCandidates(envVar: string, subDir: string): void {
    this.dirLabel = subDir;
    const envDir = process.env[envVar];
    const projectDataDir = join(
      process.cwd(),
      "apps",
      "backend",
      "data",
      subDir,
    );
    const osTmpDir = join(os.tmpdir(), `tdc-${subDir}`);
    const dockerDefaultDir = `/data/${subDir}`;
    this.baseDirCandidates = [
      envDir,
      projectDataDir,
      osTmpDir,
      dockerDefaultDir,
    ].filter(Boolean) as string[];
    this.baseDir = this.baseDirCandidates[0];
  }

  protected async ensureBaseDir(): Promise<void> {
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
    throw new Error(`Unable to initialize ${this.dirLabel} directory`);
  }

  protected getNodeDir(nodeId: string): string {
    return join(this.baseDir, nodeId);
  }

  protected getSnapshotPath(nodeId: string, snapshotId: string): string {
    return join(this.getNodeDir(nodeId), `${snapshotId}.json`);
  }

  protected buildSnapshotId(payload: unknown): string {
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex")
      .slice(0, 12);
    return `${Date.now()}-${hash}`;
  }

  protected normalizeSnapshot(snapshot: TSnapshot): TSnapshot {
    return {
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        origin: snapshot.metadata.origin ?? "manual",
        pinned: snapshot.metadata.pinned ?? false,
      },
    } as TSnapshot;
  }

  protected async ensureNodeDir(nodeId: string): Promise<void> {
    await this.ensureBaseDir();
    await fs.mkdir(this.getNodeDir(nodeId), { recursive: true });
  }

  protected async writeSnapshot(
    nodeId: string,
    snapshotId: string,
    snapshot: TSnapshot,
  ): Promise<void> {
    await fs.writeFile(
      this.getSnapshotPath(nodeId, snapshotId),
      JSON.stringify(snapshot, null, 2),
      "utf8",
    );
  }

  async getSnapshot(
    nodeId: string,
    snapshotId: string,
  ): Promise<TSnapshot | null> {
    await this.ensureBaseDir();
    try {
      const raw = await fs.readFile(
        this.getSnapshotPath(nodeId, snapshotId),
        "utf8",
      );
      return this.normalizeSnapshot(JSON.parse(raw) as TSnapshot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async deleteSnapshot(nodeId: string, snapshotId: string): Promise<boolean> {
    await this.ensureBaseDir();
    try {
      await fs.unlink(this.getSnapshotPath(nodeId, snapshotId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async updateSnapshotNote(
    nodeId: string,
    snapshotId: string,
    note: string | undefined,
  ): Promise<TMeta | null> {
    const snapshot = await this.getSnapshot(nodeId, snapshotId);
    if (!snapshot) return null;
    snapshot.metadata.note = note?.trim() ? note.trim() : undefined;
    await fs.writeFile(
      this.getSnapshotPath(nodeId, snapshotId),
      JSON.stringify(snapshot, null, 2),
      "utf8",
    );
    return snapshot.metadata;
  }

  async setPinned(
    nodeId: string,
    snapshotId: string,
    pinned: boolean,
  ): Promise<TMeta | null> {
    const snapshot = await this.getSnapshot(nodeId, snapshotId);
    if (!snapshot) return null;
    snapshot.metadata.pinned = pinned;
    await fs.writeFile(
      this.getSnapshotPath(nodeId, snapshotId),
      JSON.stringify(snapshot, null, 2),
      "utf8",
    );
    return snapshot.metadata;
  }

  protected async listAllSnapshots(nodeId: string): Promise<TMeta[]> {
    await this.ensureBaseDir();
    const nodeDir = this.getNodeDir(nodeId);
    try {
      const files = await fs.readdir(nodeDir);
      const snapshots: TMeta[] = [];
      for (const file of files.filter((name) => name.endsWith(".json"))) {
        try {
          const raw = await fs.readFile(join(nodeDir, file), "utf8");
          const parsed = JSON.parse(raw) as TSnapshot;
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
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  protected async applyRetentionToList(
    nodeId: string,
    snapshots: TMeta[],
  ): Promise<void> {
    const unpinned = snapshots.filter((s) => !s.pinned);
    if (unpinned.length <= this.retentionLimit) return;
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
