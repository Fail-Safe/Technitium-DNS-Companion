import type {
  GroupCredentialStatus,
  GroupCredentialStatusEnvelope,
} from "./auth.types";

export interface GroupCredential {
  username: string;
  token: string;
}

export function emptyAdmissions(): GroupCredentialStatus["admittedNodeIds"] {
  return {
    interactive: [],
    ptrRead: [],
    dhcpRead: [],
    primaryConfigWrite: [],
    cacheFlush: [],
  };
}

export function notAuthorizedGroupStatus(
  groupId: string,
  reason = "No credential is configured for this group.",
): GroupCredentialStatus {
  return {
    groupId,
    state: "not-authorized",
    authenticatedNodeIds: [],
    unreachableNodeIds: [],
    failedNodeIds: [],
    admittedNodeIds: emptyAdmissions(),
    capabilities: {
      ptrRead: false,
      dhcpRead: false,
      primaryConfigWrite: false,
      cacheFlush: false,
    },
    reason,
  };
}

export function buildGroupCredentialEnvelope(
  groups: GroupCredentialStatus[],
): GroupCredentialStatusEnvelope {
  const authorized = groups.filter((group) => group.state !== "not-authorized");
  return {
    anyReady: authorized.some(
      (group) =>
        (group.state === "ready" || group.state === "degraded") &&
        group.admittedNodeIds.interactive.length > 0,
    ),
    allReady:
      authorized.length > 0 &&
      authorized.every((group) => group.state === "ready"),
    groups,
  };
}

export function singularVerifiedUsername(
  usernamesByGroup: Record<string, string>,
): string | undefined {
  const usernames = [...new Set(Object.values(usernamesByGroup))];
  return usernames.length === 1 ? usernames[0] : undefined;
}
