import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { AdvancedBlockingPauseStateService } from "./advanced-blocking-pause-state.service";
import type {
  AdvancedBlockingPauseOperationResult,
  AdvancedBlockingPauseStatus,
  AdvancedBlockingPauseTarget,
} from "./advanced-blocking-pause.types";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import { DnsSchedulesEvaluatorService } from "./dns-schedules-evaluator.service";
import { TechnitiumService } from "./technitium.service";

@Injectable()
export class AdvancedBlockingPauseService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AdvancedBlockingPauseService.name);
  private timer: NodeJS.Timeout | undefined;
  private reconciling: Promise<void> | undefined;

  constructor(
    private readonly pauseState: AdvancedBlockingPauseStateService,
    private readonly advancedBlockingService: AdvancedBlockingService,
    private readonly schedulesEvaluator: DnsSchedulesEvaluatorService,
    private readonly technitiumService: TechnitiumService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.safeReconcile(), 15_000);
    void this.safeReconcile();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  getStatus(): AdvancedBlockingPauseStatus {
    const targets = this.pauseState.list();
    const confirmedPausedTargetCount = targets.filter(
      (target) => target.status === "active" && !target.lastError,
    ).length;
    return {
      // Do not report paused while activation failed or is awaiting verification.
      paused: confirmedPausedTargetCount > 0,
      confirmedPausedTargetCount,
      pendingTargetCount: targets.length - confirmedPausedTargetCount,
      targets,
    };
  }

  async pause(minutes: number): Promise<AdvancedBlockingPauseOperationResult> {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      throw new BadRequestException(
        "minutes must be an integer from 1 through 240.",
      );
    }
    const interactiveNodes = await this.technitiumService.listNodes({
      authMode: "session",
    });
    // Topology summaries intentionally do not claim app capability. Probe the
    // live root through the canonical Advanced Blocking mutation path instead.
    const eligible: string[] = [];
    const probeErrors: Array<{ nodeId: string; error: string }> = [];
    for (const node of interactiveNodes) {
      try {
        const live = await this.advancedBlockingService.verifyPauseRoot(
          node.id,
          "session",
        );
        // A false root flag is eligible only when it is already this
        // Companion-owned pause (an extension). Installed-but-disabled apps
        // must remain on their configured method and are not paused.
        if (!live.paused || this.pauseState.get(live.targetKey)) {
          eligible.push(node.id);
        }
      } catch (error) {
        // Only a successful inventory can establish that the app is absent.
        try {
          if (
            !(await this.technitiumService.getNodeApps(node.id))
              .hasAdvancedBlocking
          )
            continue;
        } catch {
          /* Keep unreadable nodes visible as unconfirmed targets. */
        }
        probeErrors.push({
          nodeId: node.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (eligible.length === 0) {
      throw new BadRequestException({
        message:
          "No eligible Advanced Blocking targets are available to pause.",
        probeErrors,
      });
    }

    const expiresAt = new Date(Date.now() + minutes * 60_000).toISOString();
    const targets = new Map<
      string,
      { anchorNodeId: string; writeNodeId: string }
    >();
    for (const nodeId of eligible) {
      // Resolve the actual mutation target with the unattended credential,
      // then prove that the initiating session can modify that exact node.
      const scheduleTarget =
        await this.advancedBlockingService.resolvePauseTarget(
          nodeId,
          "schedule",
          true,
        );
      await this.technitiumService.assertSessionConfigWriteTargets([
        scheduleTarget.writeNodeId,
      ]);
      if (!targets.has(scheduleTarget.targetKey)) {
        targets.set(scheduleTarget.targetKey, {
          anchorNodeId: nodeId,
          writeNodeId: scheduleTarget.writeNodeId,
        });
      }
    }

    for (const [targetKey, target] of targets) {
      const error = await this.tryActivate(
        targetKey,
        target.anchorNodeId,
        expiresAt,
        target.writeNodeId,
      );
      if (error && !this.pauseState.get(targetKey)) {
        probeErrors.push({ nodeId: target.anchorNodeId, error });
      }
    }
    return { ...this.getStatus(), requestedMinutes: minutes, probeErrors };
  }

  async resumeNow(): Promise<AdvancedBlockingPauseOperationResult> {
    const resolvedTargets: AdvancedBlockingPauseTarget[] = [];
    for (const rawTarget of this.pauseState.list()) {
      const target = await this.resolveDurableTarget(rawTarget);
      if (target) resolvedTargets.push(target);
    }

    for (const target of resolvedTargets) {
      const scheduleTarget =
        await this.advancedBlockingService.resolvePauseTarget(
          target.anchorNodeId,
          "schedule",
          true,
        );
      if (scheduleTarget.targetKey !== target.writeTargetNodeId) {
        this.pauseState.markResumePending(
          target.writeTargetNodeId,
          "The current unattended write target no longer matches durable pause ownership.",
        );
        continue;
      }
      // Do not derive topology from the session. Admit the exact, current
      // unattended write node immediately before the scheduled restore.
      await this.technitiumService.assertSessionConfigWriteTargets([
        scheduleTarget.writeNodeId,
      ]);
      this.pauseState.requestResume(target.writeTargetNodeId);
      const requested = this.pauseState.get(target.writeTargetNodeId);
      if (requested)
        await this.tryResume(requested, scheduleTarget.writeNodeId);
    }
    return this.getStatus();
  }

  private async safeReconcile(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      this.logger.error(
        "Advanced Blocking pause reconciliation failed: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  private async reconcile(): Promise<void> {
    if (this.reconciling) return this.reconciling;
    this.reconciling = (async () => {
      const now = Date.now();
      for (const rawTarget of this.pauseState.list()) {
        const target = await this.resolveDurableTarget(rawTarget);
        if (!target) continue;
        if (Date.parse(target.expiresAt) <= now) {
          await this.tryResume(target);
        } else if (target.status === "active") {
          await this.verifyActiveTarget(target);
        } else {
          await this.tryActivate(target.writeTargetNodeId, target.anchorNodeId);
        }
      }
    })().finally(() => {
      this.reconciling = undefined;
    });
    return this.reconciling;
  }

  private async resolveDurableTarget(
    target: AdvancedBlockingPauseTarget,
  ): Promise<AdvancedBlockingPauseTarget | undefined> {
    try {
      const legacy =
        !target.writeTargetNodeId.startsWith("node:") &&
        !target.writeTargetNodeId.startsWith("cluster:");
      let resolved: { targetKey: string; writeNodeId: string } | undefined;
      try {
        resolved = await this.advancedBlockingService.resolvePauseTarget(
          target.anchorNodeId,
          "schedule",
          true,
        );
      } catch (error) {
        // If the anchor is unreachable, recover through its configured group only.
        // recover only when every reachable candidate resolves to one validated
        // current Primary; ambiguity fails closed.
        const configuredGroupId =
          this.technitiumService.getConfiguredNodeGroupId(target.anchorNodeId);
        if (!configuredGroupId) throw error;
        const candidates = await this.technitiumService.listNodes({
          authMode: "schedule",
        });
        const matches = new Map<
          string,
          { targetKey: string; writeNodeId: string }
        >();
        for (const candidate of candidates.filter(
          (candidate) => candidate.groupId === configuredGroupId,
        )) {
          try {
            const value = await this.advancedBlockingService.resolvePauseTarget(
              candidate.id,
              "schedule",
              true,
            );
            matches.set(value.targetKey, value);
          } catch {
            // Only a validated Primary is eligible; failed candidates are ignored.
          }
        }
        if (matches.size !== 1) throw error;
        resolved = [...matches.values()][0];
      }
      if (!resolved)
        throw new Error("No validated pause write target is available.");
      if (legacy) {
        this.pauseState.migrateLegacyKey(
          target.writeTargetNodeId,
          resolved.targetKey,
        );
        const migrated = this.pauseState.get(resolved.targetKey);
        if (!migrated || migrated.writeTargetNodeId !== resolved.targetKey) {
          throw new Error(
            "Legacy pause migration did not retain durable ownership.",
          );
        }
        return migrated;
      }
      if (resolved.targetKey !== target.writeTargetNodeId) {
        throw new Error(
          "Durable pause ownership key does not match the current validated target.",
        );
      }
      // A validated replacement Primary becomes the durable anchor before
      // verification, interactive resume, or restore can resolve again.
      this.pauseState.adoptResolvedAnchor(
        target.writeTargetNodeId,
        resolved.writeNodeId,
      );
      return {
        ...target,
        anchorNodeId: resolved.writeNodeId,
        lastResolvedNodeId: resolved.writeNodeId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pauseState.markResumePending(target.writeTargetNodeId, message);
      this.logger.warn(
        `Unable to resolve durable Advanced Blocking pause "${target.writeTargetNodeId}": ${message}`,
      );
      return undefined;
    }
  }

  private async verifyActiveTarget(
    target: AdvancedBlockingPauseTarget,
  ): Promise<void> {
    try {
      const live = await this.advancedBlockingService.verifyPauseRoot(
        target.anchorNodeId,
        "schedule",
      );
      if (live.targetKey !== target.writeTargetNodeId) {
        throw new Error(
          "Durable pause ownership key no longer matches the resolved target.",
        );
      }
      if (live.paused) {
        this.pauseState.markVerified(
          target.writeTargetNodeId,
          live.writeNodeId,
        );
        return;
      }
      await this.tryActivate(target.writeTargetNodeId, target.anchorNodeId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.pauseState.markVerificationFailed(
        target.writeTargetNodeId,
        message,
        target.updatedAt,
      );
      this.logger.warn(
        `Failed to verify Advanced Blocking pause for "${target.writeTargetNodeId}": ${message}`,
      );
    }
  }

  private async tryActivate(
    targetKey: string,
    anchorNodeId: string,
    expiresAt?: string,
    expectedWriteNodeId?: string,
  ): Promise<string | undefined> {
    try {
      await this.advancedBlockingService.activatePauseRoot(
        anchorNodeId,
        "schedule",
        (resolved) => {
          if (
            resolved.targetKey !== targetKey ||
            (expectedWriteNodeId &&
              resolved.writeNodeId !== expectedWriteNodeId)
          ) {
            throw new Error(
              "Advanced Blocking pause target changed before activation.",
            );
          }
          if (expiresAt) {
            this.pauseState.beginPause(targetKey, anchorNodeId, expiresAt);
          }
          if (!this.pauseState.get(targetKey)) {
            throw new Error(
              "Advanced Blocking pause ownership was removed before activation.",
            );
          }
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.pauseState.get(targetKey)) {
        this.pauseState.markActivationPending(targetKey, message);
      }
      this.logger.warn(
        `Failed to activate Advanced Blocking pause for "${targetKey}": ${message}`,
      );
      return message;
    }
  }

  private async tryResume(
    target: AdvancedBlockingPauseTarget,
    expectedWriteNodeId?: string,
  ): Promise<void> {
    try {
      if (target.previousEnableBlockingPresent !== undefined) {
        const reconciliation = await this.schedulesEvaluator.runNow(false);
        if (
          reconciliation.errored > 0 ||
          reconciliation.pendingRecoveryCount > 0
        ) {
          throw new Error(
            "DNS Schedule reconciliation is incomplete; keeping Advanced Blocking paused.",
          );
        }
      }
      await this.advancedBlockingService.restorePauseRoot(
        target.anchorNodeId,
        target.previousEnableBlockingPresent
          ? target.previousEnableBlockingValue
          : undefined,
        "schedule",
        (resolvedTargetKey) => {
          if (resolvedTargetKey !== target.writeTargetNodeId) {
            throw new Error(
              "Advanced Blocking pause target changed before resume.",
            );
          }
          this.pauseState.remove(resolvedTargetKey);
        },
        (resolved) => {
          if (
            resolved.targetKey !== target.writeTargetNodeId ||
            (expectedWriteNodeId &&
              resolved.writeNodeId !== expectedWriteNodeId)
          ) {
            throw new Error(
              "Advanced Blocking pause target changed before resume.",
            );
          }
          const current = this.pauseState.get(target.writeTargetNodeId);
          if (
            !current ||
            current.updatedAt !== target.updatedAt ||
            current.expiresAt !== target.expiresAt
          ) {
            throw new Error(
              "Advanced Blocking pause ownership changed before resume.",
            );
          }
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.pauseState.get(target.writeTargetNodeId)) {
        this.pauseState.markResumePending(
          target.writeTargetNodeId,
          message,
          target.updatedAt,
        );
      }
      this.logger.warn(
        `Failed to resume Advanced Blocking for "${target.writeTargetNodeId}": ${message}`,
      );
    }
  }
}
