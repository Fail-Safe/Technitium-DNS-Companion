import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { clearAuthRedirectReason } from "../config";
import { useAuth } from "../context/useAuth";
import { isNodeSessionRequiredButMissing } from "../utils/authSession";
import { AppInput } from "../components/common/AppInput";

function isTotpRequiredError(message: string): boolean {
  return (
    /\b2fa-required\b/i.test(message) ||
    /\bTOTP\b.*\brequired\b/i.test(message) ||
    /one-time password .*required/i.test(message)
  );
}

export default function LoginPage() {
  const {
    status,
    loading,
    error: authError,
    login,
    continueWithSso,
    ssoSuppressed,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const nextPath = useMemo(() => {
    const state = location.state as { from?: { pathname?: string } } | null;
    return state?.from?.pathname || "/";
  }, [location.state]);

  const redirectedReason = useMemo(() => {
    const state = location.state as { reason?: unknown } | null;
    return typeof state?.reason === "string" ? state.reason : null;
  }, [location.state]);

  useEffect(() => {
    if (redirectedReason) {
      clearAuthRedirectReason();
    }
  }, [redirectedReason]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totpRequired, setTotpRequired] = useState(false);
  const totpInputRef = useRef<HTMLInputElement>(null);
  const trustedSso = status?.trustedSso;
  const manualLoginAllowed = trustedSso?.manualLoginAllowed ?? true;

  if (
    !loading &&
    status?.authenticated &&
    !isNodeSessionRequiredButMissing(status)
  ) {
    return <Navigate to={nextPath} replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totpRequired && !totp.trim()) {
      setError("Enter your 2FA code and try again.");
      totpInputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await login({
        username,
        password,
        totp: totp.trim() ? totp.trim() : undefined,
      });
      setTotpRequired(false);
      navigate(nextPath, { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      if (isTotpRequiredError(message)) {
        setTotpRequired(true);
        setError("Enter your 2FA code and try again.");
        totpInputRef.current?.focus();
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="login"
      style={{ maxWidth: 520, margin: "0 auto", padding: "2rem 1rem" }}
    >
      <h1 style={{ margin: "0 0 0.5rem 0" }}>Sign in</h1>
      <p
        style={{
          margin: "0 0 1.25rem 0",
          color: "var(--color-text-secondary)",
        }}
      >
        {manualLoginAllowed ?
          "Use your Technitium DNS username and password."
        : "Authentication is managed by your trusted identity provider."}
      </p>

      {!manualLoginAllowed &&
        trustedSso?.error === "identity-not-authorized" && (
          <div role="alert" className="login__sso-state">
            <h2>Access denied</h2>
            <p>
              Your SSO identity is valid but is not authorized for Technitium
              DNS Companion. Ask an administrator to add an exact identity and
              Technitium user mapping.
            </p>
          </div>
        )}

      {!manualLoginAllowed &&
        trustedSso?.error === "invalid-proxy-assertion" && (
          <div role="alert" className="login__sso-state">
            <h2>SSO is unavailable</h2>
            <p>
              The trusted proxy assertion is missing or invalid. Contact the
              administrator responsible for the reverse proxy configuration.
            </p>
          </div>
        )}

      {!manualLoginAllowed && trustedSso?.available && ssoSuppressed && (
        <div role="status" className="login__sso-state">
          <h2>Signed out locally</h2>
          <p>
            Automatic SSO sign-in is paused for this browser tab until you
            choose to continue.
          </p>
          <button
            className="button primary"
            type="button"
            onClick={() => void continueWithSso()}
          >
            Continue with SSO
          </button>
        </div>
      )}

      {!manualLoginAllowed &&
        trustedSso?.available &&
        !ssoSuppressed &&
        authError && (
          <div role="alert" className="login__sso-state">
            <h2>SSO sign-in failed</h2>
            <p style={{ whiteSpace: "pre-line" }}>{authError}</p>
            <button
              className="button primary"
              type="button"
              onClick={() => void continueWithSso()}
            >
              Continue with SSO
            </button>
          </div>
        )}

      {redirectedReason === "node-session-expired" && (
        <div
          role="status"
          style={{
            margin: "0 0 1rem 0",
            padding: "0.75rem 1rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            background: "var(--color-bg-secondary)",
            color: "var(--color-text-secondary)",
          }}
        >
          Your Technitium session expired on one or more nodes. Please sign in
          again.
        </div>
      )}

      {redirectedReason === "session-expired" && (
        <div
          role="status"
          style={{
            margin: "0 0 1rem 0",
            padding: "0.75rem 1rem",
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            background: "var(--color-bg-secondary)",
            color: "var(--color-text-secondary)",
          }}
        >
          Your Companion session expired. Please sign in again.
        </div>
      )}

      {manualLoginAllowed && <form
        onSubmit={onSubmit}
        className="login__form"
        style={{
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border)",
          borderRadius: "1rem",
          padding: "1.25rem",
        }}
      >
        <label
          htmlFor="login-username"
          style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}
        >
          Username
        </label>
        <AppInput
          id="login-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
          style={{
            width: "100%",
            padding: "0.75rem",
            borderRadius: "0.75rem",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
            marginBottom: "0.75rem",
          }}
        />

        <label
          htmlFor="login-password"
          style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}
        >
          Password
        </label>
        <AppInput
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          style={{
            width: "100%",
            padding: "0.75rem",
            borderRadius: "0.75rem",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
            marginBottom: "0.75rem",
          }}
        />

        <label
          htmlFor="login-totp"
          style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}
        >
          2FA code {totpRequired ? "(required)" : "(optional)"}
        </label>
        <AppInput
          id="login-totp"
          ref={totpInputRef}
          type="text"
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          required={totpRequired}
          aria-invalid={totpRequired && Boolean(error)}
          style={{
            width: "100%",
            padding: "0.75rem",
            borderRadius: "0.75rem",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-primary)",
            color: "var(--color-text-primary)",
            marginBottom: "1rem",
          }}
        />

        {error && (
          <p
            role="alert"
            style={{
              margin: "0 0 1rem 0",
              color: "var(--color-danger-text)",
              whiteSpace: "pre-line",
            }}
          >
            {error}
          </p>
        )}

        <button
          className={`button primary ${submitting ? "button--loading" : ""}`}
          type="submit"
          disabled={submitting}
        >
          Sign in
        </button>
      </form>}
    </div>
  );
}
