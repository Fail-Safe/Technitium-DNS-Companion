import React, { useState, useEffect, useMemo } from 'react';
import type { DhcpBulkSyncRequest, DhcpBulkSyncStrategy } from '../types/dhcp';

interface DhcpBulkSyncModalProps {
    isOpen: boolean;
    availableNodes: Array<{ id: string; name: string }>;
    onConfirm: (request: DhcpBulkSyncRequest) => void;
    onCancel: () => void;
}

/**
 * Modal for configuring and initiating DHCP bulk synchronization
 */
export const DhcpBulkSyncModal: React.FC<DhcpBulkSyncModalProps> = ({
    isOpen,
    availableNodes,
    onConfirm,
    onCancel,
}) => {
    const [sourceNodeId, setSourceNodeId] = useState<string>('');
    const [targetNodeIds, setTargetNodeIds] = useState<string[]>([]);
    const [strategy, setStrategy] = useState<DhcpBulkSyncStrategy>('skip-existing');
    const [enableOnTarget, setEnableOnTarget] = useState<boolean>(false);

    // Reset form when modal opens
    useEffect(() => {
        if (isOpen) {
            // Default to first node as source if available
            if (availableNodes.length > 0) {
                setSourceNodeId(availableNodes[0].id);
            }
            setTargetNodeIds([]);
            setStrategy('skip-existing');
            setEnableOnTarget(false);
        }
    }, [isOpen, availableNodes]);

    // Filter out source node from target options
    const availableTargets = useMemo(() => {
        return availableNodes.filter((node) => node.id !== sourceNodeId);
    }, [availableNodes, sourceNodeId]);

    // Validation
    const canConfirm = sourceNodeId && targetNodeIds.length > 0;

    const handleTargetToggle = (nodeId: string) => {
        setTargetNodeIds((prev) =>
            prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId],
        );
    };

    const handleSelectAllTargets = () => {
        setTargetNodeIds(availableTargets.map((node) => node.id));
    };

    const handleDeselectAllTargets = () => {
        setTargetNodeIds([]);
    };

    const handleConfirm = () => {
        if (!canConfirm) return;

        const request: DhcpBulkSyncRequest = {
            sourceNodeId,
            targetNodeIds,
            strategy,
            enableOnTarget,
        };

        onConfirm(request);
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal dhcp-bulk-sync-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal__header">
                    <h2 className="modal__title">Bulk Sync DHCP Scopes</h2>
                    <button
                        className="modal__close"
                        onClick={onCancel}
                        aria-label="Close"
                        type="button"
                    >
                        ×
                    </button>
                </div>

                <div className="modal__body">
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
                                // Clear targets when source changes
                                setTargetNodeIds([]);
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

                    {/* Target Nodes Selection */}
                    <div className="field-group">
                        <label className="field-group__label">Target Nodes</label>
                        {availableTargets.length === 0 ? (
                            <div className="field-group__hint field-group__hint--warning">
                                {sourceNodeId
                                    ? 'No other nodes available for syncing'
                                    : 'Select a source node first'}
                            </div>
                        ) : (
                            <>
                                <div className="dhcp-bulk-sync-modal__target-actions">
                                    <button
                                        type="button"
                                        className="btn btn--link btn--sm"
                                        onClick={handleSelectAllTargets}
                                    >
                                        Select All
                                    </button>
                                    <button
                                        type="button"
                                        className="btn btn--link btn--sm"
                                        onClick={handleDeselectAllTargets}
                                    >
                                        Deselect All
                                    </button>
                                </div>
                                <div className="dhcp-bulk-sync-modal__target-list">
                                    {availableTargets.map((node) => (
                                        <label
                                            key={node.id}
                                            className="dhcp-bulk-sync-modal__target-item"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={targetNodeIds.includes(node.id)}
                                                onChange={() => handleTargetToggle(node.id)}
                                                className="dhcp-bulk-sync-modal__checkbox"
                                            />
                                            <span className="dhcp-bulk-sync-modal__target-label">
                                                {node.name} ({node.id})
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                <div className="field-group__hint">
                                    Select one or more nodes to sync to
                                </div>
                            </>
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
                                    value="skip-existing"
                                    checked={strategy === 'skip-existing'}
                                    onChange={(e) =>
                                        setStrategy(e.target.value as DhcpBulkSyncStrategy)
                                    }
                                    className="dhcp-bulk-sync-modal__radio"
                                />
                                <div className="dhcp-bulk-sync-modal__strategy-content">
                                    <div className="dhcp-bulk-sync-modal__strategy-name">
                                        Skip Existing{' '}
                                        <span className="dhcp-bulk-sync-modal__strategy-badge">
                                            Recommended
                                        </span>
                                    </div>
                                    <div className="dhcp-bulk-sync-modal__strategy-description">
                                        Only sync scopes that don't already exist on the target
                                        nodes. Existing scopes are left unchanged.
                                    </div>
                                </div>
                            </label>

                            <label className="dhcp-bulk-sync-modal__strategy-item">
                                <input
                                    type="radio"
                                    name="strategy"
                                    value="overwrite-all"
                                    checked={strategy === 'overwrite-all'}
                                    onChange={(e) =>
                                        setStrategy(e.target.value as DhcpBulkSyncStrategy)
                                    }
                                    className="dhcp-bulk-sync-modal__radio"
                                />
                                <div className="dhcp-bulk-sync-modal__strategy-content">
                                    <div className="dhcp-bulk-sync-modal__strategy-name">
                                        Overwrite All{' '}
                                        <span className="dhcp-bulk-sync-modal__strategy-badge dhcp-bulk-sync-modal__strategy-badge--warning">
                                            Caution
                                        </span>
                                    </div>
                                    <div className="dhcp-bulk-sync-modal__strategy-description">
                                        Sync all scopes, replacing any existing scopes with the same
                                        name on target nodes.
                                    </div>
                                </div>
                            </label>

                            <label className="dhcp-bulk-sync-modal__strategy-item">
                                <input
                                    type="radio"
                                    name="strategy"
                                    value="merge-missing"
                                    checked={strategy === 'merge-missing'}
                                    onChange={(e) =>
                                        setStrategy(e.target.value as DhcpBulkSyncStrategy)
                                    }
                                    className="dhcp-bulk-sync-modal__radio"
                                />
                                <div className="dhcp-bulk-sync-modal__strategy-content">
                                    <div className="dhcp-bulk-sync-modal__strategy-name">
                                        Merge Missing
                                    </div>
                                    <div className="dhcp-bulk-sync-modal__strategy-description">
                                        Add scopes that don't exist on target, but preserve existing
                                        scopes (same as Skip Existing).
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
                                    Enable synced scopes immediately on target nodes (regardless of
                                    source state)
                                </div>
                            </div>
                        </label>
                    </div>
                </div>

                <div className="modal__footer">
                    <button type="button" className="btn btn--secondary" onClick={onCancel}>
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
