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

export interface DhcpDnsSyncDefaultsResponse {
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

export interface DhcpDnsSyncApplyResponse extends DhcpDnsSyncPreviewResponse {
  dryRun: boolean;
  actions: DhcpDnsSyncAction[];
}
