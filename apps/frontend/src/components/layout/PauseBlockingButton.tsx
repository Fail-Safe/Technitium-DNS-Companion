import {
  faCaretDown,
  faCheck,
  faCircleNotch,
  faPause,
  faPlay,
  faShieldHalved,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOptionalTechnitiumState } from "../../context/useTechnitiumState";
import { useToast } from "../../context/useToast";
import { getPauseRecoveryTargets } from "../../utils/advanced-blocking-recovery";

type DurationPreset = {
  label: string;
  minutes: number;
};

const DURATION_PRESETS: DurationPreset[] = [
  { label: "1 minute", minutes: 1 },
  { label: "5 minutes", minutes: 5 },
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "4 hours", minutes: 240 },
];

function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return "expiring";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

export function PauseBlockingButton() {
  const technitium = useOptionalTechnitiumState();
  const { pushToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const builtInBlockingNodes = technitium?.builtInBlocking?.nodes;
  const nodes = useMemo(
    () => builtInBlockingNodes ?? [],
    [builtInBlockingNodes],
  );
  const advancedPause = technitium?.advancedBlockingPause;
  // Effective method is evaluated per node. An installed but disabled app is
  // still handled by Built-in Blocking, regardless of the saved UI preference.
  const advancedEffectiveNodeIds = useMemo(
    () =>
      new Set(
        (technitium?.blockingStatus?.nodes ?? [])
          .filter(
            (node) =>
              node.advancedBlockingInstalled && node.advancedBlockingEnabled,
          )
          .map((node) => node.nodeId),
      ),
    [technitium?.blockingStatus?.nodes],
  );
  const usingAdvancedBlocking = advancedEffectiveNodeIds.size > 0;
  // Once Companion owns a pause, the live root flag is deliberately false.
  // Ownership—not that transient effective-method signal—controls extension
  // and resume requests until the durable row is cleared.
  const hasAdvancedPauseOwnership = (advancedPause?.targets.length ?? 0) > 0;
  const shouldManageAdvancedBlocking =
    usingAdvancedBlocking || hasAdvancedPauseOwnership;
  const reloadAdvancedBlockingPause = technitium?.reloadAdvancedBlockingPause;

  useEffect(() => {
    if (!reloadAdvancedBlockingPause) return;
    // The callback is stable; refresh on selection and at a bounded cadence so
    // server-side expiry/retry is reflected without tying requests to context state.
    void reloadAdvancedBlockingPause().catch(() => undefined);
    const id = window.setInterval(() => {
      void reloadAdvancedBlockingPause().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(id);
  }, [reloadAdvancedBlockingPause]);

  const { pausedNodes, latestPauseUntilMs } = useMemo(() => {
    let latest = 0;
    const paused: { nodeId: string; untilMs: number }[] = [];
    for (const snap of nodes) {
      const raw = snap.metrics?.temporaryDisableBlockingTill;
      if (!raw) {
        continue;
      }
      const parsed = Date.parse(raw);
      if (Number.isNaN(parsed) || parsed <= now) {
        continue;
      }
      paused.push({ nodeId: snap.nodeId, untilMs: parsed });
      if (parsed > latest) {
        latest = parsed;
      }
    }
    return { pausedNodes: paused, latestPauseUntilMs: latest };
  }, [nodes, now]);

  const advancedLatestPauseUntilMs = useMemo(
    () =>
      Math.max(
        0,
        ...(advancedPause?.targets
          .filter((target) => target.status === "active" && !target.lastError)
          .map((target) => Date.parse(target.expiresAt)) ?? []),
      ),
    [advancedPause],
  );
  const advancedPaused = Boolean(advancedPause?.paused);
  const isPaused = advancedPaused || pausedNodes.length > 0;
  const recoveryTargets = getPauseRecoveryTargets(advancedPause, now);
  const recoveryFailed = recoveryTargets.some((target) => target.lastError);
  const recoveryPending = recoveryTargets.length > 0;
  const needsAttention =
    recoveryPending ||
    (advancedPause?.pendingTargetCount ?? 0) > 0 ||
    (advancedPause?.probeErrors?.length ?? 0) > 0;
  const canResume = isPaused || hasAdvancedPauseOwnership;
  const effectivePauseUntilMs = Math.max(
    advancedPaused ? advancedLatestPauseUntilMs : 0,
    latestPauseUntilMs,
  );

  useEffect(() => {
    if (!isPaused && !hasAdvancedPauseOwnership) {
      return;
    }
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isPaused, hasAdvancedPauseOwnership]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (containerRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const targetNodeIdsForPause = useMemo(
    () =>
      nodes
        .filter(
          (snap) =>
            snap.isHealthy &&
            (snap.metrics?.blockingEnabled ||
              pausedNodes.some((paused) => paused.nodeId === snap.nodeId)),
        )
        .map((snap) => snap.nodeId),
    [nodes, pausedNodes],
  );

  const handlePause = useCallback(
    async (minutes: number) => {
      if (!technitium) return;
      setMenuOpen(false);
      setBusy(true);
      try {
        if (shouldManageAdvancedBlocking) {
          try {
            const status = await technitium.pauseAdvancedBlocking(minutes);
            await technitium.reloadAdvancedBlocking().catch(() => undefined);
            const errors = [
              ...status.targets
                .filter((target) => target.lastError)
                .map(
                  (target) =>
                    `${target.writeTargetNodeId}: ${target.lastError}`,
                ),
              ...(status.probeErrors ?? []).map(
                (failure) => `${failure.nodeId}: ${failure.error}`,
              ),
            ];
            if (errors.length) {
              pushToast({
                message: `Paused with errors: ${errors.join("; ")}`,
                tone: "error",
              });
            } else if (status.pendingTargetCount > 0) {
              pushToast({
                message:
                  status.confirmedPausedTargetCount > 0
                    ? "Advanced Blocking is partially paused; confirmation is still pending for some targets."
                    : "Advanced Blocking pause is pending confirmation. Companion will retry automatically.",
                tone: "info",
              });
            } else if (status.paused && status.confirmedPausedTargetCount > 0) {
              const preset = DURATION_PRESETS.find(
                (p) => p.minutes === minutes,
              );
              pushToast({
                message: `Advanced Blocking paused for ${preset?.label ?? `${minutes} min`}.`,
                tone: "success",
              });
            } else {
              pushToast({
                message: "Advanced Blocking pause was not confirmed.",
                tone: "error",
              });
            }
          } catch (error) {
            pushToast({
              message: `Failed to pause Advanced Blocking: ${error instanceof Error ? error.message : "failed"}`,
              tone: "error",
            });
          }
        }

        if (targetNodeIdsForPause.length === 0) {
          if (!shouldManageAdvancedBlocking) {
            pushToast({
              message: "No nodes with blocking enabled to pause.",
              tone: "info",
            });
          }
          return;
        }

        const errors: string[] = [];
        await Promise.all(
          targetNodeIdsForPause.map(async (nodeId) => {
            try {
              await technitium.temporaryDisableBlocking(nodeId, minutes);
            } catch (error) {
              errors.push(
                `${nodeId}: ${error instanceof Error ? error.message : "failed"}`,
              );
            }
          }),
        );
        await technitium.reloadBuiltInBlocking().catch(() => undefined);
        if (errors.length) {
          pushToast({
            message: `Paused with errors: ${errors.join("; ")}`,
            tone: "error",
          });
        } else {
          const preset = DURATION_PRESETS.find((p) => p.minutes === minutes);
          pushToast({
            message: `Built-in Blocking paused for ${preset?.label ?? `${minutes} min`}.`,
            tone: "success",
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [
      technitium,
      targetNodeIdsForPause,
      pushToast,
      shouldManageAdvancedBlocking,
    ],
  );

  const handleResume = useCallback(async () => {
    if (!technitium) return;
    setMenuOpen(false);
    setBusy(true);
    const errors: string[] = [];
    let resumed = 0;
    try {
      // Each method must finish independently, including when another request
      // is forbidden or temporarily unavailable.
      await Promise.all([
        (async () => {
          if (!hasAdvancedPauseOwnership) return;
          try {
            const status = await technitium.resumeAdvancedBlocking();
            if (status.targets.length) {
              errors.push(
                ...status.targets.map(
                  (target) =>
                    target.writeTargetNodeId +
                    ": " +
                    (target.lastError ?? "resume is still pending"),
                ),
              );
            } else resumed++;
            await technitium.reloadAdvancedBlocking().catch(() => undefined);
          } catch (error) {
            errors.push(
              "Advanced Blocking: " +
                (error instanceof Error ? error.message : "failed"),
            );
          }
        })(),
        ...pausedNodes.map(async ({ nodeId }) => {
          try {
            await technitium.reEnableBlocking(nodeId);
            resumed++;
          } catch (error) {
            errors.push(
              nodeId +
                ": " +
                (error instanceof Error ? error.message : "failed"),
            );
          }
        }),
      ]);
      await technitium.reloadBuiltInBlocking().catch(() => undefined);
      if (errors.length) {
        pushToast({
          message: "Resume incomplete: " + errors.join("; "),
          tone: "error",
        });
      } else if (resumed > 0) {
        pushToast({ message: "Blocking resumed.", tone: "success" });
      }
    } finally {
      setBusy(false);
    }
  }, [technitium, pausedNodes, pushToast, hasAdvancedPauseOwnership]);
  const anyBlockingEnabled = useMemo(
    () => nodes.some((snap) => snap.isHealthy && snap.metrics?.blockingEnabled),
    [nodes],
  );

  const anyAdvancedEnabled = Boolean(
    technitium?.blockingStatus?.nodes.some(
      (node) => node.advancedBlockingInstalled && node.advancedBlockingEnabled,
    ),
  );

  if (
    !technitium ||
    (!usingAdvancedBlocking && nodes.length === 0 && !advancedPause)
  ) {
    return null;
  }

  if (!(anyAdvancedEnabled || anyBlockingEnabled) && !canResume) {
    return null;
  }

  const remainingSeconds = isPaused
    ? Math.max(0, Math.floor((effectivePauseUntilMs - now) / 1000))
    : 0;
  const countdownLabel = isPaused ? formatCountdown(remainingSeconds) : null;

  const pillClassName = [
    "app-header__pause",
    recoveryFailed
      ? "app-header__pause--error"
      : isPaused || recoveryPending
        ? "app-header__pause--paused"
        : "app-header__pause--active",
    menuOpen ? "app-header__pause--open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="app-header__pause-wrapper" ref={containerRef}>
      <button
        type="button"
        className={pillClassName}
        onClick={() => setMenuOpen((open) => !open)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={
          recoveryPending
            ? recoveryFailed
              ? "Advanced Blocking resume failed; blocking may still be disabled"
              : "Advanced Blocking resume is not yet confirmed"
            : isPaused
              ? `Blocking paused, ${countdownLabel} remaining`
              : needsAttention
                ? "Blocking needs attention"
                : "Pause blocking"
        }
        title={
          recoveryPending
            ? "Advanced Blocking may still be disabled. See recovery details below."
            : isPaused
              ? `Blocking paused — ${countdownLabel} remaining`
              : needsAttention
                ? "Blocking needs attention"
                : "Pause DNS blocking"
        }
      >
        <FontAwesomeIcon
          icon={
            busy
              ? faCircleNotch
              : recoveryPending
                ? faTriangleExclamation
                : isPaused
                  ? faPause
                  : faShieldHalved
          }
          spin={busy}
        />
        <span className="app-header__pause-label">
          {busy
            ? "Working…"
            : recoveryPending
              ? recoveryFailed
                ? "Resume failed"
                : "Resume pending"
              : needsAttention
                ? isPaused
                  ? `Partially paused · ${countdownLabel}`
                  : "Needs attention"
                : isPaused
                  ? `Paused · ${countdownLabel}`
                  : "Active"}
        </span>
        <FontAwesomeIcon
          icon={faCaretDown}
          className="app-header__pause-caret"
        />
      </button>
      {menuOpen && (
        <div className="app-header__pause-menu" role="menu">
          {shouldManageAdvancedBlocking && (
            <p className="app-header__pause-note" role="note">
              Advanced Blocking pauses all app groups. Companion overrides
              external enables until resume is confirmed.
            </p>
          )}
          {canResume && (
            <>
              <button
                type="button"
                className="app-header__actions-item"
                onClick={() => {
                  void handleResume();
                }}
                role="menuitem"
              >
                <FontAwesomeIcon icon={faPlay} />
                <span>Resume now</span>
              </button>
              <div className="app-header__actions-divider" aria-hidden="true" />
              <div className="app-header__actions-group-label">
                Extend pause
              </div>
            </>
          )}
          {!canResume && (
            <div className="app-header__actions-group-label">
              Pause blocking for
            </div>
          )}
          {DURATION_PRESETS.map((preset) => (
            <button
              key={preset.minutes}
              type="button"
              className="app-header__actions-item"
              onClick={() => {
                void handlePause(preset.minutes);
              }}
              role="menuitem"
            >
              <FontAwesomeIcon icon={faPause} />
              <span>{preset.label}</span>
              {isPaused && remainingSeconds > 0 && (
                <span className="app-header__actions-item-check">
                  <FontAwesomeIcon icon={faCheck} style={{ opacity: 0 }} />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
