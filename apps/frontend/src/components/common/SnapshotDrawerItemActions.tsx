import React from "react";

interface SnapshotDrawerItemActionsProps {
  snapshotId: string;
  pinned?: boolean;
  pinning?: boolean;
  restoring?: boolean;
  onPinToggle: (snapshotId: string, pinned: boolean) => void;
  onView: (snapshotId: string) => void;
  onRestore: (snapshotId: string) => void;
  onDelete: (snapshotId: string) => void;
}

export const SnapshotDrawerItemActions: React.FC<
  SnapshotDrawerItemActionsProps
> = ({
  snapshotId,
  pinned,
  pinning,
  restoring,
  onPinToggle,
  onView,
  onRestore,
  onDelete,
}) => {
  return (
    <div className="snapshot-drawer__actions-column">
      <button
        type="button"
        className="btn btn--ghost snapshot-drawer__action-btn"
        onClick={() => onPinToggle(snapshotId, Boolean(pinned))}
        disabled={pinning}
        aria-label={pinned ? "Unpin snapshot" : "Pin snapshot"}
      >
        {pinning ?
          "Updating…"
        : pinned ?
          "Unpin"
        : "Pin"}
      </button>
      <button
        type="button"
        className="btn btn--ghost snapshot-drawer__action-btn"
        onClick={() => onView(snapshotId)}
      >
        View
      </button>
      <button
        type="button"
        className="btn btn--secondary snapshot-drawer__action-btn snapshot-drawer__action-btn--restore"
        onClick={() => onRestore(snapshotId)}
        disabled={restoring}
      >
        {restoring ? "Restoring..." : "Restore"}
      </button>
      <button
        type="button"
        className="btn btn--ghost snapshot-drawer__action-btn snapshot-drawer__action-btn--danger"
        onClick={() => onDelete(snapshotId)}
      >
        Delete
      </button>
    </div>
  );
};
