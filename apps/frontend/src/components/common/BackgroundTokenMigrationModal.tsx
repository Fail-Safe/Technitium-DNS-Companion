import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../config";
import "./BackgroundTokenMigrationModal.css";
import Divider from "./Divider";

type MigrationResult = { username: string; tokenName: string; token: string };

export function BackgroundTokenMigrationModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const tokenTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;

    // Prevent background (page) scroll while modal is open.
    // Compensate for scrollbar removal to avoid layout shift.
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setLoading(false);
      setError(null);
      setResult(null);
      setCopied(false);

      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    }
  }, [isOpen]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  const safeReadError = useCallback(async (response: Response) => {
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
  }, []);

  const runMigration = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await apiFetch("/auth/background-token/migrate", {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error(await safeReadError(res));
      }

      const data = (await res.json()) as MigrationResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Migration failed");
    } finally {
      setLoading(false);
    }
  }, [safeReadError]);

  const handleTokenClick = useCallback(async () => {
    const token = result?.token;
    if (!token) return;

    setCopied(false);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }

    const textarea = tokenTextareaRef.current;
    if (textarea) {
      textarea.focus();
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
        setCopied(true);
        copiedTimerRef.current = window.setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1600);
        return;
      }
    } catch {
      // Fall back to execCommand below.
    }

    try {
      // Deprecated but still supported in many browsers as a fallback.
      const ok = document.execCommand?.("copy") === true;
      if (ok) {
        setCopied(true);
        copiedTimerRef.current = window.setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1600);
      }
    } catch {
      // ignore
    }
  }, [result?.token]);

  const handleTokenMouseDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const textarea = tokenTextareaRef.current;
      if (!textarea) return;

      // Prevent the browser from toggling selection/caret on click.
      e.preventDefault();

      textarea.focus();

      const valueLength = textarea.value.length;
      const alreadyFullySelected =
        textarea.selectionStart === 0 && textarea.selectionEnd === valueLength;

      if (!alreadyFullySelected) {
        textarea.setSelectionRange(0, valueLength);
      }
    },
    [],
  );

  if (!isOpen) return null;

  return (
    <div
      className="background-token-migration-modal__overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="background-token-migration-modal-title"
    >
      <div className="background-token-migration-modal">
        <h2
          id="background-token-migration-modal-title"
          className="background-token-migration-modal__title"
        >
          Create Read-Only Background Token
        </h2>

        {!result ?
          <>
            <p className="background-token-migration-modal__text">
              This will use your current{" "}
              <strong>TECHNITIUM_CLUSTER_TOKEN</strong> to create a dedicated,
              read-only Technitium DNS user and a new API token intended for
              background PTR lookups.
            </p>
            <p className="background-token-migration-modal__text">
              The token will be shown only <strong>once</strong>! Copy it
              immediately and then update your environment to set{" "}
              <strong>TECHNITIUM_BACKGROUND_TOKEN</strong> to the new token and
              restart the container.
            </p>
            <Divider />
            <p className="background-token-migration-modal__text">
              Advanced users may wish to manually create their own Technitium
              DNS user and token. The new user can be added to the "Everyone"
              group to grant the required read-only access.
            </p>

            {error ?
              <p
                className="background-token-migration-modal__error"
                role="alert"
              >
                {error}
              </p>
            : null}

            <div className="background-token-migration-modal__actions">
              <button
                className="btn btn--secondary"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={runMigration}
                disabled={loading}
              >
                {loading ? "Creating…" : "Create token"}
              </button>
            </div>
          </>
        : <>
            <p className="background-token-migration-modal__text">
              Created user <strong>{result.username}</strong> with token name{" "}
              <strong>{result.tokenName}</strong>.
            </p>

            <p
              className="background-token-migration-modal__text"
              style={{ color: "var(--color-danger-text)" }}
            >
              <strong>
                Note: Once this dialog is closed, the token will not be shown
                again.
              </strong>
            </p>

            <p className="background-token-migration-modal__text">
              Click the token to copy it:{" "}
              {copied ?
                <span
                  className="background-token-migration-modal__copied"
                  role="status"
                  aria-live="polite"
                >
                  Copied!
                </span>
              : null}
            </p>

            <textarea
              className="background-token-migration-modal__token"
              readOnly
              value={result.token}
              rows={1}
              ref={tokenTextareaRef}
              onMouseDown={handleTokenMouseDown}
              onTouchStart={handleTokenMouseDown}
              onClick={handleTokenClick}
            />

            <div className="background-token-migration-modal__steps">
              <p className="background-token-migration-modal__text">
                Next steps:
              </p>
              <ol className="background-token-migration-modal__list">
                <li>
                  Set <strong>TECHNITIUM_BACKGROUND_TOKEN</strong> to the token
                  above.
                </li>
                <li>
                  Remove (or comment out){" "}
                  <strong>TECHNITIUM_CLUSTER_TOKEN</strong>.
                </li>
                <li>
                  Restart the app container so the new environment is loaded.
                </li>
              </ol>
            </div>

            <div className="background-token-migration-modal__actions">
              <button className="btn btn--primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        }
      </div>
    </div>
  );
}
