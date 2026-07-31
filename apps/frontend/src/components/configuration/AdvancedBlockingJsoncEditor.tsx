import { useEffect, useState } from "react";
import type { AdvancedBlockingRawConfig } from "../../types/advancedBlocking";

interface AdvancedBlockingJsoncEditorProps {
  config?: AdvancedBlockingRawConfig;
  loading: boolean;
  error?: string;
  onDirtyChange: (dirty: boolean) => void;
  onReload: () => Promise<void>;
  onSave: (
    rawConfig: string,
    configRevision: string,
  ) => Promise<AdvancedBlockingRawConfig>;
}

export function AdvancedBlockingJsoncEditor({
  config,
  loading,
  error,
  onDirtyChange,
  onReload,
  onSave,
}: AdvancedBlockingJsoncEditorProps) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(config?.rawConfig ?? "");
    setSaveError(undefined);
    setSaved(false);
  }, [config]);

  const dirty = Boolean(config && draft !== config.rawConfig);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange(false);
    },
    [onDirtyChange],
  );

  const handleSave = async () => {
    if (!config || !dirty) {
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    setSaved(false);
    try {
      const updated = await onSave(draft, config.configRevision);
      setDraft(updated.rawConfig);
      setSaved(true);
    } catch (saveFailure) {
      setSaveError(
        saveFailure instanceof Error
          ? saveFailure.message
          : "Failed to save Advanced Blocking JSONC.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="advanced-blocking-jsonc">
      <header className="advanced-blocking-jsonc__header">
        <div>
          <h2>Raw JSONC</h2>
          <p>
            View and edit the exact Advanced Blocking configuration, including
            comments that are not attached to individual domains.
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={loading || saving || dirty}
          onClick={() => void onReload()}
          title={
            dirty
              ? "Reset or save your changes before reloading."
              : undefined
          }
        >
          Reload
        </button>
      </header>

      <div className="alert-box alert-box--info">
        Comments, whitespace, and property order are saved exactly as entered.
        The server validates JSONC before writing it to Technitium.
      </div>

      {(error || saveError) && (
        <div className="alert-box alert-box--danger">{saveError ?? error}</div>
      )}
      {saved && (
        <div className="alert-box alert-box--success">
          Advanced Blocking JSONC saved.
        </div>
      )}

      {loading && !config ? (
        <p>Loading Advanced Blocking JSONC…</p>
      ) : (
        <textarea
          className="advanced-blocking-jsonc__textarea"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setSaved(false);
          }}
          spellCheck={false}
          aria-label="Advanced Blocking raw JSONC"
        />
      )}

      <footer className="advanced-blocking-jsonc__footer">
        <span>
          {config
            ? `${config.domainComments.length} domain-associated comment${config.domainComments.length === 1 ? "" : "s"} detected`
            : "No JSONC loaded"}
        </span>
        <div className="advanced-blocking-jsonc__actions">
          <button
            type="button"
            className="secondary"
            disabled={!dirty || saving}
            onClick={() => setDraft(config?.rawConfig ?? "")}
          >
            Reset
          </button>
          <button
            type="button"
            className="primary"
            disabled={!dirty || saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Validate & Save"}
          </button>
        </div>
      </footer>
    </section>
  );
}
