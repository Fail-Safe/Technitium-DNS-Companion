export interface TechnitiumNodeConfig {
  id: string;
  name?: string;
  baseUrl: string;
  token: string;
  queryLoggerAppName?: string;
  queryLoggerClassPath?: string;
}

export interface TechnitiumClusterState {
  initialized: boolean;
  domain?: string;
  dnsServerDomain?: string;
  type?: 'Primary' | 'Secondary' | 'Standalone';
  health?: 'Connected' | 'Unreachable' | 'Self';
}

export interface TechnitiumClusterSettings {
  heartbeatRefreshIntervalSeconds: number;
  heartbeatRetryIntervalSeconds: number;
  configRefreshIntervalSeconds: number;
  configRetryIntervalSeconds: number;
}

export interface TechnitiumNodeSummary {
  id: string;
  name?: string;
  baseUrl: string;
  hasAdvancedBlocking?: boolean;
  clusterState?: TechnitiumClusterState;
  isPrimary?: boolean; // True if this node is the Primary in the cluster
}

export interface TechnitiumAppInfo {
  name: string;
  version?: string;
  description?: string;
}

export interface TechnitiumNodeAppsResponse {
  nodeId: string;
  apps: TechnitiumAppInfo[];
  hasAdvancedBlocking: boolean;
  fetchedAt: string;
}

export interface TechnitiumNodeOverview {
  nodeId: string;
  version: string;
  uptime: number; // seconds
  totalZones: number;
  totalQueries: number; // last 24h
  totalBlockedQueries: number; // last 24h
  totalApps: number;
  hasAdvancedBlocking: boolean;
  fetchedAt: string;
}

export interface TechnitiumStatusEnvelope<T = unknown> {
  nodeId: string;
  fetchedAt: string;
  data: T;
}

export type TechnitiumActionCategory =
  | 'upstream'
  | 'zone'
  | 'dnsRecord'
  | 'reverseForwarder'
  | 'dhcpReservation'
  | 'ipSet'
  | 'nftSet'
  | 'advancedBlocking';

export interface TechnitiumActionPayload {
  method: 'GET' | 'POST';
  url: string;
  params?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface TechnitiumAction {
  id: string;
  category: TechnitiumActionCategory;
  summary: string;
  description?: string;
  details?: Record<string, unknown>;
  payload?: TechnitiumActionPayload;
  requiresReview?: boolean;
}

export type TechnitiumExecutionMode = 'dry-run' | 'apply';

export type TechnitiumActionExecutionStatus =
  | 'ready'
  | 'requires-review'
  | 'skipped'
  | 'success'
  | 'error';

export interface TechnitiumActionExecutionResult {
  action: TechnitiumAction;
  status: TechnitiumActionExecutionStatus;
  message?: string;
  response?: unknown;
}

export interface TechnitiumExecutionReport {
  nodeId: string;
  mode: TechnitiumExecutionMode;
  startedAt: string;
  completedAt: string;
  results: TechnitiumActionExecutionResult[];
}

export interface TechnitiumExecuteActionsRequest {
  mode: TechnitiumExecutionMode;
  actionIds?: string[];
}

export interface TechnitiumQueryLogFilters {
  pageNumber?: number;
  entriesPerPage?: number;
  descendingOrder?: boolean;
  start?: string;
  end?: string;
  clientIpAddress?: string;
  protocol?: string;
  responseType?: string;
  rcode?: string;
  qname?: string;
  qtype?: string;
  qclass?: string;
  deduplicateDomains?: boolean;
  disableCache?: boolean;
}

export interface TechnitiumDhcpLease {
  scope: string;
  type: string; // 'Reserved' | 'Dynamic'
  hardwareAddress: string;
  clientIdentifier?: string;
  address: string;
  hostName: string | null;
  leaseObtained: string;
  leaseExpires: string;
}

export interface TechnitiumDhcpLeaseList {
  leases: TechnitiumDhcpLease[];
}

// PTR Lookup Response
export interface TechnitiumPtrLookupResult {
  result?: {
    Answer?: Array<{
      Type?: string;
      RDATA?: {
        Domain?: string;
        domain?: string;
        value?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface TechnitiumQueryLogEntry {
  rowNumber?: number;
  timestamp?: string;
  clientIpAddress?: string;
  clientName?: string;
  protocol?: string;
  responseType?: string;
  rcode?: string;
  qname?: string;
  qtype?: string;
  qclass?: string;
  answer?: string;
  responseRtt?: number;
}

export interface TechnitiumQueryLogPage {
  pageNumber: number;
  totalPages: number;
  totalEntries: number;
  totalMatchingEntries: number;
  hasMorePages?: boolean; // True if we hit fetch limit and there might be more data
  entries: TechnitiumQueryLogEntry[];
}

export interface TechnitiumApiResponse<T> {
  status: 'ok' | 'error' | 'invalid-token';
  response?: T;
  errorMessage?: string;
  stackTrace?: string;
  innerErrorMessage?: string;
}

// Technitium DNS Settings API Response
export interface TechnitiumSettingsData {
  version?: string;
  serverVersion?: string;
  uptimestamp?: string;
  uptime?: string;
  [key: string]: unknown;
}

// Technitium Dashboard Stats API Response
export interface TechnitiumDashboardStatsData {
  stats?: {
    totalQueries?: number;
    totalBlocked?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface TechnitiumCombinedQueryLogEntry extends TechnitiumQueryLogEntry {
  nodeId: string;
  baseUrl: string;
}

export interface TechnitiumCombinedNodeLogSnapshot {
  nodeId: string;
  baseUrl: string;
  fetchedAt: string;
  totalEntries?: number;
  totalPages?: number;
  error?: string;
}

export interface TechnitiumCombinedQueryLogPage {
  fetchedAt: string;
  pageNumber: number;
  entriesPerPage: number;
  totalPages: number;
  totalEntries: number;
  totalMatchingEntries: number;
  hasMorePages?: boolean; // True if we hit fetch limit and there might be more data
  duplicatesRemoved?: number; // Number of duplicate entries removed by deduplication
  descendingOrder: boolean;
  entries: TechnitiumCombinedQueryLogEntry[];
  nodes: TechnitiumCombinedNodeLogSnapshot[];
}

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
  domainName?: string;
  domainSearchList?: string[];
  dnsUpdates?: boolean;
  dnsTtl?: number;
  serverAddress?: string | null;
  serverHostName?: string | null;
  bootFileName?: string | null;
  routerAddress?: string | null;
  useThisDnsServer?: boolean;
  dnsServers?: string[];
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

export type TechnitiumDhcpScopeOverrides = Partial<Omit<TechnitiumDhcpScope, 'name'>>;

export interface TechnitiumCloneDhcpScopeRequest {
  targetNodeId?: string;
  newScopeName?: string;
  overrides?: TechnitiumDhcpScopeOverrides;
  enableOnTarget?: boolean;
}

export interface TechnitiumCloneDhcpScopeResult {
  sourceNodeId: string;
  targetNodeId: string;
  sourceScopeName: string;
  targetScopeName: string;
  enabledOnTarget: boolean;
}

export interface TechnitiumUpdateDhcpScopeRequest {
  overrides?: TechnitiumDhcpScopeOverrides;
  enabled?: boolean;
}

export interface TechnitiumUpdateDhcpScopeResult {
  scope: TechnitiumDhcpScope;
  enabled: boolean;
}

export interface TechnitiumZoneSummary {
  name: string;
  type?: string;
  internal?: boolean;
  dnssecStatus?: string;
  soaSerial?: number;
  expiry?: string;
  isExpired?: boolean;
  syncFailed?: boolean;
  notifyFailed?: boolean;
  notifyFailedFor?: string[];
  lastModified?: string;
  disabled?: boolean;
  // Advanced configuration (from zones/options/get)
  zoneTransfer?: string;
  zoneTransferNetworkACL?: string[];
  zoneTransferTsigKeyNames?: string[];
  queryAccess?: string;
  queryAccessNetworkACL?: string[];
  notify?: string;
  notifyNameServers?: string[];
  primaryNameServerAddresses?: string[];
}

export interface TechnitiumZoneList {
  pageNumber?: number;
  totalPages?: number;
  totalZones?: number;
  zones: TechnitiumZoneSummary[];
}

export type TechnitiumZoneComparisonStatus = 'in-sync' | 'missing' | 'different' | 'unknown';

export interface TechnitiumZoneNodeState {
  nodeId: string;
  baseUrl: string;
  fetchedAt: string;
  zone?: TechnitiumZoneSummary;
  error?: string;
}

export interface TechnitiumZoneComparison {
  name: string;
  status: TechnitiumZoneComparisonStatus;
  differences?: string[];
  nodes: TechnitiumZoneNodeState[];
}

export interface TechnitiumCombinedZoneNodeSnapshot {
  nodeId: string;
  baseUrl: string;
  fetchedAt: string;
  totalZones?: number;
  modifiableZones?: number;
  error?: string;
}

export interface TechnitiumCombinedZoneOverview {
  fetchedAt: string;
  zoneCount: number;
  nodes: TechnitiumCombinedZoneNodeSnapshot[];
  zones: TechnitiumZoneComparison[];
}

export type DhcpBulkSyncStrategy = 'skip-existing' | 'overwrite-all' | 'merge-missing';

export interface DhcpBulkSyncRequest {
  sourceNodeId: string;
  targetNodeIds: string[];
  strategy: DhcpBulkSyncStrategy;
  scopeNames?: string[]; // Optional: sync only specific scopes
  enableOnTarget?: boolean;
}

export interface DhcpBulkSyncScopeResult {
  scopeName: string;
  status: 'synced' | 'skipped' | 'failed';
  reason?: string;
  error?: string;
}

export interface DhcpBulkSyncNodeResult {
  targetNodeId: string;
  status: 'success' | 'partial' | 'failed';
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
