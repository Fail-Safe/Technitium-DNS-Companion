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
        this.logger.log(
          `Applied schedule "${schedule.name}" to node "${nodeId}" (action=${schedule.action}, group=${schedule.advancedBlockingGroupName}).`,
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

    const groupIdx = config.groups.findIndex(
      (g) => g.name === schedule.advancedBlockingGroupName,
    );
    if (groupIdx === -1) {
      throw new Error(
        `Advanced Blocking group "${schedule.advancedBlockingGroupName}" not found on node "${nodeId}".`,
      );
    }

    const group = config.groups[groupIdx];
    if (!group) {
      throw new Error(`Group index out of bounds for node "${nodeId}".`);
    }

    const listKey: keyof Pick<AdvancedBlockingGroup, "blocked" | "allowed"> =
      schedule.action === "block" ? "blocked" : "allowed";

    const currentEntries = group[listKey] ?? [];
    const resolvedEntries = this.resolveDomainEntries(schedule);
    const toAdd = resolvedEntries.filter(
      (entry) => !currentEntries.includes(entry),
    );

    if (toAdd.length === 0) {
      // Already all present — still mark as applied so we track ownership
      return;
    }

    const updatedGroup: AdvancedBlockingGroup = {
      ...group,
      [listKey]: [...currentEntries, ...toAdd],
    };

    const updatedGroups = [...config.groups];
    updatedGroups[groupIdx] = updatedGroup;

    await this.advancedBlockingService.setConfigWithAuth(
      nodeId,
      { ...config, groups: updatedGroups },
      "schedule",
    );
  }

  private async removeScheduleFromNode(
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

    const groupIdx = config.groups.findIndex(
      (g) => g.name === schedule.advancedBlockingGroupName,
    );
    if (groupIdx === -1) {
      // Group gone — treat as removed
      return;
    }

    const group = config.groups[groupIdx];
    if (!group) return;

    const listKey: keyof Pick<AdvancedBlockingGroup, "blocked" | "allowed"> =
      schedule.action === "block" ? "blocked" : "allowed";

    const scheduleEntrySet = new Set(this.resolveDomainEntries(schedule));
    const currentEntries = group[listKey] ?? [];
    const remainingEntries = currentEntries.filter(
      (entry) => !scheduleEntrySet.has(entry),
    );

    if (remainingEntries.length === currentEntries.length) {
      // Nothing to remove — entries were already gone
      return;
    }

    const updatedGroup: AdvancedBlockingGroup = {
      ...group,
      [listKey]: remainingEntries,
    };

    const updatedGroups = [...config.groups];
    updatedGroups[groupIdx] = updatedGroup;

    await this.advancedBlockingService.setConfigWithAuth(
      nodeId,
      { ...config, groups: updatedGroups },
      "schedule",
    );
  }

  /**
   * Best-effort DNS resolver cache flush for each domain resolved by the
   * schedule. Failures (e.g. missing DNS Server: Modify permission on the
   * schedule token) are logged as warnings and never propagate to callers.
   */
  private async flushDomainsCache(
    schedule: DnsSchedule,
    nodeId: string,
  ): Promise<void> {
    const domains = this.resolveDomainEntries(schedule);
    if (domains.length === 0) return;

    let flushed = 0;
    let failed = 0;

    for (const domain of domains) {
      try {
        await this.technitiumService.executeAction(
          nodeId,
          { method: "GET", url: "/api/cache/flush", params: { domain } },
          { authMode: "schedule" },
        );
        flushed++;
      } catch {
        failed++;
      }
    }

    if (failed > 0) {
      this.logger.warn(
        `Cache flush for schedule "${schedule.name}" on node "${nodeId}": ` +
          `${flushed} flushed, ${failed} failed ` +
          `(token may lack DNS Server: Modify permission).`,
      );
    } else {
      this.logger.log(
        `Cache flushed for ${flushed} domain(s) after schedule "${schedule.name}" change on node "${nodeId}".`,
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
