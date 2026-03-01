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

export interface DomainGroupsStatus {
  enabled: boolean;
  ready: boolean;
  dbPath?: string;
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
