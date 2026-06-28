import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import type { AdvancedBlockingGroup } from "./advanced-blocking.types";
import { DomainGroupsService } from "./domain-groups.service";
import { DnsSchedulesService } from "./dns-schedules.service";
import type {
  DnsSchedule,
  DnsScheduleApplicationResult,
  DnsScheduleEvaluatorStatus,
  RunDnsScheduleEvaluatorResponse,
} from "./dns-schedules.types";
import { DnsTemporaryOverridesService } from "./dns-temporary-overrides.service";
import type { DnsTemporaryOverride } from "./dns-temporary-overrides.types";
import { LogAlertsEmailService } from "./log-alerts-email.service";
import { LogAlertsRulesService } from "./log-alerts-rules.service";
import { TechnitiumService } from "./technitium.service";

/**
 * Identity of a single thing the evaluator has written to (or wants to
 * write to) an Advanced Blocking config: a (group, action, domain) triple.
 * Used by the apply pass's diff against the per-entry tracking table.
 */
type AppliedEntryTuple = {
  advancedBlockingGroupName: string;
  action: "block" | "allow";
  domain: string;
};

type ClusterWriteOperation = {
  writeTarget: string;
  flushNodes: string[];
};

type ActiveOverrideSource = {
  schedule: DnsSchedule;
  alwaysActive: boolean;
  linkedAlertRulePrefix: "__schedule" | "__temporary-override";
};

function tupleKey(t: AppliedEntryTuple): string {
  // `\0` is the standard separator for composite keys: it can never
  // appear in a group name, action, or DNS name, so the encoding is
  // unambiguous.
  return `${t.advancedBlockingGroupName}\0${t.action}\0${t.domain}`;
}

function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * True if the tuple's (group, action, domain) is currently present in the AB
 * config snapshot. Used by the apply pass to compute additions against LIVE
 * state — see the toAdd construction for why this matters when multiple
 * schedules share the same target tuple.
 */
function isTupleLiveInConfig(
  tuple: AppliedEntryTuple,
  config: { groups: AdvancedBlockingGroup[] },
): boolean {
  const group = config.groups.find(
    (g) => g.name === tuple.advancedBlockingGroupName,
  );
  if (!group) return false;
  const list =
    tuple.action === "block" ? (group.blocked ?? []) : (group.allowed ?? []);
  return list.includes(tuple.domain);
}

@Injectable()
export class DnsSchedulesEvaluatorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DnsSchedulesEvaluatorService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private enabled =
    (process.env.DNS_SCHEDULES_EVALUATOR_ENABLED ?? "true").toLowerCase() !==
    "false";
  private intervalMs = Math.max(
    30_000,
    Number.parseInt(
      process.env.DNS_SCHEDULES_EVALUATOR_INTERVAL_MS ?? "60000",
      10,
    ) || 60_000,
  );

  private lastRunAt?: string;
  private lastSuccessfulRunAt?: string;
  private lastRunError?: string;
  private lastApplied?: number;
  private lastRemoved?: number;
  private lastSkipped?: number;
  private lastErrored?: number;

  // Phase B: drift detection state (in-memory, transient).
  // Key: `${scheduleId}:${writeNodeId}`. Counter tracks consecutive
  // evaluator ticks where an applied schedule's re-apply observed
  // `changed=true` — meaning the AB config lost entries we wrote.
  // Reset to zero on first `changed=false` observation; removed from
  // alerted-episodes set so the next drift episode can alert again.
  private readonly driftCounters = new Map<string, number>();
  private readonly driftAlertedEpisodes = new Set<string>();
  private readonly driftAlertThreshold = Math.max(
    1,
    Number.parseInt(
      process.env.DNS_SCHEDULES_DRIFT_ALERT_THRESHOLD ?? "3",
      10,
    ) || 3,
  );

  // Admin-only recipient list for drift alerts. Intentionally decoupled
  // from schedule.notifyEmails because those may target the schedule's
  // subject (e.g. a child) rather than an operator — see v1.6.3 fix.
  private readonly driftAlertRecipients: string[] = (
    process.env.DNS_SCHEDULES_DRIFT_ALERT_RECIPIENTS ?? ""
  )
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  constructor(
    private readonly schedulesService: DnsSchedulesService,
    private readonly advancedBlockingService: AdvancedBlockingService,
    private readonly technitiumService: TechnitiumService,
    private readonly domainGroupsService: DomainGroupsService,
    private readonly logAlertsRulesService: LogAlertsRulesService,
    private readonly logAlertsEmailService: LogAlertsEmailService,
    private readonly temporaryOverridesService?: DnsTemporaryOverridesService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") {
      return;
    }

    const persisted = this.schedulesService.getEvaluatorEnabled();
    if (persisted !== null) {
      this.enabled = persisted;
    }

    const persistedInterval = this.schedulesService.getEvaluatorIntervalMs();
    if (persistedInterval !== null) {
      this.intervalMs = persistedInterval;
    }

    if (!this.enabled) {
      this.logger.log("DNS Schedules evaluator is disabled.");
      return;
    }

    this.startTimer();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.schedulesService.setEvaluatorEnabled(enabled);
    if (enabled) {
      this.startTimer();
    } else {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.logger.log("DNS Schedules evaluator disabled.");
    }
  }

  setIntervalMs(intervalMs: number): void {
    const clamped = Math.max(30_000, intervalMs);
    this.intervalMs = clamped;
    this.schedulesService.setEvaluatorIntervalMs(clamped);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      if (this.enabled) {
        this.startTimer();
      }
    }
    this.logger.log(
      `DNS Schedules evaluator interval updated to ${clamped}ms.`,
    );
  }

  getStatus(): DnsScheduleEvaluatorStatus {
    return {
      enabled: this.enabled,
      running: this.running,
      intervalMs: this.intervalMs,
      tokenReady:
        this.technitiumService.getScheduleTokenStatus().valid === true,
      lastRunAt: this.lastRunAt,
      lastSuccessfulRunAt: this.lastSuccessfulRunAt,
      lastRunError: this.lastRunError,
      lastApplied: this.lastApplied,
      lastRemoved: this.lastRemoved,
      lastSkipped: this.lastSkipped,
      lastErrored: this.lastErrored,
    };
  }

  async runNow(dryRun: boolean): Promise<RunDnsScheduleEvaluatorResponse> {
    return this.runEvaluation({ dryRun, trigger: "manual" });
  }

  private startTimer(): void {
    if (this.timer) return;
    this.logger.log(
      `DNS Schedules evaluator enabled (interval=${this.intervalMs}ms).`,
    );
    this.timer = setInterval(() => {
      void this.safeScheduledRun();
    }, this.intervalMs);
  }

  private async safeScheduledRun(): Promise<void> {
    try {
      await this.runEvaluation({ dryRun: false, trigger: "scheduled" });
    } catch (error) {
      this.logger.warn(
        `Scheduled DNS schedule evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async runEvaluation(options: {
    dryRun: boolean;
    trigger: "manual" | "scheduled";
  }): Promise<RunDnsScheduleEvaluatorResponse> {
    if (this.running) {
      throw new BadRequestException(
        "DNS Schedules evaluator is already running.",
      );
    }

    this.running = true;
    this.lastRunAt = new Date().toISOString();
    this.lastRunError = undefined;

    try {
      const schedules = this.schedulesService
        .listSchedules()
        .filter((s) => s.enabled);
      const now = new Date();
      const temporaryOverrides =
        this.temporaryOverridesService?.listActiveOverrides(now) ?? [];
      const activeSources: ActiveOverrideSource[] = [
        ...schedules.map((schedule) => ({
          schedule,
          alwaysActive: false,
          linkedAlertRulePrefix: "__schedule" as const,
        })),
        ...temporaryOverrides.map((override) => ({
          schedule: this.temporaryOverrideToSchedule(override),
          alwaysActive: true,
          linkedAlertRulePrefix: "__temporary-override" as const,
        })),
      ];

      // Use schedule auth for the cluster probe so cluster topology is
      // resolvable in this background timer context. With the default session
      // auth, `AuthRequestContext.getSession()` returns undefined here and
      // every node would appear Standalone — defeating Primary-only routing.
      const allNodes = await this.technitiumService.listNodes({
        authMode: "schedule",
      });
      const allNodeIds = allNodes.map((n) => n.id);

      // In a Technitium native cluster, only the Primary accepts config writes.
      // Resolve every candidate node to (writeTarget, flushNodes) once so the
      // tick writes Advanced Blocking config once per cluster Primary and
      // still flushes DNS resolver caches on every physical node.
      const { perCandidate } =
        await this.technitiumService.resolveClusterWriteTargets(
          allNodeIds,
          allNodes,
        );

      const results: DnsScheduleApplicationResult[] = [];
      const activeDesiredTupleKeys = this.getActiveDesiredTupleKeys(
        activeSources,
        now,
      );

      // ── Cleanup pass: remove stale state for disabled/deleted schedules ──
      // Handles schedules that were disabled while their window was open, or
      // deleted after being applied, without waiting for a controller toggle.
      {
        const allSourcesById = new Map(
          [
            ...this.schedulesService.listSchedules(),
            ...(this.temporaryOverridesService
              ?.listOverrides()
              .map((override) => this.temporaryOverrideToSchedule(override)) ??
              []),
          ].map((s) => [s.id, s]),
        );
        const temporaryOverrideIds = new Set(
          this.temporaryOverridesService?.listOverrides().map((o) => o.id) ??
            [],
        );
        const activeSourceIds = new Set(
          activeSources.map((s) => s.schedule.id),
        );
        const staleEntries = this.schedulesService
          .listAppliedState()
          .filter((e) => {
            const s = allSourcesById.get(e.scheduleId);
            return !s || !activeSourceIds.has(e.scheduleId);
          });

        for (const entry of staleEntries) {
          const schedule = allSourcesById.get(entry.scheduleId);
          if (!schedule) {
            // Schedule deleted — clear state only, no AB entries to remove.
            if (!options.dryRun) {
              this.schedulesService.markRemoved(entry.scheduleId, entry.nodeId);
            }
            continue;
          }
          if (options.dryRun) {
            results.push({
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              nodeId: entry.nodeId,
              action: "skipped",
              reason: "dry-run-would-remove-stale",
            });
            continue;
          }
          // State rows may predate the cluster-Primary routing change, meaning
          // `entry.nodeId` could be a secondary. Resolve it so the remove goes
          // to the cluster Primary (writes to secondaries race replication and
          // get reverted). Cache flush still hits all physical nodes.
          const resolved = perCandidate.get(entry.nodeId) ?? {
            writeTarget: entry.nodeId,
            flushNodes: [entry.nodeId],
          };
          try {
            await this.removeScheduleFromNode(
              schedule,
              resolved.writeTarget,
              activeDesiredTupleKeys,
            );
            this.schedulesService.markRemoved(schedule.id, entry.nodeId);
            if (schedule.flushCacheOnChange) {
              for (const flushNodeId of resolved.flushNodes) {
                await this.flushDomainsCache(schedule, flushNodeId);
              }
            }
            this.syncAlertRuleWindow(
              schedule.id,
              schedule.name,
              false,
              temporaryOverrideIds.has(schedule.id)
                ? "__temporary-override"
                : "__schedule",
            );
            this.logger.log(
              `Cleaned up stale entries for disabled schedule "${schedule.name}" from node "${resolved.writeTarget}".`,
            );
            results.push({
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              nodeId: resolved.writeTarget,
              action: "removed",
            });
          } catch (error) {
            this.logger.warn(
              `Failed to clean up stale entries for disabled schedule "${schedule.name}" on node "${resolved.writeTarget}": ${error instanceof Error ? error.message : String(error)}`,
            );
            results.push({
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              nodeId: resolved.writeTarget,
              action: "error",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (!options.dryRun) {
          for (const override of this.temporaryOverridesService?.listOverrides() ??
            []) {
            if (activeSourceIds.has(override.id)) continue;
            this.syncAlertRuleWindow(
              override.id,
              override.name,
              false,
              "__temporary-override",
            );
          }
        }
      }

      for (const source of activeSources) {
        const schedule = source.schedule;
        const candidateNodeIds =
          schedule.nodeIds.length > 0
            ? schedule.nodeIds.filter((id) => allNodeIds.includes(id))
            : allNodeIds;

        // Collapse candidates to unique write targets. In a cluster, multiple
        // candidate secondaries map to the same Primary — dedupe so we write
        // only once per cluster per tick.
        const seenWriteTargets = new Set<string>();
        const operations: ClusterWriteOperation[] = [];
        for (const candidateId of candidateNodeIds) {
          const resolved = perCandidate.get(candidateId) ?? {
            writeTarget: candidateId,
            flushNodes: [candidateId],
          };
          if (seenWriteTargets.has(resolved.writeTarget)) continue;
          seenWriteTargets.add(resolved.writeTarget);
          operations.push(resolved);
        }

        for (const op of operations) {
          const result = await this.evaluateScheduleForNode(
            schedule,
            op.writeTarget,
            op.flushNodes,
            this.getStateNodeIdsForWriteTarget(
              schedule.id,
              op.writeTarget,
              candidateNodeIds,
              perCandidate,
            ),
            now,
            options.dryRun,
            source.alwaysActive,
            activeDesiredTupleKeys,
          );
          results.push(result);
        }

        if (!options.dryRun) {
          this.syncAlertRuleWindow(
            schedule.id,
            schedule.name,
            source.alwaysActive || this.isWindowActive(schedule, now),
            source.linkedAlertRulePrefix,
          );
        }
      }

      const applied = results.filter((r) => r.action === "applied").length;
      const removed = results.filter((r) => r.action === "removed").length;
      const skipped = results.filter((r) => r.action === "skipped").length;
      const errored = results.filter((r) => r.action === "error").length;

      const response: RunDnsScheduleEvaluatorResponse = {
        dryRun: options.dryRun,
        triggeredAt: now.toISOString(),
        evaluatedSchedules: activeSources.length,
        results,
        applied,
        removed,
        skipped,
        errored,
      };

      this.lastSuccessfulRunAt = response.triggeredAt;
      this.lastApplied = applied;
      this.lastRemoved = removed;
      this.lastSkipped = skipped;
      this.lastErrored = errored;

      return response;
    } catch (error) {
      this.lastRunError =
        error instanceof Error ? error.message : "Unknown evaluator error.";
      throw error;
    } finally {
      this.running = false;
    }
  }

  private getStateNodeIdsForWriteTarget(
    scheduleId: string,
    writeTarget: string,
    candidateNodeIds: string[],
    perCandidate: Map<string, { writeTarget: string; flushNodes: string[] }>,
  ): string[] {
    const stateNodeIds = new Set<string>([writeTarget]);
    const candidateSet = new Set(candidateNodeIds);
    for (const entry of this.schedulesService.listAppliedState()) {
      if (entry.scheduleId !== scheduleId) continue;
      if (!candidateSet.has(entry.nodeId) && entry.nodeId !== writeTarget) {
        continue;
      }
      const resolved = perCandidate.get(entry.nodeId) ?? {
        writeTarget: entry.nodeId,
        flushNodes: [entry.nodeId],
      };
      if (resolved.writeTarget === writeTarget) {
        stateNodeIds.add(entry.nodeId);
      }
    }
    return [...stateNodeIds];
  }

  private getActiveDesiredTupleKeys(
    activeSources: ActiveOverrideSource[],
    now: Date,
  ): Set<string> {
    const keys = new Set<string>();
    for (const source of activeSources) {
      if (!source.alwaysActive && !this.isWindowActive(source.schedule, now)) {
        continue;
      }
      for (const tuple of this.getDesiredTuples(source.schedule)) {
        keys.add(tupleKey(tuple));
      }
    }
    return keys;
  }

  private getDesiredTuples(schedule: DnsSchedule): AppliedEntryTuple[] {
    if (schedule.targetType === "built-in") return [];
    const resolvedEntries = this.resolveDomainEntries(schedule);
    const tuples: AppliedEntryTuple[] = [];
    for (const groupName of schedule.advancedBlockingGroupNames) {
      for (const domain of resolvedEntries) {
        tuples.push({
          advancedBlockingGroupName: groupName,
          action: schedule.action,
          domain,
        });
      }
    }
    return tuples;
  }

  temporaryOverrideToSchedule(override: DnsTemporaryOverride): DnsSchedule {
    return {
      id: override.id,
      name: override.name,
      enabled: override.enabled,
      targetType: "advanced-blocking",
      advancedBlockingGroupNames: override.advancedBlockingGroupNames,
      action: override.action,
      domainEntries: override.domainEntries,
      domainGroupNames: override.domainGroupNames,
      daysOfWeek: [],
      startTime: "00:00",
      endTime: "23:59",
      timezone: "UTC",
      nodeIds: override.nodeIds,
      flushCacheOnChange: override.flushCacheOnChange,
      notifyEmails: override.notifyEmails,
      notifyDebounceSeconds: override.notifyDebounceSeconds,
      notifyMessage: override.notifyMessage,
      notifyMessageOnly: override.notifyMessageOnly,
      notifySubjectTemplate: override.notifySubjectTemplate,
      createdAt: override.createdAt,
      updatedAt: override.updatedAt,
    };
  }

  private clearStateRows(scheduleId: string, stateNodeIds: string[]): void {
    for (const stateNodeId of stateNodeIds) {
      this.schedulesService.markRemoved(scheduleId, stateNodeId);
      this.schedulesService.clearAppliedEntries(scheduleId, stateNodeId);
      this.resetDriftState(scheduleId, stateNodeId);
    }
  }

  private clearLegacyStateRows(
    scheduleId: string,
    canonicalNodeId: string,
    stateNodeIds: string[],
  ): void {
    for (const stateNodeId of stateNodeIds) {
      if (stateNodeId === canonicalNodeId) continue;
      this.schedulesService.markRemoved(scheduleId, stateNodeId);
      this.schedulesService.clearAppliedEntries(scheduleId, stateNodeId);
      this.resetDriftState(scheduleId, stateNodeId);
    }
  }

  private async evaluateScheduleForNode(
    schedule: DnsSchedule,
    nodeId: string,
    flushNodeIds: string[],
    stateNodeIds: string[],
    now: Date,
    dryRun: boolean,
    alwaysActive = false,
    protectedTupleKeys: Set<string> = new Set(),
  ): Promise<DnsScheduleApplicationResult> {
    const shouldBeActive = alwaysActive || this.isWindowActive(schedule, now);
    const isCurrentlyApplied = stateNodeIds.some((stateNodeId) =>
      this.schedulesService.isApplied(schedule.id, stateNodeId),
    );

    // Already inactive — nothing to do this tick.
    if (!shouldBeActive && !isCurrentlyApplied) {
      return {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        nodeId,
        action: "skipped",
        reason: "already-inactive",
      };
    }

    // Window active and already applied. For advanced-blocking schedules,
    // fall through to re-apply so any DG entry additions since the last apply
    // are picked up (applyAdvancedBlockingScheduleToNode diffs against live
    // Technitium state and skips setConfig when nothing changed).
    // Built-in mode calls individual add-per-domain APIs with no diff, so
    // skip as before to avoid redundant per-domain requests.
    if (
      shouldBeActive &&
      isCurrentlyApplied &&
      schedule.targetType === "built-in"
    ) {
      return {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        nodeId,
        action: "skipped",
        reason: "already-applied",
      };
    }

    if (dryRun) {
      return {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        nodeId,
        action: "skipped",
        reason:
          shouldBeActive && isCurrentlyApplied
            ? "already-applied"
            : `dry-run-would-${shouldBeActive ? "apply" : "remove"}`,
      };
    }

    try {
      if (shouldBeActive) {
        const changed = await this.applyScheduleToNode(schedule, nodeId);
        if (!isCurrentlyApplied) {
          this.schedulesService.markApplied(schedule.id, nodeId);
          this.clearLegacyStateRows(schedule.id, nodeId, stateNodeIds);
          const modeDetail =
            schedule.targetType === "built-in"
              ? "mode=built-in"
              : `groups=${schedule.advancedBlockingGroupNames.join(",")}`;
          this.logger.log(
            `Applied schedule "${schedule.name}" to node "${nodeId}" (action=${schedule.action}, ${modeDetail}).`,
          );
          // Fresh apply — any prior drift bookkeeping is stale; reset so the
          // next window cycle starts clean.
          this.resetDriftState(schedule.id, nodeId);
        } else if (changed) {
          this.schedulesService.markApplied(schedule.id, nodeId);
          this.clearLegacyStateRows(schedule.id, nodeId, stateNodeIds);
          this.logger.log(
            `Re-applied schedule "${schedule.name}" to node "${nodeId}" — DG entries updated.`,
          );
          // The schedule was already applied but we had to write again —
          // classic drift signal. Track consecutive occurrences; alert when
          // the count crosses the threshold (caller-configurable).
          this.recordDriftTick(schedule, nodeId);
        } else {
          this.schedulesService.markApplied(schedule.id, nodeId);
          this.clearLegacyStateRows(schedule.id, nodeId, stateNodeIds);
          // changed=false after a re-apply means the AB config already has
          // everything we want. Drift episode (if any) has resolved.
          this.resetDriftState(schedule.id, nodeId);
        }
        if (changed && schedule.flushCacheOnChange) {
          for (const flushNodeId of flushNodeIds) {
            await this.flushDomainsCache(schedule, flushNodeId);
          }
        }
        if (!isCurrentlyApplied || changed) {
          return {
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            nodeId,
            action: "applied",
          };
        }
        return {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          nodeId,
          action: "skipped",
          reason: "already-applied",
        };
      } else {
        await this.removeScheduleFromNode(schedule, nodeId, protectedTupleKeys);
        this.clearStateRows(schedule.id, stateNodeIds);
        this.logger.log(
          `Removed schedule "${schedule.name}" from node "${nodeId}".`,
        );
        // Window closed — drop any drift bookkeeping for this pair. Next
        // window opens with a clean counter.
        this.resetDriftState(schedule.id, nodeId);
        if (schedule.flushCacheOnChange) {
          for (const flushNodeId of flushNodeIds) {
            await this.flushDomainsCache(schedule, flushNodeId);
          }
        }
        return {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          nodeId,
          action: "removed",
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      this.logger.error(
        `Failed to ${shouldBeActive ? "apply" : "remove"} schedule "${schedule.name}" on node "${nodeId}": ${message}`,
      );
      return {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        nodeId,
        action: "error",
        error: message,
      };
    }
  }

  /**
   * Resolves the full set of domain entries for a schedule by combining
   * explicit `domainEntries` with entries from referenced Domain Groups.
   * Domain Group entries are resolved fresh on every call so updates to a
   * group are automatically reflected without re-saving the schedule.
   * Only exact-match entries from Domain Groups are used.
   */
  private resolveDomainEntries(schedule: DnsSchedule): string[] {
    const dgEntries =
      schedule.domainGroupNames.length > 0
        ? this.domainGroupsService.getExactEntriesByGroupNames(
            schedule.domainGroupNames,
          )
        : [];
    return [...new Set([...schedule.domainEntries, ...dgEntries])];
  }

  private async applyScheduleToNode(
    schedule: DnsSchedule,
    nodeId: string,
  ): Promise<boolean> {
    if (schedule.targetType === "built-in") {
      await this.applyBuiltInScheduleToNode(schedule, nodeId);
      return true;
    } else {
      return this.applyAdvancedBlockingScheduleToNode(schedule, nodeId);
    }
  }

  /**
   * Immediately removes a schedule from every node it is currently applied to.
   * Called when a schedule is disabled so Applied Blocking entries are cleaned
   * up without waiting for the next evaluator tick. Best-effort per node —
   * failures are logged as warnings and never thrown.
   */
  async deactivateScheduleIfApplied(schedule: DnsSchedule): Promise<void> {
    const applied = this.schedulesService
      .listAppliedState()
      .filter((e) => e.scheduleId === schedule.id);
    if (applied.length === 0) return;

    this.logger.log(
      `Deactivating disabled schedule "${schedule.name}" from ${applied.length} node(s).`,
    );

    // Resolve every applied node to its cluster write target + flush nodes.
    // State rows may predate Primary routing (legacy secondary entries), so we
    // can't assume `entry.nodeId` is the write-addressable node.
    // Use schedule auth so cluster topology is resolvable even when this is
    // called outside a request context (e.g. from a future timer-driven path).
    const appliedNodeIds = applied.map((e) => e.nodeId);
    const allNodes = await this.technitiumService.listNodes({
      authMode: "schedule",
    });
    const { perCandidate } =
      await this.technitiumService.resolveClusterWriteTargets(
        appliedNodeIds,
        allNodes,
      );
    const now = new Date();
    const protectedTupleKeys = this.getActiveDesiredTupleKeys(
      [
        ...this.schedulesService
          .listSchedules()
          .filter((s) => s.enabled && s.id !== schedule.id)
          .map((activeSchedule) => ({
            schedule: activeSchedule,
            alwaysActive: false,
            linkedAlertRulePrefix: "__schedule" as const,
          })),
        ...(this.temporaryOverridesService
          ?.listActiveOverrides(now)
          .map((override) => ({
            schedule: this.temporaryOverrideToSchedule(override),
            alwaysActive: true,
            linkedAlertRulePrefix: "__temporary-override" as const,
          })) ?? []),
      ],
      now,
    );

    const seenWriteTargets = new Set<string>();
    for (const entry of applied) {
      const resolved = perCandidate.get(entry.nodeId) ?? {
        writeTarget: entry.nodeId,
        flushNodes: [entry.nodeId],
      };
      // Skip duplicate Primary writes when multiple secondaries of the same
      // cluster have legacy state rows for this schedule.
      const skipWrite = seenWriteTargets.has(resolved.writeTarget);
      seenWriteTargets.add(resolved.writeTarget);
      try {
        if (!skipWrite) {
          await this.removeScheduleFromNode(
            schedule,
            resolved.writeTarget,
            protectedTupleKeys,
          );
        }
        this.schedulesService.markRemoved(schedule.id, entry.nodeId);
        if (!skipWrite && schedule.flushCacheOnChange) {
          for (const flushNodeId of resolved.flushNodes) {
            await this.flushDomainsCache(schedule, flushNodeId);
          }
        }
      } catch (error) {
        this.logger.warn(
          `Failed to deactivate schedule "${schedule.name}" on node "${resolved.writeTarget}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.syncAlertRuleWindow(schedule.id, schedule.name, false);
  }

  private async removeScheduleFromNode(
    schedule: DnsSchedule,
    nodeId: string,
    protectedTupleKeys: Set<string> = new Set(),
  ): Promise<void> {
    if (schedule.targetType === "built-in") {
      await this.removeBuiltInScheduleFromNode(schedule, nodeId);
    } else {
      await this.removeAdvancedBlockingScheduleFromNode(
        schedule,
        nodeId,
        protectedTupleKeys,
      );
    }
  }

  private async applyBuiltInScheduleToNode(
    schedule: DnsSchedule,
    nodeId: string,
  ): Promise<void> {
    const endpoint = schedule.action === "block" ? "blocked" : "allowed";
    const resolvedEntries = this.resolveDomainEntries(schedule);
    const errors: string[] = [];

    for (const domain of resolvedEntries) {
      try {
        await this.technitiumService.executeAction(
          nodeId,
          { method: "GET", url: `/api/${endpoint}/add`, params: { domain } },
          { authMode: "schedule" },
        );
      } catch (error) {
        errors.push(
          `${domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Failed to add ${errors.length} domain(s) to built-in ${endpoint} list: ${errors.slice(0, 3).join("; ")}`,
      );
    }
  }

  private async removeBuiltInScheduleFromNode(
    schedule: DnsSchedule,
    nodeId: string,
  ): Promise<void> {
    const endpoint = schedule.action === "block" ? "blocked" : "allowed";
    const resolvedEntries = this.resolveDomainEntries(schedule);
    const errors: string[] = [];

    for (const domain of resolvedEntries) {
      try {
        await this.technitiumService.executeAction(
          nodeId,
          { method: "GET", url: `/api/${endpoint}/delete`, params: { domain } },
          { authMode: "schedule" },
        );
      } catch (error) {
        errors.push(
          `${domain}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `Failed to remove ${errors.length} domain(s) from built-in ${endpoint} list: ${errors.slice(0, 3).join("; ")}`,
      );
    }
  }

  private async applyAdvancedBlockingScheduleToNode(
    schedule: DnsSchedule,
    nodeId: string,
  ): Promise<boolean> {
    const snapshot = await this.advancedBlockingService.getSnapshotWithAuth(
      nodeId,
      "schedule",
    );
    if (snapshot.error || !snapshot.config) {
      throw new Error(
        `Unable to load Advanced Blocking config from node "${nodeId}": ${snapshot.error ?? "no config in response"}`,
      );
    }
    const config = snapshot.config;

    // Validate that every target AB group exists on the node before doing
    // any work. Removals can target groups that no longer exist (group was
    // deleted while the schedule was applied) — that case is tolerated by
    // skipping the missing group in the removal pass below.
    for (const groupName of schedule.advancedBlockingGroupNames) {
      if (!config.groups.some((g) => g.name === groupName)) {
        throw new Error(
          `Advanced Blocking group "${groupName}" not found on node "${nodeId}".`,
        );
      }
    }

    // Desired state: every (group, action, domain) tuple the schedule
    // currently resolves to.
    const resolvedEntries = this.resolveDomainEntries(schedule);
    const desired = new Map<string, AppliedEntryTuple>();
    for (const groupName of schedule.advancedBlockingGroupNames) {
      for (const domain of resolvedEntries) {
        const tuple: AppliedEntryTuple = {
          advancedBlockingGroupName: groupName,
          action: schedule.action,
          domain,
        };
        desired.set(tupleKey(tuple), tuple);
      }
    }

    // Previous state: what we tracked on the last successful apply.
    const prev = this.schedulesService.listAppliedEntries(schedule.id, nodeId);
    const prevByKey = new Map<string, AppliedEntryTuple>();
    for (const e of prev) {
      const tuple: AppliedEntryTuple = {
        advancedBlockingGroupName: e.advancedBlockingGroupName,
        action: e.action,
        domain: e.domain,
      };
      prevByKey.set(tupleKey(tuple), tuple);
    }

    // Removals: anything we tracked but no longer want (prev \ desired).
    // A definition change (group swap, action flip, etc.) surfaces here as
    // the cleanup of the now-stale tuple.
    const toRemove: AppliedEntryTuple[] = [];
    for (const [key, tuple] of prevByKey) {
      if (!desired.has(key)) toRemove.push(tuple);
    }

    // Additions: anything desired that's not currently in LIVE state,
    // regardless of what we previously tracked. Self-heals three scenarios
    // the prev-vs-desired set diff misses:
    //   (a) Another schedule sharing the same (group, action, domain)
    //       removed our entries when it cleaned itself up. Without this,
    //       both schedules' tracking still claims the tuples are applied
    //       and neither one re-adds them. With this, the surviving
    //       schedule's next tick restores the live state.
    //   (b) External mutation of the AB config (manual UI edit, a
    //       conflicting Domain Groups apply, an automation). Drift gets
    //       healed on the same tick instead of requiring N consecutive
    //       drift ticks to alert.
    //   (c) Restart-with-mid-edit state where tracking and live diverged
    //       before we crashed.
    const toAdd: AppliedEntryTuple[] = [];
    for (const tuple of desired.values()) {
      if (!isTupleLiveInConfig(tuple, config)) toAdd.push(tuple);
    }

    let changed = false;
    const updatedGroups = [...config.groups];

    // Pass 1: remove orphaned tuples from the (possibly old) target groups.
    // Group-by-group so we only rebuild each group's list once even when
    // many tuples target it.
    const removalsByGroup = groupBy(
      toRemove,
      (t) => t.advancedBlockingGroupName,
    );
    for (const [groupName, removals] of removalsByGroup) {
      const groupIdx = updatedGroups.findIndex((g) => g.name === groupName);
      if (groupIdx === -1) continue; // Group gone — nothing to remove from
      const group = updatedGroups[groupIdx];
      // Tuples in this group are partitioned by action; strip each action's
      // list independently so a block→allow flip doesn't accidentally touch
      // the other list.
      const blockedToStrip = new Set(
        removals.filter((t) => t.action === "block").map((t) => t.domain),
      );
      const allowedToStrip = new Set(
        removals.filter((t) => t.action === "allow").map((t) => t.domain),
      );
      let mutated = false;
      let nextBlocked = group.blocked ?? [];
      let nextAllowed = group.allowed ?? [];
      if (blockedToStrip.size > 0) {
        const stripped = nextBlocked.filter((d) => !blockedToStrip.has(d));
        if (stripped.length !== nextBlocked.length) {
          nextBlocked = stripped;
          mutated = true;
        }
      }
      if (allowedToStrip.size > 0) {
        const stripped = nextAllowed.filter((d) => !allowedToStrip.has(d));
        if (stripped.length !== nextAllowed.length) {
          nextAllowed = stripped;
          mutated = true;
        }
      }
      if (mutated) {
        updatedGroups[groupIdx] = {
          ...group,
          blocked: nextBlocked,
          allowed: nextAllowed,
        };
        changed = true;
      }
    }

    // Pass 2: add missing-from-live tuples to the target groups. The
    // additions list has already been filtered against live state above,
    // so no further per-domain dedup is needed here.
    const additionsByGroup = groupBy(toAdd, (t) => t.advancedBlockingGroupName);
    for (const [groupName, additions] of additionsByGroup) {
      const groupIdx = updatedGroups.findIndex((g) => g.name === groupName);
      if (groupIdx === -1) continue; // Should not happen — validated above
      const group = updatedGroups[groupIdx];
      const listKey: keyof Pick<AdvancedBlockingGroup, "blocked" | "allowed"> =
        schedule.action === "block" ? "blocked" : "allowed";
      const currentEntries = group[listKey] ?? [];
      const newEntries = additions.map((t) => t.domain);
      if (newEntries.length > 0) {
        updatedGroups[groupIdx] = {
          ...group,
          [listKey]: [...currentEntries, ...newEntries],
        };
        changed = true;
      }
    }

    if (changed) {
      await this.advancedBlockingService.setConfigWithAuth(
        nodeId,
        { ...config, groups: updatedGroups },
        "schedule",
      );
    }

    // Commit tracking ONLY when the desired set actually differs from prev.
    // We deliberately do NOT gate this on toAdd: toAdd is computed against
    // LIVE state (for self-healing re-adds when another schedule removed
    // shared tuples), but tracking represents "what this schedule wants
    // applied" which is desired === prev as long as the schedule's
    // definition hasn't changed. Re-writing identical tracking rows on
    // every tick would burn SQLite WAL for nothing.
    const trackingUnchanged =
      toRemove.length === 0 && prevByKey.size === desired.size;
    if (!trackingUnchanged) {
      this.schedulesService.setAppliedEntries(schedule.id, nodeId, [
        ...desired.values(),
      ]);
    }

    return changed;
  }

  private async removeAdvancedBlockingScheduleFromNode(
    schedule: DnsSchedule,
    nodeId: string,
    protectedTupleKeys: Set<string> = new Set(),
  ): Promise<void> {
    // Primary source of truth is the per-entry tracking table: it correctly
    // describes what we wrote even after the schedule's definition has
    // changed since apply (e.g. user swapped Domain Groups mid-window).
    //
    // Legacy fallback: if tracking is empty BUT the schedule has a non-empty
    // resolved set, this is the upgrade-path case where a pre-tracking-table
    // version applied entries that we still need to clean up. Synthesizing
    // tuples from the current definition matches the OLD remove behavior —
    // imperfect when the definition changed before the upgrade, but strictly
    // better than silently leaking entries forever.
    const tracked = this.schedulesService.listAppliedEntries(
      schedule.id,
      nodeId,
    );

    let removalTuples: AppliedEntryTuple[];
    if (tracked.length > 0) {
      removalTuples = tracked.map((t) => ({
        advancedBlockingGroupName: t.advancedBlockingGroupName,
        action: t.action,
        domain: t.domain,
      }));
    } else {
      // Legacy migration path.
      const resolved = this.resolveDomainEntries(schedule);
      removalTuples = [];
      for (const groupName of schedule.advancedBlockingGroupNames) {
        for (const domain of resolved) {
          removalTuples.push({
            advancedBlockingGroupName: groupName,
            action: schedule.action,
            domain,
          });
        }
      }
      if (removalTuples.length === 0) {
        // Nothing tracked AND nothing resolvable — truly nothing to remove.
        return;
      }
      this.logger.log(
        `Schedule "${schedule.name}" on node "${nodeId}": no per-entry tracking; using legacy resolve-from-definition cleanup (one-time, post-upgrade).`,
      );
    }

    removalTuples = removalTuples.filter(
      (tuple) => !protectedTupleKeys.has(tupleKey(tuple)),
    );
    if (removalTuples.length === 0) {
      this.schedulesService.clearAppliedEntries(schedule.id, nodeId);
      return;
    }

    const snapshot = await this.advancedBlockingService.getSnapshotWithAuth(
      nodeId,
      "schedule",
    );
    // loadSnapshot populates `error` on caught failures and leaves `config`
    // undefined. Propagating the error keeps the caller from calling
    // clearAppliedEntries and orphaning entries that are still live in
    // Technitium.
    if (snapshot.error || !snapshot.config) {
      throw new Error(
        `Unable to load Advanced Blocking config from node "${nodeId}": ${snapshot.error ?? "no config in response"}`,
      );
    }
    const config = snapshot.config;

    const updatedGroups = [...config.groups];
    let changed = false;

    // Group removal tuples by group name so we rebuild each AB group at
    // most once.
    const trackedByGroup = groupBy(
      removalTuples,
      (t) => t.advancedBlockingGroupName,
    );
    for (const [groupName, entries] of trackedByGroup) {
      const groupIdx = updatedGroups.findIndex((g) => g.name === groupName);
      if (groupIdx === -1) continue; // Group was deleted — clear tracking below
      const group = updatedGroups[groupIdx];

      const blockedToStrip = new Set(
        entries.filter((e) => e.action === "block").map((e) => e.domain),
      );
      const allowedToStrip = new Set(
        entries.filter((e) => e.action === "allow").map((e) => e.domain),
      );

      let mutated = false;
      let nextBlocked = group.blocked ?? [];
      let nextAllowed = group.allowed ?? [];
      if (blockedToStrip.size > 0) {
        const stripped = nextBlocked.filter((d) => !blockedToStrip.has(d));
        if (stripped.length !== nextBlocked.length) {
          nextBlocked = stripped;
          mutated = true;
        }
      }
      if (allowedToStrip.size > 0) {
        const stripped = nextAllowed.filter((d) => !allowedToStrip.has(d));
        if (stripped.length !== nextAllowed.length) {
          nextAllowed = stripped;
          mutated = true;
        }
      }
      if (mutated) {
        updatedGroups[groupIdx] = {
          ...group,
          blocked: nextBlocked,
          allowed: nextAllowed,
        };
        changed = true;
      }
    }

    if (changed) {
      await this.advancedBlockingService.setConfigWithAuth(
        nodeId,
        { ...config, groups: updatedGroups },
        "schedule",
      );
    }

    // Clear tracking only after a successful write (or no-op write). On
    // failure we throw above and the caller skips markRemoved + this clear,
    // so the next tick can retry from the same prev-tracked baseline.
    this.schedulesService.clearAppliedEntries(schedule.id, nodeId);
  }

  /**
   * Best-effort full DNS resolver cache flush on the node. A full flush
   * (no domain param) is used rather than per-domain flushes because
   * Technitium evaluates Advanced Blocking rules on cache misses only —
   * stale subdomain entries (e.g. www.youtube.com when youtube.com is
   * blocked) survive a per-domain flush and continue resolving from cache.
   * Failures (e.g. missing Cache: Modify permission) are logged as
   * warnings and never propagate to callers.
   */
  private async flushDomainsCache(
    schedule: DnsSchedule,
    nodeId: string,
  ): Promise<void> {
    try {
      await this.technitiumService.executeAction(
        nodeId,
        { method: "GET", url: "/api/cache/flush" },
        { authMode: "schedule" },
      );
      this.logger.log(
        `Full cache flush completed on node "${nodeId}" after schedule "${schedule.name}" change.`,
      );
    } catch (error) {
      this.logger.warn(
        `Cache flush failed for schedule "${schedule.name}" on node "${nodeId}": ` +
          `${error instanceof Error ? error.message : String(error)} ` +
          `(token may lack Cache: Modify permission).`,
      );
    }
  }

  /**
   * Enables or disables the linked Log Alert rule for the schedule to match
   * the current window state. This is the authoritative toggle — the rule is
   * only enabled while the window is open, preventing false alerts from
   * domains that are permanently blocked in the same AB group.
   * Best-effort: failures are logged as warnings and never propagate.
   */
  private syncAlertRuleWindow(
    scheduleId: string,
    scheduleName: string,
    shouldBeActive: boolean,
    rulePrefix: "__schedule" | "__temporary-override" = "__schedule",
  ): void {
    try {
      const ruleName = `${rulePrefix}:${scheduleId}__`;
      const existing = this.logAlertsRulesService
        .listRules()
        .find((r) => r.name === ruleName);
      if (!existing) return; // No linked rule — notifyEmails is empty
      if (existing.enabled === shouldBeActive) return; // Already correct
      this.logAlertsRulesService.updateRule(existing.id, {
        ...existing,
        displayName: scheduleName,
        enabled: shouldBeActive,
      });
      this.logger.log(
        `${shouldBeActive ? "Enabled" : "Disabled"} linked alert rule for schedule "${scheduleName}".`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to ${shouldBeActive ? "enable" : "disable"} linked alert rule for schedule "${scheduleName}": ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Derives a domain pattern scoped to the schedule's actual domain sources
   * (manual entries + resolved Domain Group entries). Falls back to wildcard:*
   * either when the schedule has no domain sources, OR when the constructed
   * regex would exceed the linked alert rule's pattern length cap.
   *
   * The wildcard fallback stays semantically correct because the linked
   * rule is also scoped by group selector + active-window gating: during the
   * window, any blocked query in the schedule's target AB group fires the
   * alert. Slightly broader scope than the precise regex but never wrong,
   * and ensures notifications keep working for large Domain Groups (e.g.
   * an ad-block list with thousands of entries).
   */
  buildAlertDomainPattern(schedule: DnsSchedule): {
    pattern: string;
    type: "wildcard" | "regex";
  } {
    let dgEntries: string[] = [];
    if (schedule.domainGroupNames.length > 0) {
      try {
        dgEntries = this.domainGroupsService.getExactEntriesByGroupNames(
          schedule.domainGroupNames,
        );
      } catch {
        // DG service unavailable; use manual entries only
      }
    }
    const allEntries = [
      ...new Set([...schedule.domainEntries, ...dgEntries]),
    ].filter((e) => e.length > 0);

    if (allEntries.length === 0) {
      return { pattern: "*", type: "wildcard" };
    }

    const escaped = allEntries.map((e) =>
      e.replace(/[.+*?^${}()|[\]\\]/g, "\\$&"),
    );
    const pattern = `(?:^|\\.)(?:${escaped.join("|")})$`;

    // Safety margin under LogAlertsRulesService's 8000-char domain_pattern
    // cap. If we'd construct an over-cap regex, fall back to wildcard so
    // sync never fails. Leave headroom for future cap adjustments and any
    // additional encoding the storage layer might add.
    const PATTERN_MAX_LENGTH = 7500;
    if (pattern.length > PATTERN_MAX_LENGTH) {
      this.logger.warn(
        `Schedule "${schedule.name}" resolved ${allEntries.length} domain(s) → alert pattern ${pattern.length} chars exceeds ${PATTERN_MAX_LENGTH}-char cap. Falling back to wildcard pattern; alerts will fire for ANY blocked query in the target group(s) during the active window, including any manually-added entries.`,
      );
      return { pattern: "*", type: "wildcard" };
    }

    return { pattern, type: "regex" };
  }

  /**
   * Re-syncs the domain pattern of the linked alert rule for every schedule
   * that references the given Domain Group by name. Called after DG entry
   * mutations so alert rules stay accurate without requiring a manual
   * schedule re-save. Best-effort: failures are logged and never propagate.
   */
  syncAlertRulesForDomainGroup(dgName: string): void {
    try {
      const schedules = this.schedulesService.listSchedules();
      for (const schedule of schedules) {
        if (
          schedule.notifyEmails.length === 0 ||
          !schedule.domainGroupNames.includes(dgName)
        ) {
          continue;
        }
        try {
          const ruleName = `__schedule:${schedule.id}__`;
          const existing = this.logAlertsRulesService
            .listRules()
            .find((r) => r.name === ruleName);
          if (!existing) continue;
          const { pattern, type } = this.buildAlertDomainPattern(schedule);
          if (
            existing.domainPattern === pattern &&
            existing.domainPatternType === type
          ) {
            continue;
          }
          this.logAlertsRulesService.updateRule(existing.id, {
            ...existing,
            displayName: schedule.name,
            domainPattern: pattern,
            domainPatternType: type,
          });
          this.logger.log(
            `Updated alert rule pattern for schedule "${schedule.name}" after DG "${dgName}" change.`,
          );
        } catch (error) {
          this.logger.warn(
            `Failed to update alert rule pattern for schedule "${schedule.name}": ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to sync alert rules for domain group "${dgName}": ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Determines whether the schedule's time window is currently active.
   *
   * For overnight windows (startTime > endTime, e.g. 22:00–07:00):
   *   - If current time >= startTime: the start day is today → check today in daysOfWeek.
   *   - If current time < endTime: the start day was yesterday → check yesterday in daysOfWeek.
   *
   * Empty daysOfWeek = active every day.
   */
  isWindowActive(schedule: DnsSchedule, now: Date): boolean {
    const tz = schedule.timezone;
    const currentMinutes = this.getMinuteOfDayInTz(now, tz);
    const currentDow = this.getDayOfWeekInTz(now, tz);

    const startMinutes = this.timeToMinutes(schedule.startTime);
    const endMinutes = this.timeToMinutes(schedule.endTime);

    const isOvernight = startMinutes > endMinutes;

    let inTimeWindow: boolean;
    let activeDow: number; // The "start" day to check against daysOfWeek

    if (!isOvernight) {
      // Same-day window: 09:00–22:00 style
      inTimeWindow =
        currentMinutes >= startMinutes && currentMinutes < endMinutes;
      activeDow = currentDow;
    } else {
      // Overnight window: 22:00–07:00 style
      if (currentMinutes >= startMinutes) {
        // Past start time — active day is today
        inTimeWindow = true;
        activeDow = currentDow;
      } else if (currentMinutes < endMinutes) {
        // Before end time — active day is yesterday
        inTimeWindow = true;
        activeDow = (currentDow + 6) % 7; // yesterday
      } else {
        // Between endTime and startTime → inactive
        inTimeWindow = false;
        activeDow = currentDow;
      }
    }

    if (!inTimeWindow) {
      return false;
    }

    // Empty daysOfWeek means every day
    if (schedule.daysOfWeek.length === 0) {
      return true;
    }

    return schedule.daysOfWeek.includes(activeDow);
  }

  private getMinuteOfDayInTz(date: Date, tz: string): number {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(date);
      const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
      const minute = Number(
        parts.find((p) => p.type === "minute")?.value ?? "0",
      );
      // Intl can return hour=24 for midnight in some locales — clamp to 0
      return (hour === 24 ? 0 : hour) * 60 + minute;
    } catch {
      this.logger.warn(`Invalid timezone "${tz}" — falling back to UTC.`);
      return date.getUTCHours() * 60 + date.getUTCMinutes();
    }
  }

  private getDayOfWeekInTz(date: Date, tz: string): number {
    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
      });
      const weekdayStr = formatter.format(date);
      const days: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      return days[weekdayStr] ?? date.getUTCDay();
    } catch {
      return date.getUTCDay();
    }
  }

  private timeToMinutes(time: string): number {
    const [h, m] = time.split(":").map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }

  // ── Phase B: drift detection ────────────────────────────────────────────

  /**
   * Records one consecutive evaluator tick where an already-applied
   * schedule needed re-applying (meaning something mutated the AB config
   * between ticks). Fires a drift alert once per episode when the
   * threshold is crossed; subsequent ticks within the same episode
   * increment silently until the counter resets.
   */
  private recordDriftTick(schedule: DnsSchedule, nodeId: string): void {
    const key = `${schedule.id}:${nodeId}`;
    const count = (this.driftCounters.get(key) ?? 0) + 1;
    this.driftCounters.set(key, count);

    if (count < this.driftAlertThreshold) return;
    if (this.driftAlertedEpisodes.has(key)) return;
    this.driftAlertedEpisodes.add(key);

    this.logger.warn(
      `Configuration drift detected for schedule "${schedule.name}" on node "${nodeId}": ` +
        `${count} consecutive re-applies. Another process may be mutating the Advanced Blocking config.`,
    );

    if (this.driftAlertRecipients.length === 0) return;

    // Best-effort email; failures never block the evaluator tick.
    const revertedEntries = this.resolveDomainEntries(schedule);
    const tickIntervalSeconds = Math.max(1, Math.floor(this.intervalMs / 1000));
    void this.logAlertsEmailService
      .sendScheduleDriftAlert({
        scheduleName: schedule.name,
        nodeId,
        consecutiveTicks: count,
        tickIntervalSeconds,
        revertedEntries,
        recipients: this.driftAlertRecipients,
      })
      .catch((error) => {
        this.logger.warn(
          `Failed to send drift alert email for schedule "${schedule.name}" ` +
            `on node "${nodeId}": ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * Clears drift bookkeeping for a (schedule, node) pair. Called whenever
   * the drift episode has demonstrably ended: first `changed=false` after
   * a streak of re-applies, a fresh markApplied, window close, or schedule
   * deactivation.
   */
  private resetDriftState(scheduleId: string, nodeId: string): void {
    const key = `${scheduleId}:${nodeId}`;
    this.driftCounters.delete(key);
    this.driftAlertedEpisodes.delete(key);
  }
}
