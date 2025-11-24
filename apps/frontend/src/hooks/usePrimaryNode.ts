import { useMemo } from 'react';
import type { TechnitiumNode } from '../context/TechnitiumContext';

/**
 * Hook to find the Primary node in a Technitium DNS cluster.
 * Returns the Primary node or undefined if no Primary exists.
 */
export function usePrimaryNode(nodes: TechnitiumNode[]): TechnitiumNode | undefined {
    return useMemo(() => {
        return nodes.find(node => node.isPrimary === true);
    }, [nodes]);
}

/**
 * Hook to check if clustering is enabled (at least one node has cluster state).
 * Returns true if any node has clusterState.initialized === true.
 */
export function useIsClusterEnabled(nodes: TechnitiumNode[]): boolean {
    return useMemo(() => {
        return nodes.some(node => node.clusterState?.initialized === true);
    }, [nodes]);
}

/**
 * Hook to get all Primary and Secondary nodes separately.
 * Useful for showing Primary-only restrictions.
 */
export function useClusterNodes(nodes: TechnitiumNode[]): {
    primary: TechnitiumNode | undefined;
    secondaries: TechnitiumNode[];
    isClusterEnabled: boolean;
} {
    return useMemo(() => {
        const isClusterEnabled = nodes.some(node => node.clusterState?.initialized === true);
        const primary = nodes.find(node => node.isPrimary === true);
        const secondaries = nodes.filter(node => node.clusterState?.type === 'Secondary');

        return {
            primary,
            secondaries,
            isClusterEnabled,
        };
    }, [nodes]);
}
