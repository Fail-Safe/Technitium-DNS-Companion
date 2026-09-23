export type GroupCredentialState =
  | "ready"
  | "degraded"
  | "unreachable"
  | "failed"
  | "not-authorized";

export interface GroupCredentialStatus {
  groupId: string;
  state: GroupCredentialState;
  verifiedUsername?: string;
  authenticatedNodeIds: string[];
  unreachableNodeIds: string[];
  failedNodeIds: string[];
  admittedNodeIds: {
    interactive: string[];
    ptrRead: string[];
    dhcpRead: string[];
    primaryConfigWrite: string[];
    cacheFlush: string[];
  };
  capabilities: {
    ptrRead: boolean;
    dhcpRead: boolean;
    primaryConfigWrite: boolean;
    cacheFlush: boolean;
  };
  reason?: string;
}

export interface GroupCredentialStatusEnvelope {
  anyReady: boolean;
  allReady: boolean;
  groups: GroupCredentialStatus[];
}
