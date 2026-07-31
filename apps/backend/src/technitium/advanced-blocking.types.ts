export interface AdvancedBlockingUrlOverride {
  url: string;
  blockAsNxDomain?: boolean;
  blockingAddresses?: string[];
}

export type AdvancedBlockingUrlEntry = string | AdvancedBlockingUrlOverride;

export interface AdvancedBlockingGroup {
  name: string;
  enableBlocking?: boolean;
  allowTxtBlockingReport?: boolean;
  blockAsNxDomain?: boolean;
  blockingAddresses: string[];
  allowed: string[];
  blocked: string[];
  allowListUrls: AdvancedBlockingUrlEntry[];
  blockListUrls: AdvancedBlockingUrlEntry[];
  allowedRegex: string[];
  blockedRegex: string[];
  regexAllowListUrls: AdvancedBlockingUrlEntry[];
  regexBlockListUrls: AdvancedBlockingUrlEntry[];
  adblockListUrls: string[];
}

export interface AdvancedBlockingConfig {
  enableBlocking?: boolean;
  blockingAnswerTtl?: number;
  blockListUrlUpdateIntervalHours?: number;
  blockListUrlUpdateIntervalMinutes?: number;
  localEndPointGroupMap: Record<string, string>;
  networkGroupMap: Record<string, string>;
  groups: AdvancedBlockingGroup[];
}

export interface AdvancedBlockingMetrics {
  groupCount: number;
  blockedDomainCount: number;
  allowedDomainCount: number;
  blockListUrlCount: number;
  allowListUrlCount: number;
  adblockListUrlCount: number;
  allowedRegexCount: number;
  blockedRegexCount: number;
  regexAllowListUrlCount: number;
  regexBlockListUrlCount: number;
  localEndpointMappingCount: number;
  networkMappingCount: number;
  scheduledNodeCount: number;
}

export interface AdvancedBlockingSnapshot {
  nodeId: string;
  baseUrl: string;
  fetchedAt: string;
  metrics: AdvancedBlockingMetrics;
  configRevision?: string;
  config?: AdvancedBlockingConfig;
  error?: string;
}

export interface AdvancedBlockingOverview {
  fetchedAt: string;
  aggregate: AdvancedBlockingMetrics;
  nodes: AdvancedBlockingSnapshot[];
}

export interface AdvancedBlockingUpdateRequest {
  config: AdvancedBlockingConfig;
  configRevision?: string;
  configNodeId?: string;
  commentMutations?: AdvancedBlockingCommentMutation[];
  snapshotNote?: string;
  cacheDomain?: string;
}

export type AdvancedBlockingDomainListField =
  | "allowed"
  | "blocked"
  | "allowedRegex"
  | "blockedRegex";

export interface AdvancedBlockingDomainComment {
  id: string;
  groupName: string;
  field: AdvancedBlockingDomainListField;
  value: string;
  occurrence: number;
  placement: "leading" | "trailing";
  style: "line" | "block";
  text: string;
  raw: string;
}

export interface AdvancedBlockingRawConfig {
  nodeId: string;
  rawConfig: string;
  configRevision: string;
  domainComments: AdvancedBlockingDomainComment[];
  snapshot?: AdvancedBlockingSnapshot;
}

export interface AdvancedBlockingRawConfigUpdateRequest {
  rawConfig: string;
  configRevision: string;
}

export type AdvancedBlockingCommentMutation =
  | {
      action: "add";
      groupName: string;
      field: AdvancedBlockingDomainListField;
      value: string;
      occurrence: number;
      text: string;
      style?: "line" | "block";
    }
  | {
      action: "edit";
      commentId: string;
      text: string;
    }
  | {
      action: "remove";
      commentId: string;
    };

export type AdvancedBlockingCommentMutationRequest =
  AdvancedBlockingCommentMutation & {
    configRevision: string;
  };

/**
 * Settings for an Advanced Blocking group (excludes content like domains, URLs)
 */
export interface AdvancedBlockingGroupSettings {
  enableBlocking?: boolean;
  allowTxtBlockingReport?: boolean;
  blockAsNxDomain?: boolean;
  blockingAddresses: string[];
}

/**
 * Differences in group settings between two nodes
 */
export interface AdvancedBlockingGroupSettingsDiff {
  field: keyof AdvancedBlockingGroupSettings;
  sourceValue: unknown;
  targetValue: unknown;
}

/**
 * Comparison status for Advanced Blocking groups
 */
export type AdvancedBlockingGroupComparisonStatus =
  | "in-sync"
  | "different"
  | "missing"
  | "unknown";

/**
 * Full comparison of a group between nodes (settings + content)
 */
export interface AdvancedBlockingGroupComparison {
  name: string;
  status: AdvancedBlockingGroupComparisonStatus;
  settingsDifferences?: AdvancedBlockingGroupSettingsDiff[];
  sourceNodes: {
    nodeId: string;
    baseUrl: string;
    group?: AdvancedBlockingGroup;
  }[];
  targetNodes: {
    nodeId: string;
    baseUrl: string;
    group?: AdvancedBlockingGroup;
  }[];
  error?: string;
}

/**
 * Node snapshot for combined Advanced Blocking overview
 */
export interface AdvancedBlockingCombinedNodeSnapshot {
  nodeId: string;
  baseUrl: string;
  fetchedAt: string;
  groupCount?: number;
  error?: string;
}

/**
 * Combined overview of Advanced Blocking across all nodes
 */
export interface AdvancedBlockingCombinedOverview {
  fetchedAt: string;
  groupCount: number;
  nodes: AdvancedBlockingCombinedNodeSnapshot[];
  groups: AdvancedBlockingGroupComparison[];
}
