export type TechnitiumZoneStatus =
  | "in-sync"
  | "missing"
  | "different"
  | "unknown";

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

export interface TechnitiumZoneListEnvelope {
  nodeId: string;
  fetchedAt: string;
  data: TechnitiumZoneList;
}

export interface TechnitiumZoneNodeState {
  nodeId: string;
  baseUrl: string;
  fetchedAt: string;
  zone?: TechnitiumZoneSummary;
  error?: string;
}

export interface TechnitiumZoneComparison {
  name: string;
  status: TechnitiumZoneStatus;
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

export interface TechnitiumZoneRecord {
  disabled?: boolean;
  name: string;
  type: string;
  ttl?: number;
  rData?: Record<string, unknown>;
  dnssecStatus?: string;
  comments?: string;
  expiryTtl?: number;
  lastUsedOn?: string;
}

export interface TechnitiumZoneRecordsNodeSnapshot {
  nodeId: string;
  baseUrl: string;
  fetchedAt: string;
  zone?: TechnitiumZoneSummary;
  records?: TechnitiumZoneRecord[];
  error?: string;
}

export interface TechnitiumCombinedZoneRecordsOverview {
  fetchedAt: string;
  zoneName: string;
  nodes: TechnitiumZoneRecordsNodeSnapshot[];
}
