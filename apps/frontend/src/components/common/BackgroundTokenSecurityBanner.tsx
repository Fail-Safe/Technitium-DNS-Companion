import { useMemo } from "react";
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
}: {
  backgroundPtrToken: BackgroundPtrTokenValidationSummary | undefined;
}) {
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

  if (!showUnsafeBackgroundTokenBanner) {
    return null;
  }

  return (
    <div className="background-token-security-banner" role="alert">
      <div className="background-token-security-banner__content">
        <p className="background-token-security-banner__title">{unsafeTitle}</p>
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
  );
}
