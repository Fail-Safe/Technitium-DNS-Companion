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
import { LogAlertsRulesService } from "./log-alerts-rules.service";
import { TechnitiumService } from "./technitium.service";

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

  constructor(
    private readonly schedulesService: DnsSchedulesService,
    private readonly advancedBlockingService: AdvancedBlockingService,
    private readonly technitiumService: TechnitiumService,
    private readonly domainGroupsService: DomainGroupsService,
    private readonly logAlertsRulesService: LogAlertsRulesService,
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
    this.logger.log(`DNS Schedules evaluator interval updated to ${clamped}ms.`);
  }

  getStatus(): DnsScheduleEvaluatorStatus {
    return {
      enabled: this.enabled,
      running: this.running,
      intervalMs: this.intervalMs,
      tokenReady: this.technitiumService.getScheduleTokenStatus().valid === true,
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
      throw new BadRequestException("DNS Schedules evaluator is already running.");
    }

    this.running = true;
    this.lastRunAt = new Date().toISOString();
    this.lastRunError = undefined;

    try {
      const schedules = this.schedulesService
        .listSchedules()
        .filter((s) => s.enabled);

      const allNodes = await this.technitiumService.listNodes();
      const allNodeIds = allNodes.map((n) => n.id);

      const now = new Date();
      const results: DnsScheduleApplicationResult[] = [];

      // ── Cleanup pass: remove stale state for disabled/deleted schedules ──
      // Handles schedules that were disabled while their window was open, or
      // deleted after being applied, without waiting for a controller toggle.
      {
        const allSchedulesById = new Map(
          this.schedulesService.listSchedules().map((s) => [s.id, s]),
        );
        const staleEntries = this.schedulesService
          .listAppliedState()
          .filter((e) => {
            const s = allSchedulesById.get(e.scheduleId);
            return !s || !s.enabled;
          });

        for (const entry of staleEntries) {
          const schedule = allSchedulesById.get(entry.scheduleId);
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
          try {
            await this.removeScheduleFromNode(schedule, entry.nodeId);
            this.schedulesService.markRemoved(schedule.id, entry.nodeId);
            if (schedule.flushCacheOnChange) {
              await this.flushDomainsCache(schedule, entry.nodeId);
            }
            this.logger.log(
              `Cleaned up stale entries for disabled schedule "${schedule.name}" from node "${entry.nodeId}".`,
            );
            results.push({
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              nodeId: entry.nodeId,
              action: "removed",
            });
          } catch (error) {
            this.logger.warn(
              `Failed to clean up stale entries for disabled schedule "${schedule.name}" on node "${entry.nodeId}": ${error instanceof Error ? error.message : String(error)}`,
            );
            results.push({
              scheduleId: schedule.id,
              scheduleName: schedule.name,
              nodeId: entry.nodeId,
              action: "error",
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      for (const schedule of schedules) {
        const targetNodeIds =
          schedule.nodeIds.length > 0
            ? schedule.nodeIds.filter((id) => allNodeIds.includes(id))
            : allNodeIds;

        for (const nodeId of targetNodeIds) {
          const result = await this.evaluateScheduleForNode(
            schedule,
            nodeId,
            now,
            options.dryRun,
          );
          results.push(result);
        }

        if (!options.dryRun) {
          this.syncAlertRuleWindow(
            schedule.id,
            schedule.name,
            this.isWindowActive(schedule, now),
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
        evaluatedSchedules: schedules.length,
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

  private async evaluateScheduleForNode(
    schedule: DnsSchedule,
    nodeId: string,
    now: Date,
    dryRun: boolean,
  ): Promise<DnsScheduleApplicationResult> {
    const shouldBeActive = this.isWindowActive(schedule, now);
    const isCurrentlyApplied = this.schedulesService.isApplied(schedule.id, nodeId);

    if (shouldBeActive === isCurrentlyApplied) {
      return {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        nodeId,
        action: "skipped",
        reason: shouldBeActive ? "already-applied" : "already-inactive",
      };
    }

    if (dryRun) {
      return {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        nodeId,
        action: "skipped",
        reason: `dry-run-would-${shouldBeActive ? "apply" : "remove"}`,
      };
    }

    try {
      if (shouldBeActive) {
        await this.applyScheduleToNode(schedule, nodeId);
        this.schedulesService.markApplied(schedule.id, nodeId);
        const modeDetail =
          schedule.targetType === "built-in"
            ? "mode=built-in"
            : `groups=${schedule.advancedBlockingGroupNames.join(",")}`;
        this.logger.log(
          `Applied schedule "${schedule.name}" to node "${nodeId}" (action=${schedule.action}, ${modeDetail}).`,
        );
        if (schedule.flushCacheOnChange) {
          await this.flushDomainsCache(schedule, nodeId);
        }
        return {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          nodeId,
          action: "applied",
        };
      } else {
        await this.removeScheduleFromNode(schedule, nodeId);
        this.schedulesService.markRemoved(schedule.id, nodeId);
        this.logger.log(
          `Removed schedule "${schedule.name}" from node "${nodeId}".`,
        );
        if (schedule.flushCacheOnChange) {
          await this.flushDomainsCache(schedule, nodeId);
        }
        return {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          nodeId,
          action: "removed",
        };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error.";
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
  ): Promise<void> {
    if (schedule.targetType === "built-in") {
      await this.applyBuiltInScheduleToNode(schedule, nodeId);
    } else {
      await this.applyAdvancedBlockingScheduleToNode(schedule, nodeId);
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

    for (const entry of applied) {
      try {
        await this.removeScheduleFromNode(schedule, entry.nodeId);
        this.schedulesService.markRemoved(schedule.id, entry.nodeId);
        if (schedule.flushCacheOnChange) {
          await this.flushDomainsCache(schedule, entry.nodeId);
        }
      } catch (error) {
        this.logger.warn(
          `Failed to deactivate schedule "${schedule.name}" on node "${entry.nodeId}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.syncAlertRuleWindow(schedule.id, schedule.name, false);
  }

  private async removeScheduleFromNode(
    schedule: DnsSchedule,
    nodeId: string,
  ): Promise<void> {
    if (schedule.targetType === "built-in") {
      await this.removeBuiltInScheduleFromNode(schedule, nodeId);
    } else {
      await this.removeAdvancedBlockingScheduleFromNode(schedule, nodeId);
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
  ): Promise<void> {
    const snapshot = await this.advancedBlockingService.getSnapshotWithAuth(
      nodeId,
      "schedule",
    );
    const config = snapshot.config;
    if (!config) {
      throw new Error(
        `No Advanced Blocking config available on node "${nodeId}".`,
      );
    }

    const resolvedEntries = this.resolveDomainEntries(schedule);
    const listKey: keyof Pick<AdvancedBlockingGroup, "blocked" | "allowed"> =
      schedule.action === "block" ? "blocked" : "allowed";

    const updatedGroups = [...config.groups];
    let changed = false;

    for (const groupName of schedule.advancedBlockingGroupNames) {
      const groupIdx = updatedGroups.findIndex((g) => g.name === groupName);
      if (groupIdx === -1) {
        throw new Error(
          `Advanced Blocking group "${groupName}" not found on node "${nodeId}".`,
        );
      }
      const group = updatedGroups[groupIdx]!;
      const currentEntries = group[listKey] ?? [];
      const toAdd = resolvedEntries.filter((e) => !currentEntries.includes(e));
      if (toAdd.length > 0) {
        updatedGroups[groupIdx] = {
          ...group,
          [listKey]: [...currentEntries, ...toAdd],
        };
        changed = true;
      }
    }

    if (!changed) {
      // Already all present in all groups — still mark as applied so we track ownership
      return;
    }

    await this.advancedBlockingService.setConfigWithAuth(
      nodeId,
      { ...config, groups: updatedGroups },
      "schedule",
    );
  }

  private async removeAdvancedBlockingScheduleFromNode(
    schedule: DnsSchedule,
    nodeId: string,
  ): Promise<void> {
    const snapshot = await this.advancedBlockingService.getSnapshotWithAuth(
      nodeId,
      "schedule",
    );
    const config = snapshot.config;
    if (!config) {
      // Config gone — treat as already removed
      return;
    }

    const scheduleEntrySet = new Set(this.resolveDomainEntries(schedule));
    const listKey: keyof Pick<AdvancedBlockingGroup, "blocked" | "allowed"> =
      schedule.action === "block" ? "blocked" : "allowed";

    const updatedGroups = [...config.groups];
    let changed = false;

    for (const groupName of schedule.advancedBlockingGroupNames) {
      const groupIdx = updatedGroups.findIndex((g) => g.name === groupName);
      if (groupIdx === -1) continue; // Group gone — treat as removed for this group

      const group = updatedGroups[groupIdx]!;
      const currentEntries = group[listKey] ?? [];
      const remainingEntries = currentEntries.filter(
        (e) => !scheduleEntrySet.has(e),
      );
      if (remainingEntries.length < currentEntries.length) {
        updatedGroups[groupIdx] = { ...group, [listKey]: remainingEntries };
        changed = true;
      }
    }

    if (!changed) return;

    await this.advancedBlockingService.setConfigWithAuth(
      nodeId,
      { ...config, groups: updatedGroups },
      "schedule",
    );
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
  ): void {
    try {
      const ruleName = `__schedule:${scheduleId}__`;
      const existing = this.logAlertsRulesService
        .listRules()
        .find((r) => r.name === ruleName);
      if (!existing) return; // No linked rule — notifyEmails is empty
      if (existing.enabled === shouldBeActive) return; // Already correct
      this.logAlertsRulesService.updateRule(existing.id, {
        ...existing,
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
      inTimeWindow = currentMinutes >= startMinutes && currentMinutes < endMinutes;
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
      const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
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
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
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
}
