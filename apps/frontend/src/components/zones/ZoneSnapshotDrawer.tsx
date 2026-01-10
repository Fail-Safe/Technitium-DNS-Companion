import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "../../context/useToast";
import type {
  ZoneSnapshot,
  ZoneSnapshotCreateRequest,
  ZoneSnapshotMetadata,
  ZoneSnapshotRestoreOptions,
  ZoneSnapshotRestoreResult,
} from "../../types/zoneSnapshots";
import "../dhcp/DhcpSnapshotDrawer.css";

interface ZoneSnapshotDrawerProps {
  isOpen: boolean;
  nodeId?: string;
  nodeName?: string;
  initialZones?: string[];
  onClose: () => void;
  listSnapshots: (nodeId: string) => Promise<ZoneSnapshotMetadata[]>;
  createSnapshot: (
    nodeId: string,
    request: ZoneSnapshotCreateRequest,
  ) => Promise<ZoneSnapshotMetadata>;
  restoreSnapshot: (
    nodeId: string,
    snapshotId: string,
    options?: ZoneSnapshotRestoreOptions,
  ) => Promise<ZoneSnapshotRestoreResult>;
  setSnapshotPinned: (
    nodeId: string,
    snapshotId: string,
    pinned: boolean,
  ) => Promise<ZoneSnapshotMetadata>;
  getSnapshotDetail: (
    nodeId: string,
    snapshotId: string,
  ) => Promise<ZoneSnapshot>;
  deleteSnapshot: (nodeId: string, snapshotId: string) => Promise<void>;
  updateSnapshotNote: (
    nodeId: string,
    snapshotId: string,
    note?: string,
  ) => Promise<ZoneSnapshotMetadata>;
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

const splitZoneNames = (raw: string): string[] => {
  return raw
    .split(/[\n,]/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const expandTabsToSpaces = (input: string, tabSize: number): string => {
  if (!input.includes("\t")) return input;

  let col = 0;
  let output = "";

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (ch === "\n") {
      output += "\n";
      col = 0;
      continue;
    }

    if (ch === "\t") {
      const spaces = tabSize - (col % tabSize);
      output += " ".repeat(spaces);
      col += spaces;
      continue;
    }

    output += ch;
    col += 1;
  }

  return output;
};

const normalizeZoneFileForDisplay = (zoneFile?: string): string => {
  const raw = zoneFile ?? "";
  const normalizedNewlines = raw.replace(/\r\n/g, "\n");
  return expandTabsToSpaces(normalizedNewlines, 8);
};

type ZoneFileRecordTokens = {
  name: string;
  ttl: string;
  klass: string;
  type: string;
  data: string;
};

const tryParseZoneFileRecord = (line: string): ZoneFileRecordTokens | null => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("$")) return null;

  const match = line.match(/^(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/);
  if (!match) return null;

  const [, name, ttl, klass, type, data] = match;
  return { name, ttl, klass, type, data };
};

const padRight = (value: string, width: number) => {
  if (value.length >= width) return value;
  return `${value}${" ".repeat(width - value.length)}`;
};

const formatZoneFileTableForDisplay = (normalizedZoneFile: string) => {
  const lines = normalizedZoneFile.split("\n");
  const parsedByLine: Array<ZoneFileRecordTokens | null> = [];

  let nameWidth = "NAME".length;
  let ttlWidth = "TTL".length;
  let classWidth = 2; // prefer short label in narrow columns
  let typeWidth = "TYPE".length;
  let maxDataLen = "DATA".length;

  for (const line of lines) {
    const parsed = tryParseZoneFileRecord(line);
    parsedByLine.push(parsed);

    if (!parsed) continue;

    nameWidth = Math.max(nameWidth, parsed.name.length);
    ttlWidth = Math.max(ttlWidth, parsed.ttl.length);
    classWidth = Math.max(classWidth, parsed.klass.length);
    typeWidth = Math.max(typeWidth, parsed.type.length);
    maxDataLen = Math.max(maxDataLen, parsed.data.length);
  }

  const hasAnyRecords = parsedByLine.some((entry) => entry !== null);
  if (!hasAnyRecords) {
    return {
      headerText:
        "NAME                     TTL   CLASS TYPE  DATA\n" +
        "------------------------  ----  ----- ----  ------------------------------",
      bodyText: normalizedZoneFile,
    };
  }

  const gap = "  ";

  const classLabel = classWidth >= 5 ? "CLASS" : "CL";
  const headerLine =
    `${padRight("NAME", nameWidth)}${gap}` +
    `${padRight("TTL", ttlWidth)}${gap}` +
    `${padRight(classLabel, classWidth)}${gap}` +
    `${padRight("TYPE", typeWidth)}${gap}` +
    "DATA";

  const dataUnderlineLen = Math.max(16, Math.min(120, maxDataLen));
  const underlineLine =
    `${"-".repeat(nameWidth)}${gap}` +
    `${"-".repeat(ttlWidth)}${gap}` +
    `${"-".repeat(classWidth)}${gap}` +
    `${"-".repeat(typeWidth)}${gap}` +
    `${"-".repeat(dataUnderlineLen)}`;

  const formattedLines = lines.map((line, index) => {
    const parsed = parsedByLine[index];
    if (!parsed) return line;

    return (
      `${padRight(parsed.name, nameWidth)}${gap}` +
      `${padRight(parsed.ttl, ttlWidth)}${gap}` +
      `${padRight(parsed.klass, classWidth)}${gap}` +
      `${padRight(parsed.type, typeWidth)}${gap}` +
      parsed.data
    );
  });

  return {
    headerText: `${headerLine}\n${underlineLine}`,
    bodyText: formattedLines.join("\n"),
  };
};

export const ZoneSnapshotDrawer: React.FC<ZoneSnapshotDrawerProps> = ({
  isOpen,
  nodeId,
  nodeName,
  initialZones,
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

  const [snapshots, setSnapshots] = useState<ZoneSnapshotMetadata[]>([]);
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

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createZonesDraft, setCreateZonesDraft] = useState<string>("");
  const [createNoteDraft, setCreateNoteDraft] = useState<string>("");

  const [restoreDialogSnapshotId, setRestoreDialogSnapshotId] = useState<
    string | null
  >(null);
  const [restoreSelectedZones, setRestoreSelectedZones] = useState<Set<string>>(
    () => new Set(),
  );
  const [restoreDetailLoading, setRestoreDetailLoading] = useState(false);
  const [restoreDetailError, setRestoreDetailError] = useState<string | null>(
    null,
  );
  const [viewSnapshotId, setViewSnapshotId] = useState<string | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState<string | null>(null);
  const [snapshotDetails, setSnapshotDetails] = useState<
    Map<string, ZoneSnapshot>
  >(() => new Map());
  const [viewExpandedZoneDetails, setViewExpandedZoneDetails] = useState<
    Set<string>
  >(() => new Set());

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
        return a.pinned ? -1 : 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [snapshots]);

  const viewedSnapshot = useMemo(() => {
    if (!viewSnapshotId) return null;
    return snapshotDetails.get(viewSnapshotId) ?? null;
  }, [snapshotDetails, viewSnapshotId]);

  useEffect(() => {
    // Reset per-zone expanded state when changing which snapshot is being viewed.
    setViewExpandedZoneDetails(new Set());
  }, [viewSnapshotId]);

  const toggleViewZoneDetails = useCallback((zoneName: string) => {
    const normalized = zoneName?.trim();
    if (!normalized) return;

    setViewExpandedZoneDetails((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
  }, []);

  const restoreSnapshotDetail = useMemo(() => {
    if (!restoreDialogSnapshotId) return null;
    return snapshotDetails.get(restoreDialogSnapshotId) ?? null;
  }, [restoreDialogSnapshotId, snapshotDetails]);

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
    if (!isOpen) return;
    const zoneList = (initialZones ?? []).filter(Boolean);
    setCreateZonesDraft(zoneList.length > 0 ? zoneList.join("\n") : "");
    setCreateNoteDraft("");
  }, [initialZones, isOpen]);

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
    setViewSnapshotId(null);
    setViewError(null);
    setDeleteDialogSnapshotId(null);
    setRestoreDialogSnapshotId(null);
    setCreateDialogOpen(false);
    setNoteEditingId(null);
    setNoteDraft("");
    setCreateZonesDraft((initialZones ?? []).filter(Boolean).join("\n"));
    setCreateNoteDraft("");
  }, [nodeId, initialZones]);

  const isActive = animateIn && !animateOut;

  const openCreateDialog = () => {
    if (!nodeId) return;
    setCreateDialogOpen(true);
  };

  const closeCreateDialog = () => {
    setCreateDialogOpen(false);
    setCreating(false);
  };

  const handleCreateConfirm = async () => {
    if (!nodeId) return;

    const zones = splitZoneNames(createZonesDraft);
    if (zones.length === 0) {
      pushToast({
        message: "Enter at least one zone name to snapshot.",
        tone: "error",
        timeout: 6000,
      });
      return;
    }

    setCreating(true);
    try {
      const request: ZoneSnapshotCreateRequest = {
        zones,
        origin: "manual",
        note: createNoteDraft.trim() || undefined,
      };
      await createSnapshot(nodeId, request);
      await refresh();
      pushToast({
        message: "Snapshot created",
        tone: "success",
        timeout: 4000,
      });
      setCreateDialogOpen(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create snapshot.";
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
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to delete snapshot.";
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setDeletingId(null);
      setDeleteDialogSnapshotId(null);
    }
  };

  const startEditNote = (snapshot: ZoneSnapshotMetadata) => {
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
      pushToast({ message: "Note saved", tone: "success", timeout: 3000 });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save note.";
      pushToast({ message, tone: "error", timeout: 6000 });
    } finally {
      setNoteSavingId(null);
    }
  };

  const handleRestore = (snapshotId: string) => {
    setKeepExtras(true);
    setRestoreSelectedZones(new Set());
    setRestoreDialogSnapshotId(snapshotId);
  };

  useEffect(() => {
    if (!nodeId || !restoreDialogSnapshotId) return;

    if (snapshotDetails.has(restoreDialogSnapshotId)) {
      setRestoreDetailLoading(false);
      setRestoreDetailError(null);
      return;
    }

    setRestoreDetailLoading(true);
    setRestoreDetailError(null);

    (async () => {
      try {
        const detail = await getSnapshotDetail(nodeId, restoreDialogSnapshotId);
        setSnapshotDetails((prev) => {
          const next = new Map(prev);
          next.set(restoreDialogSnapshotId, detail);
          return next;
        });
      } catch (err) {
        setRestoreDetailError(
          err instanceof Error ? err.message : "Failed to load snapshot.",
        );
      } finally {
        setRestoreDetailLoading(false);
      }
    })();
  }, [getSnapshotDetail, nodeId, restoreDialogSnapshotId, snapshotDetails]);

  const toggleRestoreZone = useCallback((zoneName: string) => {
    const normalized = zoneName?.trim();
    if (!normalized) return;

    setRestoreSelectedZones((prev) => {
      const next = new Set(prev);
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
  }, []);

  const restoreSelectAll = useCallback(() => {
    const zones = restoreSnapshotDetail?.zones ?? [];
    setRestoreSelectedZones(
      new Set(zones.map((z) => z.zoneName).filter((z) => z?.trim().length > 0)),
    );
  }, [restoreSnapshotDetail]);

  const restoreSelectNone = useCallback(() => {
    setRestoreSelectedZones(new Set());
  }, []);

  const handleRestoreConfirm = async () => {
    if (!nodeId || !restoreDialogSnapshotId) return;
    const snapshotId = restoreDialogSnapshotId;

    if (restoreSelectedZones.size === 0) {
      pushToast({
        message: "Select at least one zone to restore.",
        tone: "error",
        timeout: 6000,
      });
      return;
    }

    setRestoringId(snapshotId);
    try {
      const options: ZoneSnapshotRestoreOptions = {
        keepNewZones: keepExtras,
        zoneNames: [...restoreSelectedZones],
      };
      const result = await restoreSnapshot(nodeId, snapshotId, options);
      await refresh();
      pushToast({
        message: `Restored ${result.restored} zone${result.restored === 1 ? "" : "s"}${keepExtras ? "" : `, deleted ${result.deleted}`}`,
        tone: "success",
        timeout: 5000,
      });

      if (onRestoreSuccess) {
        try {
          await onRestoreSuccess(nodeId);
        } catch (restoreRefreshError) {
          console.warn("Failed to refresh after restore", restoreRefreshError);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Restore failed.";
      pushToast({ message, tone: "error", timeout: 8000 });
    } finally {
      setRestoringId(null);
      setRestoreDialogSnapshotId(null);
    }
  };

  const handleRestoreCancel = () => {
    setRestoreDialogSnapshotId(null);
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
            <div className="snapshot-drawer__eyebrow">DNS Zone History</div>
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
              {createDialogOpen && (
                <div
                  className="snapshot-drawer__dialog-backdrop"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="create-dialog-title"
                >
                  <div className="snapshot-drawer__dialog snapshot-drawer__dialog--view">
                    <div className="snapshot-drawer__dialog-header">
                      <div>
                        <h3
                          id="create-dialog-title"
                          className="snapshot-drawer__dialog-title snapshot-drawer__dialog-title--lg"
                        >
                          Create snapshot
                        </h3>
                        <p className="snapshot-drawer__dialog-subtext">
                          Enter one or more zone names (comma or newline
                          separated).
                        </p>
                      </div>
                      <button
                        type="button"
                        className="modal__close"
                        onClick={closeCreateDialog}
                        aria-label="Close"
                      >
                        ×
                      </button>
                    </div>

                    <div className="snapshot-drawer__section-gap">
                      <label
                        className="snapshot-drawer__label"
                        htmlFor="zone-snapshot-zones"
                      >
                        Zone names
                      </label>
                      <textarea
                        id="zone-snapshot-zones"
                        className="snapshot-drawer__textarea"
                        rows={4}
                        value={createZonesDraft}
                        onChange={(event) =>
                          setCreateZonesDraft(event.target.value)
                        }
                        placeholder={"10.168.192.in-addr.arpa\nexample.com"}
                        disabled={creating}
                      />

                      <label
                        className="snapshot-drawer__label"
                        htmlFor="zone-snapshot-note"
                      >
                        Note (optional)
                      </label>
                      <textarea
                        id="zone-snapshot-note"
                        className="snapshot-drawer__textarea"
                        rows={2}
                        value={createNoteDraft}
                        onChange={(event) =>
                          setCreateNoteDraft(event.target.value)
                        }
                        placeholder="What are you about to change?"
                        disabled={creating}
                      />

                      <div className="snapshot-drawer__dialog-actions">
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={closeCreateDialog}
                          disabled={creating}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={handleCreateConfirm}
                          disabled={creating}
                        >
                          {creating ? "Creating..." : "Create"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

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
                          Select which zones to restore. Only the selected zones
                          will be affected.
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

                    {restoreDetailError && (
                      <div className="snapshot-drawer__alert">
                        {restoreDetailError}
                      </div>
                    )}

                    {restoreDetailLoading && !restoreSnapshotDetail && (
                      <div className="snapshot-drawer__loading">
                        Loading snapshot…
                      </div>
                    )}

                    {restoreSnapshotDetail && (
                      <div className="snapshot-drawer__scopes">
                        <div className="snapshot-drawer__section-stack">
                          <div className="snapshot-drawer__dialog-actions">
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={restoreSelectAll}
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={restoreSelectNone}
                            >
                              Select none
                            </button>
                          </div>

                          {(restoreSnapshotDetail.zones ?? []).map((entry) => {
                            const zoneName = entry.zoneName;
                            const checked = restoreSelectedZones.has(zoneName);

                            return (
                              <label
                                key={`${zoneName}-${String(entry.existed)}`}
                                className="snapshot-drawer__checkbox-card"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleRestoreZone(zoneName)}
                                />
                                <span>
                                  <strong>{zoneName}</strong>
                                  <span
                                    style={{
                                      display: "block",
                                      marginTop: "0.125rem",
                                      color: "var(--color-text-secondary)",
                                      fontSize: "0.9em",
                                    }}
                                  >
                                    {entry.existed ?
                                      "Restores full zone contents"
                                    : keepExtras ?
                                      "Will be kept (did not exist at snapshot time)"
                                    : "May be deleted (did not exist at snapshot time)"
                                    }
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <label className="snapshot-drawer__checkbox-card">
                      <input
                        type="checkbox"
                        checked={keepExtras}
                        onChange={(event) =>
                          setKeepExtras(event.target.checked)
                        }
                      />
                      Keep zones that did not exist at snapshot time
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
                        disabled={
                          restoringId === restoreDialogSnapshotId ||
                          restoreSelectedZones.size === 0 ||
                          Boolean(restoreDetailError)
                        }
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
                                <span>Zones: {meta.zoneCount}</span>
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
                          {(viewedSnapshot.zones ?? []).map((entry) => {
                            const isExpanded = viewExpandedZoneDetails.has(
                              entry.zoneName,
                            );
                            const zoneFileDisplay =
                              entry.zoneFile ?
                                normalizeZoneFileForDisplay(entry.zoneFile)
                              : undefined;

                            const zoneFileTable =
                              isExpanded && zoneFileDisplay ?
                                formatZoneFileTableForDisplay(zoneFileDisplay)
                              : null;

                            return (
                              <div
                                key={`${entry.zoneName}-${String(entry.existed)}`}
                                className="snapshot-drawer__scope-card"
                              >
                                <div className="snapshot-drawer__scope-header">
                                  <div className="snapshot-drawer__scope-title">
                                    <strong className="snapshot-drawer__scope-name">
                                      {entry.zoneName}
                                    </strong>
                                    <span
                                      className={`snapshot-drawer__pill ${
                                        entry.existed ?
                                          "snapshot-drawer__pill--enabled"
                                        : "snapshot-drawer__pill--disabled"
                                      }`}
                                    >
                                      <span
                                        aria-hidden
                                        className="snapshot-drawer__pill-dot"
                                        style={{
                                          background:
                                            entry.existed ? "#16a34a" : (
                                              "#94a3b8"
                                            ),
                                        }}
                                      />
                                      {entry.existed ? "Existed" : "New"}
                                    </span>
                                  </div>
                                  <span className="snapshot-drawer__scope-meta">
                                    {entry.existed ?
                                      "Existed at snapshot time"
                                    : "Did not exist at snapshot time"}
                                  </span>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "flex-end",
                                    marginTop: "0.5rem",
                                  }}
                                >
                                  <button
                                    type="button"
                                    className="btn btn--ghost"
                                    onClick={() =>
                                      toggleViewZoneDetails(entry.zoneName)
                                    }
                                    disabled={!entry.existed || !entry.zoneFile}
                                    aria-expanded={viewExpandedZoneDetails.has(
                                      entry.zoneName,
                                    )}
                                  >
                                    {(
                                      viewExpandedZoneDetails.has(
                                        entry.zoneName,
                                      )
                                    ) ?
                                      "Hide details"
                                    : "Details"}
                                  </button>
                                </div>

                                {viewExpandedZoneDetails.has(
                                  entry.zoneName,
                                ) && (
                                  <div className="snapshot-drawer__zonefile-card">
                                    <div className="snapshot-drawer__zonefile-header">
                                      <strong>Zone file (snapshot)</strong>
                                      <span className="snapshot-drawer__zonefile-subtitle">
                                        Full zone contents
                                      </span>
                                    </div>
                                    <div className="snapshot-drawer__zonefile-scroll">
                                      <div
                                        className="snapshot-drawer__zonefile-columns"
                                        aria-hidden="true"
                                      >
                                        <pre className="snapshot-drawer__zonefile-columns-pre">
                                          {zoneFileTable?.headerText ?? ""}
                                        </pre>
                                      </div>
                                      <pre className="snapshot-drawer__zonefile-pre">
                                        {zoneFileTable?.bodyText ??
                                          zoneFileDisplay ??
                                          "(No zone file stored)"}
                                      </pre>
                                    </div>
                                  </div>
                                )}
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
                    onClick={openCreateDialog}
                    disabled={loading}
                  >
                    Create snapshot
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
                Restoring overwrites the full contents of the selected zone(s).
                If "Keep zones" is unchecked, selected zones that did not exist
                at snapshot time may be deleted. Pinned snapshots are not
                removed by retention cleanup.
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
                    Capture the current DNS zones to enable quick rollback.
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
                            <span>Zones: {snapshot.zoneCount}</span>
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
