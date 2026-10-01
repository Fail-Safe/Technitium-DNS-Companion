import { useEffect, useState } from "react";
import { useOptionalTechnitiumState } from "../../context/useTechnitiumState";
import { getPauseRecoveryTargets } from "../../utils/advanced-blocking-recovery";

export function AdvancedBlockingRecoveryBanner() {
  const technitium = useOptionalTechnitiumState();
  const pause = technitium?.advancedBlockingPause;
  const [now, setNow] = useState(() => Date.now());
  const hasOwnership = (pause?.targets.length ?? 0) > 0;
  useEffect(() => {
    if (!hasOwnership) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasOwnership]);
  const targets = getPauseRecoveryTargets(pause, now);
  if (!targets.length) return null;
  const failed = targets.some((target) => target.lastError);
  return (
    <section
      className={`advanced-blocking-recovery${failed ? " advanced-blocking-recovery--error" : ""}`}
      role={failed ? "alert" : "status"}
      aria-label="Advanced Blocking recovery"
    >
      <strong>
        {failed
          ? "Advanced Blocking resume failed."
          : "Advanced Blocking resume is not yet confirmed."}{" "}
        Blocking may still be disabled.
      </strong>
      <ul>
        {targets.map((target) => (
          <li key={target.writeTargetNodeId}>
            <strong>{target.writeTargetNodeId}</strong>:{" "}
            {target.lastError ?? "Waiting for confirmed restoration."}
          </li>
        ))}
      </ul>
      <p>
        Check the affected target's connectivity and DNS Schedules credentials.
        The schedule token must have Apps: Modify on the current Primary.
      </p>
      <p>
        Companion will keep retrying. After resolving the cause, use Resume now
        in the header to retry immediately. This warning clears when restoration
        is confirmed, or a newly admitted pause replaces the resume request.
      </p>
    </section>
  );
}
