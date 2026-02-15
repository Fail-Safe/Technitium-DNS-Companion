import React from "react";

interface SnapshotDrawerActionsProps {
  primaryLabel: string;
  onPrimaryClick: () => void;
  primaryDisabled?: boolean;
  primaryTitle?: string;
  refreshLoading?: boolean;
  onRefreshClick: () => void;
  refreshDisabled?: boolean;
}

interface SnapshotDrawerErrorStateProps {
  message: string;
  onRetry: () => void;
}

interface SnapshotDrawerEmptyStateProps {
  title?: string;
  message: string;
}

interface SnapshotDrawerListHeaderProps {
  count: number;
  title?: string;
}

export const SnapshotDrawerActions: React.FC<SnapshotDrawerActionsProps> = ({
  primaryLabel,
  onPrimaryClick,
  primaryDisabled,
  primaryTitle,
  refreshLoading,
  onRefreshClick,
  refreshDisabled,
}) => {
  return (
    <div className="snapshot-drawer__actions">
      <div className="snapshot-drawer__actions-group">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onPrimaryClick}
          disabled={primaryDisabled}
          title={primaryTitle}
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onRefreshClick}
          disabled={refreshDisabled}
        >
          {refreshLoading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </div>
  );
};

export const SnapshotDrawerLoadingState: React.FC = () => {
  return <div className="dhcp-page__placeholder">Loading snapshots…</div>;
};

export const SnapshotDrawerErrorState: React.FC<
  SnapshotDrawerErrorStateProps
> = ({ message, onRetry }) => {
  return (
    <div className="snapshot-drawer__error">
      <div className="snapshot-drawer__error-header">
        <strong>Could not load snapshots</strong>
        <button
          type="button"
          className="btn btn--secondary snapshot-drawer__error-retry"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
      <span>{message}</span>
    </div>
  );
};

export const SnapshotDrawerEmptyState: React.FC<
  SnapshotDrawerEmptyStateProps
> = ({ title = "No snapshots yet", message }) => {
  return (
    <div className="snapshot-drawer__empty">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
};

export const SnapshotDrawerListHeader: React.FC<
  SnapshotDrawerListHeaderProps
> = ({ count, title = "Snapshots" }) => {
  return (
    <div className="snapshot-drawer__list-header">
      <span className="snapshot-drawer__list-title">{title}</span>
      <span className="snapshot-drawer__list-count">{count} total</span>
    </div>
  );
};
