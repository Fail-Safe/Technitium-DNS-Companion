import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import type {
    AdvancedBlockingCombinedOverview,
    AdvancedBlockingOverview,
    AdvancedBlockingSnapshot,
} from "./advanced-blocking.types";

type GroupRuleOptimizationSuggestionsResponse = {
  fetchedAt: string;
  nodeId: string;
  groupName: string;
  suggestions: Array<{
    id: string;
    nodeId: string;
    groupName: string;
    targetList: "allowedRegex" | "blockedRegex";
    kind:
      | "SAFE_TO_ZONE_DOMAIN_ENTRY"
      | "LIKELY_TO_ZONE_DOMAIN_ENTRY_EXPANDS_SCOPE"
      | "MANUAL_REVIEW_ZONE_CANDIDATE"
      | "PERF_WARNING";
    title: string;
    summary: string;
    regexPattern: string;
    proposedDomainEntry?: string;
    scopeExpansionRisk: boolean;
    details: string[];
    perfScore?: number;
    confidence: "safe" | "likely" | "warning";
    alternationHosts?: string[];
  }>;
};

type ValidateGroupRuleOptimizationResponse = {
  enabled: boolean;
  windowHours: number;
  limit: number;
  distinctDomainsAnalyzed: number;
  proposedDomainEntry: string;
  additionalMatchedDomainsCount: number;
  additionalMatchedDomainsExamples: Array<{ domain: string; count: number }>;
  note: string;
};

type ApplyGroupRuleOptimizationResponse = {
  snapshotTaken?: {
    id: string;
    createdAt: string;
    method: "rule-optimizer";
    note?: string;
  };
  updated: AdvancedBlockingSnapshot;
  applied: {
    groupName: string;
    targetList: "allowedRegex" | "blockedRegex";
    removedRegexPattern: string;
    addedDomainEntries: string[];
  };
};

@Controller("advanced-blocking")
export class AdvancedBlockingController {
  constructor(
    private readonly advancedBlockingService: AdvancedBlockingService,
  ) {}

  /**
   * Get Advanced Blocking configuration for a specific node
   * Used by DNS Lookup page to fetch groups for the Policy Simulator
   */
  @Get(":nodeId")
  async getNodeConfig(
    @Param("nodeId") nodeId: string,
  ): Promise<AdvancedBlockingSnapshot> {
    return this.advancedBlockingService.getSnapshot(nodeId);
  }

  /**
   * Get Advanced Blocking overview for all nodes
   */
  @Get()
  async getOverview(): Promise<AdvancedBlockingOverview> {
    return this.advancedBlockingService.getOverview();
  }

  /**
   * Get combined Advanced Blocking overview with group comparisons
   */
  @Get("combined/overview")
  async getCombinedOverview(): Promise<AdvancedBlockingCombinedOverview> {
    return this.advancedBlockingService.getCombinedAdvancedBlockingConfig();
  }

  /**
   * Rule optimization suggestions for Advanced Blocking group-level regex entries.
   *
   * Notes:
   * - This is for Advanced Blocking groups only (allowedRegex/blockedRegex arrays).
   * - Suggestions are labeled as SAFE vs LIKELY.
   * - Validation is intended to be driven by recent query logs (SQLite, when enabled).
   */
  @Get(":nodeId/rule-optimizations/groups/:groupName/suggestions")
  async getGroupRuleOptimizationSuggestions(
    @Param("nodeId") nodeId: string,
    @Param("groupName") groupName: string,
  ): Promise<GroupRuleOptimizationSuggestionsResponse> {
    return await this.advancedBlockingService.getGroupRuleOptimizationSuggestions(
      nodeId,
      groupName,
    );
  }

  /**
   * Validate a specific suggestion against recent query logs (aggregated and deduped by domain).
   *
   * Expected to report "expansion impact" (how many additional domains would match if converted
   * to a zone/domain entry), even when full .NET regex execution is not available.
   */
  @Post(":nodeId/rule-optimizations/groups/:groupName/validate")
  async validateGroupRuleOptimizationSuggestion(
    @Param("nodeId") nodeId: string,
    @Param("groupName") groupName: string,
    @Query("windowHours") windowHours?: string,
    @Query("limit") limit?: string,
    @Body() body?: unknown,
  ): Promise<ValidateGroupRuleOptimizationResponse> {
    const parsedWindowHours =
      typeof windowHours === "string" && windowHours.trim().length > 0 ?
        Number.parseInt(windowHours, 10)
      : undefined;

    const parsedLimit =
      typeof limit === "string" && limit.trim().length > 0 ?
        Number.parseInt(limit, 10)
      : undefined;

    return await this.advancedBlockingService.validateGroupRuleOptimizationSuggestion(
      nodeId,
      groupName,
      { windowHours: parsedWindowHours, limit: parsedLimit, payload: body },
    );
  }

  /**
   * Apply an accepted optimization.
   *
   * The backend should:
   * - take a DNS filtering snapshot before applying changes (advanced-blocking method),
   * - update Advanced Blocking config (remove regex, add allowed/blocked domain entry),
   * - return the updated snapshot and the snapshot metadata for rollback.
   */
  @Post(":nodeId/rule-optimizations/groups/:groupName/apply")
  async applyGroupRuleOptimization(
    @Param("nodeId") nodeId: string,
    @Param("groupName") groupName: string,
    @Body() body?: unknown,
  ): Promise<ApplyGroupRuleOptimizationResponse> {
    return await this.advancedBlockingService.applyGroupRuleOptimization(
      nodeId,
      groupName,
      body,
    );
  }
}
