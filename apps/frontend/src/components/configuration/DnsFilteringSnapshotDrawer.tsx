import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../context/useToast";
import type {
  DnsFilteringSnapshot,
  DnsFilteringSnapshotMetadata,
  DnsFilteringSnapshotMethod,
  DnsFilteringSnapshotRestoreResult,
} from "../../types/dnsFilteringSnapshots";
import "../dhcp/DhcpSnapshotDrawer.css";

interface DnsFilteringSnapshotDrawerProps {
  isOpen: boolean;
  nodeId?: string;
  nodeName?: string;
  method: DnsFilteringSnapshotMethod;
  onClose: () => void;

  listSnapshots: (
    nodeId: string,
    method: DnsFilteringSnapshotMethod,
  ) => Promise<DnsFilteringSnapshotMetadata[]>;
  createSnapshot: (
    nodeId: string,
    request: {
      method: DnsFilteringSnapshotMethod;
      origin?: "manual" | "automatic";
      note?: string;
    },
  ) => Promise<DnsFilteringSnapshotMetadata>;
  restoreSnapshot: (
    nodeId: string,
    snapshotId: string,
  ) => Promise<DnsFilteringSnapshotRestoreResult>;
  setSnapshotPinned: (
    nodeId: string,
    snapshotId: string,
    pinned: boolean,
  ) => Promise<DnsFilteringSnapshotMetadata>;
  getSnapshotDetail: (
    nodeId: string,
    snapshotId: string,
  ) => Promise<DnsFilteringSnapshot>;
  deleteSnapshot: (nodeId: string, snapshotId: string) => Promise<void>;
  updateSnapshotNote: (
    nodeId: string,
    snapshotId: string,
    note?: string,
  ) => Promise<DnsFilteringSnapshotMetadata>;
  onRestoreSuccess?: (nodeId: string) => Promise<void> | void;
}

const formatDateTime = (value: string): string => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const formatRelative = (value: string): string => {
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return value;
  const delta = Date.now() - date;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} min ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)} hr ago`;
  return `${Math.round(delta / 86_400_000)} d ago`;
};

const methodLabel = (method: DnsFilteringSnapshotMethod): string => {
  return method === "built-in" ? "Built-in" : "Advanced";
};

const summarizeCounts = (
  snapshot?: DnsFilteringSnapshot | null,
  meta?: DnsFilteringSnapshotMetadata | null,
): Array<{ label: string; value: string }> => {
  const resolvedMeta = snapshot?.metadata ?? meta;
  if (!resolvedMeta) return [];

  const allowed =
    typeof resolvedMeta.allowedCount === "number" ?
      resolvedMeta.allowedCount
    : snapshot?.builtIn?.allowedDomains?.length;
  const blocked =
    typeof resolvedMeta.blockedCount === "number" ?
      resolvedMeta.blockedCount
    : snapshot?.builtIn?.blockedDomains?.length;
  const groups =
    typeof resolvedMeta.groupCount === "number" ?
      resolvedMeta.groupCount
    : snapshot?.advancedBlocking?.config?.groups?.length;

  const counts: Array<{ label: string; value: string }> = [];
  if (typeof allowed === "number") {
    counts.push({ label: "Allowed", value: allowed.toLocaleString() });
  }
  if (typeof blocked === "number") {
    counts.push({ label: "Blocked", value: blocked.toLocaleString() });
  }
  if (typeof groups === "number") {
    counts.push({ label: "Groups", value: groups.toLocaleString() });
  }
  return counts;
};

const renderExpandableNote = (
  note: string,
  options: {
    expanded: boolean;
    onToggle: () => void;
    previewLines?: number;
    previewChars?: number;
  },
) => {
  const trimmed = note.trim();
  const previewLines = options.previewLines ?? 5;
  const previewChars = options.previewChars ?? 240;

  const lines = trimmed.split("\n");
  const isMultiLine = lines.length > 1;

  if (options.expanded) {
    return (
      <>
        <span style={{ whiteSpace: "pre-wrap" }}>{trimmed}</span>
        <div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={options.onToggle}
          >
            Collapse
          </button>
        </div>
      </>
    );
  }

  if (isMultiLine) {
    const needsToggle = lines.length > previewLines;
    const preview = lines.slice(0, previewLines).join("\n");
    return (
      <>
        <span style={{ whiteSpace: "pre-wrap" }}>
          {needsToggle ? `${preview}\n…` : preview}
        </span>
        {needsToggle && (
          <div>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={options.onToggle}
            >
              Expand
            </button>
          </div>
        )}
      </>
    );
  }

  if (trimmed.length > previewChars) {
    return (
      <>
        <span>{`${trimmed.slice(0, previewChars)}…`}</span>
        <div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={options.onToggle}
          >
            Expand
          </button>
        </div>
      </>
    );
  }

  return <span>{trimmed}</span>;
};

export const DnsFilteringSnapshotDrawer: React.FC<
  DnsFilteringSnapshotDrawerProps
> = ({
  isOpen,
  nodeId,
  nodeName,
  method,
  onClose,
  listSnapshots,
  createSnapshot,
  restoreSnapshot,
  setSnapshotPinned,
  getSnapshotDetail,
  deleteSnapshot,
  updateSnapshotNote,
  onRestoreSuccess,
}) => {
  const { pushToast } = useToast();
  const [snapshots, setSnapshots] = useState<DnsFilteringSnapshotMetadata[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const [animateIn, setAnimateIn] = useState(false);
  const [animateOut, setAnimateOut] = useState(false);
  const [isRendered, setIsRendered] = useState(isOpen);

  const [restoreDialogSnapshotId, setRestoreDialogSnapshotId] = useState<
    string | null
  >(null);

  const [viewSnapshotId, setViewSnapshotId] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [snapshotDetails, setSnapshotDetails] = useState<
    Map<string, DnsFilteringSnapshot>
  >(() => new Map());

  const [deleteDialogSnapshotId, setDeleteDialogSnapshotId] = useState<
    string | null
  >(null);

  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [noteSavingId, setNoteSavingId] = useState<string | null>(null);

  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedViewNote, setExpandedViewNote] = useState(false);

  const sortedSnapshots = useMemo(() => {
    return [...snapshots].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [snapshots]);

  const viewedSnapshot = useMemo(() => {
    if (!viewSnapshotId) return null;
    return snapshotDetails.get(viewSnapshotId) ?? null;
  }, [snapshotDetails, viewSnapshotId]);

  const refresh = useCallback(async () => {
    if (!nodeId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listSnapshots(nodeId, method);
      setSnapshots(data);
      setRefreshedAt(new Date().toISOString());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load.";
      setError(message);
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setLoading(false);
    }
  }, [listSnapshots, method, nodeId, pushToast]);

  useEffect(() => {
    if (isOpen && nodeId) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, nodeId, method]);

  useEffect(() => {
    setViewSnapshotId(null);
    setViewError(null);
    setViewLoading(false);
    setDeleteDialogSnapshotId(null);
    setNoteEditingId(null);
    setNoteDraft("");
    setExpandedNoteIds(new Set());
    setExpandedViewNote(false);
  }, [nodeId, method]);

  useEffect(() => {
    setExpandedViewNote(false);
  }, [viewSnapshotId]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      setAnimateOut(false);
      const timer = window.setTimeout(() => setAnimateIn(true), 10);
      return () => window.clearTimeout(timer);
    }

    setAnimateIn(false);
    setAnimateOut(true);
    const timeout = window.setTimeout(() => {
      setIsRendered(false);
      setAnimateOut(false);
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  const isActive = animateIn && !animateOut;

  const handleCreateSnapshot = async () => {
    if (!nodeId) return;
    setCreating(true);
    try {
      await createSnapshot(nodeId, { method, origin: "manual" });
      await refresh();
      pushToast({
        message: "Snapshot created",
        tone: "success",
        timeout: 4000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create.";
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setCreating(false);
    }
  };

  const handlePinToggle = async (snapshotId: string, pinned: boolean) => {
    if (!nodeId) return;
    setPinningId(snapshotId);
    try {
      const next = await setSnapshotPinned(nodeId, snapshotId, !pinned);
      setSnapshots((prev) =>
        prev.map((snap) => (snap.id === snapshotId ? next : snap)),
      );
      pushToast({
        message: !pinned ? "Pinned snapshot" : "Unpinned snapshot",
        tone: "success",
        timeout: 3000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to pin.";
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setPinningId(null);
    }
  };

  const handleRestore = async (snapshotId: string) => {
    setRestoreDialogSnapshotId(snapshotId);
  };

  const handleRestoreConfirm = async () => {
    if (!nodeId || !restoreDialogSnapshotId) return;
    const snapshotId = restoreDialogSnapshotId;

    setRestoringId(snapshotId);
    try {
      const result = await restoreSnapshot(nodeId, snapshotId);
      await refresh();

      const parts: string[] = [];
      if (result.restoredAllowed > 0 || result.restoredBlocked > 0) {
        parts.push(
          `Restored ${result.restoredAllowed.toLocaleString()} allowed, ${result.restoredBlocked.toLocaleString()} blocked`,
        );
      }
      if (result.restoredGroups > 0) {
        parts.push(`Restored ${result.restoredGroups.toLocaleString()} groups`);
      }

      pushToast({
        message: parts.length > 0 ? parts.join(" • ") : "Snapshot restored",
        tone: "success",
        timeout: 5000,
      });

      if (onRestoreSuccess) {
        try {
          await onRestoreSuccess(nodeId);
        } catch (refreshErr) {
          console.warn("Failed to refresh after restore", refreshErr);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to restore.";
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setRestoringId(null);
      setRestoreDialogSnapshotId(null);
    }
  };

  const handleViewSnapshot = async (snapshotId: string) => {
    if (!nodeId) return;
    setViewSnapshotId(snapshotId);
    setViewError(null);

    if (snapshotDetails.has(snapshotId)) {
      return;
    }

    setViewLoading(true);
    try {
      const detail = await getSnapshotDetail(nodeId, snapshotId);
      setSnapshotDetails((prev) => {
        const next = new Map(prev);
        next.set(snapshotId, detail);
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load.";
      setViewError(message);
    } finally {
      setViewLoading(false);
    }
  };

  const handleCloseView = () => {
    setViewSnapshotId(null);
    setViewError(null);
    setViewLoading(false);
  };

  const handleDeleteSnapshot = (snapshotId: string) => {
    setDeleteDialogSnapshotId(snapshotId);
  };

  const handleDeleteCancel = () => {
    setDeleteDialogSnapshotId(null);
    setDeletingId(null);
  };

  const handleDeleteConfirm = async () => {
    if (!nodeId || !deleteDialogSnapshotId) return;
    const snapshotId = deleteDialogSnapshotId;
    setDeletingId(snapshotId);
    try {
      await deleteSnapshot(nodeId, snapshotId);
      setSnapshots((prev) => prev.filter((snap) => snap.id !== snapshotId));
      setSnapshotDetails((prev) => {
        const next = new Map(prev);
        next.delete(snapshotId);
        return next;
      });
      pushToast({
        message: "Snapshot deleted",
        tone: "success",
        timeout: 4000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete.";
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setDeletingId(null);
      setDeleteDialogSnapshotId(null);
    }
  };

  const startEditNote = (snapshot: DnsFilteringSnapshotMetadata) => {
    setNoteEditingId(snapshot.id);
    setNoteDraft(snapshot.note ?? "");
  };

  const cancelEditNote = () => {
    setNoteEditingId(null);
    setNoteDraft("");
    setNoteSavingId(null);
  };

  const saveNote = async (snapshotId: string) => {
    if (!nodeId) return;
    setNoteSavingId(snapshotId);
    try {
      const updated = await updateSnapshotNote(nodeId, snapshotId, noteDraft);
      setSnapshots((prev) =>
        prev.map((snap) => (snap.id === snapshotId ? updated : snap)),
      );
      setSnapshotDetails((prev) => {
        if (!prev.has(snapshotId)) return prev;
        const next = new Map(prev);
        const existing = next.get(snapshotId);
        if (existing) {
          next.set(snapshotId, {
            ...existing,
            metadata: { ...existing.metadata, note: updated.note },
          });
        }
        return next;
      });
      pushToast({ message: "Note saved", tone: "success", timeout: 3000 });
      cancelEditNote();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save note.";
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setNoteSavingId(null);
    }
  };

  if (!isRendered) return null;

  return (
    <div
      className={`snapshot-drawer__overlay ${isActive ? "is-visible" : ""}`}
      onClick={onClose}
    >
      <div
        className={`modal snapshot-drawer ${isActive ? "is-visible" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header snapshot-drawer__header">
          <div className="snapshot-drawer__header-text">
            <div className="snapshot-drawer__eyebrow">
              DNS Filtering History
            </div>
            <div className="snapshot-drawer__title-row">
              {nodeId && (
                <span
                  className="snapshot-drawer__node-badge"
                  aria-label={`Snapshots for ${nodeName || nodeId}`}
                >
                  <span
                    aria-hidden
                    className="snapshot-drawer__node-badge-dot"
                  />
                  Node: {nodeName || nodeId}
                </span>
              )}
              <span className="snapshot-drawer__pill-quiet">
                {methodLabel(method)} method
              </span>
              {refreshedAt && (
                <span className="snapshot-drawer__updated-pill">
                  Updated {formatRelative(refreshedAt)}
                </span>
              )}
            </div>
          </div>
          <button
            className="modal__close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            ×
          </button>
        </div>

        <div className="modal__body snapshot-drawer__body">
          {!nodeId && (
            <div className="dhcp-page__placeholder">
              Select a node to view history.
            </div>
          )}

          {nodeId && (
            <>
              {restoreDialogSnapshotId && (
                <div
                  className="snapshot-drawer__dialog-backdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="restore-dialog-title"
                >
                  <div className="snapshot-drawer__dialog snapshot-drawer__dialog--restore">
                    <div className="snapshot-drawer__dialog-header">
                      <div>
                        <h3
                          id="restore-dialog-title"
                          className="snapshot-drawer__dialog-title"
                        >
                          Restore snapshot?
                        </h3>
                        <p className="snapshot-drawer__dialog-subtext">
                          Restoring will overwrite the current{" "}
                          {methodLabel(method)} DNS filtering state on this
                          node.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="modal__close"
                        onClick={() => setRestoreDialogSnapshotId(null)}
                        aria-label="Close"
                      >
                        ×
                      </button>
                    </div>

                    <div className="snapshot-drawer__section-gap">
                      <span>
                        This is a destructive operation. Consider pinning a
                        snapshot of the current state first.
                      </span>
                    </div>

                    <div className="snapshot-drawer__dialog-actions">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => setRestoreDialogSnapshotId(null)}
                        disabled={restoringId === restoreDialogSnapshotId}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary"
                        onClick={handleRestoreConfirm}
                        disabled={restoringId === restoreDialogSnapshotId}
                      >
                        {restoringId === restoreDialogSnapshotId ?
                          "Restoring..."
                        : "Restore"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {viewSnapshotId && (
                <div
                  className="snapshot-drawer__dialog-backdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="view-dialog-title"
                >
                  <div className="snapshot-drawer__dialog snapshot-drawer__dialog--view">
                    <div className="snapshot-drawer__dialog-header">
                      <div className="snapshot-drawer__header-text">
                        <h3
                          id="view-dialog-title"
                          className="snapshot-drawer__dialog-title snapshot-drawer__dialog-title--lg"
                        >
                          Snapshot details
                        </h3>
                        <div className="snapshot-drawer__dialog-meta">
                          {(() => {
                            const meta =
                              viewedSnapshot?.metadata ??
                              snapshots.find(
                                (snap) => snap.id === viewSnapshotId,
                              );
                            if (!meta) return null;
                            const counts = summarizeCounts(
                              viewedSnapshot,
                              meta,
                            );
                            return (
                              <>
                                <span>
                                  Created {formatDateTime(meta.createdAt)}
                                </span>
                                <span>{methodLabel(meta.method)} method</span>
                                {counts.map((c) => (
                                  <span key={c.label}>
                                    {c.label}: {c.value}
                                  </span>
                                ))}
                                {meta.pinned && <span>📌 Pinned</span>}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="modal__close"
                        onClick={handleCloseView}
                        aria-label="Close"
                      >
                        ×
                      </button>
                    </div>

                    {viewError && (
                      <div className="snapshot-drawer__alert">{viewError}</div>
                    )}

                    {viewLoading && !viewedSnapshot && (
                      <div className="snapshot-drawer__loading">
                        Loading snapshot…
                      </div>
                    )}

                    {viewedSnapshot && (
                      <div className="snapshot-drawer__scopes">
                        <div className="snapshot-drawer__note-card">
                          <strong>Note</strong>
                          <div>
                            {(
                              viewedSnapshot.metadata.note &&
                              viewedSnapshot.metadata.note.trim().length > 0
                            ) ?
                              renderExpandableNote(
                                viewedSnapshot.metadata.note,
                                {
                                  expanded: expandedViewNote,
                                  onToggle: () =>
                                    setExpandedViewNote(
                                      (previous) => !previous,
                                    ),
                                  previewLines: 8,
                                  previewChars: 320,
                                },
                              )
                            : <span>No note</span>}
                          </div>
                        </div>

                        {viewedSnapshot.metadata.method === "built-in" && (
                          <div className="snapshot-drawer__note-card">
                            <strong>Built-in settings</strong>
                            <span>
                              {viewedSnapshot.builtIn?.settings ?
                                `Blocking: ${viewedSnapshot.builtIn.settings.enableBlocking ? "enabled" : "disabled"} • Type: ${viewedSnapshot.builtIn.settings.blockingType ?? "—"}`
                              : "—"}
                            </span>
                          </div>
                        )}

                        {viewedSnapshot.metadata.method ===
                          "advanced-blocking" && (
                          <div className="snapshot-drawer__note-card">
                            <strong>Groups</strong>
                            <span>
                              {(() => {
                                const groups =
                                  viewedSnapshot.advancedBlocking?.config
                                    ?.groups ?? [];
                                if (groups.length === 0) return "No groups";
                                const names = groups
                                  .map((g) => g.name)
                                  .slice(0, 12);
                                const extra = groups.length - names.length;
                                return `${names.join(", ")}${extra > 0 ? ` (+${extra} more)` : ""}`;
                              })()}
                            </span>
                          </div>
                        )}

                        <div className="snapshot-drawer__hint">
                          Snapshot detail view is intentionally summarized to
                          avoid rendering huge lists.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {deleteDialogSnapshotId && (
                <div
                  className="snapshot-drawer__dialog-backdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="delete-dialog-title"
                >
                  <div className="snapshot-drawer__dialog snapshot-drawer__dialog--delete">
                    <div className="snapshot-drawer__dialog-header">
                      <div>
                        <h3
                          id="delete-dialog-title"
                          className="snapshot-drawer__dialog-title snapshot-drawer__dialog-title--md"
                        >
                          Delete snapshot?
                        </h3>
                        <p className="snapshot-drawer__dialog-subtext">
                          This cannot be undone.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="modal__close"
                        onClick={handleDeleteCancel}
                        aria-label="Close"
                      >
                        ×
                      </button>
                    </div>

                    <div className="snapshot-drawer__dialog-actions">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={handleDeleteCancel}
                        disabled={deletingId === deleteDialogSnapshotId}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn--secondary snapshot-drawer__danger-cta"
                        onClick={handleDeleteConfirm}
                        disabled={deletingId === deleteDialogSnapshotId}
                      >
                        {deletingId === deleteDialogSnapshotId ?
                          "Deleting…"
                        : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="snapshot-drawer__actions">
                <div className="snapshot-drawer__actions-group">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleCreateSnapshot}
                    disabled={loading || creating}
                  >
                    {creating ? "Creating…" : "Create snapshot"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={refresh}
                    disabled={loading}
                  >
                    {loading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              {loading && (
                <div className="dhcp-page__placeholder">Loading snapshots…</div>
              )}

              {!loading && error && (
                <div className="snapshot-drawer__error">
                  <div className="snapshot-drawer__error-header">
                    <strong>Could not load snapshots</strong>
                    <button
                      type="button"
                      className="btn btn--secondary snapshot-drawer__error-retry"
                      onClick={refresh}
                    >
                      Retry
                    </button>
                  </div>
                  <span>{error}</span>
                </div>
              )}

              {!loading && !error && sortedSnapshots.length === 0 && (
                <div className="snapshot-drawer__empty">
                  <strong>No snapshots yet</strong>
                  <span>
                    Capture the current DNS filtering state to enable quick
                    rollback. Pinned snapshots never expire during retention
                    cleanup.
                  </span>
                </div>
              )}

              {!loading && !error && sortedSnapshots.length > 0 && (
                <div className="snapshot-drawer__list">
                  <div className="snapshot-drawer__list-header">
                    <span className="snapshot-drawer__list-title">
                      Snapshots
                    </span>
                    <span className="snapshot-drawer__list-count">
                      {sortedSnapshots.length} total
                    </span>
                  </div>

                  {sortedSnapshots.map((snap) => {
                    const isNoteEditing = noteEditingId === snap.id;
                    const isNoteSaving = noteSavingId === snap.id;
                    const counts = summarizeCounts(null, snap);
                    const originLabel =
                      snap.origin === "automatic" ? "Auto" : "Manual";
                    const isNoteExpanded = expandedNoteIds.has(snap.id);

                    return (
                      <div key={snap.id} className="snapshot-drawer__item">
                        <div className="snapshot-drawer__item-header">
                          <div className="snapshot-drawer__item-main">
                            <div className="snapshot-drawer__item-meta">
                              <span className="snapshot-drawer__time-primary">
                                {formatRelative(snap.createdAt)}
                              </span>
                              <span className="snapshot-drawer__time-secondary">
                                {formatDateTime(snap.createdAt)}
                              </span>
                              {snap.pinned && (
                                <span className="snapshot-drawer__pin">
                                  <span aria-hidden="true">📌</span>
                                  Pinned
                                </span>
                              )}
                            </div>

                            <div className="snapshot-drawer__scope-count">
                              {counts.length > 0 ?
                                counts.map((c) => (
                                  <span key={c.label}>
                                    {c.label}: {c.value}
                                  </span>
                                ))
                              : <span>—</span>}
                              <span className="snapshot-drawer__pill-quiet">
                                {originLabel}
                              </span>
                            </div>

                            <div className="snapshot-drawer__snapshot-id">
                              <span>Snap ID: {snap.id}</span>
                            </div>

                            <div className="snapshot-drawer__note-box">
                              <div className="snapshot-drawer__note-header">
                                <strong>Note</strong>
                                {noteEditingId !== snap.id && (
                                  <button
                                    type="button"
                                    className="btn btn--ghost snapshot-drawer__note-edit"
                                    onClick={() => startEditNote(snap)}
                                    disabled={Boolean(noteEditingId)}
                                  >
                                    {snap.note ? "Edit note" : "Add note"}
                                  </button>
                                )}
                              </div>

                              {isNoteEditing ?
                                <div className="snapshot-drawer__section-gap">
                                  <textarea
                                    value={noteDraft}
                                    onChange={(event) =>
                                      setNoteDraft(event.target.value)
                                    }
                                    rows={3}
                                    className="snapshot-drawer__textarea"
                                    placeholder="What changed?"
                                    disabled={isNoteSaving}
                                  />
                                  <div className="snapshot-drawer__note-actions">
                                    <button
                                      type="button"
                                      className="btn btn--ghost"
                                      onClick={cancelEditNote}
                                      disabled={isNoteSaving}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn--secondary"
                                      onClick={() => saveNote(snap.id)}
                                      disabled={isNoteSaving}
                                    >
                                      {isNoteSaving ? "Saving…" : "Save note"}
                                    </button>
                                  </div>
                                </div>
                              : <div className="snapshot-drawer__pill-muted">
                                  {snap.note && snap.note.trim().length > 0 ?
                                    renderExpandableNote(snap.note, {
                                      expanded: isNoteExpanded,
                                      onToggle: () =>
                                        setExpandedNoteIds((previous) => {
                                          const next = new Set(previous);
                                          if (next.has(snap.id)) {
                                            next.delete(snap.id);
                                          } else {
                                            next.add(snap.id);
                                          }
                                          return next;
                                        }),
                                      previewLines: 5,
                                      previewChars: 240,
                                    })
                                  : <span className="snapshot-drawer__italic">
                                      No note
                                    </span>
                                  }
                                </div>
                              }
                            </div>
                          </div>

                          <div className="snapshot-drawer__actions-column">
                            <button
                              type="button"
                              className="btn btn--ghost snapshot-drawer__action-btn"
                              onClick={() =>
                                handlePinToggle(snap.id, Boolean(snap.pinned))
                              }
                              disabled={pinningId === snap.id}
                              aria-label={
                                snap.pinned ? "Unpin snapshot" : "Pin snapshot"
                              }
                            >
                              {pinningId === snap.id ?
                                "Updating…"
                              : snap.pinned ?
                                "Unpin"
                              : "Pin"}
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost snapshot-drawer__action-btn"
                              onClick={() => handleViewSnapshot(snap.id)}
                            >
                              View
                            </button>
                            <button
                              type="button"
                              className="btn btn--secondary snapshot-drawer__action-btn snapshot-drawer__action-btn--restore"
                              onClick={() => handleRestore(snap.id)}
                              disabled={restoringId === snap.id}
                            >
                              {restoringId === snap.id ?
                                "Restoring..."
                              : "Restore"}
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost snapshot-drawer__action-btn snapshot-drawer__action-btn--danger"
                              onClick={() => handleDeleteSnapshot(snap.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
