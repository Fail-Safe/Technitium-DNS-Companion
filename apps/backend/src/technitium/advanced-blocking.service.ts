import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TechnitiumService } from './technitium.service';
import type { TechnitiumNodeSummary } from './technitium.types';
import type {
  AdvancedBlockingConfig,
  AdvancedBlockingGroup,
  AdvancedBlockingMetrics,
  AdvancedBlockingOverview,
  AdvancedBlockingSnapshot,
  AdvancedBlockingUrlEntry,
  AdvancedBlockingUrlOverride,
  AdvancedBlockingCombinedOverview,
  AdvancedBlockingGroupComparison,
  AdvancedBlockingGroupSettingsDiff,
  AdvancedBlockingGroupSettings,
  AdvancedBlockingGroupComparisonStatus,
} from './advanced-blocking.types';

interface TechnitiumAppConfigEnvelope {
  status?: string;
  response?: {
    config?: string | null;
  };
}

@Injectable()
export class AdvancedBlockingService {
  private static readonly APP_NAME_CANDIDATES = ['Advanced Blocking'] as const;
  private readonly logger = new Logger(AdvancedBlockingService.name);
  private readonly appNameByNode = new Map<string, string>();

  constructor(private readonly technitiumService: TechnitiumService) { }

  async getOverview(): Promise<AdvancedBlockingOverview> {
    const summaries = await this.technitiumService.listNodes();
    const snapshots = await Promise.all(summaries.map((summary) => this.loadSnapshot(summary)));
    const aggregate = snapshots.reduce(
      (acc, snapshot) => this.combineMetrics(acc, snapshot.metrics),
      this.emptyMetrics(),
    );

    return {
      fetchedAt: new Date().toISOString(),
      aggregate,
      nodes: snapshots,
    };
  }

  async getSnapshot(nodeId: string): Promise<AdvancedBlockingSnapshot> {
    const summaries = await this.technitiumService.listNodes();
    const summary = summaries.find((node) => node.id.toLowerCase() === nodeId.toLowerCase());

    if (!summary) {
      throw new NotFoundException(`Technitium DNS node "${nodeId}" is not configured.`);
    }

    return this.loadSnapshot(summary);
  }

  async setConfig(
    nodeId: string,
    config: AdvancedBlockingConfig,
  ): Promise<AdvancedBlockingSnapshot> {
    const serialized = this.serializeConfig(config);
    const body = new URLSearchParams();
    body.set('config', JSON.stringify(serialized, null, 2));

    const appNames = this.resolveAppNameCandidates(nodeId);
    let lastError: Error | undefined;

    for (const appName of appNames) {
      try {
        await this.technitiumService.executeAction(nodeId, {
          method: 'POST',
          url: '/api/apps/config/set',
          params: {
            name: appName,
          },
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });

        this.appNameByNode.set(nodeId, appName);
        return this.getSnapshot(nodeId);
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

    throw new Error('Failed to save Advanced Blocking config: no app names succeeded.');
  }

  private async loadSnapshot(summary: TechnitiumNodeSummary): Promise<AdvancedBlockingSnapshot> {
    const baseSnapshot: AdvancedBlockingSnapshot = {
      nodeId: summary.id,
      baseUrl: summary.baseUrl,
      fetchedAt: new Date().toISOString(),
      metrics: this.emptyMetrics(),
    };

    try {
      const { envelope, appName } = await this.fetchConfigWithFallback(summary.id);

      const rawConfig = envelope?.response?.config;
      if (!rawConfig) {
        const config = this.createEmptyConfig();
        const metrics = this.calculateMetrics(config);
        if (appName) {
          this.appNameByNode.set(summary.id, appName);
        }

        return {
          ...baseSnapshot,
          config,
          metrics,
        };
      }

      const config = this.parseConfig(rawConfig);
      const metrics = this.calculateMetrics(config);
      if (appName) {
        this.appNameByNode.set(summary.id, appName);
      }

      return {
        ...baseSnapshot,
        config,
        metrics,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to load Advanced Blocking config from node "${summary.id}": ${message}`,
      );
      return {
        ...baseSnapshot,
        error: message,
      };
    }
  }

  private async fetchConfigWithFallback(nodeId: string): Promise<{
    envelope: TechnitiumAppConfigEnvelope;
    appName?: string;
  }> {
    const appNames = this.resolveAppNameCandidates(nodeId);
    let lastError: Error | undefined;

    for (const appName of appNames) {
      try {
        const envelope = await this.technitiumService.executeAction<TechnitiumAppConfigEnvelope>(
          nodeId,
          {
            method: 'GET',
            url: '/api/apps/config/get',
            params: {
              name: appName,
            },
          },
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

    throw new Error('Unable to fetch Advanced Blocking config: no app names succeeded.');
  }

  private resolveAppNameCandidates(nodeId: string): string[] {
    const remembered = this.appNameByNode.get(nodeId);
    const candidates = [...AdvancedBlockingService.APP_NAME_CANDIDATES];
    if (!remembered) {
      return candidates;
    }

    return [remembered, ...candidates.filter((name) => name !== remembered)];
  }

  private parseConfig(rawConfig: string): AdvancedBlockingConfig {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawConfig) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`Unable to parse Advanced Blocking config JSON: ${(error as Error).message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Advanced Blocking config payload was not an object.');
    }

    const payload = parsed as Record<string, unknown>;
    const groups = Array.isArray(payload.groups)
      ? payload.groups
        .map((group) => this.normalizeGroup(group))
        .filter((group): group is AdvancedBlockingGroup => Boolean(group))
      : [];

    return {
      enableBlocking:
        typeof payload.enableBlocking === 'boolean' ? payload.enableBlocking : undefined,
      blockingAnswerTtl:
        typeof payload.blockingAnswerTtl === 'number'
          ? payload.blockingAnswerTtl
          : undefined,
      blockListUrlUpdateIntervalHours:
        typeof payload.blockListUrlUpdateIntervalHours === 'number'
          ? payload.blockListUrlUpdateIntervalHours
          : undefined,
      localEndPointGroupMap: this.normalizeMapping(payload.localEndPointGroupMap),
      networkGroupMap: this.normalizeMapping(payload.networkGroupMap),
      groups,
    };
  }

  private normalizeGroup(raw: unknown): AdvancedBlockingGroup | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return undefined;
    }

    const data = raw as Record<string, unknown>;
    const name = typeof data.name === 'string' ? data.name : undefined;
    if (!name) {
      return undefined;
    }

    return {
      name,
      enableBlocking: typeof data.enableBlocking === 'boolean' ? data.enableBlocking : undefined,
      allowTxtBlockingReport:
        typeof data.allowTxtBlockingReport === 'boolean' ? data.allowTxtBlockingReport : undefined,
      blockAsNxDomain: typeof data.blockAsNxDomain === 'boolean' ? data.blockAsNxDomain : undefined,
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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const entries: Array<[string, string]> = [];
    for (const [key, mapValue] of Object.entries(value as Record<string, unknown>)) {
      if (typeof mapValue === 'string') {
        entries.push([key, mapValue]);
      }
    }

    return Object.fromEntries(entries);
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  }

  private normalizeUrlEntries(value: unknown): AdvancedBlockingUrlEntry[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const entries: AdvancedBlockingUrlEntry[] = [];

    for (const entry of value) {
      if (typeof entry === 'string') {
        entries.push(entry);
        continue;
      }

      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }

      const data = entry as Record<string, unknown>;
      const url = typeof data.url === 'string' ? data.url : undefined;
      if (!url) {
        continue;
      }

      const override: AdvancedBlockingUrlOverride = { url };

      if (typeof data.blockAsNxDomain === 'boolean') {
        override.blockAsNxDomain = data.blockAsNxDomain;
      }

      if (Array.isArray(data.blockingAddresses)) {
        const addresses = data.blockingAddresses.filter(
          (address): address is string => typeof address === 'string' && address.length > 0,
        );
        if (addresses.length > 0) {
          override.blockingAddresses = addresses;
        }
      }

      entries.push(override);
    }

    return entries;
  }

  private calculateMetrics(config: AdvancedBlockingConfig): AdvancedBlockingMetrics {
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
      localEndpointMappingCount: Object.keys(config.localEndPointGroupMap).length,
      networkMappingCount: Object.keys(config.networkGroupMap).length,
      scheduledNodeCount: typeof config.blockListUrlUpdateIntervalHours === 'number' ? 1 : 0,
    };
  }

  private createEmptyConfig(): AdvancedBlockingConfig {
    return {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
    };
  }

  private serializeConfig(config: AdvancedBlockingConfig): Record<string, unknown> {
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

    if (config.blockListUrlUpdateIntervalHours !== undefined) {
      payload.blockListUrlUpdateIntervalHours = config.blockListUrlUpdateIntervalHours;
    }

    return payload;
  }

  private cloneUrlEntries(entries: AdvancedBlockingUrlEntry[]): AdvancedBlockingUrlEntry[] {
    return entries.map((entry) => {
      if (typeof entry === 'string') {
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
      adblockListUrlCount: target.adblockListUrlCount + source.adblockListUrlCount,
      allowedRegexCount: target.allowedRegexCount + source.allowedRegexCount,
      blockedRegexCount: target.blockedRegexCount + source.blockedRegexCount,
      regexAllowListUrlCount: target.regexAllowListUrlCount + source.regexAllowListUrlCount,
      regexBlockListUrlCount: target.regexBlockListUrlCount + source.regexBlockListUrlCount,
      localEndpointMappingCount:
        target.localEndpointMappingCount + source.localEndpointMappingCount,
      networkMappingCount: target.networkMappingCount + source.networkMappingCount,
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
    const snapshots = await Promise.all(summaries.map((summary) => this.getSnapshot(summary.id)));

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

      const status = this.determineGroupComparisonStatus(groupsByNode, snapshots);
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
        ...(settingsDifferences && settingsDifferences.length > 0 && { settingsDifferences }),
        sourceNodes,
        targetNodes,
      });
    }

    // Sort by status priority and name
    const STATUS_PRIORITY: Record<AdvancedBlockingGroupComparisonStatus, number> = {
      different: 0,
      missing: 1,
      'in-sync': 2,
      unknown: 3,
    };

    comparisons.sort((a, b) => {
      const priorityDelta = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
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
      return 'missing';
    }

    // Check if settings differ across nodes
    const settingsDiffs = this.compareGroupSettings(groupsByNode);
    if (settingsDiffs && settingsDiffs.length > 0) {
      return 'different';
    }

    return 'in-sync';
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
      'enableBlocking',
      'allowTxtBlockingReport',
      'blockAsNxDomain',
      'blockingAddresses',
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
