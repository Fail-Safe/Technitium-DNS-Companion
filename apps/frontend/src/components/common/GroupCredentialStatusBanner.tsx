import type { GroupCredentialStatusEnvelope } from "../../types/auth";
import "./BackgroundTokenSecurityBanner.css";

export function GroupCredentialStatusBanner({
  credentials,
  title = "Technitium group access needs attention",
}: {
  credentials: GroupCredentialStatusEnvelope | undefined;
  title?: string;
}) {
  const actionable =
    credentials?.groups.filter(
      (group) =>
        group.state === "degraded" ||
        group.state === "unreachable" ||
        group.state === "failed",
    ) ?? [];
  if (actionable.length === 0) return null;

  return (
    <div
      className="background-token-security-banner background-token-security-banner--warning"
      role="alert"
    >
      <div className="background-token-security-banner__content">
        <p className="background-token-security-banner__title">
          {title}
        </p>
        <p className="background-token-security-banner__message">
          {actionable
            .map(
              (group) =>
                `${group.groupId}: ${group.state}${group.reason ? ` (${group.reason})` : ""}`,
            )
            .join("; ")}
        </p>
      </div>
    </div>
  );
}
