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
import { apiFetch } from "../config";

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

// eslint-disable-next-line react-refresh/only-export-components
export function isNodeSessionRequiredButMissing(
  status: AuthStatus | null,
): boolean {
  if (!status?.authenticated) return false;

  // In non-session mode, we do not require per-node session tokens.
  if (status.sessionAuthEnabled === false) return false;

  const configuredNodeCount = status.configuredNodeIds?.length ?? 0;
  const sessionNodeCount = status.nodeIds?.length ?? 0;

  // When at least one node is configured but not all are currently authenticated
  // in this session, the common cause is that one or more Technitium session
  // tokens expired (while the Companion session cookie may still be valid).
  return configuredNodeCount > 0 && sessionNodeCount < configuredNodeCount;
}

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

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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

  const refreshInFlightRef = useRef<Promise<void> | null>(null);

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
        const res = await apiFetch("/auth/me");
        if (!res.ok) {
          setStatus((prev) => ({
            sessionAuthEnabled: prev?.sessionAuthEnabled,
            authenticated: false,
          }));
          return;
        }
        const data = (await res.json()) as AuthStatus;
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
    [status, loading, error, refresh, login, logout],
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
