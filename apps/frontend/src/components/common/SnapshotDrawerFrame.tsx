import React from "react";

interface SnapshotDrawerFrameProps {
  isActive: boolean;
  isRendered: boolean;
  onClose: () => void;
  eyebrow: string;
  nodeId?: string;
  nodeName?: string;
  updatedAtLabel?: string;
  titleExtras?: React.ReactNode;
  children: React.ReactNode;
}

export const SnapshotDrawerFrame: React.FC<SnapshotDrawerFrameProps> = ({
  isActive,
  isRendered,
  onClose,
  eyebrow,
  nodeId,
  nodeName,
  updatedAtLabel,
  titleExtras,
  children,
}) => {
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
            <div className="snapshot-drawer__eyebrow">{eyebrow}</div>
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
              {titleExtras}
              {updatedAtLabel && (
                <span className="snapshot-drawer__updated-pill">
                  {updatedAtLabel}
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

        {children}
      </div>
    </div>
  );
};
