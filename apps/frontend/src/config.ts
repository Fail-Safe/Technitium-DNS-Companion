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

  return fetch(url, mergedOptions).then((response) => {
    // If the Companion session cookie expires mid-session, the backend will return 401.
    // Trigger an auth refresh so route guards can redirect back to /login.
    if (response.status === 401 && !cleanPath.startsWith("/auth/")) {
      triggerAuthRedirect("session-expired", { path: cleanPath });
    }

    return response;
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
