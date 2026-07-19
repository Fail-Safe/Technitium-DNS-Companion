import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import type { AdvancedBlockingSnapshot } from "./advanced-blocking.types";
import type {
  ConfigSyncRunResult,
  ConfigSyncSchedulerStatus,
  ConfigSyncTargetResult,
} from "./config-sync-scheduler.types";
import { DnsFilteringSnapshotService } from "./dns-filtering-snapshot.service";
import { LogAlertsEmailService } from "./log-alerts-email.service";

@Injectable()
export class ConfigSyncSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ConfigSyncSchedulerService.name);
  private readonly enabled =
    (process.env.CONFIG_SYNC_ENABLED ?? "").trim().toLowerCase() === "true";
  private readonly sourceNodeId = (
    process.env.CONFIG_SYNC_SOURCE_NODE ?? ""
  ).trim();
  private readonly targetNodeIds = [
    ...new Set(
      (process.env.CONFIG_SYNC_TARGET_NODES ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0 && value !== this.sourceNodeId),
    ),
  ];
  private readonly intervalMinutes = this.readIntervalMinutes();
  private readonly notificationRecipients = [
    ...new Set(
      (process.env.CONFIG_SYNC_NOTIFY_EMAILS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];

  private timer?: NodeJS.Timeout;
  private nextRunAt?: string;
  private activeRun?: Promise<ConfigSyncRunResult>;
  private lastRun?: ConfigSyncRunResult;
  private failureAlertSent = false;

  constructor(
    private readonly advancedBlockingService: AdvancedBlockingService,
    private readonly snapshotService: DnsFilteringSnapshotService,
    private readonly emailService: LogAlertsEmailService,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) {
      return;
    }

    if (!this.isConfigured()) {
      this.logger.warn(
        "Configuration Sync scheduling is enabled but source/target nodes are incomplete.",
      );
      return;
    }

    if (process.env.NODE_ENV === "test") {
      return;
    }

    const intervalMs = this.intervalMinutes * 60_000;
    this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    this.timer = setInterval(() => {
      this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
      void this.runNow().catch((error) => {
        this.logger.error(
          `Scheduled Configuration Sync failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, intervalMs);

    this.logger.log(
      `Configuration Sync scheduled every ${this.intervalMinutes} minute(s): ${this.sourceNodeId} -> ${this.targetNodeIds.join(", ")}.`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  getStatus(): ConfigSyncSchedulerStatus {
    return {
      enabled: this.enabled,
      configured: this.isConfigured(),
      running: !!this.activeRun,
      intervalMinutes: this.intervalMinutes,
      sourceNodeId: this.sourceNodeId || undefined,
      targetNodeIds: [...this.targetNodeIds],
      notificationRecipientCount: this.notificationRecipients.length,
      nextRunAt: this.nextRunAt,
      lastRun: this.lastRun,
    };
  }

  runNow(): Promise<ConfigSyncRunResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        "Configuration Sync requires CONFIG_SYNC_SOURCE_NODE and at least one CONFIG_SYNC_TARGET_NODES entry.",
      );
    }

    if (this.activeRun) {
      return this.activeRun;
    }

    this.activeRun = this.executeRun().finally(() => {
      this.activeRun = undefined;
    });
    return this.activeRun;
  }

  private async executeRun(): Promise<ConfigSyncRunResult> {
    const startedAt = new Date().toISOString();
    let source: AdvancedBlockingSnapshot;

    try {
      source = await this.advancedBlockingService.getSnapshotWithAuth(
        this.sourceNodeId,
        "schedule",
      );
    } catch (error) {
      return this.finalizeRun({
        startedAt,
        completedAt: new Date().toISOString(),
        sourceNodeId: this.sourceNodeId,
        targets: [
          {
            nodeId: this.sourceNodeId,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }

    if (!source.config) {
      return this.finalizeRun({
        startedAt,
        completedAt: new Date().toISOString(),
        sourceNodeId: this.sourceNodeId,
        targets: [
          {
            nodeId: this.sourceNodeId,
            status: "failed",
            error:
              source.error ||
              `Advanced Blocking configuration is unavailable on source node "${this.sourceNodeId}".`,
          },
        ],
      });
    }

    const sourceSerialized = JSON.stringify(source.config);
    const targets: ConfigSyncTargetResult[] = [];

    for (const targetNodeId of this.targetNodeIds) {
      try {
        const target = await this.advancedBlockingService.getSnapshotWithAuth(
          targetNodeId,
          "schedule",
        );

        if (
          target.config &&
          JSON.stringify(target.config) === sourceSerialized
        ) {
          targets.push({ nodeId: targetNodeId, status: "in-sync" });
          continue;
        }

        if (target.config) {
          await this.snapshotService.saveSnapshot(
            targetNodeId,
            "advanced-blocking",
            "automatic",
            `Automatic snapshot before scheduled sync from ${this.sourceNodeId}`,
            "schedule",
          );
        }

        await this.advancedBlockingService.setConfigWithAuth(
          targetNodeId,
          source.config,
          "schedule",
        );
        targets.push({ nodeId: targetNodeId, status: "synced" });
      } catch (error) {
        targets.push({
          nodeId: targetNodeId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const result: ConfigSyncRunResult = {
      startedAt,
      completedAt: new Date().toISOString(),
      sourceNodeId: this.sourceNodeId,
      targets,
    };
    return this.finalizeRun(result);
  }

  private async finalizeRun(
    result: ConfigSyncRunResult,
  ): Promise<ConfigSyncRunResult> {
    const failures = result.targets.filter(
      (target) => target.status === "failed",
    );

    if (failures.length === 0) {
      this.failureAlertSent = false;
    } else if (!this.failureAlertSent && this.notificationRecipients.length) {
      try {
        await this.emailService.sendConfigSyncFailureAlert({
          sourceNodeId: this.sourceNodeId,
          failures,
          recipients: this.notificationRecipients,
          startedAt: result.startedAt,
        });
        this.failureAlertSent = true;
      } catch (error) {
        result.notificationError =
          error instanceof Error ? error.message : String(error);
      }
    }

    this.lastRun = result;
    return result;
  }

  private isConfigured(): boolean {
    return this.sourceNodeId.length > 0 && this.targetNodeIds.length > 0;
  }

  private readIntervalMinutes(): number {
    const parsed = Number.parseInt(
      (process.env.CONFIG_SYNC_INTERVAL_MINUTES ?? "60").trim(),
      10,
    );
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 60;
  }
}
