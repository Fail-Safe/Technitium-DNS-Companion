import "./BackgroundTokenSecurityBanner.css";

export type AuthTransportInfo = {
  requestSecure: boolean;
  httpsEnabled: boolean;
  trustProxyEnabled: boolean;
  forwardedProto?: string;
};

export function TransportSecurityBanner({
  sessionAuthEnabled,
  transport,
}: {
  sessionAuthEnabled: boolean | undefined;
  transport: AuthTransportInfo | undefined;
}) {
  const show =
    sessionAuthEnabled === true && transport?.requestSecure === false;
  if (!show) {
    return null;
  }

  const forwardedProto = (transport?.forwardedProto ?? "").trim();

  const title = "Secure connection required";
  const message =
    transport?.trustProxyEnabled === true && transport?.httpsEnabled === false ?
      `Session auth is enabled, but the backend does not see this request as HTTPS. This usually means your reverse proxy is not sending X-Forwarded-Proto: https (current: ${forwardedProto || "missing"}).`
    : "Session auth is enabled, but the backend does not see this request as HTTPS. Enable HTTPS or configure a TLS-terminating reverse proxy (and set TRUST_PROXY=true).";

  return (
    <div
      className="background-token-security-banner background-token-security-banner--warning"
      role="alert"
    >
      <div className="background-token-security-banner__content">
        <p className="background-token-security-banner__title">{title}</p>
        <p className="background-token-security-banner__message">{message}</p>
      </div>
    </div>
  );
}
