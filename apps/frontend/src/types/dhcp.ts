export interface TechnitiumDhcpScopeSummary {
  name: string;
  enabled?: boolean;
  startingAddress: string;
  endingAddress: string;
  subnetMask: string;
  networkAddress?: string;
  broadcastAddress?: string;
}

export interface TechnitiumDhcpScopeList {
  scopes: TechnitiumDhcpScopeSummary[];
}

export interface TechnitiumDhcpStaticRoute {
  destination: string;
  subnetMask: string;
  router: string;
}

export interface TechnitiumDhcpVendorInfo {
  identifier: string;
  information: string;
}

export interface TechnitiumDhcpGenericOption {
  code: number;
  value: string;
}

export interface TechnitiumDhcpExclusionRange {
  startingAddress: string;
  endingAddress: string;
}

export interface TechnitiumDhcpReservedLease {
  hostName: string | null;
  hardwareAddress: string;
  address: string;
  comments?: string | null;
}

export interface TechnitiumDhcpScope {
  name: string;
  startingAddress: string;
  endingAddress: string;
  subnetMask: string;
  leaseTimeDays?: number;
  leaseTimeHours?: number;
  leaseTimeMinutes?: number;
  offerDelayTime?: number;
  pingCheckEnabled?: boolean;
  pingCheckTimeout?: number;
  pingCheckRetries?: number;
  routerAddress?: string | null;
  dnsServers?: string[];
  domainName?: string;
  domainSearchList?: string[];
  dnsUpdates?: boolean;
  dnsTtl?: number;
  serverAddress?: string | null;
  serverHostName?: string | null;
  bootFileName?: string | null;
  useThisDnsServer?: boolean;
  winsServers?: string[];
  ntpServers?: string[];
  ntpServerDomainNames?: string[];
  staticRoutes?: TechnitiumDhcpStaticRoute[];
  vendorInfo?: TechnitiumDhcpVendorInfo[];
  capwapAcIpAddresses?: string[];
  tftpServerAddresses?: string[];
  genericOptions?: TechnitiumDhcpGenericOption[];
  exclusions?: TechnitiumDhcpExclusionRange[];
  reservedLeases?: TechnitiumDhcpReservedLease[];
  allowOnlyReservedLeases?: boolean;
  blockLocallyAdministeredMacAddresses?: boolean;
  ignoreClientIdentifierOption?: boolean;
}

export type TechnitiumDhcpScopeOverrides = Partial<
  Omit<TechnitiumDhcpScope, "name">
>;

export interface TechnitiumDhcpScopeListEnvelope {
  nodeId: string;
  fetchedAt: string;
  data: TechnitiumDhcpScopeList;
}

export interface TechnitiumDhcpScopeEnvelope {
  nodeId: string;
  fetchedAt: string;
  data: TechnitiumDhcpScope;
}

export interface TechnitiumCloneDhcpScopeRequest {
  targetNodeId?: string;
  newScopeName?: string;
  enableOnTarget?: boolean;
  preserveOfferDelayTime?: boolean;
  overrides?: TechnitiumDhcpScopeOverrides;
}

export interface TechnitiumCloneDhcpScopeResult {
  sourceNodeId: string;
  targetNodeId: string;
  sourceScopeName: string;
  targetScopeName: string;
  enabledOnTarget: boolean;
}

export interface TechnitiumRenameDhcpScopeRequest {
  newScopeName: string;
}

export interface TechnitiumRenameDhcpScopeResult {
  nodeId: string;
  sourceScopeName: string;
  targetScopeName: string;
  enabled: boolean;
}

export interface TechnitiumUpdateDhcpScopeRequest {
  overrides?: TechnitiumDhcpScopeOverrides;
  enabled?: boolean;
}

export interface TechnitiumUpdateDhcpScopeResult {
  scope: TechnitiumDhcpScope;
  enabled: boolean;
}

export interface TechnitiumUpdateDhcpScopeEnvelope {
  nodeId: string;
  fetchedAt: string;
  data: TechnitiumUpdateDhcpScopeResult;
}

export interface TechnitiumCreateDhcpScopeRequest {
  scope: TechnitiumDhcpScope;
  enabled?: boolean;
}

export type TechnitiumCreateDhcpScopeResult = TechnitiumUpdateDhcpScopeResult;

export interface TechnitiumCreateDhcpScopeEnvelope {
  nodeId: string;
  fetchedAt: string;
  data: TechnitiumCreateDhcpScopeResult;
}

export type DhcpBulkSyncStrategy =
  | "skip-existing"
  | "overwrite-all"
  | "merge-missing";

export interface DhcpBulkSyncRequest {
  sourceNodeId: string;
  targetNodeIds: string[];
  strategy: DhcpBulkSyncStrategy;
  scopeNames?: string[]; // Optional: sync only specific scopes
  enableOnTarget?: boolean;
  preserveOfferDelayTime?: boolean;
}

export interface DhcpBulkSyncScopeResult {
  scopeName: string;
  status: "synced" | "skipped" | "failed";
  reason?: string;
  differences?: string[];
  error?: string;
}

export interface DhcpBulkSyncNodeResult {
  targetNodeId: string;
  status: "success" | "partial" | "failed";
  scopeResults: DhcpBulkSyncScopeResult[];
  syncedCount: number;
  skippedCount: number;
  failedCount: number;
}

export interface DhcpBulkSyncResult {
  sourceNodeId: string;
  nodeResults: DhcpBulkSyncNodeResult[];
  totalSynced: number;
  totalSkipped: number;
  totalFailed: number;
  completedAt: string;
}

export type DhcpDnsSyncRecordStatus =
  | "create-record"
  | "update-record"
  | "delete-record"
  | "already-correct"
  | "conflict"
  | "missing-zone"
  | "skipped";

export type DhcpDnsSyncRecordKind = "forward" | "reverse";

export interface DhcpDnsSyncSourceScope {
  nodeId: string;
  scopeName: string;
}

export interface DhcpDnsSyncPreviewRequest {
  sourceScopes: DhcpDnsSyncSourceScope[];
  forwardZoneName?: string;
  includeReverse?: boolean;
  ttl?: number;
  staleGraceSeconds?: number;
}

export interface DhcpDnsSyncDefaults {
  includeReverse: boolean;
  ttl: number;
  staleGraceSeconds: number;
}

export interface DhcpDnsSyncApplyRequest extends DhcpDnsSyncPreviewRequest {
  dryRun?: boolean;
}

export interface DhcpDnsSyncPlannedRecord {
  kind: DhcpDnsSyncRecordKind;
  status: DhcpDnsSyncRecordStatus;
  sourceNodeId: string;
  scopeName: string;
  hostname?: string;
  ip?: string;
  hardwareAddress?: string;
  zoneName: string;
  recordName: string;
  recordType: "A" | "AAAA" | "PTR";
  currentValue?: string;
  desiredValue?: string;
  message?: string;
}

export interface DhcpDnsSyncScopeIssue {
  severity: "error" | "warn" | "info";
  sourceNodeId: string;
  scopeName: string;
  message: string;
}

export interface DhcpDnsSyncSummary {
  createRecords: number;
  updateRecords: number;
  deleteRecords: number;
  alreadyCorrect: number;
  conflicts: number;
  missingZones: number;
  skipped: number;
  errors: number;
}

export interface DhcpDnsSyncPreviewResponse {
  fetchedAt: string;
  targetNodeId: string;
  sourceScopes: DhcpDnsSyncSourceScope[];
  includeReverse: boolean;
  ttl: number;
  staleGraceSeconds: number;
  scopeIssues: DhcpDnsSyncScopeIssue[];
  plannedRecords: DhcpDnsSyncPlannedRecord[];
  summary: DhcpDnsSyncSummary;
}

export interface DhcpDnsSyncAction {
  kind: DhcpDnsSyncRecordKind;
  status: DhcpDnsSyncRecordStatus;
  ok: boolean;
  zoneName: string;
  recordName: string;
  recordType: "A" | "AAAA" | "PTR";
  currentValue?: string;
  desiredValue?: string;
  message?: string;
}

export interface DhcpDnsSyncApplyResponse extends DhcpDnsSyncPreviewResponse {
  dryRun: boolean;
  actions: DhcpDnsSyncAction[];
}

export type DhcpSnapshotOrigin = "manual" | "automatic";

export interface DhcpSnapshotMetadata {
  id: string;
  nodeId: string;
  createdAt: string;
  scopeCount: number;
  origin: DhcpSnapshotOrigin;
  pinned?: boolean;
  note?: string;
}

export interface DhcpSnapshotScopeEntry {
  scope: TechnitiumDhcpScope;
  enabled?: boolean;
}

export interface DhcpSnapshot {
  metadata: DhcpSnapshotMetadata;
  scopes: DhcpSnapshotScopeEntry[];
}

export interface DhcpSnapshotRestoreResult {
  snapshot: DhcpSnapshotMetadata;
  restored: number;
  deleted: number;
}

export interface DhcpSnapshotRestoreOptions {
  deleteExtraScopes?: boolean;
  keepExtras?: boolean; // UI convenience: maps to deleteExtraScopes=false
}
