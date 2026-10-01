import type { GroupCredentialStatus } from "../auth/auth.types";
import { emptyAdmissions } from "../auth/group-credentials";
import type {
  TechnitiumCredentialProbe,
  TechnitiumNodeConfig,
} from "./technitium.types";

/** Evaluate schedule writes independently of Secondary token availability. */
export function buildScheduleGroupStatus(
  groupId: string,
  nodes: TechnitiumNodeConfig[],
  successful: Array<{
    node: TechnitiumNodeConfig;
    probe: TechnitiumCredentialProbe;
  }>,
  unreachableNodeIds: string[],
  failedNodeIds: string[],
  nodeRole: (
    node: TechnitiumNodeConfig,
    probe: TechnitiumCredentialProbe,
  ) => "Primary" | "Secondary" | undefined,
): GroupCredentialStatus {
  const admitted = emptyAdmissions();
  for (const { node, probe } of successful) {
    admitted.interactive.push(node.id);
    if (probe.permissions["Cache"]?.canDelete === true)
      admitted.cacheFlush.push(node.id);
    if (probe.permissions["DnsClient"]?.canView === true)
      admitted.ptrRead.push(node.id);
    if (probe.permissions["DhcpServer"]?.canView === true)
      admitted.dhcpRead.push(node.id);
    if (
      probe.topologyKnown !== true ||
      probe.permissions["Apps"]?.canModify !== true
    )
      continue;
    if (
      !probe.clusterInitialized ||
      (probe.clusterDomain &&
        nodeRole(node, probe) === "Primary" &&
        probe.clusterNodes.filter((member) => member.type === "Primary")
          .length === 1)
    )
      admitted.primaryConfigWrite.push(node.id);
  }
  // A cluster must have one authenticated Primary, with all configured members
  // identifiable in that Primary's topology. Multiple Primaries fail closed.
  const clustered = successful.some(({ probe }) => probe.clusterInitialized);
  const primary = successful.find(({ node }) =>
    admitted.primaryConfigWrite.includes(node.id),
  );
  if (
    clustered &&
    (admitted.primaryConfigWrite.length !== 1 ||
      !primary ||
      nodes.some(
        (node) =>
          !nodeRole(node, { ...primary.probe, dnsServerDomain: undefined }),
      ))
  )
    admitted.primaryConfigWrite = [];

  const ready = admitted.primaryConfigWrite.length > 0;
  const writeCapable = successful.filter(
    ({ probe }) =>
      probe.topologyKnown === true &&
      probe.permissions["Apps"]?.canModify === true,
  );
  const unavailable = nodes
    .filter(
      (node) =>
        !admitted.primaryConfigWrite.includes(node.id) &&
        !writeCapable.some((result) => result.node.id === node.id),
    )
    .map((node) => node.id);
  const complete =
    ready &&
    unavailable.length === 0 &&
    (!clustered || primary?.probe.clusterNodes.length === nodes.length);
  return {
    groupId,
    state: ready ? (complete ? "ready" : "degraded") : "failed",
    verifiedUsername: successful[0]?.probe.username,
    authenticatedNodeIds: successful.map(({ node }) => node.id),
    unreachableNodeIds,
    failedNodeIds,
    admittedNodeIds: admitted,
    capabilities: {
      ptrRead: admitted.ptrRead.length > 0,
      dhcpRead: admitted.dhcpRead.length > 0,
      primaryConfigWrite: ready,
      cacheFlush: admitted.cacheFlush.length > 0,
    },
    primaryCredential: ready
      ? { state: "ready", nodeId: admitted.primaryConfigWrite[0] }
      : { state: "unavailable" },
    failoverCoverage: ready ? (complete ? "complete" : "partial") : "none",
    secondaryCredentialUnavailableNodeIds: unavailable,
    reason: !ready
      ? "No confirmed current Primary has a valid schedule credential with Apps: Modify. Configure a token issued by the current Primary and revalidate DNS Schedules credentials; node-local scalar/group tokens do not provide unattended failover."
      : !complete
        ? "Primary credential is ready; a Secondary credential is unavailable. Unattended failover coverage is partial."
        : undefined,
  };
}
