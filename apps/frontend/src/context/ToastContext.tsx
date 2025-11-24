import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type ToastTone = 'info' | 'success' | 'error';

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

interface ToastContextValue {
    toasts: ToastRecord[];
    pushToast: (options: ToastOptions) => string;
    dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<ToastRecord[]>([]);
    const timersRef = useRef<Map<string, number>>(new Map());

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
            const tone: ToastTone = options.tone ?? 'info';
            const toast: ToastRecord = {
                id,
                message: options.message,
                tone,
            };

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

    const value = useMemo<ToastContextValue>(
        () => ({
            toasts,
            pushToast,
            dismissToast,
        }),
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
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
}

// eslint-disable-next-line react-refresh/only-export-components -- Hook export is safe for fast refresh.
export function useToast() {
    const { pushToast } = useToastContext();
    return { pushToast };
}

function ToastViewportContent() {
    const { toasts, dismissToast } = useToastContext();

    if (toasts.length === 0) {
        return null;
    }

    return (
        <div className="toast-stack" role="region" aria-live="polite" aria-label="Notifications">
            {toasts.map((toast) => (
                <div key={toast.id} className={`toast toast--${toast.tone}`} role="status">
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
