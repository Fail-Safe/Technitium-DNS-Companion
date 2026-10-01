export type AdvancedBlockingPauseTargetStatus =
  | "activation-pending"
  | "active"
  | "resume-pending";

export interface AdvancedBlockingPauseTarget {
  writeTargetNodeId: string;
  status: AdvancedBlockingPauseTargetStatus;
  expiresAt: string;
  captureBeforeWrite?: boolean;
  previousEnableBlockingPresent?: boolean;
  previousEnableBlockingValue?: boolean;
  lastError?: string;
  updatedAt: string;
}

export interface AdvancedBlockingPauseStatus {
  paused: boolean;
  confirmedPausedTargetCount: number;
  pendingTargetCount: number;
  targets: AdvancedBlockingPauseTarget[];
  probeErrors?: Array<{ nodeId: string; error: string }>;
}
