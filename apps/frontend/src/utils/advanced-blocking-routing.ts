interface AdvancedBlockingRouteNode {
  id: string;
  groupId?: string;
  isPrimary?: boolean;
}

interface AdvancedBlockingRouteSnapshot {
  nodeId: string;
}

const DEFAULT_GROUP_ID = "__default__";

function getNodeGroupId(node: AdvancedBlockingRouteNode): string {
  return node.groupId ?? DEFAULT_GROUP_ID;
}

export function resolveAdvancedBlockingWriteNodeId(
  nodes: AdvancedBlockingRouteNode[],
  sourceNodeId: string,
): string {
  const sourceNode = nodes.find((node) => node.id === sourceNodeId);
  if (!sourceNode) {
    return sourceNodeId;
  }

  const sourceGroupId = getNodeGroupId(sourceNode);
  return (
    nodes.find(
      (node) =>
        node.isPrimary === true && getNodeGroupId(node) === sourceGroupId,
    )?.id ?? sourceNodeId
  );
}

export function selectAdvancedBlockingWriteSnapshots<
  T extends AdvancedBlockingRouteSnapshot,
>(nodes: AdvancedBlockingRouteNode[], snapshots: T[]): T[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const primaryNodeIdsByGroup = new Map<string, string>();
  nodes.forEach((node) => {
    if (node.isPrimary === true) {
      primaryNodeIdsByGroup.set(getNodeGroupId(node), node.id);
    }
  });

  return snapshots.filter((snapshot) => {
    const node = nodesById.get(snapshot.nodeId);
    if (!node) {
      return false;
    }

    const primaryNodeId = primaryNodeIdsByGroup.get(getNodeGroupId(node));
    return !primaryNodeId || snapshot.nodeId === primaryNodeId;
  });
}
