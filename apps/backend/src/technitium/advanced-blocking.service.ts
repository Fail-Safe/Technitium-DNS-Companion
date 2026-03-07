import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  AdvancedBlockingCombinedOverview,
  AdvancedBlockingConfig,
  AdvancedBlockingGroup,
  AdvancedBlockingGroupComparison,
  AdvancedBlockingGroupComparisonStatus,
  AdvancedBlockingGroupSettings,
  AdvancedBlockingGroupSettingsDiff,
  AdvancedBlockingMetrics,
  AdvancedBlockingOverview,
  AdvancedBlockingSnapshot,
  AdvancedBlockingUrlEntry,
  AdvancedBlockingUrlOverride,
} from "./advanced-blocking.types";
import { DnsFilteringSnapshotService } from "./dns-filtering-snapshot.service";
import { QueryLogSqliteService } from "./query-log-sqlite.service";
import { TechnitiumService } from "./technitium.service";
import type { TechnitiumNodeSummary } from "./technitium.types";

interface TechnitiumAppConfigEnvelope {
  status?: string;
  response?: { config?: string | null };
}

type RuleOptimizationSuggestionKind =
  | "SAFE_TO_ZONE_DOMAIN_ENTRY"
  | "LIKELY_TO_ZONE_DOMAIN_ENTRY_EXPANDS_SCOPE"
  | "MANUAL_REVIEW_ZONE_CANDIDATE"
  | "PERF_WARNING";

type RuleOptimizationSuggestionTargetList = "allowedRegex" | "blockedRegex";

interface RuleOptimizationSuggestion {
  id: string;
  nodeId: string;
  groupName: string;
  targetList: RuleOptimizationSuggestionTargetList;
  kind: RuleOptimizationSuggestionKind;
  title: string;
  summary: string;
  regexPattern: string;
  proposedDomainEntry?: string;
  /**
   * When true, applying this suggestion is expected to expand scope and match additional
   * domains compared to the regex (e.g. replacing apex-only regex with a zone rule).
   */
  scopeExpansionRisk: boolean;
  /**
   * Human-readable explanation shown in the UI.
   */
  details: string[];
  /**
   * Optional perf heuristics (higher = worse).
   */
  perfScore?: number;
  /**
   * Example of a "safe" rewrite explanation.
   */
  confidence: "safe" | "likely" | "warning";
  /**
   * When the regex is a simple host alternation (e.g. ^(a|b|c)\.example\.com$),
   * the full FQDNs for each alternation host, e.g. ["a.example.com", "b.example.com", "c.example.com"].
   * Allows the frontend to offer "add as explicit hosts" instead of a zone entry.
   */
  alternationHosts?: string[];
}

interface ValidateSuggestionRequest {
  suggestionId?: string;
  regexPattern?: string;
  proposedDomainEntry?: string;
  targetList?: RuleOptimizationSuggestionTargetList;
}

interface ValidateSuggestionResult {
  enabled: boolean;
  windowHours: number;
  limit: number;
  distinctDomainsAnalyzed: number;
  proposedDomainEntry: string;
  additionalMatchedDomainsCount: number;
  additionalMatchedDomainsExamples: Array<{ domain: string; count: number }>;
  note: string;
}

interface ApplySuggestionRequest {
  suggestionId?: string;
  regexPattern?: string;
  proposedDomainEntry?: string;
  proposedDomainEntries?: string[];
  targetList: RuleOptimizationSuggestionTargetList;
  /**
   * When true, the backend will take a DNS filtering snapshot prior to applying changes.
   * Defaults to true.
   */
  takeSnapshot?: boolean;
  /**
   * Optional snapshot note.
   */
  snapshotNote?: string;
}

interface ApplySuggestionResult {
  snapshotTaken?: {
    id: string;
    createdAt: string;
    method: "rule-optimizer";
    note?: string;
  };
  updated: AdvancedBlockingSnapshot;
  applied: {
    groupName: string;
    targetList: RuleOptimizationSuggestionTargetList;
    removedRegexPattern: string;
    addedDomainEntries: string[];
  };
}

@Injectable()
export class AdvancedBlockingService {
  private static readonly APP_NAME_CANDIDATES = ["Advanced Blocking"] as const;
  private readonly logger = new Logger(AdvancedBlockingService.name);
  private readonly appNameByNode = new Map<string, string>();

  constructor(
    private readonly technitiumService: TechnitiumService,
    @Inject(forwardRef(() => DnsFilteringSnapshotService))
    private readonly dnsFilteringSnapshotService: DnsFilteringSnapshotService,
    private readonly queryLogSqliteService: QueryLogSqliteService,
  ) {}

  async getOverview(): Promise<AdvancedBlockingOverview> {
    const summaries = await this.technitiumService.listNodes();
    const snapshots = await Promise.all(
      summaries.map((summary) => this.loadSnapshot(summary, "session")),
    );
    const aggregate = snapshots.reduce(
      (acc, snapshot) => this.combineMetrics(acc, snapshot.metrics),
      this.emptyMetrics(),
    );

    return { fetchedAt: new Date().toISOString(), aggregate, nodes: snapshots };
  }

  async getSnapshot(nodeId: string): Promise<AdvancedBlockingSnapshot> {
    return this.getSnapshotWithAuth(nodeId, "session");
  }

  async getSnapshotWithAuth(
    nodeId: string,
    authMode: "session" | "background" | "schedule",
  ): Promise<AdvancedBlockingSnapshot> {
    const summaries = await this.technitiumService.listNodes();
    const summary = summaries.find(
      (node) => node.id.toLowerCase() === nodeId.toLowerCase(),
    );

    if (!summary) {
      throw new NotFoundException(
        `Technitium DNS node "${nodeId}" is not configured.`,
      );
    }

    return this.loadSnapshot(summary, authMode);
  }

  async setConfig(
    nodeId: string,
    config: AdvancedBlockingConfig,
  ): Promise<AdvancedBlockingSnapshot> {
    return this.setConfigWithAuth(nodeId, config, "session");
  }

  async setConfigWithAuth(
    nodeId: string,
    config: AdvancedBlockingConfig,
    authMode: "session" | "schedule",
  ): Promise<AdvancedBlockingSnapshot> {
    const serialized = this.serializeConfig(config);
    const body = new URLSearchParams();
    body.set("config", JSON.stringify(serialized, null, 2));

    const appNames = this.resolveAppNameCandidates(nodeId);
    let lastError: Error | undefined;

    for (const appName of appNames) {
      try {
        await this.technitiumService.executeAction(
          nodeId,
          {
            method: "POST",
            url: "/api/apps/config/set",
            params: { name: appName },
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
          },
          { authMode },
        );

        this.appNameByNode.set(nodeId, appName);
        return this.getSnapshotWithAuth(nodeId, authMode);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `Failed to save Advanced Blocking config via app name "${appName}" on node "${nodeId}"`,
        );
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error(
      "Failed to save Advanced Blocking config: no app names succeeded.",
    );
  }

  private async loadSnapshot(
    summary: TechnitiumNodeSummary,
    authMode: "session" | "background" | "schedule",
  ): Promise<AdvancedBlockingSnapshot> {
    const baseSnapshot: AdvancedBlockingSnapshot = {
      nodeId: summary.id,
      baseUrl: summary.baseUrl,
      fetchedAt: new Date().toISOString(),
      metrics: this.emptyMetrics(),
    };

    try {
      const { envelope, appName } = await this.fetchConfigWithFallback(
        summary.id,
        authMode,
      );

      const rawConfig = envelope?.response?.config;
      if (!rawConfig) {
        const config = this.createEmptyConfig();
        const metrics = this.calculateMetrics(config);
        if (appName) {
          this.appNameByNode.set(summary.id, appName);
        }

        return { ...baseSnapshot, config, metrics };
      }

      const config = this.parseConfig(rawConfig);
      const metrics = this.calculateMetrics(config);
      if (appName) {
        this.appNameByNode.set(summary.id, appName);
      }

      return { ...baseSnapshot, config, metrics };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(
        `Failed to load Advanced Blocking config from node "${summary.id}": ${message}`,
      );
      return { ...baseSnapshot, error: message };
    }
  }

  private async fetchConfigWithFallback(
    nodeId: string,
    authMode: "session" | "background" | "schedule",
  ): Promise<{ envelope: TechnitiumAppConfigEnvelope; appName?: string }> {
    const appNames = this.resolveAppNameCandidates(nodeId);
    let lastError: Error | undefined;

    for (const appName of appNames) {
      try {
        const envelope =
          await this.technitiumService.executeAction<TechnitiumAppConfigEnvelope>(
            nodeId,
            {
              method: "GET",
              url: "/api/apps/config/get",
              params: { name: appName },
            },
            { authMode },
          );

        return { envelope, appName };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `Failed to fetch Advanced Blocking config via app name "${appName}" on node "${nodeId}"`,
        );
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error(
      "Unable to fetch Advanced Blocking config: no app names succeeded.",
    );
  }

  private resolveAppNameCandidates(nodeId: string): string[] {
    const remembered = this.appNameByNode.get(nodeId);
    const candidates = [...AdvancedBlockingService.APP_NAME_CANDIDATES];
    if (!remembered) {
      return candidates;
    }

    return [remembered, ...candidates.filter((name) => name !== remembered)];
  }

  /**
   * Return group-level regex optimization suggestions (allowedRegex/blockedRegex only).
   *
   * This is intentionally conservative:
   * - SAFE suggestions only cover zone-equivalent regex patterns that we can confidently map.
   * - LIKELY suggestions may change semantics (notably: apex-only regex → zone rule expands scope).
   * - PERF_WARNING suggestions are advisory only.
   */
  async getGroupRuleOptimizationSuggestions(
    nodeId: string,
    groupName: string,
  ): Promise<{
    fetchedAt: string;
    nodeId: string;
    groupName: string;
    suggestions: RuleOptimizationSuggestion[];
  }> {
    const snapshot = await this.getSnapshot(nodeId);
    const config = snapshot.config;

    if (!config) {
      throw new Error(
        snapshot.error ||
          `Advanced Blocking is not available on node "${nodeId}".`,
      );
    }

    const group = (config.groups ?? []).find(
      (g) => (g.name ?? "").toLowerCase() === groupName.toLowerCase(),
    );

    if (!group) {
      throw new NotFoundException(
        `Advanced Blocking group "${groupName}" was not found on node "${nodeId}".`,
      );
    }

    const suggestions: RuleOptimizationSuggestion[] = [];

    const allowedRegex = (group.allowedRegex ?? []).filter(Boolean);
    const blockedRegex = (group.blockedRegex ?? []).filter(Boolean);

    for (const pattern of allowedRegex) {
      suggestions.push(
        ...this.suggestForPattern(
          nodeId,
          group.name ?? groupName,
          "allowedRegex",
          pattern,
        ),
      );
    }

    for (const pattern of blockedRegex) {
      suggestions.push(
        ...this.suggestForPattern(
          nodeId,
          group.name ?? groupName,
          "blockedRegex",
          pattern,
        ),
      );
    }

    return {
      fetchedAt: new Date().toISOString(),
      nodeId,
      groupName: group.name ?? groupName,
      suggestions,
    };
  }

  /**
   * Validate a suggestion against recent query logs.
   *
   * MVP validation:
   * - Uses SQLite (if enabled) to fetch distinct recent domains (aggregated across nodes).
   * - Reports "expansion impact" of converting to a zone/domain entry:
   *   how many additional recent domains would match the proposed domain entry.
   *
   * Note: This does NOT execute .NET regex. It is meant to quantify scope expansion risk.
   */
  async validateGroupRuleOptimizationSuggestion(
    nodeId: string,
    groupName: string,
    input: { windowHours?: number; limit?: number; payload?: unknown },
  ): Promise<ValidateSuggestionResult> {
    const payload = (input.payload ?? {}) as ValidateSuggestionRequest;

    const proposedDomainEntryRaw =
      typeof payload.proposedDomainEntry === "string"
        ? payload.proposedDomainEntry
        : undefined;

    if (!proposedDomainEntryRaw || !proposedDomainEntryRaw.trim()) {
      throw new Error("Validation requires proposedDomainEntry.");
    }

    const proposedDomainEntry = this.normalizeDomain(proposedDomainEntryRaw);

    // Ensure group exists (and that this endpoint is group-scoped).
    const snapshot = await this.getSnapshot(nodeId);
    const config = snapshot.config;
    if (!config) {
      throw new Error(
        snapshot.error ||
          `Advanced Blocking is not available on node "${nodeId}".`,
      );
    }

    const group = (config.groups ?? []).find(
      (g) => (g.name ?? "").toLowerCase() === groupName.toLowerCase(),
    );
    if (!group) {
      throw new NotFoundException(
        `Advanced Blocking group "${groupName}" was not found on node "${nodeId}".`,
      );
    }

    const windowHours =
      typeof input.windowHours === "number" &&
      Number.isFinite(input.windowHours)
        ? Math.max(1, Math.trunc(input.windowHours))
        : 24;

    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.min(100_000, Math.max(100, Math.trunc(input.limit)))
        : 10_000;

    // Pull distinct domains from sqlite (aggregated across all nodes).
    // If sqlite is disabled, QueryLogSqliteService will throw; we convert to a user-friendly result.
    let domains: Array<{ qnameLc: string; count: number }> = [];
    try {
      domains = this.queryLogSqliteService.getStoredDistinctDomainsCombined({
        windowHours,
        limit,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        enabled: false,
        windowHours,
        limit,
        distinctDomainsAnalyzed: 0,
        proposedDomainEntry,
        additionalMatchedDomainsCount: 0,
        additionalMatchedDomainsExamples: [],
        note:
          `Validation is unavailable because stored query logs are not enabled/ready. ` +
          `Details: ${message}`,
      };
    }

    const proposedIsZoneEntry = proposedDomainEntry;
    const additional: Array<{ domain: string; count: number }> = [];

    for (const row of domains) {
      const q = row.qnameLc;
      if (!q) continue;

      // "Additional domains" means subdomains (excluding the apex itself).
      if (q === proposedIsZoneEntry) continue;

      if (this.isSubdomainOf(q, proposedIsZoneEntry)) {
        additional.push({ domain: q, count: row.count ?? 0 });
      }
    }

    // Sort examples by count desc, then lexicographically.
    additional.sort((a, b) => {
      if ((b.count ?? 0) !== (a.count ?? 0))
        return (b.count ?? 0) - (a.count ?? 0);
      return a.domain.localeCompare(b.domain);
    });

    const examples = additional.slice(0, 50);

    return {
      enabled: true,
      windowHours,
      limit,
      distinctDomainsAnalyzed: domains.length,
      proposedDomainEntry,
      additionalMatchedDomainsCount: additional.length,
      additionalMatchedDomainsExamples: examples,
      note:
        "Validation reports scope expansion impact of converting to a zone/domain entry " +
        "(how many additional recent subdomains would match). It does not execute .NET regex.",
    };
  }

  /**
   * Apply an optimization:
   * - optionally take a DNS filtering snapshot (advanced-blocking),
   * - remove the specified regex pattern from allowedRegex/blockedRegex,
   * - add the proposed domain entry to allowed/blocked (zone semantics),
   * - save config via Technitium and return updated snapshot.
   */
  async applyGroupRuleOptimization(
    nodeId: string,
    groupName: string,
    body?: unknown,
  ): Promise<ApplySuggestionResult> {
    const payload = (body ?? {}) as ApplySuggestionRequest;

    const proposedDomainEntryRaw = payload.proposedDomainEntry;
    const proposedDomainEntriesRaw = payload.proposedDomainEntries;
    const proposedDomainEntries: string[] =
      Array.isArray(proposedDomainEntriesRaw) &&
      proposedDomainEntriesRaw.length > 0
        ? proposedDomainEntriesRaw
            .map((d) => this.normalizeDomain(String(d)))
            .filter(Boolean)
        : typeof proposedDomainEntryRaw === "string" &&
            proposedDomainEntryRaw.trim()
          ? [this.normalizeDomain(proposedDomainEntryRaw)]
          : [];

    if (proposedDomainEntries.length === 0) {
      throw new Error(
        "Apply requires proposedDomainEntry or proposedDomainEntries.",
      );
    }

    const targetList = payload.targetList;
    if (targetList !== "allowedRegex" && targetList !== "blockedRegex") {
      throw new Error(
        'Apply requires targetList of "allowedRegex" or "blockedRegex".',
      );
    }

    const regexPatternRaw = payload.regexPattern;
    if (typeof regexPatternRaw !== "string" || !regexPatternRaw.trim()) {
      throw new Error("Apply requires regexPattern.");
    }

    const regexPattern = regexPatternRaw;

    const takeSnapshot =
      typeof payload.takeSnapshot === "boolean" ? payload.takeSnapshot : true;

    let snapshotTaken:
      | {
          id: string;
          createdAt: string;
          method: "rule-optimizer";
          note?: string;
        }
      | undefined;

    if (takeSnapshot) {
      const defaultNote =
        proposedDomainEntries.length === 1
          ? `Rule optimization apply: ${targetList} "${regexPattern}" -> domain "${proposedDomainEntries[0]}"`
          : `Rule optimization apply: ${targetList} "${regexPattern}" -> ${proposedDomainEntries.length} explicit entries`;

      const note =
        typeof payload.snapshotNote === "string" && payload.snapshotNote.trim()
          ? payload.snapshotNote.trim()
          : defaultNote;

      const metadata = await this.dnsFilteringSnapshotService.saveSnapshot(
        nodeId,
        "rule-optimizer",
        "rule-optimization",
        note,
      );

      snapshotTaken = {
        id: metadata.id,
        createdAt: metadata.createdAt,
        method: "rule-optimizer",
        note: metadata.note,
      };
    }

    const snapshot = await this.getSnapshot(nodeId);
    const config = snapshot.config;

    if (!config) {
      throw new Error(
        snapshot.error ||
          `Advanced Blocking is not available on node "${nodeId}".`,
      );
    }

    const groups = [...(config.groups ?? [])];
    const idx = groups.findIndex(
      (g) => (g.name ?? "").toLowerCase() === groupName.toLowerCase(),
    );

    if (idx < 0) {
      throw new NotFoundException(
        `Advanced Blocking group "${groupName}" was not found on node "${nodeId}".`,
      );
    }

    const group = { ...groups[idx] };

    const allowed = new Set(
      (group.allowed ?? []).map((d) => this.normalizeDomain(d)),
    );
    const blocked = new Set(
      (group.blocked ?? []).map((d) => this.normalizeDomain(d)),
    );

    const allowedRegex = [...(group.allowedRegex ?? [])];
    const blockedRegex = [...(group.blockedRegex ?? [])];

    const removeFrom =
      targetList === "allowedRegex" ? allowedRegex : blockedRegex;
    const removedIndex = removeFrom.findIndex((p) => p === regexPattern);

    if (removedIndex < 0) {
      throw new NotFoundException(
        `Regex pattern was not found in ${targetList} for group "${group.name ?? groupName}".`,
      );
    }

    removeFrom.splice(removedIndex, 1);

    if (targetList === "allowedRegex") {
      for (const entry of proposedDomainEntries) {
        allowed.add(entry);
      }
      group.allowed = [...allowed].sort((a, b) => a.localeCompare(b));
      group.allowedRegex = allowedRegex;
    } else {
      for (const entry of proposedDomainEntries) {
        blocked.add(entry);
      }
      group.blocked = [...blocked].sort((a, b) => a.localeCompare(b));
      group.blockedRegex = blockedRegex;
    }

    groups[idx] = group;

    const nextConfig: AdvancedBlockingConfig = { ...config, groups };

    const updated = await this.setConfig(nodeId, nextConfig);

    return {
      snapshotTaken,
      updated,
      applied: {
        groupName: group.name ?? groupName,
        targetList,
        removedRegexPattern: regexPattern,
        addedDomainEntries: proposedDomainEntries,
      },
    };
  }

  private suggestForPattern(
    nodeId: string,
    groupName: string,
    targetList: RuleOptimizationSuggestionTargetList,
    regexPattern: string,
  ): RuleOptimizationSuggestion[] {
    const pattern = String(regexPattern);

    const out: RuleOptimizationSuggestion[] = [];

    const perf = this.scoreRegexPerf(pattern);

    const zone = this.extractZoneDomainFromRegex(pattern);

    if (zone) {
      out.push({
        id: this.buildSuggestionId(
          groupName,
          targetList,
          pattern,
          "SAFE_TO_ZONE_DOMAIN_ENTRY",
        ),
        nodeId,
        groupName,
        targetList,
        kind: "SAFE_TO_ZONE_DOMAIN_ENTRY",
        title: "Replace regex with zone domain entry",
        summary:
          `This regex appears to match the zone "${zone}" (apex + subdomains). ` +
          `Replacing it with "${zone}" should be faster and simpler.`,
        regexPattern: pattern,
        proposedDomainEntry: zone,
        scopeExpansionRisk: false,
        details: [
          "Advanced Blocking non-regex domains are evaluated via zone (suffix) lookup, which is typically faster than evaluating regex.",
          "This suggestion is categorized SAFE because the regex matches a common zone pattern we can confidently interpret.",
        ],
        perfScore: perf,
        confidence: "safe",
      });
    } else {
      const apex = this.extractExactApexDomainFromRegex(pattern);
      if (apex) {
        out.push({
          id: this.buildSuggestionId(
            groupName,
            targetList,
            pattern,
            "LIKELY_TO_ZONE_DOMAIN_ENTRY_EXPANDS_SCOPE",
          ),
          nodeId,
          groupName,
          targetList,
          kind: "LIKELY_TO_ZONE_DOMAIN_ENTRY_EXPANDS_SCOPE",
          title:
            "Replace apex-only regex with zone domain entry (expands scope)",
          summary:
            `This regex appears to match only the apex "${apex}". ` +
            `Replacing it with "${apex}" would also match subdomains (zone semantics).`,
          regexPattern: pattern,
          proposedDomainEntry: apex,
          scopeExpansionRisk: true,
          details: [
            "Advanced Blocking non-regex domains use zone matching (suffix-walk).",
            `Adding "${apex}" will match "${apex}" and any subdomains like "a.${apex}".`,
            "Use Validate to see how many additional recent domains would be affected.",
          ],
          perfScore: perf,
          confidence: "likely",
        });
      } else {
        const alternation =
          this.extractSimpleAlternationHostPatternFromRegex(pattern);
        if (alternation) {
          const hostsPreview = alternation.hosts.slice(0, 6).join(", ");
          const hostCount = alternation.hosts.length;

          out.push({
            id: this.buildSuggestionId(
              groupName,
              targetList,
              pattern,
              "MANUAL_REVIEW_ZONE_CANDIDATE",
            ),
            nodeId,
            groupName,
            targetList,
            kind: "MANUAL_REVIEW_ZONE_CANDIDATE",
            title: "Manual review: host alternation may be collapsible",
            summary:
              `This regex matches ${hostCount} explicit domain` +
              `${hostCount === 1 ? "" : "s"} under "${alternation.apex}" ` +
              `(${hostsPreview}${hostCount > 6 ? ", ..." : ""}). ` +
              `A zone entry "${alternation.apex}" may simplify rules, but will expand scope to additional subdomains.`,
            regexPattern: pattern,
            proposedDomainEntry: alternation.apex,
            alternationHosts: alternation.hosts.map(
              (h) => `${h}.${alternation.apex}`,
            ),
            scopeExpansionRisk: true,
            details: [
              "This is a manual-review candidate, not an auto-apply recommendation.",
              `Current regex appears limited to explicit domains: ${alternation.hosts.join(", ")}.`,
              `Replacing with "${alternation.apex}" will also match other subdomains not currently matched.`,
              "Use Validate to estimate additional impacted subdomains from recent query logs before any manual change.",
            ],
            perfScore: perf,
            confidence: "likely",
          });
        } else {
          const regexAlternation =
            this.extractSingleLabelRegexAlternationPattern(pattern);
          if (regexAlternation) {
            const branchCount = regexAlternation.branches.length;
            const branchPreview = regexAlternation.branches
              .slice(0, 4)
              .join(" | ");

            out.push({
              id: this.buildSuggestionId(
                groupName,
                targetList,
                pattern,
                "MANUAL_REVIEW_ZONE_CANDIDATE",
              ),
              nodeId,
              groupName,
              targetList,
              kind: "MANUAL_REVIEW_ZONE_CANDIDATE",
              title:
                "Manual review: regex alternation may be replaceable by zone",
              summary:
                `This regex contains ${branchCount} label alternation branch` +
                `${branchCount === 1 ? "" : "es"} before "${regexAlternation.apex}" ` +
                `(${branchPreview}${branchCount > 4 ? " | ..." : ""}). ` +
                `A zone entry "${regexAlternation.apex}" may simplify rule maintenance, but will broaden match scope.`,
              regexPattern: pattern,
              proposedDomainEntry: regexAlternation.apex,
              scopeExpansionRisk: true,
              details: [
                "This is a manual-review candidate, not an auto-apply recommendation.",
                `Regex branches detected: ${regexAlternation.branches.join(" | ")}.`,
                `Replacing with "${regexAlternation.apex}" would match additional subdomains not currently constrained by this regex.`,
                "Use Validate to estimate expansion impact from recent query logs before making a manual change.",
              ],
              perfScore: perf,
              confidence: "likely",
            });
          }
        }
      }
    }

    // Perf warning (advisory) — always emit for high-ish scores.
    if (perf >= 6) {
      out.push({
        id: this.buildSuggestionId(
          groupName,
          targetList,
          pattern,
          "PERF_WARNING",
        ),
        nodeId,
        groupName,
        targetList,
        kind: "PERF_WARNING",
        title: "Regex may be more expensive than necessary",
        summary:
          "This pattern may increase per-query overhead (unanchored matches, wildcards, or complex constructs).",
        regexPattern: pattern,
        proposedDomainEntry: undefined,
        scopeExpansionRisk: false,
        details: [
          "Regex rules are evaluated by scanning patterns and calling IsMatch for each one until a match is found.",
          "Consider replacing with a domain entry when the intent is to match a specific zone/domain.",
        ],
        perfScore: perf,
        confidence: "warning",
      });
    }

    return out;
  }

  private buildSuggestionId(
    groupName: string,
    targetList: RuleOptimizationSuggestionTargetList,
    pattern: string,
    kind: RuleOptimizationSuggestionKind,
  ): string {
    const src = `${groupName}|${targetList}|${kind}|${pattern}`;
    // Stable, non-cryptographic hash is fine for IDs here.
    let hash = 0;
    for (let i = 0; i < src.length; i += 1) {
      hash = (hash * 31 + src.charCodeAt(i)) >>> 0;
    }
    return `abopt-${hash.toString(16)}`;
  }

  private normalizeDomain(domain: string): string {
    return domain.trim().replace(/\.$/, "").toLowerCase();
  }

  private isSubdomainOf(qnameLc: string, zoneLc: string): boolean {
    if (!qnameLc || !zoneLc) return false;
    if (qnameLc === zoneLc) return true;
    return qnameLc.endsWith(`.${zoneLc}`);
  }

  /**
   * Very conservative "safe zone regex" extractor.
   *
   * Supports patterns like:
   * - ^([a-z0-9-]+\.)*example\.com$
   * - ^([a-z0-9-]+\.)+example\.com$  (subdomains only; still maps to zone)
   * - ^(.*\.)?example\.com$          (commonly used; treated as safe only if anchored)
   * - (\.|^)example\.com$            (common boundary-prefix form in blocklists)
   *
   * Returns the zone domain (lowercased) if recognized; otherwise null.
   */
  private extractZoneDomainFromRegex(pattern: string): string | null {
    const p = pattern.trim();

    // Must be anchored at end to avoid broad partial matches.
    if (!p.endsWith("$")) return null;

    // Common forms:
    // 1) ^([a-z0-9-]+\.)*example\.com$
    // 2) ^(.*\.)?example\.com$
    // 3) ^([\\w-]+\\.)*example\\.com$ (users sometimes use \w)
    // We don't want to hardcode example.com; we want to capture the domain tail.
    // Capture a literal domain tail of the form label(\.label)+ with escaped dots.
    const tail = p.match(/([a-z0-9-]+(?:\\\.[a-z0-9-]+)+)\$$/i);
    if (!tail) return null;

    const escapedDomain = tail[1];
    const domain = escapedDomain.replace(/\\\./g, ".").toLowerCase();

    // Verify domain "shape" quickly (avoid suggesting nonsense).
    if (!this.looksLikeDomain(domain)) return null;

    // Ensure the prefix is one of our allowed "subdomain wildcard" forms.
    const prefix = p.slice(0, p.length - (escapedDomain.length + 1)); // remove "<domain>$"
    const normalizedPrefix = prefix;

    const allowedPrefixes = [
      "^([a-z0-9-]+\\.)*",
      "^([a-z0-9-]+\\.)+",
      "^(.*\\.)?",
      "^(.*\\.)*",
      "^(\\w+\\.)*",
      "^(\\w+\\.)+",
      "^([\\w-]+\\.)*",
      "^([\\w-]+\\.)+",
      "(\\.|^)",
      "(?:\\.|^)",
      "(^|\\.)",
      "(?:^|\\.)",
    ];

    if (!allowedPrefixes.includes(normalizedPrefix)) {
      return null;
    }

    return domain;
  }

  /**
   * Extract apex-only exact match patterns like:
   * - ^example\.com$
   */
  private extractExactApexDomainFromRegex(pattern: string): string | null {
    const p = pattern.trim();
    const m = p.match(/^\^([a-z0-9-]+(?:\\\.[a-z0-9-]+)+)\$$/i);
    if (!m) return null;

    const domain = m[1].replace(/\\\./g, ".").toLowerCase();
    if (!this.looksLikeDomain(domain)) return null;
    return domain;
  }

  /**
   * Extract patterns like:
   * - ^(booking|cdn|growthbook|www)\.moego\.pet$
   * - ^(?:a|b|c)\.example\.com$
   *
   * Returns the apex and explicit host labels when the regex is simple enough
   * for manual-review guidance.
   */
  private extractSimpleAlternationHostPatternFromRegex(
    pattern: string,
  ): { apex: string; hosts: string[] } | null {
    const p = pattern.trim();
    const m = p.match(
      /^\^(?:\((?:\?:)?([a-z0-9-]+(?:\|[a-z0-9-]+)+)\)|(?:\?:)?([a-z0-9-]+(?:\|[a-z0-9-]+)+))\\\.([a-z0-9-]+(?:\\\.[a-z0-9-]+)+)\$$/i,
    );
    if (!m) return null;

    const alternationRaw = (m[1] || m[2] || "").toLowerCase();
    const hosts = alternationRaw
      .split("|")
      .map((h) => h.trim())
      .filter(Boolean);

    if (hosts.length < 2) return null;
    if (!hosts.every((h) => /^[a-z0-9-]+$/.test(h))) return null;
    if (hosts.some((h) => h.startsWith("-") || h.endsWith("-"))) return null;

    const apex = m[3].replace(/\\\./g, ".").toLowerCase();
    if (!this.looksLikeDomain(apex)) return null;

    return { apex, hosts: [...new Set(hosts)] };
  }

  /**
   * Extract patterns like:
   * - (?:[a-f0-9]{32}|text-generation)\.perchance\.org$
   * - ^(?:[a-z0-9-]{1,16}|api|cdn)\.example\.com$
   *
   * These are treated as manual-review candidates because converting to a zone
   * entry would likely expand scope beyond the constrained label alternation.
   */
  private extractSingleLabelRegexAlternationPattern(
    pattern: string,
  ): { apex: string; branches: string[] } | null {
    const p = pattern.trim();

    const m = p.match(
      /^\^?\(\?:([^()]+)\)\\\.([a-z0-9-]+(?:\\\.[a-z0-9-]+)+)\$$/i,
    );
    if (!m) return null;

    const alternationRaw = m[1] ?? "";
    const branches = alternationRaw
      .split("|")
      .map((b) => b.trim())
      .filter(Boolean);

    if (branches.length < 2) return null;

    const apex = m[2].replace(/\\\./g, ".").toLowerCase();
    if (!this.looksLikeDomain(apex)) return null;

    return { apex, branches: [...new Set(branches)] };
  }

  private looksLikeDomain(domain: string): boolean {
    // Conservative check: labels separated by dots, labels contain a-z0-9-,
    // don't start/end with hyphen, and total length sanity.
    if (domain.length < 1 || domain.length > 253) return false;
    const labels = domain.split(".");
    if (labels.length < 2) return false;

    for (const label of labels) {
      if (label.length < 1 || label.length > 63) return false;
      if (!/^[a-z0-9-]+$/.test(label)) return false;
      if (label.startsWith("-") || label.endsWith("-")) return false;
    }

    return true;
  }

  /**
   * Rough perf heuristic used for warnings and sorting.
   * Higher score means "more likely to be expensive".
   */
  private scoreRegexPerf(pattern: string): number {
    let score = 0;
    const p = pattern;

    // Unanchored patterns tend to be more expensive and ambiguous.
    if (!p.startsWith("^")) score += 2;
    if (!p.endsWith("$")) score += 2;

    // Wildcards and broad matches.
    if (p.includes(".*")) score += 3;
    if (p.includes(".+")) score += 2;

    // Alternations can be costly.
    const alternations = (p.match(/\|/g) ?? []).length;
    score += Math.min(3, alternations);

    // Nested quantifiers (very rough detection).
    if (/\+\)\+|\*\)\+|\+\)\*|\*\)\*/.test(p)) score += 4;

    // Length as a proxy.
    if (p.length > 50) score += 1;
    if (p.length > 150) score += 1;

    return score;
  }

  private parseConfig(rawConfig: string): AdvancedBlockingConfig {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawConfig) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Unable to parse Advanced Blocking config JSON: ${(error as Error).message}`,
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Advanced Blocking config payload was not an object.");
    }

    const payload = parsed as Record<string, unknown>;
    const groups = Array.isArray(payload.groups)
      ? payload.groups
          .map((group) => this.normalizeGroup(group))
          .filter((group): group is AdvancedBlockingGroup => Boolean(group))
      : [];

    return {
      enableBlocking:
        typeof payload.enableBlocking === "boolean"
          ? payload.enableBlocking
          : undefined,
      blockingAnswerTtl: this.normalizeInteger(payload.blockingAnswerTtl),
      blockListUrlUpdateIntervalHours:
        typeof payload.blockListUrlUpdateIntervalHours === "number"
          ? payload.blockListUrlUpdateIntervalHours
          : undefined,
      blockListUrlUpdateIntervalMinutes:
        typeof payload.blockListUrlUpdateIntervalMinutes === "number"
          ? payload.blockListUrlUpdateIntervalMinutes
          : undefined,
      localEndPointGroupMap: this.normalizeMapping(
        payload.localEndPointGroupMap,
      ),
      networkGroupMap: this.normalizeMapping(payload.networkGroupMap),
      groups,
    };
  }

  private normalizeInteger(value: unknown): number | undefined {
    if (typeof value === "number") {
      return Number.isFinite(value) ? Math.trunc(value) : undefined;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return undefined;
      }

      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isNaN(parsed)) {
        return undefined;
      }

      return parsed;
    }

    return undefined;
  }

  private normalizeGroup(raw: unknown): AdvancedBlockingGroup | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }

    const data = raw as Record<string, unknown>;
    const name = typeof data.name === "string" ? data.name : undefined;
    if (!name) {
      return undefined;
    }

    return {
      name,
      enableBlocking:
        typeof data.enableBlocking === "boolean"
          ? data.enableBlocking
          : undefined,
      allowTxtBlockingReport:
        typeof data.allowTxtBlockingReport === "boolean"
          ? data.allowTxtBlockingReport
          : undefined,
      blockAsNxDomain:
        typeof data.blockAsNxDomain === "boolean"
          ? data.blockAsNxDomain
          : undefined,
      blockingAddresses: this.normalizeStringArray(data.blockingAddresses),
      allowed: this.normalizeStringArray(data.allowed),
      blocked: this.normalizeStringArray(data.blocked),
      allowListUrls: this.normalizeUrlEntries(data.allowListUrls),
      blockListUrls: this.normalizeUrlEntries(data.blockListUrls),
      allowedRegex: this.normalizeStringArray(data.allowedRegex),
      blockedRegex: this.normalizeStringArray(data.blockedRegex),
      regexAllowListUrls: this.normalizeUrlEntries(data.regexAllowListUrls),
      regexBlockListUrls: this.normalizeUrlEntries(data.regexBlockListUrls),
      adblockListUrls: this.normalizeStringArray(data.adblockListUrls),
    };
  }

  private normalizeMapping(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const entries: Array<[string, string]> = [];
    for (const [key, mapValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (typeof mapValue === "string") {
        entries.push([key, mapValue]);
      }
    }

    return Object.fromEntries(entries);
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
  }

  private normalizeUrlEntries(value: unknown): AdvancedBlockingUrlEntry[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const entries: AdvancedBlockingUrlEntry[] = [];

    for (const entry of value) {
      if (typeof entry === "string") {
        entries.push(entry);
        continue;
      }

      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }

      const data = entry as Record<string, unknown>;
      const url = typeof data.url === "string" ? data.url : undefined;
      if (!url) {
        continue;
      }

      const override: AdvancedBlockingUrlOverride = { url };

      if (typeof data.blockAsNxDomain === "boolean") {
        override.blockAsNxDomain = data.blockAsNxDomain;
      }

      if (Array.isArray(data.blockingAddresses)) {
        const addresses = data.blockingAddresses.filter(
          (address): address is string =>
            typeof address === "string" && address.length > 0,
        );
        if (addresses.length > 0) {
          override.blockingAddresses = addresses;
        }
      }

      entries.push(override);
    }

    return entries;
  }

  private calculateMetrics(
    config: AdvancedBlockingConfig,
  ): AdvancedBlockingMetrics {
    let blockedDomainCount = 0;
    let allowedDomainCount = 0;
    let blockListUrlCount = 0;
    let allowListUrlCount = 0;
    let adblockListUrlCount = 0;
    let allowedRegexCount = 0;
    let blockedRegexCount = 0;
    let regexAllowListUrlCount = 0;
    let regexBlockListUrlCount = 0;

    for (const group of config.groups) {
      blockedDomainCount += group.blocked.length;
      allowedDomainCount += group.allowed.length;
      blockListUrlCount += group.blockListUrls.length;
      allowListUrlCount += group.allowListUrls.length;
      adblockListUrlCount += group.adblockListUrls.length;
      allowedRegexCount += group.allowedRegex.length;
      blockedRegexCount += group.blockedRegex.length;
      regexAllowListUrlCount += group.regexAllowListUrls.length;
      regexBlockListUrlCount += group.regexBlockListUrls.length;
    }

    return {
      groupCount: config.groups.length,
      blockedDomainCount,
      allowedDomainCount,
      blockListUrlCount,
      allowListUrlCount,
      adblockListUrlCount,
      allowedRegexCount,
      blockedRegexCount,
      regexAllowListUrlCount,
      regexBlockListUrlCount,
      localEndpointMappingCount: Object.keys(config.localEndPointGroupMap)
        .length,
      networkMappingCount: Object.keys(config.networkGroupMap).length,
      scheduledNodeCount:
        typeof config.blockListUrlUpdateIntervalHours === "number" ||
        typeof config.blockListUrlUpdateIntervalMinutes === "number"
          ? 1
          : 0,
    };
  }

  private createEmptyConfig(): AdvancedBlockingConfig {
    return { localEndPointGroupMap: {}, networkGroupMap: {}, groups: [] };
  }

  private serializeConfig(
    config: AdvancedBlockingConfig,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      localEndPointGroupMap: { ...config.localEndPointGroupMap },
      networkGroupMap: { ...config.networkGroupMap },
      groups: config.groups.map((group) => {
        const groupPayload: Record<string, unknown> = {
          name: group.name,
          blockingAddresses: [...group.blockingAddresses],
          allowed: [...group.allowed],
          blocked: [...group.blocked],
          allowListUrls: this.cloneUrlEntries(group.allowListUrls),
          blockListUrls: this.cloneUrlEntries(group.blockListUrls),
          allowedRegex: [...group.allowedRegex],
          blockedRegex: [...group.blockedRegex],
          regexAllowListUrls: this.cloneUrlEntries(group.regexAllowListUrls),
          regexBlockListUrls: this.cloneUrlEntries(group.regexBlockListUrls),
          adblockListUrls: [...group.adblockListUrls],
        };

        if (group.enableBlocking !== undefined) {
          groupPayload.enableBlocking = group.enableBlocking;
        }

        if (group.allowTxtBlockingReport !== undefined) {
          groupPayload.allowTxtBlockingReport = group.allowTxtBlockingReport;
        }

        if (group.blockAsNxDomain !== undefined) {
          groupPayload.blockAsNxDomain = group.blockAsNxDomain;
        }

        return groupPayload;
      }),
    };

    if (config.enableBlocking !== undefined) {
      payload.enableBlocking = config.enableBlocking;
    }

    const blockingAnswerTtl = this.normalizeInteger(
      (config as unknown as Record<string, unknown>).blockingAnswerTtl,
    );
    if (blockingAnswerTtl !== undefined) {
      payload.blockingAnswerTtl = blockingAnswerTtl;
    }

    if (config.blockListUrlUpdateIntervalHours !== undefined) {
      payload.blockListUrlUpdateIntervalHours =
        config.blockListUrlUpdateIntervalHours;
    }

    if (config.blockListUrlUpdateIntervalMinutes !== undefined) {
      payload.blockListUrlUpdateIntervalMinutes =
        config.blockListUrlUpdateIntervalMinutes;
    }

    return payload;
  }

  private cloneUrlEntries(
    entries: AdvancedBlockingUrlEntry[],
  ): AdvancedBlockingUrlEntry[] {
    return entries.map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      const override: AdvancedBlockingUrlOverride = { url: entry.url };

      if (entry.blockAsNxDomain !== undefined) {
        override.blockAsNxDomain = entry.blockAsNxDomain;
      }

      if (entry.blockingAddresses) {
        override.blockingAddresses = [...entry.blockingAddresses];
      }

      return override;
    });
  }

  private combineMetrics(
    target: AdvancedBlockingMetrics,
    source: AdvancedBlockingMetrics,
  ): AdvancedBlockingMetrics {
    return {
      groupCount: target.groupCount + source.groupCount,
      blockedDomainCount: target.blockedDomainCount + source.blockedDomainCount,
      allowedDomainCount: target.allowedDomainCount + source.allowedDomainCount,
      blockListUrlCount: target.blockListUrlCount + source.blockListUrlCount,
      allowListUrlCount: target.allowListUrlCount + source.allowListUrlCount,
      adblockListUrlCount:
        target.adblockListUrlCount + source.adblockListUrlCount,
      allowedRegexCount: target.allowedRegexCount + source.allowedRegexCount,
      blockedRegexCount: target.blockedRegexCount + source.blockedRegexCount,
      regexAllowListUrlCount:
        target.regexAllowListUrlCount + source.regexAllowListUrlCount,
      regexBlockListUrlCount:
        target.regexBlockListUrlCount + source.regexBlockListUrlCount,
      localEndpointMappingCount:
        target.localEndpointMappingCount + source.localEndpointMappingCount,
      networkMappingCount:
        target.networkMappingCount + source.networkMappingCount,
      scheduledNodeCount: target.scheduledNodeCount + source.scheduledNodeCount,
    };
  }

  private emptyMetrics(): AdvancedBlockingMetrics {
    return {
      groupCount: 0,
      blockedDomainCount: 0,
      allowedDomainCount: 0,
      blockListUrlCount: 0,
      allowListUrlCount: 0,
      adblockListUrlCount: 0,
      allowedRegexCount: 0,
      blockedRegexCount: 0,
      regexAllowListUrlCount: 0,
      regexBlockListUrlCount: 0,
      localEndpointMappingCount: 0,
      networkMappingCount: 0,
      scheduledNodeCount: 0,
    };
  }

  /**
   * Get combined Advanced Blocking group configurations across all nodes
   * and compare group settings (not content) between nodes
   */
  async getCombinedAdvancedBlockingConfig(): Promise<AdvancedBlockingCombinedOverview> {
    const summaries = await this.technitiumService.listNodes();
    const snapshots = await Promise.all(
      summaries.map((summary) => this.getSnapshot(summary.id)),
    );

    // Build a map of groups by name across all nodes
    const groupsByName = new Map<string, Map<string, AdvancedBlockingGroup>>();

    for (const snapshot of snapshots) {
      if (!snapshot.config) {
        continue;
      }

      for (const group of snapshot.config.groups) {
        const normalizedName = group.name.toLowerCase();
        let entry = groupsByName.get(normalizedName);

        if (!entry) {
          entry = new Map<string, AdvancedBlockingGroup>();
          groupsByName.set(normalizedName, entry);
        }

        entry.set(snapshot.nodeId, group);
      }
    }

    // Compare groups across nodes
    const comparisons: AdvancedBlockingGroupComparison[] = [];

    for (const [normalizedName, groupsByNode] of groupsByName.entries()) {
      const sample = Array.from(groupsByNode.values())[0];
      const displayName = sample?.name ?? normalizedName;

      const status = this.determineGroupComparisonStatus(
        groupsByNode,
        snapshots,
      );
      const settingsDifferences = this.compareGroupSettings(groupsByNode);

      const sourceNodes = snapshots.map((snapshot) => ({
        nodeId: snapshot.nodeId,
        baseUrl: snapshot.baseUrl,
        group: groupsByNode.get(snapshot.nodeId),
      }));

      const targetNodes = snapshots.map((snapshot) => ({
        nodeId: snapshot.nodeId,
        baseUrl: snapshot.baseUrl,
        group: groupsByNode.get(snapshot.nodeId),
      }));

      comparisons.push({
        name: displayName,
        status,
        ...(settingsDifferences &&
          settingsDifferences.length > 0 && { settingsDifferences }),
        sourceNodes,
        targetNodes,
      });
    }

    // Sort by status priority and name
    const STATUS_PRIORITY: Record<
      AdvancedBlockingGroupComparisonStatus,
      number
    > = { different: 0, missing: 1, "in-sync": 2, unknown: 3 };

    comparisons.sort((a, b) => {
      const priorityDelta =
        STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    // Calculate aggregate group count
    const totalGroups = groupsByName.size;

    // Build node summaries
    const nodes = snapshots.map((snapshot) => ({
      nodeId: snapshot.nodeId,
      baseUrl: snapshot.baseUrl,
      fetchedAt: snapshot.fetchedAt,
      groupCount: snapshot.config?.groups.length,
      error: snapshot.error,
    }));

    return {
      fetchedAt: new Date().toISOString(),
      groupCount: totalGroups,
      nodes,
      groups: comparisons,
    };
  }

  /**
   * Determine if a group is in sync, different, or missing across nodes
   */
  private determineGroupComparisonStatus(
    groupsByNode: Map<string, AdvancedBlockingGroup>,
    snapshots: AdvancedBlockingSnapshot[],
  ): AdvancedBlockingGroupComparisonStatus {
    const nodeIds = new Set(snapshots.map((s) => s.nodeId));
    const presentNodeIds = new Set(groupsByNode.keys());

    // Group exists on some but not all nodes
    if (presentNodeIds.size < nodeIds.size) {
      return "missing";
    }

    // Check if settings differ across nodes
    const settingsDiffs = this.compareGroupSettings(groupsByNode);
    if (settingsDiffs && settingsDiffs.length > 0) {
      return "different";
    }

    return "in-sync";
  }

  /**
   * Compare group settings (not content) across nodes
   */
  private compareGroupSettings(
    groupsByNode: Map<string, AdvancedBlockingGroup>,
  ): AdvancedBlockingGroupSettingsDiff[] {
    const differences: AdvancedBlockingGroupSettingsDiff[] = [];

    if (groupsByNode.size === 0) {
      return differences;
    }

    // Get groups from each node
    const groups = Array.from(groupsByNode.values());
    if (groups.length < 2) {
      return differences; // Can't compare if only on one node
    }

    const referenceGroup = groups[0];

    // Settings to compare
    const settingsToCompare: (keyof AdvancedBlockingGroupSettings)[] = [
      "enableBlocking",
      "allowTxtBlockingReport",
      "blockAsNxDomain",
      "blockingAddresses",
    ];

    for (const setting of settingsToCompare) {
      const referenceValue = referenceGroup[setting];

      for (let i = 1; i < groups.length; i++) {
        const compareGroup = groups[i];
        const compareValue = compareGroup[setting];

        // Compare values (handle array comparison)
        if (!this.areSettingValuesEqual(referenceValue, compareValue)) {
          differences.push({
            field: setting,
            sourceValue: referenceValue,
            targetValue: compareValue,
          });
          break; // Only record one difference per field
        }
      }
    }

    return differences;
  }

  /**
   * Compare two setting values (handles arrays and primitives)
   */
  private areSettingValuesEqual(value1: unknown, value2: unknown): boolean {
    if (Array.isArray(value1) && Array.isArray(value2)) {
      if (value1.length !== value2.length) {
        return false;
      }
      const sorted1 = (value1 as unknown[]).slice().sort();
      const sorted2 = (value2 as unknown[]).slice().sort();
      return sorted1.every((v, i) => v === sorted2[i]);
    }

    return value1 === value2;
  }
}
