export type ConfigSyncTargetStatus = "in-sync" | "synced" | "failed";

export interface ConfigSyncTargetResult {
  nodeId: string;
  status: ConfigSyncTargetStatus;
  error?: string;
}

export interface ConfigSyncRunResult {
  startedAt: string;
  completedAt: string;
  sourceNodeId: string;
  targets: ConfigSyncTargetResult[];
  notificationError?: string;
}

export interface ConfigSyncSchedulerStatus {
  enabled: boolean;
  configured: boolean;
  running: boolean;
  intervalMinutes: number;
  sourceNodeId?: string;
  targetNodeIds: string[];
  notificationRecipientCount: number;
  nextRunAt?: string;
  lastRun?: ConfigSyncRunResult;
}
