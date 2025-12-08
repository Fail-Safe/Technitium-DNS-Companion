import type { AdvancedBlockingSnapshot } from '../../types/advancedBlocking';
import type { BuiltInBlockingSnapshot, BlockingMethod } from '../../types/builtInBlocking';

type NodeSnapshot = AdvancedBlockingSnapshot | BuiltInBlockingSnapshot;

interface NodeSelectorProps {
    nodes: NodeSnapshot[];
    blockingMethod: BlockingMethod;
    selectedNodeId: string;
    onSelectNode: (nodeId: string) => void;
    loading?: boolean;
    hasUnsavedChanges?: boolean;
    primaryNodeId?: string; // ID of the Primary node in cluster
    isClusterEnabled?: boolean; // Whether clustering is active
    overrideCounts?: { allowed?: number; blocked?: number };
}

const isAdvancedSnapshot = (node: NodeSnapshot): node is AdvancedBlockingSnapshot =>
    'config' in node;

const isBuiltInSnapshot = (node: NodeSnapshot): node is BuiltInBlockingSnapshot =>
    'allowedCount' in node.metrics && 'blockedCount' in node.metrics;

const formatListEntries = (count: number) => {
    const value = count.toLocaleString();
    return `${value} list entr${count === 1 ? 'y' : 'ies'}`;
};

const formatDomainRules = (count: number) => {
    const value = count.toLocaleString();
    return `${value} domain rule${count === 1 ? '' : 's'}`;
};

const formatBlockListLabel = (count: number) => {
    const value = count.toLocaleString();
    return `${value} block list${count === 1 ? '' : 's'}`;
};

export function NodeSelector({
    nodes,
    blockingMethod,
    selectedNodeId,
    onSelectNode,
    loading,
    hasUnsavedChanges,
    primaryNodeId,
    isClusterEnabled = false,
    overrideCounts,
}: NodeSelectorProps) {
    if (nodes.length === 0) {
        return null;
    }

    const primaryNode = isClusterEnabled ? nodes.find((n) => n.nodeId === primaryNodeId) : null;
    const secondaryNodes = isClusterEnabled ? nodes.filter((n) => n.nodeId !== primaryNodeId) : [];
    const nonClusterNodes = isClusterEnabled ? [] : nodes;
    const fallbackLabel = blockingMethod === 'built-in' ? 'Built-in data unavailable' : 'No configuration';

    const renderNodeStats = (node: NodeSnapshot) => {
        if (isAdvancedSnapshot(node)) {
            if (!node.config) {
                return <span className="node-selector__card-no-config">{fallbackLabel}</span>;
            }
            const groupCount = node.config.groups?.length ?? 0;
            const listTotal =
                node.metrics.blockListUrlCount +
                node.metrics.allowListUrlCount +
                node.metrics.adblockListUrlCount +
                node.metrics.regexBlockListUrlCount +
                node.metrics.regexAllowListUrlCount;
            const domainTotal =
                node.metrics.blockedDomainCount +
                node.metrics.allowedDomainCount +
                node.metrics.blockedRegexCount +
                node.metrics.allowedRegexCount;

            return (
                <>
                    <span>{groupCount} group{groupCount !== 1 ? 's' : ''}</span>
                    <span> · {formatListEntries(listTotal)}</span>
                    <span> · {formatDomainRules(domainTotal)}</span>
                </>
            );
        }

        if (isBuiltInSnapshot(node)) {
            const isSelected = node.nodeId === selectedNodeId;
            const blockListCount = node.metrics.blockListUrlCount ?? 0;
            const allowedCount = isSelected && overrideCounts?.allowed !== undefined
                ? overrideCounts.allowed
                : node.metrics.allowedCount ?? 0;
            const blockedCount = isSelected && overrideCounts?.blocked !== undefined
                ? overrideCounts.blocked
                : node.metrics.blockedCount ?? 0;
            const statusLabel = node.metrics.blockingEnabled ? 'Blocking ON' : 'Blocking OFF';

            return (
                <>
                    <span>{formatBlockListLabel(blockListCount)}</span>
                    <span> · {allowedCount.toLocaleString()} allowed</span>
                    <span> · {blockedCount.toLocaleString()} blocked</span>
                    <span> · {statusLabel}</span>
                </>
            );
        }

        return <span className="node-selector__card-no-config">{fallbackLabel}</span>;
    };

    const isNodeDisabled = (node: NodeSnapshot) => {
        if (isAdvancedSnapshot(node)) {
            return loading || !node.config;
        }
        return !!loading;
    };

    const renderNodeCard = (node: NodeSnapshot, isPrimary = false) => {
        const isSelected = node.nodeId === selectedNodeId;
        const hasConfig = isAdvancedSnapshot(node) ? !!node.config : true;
        const isDisabled = isNodeDisabled(node);
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
                    <h3 className="node-selector__card-title">
                        {node.nodeId}
                        {isPrimary && (
                            <span className="node-selector__card-badge node-selector__card-badge--primary">Primary</span>
                        )}
                    </h3>
                    <div className="node-selector__card-stats">
                        {renderNodeStats(node)}
                    </div>
                </div>
            </button>
        );
    };

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
                {nonClusterNodes.map((node) => renderNodeCard(node))}

                {/* Cluster mode: Primary node with full details */}
                {primaryNode && renderNodeCard(primaryNode, true)}

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
