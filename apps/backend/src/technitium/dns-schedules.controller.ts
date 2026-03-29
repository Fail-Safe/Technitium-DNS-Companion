import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { DnsSchedulesEvaluatorService } from "./dns-schedules-evaluator.service";
import { DnsSchedulesService } from "./dns-schedules.service";
import type {
  DnsSchedule,
  DnsScheduleDraft,
  DnsScheduleEvaluatorStatus,
  DnsScheduleStateEntry,
  DnsSchedulesStorageStatus,
  DnsScheduleTokenStatus,
  RunDnsScheduleEvaluatorRequest,
  RunDnsScheduleEvaluatorResponse,
} from "./dns-schedules.types";
import type { LogAlertRuleDraft } from "./log-alerts.types";
import { LogAlertsRulesService } from "./log-alerts-rules.service";
import { TechnitiumService } from "./technitium.service";

const ACTIONS = ["block", "allow"] as const;

@Controller("nodes/dns-schedules")
export class DnsSchedulesController {
  private readonly logger = new Logger(DnsSchedulesController.name);

  constructor(
    private readonly schedulesService: DnsSchedulesService,
    private readonly evaluatorService: DnsSchedulesEvaluatorService,
    private readonly technitiumService: TechnitiumService,
    private readonly logAlertsRulesService: LogAlertsRulesService,
  ) {}

  @Get("capabilities")
  getCapabilities() {
    return {
      actions: ACTIONS,
      defaults: {
        action: "block" as const,
        daysOfWeek: [] as number[],
        timezone: "UTC",
        nodeIds: [] as string[],
      },
      notes: [
        "daysOfWeek: 0=Sunday through 6=Saturday. Empty array means every day.",
        "startTime/endTime: 24-hour HH:MM format. If startTime > endTime the window spans midnight.",
        "daysOfWeek refers to the day the window starts (relevant for overnight windows).",
        "timezone: any IANA timezone identifier, e.g. 'America/New_York'.",
        "nodeIds: specific node IDs to target, or empty array for all nodes.",
      ],
    };
  }

  @Get("token/status")
  getTokenStatus(): DnsScheduleTokenStatus {
    return this.technitiumService.getScheduleTokenStatus();
  }

  @Post("token/revalidate")
  revalidateToken(): DnsScheduleTokenStatus {
    this.technitiumService.resetScheduleTokenValidation();
    return this.technitiumService.getScheduleTokenStatus();
  }

  @Get("storage/status")
  getStorageStatus(): DnsSchedulesStorageStatus {
    return this.schedulesService.getStatus();
  }

  @Get("rules")
  listSchedules(): DnsSchedule[] {
    return this.schedulesService.listSchedules();
  }

  @Post("rules")
  createSchedule(@Body() body: unknown): DnsSchedule {
    const draft = this.parseDraft(body);
    const schedule = this.schedulesService.createSchedule(draft);
    this.syncLinkedAlertRule(schedule);
    return schedule;
  }

  @Patch("rules/:scheduleId")
  async updateSchedule(
    @Param("scheduleId") scheduleId: string,
    @Body() body: unknown,
  ): Promise<DnsSchedule> {
    const draft = this.parseDraft(body);
    const schedule = this.schedulesService.updateSchedule(scheduleId, draft);
    this.syncLinkedAlertRule(schedule);
    if (!schedule.enabled) {
      await this.evaluatorService.deactivateScheduleIfApplied(schedule).catch((e: unknown) => {
        this.logger.warn(`Deactivation cleanup failed for "${schedule.name}": ${e instanceof Error ? e.message : String(e)}`);
      });
    }
    return schedule;
  }

  @Patch("rules/:scheduleId/enabled")
  async setScheduleEnabled(
    @Param("scheduleId") scheduleId: string,
    @Body() body: { enabled?: unknown },
  ): Promise<DnsSchedule> {
    if (typeof body?.enabled !== "boolean") {
      throw new BadRequestException("enabled must be provided as a boolean.");
    }
    const schedule = this.schedulesService.setScheduleEnabled(scheduleId, body.enabled);
    this.syncLinkedAlertRule(schedule);
    if (!schedule.enabled) {
      await this.evaluatorService.deactivateScheduleIfApplied(schedule).catch((e: unknown) => {
        this.logger.warn(`Deactivation cleanup failed for "${schedule.name}": ${e instanceof Error ? e.message : String(e)}`);
      });
    }
    return schedule;
  }

  @Delete("rules/:scheduleId")
  deleteSchedule(
    @Param("scheduleId") scheduleId: string,
  ): { deleted: true; scheduleId: string } {
    const result = this.schedulesService.deleteSchedule(scheduleId);
    this.deleteLinkedAlertRule(scheduleId);
    return result;
  }

  @Get("state")
  listAppliedState(): DnsScheduleStateEntry[] {
    return this.schedulesService.listAppliedState();
  }

  @Get("evaluator/status")
  getEvaluatorStatus(): DnsScheduleEvaluatorStatus {
    return this.evaluatorService.getStatus();
  }

  @Patch("evaluator/enabled")
  setEvaluatorEnabled(
    @Body() body: { enabled?: unknown },
  ): DnsScheduleEvaluatorStatus {
    if (typeof body.enabled !== "boolean") {
      throw new BadRequestException("enabled must be provided as a boolean.");
    }
    this.evaluatorService.setEnabled(body.enabled);
    return this.evaluatorService.getStatus();
  }

  @Patch("evaluator/config")
  setEvaluatorConfig(
    @Body() body: { intervalMs?: unknown },
  ): DnsScheduleEvaluatorStatus {
    if (body.intervalMs !== undefined) {
      const ms = Number(body.intervalMs);
      if (!Number.isFinite(ms) || ms < 30_000) {
        throw new BadRequestException("intervalMs must be a number >= 30000.");
      }
      this.evaluatorService.setIntervalMs(ms);
    }
    return this.evaluatorService.getStatus();
  }

  @Post("evaluator/run")
  runEvaluator(
    @Body() body?: RunDnsScheduleEvaluatorRequest,
  ): Promise<RunDnsScheduleEvaluatorResponse> {
    return this.evaluatorService.runNow(body?.dryRun === true);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private parseDraft(body: unknown): DnsScheduleDraft {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Request body must be a JSON object.");
    }

    const input = body as Record<string, unknown>;

    const name =
      typeof input.name === "string" ? input.name.trim() : undefined;
    if (!name) {
      throw new BadRequestException("name is required.");
    }

    const enabled = input.enabled !== false;

    const targetType: DnsScheduleDraft["targetType"] =
      input.targetType === "built-in" ? "built-in" : "advanced-blocking";

    const advancedBlockingGroupNames = Array.isArray(input.advancedBlockingGroupNames)
      ? (input.advancedBlockingGroupNames as unknown[])
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];
    if (targetType === "advanced-blocking" && advancedBlockingGroupNames.length === 0) {
      throw new BadRequestException("advancedBlockingGroupNames must contain at least one group.");
    }

    const action =
      typeof input.action === "string" ? input.action.trim() : "";
    if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
      throw new BadRequestException("action must be 'block' or 'allow'.");
    }

    const domainEntries = Array.isArray(input.domainEntries)
      ? (input.domainEntries as unknown[])
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];

    const domainGroupNames = Array.isArray(input.domainGroupNames)
      ? (input.domainGroupNames as unknown[])
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];

    const daysOfWeek = Array.isArray(input.daysOfWeek)
      ? (input.daysOfWeek as unknown[]).filter(
          (v): v is number =>
            typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6,
        )
      : [];

    const startTime =
      typeof input.startTime === "string" ? input.startTime.trim() : undefined;
    if (!startTime) {
      throw new BadRequestException("startTime is required.");
    }

    const endTime =
      typeof input.endTime === "string" ? input.endTime.trim() : undefined;
    if (!endTime) {
      throw new BadRequestException("endTime is required.");
    }

    const timezone =
      typeof input.timezone === "string" ? input.timezone.trim() : "UTC";

    const nodeIds = Array.isArray(input.nodeIds)
      ? (input.nodeIds as unknown[])
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];

    const flushCacheOnChange = input.flushCacheOnChange === true;

    // Notifications are not supported in built-in mode — hard-blocked.
    const notifyEmails =
      targetType === "built-in"
        ? []
        : Array.isArray(input.notifyEmails)
          ? (input.notifyEmails as unknown[])
              .filter((v): v is string => typeof v === "string")
              .map((v) => v.trim())
              .filter((v) => v.length > 0)
          : [];

    const notifyDebounceSecondsRaw = Number(input.notifyDebounceSeconds ?? 300);
    const notifyDebounceSeconds =
      Number.isFinite(notifyDebounceSecondsRaw) && notifyDebounceSecondsRaw >= 0
        ? Math.round(notifyDebounceSecondsRaw)
        : 300;

    const notifyMessageRaw = typeof input.notifyMessage === "string"
      ? input.notifyMessage.trim()
      : undefined;
    const notifyMessage = notifyMessageRaw && targetType !== "built-in"
      ? notifyMessageRaw
      : undefined;

    const notifyMessageOnly =
      targetType !== "built-in" && !!notifyMessage && input.notifyMessageOnly === true;

    return {
      name,
      enabled,
      targetType,
      advancedBlockingGroupNames,
      action: action as DnsScheduleDraft["action"],
      domainEntries,
      domainGroupNames,
      daysOfWeek,
      startTime,
      endTime,
      timezone,
      nodeIds,
      flushCacheOnChange,
      notifyEmails,
      notifyDebounceSeconds,
      notifyMessage,
      notifyMessageOnly,
    };
  }

  // ── Linked Log Alert rule sync ────────────────────────────────────────────

  /**
   * Keeps the linked Log Alert rule in sync with the schedule's notification
   * settings. Creates or updates the rule when notifyEmails is non-empty,
   * deletes it otherwise. Best-effort — failures are logged as warnings so
   * that schedule saves always succeed even when Log Alerts are disabled.
   */
  private syncLinkedAlertRule(schedule: DnsSchedule): void {
    try {
      if (
        schedule.targetType === "built-in" ||
        schedule.notifyEmails.length === 0
      ) {
        this.deleteLinkedAlertRule(schedule.id);
        return;
      }

      const ruleName = `__schedule:${schedule.id}__`;
      const { pattern: domainPattern, type: domainPatternType } =
        this.evaluatorService.buildAlertDomainPattern(schedule);
      const draft: LogAlertRuleDraft = {
        name: ruleName,
        displayName: schedule.name,
        notifyMessage: schedule.notifyMessage,
        enabled: false, // Evaluator controls enabled state; rule activates only during the window
        outcomeMode: "blocked-only",
        domainPattern,
        domainPatternType,
        advancedBlockingGroupNames: schedule.advancedBlockingGroupNames,
        debounceSeconds: schedule.notifyDebounceSeconds,
        emailRecipients: schedule.notifyEmails,
        notifyMessageOnly: schedule.notifyMessageOnly,
      };

      const existing = this.logAlertsRulesService
        .listRules()
        .find((r) => r.name === ruleName);

      if (existing) {
        this.logAlertsRulesService.updateRule(existing.id, draft);
      } else {
        this.logAlertsRulesService.createRule(draft);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to sync linked alert rule for schedule "${schedule.name}": ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Removes the linked Log Alert rule for a deleted schedule. Best-effort.
   */
  private deleteLinkedAlertRule(scheduleId: string): void {
    const ruleName = `__schedule:${scheduleId}__`;
    try {
      const existing = this.logAlertsRulesService
        .listRules()
        .find((r) => r.name === ruleName);
      if (existing) {
        this.logAlertsRulesService.deleteRule(existing.id);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete linked alert rule for schedule "${scheduleId}": ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
