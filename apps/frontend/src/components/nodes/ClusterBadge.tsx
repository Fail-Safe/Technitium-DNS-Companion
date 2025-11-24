import type { TechnitiumClusterState } from '../../context/TechnitiumContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';

interface ClusterBadgeProps {
    clusterState?: TechnitiumClusterState;
    className?: string;
}

export default function ClusterBadge({ clusterState, className = '' }: ClusterBadgeProps) {
    if (!clusterState || !clusterState.initialized) {
        return (
            <span
                className={`cluster-badge cluster-badge--standalone ${className}`}
                title="Standalone node (not clustered)"
            >
                Standalone
            </span>
        );
    }

    const isPrimary = clusterState.type === 'Primary';
    const isSecondary = clusterState.type === 'Secondary';
    const isUnreachable = clusterState.health === 'Unreachable';

    // Health/reachability indicator
    if (isUnreachable) {
        return (
            <span
                className={`cluster-badge cluster-badge--unreachable ${className}`}
                title="Node unreachable - cannot determine cluster status"
            >
                ⚠ Unreachable
            </span>
        );
    }

    // Primary node badge
    if (isPrimary) {
        return (
            <span
                className={`cluster-badge cluster-badge--primary ${className}`}
                title={`Primary node in cluster: ${clusterState.domain || 'unknown'}`}
            >
                Primary
            </span>
        );
    }

    // Secondary node badge
    if (isSecondary) {
        return (
            <span
                className={`cluster-badge cluster-badge--secondary ${className}`}
                title={`Secondary node in cluster: ${clusterState.domain || 'unknown'}`}
            >
                Secondary
            </span>
        );
    }

    // Default clustered badge (shouldn't reach here normally)
    return (
        <span
            className={`cluster-badge cluster-badge--clustered ${className}`}
            title={`Clustered: ${clusterState.domain || 'unknown'}`}
        >
            Clustered
        </span>
    );
}
