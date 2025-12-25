import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  isNodeSessionRequiredButMissing,
  useAuth,
} from "../context/AuthContext";

export default function LoginPage() {
  const { status, loading, login } = useAuth();
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

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (
    !loading &&
    status?.authenticated &&
    !isNodeSessionRequiredButMissing(status)
  ) {
    return <Navigate to={nextPath} replace />;
  }

  if (!loading && status?.sessionAuthEnabled === false) {
    return <Navigate to={nextPath} replace />;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({
        username,
        password,
        totp: totp.trim() ? totp.trim() : undefined,
      });
      navigate(nextPath, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
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
        Use your Technitium DNS username and password.
      </p>

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

      <form
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
          style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}
        >
          Username
        </label>
        <input
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
          style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}
        >
          Password
        </label>
        <input
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
          style={{ display: "block", fontWeight: 600, marginBottom: "0.25rem" }}
        >
          2FA code (optional)
        </label>
        <input
          type="text"
          value={totp}
          onChange={(e) => setTotp(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
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
            style={{ margin: "0 0 1rem 0", color: "var(--color-danger-text)" }}
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
      </form>
    </div>
  );
}
