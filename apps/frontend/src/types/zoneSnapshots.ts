export type ZoneSnapshotOrigin = "manual" | "automatic";

export interface ZoneSnapshotZoneEntry {
  zoneName: string;
  existed: boolean;
  zoneFile?: string;
}

export interface ZoneSnapshotMetadata {
  id: string;
  nodeId: string;
  createdAt: string;
  zoneCount: number;
  origin: ZoneSnapshotOrigin;
  pinned?: boolean;
  note?: string;
}

export interface ZoneSnapshot {
  metadata: ZoneSnapshotMetadata;
  zones: ZoneSnapshotZoneEntry[];
}

export interface ZoneSnapshotRestoreResult {
  snapshot: ZoneSnapshotMetadata;
  restored: number;
  deleted: number;
  skipped: number;
}

export interface ZoneSnapshotRestoreOptions {
  deleteZonesThatDidNotExist?: boolean;
  keepNewZones?: boolean; // UI convenience: maps to deleteZonesThatDidNotExist=false
  zoneNames?: string[];
}

export interface ZoneSnapshotCreateRequest {
  zones: string[];
  origin?: ZoneSnapshotOrigin;
  note?: string;
}
