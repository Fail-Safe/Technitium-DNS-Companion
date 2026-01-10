import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, triggerAuthRedirect } from "../config";
import type {
  AdvancedBlockingConfig,
  AdvancedBlockingOverview,
  AdvancedBlockingSnapshot,
} from "../types/advancedBlocking";
import type {
  BlockingMethod,
  BlockingSettings,
  BlockingStatusOverview,
  BlockingZoneListResponse,
  BlockingZoneOperationResult,
  BuiltInBlockingOverview,
} from "../types/builtInBlocking";
import type {
  DhcpBulkSyncRequest,
  DhcpBulkSyncResult,
  DhcpSnapshot,
  DhcpSnapshotMetadata,
  DhcpSnapshotOrigin,
  DhcpSnapshotRestoreOptions,
  DhcpSnapshotRestoreResult,
  TechnitiumCloneDhcpScopeRequest,
  TechnitiumCloneDhcpScopeResult,
  TechnitiumCreateDhcpScopeEnvelope,
  TechnitiumCreateDhcpScopeRequest,
  TechnitiumDhcpScope,
  TechnitiumDhcpScopeEnvelope,
  TechnitiumDhcpScopeListEnvelope,
  TechnitiumRenameDhcpScopeRequest,
  TechnitiumRenameDhcpScopeResult,
  TechnitiumUpdateDhcpScopeEnvelope,
  TechnitiumUpdateDhcpScopeRequest,
} from "../types/dhcp";
import type {
  DnsFilteringSnapshot,
  DnsFilteringSnapshotMetadata,
  DnsFilteringSnapshotMethod,
  DnsFilteringSnapshotOrigin,
  DnsFilteringSnapshotRestoreResult,
} from "../types/dnsFilteringSnapshots";
import type {
  TechnitiumCombinedQueryLogPage,
  TechnitiumNodeQueryLogEnvelope,
  TechnitiumQueryLogFilters,
  TechnitiumQueryLogStorageStatus,
} from "../types/technitiumLogs";
import type {
  TechnitiumCombinedZoneOverview,
  TechnitiumCombinedZoneRecordsOverview,
  TechnitiumZoneListEnvelope,
} from "../types/zones";
import type {
  ZoneSnapshot,
  ZoneSnapshotCreateRequest,
  ZoneSnapshotMetadata,
  ZoneSnapshotRestoreOptions,
  ZoneSnapshotRestoreResult,
} from "../types/zoneSnapshots";
import type { AuthStatus } from "./AuthContext";
import { TechnitiumContext } from "./technitiumContextInstance";
import { useOptionalAuth } from "./useAuth";

type NodeStatus = "online" | "syncing" | "offline" | "unknown";

export interface TechnitiumAppInfo {
  name: string;
  version?: string;
  description?: string;
}

export interface TechnitiumNodeAppsResponse {
  nodeId: string;
  apps: TechnitiumAppInfo[];
  hasAdvancedBlocking: boolean;
  fetchedAt: string;
}

export interface TechnitiumNodeOverview {
  nodeId: string;
  version: string;
  uptime: number;
  totalZones: number;
  totalQueries: number;
  totalBlockedQueries: number;
  totalApps: number;
  hasAdvancedBlocking: boolean;
  fetchedAt: string;
}

export interface TechnitiumClusterState {
  initialized: boolean;
  domain?: string;
  dnsServerDomain?: string;
  type?: "Primary" | "Secondary" | "Standalone";
  health?: "Connected" | "Unreachable" | "Self";
}

export interface TechnitiumClusterSettings {
  heartbeatRefreshIntervalSeconds: number;
  heartbeatRetryIntervalSeconds: number;
  configRefreshIntervalSeconds: number;
  configRetryIntervalSeconds: number;
}

export interface TechnitiumNode {
  id: string;
  name: string;
  baseUrl: string;
  status: NodeStatus;
  lastSync: string;
  issues?: string[];
  hasAdvancedBlocking?: boolean;
  overview?: TechnitiumNodeOverview;
  clusterState?: TechnitiumClusterState;
  isPrimary?: boolean; // True if this node is the Primary in the cluster
}

export interface TechnitiumState {
  nodes: TechnitiumNode[];
  advancedBlocking?: AdvancedBlockingOverview;
  loadingAdvancedBlocking: boolean;
  advancedBlockingError?: string;
  reloadAdvancedBlocking: () => Promise<void>;
  fetchNodeOverviews: () => Promise<void>;
  saveAdvancedBlockingConfig: (
    nodeId: string,
    config: AdvancedBlockingConfig,
    snapshotNote?: string,
  ) => Promise<AdvancedBlockingSnapshot | undefined>;
  // Built-in Blocking state
  builtInBlocking?: BuiltInBlockingOverview;
  loadingBuiltInBlocking: boolean;
  builtInBlockingError?: string;
  blockingStatus?: BlockingStatusOverview;
  loadingBlockingStatus: boolean;
  selectedBlockingMethod: BlockingMethod;
  setSelectedBlockingMethod: (method: BlockingMethod) => void;
  reloadBuiltInBlocking: () => Promise<void>;
  reloadBlockingStatus: () => Promise<void>;
  // Built-in Blocking operations
  listAllowedDomains: (
    nodeId: string,
    params?: {
      domain?: string;
      pageNumber?: number;
      entriesPerPage?: number;
      format?: "list" | "tree";
    },
  ) => Promise<BlockingZoneListResponse>;
  listBlockedDomains: (
    nodeId: string,
    params?: {
      domain?: string;
      pageNumber?: number;
      entriesPerPage?: number;
      format?: "list" | "tree";
    },
  ) => Promise<BlockingZoneListResponse>;
  addAllowedDomain: (
    nodeId: string,
    domain: string,
  ) => Promise<BlockingZoneOperationResult>;
  addBlockedDomain: (
    nodeId: string,
    domain: string,
  ) => Promise<BlockingZoneOperationResult>;
  deleteAllowedDomain: (
    nodeId: string,
    domain: string,
  ) => Promise<BlockingZoneOperationResult>;
  deleteBlockedDomain: (
    nodeId: string,
    domain: string,
  ) => Promise<BlockingZoneOperationResult>;
  getBlockingSettings: (nodeId: string) => Promise<BlockingSettings>;
  updateBlockingSettings: (
    nodeId: string,
    settings: Partial<BlockingSettings>,
  ) => Promise<BlockingZoneOperationResult>;
  temporaryDisableBlocking: (
    nodeId: string,
    minutes: number,
  ) => Promise<{
    success: boolean;
    temporaryDisableBlockingTill?: string;
    message?: string;
  }>;
  reEnableBlocking: (nodeId: string) => Promise<BlockingZoneOperationResult>;
  forceBlockListUpdate: (
    nodeId: string,
  ) => Promise<BlockingZoneOperationResult>;
  loadNodeLogs: (
    nodeId: string,
    filters?: TechnitiumQueryLogFilters,
    options?: { signal?: AbortSignal },
  ) => Promise<TechnitiumNodeQueryLogEnvelope>;
  loadCombinedLogs: (
    filters?: TechnitiumQueryLogFilters,
    options?: { signal?: AbortSignal },
  ) => Promise<TechnitiumCombinedQueryLogPage>;
  loadQueryLogStorageStatus: (options?: {
    signal?: AbortSignal;
  }) => Promise<TechnitiumQueryLogStorageStatus>;
  loadStoredNodeLogs: (
    nodeId: string,
    filters?: TechnitiumQueryLogFilters,
    options?: { signal?: AbortSignal },
  ) => Promise<TechnitiumNodeQueryLogEnvelope>;
  loadStoredCombinedLogs: (
    filters?: TechnitiumQueryLogFilters,
    options?: { signal?: AbortSignal },
  ) => Promise<TechnitiumCombinedQueryLogPage>;
  loadDhcpScopes: (nodeId: string) => Promise<TechnitiumDhcpScopeListEnvelope>;
  loadDhcpScope: (
    nodeId: string,
    scopeName: string,
  ) => Promise<TechnitiumDhcpScopeEnvelope>;
  createDhcpScope: (
    nodeId: string,
    request: TechnitiumCreateDhcpScopeRequest,
  ) => Promise<TechnitiumCreateDhcpScopeEnvelope>;
  cloneDhcpScope: (
    nodeId: string,
    scopeName: string,
    request: TechnitiumCloneDhcpScopeRequest,
  ) => Promise<TechnitiumCloneDhcpScopeResult>;
  renameDhcpScope: (
    nodeId: string,
    scopeName: string,
    request: TechnitiumRenameDhcpScopeRequest,
  ) => Promise<TechnitiumRenameDhcpScopeResult>;
  updateDhcpScope: (
    nodeId: string,
    scopeName: string,
    request: TechnitiumUpdateDhcpScopeRequest,
  ) => Promise<TechnitiumUpdateDhcpScopeEnvelope>;
  deleteDhcpScope: (
    nodeId: string,
    scopeName: string,
  ) => Promise<{ success: boolean; message: string }>;
  bulkSyncDhcpScopes: (
    request: DhcpBulkSyncRequest,
  ) => Promise<DhcpBulkSyncResult>;
  listDhcpSnapshots: (nodeId: string) => Promise<DhcpSnapshotMetadata[]>;
  createDhcpSnapshot: (
    nodeId: string,
    origin?: DhcpSnapshotOrigin,
  ) => Promise<DhcpSnapshotMetadata>;
  restoreDhcpSnapshot: (
    nodeId: string,
    snapshotId: string,
    options?: DhcpSnapshotRestoreOptions,
  ) => Promise<DhcpSnapshotRestoreResult>;
  setDhcpSnapshotPinned: (
    nodeId: string,
    snapshotId: string,
    pinned: boolean,
  ) => Promise<DhcpSnapshotMetadata>;
  getDhcpSnapshot: (
    nodeId: string,
    snapshotId: string,
  ) => Promise<DhcpSnapshot>;
  deleteDhcpSnapshot: (nodeId: string, snapshotId: string) => Promise<void>;
  updateDhcpSnapshotNote: (
    nodeId: string,
    snapshotId: string,
    note?: string,
  ) => Promise<DhcpSnapshotMetadata>;

  listDnsFilteringSnapshots: (
    nodeId: string,
    method: DnsFilteringSnapshotMethod,
  ) => Promise<DnsFilteringSnapshotMetadata[]>;
  createDnsFilteringSnapshot: (
    nodeId: string,
    request: {
      method: DnsFilteringSnapshotMethod;
      origin?: DnsFilteringSnapshotOrigin;
      note?: string;
    },
  ) => Promise<DnsFilteringSnapshotMetadata>;
  getDnsFilteringSnapshot: (
    nodeId: string,
    snapshotId: string,
  ) => Promise<DnsFilteringSnapshot>;
  deleteDnsFilteringSnapshot: (
    nodeId: string,
    snapshotId: string,
  ) => Promise<void>;
  updateDnsFilteringSnapshotNote: (
    nodeId: string,
    snapshotId: string,
    note?: string,
  ) => Promise<DnsFilteringSnapshotMetadata>;
  setDnsFilteringSnapshotPinned: (
    nodeId: string,
    snapshotId: string,
    pinned: boolean,
  ) => Promise<DnsFilteringSnapshotMetadata>;
  restoreDnsFilteringSnapshot: (
    nodeId: string,
    snapshotId: string,
  ) => Promise<DnsFilteringSnapshotRestoreResult>;

  listZoneSnapshots: (nodeId: string) => Promise<ZoneSnapshotMetadata[]>;
  createZoneSnapshot: (
    nodeId: string,
    request: ZoneSnapshotCreateRequest,
  ) => Promise<ZoneSnapshotMetadata>;
  getZoneSnapshot: (
    nodeId: string,
    snapshotId: string,
  ) => Promise<ZoneSnapshot>;
  deleteZoneSnapshot: (nodeId: string, snapshotId: string) => Promise<void>;
  updateZoneSnapshotNote: (
    nodeId: string,
    snapshotId: string,
    note?: string,
  ) => Promise<ZoneSnapshotMetadata>;
  setZoneSnapshotPinned: (
    nodeId: string,
    snapshotId: string,
    pinned: boolean,
  ) => Promise<ZoneSnapshotMetadata>;
  restoreZoneSnapshot: (
    nodeId: string,
    snapshotId: string,
    options?: ZoneSnapshotRestoreOptions,
  ) => Promise<ZoneSnapshotRestoreResult>;

  loadZones: (nodeId: string) => Promise<TechnitiumZoneListEnvelope>;
  loadCombinedZones: () => Promise<TechnitiumCombinedZoneOverview>;
  loadCombinedZoneRecords: (
    zoneName: string,
  ) => Promise<TechnitiumCombinedZoneRecordsOverview>;
}

// Load nodes from backend API (configured on server side via environment variables)
const fetchConfiguredNodes = async (): Promise<TechnitiumNode[]> => {
  try {
    const response = await apiFetch("/nodes");
    if (!response.ok) {
      throw new Error(
        `Failed to load nodes configuration (${response.status})`,
      );
    }
    const nodes: Array<{
      id: string;
      name: string;
      baseUrl: string;
      clusterState?: TechnitiumClusterState;
      isPrimary?: boolean;
    }> = await response.json();

    // Transform backend node config to frontend format
    return nodes.map((node) => ({
      id: node.id,
      name: node.name || node.id,
      baseUrl: node.baseUrl,
      status: "unknown" as NodeStatus,
      lastSync: new Date().toISOString(),
      clusterState: node.clusterState,
      isPrimary: node.isPrimary,
    }));
  } catch (error) {
    console.error("Failed to load nodes configuration from backend:", error);
    // Return empty array if configuration fails
    return [];
  }
};

export function TechnitiumProvider({ children }: { children: ReactNode }) {
  const auth = useOptionalAuth();
  const [nodes, setNodes] = useState<TechnitiumNode[]>([]);
  const [advancedBlocking, setAdvancedBlocking] = useState<
    AdvancedBlockingOverview | undefined
  >();
  const [loadingAdvancedBlocking, setLoadingAdvancedBlocking] =
    useState<boolean>(false);
  const [advancedBlockingError, setAdvancedBlockingError] = useState<
    string | undefined
  >();
  const hasCheckedApps = useRef(false);

  // Built-in Blocking state
  const [builtInBlocking, setBuiltInBlocking] = useState<
    BuiltInBlockingOverview | undefined
  >();
  const [loadingBuiltInBlocking, setLoadingBuiltInBlocking] =
    useState<boolean>(false);
  const [builtInBlockingError, setBuiltInBlockingError] = useState<
    string | undefined
  >();
  const [blockingStatus, setBlockingStatus] = useState<
    BlockingStatusOverview | undefined
  >();
  const [loadingBlockingStatus, setLoadingBlockingStatus] =
    useState<boolean>(false);
  const [selectedBlockingMethod, setSelectedBlockingMethod] =
    useState<BlockingMethod>("advanced");

  const nodesRef = useRef<TechnitiumNode[]>([]);

  // Auth status is optional (tests may not wrap AuthProvider)
  const authStatusRef = useRef<AuthStatus | null>(null);
  const authRefreshRef = useRef<
    ((options?: { silent?: boolean }) => Promise<void>) | null
  >(null);
  useEffect(() => {
    authStatusRef.current = auth?.status ?? null;
    authRefreshRef.current = auth?.refresh ?? null;
  }, [auth?.status, auth?.refresh]);

  const logThrottleRef = useRef<Map<string, number>>(new Map());
  const logThrottled = useCallback(
    (
      key: string,
      level: "error" | "warn" | "log",
      message: string,
      error?: unknown,
      ttlMs = 60_000,
    ) => {
      const now = Date.now();
      const last = logThrottleRef.current.get(key) ?? 0;
      if (now - last < ttlMs) {
        return;
      }
      logThrottleRef.current.set(key, now);
      // Intentionally avoid spamming long stacks on transient network issues.
      if (error !== undefined) {
        console[level](message, error);
      } else {
        console[level](message);
      }
    },
    [],
  );

  const isSessionAuthUnauthenticated = useCallback((): boolean => {
    const status = authStatusRef.current;
    return (
      status?.sessionAuthEnabled === true && status.authenticated === false
    );
  }, []);

  const isNodeAuthenticatedForSession = useCallback(
    (nodeId: string): boolean => {
      const status = authStatusRef.current;
      if (!status?.sessionAuthEnabled) {
        return true;
      }

      // When session auth is enabled, backend tells us which nodes we actually have
      // verified tokens for.
      const allowed = status.nodeIds;
      return Array.isArray(allowed) ? allowed.includes(nodeId) : false;
    },
    [],
  );

  const requireNodeAuth = useCallback(
    (nodeId: string): void => {
      if (!isNodeAuthenticatedForSession(nodeId)) {
        triggerAuthRedirect("node-session-expired", {
          path: `/nodes/${nodeId}`,
        });
        throw new Error(
          `Not authenticated for node ${nodeId}. Please sign in again to refresh node tokens.`,
        );
      }
    },
    [isNodeAuthenticatedForSession],
  );

  // Track in-flight overview fetch to prevent duplicate requests
  const overviewFetchInProgress = useRef<Promise<void> | null>(null);

  // Keep ref in sync with latest nodes array
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Load nodes configuration on mount
  useEffect(() => {
    fetchConfiguredNodes().then((loadedNodes) => {
      nodesRef.current = loadedNodes;
      setNodes(loadedNodes);
    });
  }, []);

  // Fetch Advanced Blocking app status for all nodes
  const checkNodeApps = useCallback(async () => {
    setNodes((currentNodes) => {
      if (currentNodes.length === 0) return currentNodes;

      // Kick off async fetch without blocking the return
      (async () => {
        const updatedNodes = await Promise.all(
          currentNodes.map(async (node) => {
            try {
              if (!isNodeAuthenticatedForSession(node.id)) {
                return node;
              }

              const response = await apiFetch(
                `/nodes/${encodeURIComponent(node.id)}/apps`,
              );

              if (response.status === 401) {
                // Session may still be valid, but per-node token might have expired.
                // Refresh /auth/me so we stop calling nodes we can't access.
                void authRefreshRef.current?.({ silent: true });
              }

              if (response.ok) {
                const appsData =
                  (await response.json()) as TechnitiumNodeAppsResponse;
                return {
                  ...node,
                  hasAdvancedBlocking: appsData.hasAdvancedBlocking,
                };
              }
            } catch (error) {
              logThrottled(
                `node-apps-${node.id}`,
                "warn",
                `Failed to check apps for node ${node.id}:`,
                error,
                60_000,
              );
            }
            return node;
          }),
        );
        setNodes(updatedNodes);
      })();

      // Return current state immediately to avoid blocking
      return currentNodes;
    });
  }, [isNodeAuthenticatedForSession, logThrottled]);

  // Cluster role polling state
  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousPrimaryIdRef = useRef<string | undefined>(undefined);
  const isPollingSetupRef = useRef<boolean>(false);

  const clusterPollFailureCountRef = useRef<number>(0);
  const clusterPollBackoffUntilRef = useRef<number>(0);

  const shouldSkipClusterPoll = useCallback((): boolean => {
    if (isSessionAuthUnauthenticated()) {
      return true;
    }

    // Avoid background-tab polling (reduces console spam + pointless work).
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return true;
    }

    // If the browser knows we're offline, don't hammer the API.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return true;
    }

    return Date.now() < clusterPollBackoffUntilRef.current;
  }, [isSessionAuthUnauthenticated]);

  // Fetch cluster settings from Primary node
  const fetchClusterSettings =
    useCallback(async (): Promise<TechnitiumClusterSettings | null> => {
      const primaryNode = nodesRef.current.find(
        (node) => node.isPrimary === true,
      );
      if (!primaryNode) {
        return null;
      }

      if (!isNodeAuthenticatedForSession(primaryNode.id)) {
        return null;
      }

      try {
        const response = await apiFetch(
          `/nodes/${encodeURIComponent(primaryNode.id)}/cluster/settings`,
        );
        if (response.status === 401) {
          void authRefreshRef.current?.({ silent: true });
        }
        if (response.ok) {
          return (await response.json()) as TechnitiumClusterSettings;
        }
      } catch (error) {
        console.warn(
          "Failed to fetch cluster settings, using defaults:",
          error,
        );
      }

      // Return defaults if fetch fails
      return {
        heartbeatRefreshIntervalSeconds: 30,
        heartbeatRetryIntervalSeconds: 10,
        configRefreshIntervalSeconds: 900,
        configRetryIntervalSeconds: 60,
      };
    }, [isNodeAuthenticatedForSession]);

  // Poll cluster state to detect role changes
  const pollClusterState = useCallback(async () => {
    if (shouldSkipClusterPoll()) {
      return;
    }

    const currentNodes = nodesRef.current;
    if (currentNodes.length === 0) {
      return;
    }

    // Check if clustering is enabled
    const isClusterEnabled = currentNodes.some(
      (node) => node.clusterState?.initialized === true,
    );
    if (!isClusterEnabled) {
      return;
    }

    try {
      // Refresh nodes to get latest cluster state
      const response = await apiFetch("/nodes");

      if (response.status === 401) {
        // Session expired; AuthContext/RequireAuth will handle redirect.
        // Back off so we don't spam the server and console while auth refresh runs.
        clusterPollFailureCountRef.current = Math.min(
          clusterPollFailureCountRef.current + 1,
          10,
        );
        clusterPollBackoffUntilRef.current =
          Date.now() +
          Math.min(300_000, 15_000 * clusterPollFailureCountRef.current);
        void authRefreshRef.current?.({ silent: true });
        return;
      }

      if (!response.ok) {
        return;
      }

      const updatedNodes: Array<{
        id: string;
        name: string;
        baseUrl: string;
        clusterState?: TechnitiumClusterState;
        isPrimary?: boolean;
      }> = await response.json();

      // Find current and previous Primary nodes
      const currentPrimaryId = updatedNodes.find(
        (n) => n.isPrimary === true,
      )?.id;
      const previousPrimaryId = previousPrimaryIdRef.current;

      // Detect role change
      if (
        previousPrimaryId &&
        currentPrimaryId &&
        previousPrimaryId !== currentPrimaryId
      ) {
        const newPrimaryNode = updatedNodes.find(
          (n) => n.id === currentPrimaryId,
        );
        console.log(
          `🔄 Cluster role changed: ${newPrimaryNode?.name || currentPrimaryId} is now Primary`,
        );

        // Show toast notification (we'll use the toast context later)
        // For now, just log to console
        alert(
          `⚠️ Cluster role changed\n\n${newPrimaryNode?.name || currentPrimaryId} is now the Primary node.`,
        );

        // Update nodes state with new cluster info
        setNodes((prevNodes) =>
          prevNodes.map((node) => {
            const updated = updatedNodes.find((n) => n.id === node.id);
            if (updated) {
              return {
                ...node,
                clusterState: updated.clusterState,
                isPrimary: updated.isPrimary,
              };
            }
            return node;
          }),
        );
      }

      // Update the previous Primary ID for next poll
      previousPrimaryIdRef.current = currentPrimaryId;

      // Reset backoff on success
      clusterPollFailureCountRef.current = 0;
      clusterPollBackoffUntilRef.current = 0;
    } catch (error) {
      clusterPollFailureCountRef.current = Math.min(
        clusterPollFailureCountRef.current + 1,
        10,
      );
      clusterPollBackoffUntilRef.current =
        Date.now() +
        Math.min(300_000, 5_000 * clusterPollFailureCountRef.current);
      logThrottled(
        "cluster-poll-failed",
        "warn",
        "Failed to poll cluster state (will retry with backoff):",
        error,
        60_000,
      );
    }
  }, [logThrottled, shouldSkipClusterPoll]);

  // Set up cluster role polling when clustering is enabled
  useEffect(() => {
    const isClusterEnabled = nodes.some(
      (node) => node.clusterState?.initialized === true,
    );

    // If session auth is enabled and we are not authenticated, do not poll.
    if (isSessionAuthUnauthenticated()) {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      isPollingSetupRef.current = false;
      return;
    }

    // If clustering is disabled, clean up and exit
    if (!isClusterEnabled) {
      if (pollingTimerRef.current) {
        console.log("🔕 Stopping cluster role polling (clustering disabled)");
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
        isPollingSetupRef.current = false;
      }
      return;
    }

    // If polling is already set up (or being set up), don't restart it
    if (isPollingSetupRef.current) {
      return;
    }

    // Mark that we're setting up polling
    isPollingSetupRef.current = true;

    // Initialize the previous Primary ID
    const currentPrimaryId = nodes.find((node) => node.isPrimary === true)?.id;
    previousPrimaryIdRef.current = currentPrimaryId;

    // Fetch cluster settings and start polling
    (async () => {
      try {
        const settings = await fetchClusterSettings();
        const intervalSeconds = settings?.heartbeatRefreshIntervalSeconds || 30;
        const intervalMs = intervalSeconds * 1000;

        console.log(
          `🔔 Starting cluster role polling (every ${intervalSeconds}s)`,
        );

        // Clear any existing timer (shouldn't exist, but defensive)
        if (pollingTimerRef.current) {
          clearInterval(pollingTimerRef.current);
        }

        // Start polling
        pollingTimerRef.current = setInterval(pollClusterState, intervalMs);
      } catch (error) {
        console.error("Failed to set up cluster role polling:", error);
        // Allow retry on next render if setup fails
        isPollingSetupRef.current = false;
      }
    })();

    // Cleanup on unmount - but don't reset flag to prevent remount restart
    return () => {
      // Only log, don't actually stop polling unless clustering is disabled
      // This prevents React StrictMode double-mount from restarting polling
    };
  }, [
    nodes,
    fetchClusterSettings,
    pollClusterState,
    isSessionAuthUnauthenticated,
  ]);

  // Fetch node overviews (statistics)
  const fetchNodeOverviews = useCallback(async () => {
    if (overviewFetchInProgress.current) {
      return overviewFetchInProgress.current;
    }

    const promise = (async () => {
      const currentNodes = nodesRef.current;
      if (currentNodes.length === 0) {
        return;
      }

      try {
        const nodesWithOverviews = await Promise.all(
          currentNodes.map(async (node) => {
            try {
              if (!isNodeAuthenticatedForSession(node.id)) {
                return { nodeId: node.id, overview: null, reachable: false };
              }

              const response = await apiFetch(
                `/nodes/${encodeURIComponent(node.id)}/overview`,
              );

              if (response.status === 401) {
                void authRefreshRef.current?.({ silent: true });
                return { nodeId: node.id, overview: null, reachable: false };
              }

              if (response.ok) {
                const overview =
                  (await response.json()) as TechnitiumNodeOverview;
                return { nodeId: node.id, overview, reachable: true };
              }
              return { nodeId: node.id, overview: null, reachable: false };
            } catch (error) {
              logThrottled(
                `node-overview-${node.id}`,
                "warn",
                `Failed to fetch overview for node ${node.id}:`,
                error,
                60_000,
              );
              return { nodeId: node.id, overview: null, reachable: false };
            }
          }),
        );

        const overviewMap = new Map(
          nodesWithOverviews.map((entry) => [
            entry.nodeId,
            { overview: entry.overview, reachable: entry.reachable },
          ]),
        );

        const syncStatus: Record<string, boolean> = {};
        try {
          const combinedResponse = await apiFetch("/nodes/zones/combined");
          if (combinedResponse.ok) {
            const combinedData = await combinedResponse.json();
            const zones = combinedData.zones || [];

            const hasDiscrepancies = zones.some(
              (zone: { status: string }) =>
                zone.status === "different" || zone.status === "missing",
            );

            if (hasDiscrepancies) {
              currentNodes.forEach((node) => {
                const isSecondary = node.name
                  .toLowerCase()
                  .includes("secondary");
                syncStatus[node.id] = isSecondary;
              });
            }
          }
        } catch (error) {
          logThrottled(
            "combined-zones-sync-check",
            "warn",
            "Failed to fetch combined zones for sync check:",
            error,
            60_000,
          );
        }

        setNodes((previousNodes) =>
          previousNodes.map((node) => {
            const entry = overviewMap.get(node.id);
            if (!entry) {
              return node;
            }

            if (!entry.reachable) {
              return { ...node, status: "offline" as NodeStatus };
            }

            const { overview } = entry;
            let status: NodeStatus = "online";
            if (syncStatus[node.id]) {
              status = "syncing";
            }

            return {
              ...node,
              status,
              overview: overview || undefined,
              lastSync: overview?.fetchedAt || node.lastSync,
            };
          }),
        );
      } catch (error) {
        logThrottled(
          "fetch-node-overviews",
          "warn",
          "Failed to fetch node overviews:",
          error,
          60_000,
        );
      } finally {
        overviewFetchInProgress.current = null;
      }
    })();

    overviewFetchInProgress.current = promise;
    return promise;
  }, [isNodeAuthenticatedForSession, logThrottled]);

  // Check node apps once after nodes are loaded
  useEffect(() => {
    if (nodes.length > 0 && !hasCheckedApps.current) {
      hasCheckedApps.current = true;
      checkNodeApps();
    }
  }, [nodes.length, checkNodeApps]);

  const reloadAdvancedBlocking = useCallback(async () => {
    setLoadingAdvancedBlocking(true);
    setAdvancedBlockingError(undefined);

    try {
      const response = await apiFetch("/nodes/advanced-blocking");

      if (!response.ok) {
        throw new Error(
          `Failed to load Advanced Blocking overview (${response.status})`,
        );
      }

      const raw = await response.text();
      if (!raw) {
        setAdvancedBlocking(undefined);
        return;
      }

      const data = JSON.parse(raw) as AdvancedBlockingOverview | null;
      setAdvancedBlocking(data ?? undefined);
    } catch (error) {
      setAdvancedBlocking(undefined);
      setAdvancedBlockingError((error as Error).message);
    } finally {
      setLoadingAdvancedBlocking(false);
    }
  }, []);

  const saveAdvancedBlockingConfig = useCallback(
    async (
      nodeId: string,
      config: AdvancedBlockingConfig,
      snapshotNote?: string,
    ) => {
      try {
        const response = await apiFetch(
          `/nodes/${encodeURIComponent(nodeId)}/advanced-blocking`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config, snapshotNote }),
          },
        );

        if (!response.ok) {
          throw new Error(
            `Failed to save Advanced Blocking config (${response.status})`,
          );
        }

        const snapshot = (await response.json()) as AdvancedBlockingSnapshot;

        // The GET `/nodes/advanced-blocking` endpoint is intentionally cached on the backend.
        // To avoid a confusing "save succeeded but UI didn't change" moment, patch the
        // in-memory overview with the authoritative snapshot we just received.
        setAdvancedBlocking((previous) => {
          if (!previous) {
            return previous;
          }

          const nodes = previous.nodes.map((node) =>
            node.nodeId === snapshot.nodeId ? snapshot : node,
          );

          const empty: AdvancedBlockingOverview["aggregate"] = {
            groupCount: 0,
            blockedDomainCount: 0,
            allowedDomainCount: 0,
            blockListUrlCount: 0,
            allowListUrlCount: 0,
            adblockListUrlCount: 0,
            allowedRegexCount: 0,
            blockedRegexCount: 0,
            regexAllowListUrlCount: 0,
            regexBlockListUrlCount: 0,
            localEndpointMappingCount: 0,
            networkMappingCount: 0,
            scheduledNodeCount: 0,
          };

          const aggregate = nodes.reduce((acc, node) => {
            const metrics = node.metrics;
            return {
              groupCount: acc.groupCount + metrics.groupCount,
              blockedDomainCount:
                acc.blockedDomainCount + metrics.blockedDomainCount,
              allowedDomainCount:
                acc.allowedDomainCount + metrics.allowedDomainCount,
              blockListUrlCount:
                acc.blockListUrlCount + metrics.blockListUrlCount,
              allowListUrlCount:
                acc.allowListUrlCount + metrics.allowListUrlCount,
              adblockListUrlCount:
                acc.adblockListUrlCount + metrics.adblockListUrlCount,
              allowedRegexCount:
                acc.allowedRegexCount + metrics.allowedRegexCount,
              blockedRegexCount:
                acc.blockedRegexCount + metrics.blockedRegexCount,
              regexAllowListUrlCount:
                acc.regexAllowListUrlCount + metrics.regexAllowListUrlCount,
              regexBlockListUrlCount:
                acc.regexBlockListUrlCount + metrics.regexBlockListUrlCount,
              localEndpointMappingCount:
                acc.localEndpointMappingCount +
                metrics.localEndpointMappingCount,
              networkMappingCount:
                acc.networkMappingCount + metrics.networkMappingCount,
              scheduledNodeCount:
                acc.scheduledNodeCount + metrics.scheduledNodeCount,
            };
          }, empty);

          return { fetchedAt: new Date().toISOString(), aggregate, nodes };
        });

        return snapshot;
      } catch (error) {
        throw error instanceof Error ? error : (
            new Error("Failed to save Advanced Blocking config.")
          );
      }
    },
    [],
  );

  const buildLogQuery = useCallback((filters?: TechnitiumQueryLogFilters) => {
    const params = new URLSearchParams();
    if (!filters) {
      return params;
    }

    const entries = Object.entries(filters) as [
      keyof TechnitiumQueryLogFilters,
      unknown,
    ][];

    for (const [key, value] of entries) {
      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value === "boolean") {
        params.set(key, value ? "true" : "false");
        continue;
      }

      if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          continue;
        }
        params.set(key, value.toString());
        continue;
      }

      if (typeof value === "string") {
        if (value.trim().length === 0) {
          continue;
        }
        params.set(key, value.trim());
      }
    }

    return params;
  }, []);

  const loadNodeLogs = useCallback(
    async (
      nodeId: string,
      filters?: TechnitiumQueryLogFilters,
      options?: { signal?: AbortSignal },
    ) => {
      if (!nodeId) {
        throw new Error("Node id is required to load logs.");
      }

      requireNodeAuth(nodeId);

      const params = buildLogQuery(filters);
      const url = `/nodes/${encodeURIComponent(nodeId)}/logs${
        params.size > 0 ? `?${params.toString()}` : ""
      }`;

      const requestOptions =
        filters?.disableCache ?
          {
            cache: "no-store" as const,
            headers: { "Cache-Control": "no-store" },
          }
        : undefined;

      const mergedRequestOptions: RequestInit | undefined =
        requestOptions || options?.signal ?
          { ...(requestOptions ?? {}), signal: options?.signal }
        : undefined;

      const response = await apiFetch(url, mergedRequestOptions);

      if (!response.ok) {
        throw new Error(
          `Failed to load query logs for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumNodeQueryLogEnvelope;
    },
    [buildLogQuery, requireNodeAuth],
  );

  const loadCombinedLogs = useCallback(
    async (
      filters?: TechnitiumQueryLogFilters,
      options?: { signal?: AbortSignal },
    ) => {
      const params = buildLogQuery(filters);
      const url = `/nodes/logs/combined${
        params.size > 0 ? `?${params.toString()}` : ""
      }`;

      const requestOptions =
        filters?.disableCache ?
          {
            cache: "no-store" as const,
            headers: { "Cache-Control": "no-store" },
          }
        : undefined;

      const mergedRequestOptions: RequestInit | undefined =
        requestOptions || options?.signal ?
          { ...(requestOptions ?? {}), signal: options?.signal }
        : undefined;

      const response = await apiFetch(url, mergedRequestOptions);

      if (!response.ok) {
        throw new Error(
          `Failed to load combined query logs (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumCombinedQueryLogPage;
    },
    [buildLogQuery],
  );

  const loadQueryLogStorageStatus = useCallback(
    async (options?: { signal?: AbortSignal }) => {
      const response = await apiFetch("/nodes/logs/storage", {
        signal: options?.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Failed to load query log storage status (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumQueryLogStorageStatus;
    },
    [],
  );

  const loadStoredNodeLogs = useCallback(
    async (
      nodeId: string,
      filters?: TechnitiumQueryLogFilters,
      options?: { signal?: AbortSignal },
    ) => {
      if (!nodeId) {
        throw new Error("Node id is required to load logs.");
      }

      requireNodeAuth(nodeId);

      const params = buildLogQuery(filters);
      const url = `/nodes/${encodeURIComponent(nodeId)}/logs/stored${
        params.size > 0 ? `?${params.toString()}` : ""
      }`;

      const requestOptions =
        filters?.disableCache ?
          {
            cache: "no-store" as const,
            headers: { "Cache-Control": "no-store" },
          }
        : undefined;

      const mergedRequestOptions: RequestInit | undefined =
        requestOptions || options?.signal ?
          { ...(requestOptions ?? {}), signal: options?.signal }
        : undefined;

      const response = await apiFetch(url, mergedRequestOptions);

      if (!response.ok) {
        throw new Error(
          `Failed to load stored query logs for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumNodeQueryLogEnvelope;
    },
    [buildLogQuery, requireNodeAuth],
  );

  const loadStoredCombinedLogs = useCallback(
    async (
      filters?: TechnitiumQueryLogFilters,
      options?: { signal?: AbortSignal },
    ) => {
      const params = buildLogQuery(filters);
      const url = `/nodes/logs/combined/stored${
        params.size > 0 ? `?${params.toString()}` : ""
      }`;

      const requestOptions =
        filters?.disableCache ?
          {
            cache: "no-store" as const,
            headers: { "Cache-Control": "no-store" },
          }
        : undefined;

      const mergedRequestOptions: RequestInit | undefined =
        requestOptions || options?.signal ?
          { ...(requestOptions ?? {}), signal: options?.signal }
        : undefined;

      const response = await apiFetch(url, mergedRequestOptions);

      if (!response.ok) {
        throw new Error(
          `Failed to load stored combined query logs (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumCombinedQueryLogPage;
    },
    [buildLogQuery],
  );

  const loadDhcpScopes = useCallback(
    async (nodeId: string) => {
      if (!nodeId) {
        throw new Error("Node id is required to load DHCP scopes.");
      }

      requireNodeAuth(nodeId);

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/scopes`,
      );

      if (!response.ok) {
        throw new Error(
          `Failed to load DHCP scopes for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumDhcpScopeListEnvelope;
    },
    [requireNodeAuth],
  );

  const loadDhcpScope = useCallback(
    async (nodeId: string, scopeName: string) => {
      if (!nodeId) {
        throw new Error("Node id is required to load a DHCP scope.");
      }

      if (!scopeName) {
        throw new Error("Scope name is required to load a DHCP scope.");
      }

      requireNodeAuth(nodeId);

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/scopes/${encodeURIComponent(scopeName)}`,
      );

      if (!response.ok) {
        throw new Error(
          `Failed to load DHCP scope ${scopeName} from node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumDhcpScopeEnvelope;
    },
    [requireNodeAuth],
  );

  const createDhcpScope = useCallback(
    async (nodeId: string, request: TechnitiumCreateDhcpScopeRequest) => {
      if (!nodeId) {
        throw new Error("Node id is required to create a DHCP scope.");
      }

      if (!request || !request.scope) {
        throw new Error("Scope payload is required to create a DHCP scope.");
      }

      const trimmedName = request.scope.name?.trim();
      if (!trimmedName) {
        throw new Error("Scope name is required to create a DHCP scope.");
      }

      const trimRequiredField = (value: string | undefined, label: string) => {
        const trimmed = value?.trim();
        if (!trimmed) {
          throw new Error(`${label} is required to create a DHCP scope.`);
        }
        return trimmed;
      };

      const trimOptionalField = (value?: string | null) => {
        if (value === undefined || value === null) {
          return undefined;
        }
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      };

      const normalizeArray = (values?: string[]) => {
        if (!Array.isArray(values)) {
          return undefined;
        }
        const normalized = values
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        return normalized.length > 0 ? normalized : undefined;
      };

      const scopePayload: TechnitiumDhcpScope = {
        ...request.scope,
        name: trimmedName,
        startingAddress: trimRequiredField(
          request.scope.startingAddress,
          "Starting address",
        ),
        endingAddress: trimRequiredField(
          request.scope.endingAddress,
          "Ending address",
        ),
        subnetMask: trimRequiredField(request.scope.subnetMask, "Subnet mask"),
      };

      scopePayload.routerAddress = trimOptionalField(
        request.scope.routerAddress ?? undefined,
      );
      scopePayload.serverAddress = trimOptionalField(
        request.scope.serverAddress ?? undefined,
      );
      scopePayload.serverHostName = trimOptionalField(
        request.scope.serverHostName ?? undefined,
      );
      scopePayload.bootFileName = trimOptionalField(
        request.scope.bootFileName ?? undefined,
      );

      scopePayload.dnsServers = normalizeArray(request.scope.dnsServers);
      scopePayload.winsServers = normalizeArray(request.scope.winsServers);
      scopePayload.ntpServers = normalizeArray(request.scope.ntpServers);
      scopePayload.ntpServerDomainNames = normalizeArray(
        request.scope.ntpServerDomainNames,
      );

      const payload: TechnitiumCreateDhcpScopeRequest = { scope: scopePayload };

      if (request.enabled !== undefined) {
        payload.enabled = request.enabled;
      }

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/scopes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to create DHCP scope on node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumCreateDhcpScopeEnvelope;
    },
    [],
  );

  const loadZones = useCallback(
    async (nodeId: string) => {
      if (!nodeId) {
        throw new Error("Node id is required to load zones.");
      }

      requireNodeAuth(nodeId);

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/zones`,
      );

      if (!response.ok) {
        throw new Error(
          `Failed to load zones for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumZoneListEnvelope;
    },
    [requireNodeAuth],
  );

  const loadCombinedZones = useCallback(async () => {
    const response = await apiFetch("/nodes/zones/combined");

    if (!response.ok) {
      throw new Error(`Failed to load combined zone view (${response.status})`);
    }

    return (await response.json()) as TechnitiumCombinedZoneOverview;
  }, []);

  const loadCombinedZoneRecords = useCallback(async (zoneName: string) => {
    const trimmedZoneName = zoneName?.trim();
    if (!trimmedZoneName) {
      throw new Error("Zone name is required to load zone records.");
    }

    const response = await apiFetch(
      `/nodes/zones/records?zone=${encodeURIComponent(trimmedZoneName)}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to load zone records (${response.status})`);
    }

    return (await response.json()) as TechnitiumCombinedZoneRecordsOverview;
  }, []);

  const cloneDhcpScope = useCallback(
    async (
      nodeId: string,
      scopeName: string,
      request: TechnitiumCloneDhcpScopeRequest,
    ) => {
      if (!nodeId) {
        throw new Error("Source node id is required to clone a DHCP scope.");
      }

      if (!scopeName) {
        throw new Error("Scope name is required to clone a DHCP scope.");
      }

      if (!request) {
        throw new Error("Clone request payload is required.");
      }

      const payload: TechnitiumCloneDhcpScopeRequest = {};

      if (request.targetNodeId?.trim()) {
        payload.targetNodeId = request.targetNodeId.trim();
      }

      if (request.newScopeName?.trim()) {
        payload.newScopeName = request.newScopeName.trim();
      }

      if (request.enableOnTarget !== undefined) {
        payload.enableOnTarget = request.enableOnTarget;
      }

      if (request.preserveOfferDelayTime !== undefined) {
        payload.preserveOfferDelayTime = request.preserveOfferDelayTime;
      }

      if (request.overrides) {
        const overrides: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(request.overrides)) {
          if (value === undefined) {
            continue;
          }

          overrides[key] = value;
        }

        if (Object.keys(overrides).length > 0) {
          payload.overrides =
            overrides as TechnitiumCloneDhcpScopeRequest["overrides"];
        }
      }

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/scopes/${encodeURIComponent(scopeName)}/clone`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to clone DHCP scope ${scopeName} from node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumCloneDhcpScopeResult;
    },
    [],
  );

  const renameDhcpScope = useCallback(
    async (
      nodeId: string,
      scopeName: string,
      request: TechnitiumRenameDhcpScopeRequest,
    ) => {
      if (!nodeId) {
        throw new Error("Node id is required to rename a DHCP scope.");
      }

      if (!scopeName) {
        throw new Error("Scope name is required to rename a DHCP scope.");
      }

      const trimmedNewScopeName = request?.newScopeName?.trim();
      if (!trimmedNewScopeName) {
        throw new Error("New scope name is required to rename a DHCP scope.");
      }

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/scopes/${encodeURIComponent(scopeName)}/rename`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newScopeName: trimmedNewScopeName }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to rename DHCP scope ${scopeName} on node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumRenameDhcpScopeResult;
    },
    [],
  );

  const updateDhcpScope = useCallback(
    async (
      nodeId: string,
      scopeName: string,
      request: TechnitiumUpdateDhcpScopeRequest,
    ) => {
      if (!nodeId) {
        throw new Error("Node id is required to update a DHCP scope.");
      }

      if (!scopeName) {
        throw new Error("Scope name is required to update a DHCP scope.");
      }

      if (!request) {
        throw new Error("Update request payload is required.");
      }

      const payload: TechnitiumUpdateDhcpScopeRequest = {};

      if (request.overrides) {
        const overrides: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(request.overrides)) {
          if (value === undefined) {
            continue;
          }

          overrides[key] = value;
        }

        if (Object.keys(overrides).length > 0) {
          payload.overrides =
            overrides as TechnitiumUpdateDhcpScopeRequest["overrides"];
        }
      }

      if (request.enabled !== undefined) {
        payload.enabled = request.enabled;
      }

      if (!payload.overrides && payload.enabled === undefined) {
        throw new Error(
          "Provide at least one field override or enabled flag when updating a DHCP scope.",
        );
      }

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/scopes/${encodeURIComponent(scopeName)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to update DHCP scope ${scopeName} on node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as TechnitiumUpdateDhcpScopeEnvelope;
    },
    [],
  );

  const deleteDhcpScope = useCallback(
    async (nodeId: string, scopeName: string) => {
      if (!nodeId) {
        throw new Error("Node id is required to delete a DHCP scope.");
      }

      if (!scopeName) {
        throw new Error("Scope name is required to delete a DHCP scope.");
      }

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/scopes/${encodeURIComponent(scopeName)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to delete DHCP scope ${scopeName} on node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as { success: boolean; message: string };
    },
    [],
  );

  const bulkSyncDhcpScopes = useCallback(
    async (request: DhcpBulkSyncRequest) => {
      if (!request.sourceNodeId) {
        throw new Error("Source node ID is required for bulk DHCP sync.");
      }

      if (!request.targetNodeIds || request.targetNodeIds.length === 0) {
        throw new Error(
          "At least one target node ID is required for bulk DHCP sync.",
        );
      }

      if (!request.strategy) {
        throw new Error("Sync strategy is required for bulk DHCP sync.");
      }

      const response = await apiFetch("/nodes/dhcp/bulk-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to bulk sync DHCP scopes (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as DhcpBulkSyncResult;
    },
    [],
  );

  const listDhcpSnapshots = useCallback(async (nodeId: string) => {
    const response = await apiFetch(
      `/nodes/${encodeURIComponent(nodeId)}/dhcp/snapshots`,
    );

    if (!response.ok) {
      throw new Error(
        `Failed to list DHCP snapshots for node ${nodeId} (${response.status})`,
      );
    }

    return (await response.json()) as DhcpSnapshotMetadata[];
  }, []);

  const createDhcpSnapshot = useCallback(
    async (nodeId: string, origin?: DhcpSnapshotOrigin) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/snapshots`,
        {
          method: "POST",
          headers: origin ? { "Content-Type": "application/json" } : undefined,
          body: origin ? JSON.stringify({ origin }) : undefined,
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to create DHCP snapshot for node ${nodeId} (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as DhcpSnapshotMetadata;
    },
    [],
  );

  const restoreDhcpSnapshot = useCallback(
    async (
      nodeId: string,
      snapshotId: string,
      options?: DhcpSnapshotRestoreOptions,
    ) => {
      const payload = {
        deleteExtraScopes:
          options?.keepExtras === true ? false : options?.deleteExtraScopes,
        confirm: true,
      };

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/snapshots/${encodeURIComponent(snapshotId)}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to restore DHCP snapshot (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as DhcpSnapshotRestoreResult;
    },
    [],
  );

  const setDhcpSnapshotPinned = useCallback(
    async (nodeId: string, snapshotId: string, pinned: boolean) => {
      const action = pinned ? "pin" : "unpin";
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/snapshots/${encodeURIComponent(snapshotId)}/${action}`,
        { method: "POST" },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to ${action} DHCP snapshot for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as DhcpSnapshotMetadata;
    },
    [],
  );

  const getDhcpSnapshot = useCallback(
    async (nodeId: string, snapshotId: string) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/snapshots/${encodeURIComponent(snapshotId)}`,
      );

      if (!response.ok) {
        throw new Error(
          `Failed to load DHCP snapshot ${snapshotId} for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as DhcpSnapshot;
    },
    [],
  );

  const deleteDhcpSnapshot = useCallback(
    async (nodeId: string, snapshotId: string) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/snapshots/${encodeURIComponent(snapshotId)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to delete DHCP snapshot (${response.status}): ${errorText}`,
        );
      }
    },
    [],
  );

  const updateDhcpSnapshotNote = useCallback(
    async (nodeId: string, snapshotId: string, note?: string) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dhcp/snapshots/${encodeURIComponent(snapshotId)}/note`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to update DHCP snapshot note (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as DhcpSnapshotMetadata;
    },
    [],
  );

  const listDnsFilteringSnapshots = useCallback(
    async (nodeId: string, method: DnsFilteringSnapshotMethod) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dns-filtering/snapshots?method=${encodeURIComponent(method)}`,
      );

      if (!response.ok) {
        throw new Error(
          `Failed to list DNS filtering snapshots for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as DnsFilteringSnapshotMetadata[];
    },
    [],
  );

  const createDnsFilteringSnapshot = useCallback(
    async (
      nodeId: string,
      request: {
        method: DnsFilteringSnapshotMethod;
        origin?: DnsFilteringSnapshotOrigin;
        note?: string;
      },
    ) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dns-filtering/snapshots`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to create DNS filtering snapshot for node ${nodeId} (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as DnsFilteringSnapshotMetadata;
    },
    [],
  );

  const getDnsFilteringSnapshot = useCallback(
    async (nodeId: string, snapshotId: string) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dns-filtering/snapshots/${encodeURIComponent(snapshotId)}`,
      );

      if (!response.ok) {
        throw new Error(
          `Failed to load DNS filtering snapshot ${snapshotId} for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as DnsFilteringSnapshot;
    },
    [],
  );

  const deleteDnsFilteringSnapshot = useCallback(
    async (nodeId: string, snapshotId: string) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dns-filtering/snapshots/${encodeURIComponent(snapshotId)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to delete DNS filtering snapshot (${response.status}): ${errorText}`,
        );
      }
    },
    [],
  );

  const updateDnsFilteringSnapshotNote = useCallback(
    async (nodeId: string, snapshotId: string, note?: string) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dns-filtering/snapshots/${encodeURIComponent(snapshotId)}/note`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to update DNS filtering snapshot note (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as DnsFilteringSnapshotMetadata;
    },
    [],
  );

  const setDnsFilteringSnapshotPinned = useCallback(
    async (nodeId: string, snapshotId: string, pinned: boolean) => {
      const action = pinned ? "pin" : "unpin";
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dns-filtering/snapshots/${encodeURIComponent(snapshotId)}/${action}`,
        { method: "POST" },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to ${action} DNS filtering snapshot for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as DnsFilteringSnapshotMetadata;
    },
    [],
  );

  const restoreDnsFilteringSnapshot = useCallback(
    async (nodeId: string, snapshotId: string) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/dns-filtering/snapshots/${encodeURIComponent(snapshotId)}/restore`,
        { method: "POST" },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to restore DNS filtering snapshot (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as DnsFilteringSnapshotRestoreResult;
    },
    [],
  );

  const listZoneSnapshots = useCallback(async (nodeId: string) => {
    const response = await apiFetch(
      `/nodes/${encodeURIComponent(nodeId)}/zones/snapshots`,
    );

    if (!response.ok) {
      throw new Error(
        `Failed to list zone snapshots for node ${nodeId} (${response.status})`,
      );
    }

    return (await response.json()) as ZoneSnapshotMetadata[];
  }, []);

  const createZoneSnapshot = useCallback(
    async (nodeId: string, request: ZoneSnapshotCreateRequest) => {
      const zones = request?.zones ?? [];
      if (!zones || zones.length === 0) {
        throw new Error(
          "At least one zone name is required to create a snapshot.",
        );
      }

      const payload: ZoneSnapshotCreateRequest = {
        zones,
        origin: request.origin ?? (request.note ? "manual" : request.origin),
        note: request.note,
      };

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/zones/snapshots`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to create zone snapshot for node ${nodeId} (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as ZoneSnapshotMetadata;
    },
    [],
  );

  const getZoneSnapshot = useCallback(
    async (nodeId: string, snapshotId: string) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/zones/snapshots/${encodeURIComponent(snapshotId)}`,
      );

      if (!response.ok) {
        throw new Error(
          `Failed to load zone snapshot ${snapshotId} for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as ZoneSnapshot;
    },
    [],
  );

  const deleteZoneSnapshot = useCallback(
    async (nodeId: string, snapshotId: string) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/zones/snapshots/${encodeURIComponent(snapshotId)}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to delete zone snapshot (${response.status}): ${errorText}`,
        );
      }
    },
    [],
  );

  const updateZoneSnapshotNote = useCallback(
    async (nodeId: string, snapshotId: string, note?: string) => {
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/zones/snapshots/${encodeURIComponent(snapshotId)}/note`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to update zone snapshot note (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as ZoneSnapshotMetadata;
    },
    [],
  );

  const setZoneSnapshotPinned = useCallback(
    async (nodeId: string, snapshotId: string, pinned: boolean) => {
      const action = pinned ? "pin" : "unpin";
      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/zones/snapshots/${encodeURIComponent(snapshotId)}/${action}`,
        { method: "POST" },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to ${action} zone snapshot for node ${nodeId} (${response.status})`,
        );
      }

      return (await response.json()) as ZoneSnapshotMetadata;
    },
    [],
  );

  const restoreZoneSnapshot = useCallback(
    async (
      nodeId: string,
      snapshotId: string,
      options?: ZoneSnapshotRestoreOptions,
    ) => {
      const payload = {
        deleteZonesThatDidNotExist:
          options?.keepNewZones === true ?
            false
          : options?.deleteZonesThatDidNotExist,
        zoneNames: options?.zoneNames,
        confirm: true,
      };

      const response = await apiFetch(
        `/nodes/${encodeURIComponent(nodeId)}/zones/snapshots/${encodeURIComponent(snapshotId)}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(
          `Failed to restore zone snapshot (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as ZoneSnapshotRestoreResult;
    },
    [],
  );

  // ========================================
  // Built-in Blocking Callbacks
  // ========================================

  const reloadBuiltInBlocking = useCallback(async () => {
    setLoadingBuiltInBlocking(true);
    setBuiltInBlockingError(undefined);

    try {
      const response = await apiFetch("/built-in-blocking");
      if (!response.ok) {
        throw new Error(
          `Failed to load built-in blocking overview (${response.status})`,
        );
      }
      const data = (await response.json()) as BuiltInBlockingOverview;
      setBuiltInBlocking(data);
    } catch (error) {
      setBuiltInBlocking(undefined);
      setBuiltInBlockingError((error as Error).message);
    } finally {
      setLoadingBuiltInBlocking(false);
    }
  }, []);

  const reloadBlockingStatus = useCallback(async () => {
    setLoadingBlockingStatus(true);

    try {
      const response = await apiFetch("/built-in-blocking/status");
      if (!response.ok) {
        throw new Error(`Failed to load blocking status (${response.status})`);
      }
      const data = (await response.json()) as BlockingStatusOverview;
      setBlockingStatus(data);

      // Auto-select blocking method based on what's available
      // If Advanced Blocking is installed and enabled, prefer it
      // If only Built-in is enabled, select that
      if (data.nodesWithAdvancedBlocking.length > 0) {
        setSelectedBlockingMethod("advanced");
      } else if (data.nodesWithBuiltInBlocking.length > 0) {
        setSelectedBlockingMethod("built-in");
      }
    } catch (error) {
      console.error("Failed to load blocking status:", error);
    } finally {
      setLoadingBlockingStatus(false);
    }
  }, []);

  const listAllowedDomains = useCallback(
    async (
      nodeId: string,
      params?: {
        domain?: string;
        pageNumber?: number;
        entriesPerPage?: number;
        format?: "list" | "tree";
      },
    ) => {
      const query = new URLSearchParams();
      if (params?.domain) query.set("domain", params.domain);
      if (params?.pageNumber !== undefined)
        query.set("pageNumber", params.pageNumber.toString());
      if (params?.entriesPerPage !== undefined)
        query.set("entriesPerPage", params.entriesPerPage.toString());
      if (params?.format) query.set("format", params.format);

      const url = `/built-in-blocking/${encodeURIComponent(nodeId)}/allowed${query.toString() ? "?" + query.toString() : ""}`;
      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error(`Failed to list allowed domains (${response.status})`);
      }
      return (await response.json()) as BlockingZoneListResponse;
    },
    [],
  );

  const listBlockedDomains = useCallback(
    async (
      nodeId: string,
      params?: {
        domain?: string;
        pageNumber?: number;
        entriesPerPage?: number;
        format?: "list" | "tree";
      },
    ) => {
      const query = new URLSearchParams();
      if (params?.domain) query.set("domain", params.domain);
      if (params?.pageNumber !== undefined)
        query.set("pageNumber", params.pageNumber.toString());
      if (params?.entriesPerPage !== undefined)
        query.set("entriesPerPage", params.entriesPerPage.toString());
      if (params?.format) query.set("format", params.format);

      const url = `/built-in-blocking/${encodeURIComponent(nodeId)}/blocked${query.toString() ? "?" + query.toString() : ""}`;
      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error(`Failed to list blocked domains (${response.status})`);
      }
      return (await response.json()) as BlockingZoneListResponse;
    },
    [],
  );

  const addAllowedDomain = useCallback(
    async (nodeId: string, domain: string) => {
      const response = await apiFetch(
        `/built-in-blocking/${encodeURIComponent(nodeId)}/allowed`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain }),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to add allowed domain (${response.status})`);
      }
      return (await response.json()) as BlockingZoneOperationResult;
    },
    [],
  );

  const addBlockedDomain = useCallback(
    async (nodeId: string, domain: string) => {
      const response = await apiFetch(
        `/built-in-blocking/${encodeURIComponent(nodeId)}/blocked`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain }),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to add blocked domain (${response.status})`);
      }
      return (await response.json()) as BlockingZoneOperationResult;
    },
    [],
  );

  const deleteAllowedDomain = useCallback(
    async (nodeId: string, domain: string) => {
      const response = await apiFetch(
        `/built-in-blocking/${encodeURIComponent(nodeId)}/allowed/${encodeURIComponent(domain)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(`Failed to delete allowed domain (${response.status})`);
      }
      return (await response.json()) as BlockingZoneOperationResult;
    },
    [],
  );

  const deleteBlockedDomain = useCallback(
    async (nodeId: string, domain: string) => {
      const response = await apiFetch(
        `/built-in-blocking/${encodeURIComponent(nodeId)}/blocked/${encodeURIComponent(domain)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(`Failed to delete blocked domain (${response.status})`);
      }
      return (await response.json()) as BlockingZoneOperationResult;
    },
    [],
  );

  const getBlockingSettings = useCallback(async (nodeId: string) => {
    const response = await apiFetch(
      `/built-in-blocking/${encodeURIComponent(nodeId)}/settings`,
    );
    if (!response.ok) {
      throw new Error(`Failed to get blocking settings (${response.status})`);
    }
    return (await response.json()) as BlockingSettings;
  }, []);

  const updateBlockingSettings = useCallback(
    async (nodeId: string, settings: Partial<BlockingSettings>) => {
      const response = await apiFetch(
        `/built-in-blocking/${encodeURIComponent(nodeId)}/settings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to update blocking settings (${response.status})`,
        );
      }
      return (await response.json()) as BlockingZoneOperationResult;
    },
    [],
  );

  const temporaryDisableBlocking = useCallback(
    async (nodeId: string, minutes: number) => {
      const response = await apiFetch(
        `/built-in-blocking/${encodeURIComponent(nodeId)}/settings/temporary-disable`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minutes }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Failed to temporarily disable blocking (${response.status})`,
        );
      }
      return (await response.json()) as {
        success: boolean;
        temporaryDisableBlockingTill?: string;
        message?: string;
      };
    },
    [],
  );

  const reEnableBlocking = useCallback(async (nodeId: string) => {
    const response = await apiFetch(
      `/built-in-blocking/${encodeURIComponent(nodeId)}/settings/re-enable`,
      { method: "POST" },
    );
    if (!response.ok) {
      throw new Error(`Failed to re-enable blocking (${response.status})`);
    }
    return (await response.json()) as BlockingZoneOperationResult;
  }, []);

  const forceBlockListUpdate = useCallback(async (nodeId: string) => {
    const response = await apiFetch(
      `/built-in-blocking/${encodeURIComponent(nodeId)}/settings/force-update`,
      { method: "POST" },
    );
    if (!response.ok) {
      throw new Error(`Failed to force block list update (${response.status})`);
    }
    return (await response.json()) as BlockingZoneOperationResult;
  }, []);

  const value = useMemo<TechnitiumState>(
    () => ({
      nodes,
      advancedBlocking,
      loadingAdvancedBlocking,
      advancedBlockingError,
      reloadAdvancedBlocking,
      fetchNodeOverviews,
      saveAdvancedBlockingConfig,
      // Built-in Blocking
      builtInBlocking,
      loadingBuiltInBlocking,
      builtInBlockingError,
      blockingStatus,
      loadingBlockingStatus,
      selectedBlockingMethod,
      setSelectedBlockingMethod,
      reloadBuiltInBlocking,
      reloadBlockingStatus,
      listAllowedDomains,
      listBlockedDomains,
      addAllowedDomain,
      addBlockedDomain,
      deleteAllowedDomain,
      deleteBlockedDomain,
      getBlockingSettings,
      updateBlockingSettings,
      temporaryDisableBlocking,
      reEnableBlocking,
      forceBlockListUpdate,
      // Other
      loadNodeLogs,
      loadCombinedLogs,
      loadQueryLogStorageStatus,
      loadStoredNodeLogs,
      loadStoredCombinedLogs,
      loadDhcpScopes,
      loadDhcpScope,
      createDhcpScope,
      cloneDhcpScope,
      renameDhcpScope,
      updateDhcpScope,
      deleteDhcpScope,
      bulkSyncDhcpScopes,
      listDhcpSnapshots,
      createDhcpSnapshot,
      restoreDhcpSnapshot,
      setDhcpSnapshotPinned,
      getDhcpSnapshot,
      deleteDhcpSnapshot,
      updateDhcpSnapshotNote,
      listDnsFilteringSnapshots,
      createDnsFilteringSnapshot,
      restoreDnsFilteringSnapshot,
      setDnsFilteringSnapshotPinned,
      getDnsFilteringSnapshot,
      deleteDnsFilteringSnapshot,
      updateDnsFilteringSnapshotNote,
      listZoneSnapshots,
      createZoneSnapshot,
      getZoneSnapshot,
      deleteZoneSnapshot,
      updateZoneSnapshotNote,
      setZoneSnapshotPinned,
      restoreZoneSnapshot,
      loadZones,
      loadCombinedZones,
      loadCombinedZoneRecords,
    }),
    [
      nodes,
      advancedBlocking,
      loadingAdvancedBlocking,
      advancedBlockingError,
      reloadAdvancedBlocking,
      fetchNodeOverviews,
      saveAdvancedBlockingConfig,
      // Built-in Blocking
      builtInBlocking,
      loadingBuiltInBlocking,
      builtInBlockingError,
      blockingStatus,
      loadingBlockingStatus,
      selectedBlockingMethod,
      reloadBuiltInBlocking,
      reloadBlockingStatus,
      listAllowedDomains,
      listBlockedDomains,
      addAllowedDomain,
      addBlockedDomain,
      deleteAllowedDomain,
      deleteBlockedDomain,
      getBlockingSettings,
      updateBlockingSettings,
      temporaryDisableBlocking,
      reEnableBlocking,
      forceBlockListUpdate,
      // Other
      loadNodeLogs,
      loadCombinedLogs,
      loadQueryLogStorageStatus,
      loadStoredNodeLogs,
      loadStoredCombinedLogs,
      loadDhcpScopes,
      loadDhcpScope,
      createDhcpScope,
      cloneDhcpScope,
      renameDhcpScope,
      updateDhcpScope,
      deleteDhcpScope,
      bulkSyncDhcpScopes,
      listDhcpSnapshots,
      createDhcpSnapshot,
      restoreDhcpSnapshot,
      setDhcpSnapshotPinned,
      getDhcpSnapshot,
      deleteDhcpSnapshot,
      updateDhcpSnapshotNote,
      listDnsFilteringSnapshots,
      createDnsFilteringSnapshot,
      restoreDnsFilteringSnapshot,
      setDnsFilteringSnapshotPinned,
      getDnsFilteringSnapshot,
      deleteDnsFilteringSnapshot,
      updateDnsFilteringSnapshotNote,
      listZoneSnapshots,
      createZoneSnapshot,
      getZoneSnapshot,
      deleteZoneSnapshot,
      updateZoneSnapshotNote,
      setZoneSnapshotPinned,
      restoreZoneSnapshot,
      loadZones,
      loadCombinedZones,
      loadCombinedZoneRecords,
    ],
  );

  return (
    <TechnitiumContext.Provider value={value}>
      {children}
    </TechnitiumContext.Provider>
  );
}
