import { useMemo, useState } from "react";
import { BackgroundTokenMigrationModal } from "./BackgroundTokenMigrationModal";
import "./BackgroundTokenSecurityBanner.css";

export type BackgroundPtrTokenValidationSummary = {
  configured: boolean;
  sessionAuthEnabled: boolean;
  validated: boolean;
  okForPtr?: boolean;
  username?: string;
  reason?: string;
  tooPrivilegedSections?: string[];
};

export function BackgroundTokenSecurityBanner({
  backgroundPtrToken,
  clusterTokenConfigured,
  clusterTokenUsage,
  authenticated,
}: {
  backgroundPtrToken: BackgroundPtrTokenValidationSummary | undefined;
  clusterTokenConfigured: boolean | undefined;
  clusterTokenUsage?: { usedForNodeIds: string[] };
  authenticated: boolean;
}) {
  const [migrationOpen, setMigrationOpen] = useState(false);

  const sessionAuthEnabled = backgroundPtrToken?.sessionAuthEnabled ?? true;

  const showClusterTokenDeprecatedBanner = clusterTokenConfigured === true;

  const clusterFallbackNodeIds =
    clusterTokenUsage?.usedForNodeIds?.filter(Boolean) ?? [];
  const clusterTokenIsBeingUsedAsFallback = clusterFallbackNodeIds.length > 0;

  const showMigrationCta =
    authenticated && showClusterTokenDeprecatedBanner && sessionAuthEnabled;

  const showUnsafeBackgroundTokenBanner =
    backgroundPtrToken?.configured === true &&
    backgroundPtrToken.validated === true &&
    backgroundPtrToken.okForPtr === false;

  const unsafeDetails =
    backgroundPtrToken?.reason ??
    "TECHNITIUM_BACKGROUND_TOKEN is not suitable for background PTR lookups.";

  const unsafeTitle = useMemo(() => {
    if (!showUnsafeBackgroundTokenBanner) return "";
    if (
      backgroundPtrToken?.tooPrivilegedSections &&
      backgroundPtrToken.tooPrivilegedSections.length > 0
    ) {
      return "Background token is too privileged";
    }
    if (unsafeDetails.toLowerCase().includes("does not have")) {
      return "Background token lacks required access";
    }
    return "Background token validation failed";
  }, [
    backgroundPtrToken?.tooPrivilegedSections,
    showUnsafeBackgroundTokenBanner,
    unsafeDetails,
  ]);

  if (!showClusterTokenDeprecatedBanner && !showUnsafeBackgroundTokenBanner) {
    return null;
  }

  return (
    <>
      {showClusterTokenDeprecatedBanner ?
        <div
          className="background-token-security-banner background-token-security-banner--warning"
          role="status"
        >
          <div className="background-token-security-banner__content">
            <p className="background-token-security-banner__title">
              TECHNITIUM_CLUSTER_TOKEN is deprecated and will be removed in the
              v1.4 release
            </p>
            <p className="background-token-security-banner__message">
              {showMigrationCta ?
                <>
                  Migrate to a dedicated read-only{" "}
                  <strong>TECHNITIUM_BACKGROUND_TOKEN</strong> so background PTR
                  lookups can run without an admin token.
                </>
              : <>
                  {clusterTokenIsBeingUsedAsFallback ?
                    <>
                      This token is currently being used as a fallback for:{" "}
                      <strong>{clusterFallbackNodeIds.join(", ")}</strong>. Set
                      a least-privilege{" "}
                      <strong>TECHNITIUM_BACKGROUND_TOKEN</strong> so background
                      PTR lookups can run without an admin token, then remove{" "}
                      <strong>TECHNITIUM_CLUSTER_TOKEN</strong>.
                    </>
                  : <>
                      This token is configured but may no longer be needed.
                      Remove <strong>TECHNITIUM_CLUSTER_TOKEN</strong> to
                      prepare for v1.4. Background jobs use{" "}
                      <strong>TECHNITIUM_BACKGROUND_TOKEN</strong> in
                      session-auth mode.
                    </>
                  }
                </>
              }
            </p>
          </div>
          {showMigrationCta ?
            <div className="background-token-security-banner__actions">
              <button
                className="btn btn--secondary"
                onClick={() => setMigrationOpen(true)}
              >
                Migrate
              </button>
            </div>
          : null}
        </div>
      : null}

      {showUnsafeBackgroundTokenBanner ?
        <div className="background-token-security-banner" role="alert">
          <div className="background-token-security-banner__content">
            <p className="background-token-security-banner__title">
              {unsafeTitle}
            </p>
            <p className="background-token-security-banner__message">
              {unsafeDetails}
              {backgroundPtrToken?.username ?
                <>
                  {" "}
                  (user: <strong>{backgroundPtrToken.username}</strong>)
                </>
              : null}
            </p>
          </div>
        </div>
      : null}

      <BackgroundTokenMigrationModal
        isOpen={migrationOpen}
        onClose={() => setMigrationOpen(false)}
      />
    </>
  );
}
