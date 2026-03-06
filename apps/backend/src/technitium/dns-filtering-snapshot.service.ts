import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
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
import { SnapshotFileStore } from "./snapshot-file-store";

@Injectable()
export class DnsFilteringSnapshotService extends SnapshotFileStore<
  DnsFilteringSnapshot,
  DnsFilteringSnapshotMetadata
> {
  protected readonly logger = new Logger(DnsFilteringSnapshotService.name);
  protected readonly retentionLimit =
    Number.parseInt(process.env.DNS_FILTERING_SNAPSHOT_RETENTION ?? "20", 10) ||
    20;

  constructor(
    private readonly builtInBlockingService: BuiltInBlockingService,
    @Inject(forwardRef(() => AdvancedBlockingService))
    private readonly advancedBlockingService: AdvancedBlockingService,
  ) {
    super();
    this.initCandidates(
      "DNS_FILTERING_SNAPSHOT_DIR",
      "dns-filtering-snapshots",
    );
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
    await this.ensureNodeDir(nodeId);

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

      await this.writeSnapshot(nodeId, snapshotId, {
        metadata,
        builtIn: { settings, allowedDomains, blockedDomains },
      });
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

    await this.writeSnapshot(nodeId, snapshotId, {
      metadata,
      advancedBlocking: { config },
    });
    await this.applyRetention(nodeId, method);
    return metadata;
  }

  async listSnapshots(
    nodeId: string,
    method: DnsFilteringSnapshotMethod,
  ): Promise<DnsFilteringSnapshotMetadata[]> {
    const all = await this.listAllSnapshots(nodeId);
    return all.filter((s) => s.method === method);
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
    await this.applyRetentionToList(
      nodeId,
      await this.listSnapshots(nodeId, method),
    );
  }
}
