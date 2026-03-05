import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { LogAlertsEmailService } from "./log-alerts-email.service";
import { LogAlertsEvaluatorService } from "./log-alerts-evaluator.service";
import { LogAlertsRulesService } from "./log-alerts-rules.service";
import type {
  LogAlertEvaluatorStatus,
  LogAlertRule,
  LogAlertRuleDraft,
  LogAlertRulesStorageStatus,
  RunLogAlertEvaluatorRequest,
  RunLogAlertEvaluatorResponse,
  LogAlertsSendTestEmailRequest,
  LogAlertsSendTestEmailResponse,
  LogAlertsSmtpStatus,
  ValidateLogAlertRuleRequest,
  ValidateLogAlertRuleResponse,
} from "./log-alerts.types";

const OUTCOME_MODES = ["blocked-only", "all-outcomes"] as const;
const DOMAIN_PATTERN_TYPES = ["exact", "wildcard", "regex"] as const;

@Controller("nodes/log-alerts")
export class LogAlertsController {
  constructor(
    private readonly logAlertsEmailService: LogAlertsEmailService,
    private readonly logAlertsEvaluatorService: LogAlertsEvaluatorService,
    private readonly logAlertsRulesService: LogAlertsRulesService,
  ) {}

  @Get("capabilities")
  getCapabilities() {
    return {
      outcomeModes: OUTCOME_MODES,
      domainPatternTypes: DOMAIN_PATTERN_TYPES,
      defaults: {
        outcomeMode: "blocked-only" as const,
        domainPatternType: "exact" as const,
        debounceSeconds: 900,
      },
      notes: [
        "Outcome mode is mutually exclusive and must be either 'blocked-only' or 'all-outcomes'.",
        "At least one selector is required: clientIdentifier and/or advancedBlockingGroupName.",
      ],
    };
  }

  @Get("smtp/status")
  getSmtpStatus(): LogAlertsSmtpStatus {
    return this.logAlertsEmailService.getSmtpStatus();
  }

  @Post("smtp/test")
  sendSmtpTest(
    @Body() body: LogAlertsSendTestEmailRequest,
  ): Promise<LogAlertsSendTestEmailResponse> {
    return this.logAlertsEmailService.sendTestEmail(body);
  }

  @Post("rules/validate")
  validateRuleDraft(
    @Body() body: ValidateLogAlertRuleRequest,
  ): ValidateLogAlertRuleResponse {
    const errors: string[] = [];
    const input = body?.rule ?? {};

    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) {
      errors.push("rule.name is required.");
    }

    const enabled = input.enabled !== false;

    const outcomeMode =
      typeof input.outcomeMode === "string" ? input.outcomeMode.trim() : "";
    if (
      !OUTCOME_MODES.includes(outcomeMode as (typeof OUTCOME_MODES)[number])
    ) {
      errors.push(
        "rule.outcomeMode must be exactly 'blocked-only' or 'all-outcomes'.",
      );
    }

    const domainPattern =
      typeof input.domainPattern === "string" ? input.domainPattern.trim() : "";
    if (!domainPattern) {
      errors.push("rule.domainPattern is required.");
    }

    const domainPatternType =
      typeof input.domainPatternType === "string"
        ? input.domainPatternType.trim()
        : "";
    if (
      !DOMAIN_PATTERN_TYPES.includes(
        domainPatternType as (typeof DOMAIN_PATTERN_TYPES)[number],
      )
    ) {
      errors.push(
        "rule.domainPatternType must be one of: exact, wildcard, regex.",
      );
    }

    const clientIdentifier =
      typeof input.clientIdentifier === "string"
        ? input.clientIdentifier.trim()
        : "";
    const advancedBlockingGroupNames: string[] = Array.isArray(
      input.advancedBlockingGroupNames,
    )
      ? input.advancedBlockingGroupNames
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim())
          .filter((v) => v.length > 0)
      : [];

    if (!clientIdentifier && advancedBlockingGroupNames.length === 0) {
      errors.push(
        "At least one selector is required: rule.clientIdentifier and/or rule.advancedBlockingGroupNames.",
      );
    }

    const debounceSecondsRaw = Number(input.debounceSeconds);
    const debounceSeconds =
      Number.isFinite(debounceSecondsRaw) && debounceSecondsRaw > 0
        ? Math.floor(debounceSecondsRaw)
        : 900;

    const emailRecipients = Array.isArray(input.emailRecipients)
      ? input.emailRecipients
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [];

    if (emailRecipients.length === 0) {
      errors.push(
        "rule.emailRecipients must include at least one email address.",
      );
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    const normalizedRule: LogAlertRuleDraft = {
      name,
      enabled,
      outcomeMode: outcomeMode as LogAlertRuleDraft["outcomeMode"],
      domainPattern,
      domainPatternType:
        domainPatternType as LogAlertRuleDraft["domainPatternType"],
      clientIdentifier: clientIdentifier || undefined,
      advancedBlockingGroupNames:
        advancedBlockingGroupNames.length > 0
          ? advancedBlockingGroupNames
          : undefined,
      debounceSeconds,
      emailRecipients,
    };

    return { valid: true, normalizedRule };
  }

  @Post("rules")
  createRule(@Body() body: ValidateLogAlertRuleRequest): LogAlertRule {
    const validation = this.validateRuleDraft(body);
    if (!validation.valid || !validation.normalizedRule) {
      throw new BadRequestException({
        message: "Invalid log alert rule.",
        errors: validation.errors ?? ["Validation failed."],
      });
    }

    return this.logAlertsRulesService.createRule(validation.normalizedRule);
  }

  @Patch("rules/:ruleId")
  updateRule(
    @Param("ruleId") ruleId: string,
    @Body() body: ValidateLogAlertRuleRequest,
  ): LogAlertRule {
    const validation = this.validateRuleDraft(body);
    if (!validation.valid || !validation.normalizedRule) {
      throw new BadRequestException({
        message: "Invalid log alert rule.",
        errors: validation.errors ?? ["Validation failed."],
      });
    }
    return this.logAlertsRulesService.updateRule(
      ruleId,
      validation.normalizedRule,
    );
  }

  @Get("rules/status")
  getRulesStorageStatus(): LogAlertRulesStorageStatus {
    return this.logAlertsRulesService.getStatus();
  }

  @Get("rules")
  listRules(): LogAlertRule[] {
    return this.logAlertsRulesService.listRules();
  }

  @Patch("rules/:ruleId/enabled")
  updateRuleEnabled(
    @Param("ruleId") ruleId: string,
    @Body() body: { enabled?: unknown },
  ): LogAlertRule {
    if (typeof body?.enabled !== "boolean") {
      throw new BadRequestException("enabled must be provided as a boolean.");
    }
    return this.logAlertsRulesService.setRuleEnabled(ruleId, body.enabled);
  }

  @Delete("rules/:ruleId")
  deleteRule(@Param("ruleId") ruleId: string): {
    deleted: true;
    ruleId: string;
  } {
    return this.logAlertsRulesService.deleteRule(ruleId);
  }

  @Patch("evaluator/config")
  setEvaluatorConfig(
    @Body() body: { intervalMs?: unknown; lookbackSeconds?: unknown },
  ): LogAlertEvaluatorStatus {
    if (body.intervalMs !== undefined) {
      const ms = Number(body.intervalMs);
      if (!Number.isFinite(ms) || ms < 10_000) {
        throw new BadRequestException("intervalMs must be a number >= 10000.");
      }
      this.logAlertsEvaluatorService.setIntervalMs(ms);
    }
    if (body.lookbackSeconds !== undefined) {
      const s = Number(body.lookbackSeconds);
      if (!Number.isFinite(s) || s < 60) {
        throw new BadRequestException(
          "lookbackSeconds must be a number >= 60.",
        );
      }
      this.logAlertsEvaluatorService.setLookbackSeconds(s);
    }
    return this.logAlertsEvaluatorService.getStatus();
  }

  @Patch("evaluator/enabled")
  setEvaluatorEnabled(
    @Body() body: { enabled?: unknown },
  ): LogAlertEvaluatorStatus {
    if (typeof body.enabled !== "boolean") {
      throw new BadRequestException("enabled must be provided as a boolean.");
    }
    this.logAlertsEvaluatorService.setEnabled(body.enabled);
    return this.logAlertsEvaluatorService.getStatus();
  }

  @Get("evaluator/status")
  getEvaluatorStatus(): LogAlertEvaluatorStatus {
    return this.logAlertsEvaluatorService.getStatus();
  }

  @Post("evaluator/run")
  runEvaluator(
    @Body() body?: RunLogAlertEvaluatorRequest,
  ): Promise<RunLogAlertEvaluatorResponse> {
    return this.logAlertsEvaluatorService.runNow(body?.dryRun === true);
  }
}
