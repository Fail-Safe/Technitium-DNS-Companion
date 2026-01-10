/**
 * Application configuration
 * Reads from Vite environment variables
 */

/**
 * Get the API base URL
 * In development with proxy: uses relative path
 * In production or HTTPS mode: uses full URL from environment
 */
export const getApiBaseUrl = (): string => {
  // Check if we have an explicit API URL set (for production or HTTPS testing)
  const apiUrl = import.meta.env.VITE_API_URL;

  if (apiUrl) {
    // Ensure it doesn't end with a slash
    return apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
  }

  // Default to relative path (works with Vite proxy in development)
  return "/api";
};

const AUTH_UNAUTHORIZED_EVENT = "technitium.auth.unauthorized";
const AUTH_REDIRECT_REASON_KEY = "technitium.auth.redirectReason";
const AUTH_REDIRECT_TOAST_SHOWN_KEY = "technitium.auth.redirectToastShown";

const NETWORK_ERROR_EVENT = "technitium.network.error";
const NETWORK_RECOVERED_EVENT = "technitium.network.recovered";

let lastNetworkErrorAt: number | null = null;

const isAbortError = (error: unknown): boolean => {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return false;
  }

  // fetch() aborts typically throw a DOMException with name "AbortError"
  const maybeName = (error as { name?: unknown }).name;
  return maybeName === "AbortError";
};

export type AuthRedirectReason = "session-expired" | "node-session-expired";

export const triggerAuthRedirect = (
  reason: AuthRedirectReason,
  detail?: { path?: string },
): void => {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage?.setItem(AUTH_REDIRECT_REASON_KEY, reason);
  } catch {
    // ignore storage failures (private mode, quota, etc)
  }

  try {
    window.dispatchEvent(
      new CustomEvent(AUTH_UNAUTHORIZED_EVENT, {
        detail: { path: detail?.path },
      }),
    );
  } catch {
    // ignore
  }
};

export type ApiFetchErrorKind = "network";

export class ApiFetchError extends Error {
  readonly kind: ApiFetchErrorKind;
  readonly url: string;
  readonly path: string;
  readonly originalError: unknown;

  constructor(args: {
    kind: ApiFetchErrorKind;
    message: string;
    url: string;
    path: string;
    originalError: unknown;
  }) {
    super(args.message);
    this.name = "ApiFetchError";
    this.kind = args.kind;
    this.url = args.url;
    this.path = args.path;
    this.originalError = args.originalError;
  }
}

export const isApiFetchError = (error: unknown): error is ApiFetchError =>
  error instanceof ApiFetchError;

export const isApiFetchNetworkError = (error: unknown): boolean =>
  isApiFetchError(error) && error.kind === "network";

export const triggerNetworkError = (detail: {
  url: string;
  path: string;
  online?: boolean;
}): void => {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(NETWORK_ERROR_EVENT, { detail }));
  } catch {
    // ignore
  }
};

export const triggerNetworkRecovered = (detail: {
  url: string;
  path: string;
}): void => {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(NETWORK_RECOVERED_EVENT, { detail }));
  } catch {
    // ignore
  }
};

/**
 * Make an API request with the correct base URL
 */
export const apiFetch = (
  path: string,
  options?: RequestInit,
): Promise<Response> => {
  const baseUrl = getApiBaseUrl();

  // Ensure path starts with /
  const cleanPath = path.startsWith("/") ? path : `/${path}`;

  const url = `${baseUrl}${cleanPath}`;

  const mergedOptions: RequestInit = {
    credentials: "include",
    ...options,
    headers: { ...(options?.headers || {}) },
  };

  return fetch(url, mergedOptions)
    .then((response) => {
      if (lastNetworkErrorAt !== null) {
        lastNetworkErrorAt = null;
        triggerNetworkRecovered({ url, path: cleanPath });
      }

      // If the Companion session cookie expires mid-session, the backend will return 401.
      // Trigger an auth refresh so route guards can redirect back to /login.
      if (response.status === 401 && !cleanPath.startsWith("/auth/")) {
        triggerAuthRedirect("session-expired", { path: cleanPath });
      }

      return response;
    })
    .catch((error: unknown) => {
      // Aborted requests are expected during typeahead/search (new request cancels the prior).
      // Do not treat these as connectivity issues.
      if (mergedOptions.signal?.aborted || isAbortError(error)) {
        throw error;
      }

      // Fetch rejects on network errors (offline, DNS failures, connection reset,
      // ERR_NETWORK_CHANGED, CORS issues, etc). We emit a global event so the UI
      // can react consistently (e.g., show a single toast and back off polling).
      if (lastNetworkErrorAt === null) {
        lastNetworkErrorAt = Date.now();
      }

      triggerNetworkError({
        url,
        path: cleanPath,
        online: typeof navigator !== "undefined" ? navigator.onLine : undefined,
      });

      throw new ApiFetchError({
        kind: "network",
        message: "Network request failed",
        url,
        path: cleanPath,
        originalError: error,
      });
    });
};

export const getAuthRedirectReason = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage?.getItem(AUTH_REDIRECT_REASON_KEY);
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
};

export const clearAuthRedirectReason = (): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.removeItem(AUTH_REDIRECT_REASON_KEY);
    window.sessionStorage?.removeItem(AUTH_REDIRECT_TOAST_SHOWN_KEY);
  } catch {
    // ignore
  }
};

export const getAuthUnauthorizedEventName = (): string =>
  AUTH_UNAUTHORIZED_EVENT;

export const getNetworkErrorEventName = (): string => NETWORK_ERROR_EVENT;

export const getNetworkRecoveredEventName = (): string =>
  NETWORK_RECOVERED_EVENT;

export const getAuthRedirectToastShownReason = (): string | null => {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage?.getItem(AUTH_REDIRECT_TOAST_SHOWN_KEY);
    return typeof value === "string" && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
};

export const markAuthRedirectToastShown = (
  reason: AuthRedirectReason,
): void => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(AUTH_REDIRECT_TOAST_SHOWN_KEY, reason);
  } catch {
    // ignore
  }
};
