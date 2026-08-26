import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BackgroundPtrTokenValidationSummary } from "../components/common/BackgroundTokenSecurityBanner";
import type { AuthTransportInfo } from "../components/common/TransportSecurityBanner";
import {
    apiFetch,
    getAuthUnauthorizedEventName,
    triggerAuthRedirect,
} from "../config";
import { AuthContext } from "./authContextInstance";
import { redirectToTrustedSsoLogout } from "../utils/trustedSso";

export type AuthStatus = {
  sessionAuthEnabled?: boolean;
  authenticated: boolean;
  user?: string;
  authSource?: "password" | "trusted-sso";
  technitiumUser?: string;
  nodeIds?: string[];
  unreachableNodeIds?: string[];
  failedNodeIds?: string[];
  configuredNodeIds?: string[];
  trustedSso?: {
    enabled: boolean;
    available: boolean;
    manualLoginAllowed: boolean;
    error?: "identity-not-authorized" | "invalid-proxy-assertion";
    logoutUrl?: string;
  };
  transport?: AuthTransportInfo;
  backgroundPtrToken?: BackgroundPtrTokenValidationSummary;
};

export type AuthContextValue = {
  status: AuthStatus | null;
  loading: boolean;
  error: string | null;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  login: (args: {
    username: string;
    password: string;
    totp?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  continueWithSso: () => Promise<void>;
  ssoSuppressed: boolean;
};

const TRUSTED_SSO_SUPPRESSED_KEY = "trusted-sso-login-suppressed";

function readSsoSuppressed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.sessionStorage?.getItem(TRUSTED_SSO_SUPPRESSED_KEY) === "true"
    );
  } catch {
    return false;
  }
}

function writeSsoSuppressed(suppressed: boolean): void {
  try {
    if (suppressed) {
      window.sessionStorage?.setItem(TRUSTED_SSO_SUPPRESSED_KEY, "true");
    } else {
      window.sessionStorage?.removeItem(TRUSTED_SSO_SUPPRESSED_KEY);
    }
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

async function safeReadError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as unknown;
    if (!data || typeof data !== "object") {
      return `Request failed (${response.status})`;
    }

    const payload = data as {
      message?: unknown;
      nodes?: unknown;
    };

    const message =
      typeof payload.message === "string" ?
        payload.message
      : `Request failed (${response.status})`;

    if (Array.isArray(payload.nodes) && payload.nodes.length > 0) {
      const nodeDetails = payload.nodes
        .map((node) => {
          if (!node || typeof node !== "object") {
            return null;
          }

          const item = node as {
            nodeId?: unknown;
            authState?: unknown;
            status?: unknown;
            error?: unknown;
          };
          const nodeId =
            typeof item.nodeId === "string" ? item.nodeId : "unknown node";
          const state =
            typeof item.authState === "string" ? item.authState : "failed";
          const status =
            typeof item.status === "string" ? `/${item.status}` : "";
          const error =
            typeof item.error === "string" && item.error.trim() ?
              `: ${item.error}`
            : "";

          return `${nodeId} (${state}${status})${error}`;
        })
        .filter((line): line is string => line !== null);

      if (nodeDetails.length > 0) {
        return `${message}\n${nodeDetails.join("\n")}`;
      }
    }

    if ("message" in payload) {
      const message = payload.message;
      if (typeof message === "string") {
        return message;
      }
    }
  } catch {
    // ignore
  }

  return `Request failed (${response.status})`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ssoSuppressed, setSsoSuppressed] = useState(readSsoSuppressed);

  const statusRef = useRef<AuthStatus | null>(null);

  // Used to force a context value identity change when an auth-related event
  // occurs before `status` has been established (e.g., during initial load).
  const [authEventNonce, setAuthEventNonce] = useState(0);

  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastPresenceRefreshAtRef = useRef<number>(0);
  const ssoBootstrapAttemptedRef = useRef(false);
  const ssoBootstrapErrorRef = useRef<string | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const silent = options?.silent === true;

    const promise = (async () => {
      if (!silent) {
        setLoading(true);
      }
      if (!ssoBootstrapErrorRef.current) {
        setError(null);
      }
      try {
        const wasAuthenticated = statusRef.current?.authenticated === true;
        const res = await apiFetch("/auth/me");
        if (!res.ok) {
          setStatus((prev) => ({
            ...prev,
            sessionAuthEnabled: prev?.sessionAuthEnabled,
            authenticated: false,
          }));
          return;
        }
        let data = (await res.json()) as AuthStatus;
        setStatus(data);

        if (
          !data.authenticated &&
          data.trustedSso?.available === true &&
          !readSsoSuppressed() &&
          !ssoBootstrapAttemptedRef.current
        ) {
          ssoBootstrapAttemptedRef.current = true;
          const ssoResponse = await apiFetch("/auth/sso/login", {
            method: "POST",
          });
          if (ssoResponse.ok) {
            const refreshedResponse = await apiFetch("/auth/me");
            if (refreshedResponse.ok) {
              data = (await refreshedResponse.json()) as AuthStatus;
              if (!data.authenticated) {
                const message =
                  "SSO sign-in completed, but the session could not be confirmed.";
                ssoBootstrapErrorRef.current = message;
                setError(message);
              }
            } else {
              const message = await safeReadError(refreshedResponse);
              ssoBootstrapErrorRef.current = message;
              setError(message);
            }
          } else {
            const message = await safeReadError(ssoResponse);
            ssoBootstrapErrorRef.current = message;
            setError(message);
          }
        }

        if (data.authenticated) {
          ssoBootstrapAttemptedRef.current = false;
          ssoBootstrapErrorRef.current = null;
          setError(null);
        } else if (data.trustedSso?.available !== true) {
          ssoBootstrapAttemptedRef.current = false;
          ssoBootstrapErrorRef.current = null;
          setError(null);
        }

        // If the user previously had an authenticated Companion session and it
        // is now gone, treat it as an expiry and use the existing redirect/toast
        // mechanism so all pages behave consistently.
        if (
          data.sessionAuthEnabled === true &&
          wasAuthenticated &&
          data.authenticated === false
        ) {
          triggerAuthRedirect("session-expired", { path: "/auth/me" });
        }

        setStatus(data);
      } catch (e) {
        setStatus((prev) => ({
          ...prev,
          sessionAuthEnabled: prev?.sessionAuthEnabled,
          authenticated: false,
        }));
        const message =
          e instanceof Error ? e.message : "Failed to check session";
        if (ssoBootstrapAttemptedRef.current) {
          ssoBootstrapErrorRef.current = message;
        }
        setError(message);
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    })();

    refreshInFlightRef.current = promise;
    try {
      await promise;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // If the user leaves a tab open past session expiry, they may navigate around
  // without hitting a new API call right away (e.g., cached state in memory).
  // Refresh auth whenever the tab becomes active so we redirect promptly.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const maybeRefresh = () => {
      const now = Date.now();
      // Throttle: avoid spamming refreshes when focus events bounce.
      if (now - lastPresenceRefreshAtRef.current < 15_000) {
        return;
      }
      lastPresenceRefreshAtRef.current = now;
      void refresh({ silent: true });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        maybeRefresh();
      }
    };

    window.addEventListener("focus", maybeRefresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", maybeRefresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onUnauthorized = () => {
      // Ensure consumers (like `RequireAuth`) re-render immediately so they can
      // observe changes like the stored redirect reason.
      setAuthEventNonce((prev) => prev + 1);

      // sessionStorage updates (used by RequireAuth to redirect) do not trigger
      // React renders by themselves. Ensure the auth tree re-renders so the
      // route guard can observe the stored redirect reason immediately.
      setStatus((prev) => (prev ? { ...prev } : prev));

      // Silent refresh so we don't flash global loading.
      void refresh({ silent: true });
    };

    const eventName = getAuthUnauthorizedEventName();
    window.addEventListener(eventName, onUnauthorized);
    return () => window.removeEventListener(eventName, onUnauthorized);
  }, [refresh, setAuthEventNonce]);

  const login = useCallback(
    async (args: { username: string; password: string; totp?: string }) => {
      setError(null);
      const res = await apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });

      if (!res.ok) {
        throw new Error(await safeReadError(res));
      }

      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    setError(null);
    const trustedSsoSession = statusRef.current?.authSource === "trusted-sso";
    const logoutUrl = statusRef.current?.trustedSso?.logoutUrl;
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      if (trustedSsoSession && !logoutUrl) {
        writeSsoSuppressed(true);
        setSsoSuppressed(true);
      }
      if (trustedSsoSession && logoutUrl) {
        redirectToTrustedSsoLogout(logoutUrl);
      } else {
        await refresh();
      }
    }
  }, [refresh]);

  const continueWithSso = useCallback(async () => {
    writeSsoSuppressed(false);
    setSsoSuppressed(false);
    ssoBootstrapAttemptedRef.current = false;
    ssoBootstrapErrorRef.current = null;
    setError(null);
    await refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => {
    // Ensure the context value identity changes for auth-related events even
    // when `status` is still null and other exposed fields haven't changed.
    void authEventNonce;
    return {
      status,
      loading,
      error,
      refresh,
      login,
      logout,
      continueWithSso,
      ssoSuppressed,
    };
  }, [
    status,
    loading,
    error,
    refresh,
    login,
    logout,
    continueWithSso,
    ssoSuppressed,
    authEventNonce,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
