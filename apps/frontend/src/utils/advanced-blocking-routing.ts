interface AdvancedBlockingRouteNode {
  id: string;
  isPrimary?: boolean;
}

interface AdvancedBlockingRouteSnapshot {
  nodeId: string;
}

export function resolveAdvancedBlockingWriteNodeId(
  nodes: AdvancedBlockingRouteNode[],
  sourceNodeId: string,
): string {
  return nodes.find((node) => node.isPrimary === true)?.id ?? sourceNodeId;
}

export function selectAdvancedBlockingWriteSnapshots<
  T extends AdvancedBlockingRouteSnapshot,
>(nodes: AdvancedBlockingRouteNode[], snapshots: T[]): T[] {
  const primaryNodeId = nodes.find((node) => node.isPrimary === true)?.id;
  if (!primaryNodeId) {
    return snapshots;
  }

  return snapshots.filter((snapshot) => snapshot.nodeId === primaryNodeId);
}
