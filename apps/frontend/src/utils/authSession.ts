export type AuthStatusLike = {
  authenticated?: boolean;
  sessionAuthEnabled?: boolean;
  configuredNodeIds?: string[];
  nodeIds?: string[];
  unreachableNodeIds?: string[];
  groupCredentials?: { groups: Array<{ state: string }> };
};

export function isNodeSessionRequiredButMissing(
  status: AuthStatusLike | null,
): boolean {
  if (!status?.authenticated) return false;
  if (status.groupCredentials) return false;

  const configuredNodeCount = status.configuredNodeIds?.length ?? 0;
  const sessionNodeIds = new Set(status.nodeIds ?? []);
  const unreachableNodeIds = new Set(status.unreachableNodeIds ?? []);

  // Missing tokens on reachable nodes usually means one or more Technitium
  // sessions expired while the Companion session cookie is still valid.
  // Nodes that were unreachable at login should not block degraded access.
  return (
    configuredNodeCount > 0 &&
    status.configuredNodeIds!.some(
      (nodeId) => !sessionNodeIds.has(nodeId) && !unreachableNodeIds.has(nodeId),
    )
  );
}
