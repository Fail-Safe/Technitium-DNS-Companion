export type PtrZonePlanStatus = "create-zone" | "zone-exists";
export type PtrRecordPlanStatus =
  | "create-record"
  | "update-record"
  | "already-correct"
  | "delete-record"
  | "conflict";

export type SplitHorizonPtrConflictReason =
  | "multiple-source-hostnames"
  | "multiple-existing-ptr-targets";

export interface SplitHorizonPtrPreviewRequest {
  zoneName: string;
  /**
   * Advanced: when true, the apply step may tag existing PTR records as "managed" by TDC.
   * This enables safe deletions for adopted records in future runs.
   * Default: false (safer).
   */
  adoptExistingPtrRecords?: boolean;
  /**
   * Prefix length used when computing reverse zones from IPv4 addresses.
   * Must be a multiple of 8 (e.g., 8, 16, 24).
   * Defaults to 24.
   */
  ipv4ZonePrefixLength?: number;
  /**
   * Prefix length used when computing reverse zones from IPv6 addresses.
   * Must be a multiple of 4 (nibble boundary).
   * Defaults to 64.
   */
  ipv6ZonePrefixLength?: number;
}

export type SplitHorizonPtrConflictPolicy = "skip" | "fail";

export interface SplitHorizonPtrSourceHostnameResolution {
  ip: string;
  hostname: string;
}

export interface SplitHorizonPtrApplyRequest extends SplitHorizonPtrPreviewRequest {
  /**
   * How to handle conflicts (e.g., multiple hostnames for a single IP, or multiple existing PTR targets).
   * - skip: do not write conflicting records
   * - fail: abort the apply request if any conflict exists
   */
  conflictPolicy?: SplitHorizonPtrConflictPolicy;

  /**
   * Optional Catalog zone name to register newly created reverse zones as member zones.
   * If provided, it must exist and be a Catalog zone on the target node.
   */
  catalogZoneName?: string;

  /**
   * Optional per-IP hostname selections for resolving "multiple-source-hostnames" conflicts.
   * When provided, matching conflict rows are treated as actionable (create/update) using the chosen hostname.
   */
  sourceHostnameResolutions?: SplitHorizonPtrSourceHostnameResolution[];

  /**
   * When true, performs all planning/validation but does not write to Technitium.
   * Useful for validating auth/permissions.
   */
  dryRun?: boolean;
}

export interface SplitHorizonPtrCatalogZoneCandidate {
  name: string;
  type: "Catalog" | "SecondaryCatalog";
}

export type SplitHorizonPtrApplyActionKind =
  | "create-zone"
  | "create-record"
  | "update-record"
  | "delete-record"
  | "skip-conflict"
  | "noop";

export interface SplitHorizonPtrApplyAction {
  kind: SplitHorizonPtrApplyActionKind;
  ok: boolean;
  message?: string;
  ip?: string;
  ptrZoneName?: string;
  ptrRecordFqdn?: string;
  /** The PTR target detected on the server before any write (when available). */
  currentTargetHostname?: string;
  targetHostname?: string;
}

export interface SplitHorizonPtrApplySummary {
  createdZones: number;
  createdRecords: number;
  updatedRecords: number;
  deletedRecords: number;
  skippedConflicts: number;
  noops: number;
  errors: number;
}

export interface SplitHorizonPtrApplyResponse {
  fetchedAt: string;
  /** Node chosen as the read/write source (Primary when clustered). */
  nodeId: string;
  zoneName: string;
  splitHorizonInstalled: boolean;
  dryRun: boolean;
  conflictPolicy: SplitHorizonPtrConflictPolicy;
  actions: SplitHorizonPtrApplyAction[];
  summary: SplitHorizonPtrApplySummary;
  warnings?: string[];
}

export interface SplitHorizonSimpleAddressSourceRecord {
  /** The forward-zone owner name of the APP record (hostname). */
  recordName: string;
  /** The raw rData.classPath (if present). */
  classPath?: string;
  /** IP addresses found in the JSON mapping values. */
  addresses: string[];
  /** Parse warnings specific to this record. */
  warnings?: string[];
}

export interface SplitHorizonPtrPlannedRecord {
  ip: string;
  ptrZoneName: string;
  /** Relative name within the PTR zone ("@" means zone apex). */
  ptrRecordName: string;
  targetHostname: string;
  status: PtrRecordPlanStatus;
  /** If status=conflict, the competing targets. */
  conflictTargets?: string[];
  /** If status=conflict, why it is a conflict. */
  conflictReason?: SplitHorizonPtrConflictReason;
}

export interface SplitHorizonPtrPlannedZone {
  zoneName: string;
  status: PtrZonePlanStatus;
  recordCount: number;
}

export interface SplitHorizonPtrPreviewResponse {
  fetchedAt: string;
  /** Node chosen as the read/write source (Primary when clustered). */
  nodeId: string;
  zoneName: string;
  splitHorizonInstalled: boolean;
  ipv4ZonePrefixLength: number;
  ipv6ZonePrefixLength: number;
  /** Catalog zones detected on the selected node (if any). */
  catalogZones?: SplitHorizonPtrCatalogZoneCandidate[];
  sourceRecords: SplitHorizonSimpleAddressSourceRecord[];
  plannedZones: SplitHorizonPtrPlannedZone[];
  plannedRecords: SplitHorizonPtrPlannedRecord[];
  warnings?: string[];
}

export interface SplitHorizonPtrSourceZoneCandidate {
  zoneName: string;
  recordCount: number;
}

export interface SplitHorizonPtrSourceZonesResponse {
  fetchedAt: string;
  /** Node chosen as the read/write source (Primary when clustered). */
  nodeId: string;
  splitHorizonInstalled: boolean;
  zones: SplitHorizonPtrSourceZoneCandidate[];
  warnings?: string[];
}
