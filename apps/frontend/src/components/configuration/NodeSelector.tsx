import type { AdvancedBlockingSnapshot } from '../../types/advancedBlocking';

interface NodeSelectorProps {
    nodes: AdvancedBlockingSnapshot[];
    selectedNodeId: string;
    onSelectNode: (nodeId: string) => void;
    loading?: boolean;
    hasUnsavedChanges?: boolean;
    primaryNodeId?: string; // ID of the Primary node in cluster
    isClusterEnabled?: boolean; // Whether clustering is active
}

export function NodeSelector({
    nodes,
    selectedNodeId,
    onSelectNode,
    loading,
    hasUnsavedChanges,
    primaryNodeId,
    isClusterEnabled = false,
}: NodeSelectorProps) {
    if (nodes.length === 0) {
        return null;
    }

    // Separate primary and secondary nodes for different rendering
    const primaryNode = isClusterEnabled ? nodes.find(n => n.nodeId === primaryNodeId) : null;
    const secondaryNodes = isClusterEnabled ? nodes.filter(n => n.nodeId !== primaryNodeId) : [];
    const nonClusterNodes = !isClusterEnabled ? nodes : [];

    return (
        <div className="node-selector">
            <div className="node-selector__label">
                <strong>Working on Node:</strong>
                <span className="node-selector__hint">
                    {hasUnsavedChanges ? (
                        <span className="node-selector__unsaved-warning">⚠ Unsaved changes</span>
                    ) : isClusterEnabled ? (
                        'Only the Primary node can be modified'
                    ) : (
                        'Changes will only affect the selected node'
                    )}
                </span>
            </div>
            <div className="node-selector__cards">
                {/* Non-cluster mode: show all nodes with full details */}
                {nonClusterNodes.map((node) => {
                    const isSelected = node.nodeId === selectedNodeId;
                    const groupCount = node.config?.groups?.length ?? 0;
                    const hasConfig = !!node.config;
                    const isDisabled = loading || !hasConfig;

                    return (
                        <button
                            key={node.nodeId}
                            type="button"
                            className={`node-selector__card ${isSelected ? 'node-selector__card--selected' : ''} ${!hasConfig ? 'node-selector__card--no-config' : ''}`}
                            onClick={() => onSelectNode(node.nodeId)}
                            disabled={isDisabled}
                        >
                            <div className="node-selector__card-radio">
                                <input
                                    type="radio"
                                    name="selected-node"
                                    checked={isSelected}
                                    onChange={() => onSelectNode(node.nodeId)}
                                    disabled={isDisabled}
                                    aria-label={`Select ${node.nodeId}`}
                                />
                            </div>
                            <div className="node-selector__card-content">
                                <h3 className="node-selector__card-title">{node.nodeId}</h3>
                                <div className="node-selector__card-stats">
                                    {hasConfig ? (
                                        <>
                                            <span>{groupCount} group{groupCount !== 1 ? 's' : ''}</span>
                                            {node.metrics && (
                                                <>
                                                    <span> · {
                                                        node.metrics.blockListUrlCount +
                                                        node.metrics.allowListUrlCount +
                                                        node.metrics.adblockListUrlCount +
                                                        node.metrics.regexBlockListUrlCount +
                                                        node.metrics.regexAllowListUrlCount
                                                    } list entr{(
                                                        node.metrics.blockListUrlCount +
                                                        node.metrics.allowListUrlCount +
                                                        node.metrics.adblockListUrlCount +
                                                        node.metrics.regexBlockListUrlCount +
                                                        node.metrics.regexAllowListUrlCount
                                                    ) !== 1 ? 'ies' : 'y'}</span>
                                                    <span> · {
                                                        node.metrics.blockedDomainCount +
                                                        node.metrics.allowedDomainCount +
                                                        node.metrics.blockedRegexCount +
                                                        node.metrics.allowedRegexCount
                                                    } domain rule{(
                                                        node.metrics.blockedDomainCount +
                                                        node.metrics.allowedDomainCount +
                                                        node.metrics.blockedRegexCount +
                                                        node.metrics.allowedRegexCount
                                                    ) !== 1 ? 's' : ''}</span>
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <span className="node-selector__card-no-config">No configuration</span>
                                    )}
                                </div>
                            </div>
                        </button>
                    );
                })}

                {/* Cluster mode: Primary node with full details */}
                {primaryNode && (() => {
                    const isSelected = primaryNode.nodeId === selectedNodeId;
                    const groupCount = primaryNode.config?.groups?.length ?? 0;
                    const hasConfig = !!primaryNode.config;
                    const isDisabled = loading || !hasConfig;

                    return (
                        <button
                            key={primaryNode.nodeId}
                            type="button"
                            className={`node-selector__card ${isSelected ? 'node-selector__card--selected' : ''} ${!hasConfig ? 'node-selector__card--no-config' : ''}`}
                            onClick={() => onSelectNode(primaryNode.nodeId)}
                            disabled={isDisabled}
                        >
                            <div className="node-selector__card-radio">
                                <input
                                    type="radio"
                                    name="selected-node"
                                    checked={isSelected}
                                    onChange={() => onSelectNode(primaryNode.nodeId)}
                                    disabled={isDisabled}
                                    aria-label={`Select ${primaryNode.nodeId}`}
                                />
                            </div>
                            <div className="node-selector__card-content">
                                <h3 className="node-selector__card-title">
                                    {primaryNode.nodeId}
                                    <span className="node-selector__card-badge node-selector__card-badge--primary">Primary</span>
                                </h3>
                                <div className="node-selector__card-stats">
                                    {hasConfig ? (
                                        <>
                                            <span>{groupCount} group{groupCount !== 1 ? 's' : ''}</span>
                                            {primaryNode.metrics && (
                                                <>
                                                    <span> · {
                                                        primaryNode.metrics.blockListUrlCount +
                                                        primaryNode.metrics.allowListUrlCount +
                                                        primaryNode.metrics.adblockListUrlCount +
                                                        primaryNode.metrics.regexBlockListUrlCount +
                                                        primaryNode.metrics.regexAllowListUrlCount
                                                    } list entr{(
                                                        primaryNode.metrics.blockListUrlCount +
                                                        primaryNode.metrics.allowListUrlCount +
                                                        primaryNode.metrics.adblockListUrlCount +
                                                        primaryNode.metrics.regexBlockListUrlCount +
                                                        primaryNode.metrics.regexAllowListUrlCount
                                                    ) !== 1 ? 'ies' : 'y'}</span>
                                                    <span> · {
                                                        primaryNode.metrics.blockedDomainCount +
                                                        primaryNode.metrics.allowedDomainCount +
                                                        primaryNode.metrics.blockedRegexCount +
                                                        primaryNode.metrics.allowedRegexCount
                                                    } domain rule{(
                                                        primaryNode.metrics.blockedDomainCount +
                                                        primaryNode.metrics.allowedDomainCount +
                                                        primaryNode.metrics.blockedRegexCount +
                                                        primaryNode.metrics.allowedRegexCount
                                                    ) !== 1 ? 's' : ''}</span>
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <span className="node-selector__card-no-config">No configuration</span>
                                    )}
                                </div>
                            </div>
                        </button>
                    );
                })()}

                {/* Cluster mode: Secondary nodes - compact single row */}
                {secondaryNodes.length > 0 && (
                    <div className="node-selector__secondaries">
                        <span className="node-selector__secondaries-label">Secondary nodes:</span>
                        {secondaryNodes.map((node) => (
                            <span key={node.nodeId} className="node-selector__secondary-chip">
                                {node.nodeId}
                                <span className="node-selector__secondary-status" title="In sync with Primary">✓</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
