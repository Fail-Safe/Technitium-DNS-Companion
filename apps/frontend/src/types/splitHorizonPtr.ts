export type PtrZonePlanStatus = "create-zone" | "zone-exists";
export type PtrRecordPlanStatus =
  | "create-record"
  | "update-record"
  | "already-correct"
  | "conflict";

export type SplitHorizonPtrConflictReason =
  | "multiple-source-hostnames"
  | "multiple-existing-ptr-targets";

export interface SplitHorizonPtrCatalogZoneCandidate {
  name: string;
  type: "Catalog" | "SecondaryCatalog";
}

export interface SplitHorizonPtrPlannedZone {
  zoneName: string;
  status: PtrZonePlanStatus;
  recordCount: number;
}

export interface SplitHorizonPtrPlannedRecord {
  ip: string;
  ptrZoneName: string;
  ptrRecordName: string;
  targetHostname: string;
  status: PtrRecordPlanStatus;
  conflictTargets?: string[];
  conflictReason?: SplitHorizonPtrConflictReason;
}

export interface SplitHorizonSimpleAddressSourceRecord {
  recordName: string;
  classPath?: string;
  addresses: string[];
  warnings?: string[];
}

export interface SplitHorizonPtrPreviewResponse {
  fetchedAt: string;
  nodeId: string;
  zoneName: string;
  splitHorizonInstalled: boolean;
  ipv4ZonePrefixLength: number;
  ipv6ZonePrefixLength: number;
  catalogZones?: SplitHorizonPtrCatalogZoneCandidate[];
  sourceRecords: SplitHorizonSimpleAddressSourceRecord[];
  plannedZones: SplitHorizonPtrPlannedZone[];
  plannedRecords: SplitHorizonPtrPlannedRecord[];
  warnings?: string[];
}

export type SplitHorizonPtrConflictPolicy = "skip" | "fail";

export interface SplitHorizonPtrApplySummary {
  createdZones: number;
  createdRecords: number;
  updatedRecords: number;
  skippedConflicts: number;
  noops: number;
  errors: number;
}

export type SplitHorizonPtrApplyActionKind =
  | "create-zone"
  | "create-record"
  | "update-record"
  | "skip-conflict"
  | "noop";

export interface SplitHorizonPtrApplyAction {
  kind: SplitHorizonPtrApplyActionKind;
  ok: boolean;
  message?: string;
  ip?: string;
  ptrZoneName?: string;
  ptrRecordFqdn?: string;
  currentTargetHostname?: string;
  targetHostname?: string;
}

export interface SplitHorizonPtrApplyResponse {
  fetchedAt: string;
  nodeId: string;
  zoneName: string;
  splitHorizonInstalled: boolean;
  dryRun: boolean;
  conflictPolicy: SplitHorizonPtrConflictPolicy;
  actions: SplitHorizonPtrApplyAction[];
  summary: SplitHorizonPtrApplySummary;
  warnings?: string[];
}

export interface SplitHorizonPtrSourceZoneCandidate {
  zoneName: string;
  recordCount: number;
}

export interface SplitHorizonPtrSourceZonesResponse {
  fetchedAt: string;
  nodeId: string;
  splitHorizonInstalled: boolean;
  zones: SplitHorizonPtrSourceZoneCandidate[];
  warnings?: string[];
}
