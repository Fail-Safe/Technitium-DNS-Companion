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

    return (
        <div className="node-selector">
            <div className="node-selector__label">
                <strong>Working on Node:</strong>
                <span className="node-selector__hint">
                    {hasUnsavedChanges ? (
                        <span style={{ color: '#e63946', fontWeight: 600 }}>⚠ Unsaved changes</span>
                    ) : isClusterEnabled ? (
                        'Only the Primary node can be modified'
                    ) : (
                        'Changes will only affect the selected node'
                    )}
                </span>
            </div>
            <div className="node-selector__cards">
                {nodes.map((node) => {
                    const isSelected = node.nodeId === selectedNodeId;
                    const groupCount = node.config?.groups?.length ?? 0;
                    const hasConfig = !!node.config;
                    const isPrimary = node.nodeId === primaryNodeId;
                    const isSecondary = isClusterEnabled && !isPrimary;
                    const isDisabled = loading || !hasConfig || isSecondary;

                    return (
                        <button
                            key={node.nodeId}
                            type="button"
                            className={`node-selector__card ${isSelected ? 'node-selector__card--selected' : ''} ${!hasConfig ? 'node-selector__card--no-config' : ''} ${isSecondary ? 'node-selector__card--secondary' : ''}`}
                            onClick={() => onSelectNode(node.nodeId)}
                            disabled={isDisabled}
                            title={isSecondary ? 'Secondary node - read-only in cluster mode' : undefined}
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
                                <h3 className="node-selector__card-title">
                                    {node.nodeId}
                                    {isPrimary && isClusterEnabled && (
                                        <span className="node-selector__card-badge node-selector__card-badge--primary">Primary</span>
                                    )}
                                    {isSecondary && (
                                        <span className="node-selector__card-badge node-selector__card-badge--secondary">Secondary</span>
                                    )}
                                </h3>
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
            </div>
        </div>
    );
}
