import type { AdvancedBlockingConfig } from "./advancedBlocking";
import type { BlockingSettings } from "./builtInBlocking";

export type DnsFilteringSnapshotOrigin = "manual" | "automatic";
export type DnsFilteringSnapshotMethod = "built-in" | "advanced-blocking";

export interface DnsFilteringSnapshotMetadata {
  id: string;
  nodeId: string;
  createdAt: string;
  origin: DnsFilteringSnapshotOrigin;
  method: DnsFilteringSnapshotMethod;
  pinned?: boolean;
  note?: string;
  allowedCount?: number;
  blockedCount?: number;
  groupCount?: number;
}

export interface DnsFilteringBuiltInSnapshotData {
  settings: BlockingSettings;
  allowedDomains: string[];
  blockedDomains: string[];
}

export interface DnsFilteringAdvancedBlockingSnapshotData {
  config: AdvancedBlockingConfig;
}

export interface DnsFilteringSnapshot {
  metadata: DnsFilteringSnapshotMetadata;
  builtIn?: DnsFilteringBuiltInSnapshotData;
  advancedBlocking?: DnsFilteringAdvancedBlockingSnapshotData;
}

export interface DnsFilteringSnapshotRestoreResult {
  snapshot: DnsFilteringSnapshotMetadata;
  restoredAllowed: number;
  restoredBlocked: number;
  restoredGroups: number;
}
