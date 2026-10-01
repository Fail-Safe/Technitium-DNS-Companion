import type { AdvancedBlockingPauseStatus } from "../types/advancedBlockingPause";

// An expired row can still be active/activation-pending when topology resolution
// fails before the reconciler reaches the restore step.
export function getPauseRecoveryTargets(
  status: AdvancedBlockingPauseStatus | undefined,
  now: number,
) {
  return (status?.targets ?? []).filter(
    (target) =>
      target.status === "resume-pending" || Date.parse(target.expiresAt) <= now,
  );
}
