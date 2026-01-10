import React, { useEffect, useState } from "react";
import type { DhcpBulkSyncRequest } from "../types/dhcp";
import "./DhcpBulkSyncModal.css";

interface DhcpBulkSyncModalProps {
  isOpen: boolean;
  availableNodes: Array<{ id: string; name: string }>;
  selectedNode: { id: string; name: string };
  onConfirm: (request: DhcpBulkSyncRequest) => void;
  onCancel: () => void;
}

/**
 * Modal for configuring and initiating DHCP bulk synchronization
 */
export const DhcpBulkSyncModal: React.FC<DhcpBulkSyncModalProps> = ({
  isOpen,
  availableNodes,
  selectedNode,
  onConfirm,
  onCancel,
}) => {
  const [sourceNodeId, setSourceNodeId] = useState<string>("");
  const [enableOnTarget, setEnableOnTarget] = useState<boolean>(false);
  const [preserveOfferDelayTime, setPreserveOfferDelayTime] =
    useState<boolean>(true);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      // Default to first node as source if available
      if (availableNodes.length > 0) {
        setSourceNodeId(availableNodes[0].id);
      }
      setEnableOnTarget(false);
      setPreserveOfferDelayTime(true);
    }
  }, [isOpen, availableNodes, selectedNode.id]);

  // Validation
  const canConfirm =
    sourceNodeId && selectedNode.id && sourceNodeId !== selectedNode.id;

  const handleConfirm = () => {
    if (!canConfirm) return;

    const request: DhcpBulkSyncRequest = {
      sourceNodeId,
      targetNodeIds: [selectedNode.id],
      strategy: "overwrite-all",
      enableOnTarget,
      preserveOfferDelayTime,
    };

    onConfirm(request);
  };

  if (!isOpen) return null;

  return (
    <div className="dhcp-bulk-sync-modal__overlay" onClick={onCancel}>
      <div
        className="dhcp-bulk-sync-modal__dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Bulk Sync DHCP Scopes"
      >
        <div className="dhcp-bulk-sync-modal__header">
          <h2 className="dhcp-bulk-sync-modal__title">Bulk Sync DHCP Scopes</h2>
          <button
            className="dhcp-bulk-sync-modal__close"
            onClick={onCancel}
            aria-label="Close"
            type="button"
          >
            ×
          </button>
        </div>

        <div className="dhcp-bulk-sync-modal__body">
          {/* Source Node Selection */}
          <div className="field-group">
            <label htmlFor="bulk-sync-source" className="field-group__label">
              Source Node
            </label>
            <select
              id="bulk-sync-source"
              className="field-group__input"
              value={sourceNodeId}
              onChange={(e) => {
                setSourceNodeId(e.target.value);
              }}
            >
              <option value="">Select source node...</option>
              {availableNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} ({node.id})
                </option>
              ))}
            </select>
            <div className="field-group__hint">
              DHCP scopes will be copied from this node
            </div>
          </div>

          {/* Target Node Selection */}
          <div className="field-group">
            <label className="field-group__label">Target Node</label>
            <div className="field-group__value">
              {selectedNode.name} ({selectedNode.id})
            </div>
            {!availableNodes.some((node) => node.id !== selectedNode.id) && (
              <div className="field-group__hint field-group__hint--warning">
                {sourceNodeId ?
                  "No other nodes available for syncing"
                : "Select a source node first"}
              </div>
            )}
          </div>

          {/* Strategy Selection */}
          <div className="field-group">
            <label className="field-group__label">Sync Strategy</label>
            <div className="dhcp-bulk-sync-modal__strategy-list">
              <label className="dhcp-bulk-sync-modal__strategy-item">
                <input
                  type="radio"
                  name="strategy"
                  value="overwrite-all"
                  defaultChecked={true}
                  className="dhcp-bulk-sync-modal__radio"
                />
                <div className="dhcp-bulk-sync-modal__strategy-content">
                  <div className="dhcp-bulk-sync-modal__strategy-name">
                    Sync All{" "}
                    <span className="dhcp-bulk-sync-modal__strategy-badge dhcp-bulk-sync-modal__strategy-badge--warning">
                      Caution
                    </span>
                  </div>
                  <div className="dhcp-bulk-sync-modal__strategy-description">
                    Sync all scopes, replacing any existing scopes with the same
                    name on the target node.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Additional Options */}
          <div className="field-group">
            <label className="dhcp-bulk-sync-modal__option-item">
              <input
                type="checkbox"
                checked={enableOnTarget}
                onChange={(e) => setEnableOnTarget(e.target.checked)}
                className="dhcp-bulk-sync-modal__checkbox"
              />
              <div className="dhcp-bulk-sync-modal__option-content">
                <div className="dhcp-bulk-sync-modal__option-name">
                  Enable scopes on target nodes
                </div>
                <div className="dhcp-bulk-sync-modal__option-description">
                  Enable synced scopes immediately on target nodes (regardless
                  of source state)
                </div>
              </div>
            </label>
          </div>

          <div className="field-group">
            <label className="dhcp-bulk-sync-modal__option-item">
              <input
                type="checkbox"
                checked={preserveOfferDelayTime}
                onChange={(e) => setPreserveOfferDelayTime(e.target.checked)}
                className="dhcp-bulk-sync-modal__checkbox"
              />
              <div className="dhcp-bulk-sync-modal__option-content">
                <div className="dhcp-bulk-sync-modal__option-name">
                  Preserve offer delay time on targets
                </div>
                <div className="dhcp-bulk-sync-modal__option-description">
                  Keep each target scope's existing Offer Delay Time (ms). New
                  scopes copy Offer Delay Time from the source.
                </div>
              </div>
            </label>
          </div>
        </div>

        <div className="dhcp-bulk-sync-modal__footer">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            Start Sync
          </button>
        </div>
      </div>
    </div>
  );
};
