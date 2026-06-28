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
import { DnsTemporaryOverridesService } from "./dns-temporary-overrides.service";
import type {
  DnsTemporaryOverride,
  DnsTemporaryOverrideDraft,
} from "./dns-temporary-overrides.types";
import { DnsSchedulesEvaluatorService } from "./dns-schedules-evaluator.service";
import type { LogAlertRuleDraft } from "./log-alerts.types";
import { LogAlertsRulesService } from "./log-alerts-rules.service";

const ACTIONS = ["block", "allow"] as const;

function stripNewlines(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

@Controller("nodes/dns-overrides/temporary")
export class DnsTemporaryOverridesController {
  private readonly logger = new Logger(DnsTemporaryOverridesController.name);

  constructor(
    private readonly temporaryOverridesService: DnsTemporaryOverridesService,
    private readonly evaluatorService: DnsSchedulesEvaluatorService,
    private readonly logAlertsRulesService: LogAlertsRulesService,
  ) {}

  @Get()
  listOverrides(): DnsTemporaryOverride[] {
    return this.temporaryOverridesService.listOverrides();
  }

  @Post()
  createOverride(@Body() body: unknown): DnsTemporaryOverride {
    const override = this.temporaryOverridesService.createOverride(
      this.parseDraft(body),
    );
    this.syncLinkedAlertRule(override);
    return override;
  }

  @Patch(":overrideId")
  updateOverride(
    @Param("overrideId") overrideId: string,
    @Body() body: unknown,
  ): DnsTemporaryOverride {
    const override = this.temporaryOverridesService.updateOverride(
      overrideId,
      this.parseDraft(body),
    );
    this.syncLinkedAlertRule(override);
    return override;
  }

  @Patch(":overrideId/enabled")
  setOverrideEnabled(
    @Param("overrideId") overrideId: string,
    @Body() body: { enabled?: unknown },
  ): DnsTemporaryOverride {
    if (typeof body?.enabled !== "boolean") {
      throw new BadRequestException("enabled must be provided as a boolean.");
    }
    const override = this.temporaryOverridesService.setOverrideEnabled(
      overrideId,
      body.enabled,
    );
    this.syncLinkedAlertRule(override);
    return override;
  }

  @Delete(":overrideId")
  deleteOverride(@Param("overrideId") overrideId: string): {
    deleted: true;
    overrideId: string;
  } {
    const result = this.temporaryOverridesService.deleteOverride(overrideId);
    this.deleteLinkedAlertRule(overrideId);
    return result;
  }

  private parseDraft(body: unknown): DnsTemporaryOverrideDraft {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Request body must be a JSON object.");
    }
    const input = body as Record<string, unknown>;
    const name =
      typeof input.name === "string" ? stripNewlines(input.name) : "";
    if (!name) throw new BadRequestException("name is required.");

    const action = typeof input.action === "string" ? input.action.trim() : "";
    if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
      throw new BadRequestException("action must be 'block' or 'allow'.");
    }

    const advancedBlockingGroupNames = this.normalizeStringArray(
      input.advancedBlockingGroupNames,
    );
    const domainEntries = this.normalizeStringArray(input.domainEntries);
    const domainGroupNames = this.normalizeStringArray(input.domainGroupNames);
    const nodeIds = this.normalizeStringArray(input.nodeIds);
    const notifyEmails = this.normalizeStringArray(input.notifyEmails);
    const notifyDebounceSecondsRaw = Number(input.notifyDebounceSeconds ?? 300);
    const notifyDebounceSeconds =
      Number.isFinite(notifyDebounceSecondsRaw) && notifyDebounceSecondsRaw >= 0
        ? Math.round(notifyDebounceSecondsRaw)
        : 300;
    const notifyMessageRaw =
      typeof input.notifyMessage === "string"
        ? input.notifyMessage.trim()
        : undefined;
    const notifyMessage = notifyMessageRaw || undefined;
    const notifyMessageOnly =
      !!notifyMessage && input.notifyMessageOnly === true;
    const notifySubjectTemplateRaw =
      typeof input.notifySubjectTemplate === "string"
        ? stripNewlines(input.notifySubjectTemplate)
        : undefined;
    const notifySubjectTemplate = notifySubjectTemplateRaw || undefined;
    const expiresAt =
      typeof input.expiresAt === "string" && input.expiresAt.trim()
        ? input.expiresAt.trim()
        : null;

    return {
      name,
      enabled: input.enabled !== false,
      advancedBlockingGroupNames,
      action: action as DnsTemporaryOverrideDraft["action"],
      domainEntries,
      domainGroupNames,
      nodeIds,
      flushCacheOnChange: input.flushCacheOnChange !== false,
      notifyEmails,
      notifyDebounceSeconds,
      notifyMessage,
      notifyMessageOnly,
      notifySubjectTemplate,
      expiresAt,
    };
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return [
      ...new Set(
        value
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0),
      ),
    ];
  }

  private syncLinkedAlertRule(override: DnsTemporaryOverride): void {
    try {
      if (override.notifyEmails.length === 0) {
        this.deleteLinkedAlertRule(override.id);
        return;
      }

      const ruleName = `__temporary-override:${override.id}__`;
      const { pattern: domainPattern, type: domainPatternType } =
        this.evaluatorService.buildAlertDomainPattern(
          this.evaluatorService.temporaryOverrideToSchedule(override),
        );
      const draft: LogAlertRuleDraft = {
        name: ruleName,
        displayName: override.name,
        notifyMessage: override.notifyMessage,
        enabled: false,
        outcomeMode: "blocked-only",
        domainPattern,
        domainPatternType,
        advancedBlockingGroupNames: override.advancedBlockingGroupNames,
        debounceSeconds: override.notifyDebounceSeconds,
        emailRecipients: override.notifyEmails,
        notifyMessageOnly: override.notifyMessageOnly,
        notifySubjectTemplate: override.notifySubjectTemplate,
        templateContext: this.buildOverrideTemplateContext(override),
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
        `Failed to sync linked alert rule for temporary override "${override.name}": ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private buildOverrideTemplateContext(
    override: DnsTemporaryOverride,
  ): Record<string, string> {
    return {
      overrideId: override.id,
      overrideName: override.name,
      action: override.action,
      groups: override.advancedBlockingGroupNames.join(", "),
      expiresAt: override.expiresAt ?? "When turned off",
    };
  }

  private deleteLinkedAlertRule(overrideId: string): void {
    const ruleName = `__temporary-override:${overrideId}__`;
    try {
      const existing = this.logAlertsRulesService
        .listRules()
        .find((r) => r.name === ruleName);
      if (existing) {
        this.logAlertsRulesService.deleteRule(existing.id);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to delete linked alert rule for temporary override "${overrideId}": ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
