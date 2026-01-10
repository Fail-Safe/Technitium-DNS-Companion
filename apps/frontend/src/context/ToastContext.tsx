import type { ReactNode } from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getAuthRedirectReason,
  getAuthRedirectToastShownReason,
  getAuthUnauthorizedEventName,
  getNetworkErrorEventName,
  getNetworkRecoveredEventName,
  markAuthRedirectToastShown,
} from "../config";
import { ToastContext } from "./toastContextInstance";

type ToastTone = "info" | "success" | "error";

interface ToastRecord {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastOptions {
  message: string;
  tone?: ToastTone;
  timeout?: number;
}

export interface ToastContextValue {
  toasts: ToastRecord[];
  pushToast: (options: ToastOptions) => string;
  dismissToast: (id: string) => void;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  // Only show "Reconnected" if we previously showed "Connection lost".
  const hasShownNetworkErrorToastRef = useRef(false);

  const dismissToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));

    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const pushToast = useCallback(
    (options: ToastOptions): string => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const tone: ToastTone = options.tone ?? "info";

      // Central rule: if we know we're redirecting to Sign in due to an auth/session
      // expiry, suppress error toasts to avoid noisy "(401)" spam while navigation
      // occurs.
      const redirectReason = getAuthRedirectReason();
      if (
        tone === "error" &&
        (redirectReason === "session-expired" ||
          redirectReason === "node-session-expired")
      ) {
        return id;
      }

      const toast: ToastRecord = { id, message: options.message, tone };

      setToasts((previous) => [...previous, toast]);

      const duration = options.timeout ?? 5000;
      if (duration > 0) {
        const handle = window.setTimeout(() => {
          dismissToast(id);
        }, duration);
        timersRef.current.set(id, handle);
      }

      return id;
    },
    [dismissToast],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((handle) => window.clearTimeout(handle));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onUnauthorized = () => {
      const redirectReason = getAuthRedirectReason();
      if (
        redirectReason !== "session-expired" &&
        redirectReason !== "node-session-expired"
      ) {
        return;
      }

      const alreadyShownFor = getAuthRedirectToastShownReason();
      if (alreadyShownFor === redirectReason) {
        return;
      }

      markAuthRedirectToastShown(redirectReason);

      pushToast({
        message:
          redirectReason === "node-session-expired" ?
            "Node session expired — redirecting to Sign in…"
          : "Session expired — redirecting to Sign in…",
        tone: "info",
        timeout: 4500,
      });
    };

    const eventName = getAuthUnauthorizedEventName();
    window.addEventListener(eventName, onUnauthorized);
    return () => window.removeEventListener(eventName, onUnauthorized);
  }, [pushToast]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Keep this conservative: one toast per minute max, even if multiple
    // concurrent requests fail while the network is down.
    const throttleMs = 60_000;
    let lastShownAt = 0;

    const onNetworkError = () => {
      const now = Date.now();
      if (now - lastShownAt < throttleMs) {
        return;
      }
      lastShownAt = now;

      // If we're already redirecting due to auth expiry, avoid extra noise.
      const redirectReason = getAuthRedirectReason();
      if (
        redirectReason === "session-expired" ||
        redirectReason === "node-session-expired"
      ) {
        return;
      }

      pushToast({
        message: "Connection lost — retrying…",
        tone: "info",
        timeout: 4500,
      });

      hasShownNetworkErrorToastRef.current = true;
    };

    const eventName = getNetworkErrorEventName();
    window.addEventListener(eventName, onNetworkError);
    return () => window.removeEventListener(eventName, onNetworkError);
  }, [pushToast]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Keep recovery messages conservative too.
    const throttleMs = 60_000;
    let lastShownAt = 0;

    const onNetworkRecovered = () => {
      const now = Date.now();
      if (now - lastShownAt < throttleMs) {
        return;
      }

      // If we're already redirecting due to auth expiry, avoid extra noise.
      const redirectReason = getAuthRedirectReason();
      if (
        redirectReason === "session-expired" ||
        redirectReason === "node-session-expired"
      ) {
        return;
      }

      if (!hasShownNetworkErrorToastRef.current) {
        return;
      }

      lastShownAt = now;
      hasShownNetworkErrorToastRef.current = false;

      pushToast({ message: "Reconnected", tone: "success", timeout: 3500 });
    };

    const eventName = getNetworkRecoveredEventName();
    window.addEventListener(eventName, onNetworkRecovered);
    return () => window.removeEventListener(eventName, onNetworkRecovered);
  }, [pushToast]);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, pushToast, dismissToast }),
    [toasts, pushToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewportContent />
    </ToastContext.Provider>
  );
}

function useToastContext() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

function ToastViewportContent() {
  const { toasts, dismissToast } = useToastContext();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className="toast-stack"
      role="region"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.tone}`}
          role="status"
        >
          <span className="toast__message">{toast.message}</span>
          <button
            type="button"
            className="toast__dismiss"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss notification"
          >
            Close
          </button>
        </div>
      ))}
    </div>
  );
}
