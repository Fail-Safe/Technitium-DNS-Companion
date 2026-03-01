import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import type { AdvancedBlockingConfig } from "./advanced-blocking.types";
import { LogAlertsEmailService } from "./log-alerts-email.service";
import { LogAlertsRulesService } from "./log-alerts-rules.service";
import type {
  LogAlertEvaluatorStatus,
  LogAlertRule,
  LogAlertRuleEvaluationResult,
  RunLogAlertEvaluatorResponse,
} from "./log-alerts.types";
import { QueryLogSqliteService } from "./query-log-sqlite.service";
import type {
  TechnitiumCombinedQueryLogEntry,
  TechnitiumQueryLogFilters,
} from "./technitium.types";

type RuleRuntimeState = {
  lastAlertSentAt?: string;
  lastAlertedEntryTs?: number;
};

type PreparedRule = {
  rule: LogAlertRule;
  matchDomain: (domain: string) => boolean;
  invalidPatternError?: string;
};

type RuleEvaluationAccumulator = {
  rule: LogAlertRule;
  matchedCount: number;
  latestMatchTs?: number;
  sampleLines: string[];
};

type NodeGroupLookup = {
  localMap: Map<string, string>;
  networkRanges: Array<{ network: number; mask: number; group: string }>;
};

@Injectable()
export class LogAlertsEvaluatorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LogAlertsEvaluatorService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private enabled =
    (process.env.LOG_ALERTS_EVALUATOR_ENABLED ?? "true").toLowerCase() !== "false";
  private intervalMs = Math.max(
    10_000,
    Number.parseInt(
      process.env.LOG_ALERTS_EVALUATOR_INTERVAL_MS ?? "60000",
      10,
    ) || 60_000,
  );
  private lookbackSeconds = Math.max(
    60,
    Number.parseInt(
      process.env.LOG_ALERTS_EVALUATOR_LOOKBACK_SECONDS ?? "900",
      10,
    ) || 900,
  );
  private readonly maxEntriesPerPage = Math.max(
    100,
    Number.parseInt(
      process.env.LOG_ALERTS_EVALUATOR_MAX_ENTRIES_PER_PAGE ?? "500",
      10,
    ) || 500,
  );
  private readonly maxPagesPerRun = Math.max(
    1,
    Number.parseInt(
      process.env.LOG_ALERTS_EVALUATOR_MAX_PAGES_PER_RUN ?? "3",
      10,
    ) || 3,
  );

  private readonly ruleRuntime = new Map<string, RuleRuntimeState>();
  private lastRunAt?: string;
  private lastSuccessfulRunAt?: string;
  private lastRunError?: string;
  private lastRunDryRun?: boolean;
  private lastScannedEntries?: number;
  private lastEvaluatedRules?: number;
  private lastMatchedRules?: number;
  private lastAlertsSent?: number;

  constructor(
    private readonly queryLogSqliteService: QueryLogSqliteService,
    private readonly logAlertsRulesService: LogAlertsRulesService,
    private readonly logAlertsEmailService: LogAlertsEmailService,
    private readonly advancedBlockingService: AdvancedBlockingService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") {
      return;
    }

    // Persisted setting overrides the env-var default
    const persisted = this.logAlertsRulesService.getEvaluatorEnabled();
    if (persisted !== null) {
      this.enabled = persisted;
    }

    const persistedInterval = this.logAlertsRulesService.getEvaluatorIntervalMs();
    if (persistedInterval !== null) {
      this.intervalMs = persistedInterval;
    }

    const persistedLookback = this.logAlertsRulesService.getEvaluatorLookbackSeconds();
    if (persistedLookback !== null) {
      this.lookbackSeconds = persistedLookback;
    }

    if (!this.enabled) {
      this.logger.log(
        "Log alerts evaluator is disabled.",
      );
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
    this.logAlertsRulesService.setEvaluatorEnabled(enabled);
    if (enabled) {
      this.startTimer();
    } else {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.logger.log("Log alerts evaluator disabled.");
    }
  }

  setIntervalMs(intervalMs: number): void {
    const clamped = Math.max(10_000, intervalMs);
    this.intervalMs = clamped;
    this.logAlertsRulesService.setEvaluatorIntervalMs(clamped);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      if (this.enabled) {
        this.startTimer();
      }
    }
    this.logger.log(`Evaluator interval updated to ${clamped}ms.`);
  }

  setLookbackSeconds(seconds: number): void {
    const clamped = Math.max(60, seconds);
    this.lookbackSeconds = clamped;
    this.logAlertsRulesService.setEvaluatorLookbackSeconds(clamped);
    this.logger.log(`Evaluator lookback updated to ${clamped}s.`);
  }

  private startTimer(): void {
    if (this.timer) {
      return; // already running
    }
    this.logger.log(
      `Log alerts evaluator enabled (interval=${this.intervalMs}ms, lookback=${this.lookbackSeconds}s, maxPages=${this.maxPagesPerRun}, entriesPerPage=${this.maxEntriesPerPage}).`,
    );
    this.timer = setInterval(() => {
      void this.safeScheduledRun();
    }, this.intervalMs);
  }

  getStatus(): LogAlertEvaluatorStatus {
    return {
      enabled: this.enabled,
      running: this.running,
      intervalMs: this.intervalMs,
      maxEntriesPerPage: this.maxEntriesPerPage,
      maxPagesPerRun: this.maxPagesPerRun,
      lookbackSeconds: this.lookbackSeconds,
      sqliteReady: this.queryLogSqliteService.getIsEnabled(),
      smtpReady: this.logAlertsEmailService.getSmtpStatus().ready,
      lastRunAt: this.lastRunAt,
      lastSuccessfulRunAt: this.lastSuccessfulRunAt,
      lastRunError: this.lastRunError,
      lastRunDryRun: this.lastRunDryRun,
      lastScannedEntries: this.lastScannedEntries,
      lastEvaluatedRules: this.lastEvaluatedRules,
      lastMatchedRules: this.lastMatchedRules,
      lastAlertsSent: this.lastAlertsSent,
    };
  }

  async runNow(dryRun: boolean): Promise<RunLogAlertEvaluatorResponse> {
    return this.runEvaluation({ dryRun, trigger: "manual" });
  }

  private async safeScheduledRun(): Promise<void> {
    try {
      await this.runEvaluation({ dryRun: false, trigger: "scheduled" });
    } catch (error) {
      this.logger.warn(
        `Scheduled log alert evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async runEvaluation(options: {
    dryRun: boolean;
    trigger: "manual" | "scheduled";
  }): Promise<RunLogAlertEvaluatorResponse> {
    if (this.running) {
      throw new BadRequestException("Log alerts evaluator is already running.");
    }

    if (!this.queryLogSqliteService.getIsEnabled()) {
      throw new ServiceUnavailableException(
        "Stored query logs are unavailable. Enable QUERY_LOG_SQLITE before running evaluator.",
      );
    }

    if (!options.dryRun && !this.logAlertsEmailService.getSmtpStatus().ready) {
      throw new ServiceUnavailableException(
        "SMTP is not ready. Configure SMTP before sending alert emails.",
      );
    }

    this.running = true;
    this.lastRunAt = new Date().toISOString();
    this.lastRunDryRun = options.dryRun;
    this.lastRunError = undefined;

    try {
      const rules = this.logAlertsRulesService
        .listRules()
        .filter((rule) => rule.enabled);
      const entries = await this.fetchRecentEntries();
      const preparedRules = rules.map((rule) => this.prepareRule(rule));
      const entriesByRule = this.createAccumulators(preparedRules);
      const groupLookups = await this.loadNodeGroupLookups(
        preparedRules,
        entries.map((entry) => entry.nodeId),
      );

      for (const entry of entries) {
        const domain = this.normalizeDomain(entry.qname ?? "");
        if (!domain) {
          continue;
        }

        const responseType = (entry.responseType ?? "").trim();
        const isBlocked =
          responseType === "Blocked" || responseType === "BlockedEDNS";
        const entryTs = Date.parse(entry.timestamp ?? "");
        const clientIp = (entry.clientIpAddress ?? "").trim();
        const clientName = (entry.clientName ?? "").trim();

        for (const preparedRule of preparedRules) {
          if (preparedRule.invalidPatternError) {
            continue;
          }

          const rule = preparedRule.rule;
          if (rule.outcomeMode === "blocked-only" && !isBlocked) {
            continue;
          }

          if (!preparedRule.matchDomain(domain)) {
            continue;
          }

          if (!this.matchesClientSelector(rule, clientIp, clientName)) {
            continue;
          }

          if (
            !this.matchesGroupSelector(
              rule,
              entry,
              clientIp,
              clientName,
              groupLookups,
            )
          ) {
            continue;
          }

          const accumulator = entriesByRule.get(rule.id);
          if (!accumulator) {
            continue;
          }

          accumulator.matchedCount += 1;
          if (Number.isFinite(entryTs)) {
            accumulator.latestMatchTs = Math.max(
              accumulator.latestMatchTs ?? 0,
              entryTs,
            );
          }
          if (accumulator.sampleLines.length < 5) {
            accumulator.sampleLines.push(
              this.formatSampleLine(entry, isBlocked ? "blocked" : "allowed"),
            );
          }
        }
      }

      let alertsSent = 0;
      const ruleResults: LogAlertRuleEvaluationResult[] = [];
      for (const preparedRule of preparedRules) {
        const accumulator = entriesByRule.get(preparedRule.rule.id);
        if (!accumulator) {
          continue;
        }

        const result = await this.finalizeRuleEvaluation(
          preparedRule,
          accumulator,
          options.dryRun,
          options.trigger,
        );
        if (result.alertSent) {
          alertsSent += 1;
        }
        ruleResults.push(result);
      }

      const matchedRules = ruleResults.filter(
        (result) => result.matchedCount > 0,
      ).length;
      const response: RunLogAlertEvaluatorResponse = {
        dryRun: options.dryRun,
        scannedEntries: entries.length,
        evaluatedRules: preparedRules.length,
        matchedRules,
        alertsSent,
        triggeredAt: new Date().toISOString(),
        rules: ruleResults,
      };

      this.lastSuccessfulRunAt = response.triggeredAt;
      this.lastScannedEntries = response.scannedEntries;
      this.lastEvaluatedRules = response.evaluatedRules;
      this.lastMatchedRules = response.matchedRules;
      this.lastAlertsSent = response.alertsSent;
      return response;
    } catch (error) {
      this.lastRunError =
        error instanceof Error ? error.message : "Unknown evaluator error.";
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async fetchRecentEntries(): Promise<
    TechnitiumCombinedQueryLogEntry[]
  > {
    const entries: TechnitiumCombinedQueryLogEntry[] = [];
    const end = new Date();
    const start = new Date(end.getTime() - this.lookbackSeconds * 1000);
    for (let page = 1; page <= this.maxPagesPerRun; page += 1) {
      const filters: TechnitiumQueryLogFilters = {
        start: start.toISOString(),
        end: end.toISOString(),
        descendingOrder: true,
        disableCache: true,
        pageNumber: page,
        entriesPerPage: this.maxEntriesPerPage,
      };

      const payload =
        await this.queryLogSqliteService.getStoredCombinedLogs(filters, { authMode: "background" });
      entries.push(...payload.entries);
      if (page >= payload.totalPages || payload.entries.length === 0) {
        break;
      }
    }

    return entries;
  }

  private prepareRule(rule: LogAlertRule): PreparedRule {
    try {
      const matchDomain = this.buildDomainMatcher(rule);
      return { rule, matchDomain };
    } catch (error) {
      return {
        rule,
        matchDomain: () => false,
        invalidPatternError:
          error instanceof Error ? error.message : "Invalid domain pattern.",
      };
    }
  }

  private buildDomainMatcher(rule: LogAlertRule): (domain: string) => boolean {
    const pattern = rule.domainPattern.trim();
    if (rule.domainPatternType === "exact") {
      const expected = this.normalizeDomain(pattern);
      return (domain: string) => this.normalizeDomain(domain) === expected;
    }

    if (rule.domainPatternType === "wildcard") {
      const wildcardRegex = this.wildcardToRegex(pattern);
      return (domain: string) =>
        wildcardRegex.test(this.normalizeDomain(domain));
    }

    const regex = new RegExp(pattern, "i");
    return (domain: string) => regex.test(this.normalizeDomain(domain));
  }

  private wildcardToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i");
  }

  private normalizeDomain(value: string): string {
    return value.trim().replace(/\.+$/, "").toLowerCase();
  }

  private matchesClientSelector(
    rule: LogAlertRule,
    clientIp: string,
    clientName: string,
  ): boolean {
    if (!rule.clientIdentifier) {
      return true;
    }

    const selector = rule.clientIdentifier.trim().toLowerCase();
    if (!selector) {
      return true;
    }

    const ip = clientIp.trim().toLowerCase();
    const name = clientName.trim().toLowerCase();
    return selector === ip || selector === name;
  }

  private async loadNodeGroupLookups(
    preparedRules: PreparedRule[],
    nodeIds: string[],
  ): Promise<Map<string, NodeGroupLookup>> {
    const requiresGroupLookup = preparedRules.some(
      (preparedRule) =>
        Array.isArray(preparedRule.rule.advancedBlockingGroupNames) &&
        preparedRule.rule.advancedBlockingGroupNames.length > 0,
    );

    const lookups = new Map<string, NodeGroupLookup>();
    if (!requiresGroupLookup) {
      return lookups;
    }

    const uniqueNodeIds = [...new Set(nodeIds)];
    await Promise.all(
      uniqueNodeIds.map(async (nodeId) => {
        try {
          const snapshot =
            await this.advancedBlockingService.getSnapshotWithAuth(
              nodeId,
              "background",
            );
          lookups.set(nodeId, this.buildNodeGroupLookup(snapshot.config));
        } catch {
          lookups.set(nodeId, { localMap: new Map(), networkRanges: [] });
        }
      }),
    );

    return lookups;
  }

  private buildNodeGroupLookup(
    config?: AdvancedBlockingConfig,
  ): NodeGroupLookup {
    const localMap = new Map<string, string>();
    const networkRanges: Array<{
      network: number;
      mask: number;
      group: string;
    }> = [];

    if (!config) {
      return { localMap, networkRanges };
    }

    for (const [endpoint, group] of Object.entries(
      config.localEndPointGroupMap ?? {},
    )) {
      const endpointKey = endpoint.trim().toLowerCase();
      const groupName = group.trim();
      if (!endpointKey || !groupName) {
        continue;
      }
      localMap.set(endpointKey, groupName);
    }

    for (const [cidrRaw, groupRaw] of Object.entries(
      config.networkGroupMap ?? {},
    )) {
      const cidr = cidrRaw.trim();
      const group = groupRaw.trim();
      const parsed = this.parseIpv4Cidr(cidr);
      if (!parsed || !group) {
        continue;
      }
      networkRanges.push({ ...parsed, group });
    }

    return { localMap, networkRanges };
  }

  private matchesGroupSelector(
    rule: LogAlertRule,
    entry: TechnitiumCombinedQueryLogEntry,
    clientIp: string,
    clientName: string,
    lookups: Map<string, NodeGroupLookup>,
  ): boolean {
    const expectedGroups = rule.advancedBlockingGroupNames
      ?.map((g) => g.trim().toLowerCase())
      .filter((g) => g.length > 0);

    if (!expectedGroups || expectedGroups.length === 0) {
      return true;
    }

    const lookup = lookups.get(entry.nodeId);
    if (!lookup) {
      return false;
    }

    const candidates = [clientName, clientIp]
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);

    for (const candidate of candidates) {
      const directGroup = lookup.localMap.get(candidate);
      if (directGroup && expectedGroups.includes(directGroup.toLowerCase())) {
        return true;
      }
    }

    const parsedIp = this.parseIpv4(clientIp);
    if (parsedIp === null) {
      return false;
    }

    for (const range of lookup.networkRanges) {
      if ((parsedIp & range.mask) === range.network) {
        if (expectedGroups.includes(range.group.toLowerCase())) {
          return true;
        }
      }
    }

    return false;
  }

  private parseIpv4(raw: string): number | null {
    const value = raw.trim();
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
      return null;
    }
    const octets = value.split(".").map((part) => Number(part));
    if (
      octets.some(
        (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
      )
    ) {
      return null;
    }
    return (
      (((octets[0] ?? 0) << 24) |
        ((octets[1] ?? 0) << 16) |
        ((octets[2] ?? 0) << 8) |
        (octets[3] ?? 0)) >>>
      0
    );
  }

  private parseIpv4Cidr(raw: string): { network: number; mask: number } | null {
    const [ipRaw, prefixRaw] = raw.split("/");
    if (!ipRaw) {
      return null;
    }
    const ip = this.parseIpv4(ipRaw);
    if (ip === null) {
      return null;
    }
    const prefix =
      prefixRaw === undefined ? 32 : Number.parseInt(prefixRaw.trim(), 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      return null;
    }
    const mask =
      prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0) & 0xffffffff;
    return { network: ip & mask, mask };
  }

  private createAccumulators(
    preparedRules: PreparedRule[],
  ): Map<string, RuleEvaluationAccumulator> {
    const accumulators = new Map<string, RuleEvaluationAccumulator>();
    for (const preparedRule of preparedRules) {
      accumulators.set(preparedRule.rule.id, {
        rule: preparedRule.rule,
        matchedCount: 0,
        sampleLines: [],
      });
    }
    return accumulators;
  }

  private formatSampleLine(
    entry: TechnitiumCombinedQueryLogEntry,
    outcome: "blocked" | "allowed",
  ): string {
    const timestamp = entry.timestamp ?? "unknown-time";
    const node = entry.nodeId ?? "unknown-node";
    const client =
      entry.clientName || entry.clientIpAddress || "unknown-client";
    const domain = this.normalizeDomain(entry.qname ?? "") || "unknown-domain";
    return `${timestamp} | ${node} | ${client} | ${domain} | ${outcome}`;
  }

  private async finalizeRuleEvaluation(
    preparedRule: PreparedRule,
    accumulator: RuleEvaluationAccumulator,
    dryRun: boolean,
    trigger: "manual" | "scheduled",
  ): Promise<LogAlertRuleEvaluationResult> {
    if (preparedRule.invalidPatternError) {
      return {
        ruleId: preparedRule.rule.id,
        ruleName: preparedRule.rule.name,
        matchedCount: 0,
        debounced: false,
        alertSent: false,
        error: preparedRule.invalidPatternError,
      };
    }

    const latestMatchAt =
      typeof accumulator.latestMatchTs === "number"
        ? new Date(accumulator.latestMatchTs).toISOString()
        : undefined;

    if (
      accumulator.matchedCount === 0 ||
      accumulator.latestMatchTs === undefined
    ) {
      return {
        ruleId: preparedRule.rule.id,
        ruleName: preparedRule.rule.name,
        matchedCount: 0,
        latestMatchAt,
        debounced: false,
        alertSent: false,
        reason: "no-matches",
      };
    }

    const runtime = this.ruleRuntime.get(preparedRule.rule.id) ?? {};
    const latestMatchTs = accumulator.latestMatchTs;
    const previousAlertedEntryTs = runtime.lastAlertedEntryTs ?? 0;
    const hasNewMatches = latestMatchTs > previousAlertedEntryTs;
    if (!hasNewMatches) {
      return {
        ruleId: preparedRule.rule.id,
        ruleName: preparedRule.rule.name,
        matchedCount: accumulator.matchedCount,
        latestMatchAt,
        debounced: false,
        alertSent: false,
        reason: "no-new-matches-since-last-alert",
      };
    }

    const debounceMs = Math.max(1, preparedRule.rule.debounceSeconds) * 1000;
    const lastSentTs = runtime.lastAlertSentAt
      ? Date.parse(runtime.lastAlertSentAt)
      : 0;
    const nowTs = Date.now();
    const debounced =
      Number.isFinite(lastSentTs) && nowTs - lastSentTs < debounceMs;

    if (debounced) {
      return {
        ruleId: preparedRule.rule.id,
        ruleName: preparedRule.rule.name,
        matchedCount: accumulator.matchedCount,
        latestMatchAt,
        debounced: true,
        alertSent: false,
        reason: "debounce-active",
      };
    }

    if (dryRun) {
      return {
        ruleId: preparedRule.rule.id,
        ruleName: preparedRule.rule.name,
        matchedCount: accumulator.matchedCount,
        latestMatchAt,
        debounced: false,
        alertSent: false,
        reason: `dry-run-${trigger}`,
      };
    }

    try {
      await this.logAlertsEmailService.sendRuleAlertEmail({
        rule: preparedRule.rule,
        matchedCount: accumulator.matchedCount,
        latestMatchAt,
        sampleLines: accumulator.sampleLines,
      });

      this.ruleRuntime.set(preparedRule.rule.id, {
        lastAlertSentAt: new Date().toISOString(),
        lastAlertedEntryTs: latestMatchTs,
      });

      return {
        ruleId: preparedRule.rule.id,
        ruleName: preparedRule.rule.name,
        matchedCount: accumulator.matchedCount,
        latestMatchAt,
        debounced: false,
        alertSent: true,
      };
    } catch (error) {
      return {
        ruleId: preparedRule.rule.id,
        ruleName: preparedRule.rule.name,
        matchedCount: accumulator.matchedCount,
        latestMatchAt,
        debounced: false,
        alertSent: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to send log alert email.",
      };
    }
  }
}
