export type AdvancedBlockingPauseTargetStatus =
  | "activation-pending"
  | "active"
  | "resume-pending";

export interface AdvancedBlockingPauseTarget {
  /** Stable cluster/group ownership key, not a transient Primary node ID. */
  writeTargetNodeId: string;
  anchorNodeId: string;
  lastResolvedNodeId?: string;
  status: AdvancedBlockingPauseTargetStatus;
  expiresAt: string;
  captureBeforeWrite?: boolean;
  previousEnableBlockingPresent?: boolean;
  previousEnableBlockingValue?: boolean;
  lastError?: string;
  updatedAt: string;
}

export interface AdvancedBlockingPauseStatus {
  /** True only for a durable pause whose live state is confirmed. */
  paused: boolean;
  confirmedPausedTargetCount: number;
  pendingTargetCount: number;
  targets: AdvancedBlockingPauseTarget[];
  probeErrors?: Array<{ nodeId: string; error: string }>;
}

export interface AdvancedBlockingPauseOperationResult extends AdvancedBlockingPauseStatus {
  requestedMinutes?: number;
}
