import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import { join } from "path";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import { BuiltInBlockingService } from "./built-in-blocking.service";
import type { BlockingSettings } from "./built-in-blocking.types";
import type {
  DnsFilteringSnapshot,
  DnsFilteringSnapshotMetadata,
  DnsFilteringSnapshotMethod,
  DnsFilteringSnapshotOrigin,
  DnsFilteringSnapshotRestoreResult,
} from "./technitium.types";

@Injectable()
export class DnsFilteringSnapshotService {
  private readonly logger = new Logger(DnsFilteringSnapshotService.name);
  private readonly retentionLimit =
    Number.parseInt(process.env.DNS_FILTERING_SNAPSHOT_RETENTION ?? "20", 10) ||
    20;

  private readonly baseDirCandidates: string[];
  private baseDir: string;

  constructor(
    private readonly builtInBlockingService: BuiltInBlockingService,
    private readonly advancedBlockingService: AdvancedBlockingService,
  ) {
    const envDir = process.env.DNS_FILTERING_SNAPSHOT_DIR;
    const projectDataDir = join(
      process.cwd(),
      "apps",
      "backend",
      "data",
      "dns-filtering-snapshots",
    );
    const osTmpDir = join(os.tmpdir(), "tdc-dns-filtering-snapshots");
    const dockerDefaultDir = "/data/dns-filtering-snapshots";

    this.baseDirCandidates = [
      envDir,
      projectDataDir,
      osTmpDir,
      dockerDefaultDir,
    ]
      .filter(Boolean)
      .map(String);
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
    throw new Error("Unable to initialize DNS filtering snapshot directory");
  }

  private getNodeDir(nodeId: string): string {
    return join(this.baseDir, nodeId);
  }

  private getSnapshotPath(nodeId: string, snapshotId: string): string {
    return join(this.getNodeDir(nodeId), `${snapshotId}.json`);
  }

  private buildSnapshotId(payload: unknown): string {
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex")
      .slice(0, 12);
    return `${Date.now()}-${hash}`;
  }

  private async listAllBlockingZones(
    nodeId: string,
    list: "allowed" | "blocked",
  ): Promise<string[]> {
    const entriesPerPage = 500;
    const out: string[] = [];

    for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
      const response =
        list === "allowed"
          ? await this.builtInBlockingService.listAllowedZones(nodeId, {
              pageNumber,
              entriesPerPage,
              format: "list",
            })
          : await this.builtInBlockingService.listBlockedZones(nodeId, {
              pageNumber,
              entriesPerPage,
              format: "list",
            });

      out.push(...(response.domains ?? []).map((d) => d.domain));

      if (response.totalPages !== undefined) {
        if (pageNumber >= response.totalPages - 1) break;
      } else if ((response.domains ?? []).length < entriesPerPage) {
        break;
      }
    }

    return [...new Set(out.map((d) => d.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  async saveSnapshot(
    nodeId: string,
    method: DnsFilteringSnapshotMethod,
    origin: DnsFilteringSnapshotOrigin = "manual",
    note?: string,
  ): Promise<DnsFilteringSnapshotMetadata> {
    await this.ensureBaseDir();
    const nodeDir = this.getNodeDir(nodeId);
    await fs.mkdir(nodeDir, { recursive: true });

    if (method === "built-in") {
      const settings =
        await this.builtInBlockingService.getBlockingSettings(nodeId);
      const allowedDomains = await this.listAllBlockingZones(nodeId, "allowed");
      const blockedDomains = await this.listAllBlockingZones(nodeId, "blocked");

      const payload = { method, settings, allowedDomains, blockedDomains };

      const snapshotId = this.buildSnapshotId(payload);

      const metadata: DnsFilteringSnapshotMetadata = {
        id: snapshotId,
        nodeId,
        createdAt: new Date().toISOString(),
        origin,
        method,
        pinned: false,
        note: note?.trim() ? note.trim() : undefined,
        allowedCount: allowedDomains.length,
        blockedCount: blockedDomains.length,
      };

      const snapshot: DnsFilteringSnapshot = {
        metadata,
        builtIn: { settings, allowedDomains, blockedDomains },
      };

      await fs.writeFile(
        this.getSnapshotPath(nodeId, snapshotId),
        JSON.stringify(snapshot, null, 2),
        "utf8",
      );

      await this.applyRetention(nodeId, method);
      return metadata;
    }

    const snapshot = await this.advancedBlockingService.getSnapshot(nodeId);
    const config = snapshot.config;

    if (!config) {
      throw new Error(
        snapshot.error ||
          `Advanced Blocking is not available on node "${nodeId}".`,
      );
    }

    const payload = { method, config };
    const snapshotId = this.buildSnapshotId(payload);

    const groupCount = (config.groups ?? []).length;

    const metadata: DnsFilteringSnapshotMetadata = {
      id: snapshotId,
      nodeId,
      createdAt: new Date().toISOString(),
      origin,
      method,
      pinned: false,
      note: note?.trim() ? note.trim() : undefined,
      groupCount,
    };

    const dnsSnapshot: DnsFilteringSnapshot = {
      metadata,
      advancedBlocking: { config },
    };

    await fs.writeFile(
      this.getSnapshotPath(nodeId, snapshotId),
      JSON.stringify(dnsSnapshot, null, 2),
      "utf8",
    );

    await this.applyRetention(nodeId, method);

    return metadata;
  }

  private normalizeSnapshot(
    snapshot: DnsFilteringSnapshot,
  ): DnsFilteringSnapshot {
    return {
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        origin: snapshot.metadata.origin ?? "manual",
        pinned: snapshot.metadata.pinned ?? false,
      },
    };
  }

  async listSnapshots(
    nodeId: string,
    method: DnsFilteringSnapshotMethod,
  ): Promise<DnsFilteringSnapshotMetadata[]> {
    await this.ensureBaseDir();
    const nodeDir = this.getNodeDir(nodeId);

    try {
      const files = await fs.readdir(nodeDir);
      const snapshots: DnsFilteringSnapshotMetadata[] = [];

      for (const file of files.filter((name) => name.endsWith(".json"))) {
        try {
          const raw = await fs.readFile(join(nodeDir, file), "utf8");
          const parsed = JSON.parse(raw) as DnsFilteringSnapshot;
          if (parsed?.metadata?.method !== method) continue;
          snapshots.push(this.normalizeSnapshot(parsed).metadata);
        } catch (error) {
          this.logger.warn(
            `Failed to read DNS filtering snapshot metadata ${file}: ${(error as Error).message}`,
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
  ): Promise<DnsFilteringSnapshot | null> {
    await this.ensureBaseDir();

    try {
      const raw = await fs.readFile(
        this.getSnapshotPath(nodeId, snapshotId),
        "utf8",
      );
      return this.normalizeSnapshot(JSON.parse(raw) as DnsFilteringSnapshot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
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
  ): Promise<DnsFilteringSnapshotMetadata | null> {
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

  async setPinned(
    nodeId: string,
    snapshotId: string,
    pinned: boolean,
  ): Promise<DnsFilteringSnapshotMetadata | null> {
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

  async restoreSnapshot(
    nodeId: string,
    snapshotId: string,
  ): Promise<DnsFilteringSnapshotRestoreResult> {
    const snapshot = await this.getSnapshot(nodeId, snapshotId);

    if (!snapshot) {
      throw new NotFoundException(`Snapshot "${snapshotId}" was not found.`);
    }

    const method = snapshot.metadata.method;

    if (method === "built-in") {
      const builtIn = snapshot.builtIn;
      if (!builtIn) {
        throw new Error("Built-in snapshot payload is missing.");
      }

      const settingsToApply: BlockingSettings = builtIn.settings ?? {};

      await this.builtInBlockingService.updateBlockingSettings(nodeId, {
        enableBlocking: settingsToApply.enableBlocking,
        allowTxtBlockingReport: settingsToApply.allowTxtBlockingReport,
        blockingType: settingsToApply.blockingType,
        blockingAnswerTtl: settingsToApply.blockingAnswerTtl,
        customBlockingAddresses: settingsToApply.customBlockingAddresses,
        blockListUrls: settingsToApply.blockListUrls,
        blockListUrlUpdateIntervalHours:
          settingsToApply.blockListUrlUpdateIntervalHours,
      });

      await this.builtInBlockingService.flushAllowedZones(nodeId);
      await this.builtInBlockingService.flushBlockedZones(nodeId);

      for (const domain of builtIn.allowedDomains ?? []) {
        await this.builtInBlockingService.addAllowedZone(nodeId, { domain });
      }

      for (const domain of builtIn.blockedDomains ?? []) {
        await this.builtInBlockingService.addBlockedZone(nodeId, { domain });
      }

      return {
        snapshot: snapshot.metadata,
        restoredAllowed: builtIn.allowedDomains?.length ?? 0,
        restoredBlocked: builtIn.blockedDomains?.length ?? 0,
        restoredGroups: 0,
      };
    }

    const advanced = snapshot.advancedBlocking;
    if (!advanced) {
      throw new Error("Advanced Blocking snapshot payload is missing.");
    }

    await this.advancedBlockingService.setConfig(nodeId, advanced.config);

    return {
      snapshot: snapshot.metadata,
      restoredAllowed: 0,
      restoredBlocked: 0,
      restoredGroups: (advanced.config.groups ?? []).length,
    };
  }

  private async applyRetention(
    nodeId: string,
    method: DnsFilteringSnapshotMethod,
  ): Promise<void> {
    const snapshots = await this.listSnapshots(nodeId, method);
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
          `Failed to prune DNS filtering snapshot ${snap.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
