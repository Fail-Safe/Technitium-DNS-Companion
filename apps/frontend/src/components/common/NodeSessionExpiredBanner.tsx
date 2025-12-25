import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./BackgroundTokenSecurityBanner.css";

export function NodeSessionExpiredBanner({
  sessionAuthEnabled,
  authenticated,
  configuredNodeIds,
  nodeIds,
}: {
  sessionAuthEnabled: boolean | undefined;
  authenticated: boolean;
  configuredNodeIds: string[] | undefined;
  nodeIds: string[] | undefined;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const configured = configuredNodeIds ?? [];
  const sessionNodes = nodeIds ?? [];

  const missingNodeIds = useMemo(() => {
    const sessionSet = new Set(sessionNodes);
    return configured.filter((nodeId) => !sessionSet.has(nodeId));
  }, [configured, sessionNodes]);

  const show =
    sessionAuthEnabled === true &&
    authenticated &&
    configured.length > 0 &&
    missingNodeIds.length > 0 &&
    !location.pathname.startsWith("/login");

  if (!show) {
    return null;
  }

  const title = "Sign in required";
  const message =
    missingNodeIds.length === 1 ?
      `Your Technitium session expired on 1 of ${configured.length} nodes. Please sign in again.`
    : `Your Technitium session expired on ${missingNodeIds.length} of ${configured.length} nodes. Please sign in again.`;

  return (
    <div
      className="background-token-security-banner background-token-security-banner--warning"
      role="alert"
    >
      <div className="background-token-security-banner__content">
        <p className="background-token-security-banner__title">{title}</p>
        <p className="background-token-security-banner__message">{message}</p>
      </div>
      <div className="background-token-security-banner__actions">
        <button
          className="btn btn--secondary btn--sm"
          onClick={() =>
            navigate("/login", {
              replace: true,
              state: { from: location, reason: "node-session-expired" },
            })
          }
        >
          Sign in again
        </button>
      </div>
    </div>
  );
}
