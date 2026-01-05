import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BackgroundPtrTokenValidationSummary } from "../components/common/BackgroundTokenSecurityBanner";
import type { AuthTransportInfo } from "../components/common/TransportSecurityBanner";
import {
  apiFetch,
  getAuthUnauthorizedEventName,
  triggerAuthRedirect,
} from "../config";

export type AuthStatus = {
  sessionAuthEnabled?: boolean;
  authenticated: boolean;
  user?: string;
  nodeIds?: string[];
  configuredNodeIds?: string[];
  clusterTokenConfigured?: boolean;
  transport?: AuthTransportInfo;
  backgroundPtrToken?: BackgroundPtrTokenValidationSummary;
};

type AuthContextValue = {
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

// In development, Vite Fast Refresh can reload modules that define contexts.
// If the Context object identity changes, existing Providers won't match new
// Consumers, and hooks like useAuth() can throw even though a Provider exists.
// Cache the context instance on globalThis to keep it stable across HMR.
type GlobalWithAuthContext = typeof globalThis & {
  __tdc_auth_context__?: ReturnType<
    typeof createContext<AuthContextValue | undefined>
  >;
};

const globalWithAuthContext = globalThis as GlobalWithAuthContext;
const AuthContext: ReturnType<
  typeof createContext<AuthContextValue | undefined>
> =
  globalWithAuthContext.__tdc_auth_context__ ??
  (globalWithAuthContext.__tdc_auth_context__ = createContext<
    AuthContextValue | undefined
  >(undefined));

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
  }, [refresh]);

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

  const value = useMemo<AuthContextValue>(
    () => ({ status, loading, error, refresh, login, logout }),
    [status, loading, error, refresh, login, logout, authEventNonce],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}

/**
 * Optional form of useAuth.
 *
 * This is useful for contexts (like TechnitiumContext) that can operate in a
 * limited mode without an AuthProvider (e.g., unit tests).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext) ?? null;
}
