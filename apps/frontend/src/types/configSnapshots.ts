import type { AdvancedBlockingConfig } from "./advancedBlocking";
import type { BlockingSettings } from "./builtInBlocking";

export type ConfigSnapshotOrigin = "manual" | "automatic" | "rule-optimization";
export type ConfigSnapshotMethod =
  | "built-in"
  | "advanced-blocking"
  | "rule-optimizer";

export interface ConfigSnapshotMetadata {
  id: string;
  nodeId: string;
  createdAt: string;
  origin: ConfigSnapshotOrigin;
  method: ConfigSnapshotMethod;
  pinned?: boolean;
  note?: string;
  allowedCount?: number;
  blockedCount?: number;
  groupCount?: number;
}

export interface ConfigBuiltInSnapshotData {
  settings: BlockingSettings;
  allowedDomains: string[];
  blockedDomains: string[];
}

export interface ConfigAdvancedBlockingSnapshotData {
  config: AdvancedBlockingConfig;
}

export interface ConfigSnapshot {
  metadata: ConfigSnapshotMetadata;
  builtIn?: ConfigBuiltInSnapshotData;
  advancedBlocking?: ConfigAdvancedBlockingSnapshotData;
}

export interface ConfigSnapshotRestoreResult {
  snapshot: ConfigSnapshotMetadata;
  restoredAllowed: number;
  restoredBlocked: number;
  restoredGroups: number;
}
