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

export type AuthStatus = {
  sessionAuthEnabled?: boolean;
  authenticated: boolean;
  user?: string;
  nodeIds?: string[];
  configuredNodeIds?: string[];
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
};

async function safeReadError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as unknown;
    if (data && typeof data === "object" && "message" in data) {
      const message = (data as { message?: unknown }).message;
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

  const statusRef = useRef<AuthStatus | null>(null);

  // Used to force a context value identity change when an auth-related event
  // occurs before `status` has been established (e.g., during initial load).
  const [authEventNonce, setAuthEventNonce] = useState(0);

  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastPresenceRefreshAtRef = useRef<number>(0);

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
      setError(null);
      try {
        const wasAuthenticated = statusRef.current?.authenticated === true;
        const res = await apiFetch("/auth/me");
        if (!res.ok) {
          setStatus((prev) => ({
            sessionAuthEnabled: prev?.sessionAuthEnabled,
            authenticated: false,
          }));
          return;
        }
        const data = (await res.json()) as AuthStatus;

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
          sessionAuthEnabled: prev?.sessionAuthEnabled,
          authenticated: false,
        }));
        setError(e instanceof Error ? e.message : "Failed to check session");
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
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      await refresh();
    }
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => {
    // Ensure the context value identity changes for auth-related events even
    // when `status` is still null and other exposed fields haven't changed.
    void authEventNonce;
    return { status, loading, error, refresh, login, logout };
  }, [status, loading, error, refresh, login, logout, authEventNonce]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
