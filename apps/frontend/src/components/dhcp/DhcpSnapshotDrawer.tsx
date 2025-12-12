import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../context/ToastContext";
import type {
  DhcpSnapshot,
  DhcpSnapshotMetadata,
  DhcpSnapshotRestoreOptions,
  DhcpSnapshotRestoreResult,
} from "../../types/dhcp";
import "./DhcpSnapshotDrawer.css";

interface DhcpSnapshotDrawerProps {
  isOpen: boolean;
  nodeId?: string;
  nodeName?: string;
  nodeScopeCount?: number;
  onClose: () => void;
  listSnapshots: (nodeId: string) => Promise<DhcpSnapshotMetadata[]>;
  createSnapshot: (nodeId: string) => Promise<DhcpSnapshotMetadata>;
  restoreSnapshot: (
    nodeId: string,
    snapshotId: string,
    options?: DhcpSnapshotRestoreOptions,
  ) => Promise<DhcpSnapshotRestoreResult>;
  setSnapshotPinned: (
    nodeId: string,
    snapshotId: string,
    pinned: boolean,
  ) => Promise<DhcpSnapshotMetadata>;
  getSnapshotDetail: (
    nodeId: string,
    snapshotId: string,
  ) => Promise<DhcpSnapshot>;
  deleteSnapshot: (nodeId: string, snapshotId: string) => Promise<void>;
  updateSnapshotNote: (
    nodeId: string,
    snapshotId: string,
    note?: string,
  ) => Promise<DhcpSnapshotMetadata>;
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

const formatArray = (values?: string[]): string => {
  if (!values || values.length === 0) return "—";
  return values.join(", ");
};

export const DhcpSnapshotDrawer: React.FC<DhcpSnapshotDrawerProps> = ({
  isOpen,
  nodeId,
  nodeName,
  nodeScopeCount,
  onClose,
  listSnapshots,
  createSnapshot,
  restoreSnapshot,
  setSnapshotPinned,
  getSnapshotDetail,
  deleteSnapshot,
  updateSnapshotNote,
}) => {
  const { pushToast } = useToast();
  const [snapshots, setSnapshots] = useState<DhcpSnapshotMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const [keepExtras, setKeepExtras] = useState(true);
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
    Map<string, DhcpSnapshot>
  >(() => new Map());
  const [deleteDialogSnapshotId, setDeleteDialogSnapshotId] = useState<
    string | null
  >(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>("");
  const [noteSavingId, setNoteSavingId] = useState<string | null>(null);

  const sortedSnapshots = useMemo(() => {
    return [...snapshots].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1; // Pinned snapshots first
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
      const data = await listSnapshots(nodeId);
      setSnapshots(data);
      setRefreshedAt(new Date().toISOString());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load snapshots.";
      setError(message);
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setLoading(false);
    }
  }, [listSnapshots, nodeId, pushToast]);

  useEffect(() => {
    if (isOpen && nodeId) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, nodeId]);

  useEffect(() => {
    setViewSnapshotId(null);
    setViewError(null);
    setViewLoading(false);
    setDeleteDialogSnapshotId(null);
    setNoteEditingId(null);
    setNoteDraft("");
  }, [nodeId]);

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

    // trigger exit animation before unmount
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
    if ((nodeScopeCount ?? 0) === 0) {
      pushToast({
        message:
          "No scopes to snapshot on this node yet. Add a scope first, then capture a snapshot.",
        tone: "info",
        timeout: 5000,
      });
      return;
    }
    setCreating(true);
    try {
      await createSnapshot(nodeId);
      await refresh();
      pushToast({
        message: "Snapshot created",
        tone: "success",
        timeout: 4000,
      });
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : "Failed to create snapshot.";
      const friendlyMessage =
        rawMessage.includes("no scopes") ?
          "This node has no scopes to snapshot. Add a scope first, then try again."
        : "Could not create snapshot. Please retry.";
      pushToast({ message: friendlyMessage, tone: "error", timeout: 6000 });
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (snapshotId: string) => {
    if (!nodeId) return;
    setKeepExtras(true);
    setRestoreDialogSnapshotId(snapshotId);
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update pin state.";
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setPinningId(null);
    }
  };

  const handleRestoreConfirm = async () => {
    if (!nodeId || !restoreDialogSnapshotId) return;
    const snapshotId = restoreDialogSnapshotId;

    setRestoringId(snapshotId);
    try {
      const result = await restoreSnapshot(nodeId, snapshotId, { keepExtras });
      await refresh();
      pushToast({
        message: `Restored ${result.restored} scope${result.restored === 1 ? "" : "s"}${keepExtras ? "" : `, deleted ${result.deleted}`}`,
        tone: "success",
        timeout: 5000,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to restore snapshot.";
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setRestoringId(null);
      setRestoreDialogSnapshotId(null);
    }
  };

  const handleRestoreCancel = () => {
    setRestoreDialogSnapshotId(null);
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load snapshot.";
      setViewError(message);
      pushToast({ message, tone: "error", timeout: 6000 });
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete snapshot.";
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setDeletingId(null);
      setDeleteDialogSnapshotId(null);
    }
  };

  const startEditNote = (snapshot: DhcpSnapshotMetadata) => {
    setNoteEditingId(snapshot.id);
    setNoteDraft(snapshot.note ?? "");
  };

  const cancelEditNote = () => {
    setNoteEditingId(null);
    setNoteDraft("");
  };

  const saveNote = async (snapshotId: string) => {
    if (!nodeId) return;
    setNoteSavingId(snapshotId);
    try {
      const updated = await updateSnapshotNote(
        nodeId,
        snapshotId,
        noteDraft.trim() || undefined,
      );
      setSnapshots((prev) =>
        prev.map((snap) =>
          snap.id === snapshotId ? { ...snap, ...updated } : snap,
        ),
      );
      setSnapshotDetails((prev) => {
        const next = new Map(prev);
        const detail = next.get(snapshotId);
        if (detail) {
          next.set(snapshotId, {
            ...detail,
            metadata: { ...detail.metadata, ...updated },
          });
        }
        return next;
      });
      setNoteEditingId(null);
      setNoteDraft("");
      pushToast({ message: "Note saved", tone: "success", timeout: 3500 });
    } catch (error) {
      const message =
        error instanceof Error ?
          error.message
        : "Failed to save snapshot note.";
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
            <div className="snapshot-drawer__eyebrow">DHCP History</div>
            <div className="snapshot-drawer__title-row">
              {/* <h2 className="modal__title snapshot-drawer__title">
                {nodeName || nodeId || "Select a node"}
              </h2> */}
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
                          Choose whether to keep scopes that are not part of
                          this snapshot. This applies only to this restore
                          action.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="modal__close"
                        onClick={handleRestoreCancel}
                        aria-label="Close"
                      >
                        ×
                      </button>
                    </div>

                    <label className="snapshot-drawer__checkbox-card">
                      <input
                        type="checkbox"
                        checked={keepExtras}
                        onChange={(event) =>
                          setKeepExtras(event.target.checked)
                        }
                      />
                      Scopes not in the snapshot should be kept
                    </label>

                    <div className="snapshot-drawer__dialog-actions">
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={handleRestoreCancel}
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
                            return (
                              <>
                                <span>
                                  Created {formatDateTime(meta.createdAt)}
                                </span>
                                <span>Scopes: {meta.scopeCount}</span>
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
                          <span>
                            {(
                              viewedSnapshot.metadata.note &&
                              viewedSnapshot.metadata.note.trim().length > 0
                            ) ?
                              viewedSnapshot.metadata.note
                            : "No note"}
                          </span>
                        </div>

                        <div className="snapshot-drawer__section-stack">
                          {viewedSnapshot.scopes.map((entry) => {
                            const leaseParts: string[] = [];
                            const scope = entry.scope;
                            if (scope.leaseTimeDays)
                              leaseParts.push(`${scope.leaseTimeDays}d`);
                            if (scope.leaseTimeHours)
                              leaseParts.push(`${scope.leaseTimeHours}h`);
                            if (scope.leaseTimeMinutes)
                              leaseParts.push(`${scope.leaseTimeMinutes}m`);

                            return (
                              <div
                                key={scope.name}
                                className="snapshot-drawer__scope-card"
                              >
                                <div className="snapshot-drawer__scope-header">
                                  <div className="snapshot-drawer__scope-title">
                                    <strong className="snapshot-drawer__scope-name">
                                      {scope.name}
                                    </strong>
                                    <span
                                      className={`snapshot-drawer__pill ${
                                        entry.enabled ?
                                          "snapshot-drawer__pill--enabled"
                                        : "snapshot-drawer__pill--disabled"
                                      }`}
                                    >
                                      <span
                                        aria-hidden
                                        className="snapshot-drawer__pill-dot"
                                        style={{
                                          background:
                                            entry.enabled ? "#16a34a" : (
                                              "#94a3b8"
                                            ),
                                        }}
                                      />
                                      {entry.enabled ? "Enabled" : "Disabled"}
                                    </span>
                                  </div>
                                  <span className="snapshot-drawer__scope-meta">
                                    Lease:{" "}
                                    {leaseParts.length ?
                                      leaseParts.join(" ")
                                    : "Default"}
                                  </span>
                                </div>

                                <div className="snapshot-drawer__grid">
                                  <div>
                                    <strong>Range:</strong>{" "}
                                    {scope.startingAddress} –{" "}
                                    {scope.endingAddress}
                                  </div>
                                  <div>
                                    <strong>Subnet:</strong> {scope.subnetMask}
                                  </div>
                                  <div>
                                    <strong>Router:</strong>{" "}
                                    {scope.routerAddress || "—"}
                                  </div>
                                  <div>
                                    <strong>DNS servers:</strong>{" "}
                                    {formatArray(scope.dnsServers)}
                                  </div>
                                  <div>
                                    <strong>Domain:</strong>{" "}
                                    {scope.domainName || "—"}
                                  </div>
                                  <div>
                                    <strong>Search list:</strong>{" "}
                                    {formatArray(scope.domainSearchList)}
                                  </div>
                                  <div>
                                    <strong>WINS servers:</strong>{" "}
                                    {formatArray(scope.winsServers)}
                                  </div>
                                  <div>
                                    <strong>NTP servers:</strong>{" "}
                                    {formatArray(scope.ntpServers)}
                                  </div>
                                </div>

                                <details>
                                  <summary className="snapshot-drawer__options-summary">
                                    Full DHCP options
                                  </summary>
                                  <pre className="snapshot-drawer__options-pre">
                                    {JSON.stringify(scope, null, 2)}
                                  </pre>
                                </details>
                              </div>
                            );
                          })}
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
                          This cannot be undone. Pinned status does not prevent
                          deletion here.
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
                    disabled={
                      creating || loading || (nodeScopeCount ?? 0) === 0
                    }
                    title={
                      (nodeScopeCount ?? 0) === 0 ?
                        "This node has no scopes to snapshot"
                      : undefined
                    }
                  >
                    {creating ? "Creating..." : "Create snapshot"}
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

              <div className="snapshot-drawer__warning">
                Restoring with "Keep scopes" unchecked will delete any scopes
                that do not exist in the snapshot. Pinned snapshots are kept
                even when retention is enforced.
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
                    Capture the current DHCP scopes to enable quick rollback.
                    Pinned snapshots never expire during retention cleanup.
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

                  {sortedSnapshots.map((snapshot) => (
                    <div key={snapshot.id} className="snapshot-drawer__item">
                      <div className="snapshot-drawer__item-header">
                        <div className="snapshot-drawer__item-main">
                          <div className="snapshot-drawer__item-meta">
                            <span className="snapshot-drawer__time-primary">
                              {formatRelative(snapshot.createdAt)}
                            </span>
                            <span className="snapshot-drawer__time-secondary">
                              {formatDateTime(snapshot.createdAt)}
                            </span>
                            {snapshot.pinned && (
                              <span className="snapshot-drawer__pin">
                                <span aria-hidden="true">📌</span>
                                Pinned
                              </span>
                            )}
                          </div>
                          <div className="snapshot-drawer__scope-count">
                            <span>Scopes: {snapshot.scopeCount}</span>
                            <span className="snapshot-drawer__pill-quiet">
                              {snapshot.origin === "automatic" ?
                                "Auto"
                              : "Manual"}
                            </span>
                          </div>
                          <div className="snapshot-drawer__snapshot-id">
                            <span>Snap ID: {snapshot.id}</span>
                          </div>
                          <div className="snapshot-drawer__note-box">
                            <div className="snapshot-drawer__note-header">
                              <strong>Note</strong>
                              {noteEditingId !== snapshot.id && (
                                <button
                                  type="button"
                                  className="btn btn--ghost snapshot-drawer__note-edit"
                                  onClick={() => startEditNote(snapshot)}
                                >
                                  {snapshot.note ? "Edit note" : "Add note"}
                                </button>
                              )}
                            </div>
                            {noteEditingId === snapshot.id ?
                              <div className="snapshot-drawer__section-gap">
                                <textarea
                                  value={noteDraft}
                                  onChange={(event) =>
                                    setNoteDraft(event.target.value)
                                  }
                                  rows={3}
                                  className="snapshot-drawer__textarea"
                                />
                                <div className="snapshot-drawer__note-actions">
                                  <button
                                    type="button"
                                    className="btn btn--ghost"
                                    onClick={cancelEditNote}
                                    disabled={noteSavingId === snapshot.id}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn--secondary"
                                    onClick={() => saveNote(snapshot.id)}
                                    disabled={noteSavingId === snapshot.id}
                                  >
                                    {noteSavingId === snapshot.id ?
                                      "Saving…"
                                    : "Save note"}
                                  </button>
                                </div>
                              </div>
                            : <div className="snapshot-drawer__pill-muted">
                                {(
                                  snapshot.note &&
                                  snapshot.note.trim().length > 0
                                ) ?
                                  <span>{snapshot.note}</span>
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
                              handlePinToggle(
                                snapshot.id,
                                Boolean(snapshot.pinned),
                              )
                            }
                            disabled={pinningId === snapshot.id}
                            aria-label={
                              snapshot.pinned ? "Unpin snapshot" : (
                                "Pin snapshot"
                              )
                            }
                          >
                            {pinningId === snapshot.id ?
                              "Updating…"
                            : snapshot.pinned ?
                              "Unpin"
                            : "Pin"}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost snapshot-drawer__action-btn"
                            onClick={() => handleViewSnapshot(snapshot.id)}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="btn btn--secondary snapshot-drawer__action-btn snapshot-drawer__action-btn--restore"
                            onClick={() => handleRestore(snapshot.id)}
                            disabled={restoringId === snapshot.id}
                          >
                            {restoringId === snapshot.id ?
                              "Restoring..."
                            : "Restore"}
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost snapshot-drawer__action-btn snapshot-drawer__action-btn--danger"
                            onClick={() => handleDeleteSnapshot(snapshot.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
