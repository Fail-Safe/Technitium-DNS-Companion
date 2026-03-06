export type DomainGroupEntryMatchType = "exact" | "regex";

export type DomainGroupBindingAction = "allow" | "block";

export interface DomainGroup {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainGroupEntry {
  id: string;
  domainGroupId: string;
  matchType: DomainGroupEntryMatchType;
  value: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DomainGroupBinding {
  id: string;
  domainGroupId: string;
  advancedBlockingGroupName: string;
  action: DomainGroupBindingAction;
  createdAt: string;
  updatedAt: string;
}

export interface DomainGroupDetails extends DomainGroup {
  entries: DomainGroupEntry[];
  bindings: DomainGroupBinding[];
}

export interface DomainGroupOwnedPair {
  advancedBlockingGroupName: string;
  action: DomainGroupBindingAction;
}

export interface DomainGroupTrackedPair {
  advancedBlockingGroupName: string;
  action: DomainGroupBindingAction;
  values: string[]; // entries last written to Technitium via Apply
}

export interface DomainGroupBindingSummary {
  bindingId: string;
  domainGroupId: string;
  domainGroupName: string;
  advancedBlockingGroupName: string;
  action: DomainGroupBindingAction;
}

export interface DomainGroupConflict {
  advancedBlockingGroupName: string;
  matchType: DomainGroupEntryMatchType;
  value: string;
  actions: DomainGroupBindingAction[];
  domainGroupIds: string[];
  domainGroupNames: string[];
}

export interface DomainGroupMaterializedGroup {
  advancedBlockingGroupName: string;
  allowed: string[];
  blocked: string[];
  allowedRegex: string[];
  blockedRegex: string[];
}

export interface DomainGroupMaterializationPreview {
  generatedAt: string;
  hasConflicts: boolean;
  conflicts: DomainGroupConflict[];
  groups: DomainGroupMaterializedGroup[];
  ownedPairs: DomainGroupOwnedPair[];
  pendingPairs: DomainGroupOwnedPair[];
  allBindings: DomainGroupBindingSummary[];
  trackedGroups: DomainGroupTrackedPair[];
}

export interface DomainGroupsStatus {
  enabled: boolean;
  ready: boolean;
  dbPath?: string;
}

export interface DomainGroupsApplyRequest {
  nodeIds?: string[];
  dryRun?: boolean;
}

export interface DomainGroupsApplyNodeResult {
  nodeId: string;
  updatedGroups: string[];
  skippedGroups: string[];
  error?: string;
}

export interface DomainGroupsApplyResult {
  generatedAt: string;
  dryRun: boolean;
  appliedNodeIds: string[];
  skippedNodeIds: string[];
  conflicts: DomainGroupConflict[];
  nodes: DomainGroupsApplyNodeResult[];
}

// === Unified Export ===
export interface UnifiedExportAbGroup {
  blockDomains: string[];
  allowDomains: string[];
  blockRegex: string[];
  allowRegex: string[];
  blockDomainGroups: string[];
  allowDomainGroups: string[];
}

export interface UnifiedExportDgEntry {
  value: string;
  type: "exact" | "regex";
  note?: string;
}

export interface UnifiedExportDg {
  description?: string;
  entries: UnifiedExportDgEntry[];
}

export interface UnifiedExportData {
  groups: Record<string, UnifiedExportAbGroup>;
  domainGroups: Record<string, UnifiedExportDg>;
}

// === Unified Import ===
export type UnifiedImportDomainsMode = "skip" | "merge" | "replace";
export type UnifiedImportDomainGroupsMode = "merge" | "replace";

export interface UnifiedImportRequest {
  nodeId?: string;
  domainsMode: UnifiedImportDomainsMode;
  domainGroupsMode: UnifiedImportDomainGroupsMode;
  data: {
    groups?: Record<
      string,
      {
        blockDomains?: string[];
        allowDomains?: string[];
        blockRegex?: string[];
        allowRegex?: string[];
        blockDomainGroups?: string[];
        allowDomainGroups?: string[];
      }
    >;
    domainGroups?: Record<
      string,
      {
        description?: string;
        entries?: Array<{ value: string; type?: string; note?: string }>;
      }
    >;
  };
}

export interface UnifiedImportResult {
  domains: {
    mode: UnifiedImportDomainsMode;
    groupsUpdated: string[];
    groupsSkipped: string[];
    errors: Array<{ group: string; error: string }>;
  };
  domainGroups: {
    mode: UnifiedImportDomainGroupsMode;
    created: string[];
    updated: string[];
    replaced: string[];
    skipped: string[];
    errors: Array<{ name: string; error: string }>;
  };
}
