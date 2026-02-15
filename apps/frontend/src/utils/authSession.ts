export type AuthStatusLike = {
  authenticated?: boolean;
  sessionAuthEnabled?: boolean;
  configuredNodeIds?: string[];
  nodeIds?: string[];
};

export function isNodeSessionRequiredButMissing(
  status: AuthStatusLike | null,
): boolean {
  if (!status?.authenticated) return false;

  const configuredNodeCount = status.configuredNodeIds?.length ?? 0;
  const sessionNodeCount = status.nodeIds?.length ?? 0;

  // When at least one node is configured but not all are currently authenticated
  // in this session, the common cause is that one or more Technitium session
  // tokens expired (while the Companion session cookie may still be valid).
  return configuredNodeCount > 0 && sessionNodeCount < configuredNodeCount;
}
