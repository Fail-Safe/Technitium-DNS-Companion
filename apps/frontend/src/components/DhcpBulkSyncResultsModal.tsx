import {
  faBan,
  faCheck,
  faExclamationTriangle,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React from "react";
import type { DhcpBulkSyncResult } from "../types/dhcp";
import "./DhcpBulkSyncResultsModal.css";

interface DhcpBulkSyncResultsModalProps {
  isOpen: boolean;
  result: DhcpBulkSyncResult | null;
  onClose: () => void;
  onRetry?: () => void;
}

/**
 * Modal displaying the results of a DHCP bulk sync operation
 */
export const DhcpBulkSyncResultsModal: React.FC<
  DhcpBulkSyncResultsModalProps
> = ({ isOpen, result, onClose, onRetry }) => {
  if (!isOpen || !result) return null;

  const hasFailures = result.totalFailed > 0;
  const allSuccess = result.totalFailed === 0 && result.totalSynced > 0;
  const partialSuccess = result.totalSynced > 0 && result.totalFailed > 0;
  const onlySkipped =
    result.totalSynced === 0 &&
    result.totalFailed === 0 &&
    result.totalSkipped > 0;

  // Determine overall status
  const getOverallStatus = () => {
    if (allSuccess) return "success";
    if (hasFailures && result.totalSynced === 0) return "error";
    return "warning";
  };

  const overallStatus = getOverallStatus();

  return (
    <div className="dhcp-bulk-sync-results-modal__overlay" onClick={onClose}>
      <div
        className="modal dhcp-bulk-sync-results-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Bulk sync results"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title">Bulk Sync Results</h2>
          <button
            className="modal__close"
            onClick={onClose}
            aria-label="Close"
            type="button"
          >
            ×
          </button>
        </div>

        <div className="modal__body">
          {/* Summary Section */}
          <div
            className={`dhcp-bulk-sync-results__summary dhcp-bulk-sync-results__summary--${overallStatus}`}
          >
            <div className="dhcp-bulk-sync-results__summary-icon">
              {allSuccess && <FontAwesomeIcon icon={faCheck} />}
              {(partialSuccess || overallStatus === "warning") && (
                <FontAwesomeIcon icon={faExclamationTriangle} />
              )}
              {overallStatus === "error" && <FontAwesomeIcon icon={faXmark} />}
            </div>
            <div className="dhcp-bulk-sync-results__summary-text">
              {allSuccess && <strong>Sync completed successfully!</strong>}
              {partialSuccess && <strong>Sync completed with warnings</strong>}
              {onlySkipped && (
                <strong>Nothing to sync — all scopes were skipped</strong>
              )}
              {overallStatus === "warning" &&
                !partialSuccess &&
                !onlySkipped && <strong>Sync completed with warnings</strong>}
              {overallStatus === "error" && <strong>Sync failed</strong>}
            </div>
          </div>

          {/* Statistics */}
          <div className="dhcp-bulk-sync-results__stats">
            <div className="dhcp-bulk-sync-results__stat dhcp-bulk-sync-results__stat--success">
              <div className="dhcp-bulk-sync-results__stat-value">
                {result.totalSynced}
              </div>
              <div className="dhcp-bulk-sync-results__stat-label">Synced</div>
            </div>
            {result.totalSkipped > 0 && (
              <div className="dhcp-bulk-sync-results__stat dhcp-bulk-sync-results__stat--skipped">
                <div className="dhcp-bulk-sync-results__stat-value">
                  {result.totalSkipped}
                </div>
                <div className="dhcp-bulk-sync-results__stat-label">
                  Skipped
                </div>
              </div>
            )}
            {result.totalFailed > 0 && (
              <div className="dhcp-bulk-sync-results__stat dhcp-bulk-sync-results__stat--failed">
                <div className="dhcp-bulk-sync-results__stat-value">
                  {result.totalFailed}
                </div>
                <div className="dhcp-bulk-sync-results__stat-label">Failed</div>
              </div>
            )}
          </div>

          {/* Per-Node Results */}
          <div className="dhcp-bulk-sync-results__nodes">
            <h3 className="dhcp-bulk-sync-results__section-title">
              Node Details
            </h3>
            {result.nodeResults.map((nodeResult) => (
              <div
                key={nodeResult.targetNodeId}
                className={`dhcp-bulk-sync-results__node dhcp-bulk-sync-results__node--${nodeResult.status}`}
              >
                <div className="dhcp-bulk-sync-results__node-header">
                  <span className="dhcp-bulk-sync-results__node-name">
                    {nodeResult.targetNodeId}
                  </span>
                  <span
                    className={`dhcp-bulk-sync-results__node-status dhcp-bulk-sync-results__node-status--${nodeResult.status}`}
                  >
                    {nodeResult.status === "success" && "Success"}
                    {nodeResult.status === "partial" && "Partial"}
                    {nodeResult.status === "failed" && "Failed"}
                  </span>
                </div>

                <div className="dhcp-bulk-sync-results__node-stats">
                  <span>
                    Synced: <strong>{nodeResult.syncedCount}</strong>
                  </span>
                  {nodeResult.skippedCount > 0 && (
                    <span>
                      Skipped: <strong>{nodeResult.skippedCount}</strong>
                    </span>
                  )}
                  {nodeResult.failedCount > 0 && (
                    <span>
                      Failed: <strong>{nodeResult.failedCount}</strong>
                    </span>
                  )}
                </div>

                {/* Per-Scope Results */}
                {nodeResult.scopeResults &&
                  nodeResult.scopeResults.length > 0 && (
                    <div className="dhcp-bulk-sync-results__scopes">
                      {nodeResult.scopeResults.map((scopeResult, idx) => (
                        <div
                          key={`${scopeResult.scopeName}-${idx}`}
                          className={`dhcp-bulk-sync-results__scope dhcp-bulk-sync-results__scope--${scopeResult.status}`}
                        >
                          <span className="dhcp-bulk-sync-results__scope-icon">
                            {scopeResult.status === "synced" && (
                              <FontAwesomeIcon icon={faCheck} />
                            )}
                            {scopeResult.status === "skipped" && (
                              <FontAwesomeIcon icon={faBan} />
                            )}
                            {scopeResult.status === "failed" && (
                              <FontAwesomeIcon icon={faXmark} />
                            )}
                          </span>
                          <span className="dhcp-bulk-sync-results__scope-name">
                            {scopeResult.scopeName}
                          </span>
                          <span
                            className={`dhcp-bulk-sync-results__scope-status dhcp-bulk-sync-results__scope-status--${scopeResult.status}`}
                          >
                            {scopeResult.status}
                          </span>
                          {(scopeResult.reason || scopeResult.error) && (
                            <div className="dhcp-bulk-sync-results__scope-message">
                              {scopeResult.reason || scopeResult.error}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            ))}
          </div>

          {/* Completed At */}
          <div className="dhcp-bulk-sync-results__footer-info">
            Completed at {new Date(result.completedAt).toLocaleString()}
          </div>
        </div>

        <div className="modal__footer">
          {hasFailures && onRetry && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
