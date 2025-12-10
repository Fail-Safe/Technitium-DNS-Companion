import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  Inject,
  BadRequestException,
} from "@nestjs/common";
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import * as https from "https";
import * as dns from "dns";
import { promisify } from "util";
import { TECHNITIUM_NODES_TOKEN } from "./technitium.constants";
import {
  TechnitiumActionPayload,
  TechnitiumNodeConfig,
  TechnitiumNodeSummary,
  TechnitiumClusterState,
  TechnitiumClusterSettings,
  TechnitiumStatusEnvelope,
  TechnitiumQueryLogFilters,
  TechnitiumQueryLogPage,
  TechnitiumQueryLogEntry,
  TechnitiumApiResponse,
  TechnitiumCombinedQueryLogEntry,
  TechnitiumCombinedQueryLogPage,
  TechnitiumCombinedNodeLogSnapshot,
  TechnitiumDhcpScopeList,
  TechnitiumDhcpScope,
  TechnitiumCloneDhcpScopeRequest,
  TechnitiumCloneDhcpScopeResult,
  TechnitiumUpdateDhcpScopeRequest,
  TechnitiumUpdateDhcpScopeResult,
  TechnitiumZoneList,
  TechnitiumZoneSummary,
  TechnitiumCombinedZoneOverview,
  TechnitiumZoneComparison,
  TechnitiumZoneNodeState,
  TechnitiumZoneComparisonStatus,
  TechnitiumCombinedZoneNodeSnapshot,
  TechnitiumAppInfo,
  TechnitiumNodeAppsResponse,
  TechnitiumNodeOverview,
  TechnitiumSettingsData,
  TechnitiumDashboardStatsData,
  TechnitiumPtrLookupResult,
  TechnitiumDhcpLeaseList,
} from "./technitium.types";

interface TechnitiumQueryLoggerMetadata {
  name: string;
  classPath: string;
}

interface TechnitiumAppsListPayload {
  apps?: Array<{
    name?: string;
    dnsApps?: Array<{ classPath?: string; isQueryLogger?: boolean }>;
  }>;
}

interface TechnitiumNodeQueryLogSnapshot {
  nodeId: string;
  baseUrl: string;
  fetchedAt: string;
  data?: TechnitiumQueryLogPage;
  error?: string;
}

interface TechnitiumNodeZoneSnapshot {
  nodeId: string;
  baseUrl: string;
  fetchedAt: string;
  data?: TechnitiumZoneList;
  error?: string;
}

/**
 * Fields used for COMPARISON to detect configuration drift.
 * When zones differ in these fields, they are marked as "different".
 *
 * Current strategy for zone types:
 * - ALWAYS compared: queryAccess, queryAccessNetworkACL, DNSSEC, SOA Serial, disabled, etc.
 *   (These should be identical across all nodes)
 *
 * - CONDITIONALLY compared (only for non-Secondary-Forwarder types):
 *   zoneTransfer, zoneTransferNetworkACL, zoneTransferTsigKeyNames
 *   notify, notifyNameServers
 *   (Secondary Conditional Forwarders and Secondary ROOT Zones don't have these options)
 *
 * Note: Primary Zones, Secondary Zones, Stub Zones, and Conditional Forwarders
 * all support Zone Transfer and Notify settings and should be compared.
 */
const ZONE_COMPARISON_FIELDS_ALWAYS = [
  "dnssecStatus",
  "soaSerial",
  "disabled",
  "internal",
  "notifyFailed",
  "notifyFailedFor",
  "syncFailed",
  "isExpired",
  "queryAccess",
  "queryAccessNetworkACL",
] as const;

const ZONE_COMPARISON_FIELDS_CONDITIONAL = [
  "zoneTransfer",
  "zoneTransferNetworkACL",
  "zoneTransferTsigKeyNames",
  "notify",
  "notifyNameServers",
] as const;

type ZoneComparisonFieldAlways = (typeof ZONE_COMPARISON_FIELDS_ALWAYS)[number];
type ZoneComparisonFieldConditional =
  (typeof ZONE_COMPARISON_FIELDS_CONDITIONAL)[number];
type ZoneComparisonField =
  | ZoneComparisonFieldAlways
  | ZoneComparisonFieldConditional;

// Secondary forwarder types that don't have Zone Transfer/Notify settings
const SECONDARY_FORWARDER_TYPES = new Set([
  "Secondary Conditional Forwarder",
  "Secondary ROOT Zone",
]);

/**
 * All fields available for display in UI.
 * These include comparison fields PLUS additional informational fields.
 * Only ZONE_COMPARISON_FIELDS are used for detecting differences.
 */
type ZoneDisplayField =
  // Comparison fields (differences detected)
  | "dnssecStatus"
  | "soaSerial"
  | "disabled"
  | "internal"
  | "notifyFailed"
  | "notifyFailedFor"
  | "syncFailed"
  | "isExpired"
  | "queryAccess"
  | "queryAccessNetworkACL"
  // Informational fields (displayed but not compared)
  | "type"
  | "lastModified"
  | "expiry"
  | "zoneTransfer"
  | "zoneTransferNetworkACL"
  | "zoneTransferTsigKeyNames"
  | "notify"
  | "notifyNameServers";

const ZONE_FIELD_LABELS: Record<ZoneDisplayField | "presence", string> = {
  // Comparison fields
  dnssecStatus: "DNSSEC",
  soaSerial: "SOA Serial",
  disabled: "Disabled",
  internal: "Internal",
  notifyFailed: "Notify Failed",
  notifyFailedFor: "Notify Targets",
  syncFailed: "Sync Failed",
  isExpired: "Expired",
  queryAccess: "Query Access",
  queryAccessNetworkACL: "Query Access ACL",
  // Informational fields
  type: "Type",
  lastModified: "Last Modified",
  expiry: "Expiry",
  zoneTransfer: "Zone Transfer",
  zoneTransferNetworkACL: "Zone Transfer ACL",
  zoneTransferTsigKeyNames: "Zone Transfer TSIG Keys",
  notify: "Notify Configuration",
  notifyNameServers: "Notify Servers",
  presence: "Presence",
};

const ZONE_STATUS_PRIORITY: Record<TechnitiumZoneComparisonStatus, number> = {
  different: 0,
  missing: 1,
  unknown: 2,
  "in-sync": 3,
};

/**
 * Fields to compare for zone configuration parity.
 *
 * Current strategy for PRIMARY/SECONDARY architecture:
 * - queryAccess & queryAccessNetworkACL: Both node types support these
 *   and they should be identical (clients query both nodes)
 *
 * Fields intentionally excluded (role-specific):
 * - zoneTransfer*: Only primary forwarders have transfer options
 * - notify*: Only primary forwarders have notification options
 *
 * Other basic fields always compared:
 * - dnssecStatus, soaSerial, disabled, internal, syncFailed, isExpired, etc.
 */

interface HostnameCacheEntry {
  hostname: string;
  lastUpdated: number;
  source: "dhcp" | "ptr";
}

@Injectable()
export class TechnitiumService {
  private readonly logger = new Logger(TechnitiumService.name);
  private readonly queryLoggerCache = new Map<
    string,
    TechnitiumQueryLoggerMetadata
  >();

  // Hostname resolution cache: IP → { hostname, lastUpdated, source }
  private readonly hostnameCache = new Map<string, HostnameCacheEntry>();

  // Skip background timers in unit tests to avoid Jest open handle warnings
  private readonly enableBackgroundTasks = process.env.NODE_ENV !== "test";

  // Configuration for hostname resolution
  private readonly HOSTNAME_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private readonly PTR_LOOKUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_PTR_LOOKUPS_PER_CYCLE = 50; // Limit concurrent PTR queries

  // Track IPs we've seen in queries for periodic PTR resolution
  private readonly recentClientIps = new Set<string>();
  private ptrLookupTimer?: NodeJS.Timeout;

  // Query log cache for getCombinedQueryLogs
  private readonly queryLogCache = new Map<
    string,
    { data: TechnitiumCombinedQueryLogPage; expiresAt: number }
  >();
  private readonly QUERY_LOG_CACHE_TTL_MS = 30 * 1000; // 30 seconds
  private queryLogCacheStats = { hits: 0, misses: 0 };
  private cacheCleanupTimer?: NodeJS.Timeout;

  constructor(
    @Inject(TECHNITIUM_NODES_TOKEN)
    private readonly nodeConfigs: TechnitiumNodeConfig[],
  ) {
    if (this.enableBackgroundTasks) {
      // Start periodic PTR lookup cycle
      this.startPeriodicPtrLookups();

      // Start periodic cache cleanup
      this.startPeriodicCacheCleanup();
    }
  }

  /**
   * Resolve a hostname to IP address with timeout.
   * Used to match cluster nodes when hostnames don't resolve to the configured baseUrl IPs.
   */
  private async resolveHostname(hostname: string): Promise<string | undefined> {
    if (!hostname) return undefined;

    // If it's already an IP address, return it
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return hostname;
    }

    try {
      const resolve4 = promisify(dns.resolve4);
      const ips = await Promise.race([
        resolve4(hostname),
        new Promise<string[]>((_, reject) =>
          setTimeout(() => reject(new Error("DNS timeout")), 2000),
        ),
      ]);
      return ips && ips.length > 0 ? ips[0] : undefined;
    } catch {
      // DNS resolution failed or timed out - return undefined
      return undefined;
    }
  }

  async listNodes(): Promise<TechnitiumNodeSummary[]> {
    // OPTIMIZATION: Only query ONE node for cluster state since any node can tell us about the entire cluster
    // This reduces N API calls to 1, dramatically improving performance (e.g., 3 nodes: 3x faster)
    let sharedClusterInfo: {
      initialized: boolean;
      domain?: string;
      clusterNodes?: Array<{
        id: number;
        name: string;
        url: string;
        ipAddress: string;
        type: "Primary" | "Secondary";
        state: string;
      }>;
    } | null = null;

    // Try to get cluster info from first node
    if (this.nodeConfigs.length > 0) {
      const firstNode = this.nodeConfigs[0];
      try {
        // Get full cluster state from first node
        const response = await this.request<{
          status: string;
          info?: {
            version?: string;
            clusterInitialized?: boolean;
            clusterDomain?: string;
            dnsServerDomain?: string;
            clusterNodes?: Array<{
              id: number;
              name: string;
              url: string;
              ipAddress: string;
              type: "Primary" | "Secondary";
              state: string;
            }>;
          };
          server?: string;
        }>(firstNode, {
          method: "GET",
          url: "/api/user/session/get",
          params: {},
        });

        if (response.status === "ok" && response.info?.clusterInitialized) {
          const clusterNodes = response.info.clusterNodes || [];
          sharedClusterInfo = {
            initialized: true,
            domain: response.info.clusterDomain,
            clusterNodes,
          };
          this.logger.log(
            `Cluster detected: ${response.info.clusterDomain} with ${clusterNodes.length} nodes`,
          );
          // Log cluster node details for debugging matching issues
          for (const cn of clusterNodes) {
            this.logger.debug(
              `  Cluster node: name="${cn.name}", url="${cn.url}", ip="${cn.ipAddress}", type="${cn.type}"`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `Failed to fetch cluster state from first node ${firstNode.id}, will treat all as standalone: ${error}`,
        );
      }
    }

    // Build node summaries using shared cluster info
    // Note: This needs to be async for DNS resolution
    const nodeSummariesPromise = this.nodeConfigs.map(
      async ({ id, name, baseUrl }) => {
        try {
          if (!sharedClusterInfo?.initialized) {
            // No clustering or failed to detect - return standalone
            return {
              id,
              name: name || id,
              baseUrl,
              clusterState: { initialized: false, type: "Standalone" as const },
              isPrimary: false,
            };
          }

          // Try to find this node in the cluster topology using multiple matching strategies:
          // 1. Match by name prefix (our node ID "node1" should match "node1.home.arpa")
          // 2. Match by IP address (extract IP from baseUrl and compare to clusterNode.ipAddress/resolved IP)
          // 3. Match by URL hostname (compare baseUrl hostname to cluster node URL hostname)

          // Extract IP/hostname from our baseUrl for matching
          let baseUrlHost = "";
          try {
            const url = new URL(baseUrl);
            baseUrlHost = url.hostname;
          } catch {
            // Invalid URL, skip host extraction
          }

          let clusterNode = sharedClusterInfo.clusterNodes?.find((n) => {
            // Strategy 1: Name prefix match
            if (n.name === id || n.name.startsWith(`${id}.`)) {
              return true;
            }

            // Strategy 2: IP address match (direct)
            if (baseUrlHost && n.ipAddress && baseUrlHost === n.ipAddress) {
              return true;
            }

            // Strategy 3: URL hostname match
            if (baseUrlHost && n.url) {
              try {
                const clusterUrl = new URL(n.url);
                if (clusterUrl.hostname === baseUrlHost) {
                  return true;
                }
              } catch {
                // Invalid cluster URL
              }
            }

            return false;
          });

          // If no match found, try DNS resolution to match IPs
          if (!clusterNode && baseUrlHost) {
            const baseUrlIsIp = /^\d+\.\d+\.\d+\.\d+$/.test(baseUrlHost);

            if (baseUrlIsIp) {
              // baseUrl is an IP - resolve cluster node hostnames to find a match
              for (const cn of sharedClusterInfo.clusterNodes || []) {
                if (cn.url) {
                  try {
                    const clusterUrl = new URL(cn.url);
                    const clusterHostname = clusterUrl.hostname;
                    // Skip if cluster URL is also an IP (already checked in Strategy 3)
                    if (!/^\d+\.\d+\.\d+\.\d+$/.test(clusterHostname)) {
                      const resolvedClusterIp =
                        await this.resolveHostname(clusterHostname);
                      if (resolvedClusterIp === baseUrlHost) {
                        clusterNode = cn;
                        this.logger.debug(
                          `  DNS match: ${clusterHostname} → ${resolvedClusterIp} matches baseUrl IP ${baseUrlHost}`,
                        );
                        break;
                      }
                    }
                  } catch {
                    // Skip on error
                  }
                }
              }
            } else {
              // baseUrl is a hostname - resolve it and compare to cluster node IPs/resolved hostnames
              const resolvedBaseUrlIp = await this.resolveHostname(baseUrlHost);

              if (resolvedBaseUrlIp) {
                for (const cn of sharedClusterInfo.clusterNodes || []) {
                  // Check against cluster node's ipAddress field
                  if (cn.ipAddress && cn.ipAddress === resolvedBaseUrlIp) {
                    clusterNode = cn;
                    this.logger.debug(
                      `  DNS match: ${baseUrlHost} → ${resolvedBaseUrlIp} matches cluster node IP ${cn.ipAddress}`,
                    );
                    break;
                  }

                  // Also try resolving cluster node URL hostname
                  if (cn.url) {
                    try {
                      const clusterUrl = new URL(cn.url);
                      const resolvedClusterIp = await this.resolveHostname(
                        clusterUrl.hostname,
                      );
                      if (resolvedClusterIp === resolvedBaseUrlIp) {
                        clusterNode = cn;
                        this.logger.debug(
                          `  DNS match: ${baseUrlHost} → ${resolvedBaseUrlIp} matches ${clusterUrl.hostname} → ${resolvedClusterIp}`,
                        );
                        break;
                      }
                    } catch {
                      // Skip on error
                    }
                  }
                }
              }
            }
          }

          const nodeType = clusterNode?.type || "Secondary";

          this.logger.debug(
            `Mapping node ${id} (baseUrl=${baseUrl}): found cluster node ${clusterNode?.name || "none"}, type: ${nodeType}`,
          );

          return {
            id,
            name: name || id,
            baseUrl,
            clusterState: {
              initialized: true,
              domain: sharedClusterInfo.domain,
              dnsServerDomain: clusterNode?.name || id,
              type: nodeType,
              health: "Connected" as const,
            },
            isPrimary: nodeType === "Primary",
          };
        } catch (nodeError) {
          this.logger.error(
            `Failed to map node ${id} (baseUrl=${baseUrl}):`,
            nodeError,
          );
          return {
            id,
            name: name || id,
            baseUrl,
            clusterState: {
              initialized: false,
              type: "Standalone" as const,
              health: "Unreachable" as const,
            },
            isPrimary: false,
          };
        }
      },
    );

    return Promise.all(nodeSummariesPromise);
  }

  /**
   * Get cluster state for a specific node.
   * Returns cluster initialization status and node role (Primary/Secondary/Standalone).
   */
  async getClusterState(nodeId: string): Promise<TechnitiumClusterState> {
    const node = this.findNode(nodeId);

    try {
      // Call /api/user/session/get to get cluster information (v14+)
      // Note: This endpoint returns data directly, not wrapped in a response field
      const response = await this.request<{
        status: string;
        info?: {
          version?: string;
          clusterInitialized?: boolean;
          clusterDomain?: string;
          dnsServerDomain?: string;
          clusterNodes?: Array<{
            id: number;
            name: string;
            url: string;
            ipAddress: string;
            type: "Primary" | "Secondary";
            state: string;
          }>;
        };
        server?: string;
      }>(node, { method: "GET", url: "/api/user/session/get", params: {} });

      // Check status directly (no unwrapApiResponse needed - data is at root level)
      if (response.status !== "ok") {
        throw new ServiceUnavailableException(
          `Technitium DNS node "${node.id}" returned non-ok status for session info.`,
        );
      }

      const info = response.info;

      if (!info) {
        // v13.x or earlier - no cluster support
        return { initialized: false, type: "Standalone" };
      }

      const clusterInitialized = info.clusterInitialized ?? false;

      if (!clusterInitialized) {
        return { initialized: false, type: "Standalone" };
      }

      // Cluster is initialized - determine node type from clusterNodes array
      const thisNodeDomain = info.dnsServerDomain;
      const clusterNodes = info.clusterNodes || [];

      // Find this node in the clusterNodes array to get its accurate type
      const thisNode = clusterNodes.find((n) => n.name === thisNodeDomain);
      const nodeType = thisNode?.type || "Secondary"; // Default to Secondary if not found

      return {
        initialized: true,
        domain: info.clusterDomain,
        dnsServerDomain: info.dnsServerDomain,
        type: nodeType,
        health: "Connected", // If we got a response, node is reachable
      };
    } catch (error: unknown) {
      const name =
        error instanceof Error && error.constructor
          ? error.constructor.name
          : "Unknown";
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to get cluster state for ${nodeId}: ${name} - ${message}`,
      );
      if (axios.isAxiosError(error) && error.response) {
        this.logger.error(
          `Response status: ${error.response.status}, data: ${JSON.stringify(error.response.data)}`,
        );
      }
      return { initialized: false, type: "Standalone", health: "Unreachable" };
    }
  }

  /**
   * Get cluster timing settings from Technitium DNS.
   * This endpoint only works on the Primary node and requires Administration permissions.
   * Returns default values (30s heartbeat) if the call fails.
   */
  async getClusterSettings(nodeId: string): Promise<TechnitiumClusterSettings> {
    const node = this.findNode(nodeId);
    const defaultSettings: TechnitiumClusterSettings = {
      heartbeatRefreshIntervalSeconds: 30,
      heartbeatRetryIntervalSeconds: 10,
      configRefreshIntervalSeconds: 900,
      configRetryIntervalSeconds: 60,
    };

    try {
      // Call /api/admin/cluster/state/get (Primary node only)
      type ClusterSettingsResponse = {
        clusterInitialized?: boolean;
        heartbeatRefreshIntervalSeconds?: number;
        heartbeatRetryIntervalSeconds?: number;
        configRefreshIntervalSeconds?: number;
        configRetryIntervalSeconds?: number;
      };

      const envelope = await this.request<
        TechnitiumApiResponse<ClusterSettingsResponse>
      >(node, {
        method: "GET",
        url: "/api/admin/cluster/state/get",
        params: {},
      });

      const data = this.unwrapApiResponse(
        envelope,
        node.id,
        "/api/admin/cluster/state/get",
      );

      if (!data.clusterInitialized) {
        this.logger.warn(
          `Node ${nodeId} is not in a cluster, returning default settings`,
        );
        return defaultSettings;
      }

      return {
        heartbeatRefreshIntervalSeconds:
          data.heartbeatRefreshIntervalSeconds ??
          defaultSettings.heartbeatRefreshIntervalSeconds,
        heartbeatRetryIntervalSeconds:
          data.heartbeatRetryIntervalSeconds ??
          defaultSettings.heartbeatRetryIntervalSeconds,
        configRefreshIntervalSeconds:
          data.configRefreshIntervalSeconds ??
          defaultSettings.configRefreshIntervalSeconds,
        configRetryIntervalSeconds:
          data.configRetryIntervalSeconds ??
          defaultSettings.configRetryIntervalSeconds,
      };
    } catch (error: unknown) {
      // This is not critical - cluster settings are just timing values for polling.
      // Primary/Secondary detection works independently via /api/user/session/get.
      // This call may fail if the token lacks admin permissions (/api/admin/* endpoints).
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not fetch cluster timing settings for ${nodeId} (admin permissions may be required): ${message}. Using default polling intervals.`,
      );
      return defaultSettings;
    }
  }

  async getNodeStatus<T = unknown>(
    nodeId: string,
  ): Promise<TechnitiumStatusEnvelope<T>> {
    const node = this.findNode(nodeId);
    const response = await this.request<T>(node, {
      method: "GET",
      url: "/api/status",
    });

    return {
      nodeId: node.id,
      fetchedAt: new Date().toISOString(),
      data: response,
    };
  }

  async getNodeApps(nodeId: string): Promise<TechnitiumNodeAppsResponse> {
    const node = this.findNode(nodeId);

    try {
      const appsEnvelope = await this.request<
        TechnitiumApiResponse<TechnitiumAppsListPayload>
      >(node, { method: "GET", url: "/api/apps/list" });

      const payload = this.unwrapApiResponse(
        appsEnvelope,
        node.id,
        "apps list",
      );
      const rawApps = payload.apps ?? [];

      const apps: TechnitiumAppInfo[] = rawApps
        .filter((app) => app?.name)
        .map((app) => ({
          name: app.name!,
          version: undefined, // API doesn't provide version in list
          description: undefined, // API doesn't provide description in list
        }));

      const hasAdvancedBlocking = apps.some(
        (app) => app.name.toLowerCase() === "advanced blocking",
      );

      return {
        nodeId: node.id,
        apps,
        hasAdvancedBlocking,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to fetch apps for node ${nodeId}:`, error);
      throw error;
    }
  }

  async getNodeOverview(nodeId: string): Promise<TechnitiumNodeOverview> {
    const node = this.findNode(nodeId);

    try {
      // Fetch apps info
      const appsResponse = await this.getNodeApps(nodeId);

      // Fetch zones to count them
      const zonesEnvelope = await this.listZones(nodeId);
      const totalZones = zonesEnvelope.data.zones?.length ?? 0;

      // Fetch settings for version and uptime
      let version = "Unknown";
      let uptime = 0;
      try {
        const settingsResponse = await axios.get<
          TechnitiumApiResponse<TechnitiumSettingsData>
        >(`${node.baseUrl}/api/settings/get`, {
          params: { token: node.token },
          timeout: 30000,
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });
        const settingsData = this.unwrapApiResponse(
          settingsResponse.data,
          nodeId,
          "settings",
        );
        version =
          settingsData.version || settingsData.serverVersion || "Unknown";
        if (settingsData.uptimestamp || settingsData.uptime) {
          const uptimeValue = settingsData.uptimestamp || settingsData.uptime;
          if (uptimeValue) {
            const uptimeDate = new Date(uptimeValue);
            uptime = Math.floor((Date.now() - uptimeDate.getTime()) / 1000);
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to fetch settings for node ${nodeId}:`, error);
      }

      // Fetch dashboard stats for query counts
      let totalQueries = 0;
      let totalBlockedQueries = 0;
      try {
        const statsResponse = await axios.get<
          TechnitiumApiResponse<TechnitiumDashboardStatsData>
        >(`${node.baseUrl}/api/dashboard/stats/get`, {
          params: { token: node.token, type: "LastDay" },
          timeout: 30000,
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });
        const statsData = this.unwrapApiResponse(
          statsResponse.data,
          nodeId,
          "dashboard stats",
        );
        if (statsData.stats) {
          totalQueries = statsData.stats.totalQueries || 0;
          totalBlockedQueries = statsData.stats.totalBlocked || 0;
        }
      } catch (error) {
        this.logger.warn(
          `Failed to fetch dashboard stats for node ${nodeId}:`,
          error,
        );
      }

      return {
        nodeId: node.id,
        version,
        uptime,
        totalZones,
        totalQueries,
        totalBlockedQueries,
        totalApps: appsResponse.apps.length,
        hasAdvancedBlocking: appsResponse.hasAdvancedBlocking,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to fetch overview for node ${nodeId}:`, error);
      throw error;
    }
  }

  async executeAction<T = unknown>(
    nodeId: string,
    payload: TechnitiumActionPayload,
  ): Promise<T> {
    const node = this.findNode(nodeId);
    const config: AxiosRequestConfig = {
      method: payload.method,
      url: payload.url,
    };

    if (payload.headers) {
      config.headers = payload.headers;
    }

    if (payload.params) {
      if (payload.method === "GET" || payload.body !== undefined) {
        config.params = payload.params;
      } else {
        config.data = payload.params;
      }
    }

    if (payload.body !== undefined) {
      config.data = payload.body;
    }

    return this.request<T>(node, config);
  }

  /**
   * Fetch all DHCP leases from a node to build an IP → hostname mapping.
   */
  private async getDhcpLeases(
    node: TechnitiumNodeConfig,
  ): Promise<Map<string, string>> {
    try {
      const envelope = await this.request<
        TechnitiumApiResponse<TechnitiumDhcpLeaseList>
      >(node, { method: "GET", url: "/api/dhcp/leases/list" });

      const data = this.unwrapApiResponse(
        envelope,
        node.id,
        "fetch DHCP leases",
      );
      const ipToHostname = new Map<string, string>();

      if (data.leases && Array.isArray(data.leases)) {
        for (const lease of data.leases) {
          if (
            lease.address &&
            lease.hostName &&
            typeof lease.hostName === "string"
          ) {
            ipToHostname.set(lease.address, lease.hostName);
          }
        }
      }

      return ipToHostname;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch DHCP leases from node "${node.id}": ${error}`,
      );
      return new Map();
    }
  }

  /**
   * Fetch DHCP leases from ALL configured nodes and merge them.
   * This allows nodes without DHCP to benefit from other nodes' DHCP data.
   *
   * Example: If node1 runs DHCP and node2 doesn't, both can show hostnames from node1's leases.
   */
  private async getAllDhcpLeases(): Promise<Map<string, string>> {
    const allLeases = await Promise.all(
      this.nodeConfigs.map((node) => this.getDhcpLeases(node)),
    );

    // Merge all lease maps into one (later entries override earlier ones)
    const merged = new Map<string, string>();
    for (const leaseMap of allLeases) {
      for (const [ip, hostname] of leaseMap.entries()) {
        merged.set(ip, hostname);
      }
    }

    return merged;
  }

  /**
   * Enrich query log entries with hostnames from DHCP leases and cached PTR lookups.
   */
  private enrichWithHostnames(
    entries: TechnitiumQueryLogEntry[],
    ipToHostname: Map<string, string>,
  ): TechnitiumQueryLogEntry[] {
    return entries.map((entry) => {
      const clientIp = entry.clientIpAddress;

      if (!clientIp) {
        return entry;
      }

      // Track this IP for future PTR lookups
      this.recentClientIps.add(clientIp);

      // Priority 1: Use DHCP hostname if available (most reliable for local devices)
      if (ipToHostname.has(clientIp)) {
        return { ...entry, clientName: ipToHostname.get(clientIp) };
      }

      // Priority 2: Check hostname cache (from previous PTR lookups)
      const cached = this.hostnameCache.get(clientIp);
      if (
        cached &&
        Date.now() - cached.lastUpdated < this.HOSTNAME_CACHE_TTL_MS
      ) {
        return { ...entry, clientName: cached.hostname };
      }

      // No hostname available yet - return entry as-is (will show IP only)
      return entry;
    });
  }

  /**
   * Start periodic background PTR lookups for recently seen client IPs.
   */
  private startPeriodicPtrLookups(): void {
    this.stopPeriodicPtrLookups();
    this.logger.log("Starting periodic PTR hostname resolution");

    const runLookupCycle = async () => {
      if (this.recentClientIps.size === 0) {
        return;
      }

      // Take a snapshot of IPs to look up and clear the set
      const ipsToLookup = Array.from(this.recentClientIps);
      this.recentClientIps.clear();

      // Limit to prevent overwhelming DNS
      const limited = ipsToLookup.slice(0, this.MAX_PTR_LOOKUPS_PER_CYCLE);

      this.logger.debug(`Running PTR lookup cycle for ${limited.length} IPs`);

      // Use first available node for DNS resolution
      const node = this.nodeConfigs[0];
      if (!node) {
        return;
      }

      // Perform PTR lookups in parallel (but limited)
      await Promise.allSettled(
        limited.map((ip) => this.performPtrLookup(node, ip)),
      );
    };

    // Run immediately on startup
    runLookupCycle().catch((error) => {
      this.logger.warn(`Initial PTR lookup cycle failed: ${error}`);
    });

    // Then run periodically
    this.ptrLookupTimer = setInterval(() => {
      runLookupCycle().catch((error) => {
        this.logger.warn(`PTR lookup cycle failed: ${error}`);
      });
    }, this.PTR_LOOKUP_INTERVAL_MS);

    // Allow tests to exit cleanly even if teardown misses the clearInterval
    this.ptrLookupTimer.unref?.();
  }

  private stopPeriodicPtrLookups(): void {
    if (!this.ptrLookupTimer) {
      return;
    }

    clearInterval(this.ptrLookupTimer);
    this.ptrLookupTimer = undefined;
    this.logger.log("Stopped periodic PTR lookups");
  }

  /**
   * Perform a single PTR lookup for an IP address using Technitium's DNS client.
   */
  private async performPtrLookup(
    node: TechnitiumNodeConfig,
    ipAddress: string,
  ): Promise<void> {
    try {
      // Skip if we have a fresh cache entry
      const cached = this.hostnameCache.get(ipAddress);
      if (
        cached &&
        Date.now() - cached.lastUpdated < this.HOSTNAME_CACHE_TTL_MS
      ) {
        return;
      }

      // Convert IP to PTR format (e.g., 1.0.168.192.in-addr.arpa)
      const ptrDomain = this.ipToPtrDomain(ipAddress);
      if (!ptrDomain) {
        return;
      }

      // Use Technitium's DNS client API to resolve PTR
      const envelope = await this.request<TechnitiumApiResponse<any>>(node, {
        method: "GET",
        url: "/api/dnsClient/resolve",
        params: {
          server: "this-server", // Use the DNS server itself
          domain: ptrDomain,
          type: "PTR",
          protocol: "Udp",
        },
        timeout: 5000, // 5 second timeout for PTR lookups
      });

      const data = this.unwrapApiResponse<TechnitiumPtrLookupResult>(
        envelope as unknown as TechnitiumApiResponse<TechnitiumPtrLookupResult>,
        node.id,
        "PTR lookup",
      );

      // Extract hostname from PTR response
      const hostname = this.extractHostnameFromPtrResponse(data);

      if (hostname) {
        this.hostnameCache.set(ipAddress, {
          hostname,
          lastUpdated: Date.now(),
          source: "ptr",
        });
        this.logger.debug(`Resolved ${ipAddress} → ${hostname} via PTR`);
      }
    } catch (error) {
      // PTR lookups can fail for many legitimate reasons (no PTR record, timeout, etc.)
      // Just log at debug level to avoid noise
      this.logger.debug(`PTR lookup failed for ${ipAddress}: ${error}`);
    }
  }

  /**
   * Start periodic cleanup of expired cache entries.
   */
  private startPeriodicCacheCleanup(): void {
    this.stopPeriodicCacheCleanup();
    // Clean up every 60 seconds
    this.cacheCleanupTimer = setInterval(() => {
      const now = Date.now();
      let removed = 0;

      for (const [key, entry] of this.queryLogCache.entries()) {
        if (now > entry.expiresAt) {
          this.queryLogCache.delete(key);
          removed++;
        }
      }

      if (removed > 0) {
        this.logger.debug(
          `Cleaned up ${removed} expired query log cache entries`,
        );
      }
    }, 60 * 1000); // Every 60 seconds

    this.cacheCleanupTimer.unref?.();
  }

  private stopPeriodicCacheCleanup(): void {
    if (!this.cacheCleanupTimer) {
      return;
    }

    clearInterval(this.cacheCleanupTimer);
    this.cacheCleanupTimer = undefined;
    this.logger.log("Stopped query log cache cleanup");
  }

  /**
   * Generate cache key for query log requests.
   */
  private getQueryLogCacheKey(filters: TechnitiumQueryLogFilters): string {
    const cacheableFilters = { ...filters };
    delete cacheableFilters.disableCache;
    // Create a stable key from filters
    const key = JSON.stringify({
      nodes: this.nodeConfigs.map((n) => n.id).sort(),
      pageNumber: cacheableFilters.pageNumber ?? 1,
      entriesPerPage: cacheableFilters.entriesPerPage ?? 50,
      descendingOrder: cacheableFilters.descendingOrder ?? true,
      qname: cacheableFilters.qname ?? null,
      clientIpAddress: cacheableFilters.clientIpAddress ?? null,
      protocol: cacheableFilters.protocol ?? null,
      qtype: cacheableFilters.qtype ?? null,
      qclass: cacheableFilters.qclass ?? null,
      rcode: cacheableFilters.rcode ?? null,
      responseType: cacheableFilters.responseType ?? null,
      start: cacheableFilters.start ?? null,
      end: cacheableFilters.end ?? null,
      deduplicateDomains: cacheableFilters.deduplicateDomains ?? false,
    });
    return key;
  }

  /**
   * Convert an IP address to PTR query format.
   */
  private ipToPtrDomain(ipAddress: string): string | null {
    // IPv4: 192.168.1.1 → 1.1.168.192.in-addr.arpa
    const ipv4Match = ipAddress.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      return `${ipv4Match[4]}.${ipv4Match[3]}.${ipv4Match[2]}.${ipv4Match[1]}.in-addr.arpa`;
    }

    // IPv6: Support basic format (could be enhanced for full IPv6 support)
    // For now, skip IPv6 PTR lookups (they're more complex)
    if (ipAddress.includes(":")) {
      this.logger.debug(`Skipping IPv6 PTR lookup for ${ipAddress}`);
      return null;
    }

    return null;
  }

  /**
   * Extract hostname from Technitium DNS client PTR response.
   */
  private extractHostnameFromPtrResponse(
    response: TechnitiumPtrLookupResult,
  ): string | null {
    try {
      // Technitium DNS returns: { result: { Answer: [ { RDATA: { Domain: "hostname" } } ] } }
      const answers = response?.result?.Answer;
      if (!Array.isArray(answers) || answers.length === 0) {
        return null;
      }

      // Get first PTR record
      const ptrRecord = answers.find((record) => record.Type === "PTR");
      if (!ptrRecord) {
        return null;
      }

      const hostname = ptrRecord?.RDATA?.Domain || ptrRecord?.RDATA?.domain;
      if (typeof hostname === "string" && hostname.length > 0) {
        // Remove trailing dot if present
        return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Cleanup method for graceful shutdown (optional).
   */
  onModuleDestroy(): void {
    this.stopPeriodicPtrLookups();
    this.stopPeriodicCacheCleanup();
  }

  async getQueryLogs(
    nodeId: string,
    filters: TechnitiumQueryLogFilters = {},
  ): Promise<TechnitiumStatusEnvelope<TechnitiumQueryLogPage>> {
    const node = this.findNode(nodeId);
    const queryLogger = await this.resolveQueryLogger(node);

    // For node logs, we need to handle pagination differently:
    // We fetch all entries (or a large set) and then apply filtering + pagination on the backend
    const pageNumber = Math.max(filters.pageNumber ?? 1, 1);
    const entriesPerPage = filters.entriesPerPage ?? 50;

    // Fetch multiple pages from Technitium DNS to get more data
    // Technitium DNS limits entries per page (often 25-100), so we need multiple requests
    const ENTRIES_PER_TECHNITIUM_PAGE = 100; // Request 100 per page from Technitium
    const TOTAL_ENTRIES_TO_FETCH = 500; // Fetch up to 500 total entries
    const PAGES_TO_FETCH = Math.ceil(
      TOTAL_ENTRIES_TO_FETCH / ENTRIES_PER_TECHNITIUM_PAGE,
    );

    let fetchedEntries: TechnitiumQueryLogEntry[] = [];

    // Fetch multiple pages from Technitium
    for (let page = 1; page <= PAGES_TO_FETCH; page++) {
      const paramsForFetch = {
        name: queryLogger.name,
        classPath: queryLogger.classPath,
        ...this.buildQueryLogParams({
          ...filters,
          pageNumber: page,
          entriesPerPage: ENTRIES_PER_TECHNITIUM_PAGE,
        }),
      };

      const envelope = await this.request<
        TechnitiumApiResponse<TechnitiumQueryLogPage>
      >(node, {
        method: "GET",
        url: "/api/logs/query",
        params: paramsForFetch,
      });

      const pageData = this.unwrapApiResponse(envelope, node.id, "query logs");
      const pageEntries = pageData.entries ?? [];

      fetchedEntries = fetchedEntries.concat(pageEntries);

      this.logger.debug(
        `[${node.id}] Fetched page ${page}: got ${pageEntries.length} entries, total so far: ${fetchedEntries.length}`,
      );

      // Stop if we got fewer entries than requested (no more pages available)
      if (pageEntries.length < ENTRIES_PER_TECHNITIUM_PAGE) {
        this.logger.debug(
          `[${node.id}] Stopping fetch - got ${pageEntries.length} < ${ENTRIES_PER_TECHNITIUM_PAGE} (no more pages)`,
        );
        break;
      }

      // Stop if we've reached our target
      if (fetchedEntries.length >= TOTAL_ENTRIES_TO_FETCH) {
        this.logger.debug(
          `[${node.id}] Stopping fetch - reached target of ${TOTAL_ENTRIES_TO_FETCH} entries`,
        );
        break;
      }
    }

    this.logger.log(
      `[${node.id}] Final fetch result: ${fetchedEntries.length} total entries from ${PAGES_TO_FETCH} max pages`,
    );

    // Create a synthetic data object with all fetched entries
    const data: TechnitiumQueryLogPage = {
      pageNumber: 1,
      totalPages: 1,
      totalEntries: fetchedEntries.length,
      totalMatchingEntries: fetchedEntries.length,
      entries: fetchedEntries,
    };

    // Fetch DHCP leases from ALL nodes to enrich with hostnames
    // (Some nodes may not run DHCP, so we aggregate across all nodes)
    const ipToHostname = await this.getAllDhcpLeases();

    // Enrich log entries with hostnames from DHCP
    if (data.entries && Array.isArray(data.entries)) {
      data.entries = this.enrichWithHostnames(data.entries, ipToHostname);
    }

    // Apply client-side filtering for fields not handled by Technitium DNS API
    const allEntries = data.entries ?? [];
    let filteredEntries = allEntries.filter((entry) =>
      this.matchesQueryLogFilters(
        entry as TechnitiumCombinedQueryLogEntry,
        filters,
      ),
    );

    // Handle deduplication if requested
    if (filters.deduplicateDomains) {
      const domainMap = new Map<string, TechnitiumQueryLogEntry>();

      for (const entry of filteredEntries) {
        const domain = entry.qname;
        if (!domain) {
          continue;
        }

        const existing = domainMap.get(domain);
        if (!existing) {
          domainMap.set(domain, entry);
          continue;
        }

        // Keep the most "interesting" entry
        const entryIsBlocked =
          entry.responseType === "Blocked" ||
          entry.responseType === "BlockedEDNS";
        const existingIsBlocked =
          existing.responseType === "Blocked" ||
          existing.responseType === "BlockedEDNS";

        if (entryIsBlocked && !existingIsBlocked) {
          domainMap.set(domain, entry);
        } else if (entryIsBlocked === existingIsBlocked) {
          if (entry.qtype === "A" && existing.qtype !== "A") {
            domainMap.set(domain, entry);
          }
        }
      }

      filteredEntries = Array.from(domainMap.values());
    }

    // Apply pagination to filtered results
    const descendingOrder = filters.descendingOrder ?? true;
    filteredEntries.sort((a, b) => {
      const aTime = Date.parse(a.timestamp ?? "");
      const bTime = Date.parse(b.timestamp ?? "");

      if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
        return 0;
      }

      if (Number.isNaN(aTime)) {
        return 1;
      }

      if (Number.isNaN(bTime)) {
        return -1;
      }

      return descendingOrder ? bTime - aTime : aTime - bTime;
    });

    const totalMatchingEntries = filteredEntries.length;
    const effectiveEntriesPerPage =
      entriesPerPage > 0 ? entriesPerPage : totalMatchingEntries;

    // Check if we hit the fetch limit (500 entries)
    // If we fetched exactly 500 and have filters active, there might be more data
    const FETCH_LIMIT = 500;
    const hasFiltersActive = !!(
      filters.qname ||
      filters.clientIpAddress ||
      filters.responseType ||
      filters.qtype ||
      filters.start ||
      filters.end
    );
    const hasMorePages =
      allEntries.length === FETCH_LIMIT &&
      hasFiltersActive &&
      totalMatchingEntries > 0;

    const totalPages =
      effectiveEntriesPerPage > 0
        ? Math.max(1, Math.ceil(totalMatchingEntries / effectiveEntriesPerPage))
        : 1;

    const startIndex =
      effectiveEntriesPerPage > 0
        ? (pageNumber - 1) * effectiveEntriesPerPage
        : 0;
    const endIndex =
      effectiveEntriesPerPage > 0
        ? startIndex + effectiveEntriesPerPage
        : totalMatchingEntries;
    const paginatedEntries = filteredEntries.slice(startIndex, endIndex);

    return {
      nodeId: node.id,
      fetchedAt: new Date().toISOString(),
      data: {
        pageNumber,
        totalPages,
        totalEntries: allEntries.length,
        totalMatchingEntries,
        hasMorePages,
        entries: paginatedEntries,
      },
    };
  }

  /**
   * Filter a query log entry based on filter criteria.
   */
  private matchesQueryLogFilters(
    entry: TechnitiumCombinedQueryLogEntry,
    filters: TechnitiumQueryLogFilters,
  ): boolean {
    // Domain filter (substring match, case-insensitive)
    if (filters.qname) {
      const qname = (entry.qname ?? "").toLowerCase();
      if (!qname.includes(filters.qname.toLowerCase())) {
        return false;
      }
    }

    // Client IP/hostname filter (substring match - checks both IP and hostname)
    if (filters.clientIpAddress) {
      const filterValue = filters.clientIpAddress.toLowerCase();
      const clientIp = (entry.clientIpAddress ?? "").toLowerCase();
      const clientName = (entry.clientName ?? "").toLowerCase();

      // Match if the filter matches either the IP address OR the hostname
      if (
        !clientIp.includes(filterValue) &&
        !clientName.includes(filterValue)
      ) {
        return false;
      }
    }

    // Protocol filter (exact match)
    if (filters.protocol) {
      if (entry.protocol !== filters.protocol) {
        return false;
      }
    }

    // Response type filter (exact match)
    if (filters.responseType) {
      if (entry.responseType !== filters.responseType) {
        return false;
      }
    }

    // RCODE filter (exact match)
    if (filters.rcode) {
      if (entry.rcode !== filters.rcode) {
        return false;
      }
    }

    // QTYPE filter (exact match)
    if (filters.qtype) {
      if (entry.qtype !== filters.qtype) {
        return false;
      }
    }

    // QCLASS filter (exact match)
    if (filters.qclass) {
      if (entry.qclass !== filters.qclass) {
        return false;
      }
    }

    // Start date filter (entries on or after this timestamp)
    if (filters.start) {
      const startTime = new Date(filters.start).getTime();
      const entryTime = new Date(entry.timestamp ?? "").getTime();
      if (entryTime < startTime) {
        return false;
      }
    }

    // End date filter (entries on or before this timestamp)
    if (filters.end) {
      const endTime = new Date(filters.end).getTime();
      const entryTime = new Date(entry.timestamp ?? "").getTime();
      if (entryTime > endTime) {
        return false;
      }
    }

    return true;
  }

  async getCombinedQueryLogs(
    filters: TechnitiumQueryLogFilters = {},
  ): Promise<TechnitiumCombinedQueryLogPage> {
    const { disableCache = false, ...effectiveFilters } = filters;
    const overallStartTime = performance.now();

    const pageNumber = Math.max(effectiveFilters.pageNumber ?? 1, 1);
    const entriesPerPage = effectiveFilters.entriesPerPage ?? 50;
    const descendingOrder = effectiveFilters.descendingOrder ?? true;

    let cacheKey: string | null = null;
    const now = Date.now();

    if (!disableCache) {
      cacheKey = this.getQueryLogCacheKey(effectiveFilters);
      const cached = cacheKey ? this.queryLogCache.get(cacheKey) : undefined;

      if (cached && now <= cached.expiresAt) {
        this.queryLogCacheStats.hits++;
        const age = now - (cached.expiresAt - this.QUERY_LOG_CACHE_TTL_MS);
        const totalDurationMs = performance.now() - overallStartTime;

        this.logger.log(
          `[BENCHMARK] getCombinedQueryLogs: ` +
            `Total=${totalDurationMs.toFixed(2)}ms, ` +
            `CACHE HIT (age: ${age}ms, ${this.queryLogCacheStats.hits} hits / ${this.queryLogCacheStats.misses} misses)`,
        );

        return cached.data;
      }

      this.queryLogCacheStats.misses++;
    } else {
      this.logger.debug(
        "Bypassing combined query log cache (disableCache=true).",
      );
    }

    // Debug logging
    this.logger.debug(
      `getCombinedQueryLogs called with deduplicateDomains: ${effectiveFilters.deduplicateDomains}, pageNumber: ${pageNumber}`,
    );

    // BALANCED NODE SAMPLING: Fetch enough entries from each node
    // The multi-page fetch in getQueryLogs will handle fetching up to 500 entries per node
    const nodeCount = this.nodeConfigs.length;

    // Request enough entries per node to get a good sample
    // getQueryLogs will fetch multiple pages up to 500 entries total
    const entriesPerNode = 500; // Let each node fetch up to 500 entries

    this.logger.debug(
      `Fetching up to ${entriesPerNode} entries per node (${nodeCount} nodes)`,
    );

    // For combined view, we want ALL entries without client-side filtering
    // The filtering and pagination will be done AFTER combining all node entries
    const fetchFilters: TechnitiumQueryLogFilters = {
      pageNumber: 1,
      entriesPerPage: entriesPerNode,
      descendingOrder: effectiveFilters.descendingOrder,
      deduplicateDomains: false, // Don't dedupe per-node, we'll dedupe after combining
      // Don't pass any filter parameters - we want all entries
    };

    // BENCHMARK: Start fetch timing
    const fetchStartTime = performance.now();

    const snapshots = await Promise.all(
      this.nodeConfigs.map(
        async (node): Promise<TechnitiumNodeQueryLogSnapshot> => {
          try {
            const result = await this.getQueryLogs(node.id, fetchFilters);
            return {
              nodeId: node.id,
              baseUrl: node.baseUrl,
              fetchedAt: result.fetchedAt,
              data: result.data,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Failed to fetch query logs from node "${node.id}": ${message}`,
            );
            return {
              nodeId: node.id,
              baseUrl: node.baseUrl,
              fetchedAt: new Date().toISOString(),
              error: message,
            };
          }
        },
      ),
    );

    const fetchEndTime = performance.now();
    const fetchDurationMs = fetchEndTime - fetchStartTime;

    // BENCHMARK: Start processing timing
    const processingStartTime = performance.now();

    const combinedEntries: TechnitiumCombinedQueryLogEntry[] = [];

    for (const snapshot of snapshots) {
      if (!snapshot.data) {
        continue;
      }

      for (const entry of snapshot.data.entries) {
        combinedEntries.push({
          ...entry,
          nodeId: snapshot.nodeId,
          baseUrl: snapshot.baseUrl,
        });
      }
    }

    combinedEntries.sort((a, b) => {
      const aTime = Date.parse(a.timestamp ?? "");
      const bTime = Date.parse(b.timestamp ?? "");

      if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
        return 0;
      }

      if (Number.isNaN(aTime)) {
        return 1;
      }

      if (Number.isNaN(bTime)) {
        return -1;
      }

      return descendingOrder ? bTime - aTime : aTime - bTime;
    });

    // Apply client-side filtering for fields not handled by Technitium DNS API
    this.logger.debug(
      `Combined entries before filtering: ${combinedEntries.length}, filters:`,
      JSON.stringify(effectiveFilters),
    );

    let filteredEntries = combinedEntries.filter((entry) =>
      this.matchesQueryLogFilters(entry, effectiveFilters),
    );

    this.logger.debug(
      `After filtering: ${filteredEntries.length} entries (filtered out ${combinedEntries.length - filteredEntries.length}), deduplicateDomains=${effectiveFilters.deduplicateDomains}`,
    );

    // Handle deduplication if requested
    let duplicatesRemoved = 0;
    if (effectiveFilters.deduplicateDomains) {
      const entriesBeforeDedup = filteredEntries.length;
      this.logger.debug(
        `Starting deduplication of ${entriesBeforeDedup} entries`,
      );
      const domainMap = new Map<string, TechnitiumCombinedQueryLogEntry>();
      const nodeCountMap = new Map<string, number>(); // Track entries per node

      for (const entry of filteredEntries) {
        const domain = entry.qname;
        if (!domain) {
          continue;
        }

        const existing = domainMap.get(domain);
        if (!existing) {
          // First entry for this domain
          domainMap.set(domain, entry);
          nodeCountMap.set(
            entry.nodeId,
            (nodeCountMap.get(entry.nodeId) ?? 0) + 1,
          );
          continue;
        }

        // Keep the most "interesting" entry:
        // 1. Prioritize blocked over allowed
        // 2. Then prioritize A records over others
        // 3. If tied, prefer entry from less-represented node (to maintain node diversity)
        const entryIsBlocked =
          entry.responseType === "Blocked" ||
          entry.responseType === "BlockedEDNS";
        const existingIsBlocked =
          existing.responseType === "Blocked" ||
          existing.responseType === "BlockedEDNS";

        let shouldReplace = false;

        if (entryIsBlocked && !existingIsBlocked) {
          // New entry is blocked, existing is not → keep new entry
          shouldReplace = true;
        } else if (entryIsBlocked === existingIsBlocked) {
          // Same block status, prefer A record
          const entryIsA = entry.qtype === "A";
          const existingIsA = existing.qtype === "A";

          if (entryIsA && !existingIsA) {
            shouldReplace = true;
          } else if (entryIsA === existingIsA) {
            // Same query type - prefer entry from less-represented node to maintain diversity
            const existingNodeCount = nodeCountMap.get(existing.nodeId) ?? 0;
            const entryNodeCount = nodeCountMap.get(entry.nodeId) ?? 0;

            if (entryNodeCount < existingNodeCount) {
              shouldReplace = true;
            }
          }
        }

        if (shouldReplace) {
          // Update domain map
          domainMap.set(domain, entry);
          // Update node counts
          nodeCountMap.set(
            existing.nodeId,
            Math.max(0, (nodeCountMap.get(existing.nodeId) ?? 1) - 1),
          );
          nodeCountMap.set(
            entry.nodeId,
            (nodeCountMap.get(entry.nodeId) ?? 0) + 1,
          );
        }
      }

      filteredEntries = Array.from(domainMap.values());
      duplicatesRemoved = entriesBeforeDedup - filteredEntries.length;
      this.logger.debug(
        `After deduplication: ${filteredEntries.length} unique entries (removed ${duplicatesRemoved} duplicates)`,
      );

      // Log node distribution after deduplication
      const finalNodeCounts = Array.from(nodeCountMap.entries())
        .map(([nodeId, count]) => `${nodeId}:${count}`)
        .join(", ");
      this.logger.debug(
        `Node distribution after deduplication: ${finalNodeCounts}`,
      );

      // OPTIMIZATION (Phase 2): Removed redundant re-sort after deduplication
      // Entries are already sorted by timestamp before dedup (line ~1004-1019)
      // Map iteration preserves insertion order, maintaining chronological order
      // This eliminates ~20-30ms of unnecessary processing
    }

    const effectiveEntriesPerPage =
      entriesPerPage > 0 ? entriesPerPage : filteredEntries.length;
    const totalMatchingEntries = filteredEntries.length;

    // Check if any node hit the fetch limit and we have filters active
    // If so, there might be more data beyond what we fetched
    const FETCH_LIMIT = 500;
    const hasFiltersActive = !!(
      filters.qname ||
      filters.clientIpAddress ||
      filters.responseType ||
      filters.qtype ||
      filters.start ||
      filters.end
    );
    const anyNodeHitLimit = snapshots.some(
      (snapshot) => snapshot.data?.totalEntries === FETCH_LIMIT,
    );
    const hasMorePages =
      anyNodeHitLimit && hasFiltersActive && totalMatchingEntries > 0;

    const totalPages =
      effectiveEntriesPerPage > 0
        ? Math.max(1, Math.ceil(totalMatchingEntries / effectiveEntriesPerPage))
        : 1;
    const startIndex =
      effectiveEntriesPerPage > 0
        ? (pageNumber - 1) * effectiveEntriesPerPage
        : 0;
    const endIndex =
      effectiveEntriesPerPage > 0
        ? startIndex + effectiveEntriesPerPage
        : filteredEntries.length;
    const paginatedEntries = filteredEntries.slice(startIndex, endIndex);

    const nodes: TechnitiumCombinedNodeLogSnapshot[] = snapshots.map(
      (snapshot) => ({
        nodeId: snapshot.nodeId,
        baseUrl: snapshot.baseUrl,
        fetchedAt: snapshot.fetchedAt,
        totalEntries: snapshot.data?.totalEntries,
        totalPages: snapshot.data?.totalPages,
        error: snapshot.error,
      }),
    );

    const processingEndTime = performance.now();
    const processingDurationMs = processingEndTime - processingStartTime;
    const overallEndTime = performance.now();
    const totalDurationMs = overallEndTime - overallStartTime;

    const result: TechnitiumCombinedQueryLogPage = {
      fetchedAt: new Date().toISOString(),
      pageNumber,
      entriesPerPage: effectiveEntriesPerPage,
      totalPages,
      totalMatchingEntries,
      hasMorePages,
      duplicatesRemoved: duplicatesRemoved > 0 ? duplicatesRemoved : undefined,
      totalEntries: combinedEntries.length,
      descendingOrder,
      entries: paginatedEntries,
      nodes,
    };

    // Store in cache
    if (!disableCache && cacheKey) {
      this.queryLogCache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + this.QUERY_LOG_CACHE_TTL_MS,
      });
    }

    // BENCHMARK: Log detailed metrics
    const hitRate =
      this.queryLogCacheStats.hits + this.queryLogCacheStats.misses > 0
        ? (
            (this.queryLogCacheStats.hits /
              (this.queryLogCacheStats.hits + this.queryLogCacheStats.misses)) *
            100
          ).toFixed(1)
        : "0.0";

    this.logger.log(
      `[BENCHMARK] getCombinedQueryLogs: ` +
        `Total=${totalDurationMs.toFixed(2)}ms, ` +
        `Fetch=${fetchDurationMs.toFixed(2)}ms (${((fetchDurationMs / totalDurationMs) * 100).toFixed(1)}%), ` +
        `Processing=${processingDurationMs.toFixed(2)}ms (${((processingDurationMs / totalDurationMs) * 100).toFixed(1)}%), ` +
        `Entries: ${combinedEntries.length}→${filteredEntries.length}${effectiveFilters.deduplicateDomains ? `→${filteredEntries.length}` : ""}→${paginatedEntries.length}, ` +
        `Nodes=${nodeCount}, ` +
        `Dedup=${effectiveFilters.deduplicateDomains ?? false}, ` +
        `Cache: ${hitRate}% hit rate (${this.queryLogCacheStats.hits}/${this.queryLogCacheStats.hits + this.queryLogCacheStats.misses})`,
    );

    return result;
  }

  async listDhcpScopes(
    nodeId: string,
  ): Promise<TechnitiumStatusEnvelope<TechnitiumDhcpScopeList>> {
    const node = this.findNode(nodeId);
    const envelope = await this.request<
      TechnitiumApiResponse<TechnitiumDhcpScopeList>
    >(node, { method: "GET", url: "/api/dhcp/scopes/list" });

    const payload = this.unwrapApiResponse(
      envelope,
      node.id,
      "DHCP scope list",
    );
    const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];

    return {
      nodeId: node.id,
      fetchedAt: new Date().toISOString(),
      data: { scopes },
    };
  }

  async listZones(
    nodeId: string,
  ): Promise<TechnitiumStatusEnvelope<TechnitiumZoneList>> {
    const node = this.findNode(nodeId);
    const envelope = await this.request<
      TechnitiumApiResponse<TechnitiumZoneList>
    >(node, { method: "GET", url: "/api/zones/list" });

    const payload = this.unwrapApiResponse(envelope, node.id, "zone list");
    const zones = Array.isArray(payload.zones)
      ? payload.zones.map((zone) => this.sanitizeZoneSummary(zone))
      : [];

    const pageNumber =
      typeof payload.pageNumber === "number" ? payload.pageNumber : undefined;
    const totalPages =
      typeof payload.totalPages === "number" ? payload.totalPages : undefined;
    const totalZonesRaw =
      typeof payload.totalZones === "number" ? payload.totalZones : undefined;

    const data: TechnitiumZoneList = {
      pageNumber,
      totalPages,
      totalZones: totalZonesRaw ?? zones.length,
      zones,
    };

    return { nodeId: node.id, fetchedAt: new Date().toISOString(), data };
  }

  async getZoneOptions(
    nodeId: string,
    zoneName: string,
  ): Promise<TechnitiumZoneSummary> {
    const node = this.findNode(nodeId);
    const envelope = await this.request<
      TechnitiumApiResponse<Record<string, unknown>>
    >(node, {
      method: "GET",
      url: "/api/zones/options/get",
      params: { zone: zoneName },
    });

    const payload = this.unwrapApiResponse(
      envelope,
      node.id,
      `zone options for ${zoneName}`,
    );
    return this.sanitizeZoneSummary(payload);
  }

  async getCombinedZones(): Promise<TechnitiumCombinedZoneOverview> {
    const snapshots = await Promise.all(
      this.nodeConfigs.map(
        async (node): Promise<TechnitiumNodeZoneSnapshot> => {
          try {
            const envelope = await this.listZones(node.id);
            return {
              nodeId: node.id,
              baseUrl: node.baseUrl,
              fetchedAt: envelope.fetchedAt,
              data: envelope.data,
            };
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Failed to fetch zones from node "${node.id}": ${message}`,
            );
            return {
              nodeId: node.id,
              baseUrl: node.baseUrl,
              fetchedAt: new Date().toISOString(),
              error: message,
            };
          }
        },
      ),
    );

    const snapshotMap = new Map<string, TechnitiumNodeZoneSnapshot>();
    const zoneMap = new Map<string, Map<string, TechnitiumZoneSummary>>();

    for (const snapshot of snapshots) {
      snapshotMap.set(snapshot.nodeId, snapshot);

      if (!snapshot.data) {
        continue;
      }

      for (const zone of snapshot.data.zones) {
        const normalizedName = zone.name?.toLowerCase() ?? "";
        let entry = zoneMap.get(normalizedName);

        if (!entry) {
          entry = new Map<string, TechnitiumZoneSummary>();
          zoneMap.set(normalizedName, entry);
        }

        entry.set(snapshot.nodeId, zone);
      }
    }

    const combinedZones: TechnitiumZoneComparison[] = [];

    for (const [normalizedName, zonesByNode] of zoneMap.entries()) {
      const sample = Array.from(zonesByNode.values()).find(
        (zone) => zone.name.length > 0,
      );
      const displayName = sample?.name ?? normalizedName;

      // Skip internal zones (built-in reverse lookup zones, etc.)
      // These have no user-facing configuration options
      if (sample?.internal === true) {
        this.logger.debug(`Skipping internal zone: ${displayName}`);
        continue;
      }

      // Fetch zone options for each node
      const nodeStatesPromises = this.nodeConfigs.map(async (node) => {
        const snapshot = snapshotMap.get(node.id);
        const zone = zonesByNode.get(node.id);

        let zoneWithOptions = zone;
        if (zone && !snapshot?.error) {
          try {
            zoneWithOptions = await this.getZoneOptions(node.id, zone.name);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            this.logger.warn(
              `Failed to fetch zone options for "${zone.name}" from node "${node.id}": ${message}`,
            );
            // Keep the zone without options if fetching fails
          }
        }

        return {
          nodeId: node.id,
          baseUrl: node.baseUrl,
          fetchedAt: snapshot?.fetchedAt ?? new Date().toISOString(),
          zone: zoneWithOptions,
          error: snapshot?.error,
        };
      });

      const nodeStates: TechnitiumZoneNodeState[] =
        await Promise.all(nodeStatesPromises);

      const { status, differences } = this.determineZoneStatus(nodeStates);

      combinedZones.push({
        name: displayName,
        status,
        differences,
        nodes: nodeStates,
      });
    }

    combinedZones.sort((a, b) => {
      const priorityDelta =
        ZONE_STATUS_PRIORITY[a.status] - ZONE_STATUS_PRIORITY[b.status];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const left = a.name.toLowerCase();
      const right = b.name.toLowerCase();
      return left.localeCompare(right);
    });

    const nodes: TechnitiumCombinedZoneNodeSnapshot[] = snapshots.map(
      (snapshot) => {
        const totalZones =
          snapshot.data?.totalZones ??
          (snapshot.data ? snapshot.data.zones.length : undefined);
        const modifiableZones = snapshot.data
          ? snapshot.data.zones.filter((zone) => zone.internal !== true).length
          : undefined;

        return {
          nodeId: snapshot.nodeId,
          baseUrl: snapshot.baseUrl,
          fetchedAt: snapshot.fetchedAt,
          totalZones,
          modifiableZones,
          error: snapshot.error,
        };
      },
    );

    return {
      fetchedAt: new Date().toISOString(),
      zoneCount: combinedZones.length,
      nodes,
      zones: combinedZones,
    };
  }

  async getDhcpScope(
    nodeId: string,
    scopeName: string,
  ): Promise<TechnitiumStatusEnvelope<TechnitiumDhcpScope>> {
    const normalizedScopeName = this.normalizeScopeName(scopeName);
    const node = this.findNode(nodeId);
    const envelope = await this.request<
      TechnitiumApiResponse<TechnitiumDhcpScope>
    >(node, {
      method: "GET",
      url: "/api/dhcp/scopes/get",
      params: { name: normalizedScopeName },
    });

    const payload = this.unwrapApiResponse(
      envelope,
      node.id,
      `DHCP scope "${normalizedScopeName}"`,
    );

    return {
      nodeId: node.id,
      fetchedAt: new Date().toISOString(),
      data: payload,
    };
  }

  async cloneDhcpScope(
    sourceNodeId: string,
    scopeName: string,
    request: TechnitiumCloneDhcpScopeRequest,
  ): Promise<TechnitiumCloneDhcpScopeResult> {
    if (!request) {
      throw new BadRequestException("Clone request payload is required.");
    }

    const normalizedScopeName = this.normalizeScopeName(scopeName);
    if (!normalizedScopeName) {
      throw new BadRequestException("Scope name is required.");
    }

    const sourceNode = this.findNode(sourceNodeId);
    const requestedTargetId = request.targetNodeId?.trim();
    const targetNode = this.findNode(
      requestedTargetId && requestedTargetId.length > 0
        ? requestedTargetId
        : sourceNode.id,
    );
    const isLocalClone =
      targetNode.id.toLowerCase() === sourceNode.id.toLowerCase();

    if (request.targetNodeId && request.targetNodeId.trim().length === 0) {
      throw new BadRequestException("Target node id cannot be empty.");
    }

    const scopeEnvelope = await this.request<
      TechnitiumApiResponse<TechnitiumDhcpScope>
    >(sourceNode, {
      method: "GET",
      url: "/api/dhcp/scopes/get",
      params: { name: normalizedScopeName },
    });
    const sourceScope = this.unwrapApiResponse(
      scopeEnvelope,
      sourceNode.id,
      `DHCP scope "${normalizedScopeName}"`,
    );

    const listEnvelope = await this.request<
      TechnitiumApiResponse<TechnitiumDhcpScopeList>
    >(sourceNode, { method: "GET", url: "/api/dhcp/scopes/list" });
    const listPayload = this.unwrapApiResponse(
      listEnvelope,
      sourceNode.id,
      "DHCP scope list",
    );
    const sourceSummary = (listPayload.scopes ?? []).find(
      (scope) =>
        scope.name?.toLowerCase() === normalizedScopeName.toLowerCase(),
    );

    if (request.overrides && "name" in request.overrides) {
      throw new BadRequestException(
        'Use "newScopeName" to rename the scope when cloning.',
      );
    }

    const trimmedNewScopeName = this.normalizeScopeName(
      request.newScopeName ?? "",
    );
    if (isLocalClone && !trimmedNewScopeName) {
      throw new BadRequestException(
        'Provide "newScopeName" when cloning a scope on the same node.',
      );
    }

    const targetScopeNameRaw =
      trimmedNewScopeName || sourceScope.name || normalizedScopeName;
    const targetScopeName = this.normalizeScopeName(targetScopeNameRaw);

    if (!targetScopeName) {
      throw new BadRequestException(
        "Unable to determine the target scope name.",
      );
    }

    if (
      isLocalClone &&
      targetScopeName.toLowerCase() === normalizedScopeName.toLowerCase()
    ) {
      throw new BadRequestException(
        "Provide a unique name when cloning a scope on the same node.",
      );
    }

    if (isLocalClone) {
      const conflict = (listPayload.scopes ?? []).some(
        (scope) => scope.name?.toLowerCase() === targetScopeName.toLowerCase(),
      );

      if (conflict) {
        throw new BadRequestException(
          `DHCP scope "${targetScopeName}" already exists on node "${targetNode.id}". Choose a different name.`,
        );
      }
    }

    const mergedScope: TechnitiumDhcpScope = {
      ...sourceScope,
      name: targetScopeName,
    };

    if (request.overrides) {
      const writableScope = mergedScope as unknown as Record<string, unknown>;

      for (const [key, value] of Object.entries(request.overrides)) {
        if (value === undefined) {
          continue;
        }

        writableScope[key] = value;
      }
    }

    const sanitizedScope = JSON.parse(
      JSON.stringify(mergedScope),
    ) as TechnitiumDhcpScope;

    const formData = this.buildDhcpScopeFormData(sanitizedScope);
    const setEnvelope = await this.request<
      TechnitiumApiResponse<Record<string, unknown>>
    >(targetNode, {
      method: "POST",
      url: "/api/dhcp/scopes/set",
      data: formData.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    this.unwrapApiResponse(
      setEnvelope,
      targetNode.id,
      `update DHCP scope "${targetScopeName}"`,
    );

    const desiredEnabled =
      request.enableOnTarget ??
      (sourceSummary?.enabled !== undefined ? sourceSummary.enabled : false);

    const enableDisableUrl = desiredEnabled
      ? "/api/dhcp/scopes/enable"
      : "/api/dhcp/scopes/disable";

    const toggleEnvelope = await this.request<
      TechnitiumApiResponse<Record<string, unknown>>
    >(targetNode, {
      method: "POST",
      url: enableDisableUrl,
      params: { name: targetScopeName },
    });
    this.unwrapApiResponse(
      toggleEnvelope,
      targetNode.id,
      `${desiredEnabled ? "enable" : "disable"} DHCP scope "${targetScopeName}"`,
    );

    return {
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      sourceScopeName: normalizedScopeName,
      targetScopeName,
      enabledOnTarget: desiredEnabled,
    };
  }

  async renameDhcpScope(
    nodeId: string,
    scopeName: string,
    request: import("./technitium.types").TechnitiumRenameDhcpScopeRequest,
  ): Promise<import("./technitium.types").TechnitiumRenameDhcpScopeResult> {
    if (!request || !request.newScopeName) {
      throw new BadRequestException("New scope name is required.");
    }

    const normalizedScopeName = this.normalizeScopeName(scopeName);
    const normalizedNewName = this.normalizeScopeName(request.newScopeName);

    if (!normalizedScopeName) {
      throw new BadRequestException("Scope name is required.");
    }

    if (!normalizedNewName) {
      throw new BadRequestException("New scope name cannot be empty.");
    }

    if (normalizedNewName.toLowerCase() === normalizedScopeName.toLowerCase()) {
      throw new BadRequestException(
        "New scope name must be different from the current name.",
      );
    }

    const node = this.findNode(nodeId);

    const [scopeEnvelope, listEnvelope] = await Promise.all([
      this.request<TechnitiumApiResponse<TechnitiumDhcpScope>>(node, {
        method: "GET",
        url: "/api/dhcp/scopes/get",
        params: { name: normalizedScopeName },
      }),
      this.request<TechnitiumApiResponse<TechnitiumDhcpScopeList>>(node, {
        method: "GET",
        url: "/api/dhcp/scopes/list",
      }),
    ]);

    const sourceScope = this.unwrapApiResponse(
      scopeEnvelope,
      node.id,
      `DHCP scope "${normalizedScopeName}"`,
    );
    const listPayload = this.unwrapApiResponse(
      listEnvelope,
      node.id,
      "DHCP scope list",
    );
    const sourceSummary = (listPayload.scopes ?? []).find(
      (scope) =>
        scope.name?.toLowerCase() === normalizedScopeName.toLowerCase(),
    );

    const desiredEnabled = sourceSummary?.enabled ?? false;

    const conflict = (listPayload.scopes ?? []).some(
      (scope) => scope.name?.toLowerCase() === normalizedNewName.toLowerCase(),
    );
    if (conflict) {
      throw new BadRequestException(
        `DHCP scope "${normalizedNewName}" already exists on node "${node.id}". Choose a different name.`,
      );
    }

    // Build the scope payload with the new name but send both name (old) and newName (new)
    const sanitizedNewScope = JSON.parse(
      JSON.stringify({ ...sourceScope, name: normalizedNewName }),
    ) as TechnitiumDhcpScope;
    const formData = this.buildDhcpScopeFormData(sanitizedNewScope);
    formData.set("name", normalizedScopeName);
    formData.set("newName", normalizedNewName);

    const setEnvelope = await this.request<
      TechnitiumApiResponse<Record<string, unknown>>
    >(node, {
      method: "POST",
      url: "/api/dhcp/scopes/set",
      data: formData.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    this.unwrapApiResponse(
      setEnvelope,
      node.id,
      `rename DHCP scope "${normalizedScopeName}" → "${normalizedNewName}"`,
    );

    // Refresh enabled state from list (Technitium should preserve it across rename)
    const refreshedListEnvelope = await this.request<
      TechnitiumApiResponse<TechnitiumDhcpScopeList>
    >(node, { method: "GET", url: "/api/dhcp/scopes/list" });
    const refreshedList = this.unwrapApiResponse(
      refreshedListEnvelope,
      node.id,
      "DHCP scope list",
    );
    const renamedSummary = (refreshedList.scopes ?? []).find(
      (scope) => scope.name?.toLowerCase() === normalizedNewName.toLowerCase(),
    );
    const refreshedEnabled = renamedSummary?.enabled ?? desiredEnabled;

    return {
      nodeId: node.id,
      sourceScopeName: normalizedScopeName,
      targetScopeName: normalizedNewName,
      enabled: refreshedEnabled,
    };
  }

  async updateDhcpScope(
    nodeId: string,
    scopeName: string,
    request: TechnitiumUpdateDhcpScopeRequest,
  ): Promise<TechnitiumStatusEnvelope<TechnitiumUpdateDhcpScopeResult>> {
    if (!request) {
      throw new BadRequestException("Update request payload is required.");
    }

    const normalizedScopeName = this.normalizeScopeName(scopeName);
    if (!normalizedScopeName) {
      throw new BadRequestException("Scope name is required.");
    }

    if (
      request.overrides &&
      Object.prototype.hasOwnProperty.call(request.overrides, "name")
    ) {
      throw new BadRequestException(
        "Renaming a scope is not supported when updating in place.",
      );
    }

    const hasOverrides =
      !!request.overrides &&
      Object.values(request.overrides).some((value) => value !== undefined);
    const wantsEnabledChange = request.enabled !== undefined;

    if (!hasOverrides && !wantsEnabledChange) {
      throw new BadRequestException(
        "Provide at least one field override or an enabled flag when updating a DHCP scope.",
      );
    }

    const node = this.findNode(nodeId);

    const [scopeEnvelope, listEnvelope] = await Promise.all([
      this.request<TechnitiumApiResponse<TechnitiumDhcpScope>>(node, {
        method: "GET",
        url: "/api/dhcp/scopes/get",
        params: { name: normalizedScopeName },
      }),
      this.request<TechnitiumApiResponse<TechnitiumDhcpScopeList>>(node, {
        method: "GET",
        url: "/api/dhcp/scopes/list",
      }),
    ]);

    const currentScope = this.unwrapApiResponse(
      scopeEnvelope,
      node.id,
      `DHCP scope "${normalizedScopeName}"`,
    );
    const listPayload = this.unwrapApiResponse(
      listEnvelope,
      node.id,
      "DHCP scope list",
    );
    const currentSummary = (listPayload.scopes ?? []).find(
      (scope) =>
        scope.name?.toLowerCase() === normalizedScopeName.toLowerCase(),
    );
    const currentEnabled = currentSummary?.enabled ?? false;

    const mergedScope: TechnitiumDhcpScope = { ...currentScope };

    if (request.overrides) {
      const writableScope = mergedScope as unknown as Record<string, unknown>;

      for (const [key, value] of Object.entries(request.overrides)) {
        if (value === undefined) {
          continue;
        }

        writableScope[key] = value;
      }
    }

    const sanitizedScope = JSON.parse(
      JSON.stringify(mergedScope),
    ) as TechnitiumDhcpScope;
    const formData = this.buildDhcpScopeFormData(sanitizedScope);

    const setEnvelope = await this.request<
      TechnitiumApiResponse<Record<string, unknown>>
    >(node, {
      method: "POST",
      url: "/api/dhcp/scopes/set",
      data: formData.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    this.unwrapApiResponse(
      setEnvelope,
      node.id,
      `update DHCP scope "${normalizedScopeName}"`,
    );

    let effectiveEnabled = currentEnabled;

    if (wantsEnabledChange) {
      const desiredEnabled = request.enabled as boolean;
      const enableDisableUrl = desiredEnabled
        ? "/api/dhcp/scopes/enable"
        : "/api/dhcp/scopes/disable";

      const toggleEnvelope = await this.request<
        TechnitiumApiResponse<Record<string, unknown>>
      >(node, {
        method: "POST",
        url: enableDisableUrl,
        params: { name: normalizedScopeName },
      });
      this.unwrapApiResponse(
        toggleEnvelope,
        node.id,
        `${desiredEnabled ? "enable" : "disable"} DHCP scope "${normalizedScopeName}"`,
      );

      effectiveEnabled = desiredEnabled;
    }

    // Fetch the updated scope for the response
    const updatedScopeEnvelope = await this.request<
      TechnitiumApiResponse<TechnitiumDhcpScope>
    >(node, {
      method: "GET",
      url: "/api/dhcp/scopes/get",
      params: { name: normalizedScopeName },
    });
    const updatedScope = this.unwrapApiResponse(
      updatedScopeEnvelope,
      node.id,
      `DHCP scope "${normalizedScopeName}"`,
    );

    return {
      nodeId: node.id,
      fetchedAt: new Date().toISOString(),
      data: { scope: updatedScope, enabled: effectiveEnabled },
    };
  }

  async deleteDhcpScope(
    nodeId: string,
    scopeName: string,
  ): Promise<{ success: boolean; message: string }> {
    const node = this.findNode(nodeId);
    const normalizedScopeName = scopeName.trim();

    if (!normalizedScopeName) {
      throw new BadRequestException("Scope name cannot be empty.");
    }

    // Call Technitium DNS API to delete the scope
    const response = await this.request<TechnitiumApiResponse<unknown>>(node, {
      method: "GET",
      url: "/api/dhcp/scopes/delete",
      params: { name: normalizedScopeName },
    });

    // Verify deletion was successful
    this.unwrapApiResponse(
      response,
      node.id,
      `delete DHCP scope "${normalizedScopeName}"`,
    );

    return {
      success: true,
      message: `DHCP scope "${normalizedScopeName}" deleted successfully from ${node.id}.`,
    };
  }

  async bulkSyncDhcpScopes(
    request: import("./technitium.types").DhcpBulkSyncRequest,
  ): Promise<import("./technitium.types").DhcpBulkSyncResult> {
    const {
      sourceNodeId,
      targetNodeIds,
      strategy,
      scopeNames,
      enableOnTarget,
    } = request;

    if (!sourceNodeId || !targetNodeIds || targetNodeIds.length === 0) {
      throw new BadRequestException(
        "Source node ID and at least one target node ID are required.",
      );
    }

    // Validate source node exists
    this.findNode(sourceNodeId);

    // Get all scopes from source node
    const sourceScopesEnvelope = await this.listDhcpScopes(sourceNodeId);
    const sourceScopes = sourceScopesEnvelope.data.scopes || [];

    // Filter to specific scopes if requested
    const scopesToSync =
      scopeNames && scopeNames.length > 0
        ? sourceScopes.filter((scope) =>
            scopeNames.some(
              (name) => name.toLowerCase() === scope.name?.toLowerCase(),
            ),
          )
        : sourceScopes;

    if (scopesToSync.length === 0) {
      throw new BadRequestException("No scopes found to sync on source node.");
    }

    const nodeResults: import("./technitium.types").DhcpBulkSyncNodeResult[] =
      [];

    // Sync to each target node
    for (const targetNodeId of targetNodeIds) {
      if (targetNodeId === sourceNodeId) {
        continue; // Skip self-sync
      }

      // Validate target node exists
      try {
        this.findNode(targetNodeId);
      } catch {
        nodeResults.push({
          targetNodeId,
          status: "failed",
          scopeResults: [],
          syncedCount: 0,
          skippedCount: 0,
          failedCount: scopesToSync.length,
        });
        continue;
      }

      // Get existing scopes on target
      let targetScopes: import("./technitium.types").TechnitiumDhcpScope[] = [];
      try {
        const targetScopesEnvelope = await this.listDhcpScopes(targetNodeId);
        targetScopes = targetScopesEnvelope.data.scopes || [];
      } catch {
        nodeResults.push({
          targetNodeId,
          status: "failed",
          scopeResults: [],
          syncedCount: 0,
          skippedCount: 0,
          failedCount: scopesToSync.length,
        });
        continue;
      }

      const scopeResults: import("./technitium.types").DhcpBulkSyncScopeResult[] =
        [];
      let syncedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      // For 'overwrite-all' (mirror) strategy: delete all existing scopes on target first
      if (strategy === "overwrite-all" && targetScopes.length > 0) {
        for (const targetScope of targetScopes) {
          if (!targetScope.name) {
            continue;
          }
          try {
            await this.deleteDhcpScope(targetNodeId, targetScope.name);
            this.logger.log(
              `Deleted scope "${targetScope.name}" from ${targetNodeId} (mirror strategy)`,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to delete scope "${targetScope.name}" from ${targetNodeId}: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            // Continue anyway - we'll try to overwrite it
          }
        }
      }

      // Sync each scope
      for (const sourceScope of scopesToSync) {
        const scopeName = sourceScope.name;
        if (!scopeName) {
          continue;
        }

        const existsOnTarget = targetScopes.some(
          (scope) => scope.name?.toLowerCase() === scopeName.toLowerCase(),
        );

        // Apply strategy
        if (strategy === "skip-existing" && existsOnTarget) {
          // Skip: Don't touch scopes that already exist on target
          scopeResults.push({
            scopeName,
            status: "skipped",
            reason: "Scope already exists on target (skip-existing strategy)",
          });
          skippedCount++;
          continue;
        }

        // For 'merge-missing': sync all scopes (add new + update existing)
        // For 'overwrite-all': sync all scopes (add new + update existing)
        // Both strategies call cloneDhcpScope which will create or overwrite

        // Clone scope to target
        try {
          await this.cloneDhcpScope(sourceNodeId, scopeName, {
            targetNodeId,
            newScopeName: scopeName, // Use same name (overwrite if exists)
            enableOnTarget: enableOnTarget ?? sourceScope.enabled,
          });

          scopeResults.push({ scopeName, status: "synced" });
          syncedCount++;
        } catch (error) {
          scopeResults.push({
            scopeName,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
          });
          failedCount++;
        }
      }

      const nodeStatus: import("./technitium.types").DhcpBulkSyncNodeResult["status"] =
        failedCount === 0 ? "success" : syncedCount > 0 ? "partial" : "failed";

      nodeResults.push({
        targetNodeId,
        status: nodeStatus,
        scopeResults,
        syncedCount,
        skippedCount,
        failedCount,
      });
    }

    const totalSynced = nodeResults.reduce(
      (sum, node) => sum + node.syncedCount,
      0,
    );
    const totalSkipped = nodeResults.reduce(
      (sum, node) => sum + node.skippedCount,
      0,
    );
    const totalFailed = nodeResults.reduce(
      (sum, node) => sum + node.failedCount,
      0,
    );

    return {
      sourceNodeId,
      nodeResults,
      totalSynced,
      totalSkipped,
      totalFailed,
      completedAt: new Date().toISOString(),
    };
  }

  private sanitizeZoneSummary(zone: unknown): TechnitiumZoneSummary {
    const payload = (zone ?? {}) as Record<string, unknown>;
    const name = typeof payload.name === "string" ? payload.name : "";

    const toBoolean = (value: unknown): boolean | undefined =>
      typeof value === "boolean" ? value : undefined;
    const toNumber = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const toStringValue = (value: unknown): string | undefined =>
      typeof value === "string" ? value : undefined;

    const normalizeStringArray = (
      values: string[] | null | undefined,
    ): string[] => {
      if (!values || !Array.isArray(values) || values.length === 0) {
        return [];
      }
      const entries = values
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      return entries;
    };

    let notifyFailedFor: string[] | undefined;
    if (Array.isArray(payload.notifyFailedFor)) {
      const entries = payload.notifyFailedFor
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

      notifyFailedFor = entries.length > 0 ? entries : [];
    }

    return {
      name,
      type: toStringValue(payload.type),
      internal: toBoolean(payload.internal),
      dnssecStatus: toStringValue(payload.dnssecStatus),
      soaSerial: toNumber(payload.soaSerial),
      expiry: toStringValue(payload.expiry),
      isExpired: toBoolean(payload.isExpired),
      syncFailed: toBoolean(payload.syncFailed),
      notifyFailed: toBoolean(payload.notifyFailed),
      notifyFailedFor,
      lastModified: toStringValue(payload.lastModified),
      disabled: toBoolean(payload.disabled),
      // Advanced configuration fields
      zoneTransfer: toStringValue(payload.zoneTransfer),
      zoneTransferNetworkACL: normalizeStringArray(
        payload.zoneTransferNetworkACL as string[],
      ),
      zoneTransferTsigKeyNames: normalizeStringArray(
        payload.zoneTransferTsigKeyNames as string[],
      ),
      queryAccess: toStringValue(payload.queryAccess),
      queryAccessNetworkACL: normalizeStringArray(
        payload.queryAccessNetworkACL as string[],
      ),
      notify: toStringValue(payload.notify),
      notifyNameServers: normalizeStringArray(
        payload.notifyNameServers as string[],
      ),
      primaryNameServerAddresses: normalizeStringArray(
        payload.primaryNameServerAddresses as string[],
      ),
    };
  }

  private determineZoneStatus(nodes: TechnitiumZoneNodeState[]): {
    status: TechnitiumZoneComparisonStatus;
    differences?: string[];
  } {
    const hasError = nodes.some((node) => node.error);

    if (hasError) {
      return { status: "unknown" };
    }

    const present = nodes.filter((node) => node.zone);
    if (present.length === 0) {
      return { status: "unknown" };
    }

    const missing = nodes.filter((node) => !node.zone && !node.error);
    if (missing.length > 0) {
      return {
        status: "missing",
        differences: [this.zoneFieldLabel("presence")],
      };
    }

    if (present.length === 1) {
      return { status: "in-sync" };
    }

    const differences = this.computeZoneDifferences(
      present.map((entry) => entry.zone!),
    );

    if (differences.length === 0) {
      return { status: "in-sync" };
    }

    return {
      status: "different",
      differences: differences.map((field) => this.zoneFieldLabel(field)),
    };
  }

  private computeZoneDifferences(
    zones: TechnitiumZoneSummary[],
  ): ZoneComparisonField[] {
    if (zones.length <= 1) {
      return [];
    }

    // Check if all zones have the same type
    const types = zones.map((z) => z.type ?? "unknown");
    const uniqueTypes = new Set(types);

    // If zone types differ (e.g., Primary on one node, Secondary on another),
    // don't compare their settings - they're meant to be different!
    // This handles Primary/Secondary replication where Primary has Notify/Transfer
    // but Secondary shouldn't.
    if (uniqueTypes.size > 1) {
      this.logger.debug(
        `Skipping comparison for zones with different types: ${Array.from(uniqueTypes).join(", ")}`,
      );
      // TODO: Future enhancement - validate Primary→Secondary relationship
      // For now, mark as in-sync since different types are expected
      return [];
    }

    const baseline = zones[0];
    const differences = new Set<ZoneComparisonField>();

    // Determine which conditional fields to compare based on zone type
    const shouldCompareConditional = !SECONDARY_FORWARDER_TYPES.has(
      baseline.type ?? "",
    );
    const fieldsToCompare = [
      ...ZONE_COMPARISON_FIELDS_ALWAYS,
      ...(shouldCompareConditional ? ZONE_COMPARISON_FIELDS_CONDITIONAL : []),
    ];

    const baselineNormalized = this.normalizeZoneComparison(
      baseline,
      shouldCompareConditional,
    );

    for (let index = 1; index < zones.length; index += 1) {
      const currentNormalized = this.normalizeZoneComparison(
        zones[index],
        shouldCompareConditional,
      );

      for (const field of fieldsToCompare) {
        if (
          !this.areZoneValuesEqual(
            baselineNormalized[field as ZoneComparisonField],
            currentNormalized[field as ZoneComparisonField],
          )
        ) {
          differences.add(field as ZoneComparisonField);
        }
      }
    }

    return Array.from(differences);
  }

  private normalizeZoneComparison(
    zone: TechnitiumZoneSummary,
    includeConditionalFields: boolean = true,
  ): Record<ZoneComparisonField, unknown> {
    const result: Record<string, unknown> = {
      dnssecStatus: zone.dnssecStatus ?? "",
      soaSerial: zone.soaSerial ?? null,
      disabled: zone.disabled ?? false,
      internal: zone.internal ?? false,
      notifyFailed: zone.notifyFailed ?? false,
      notifyFailedFor: this.normalizeStringArray(zone.notifyFailedFor),
      syncFailed: zone.syncFailed ?? false,
      isExpired: zone.isExpired ?? false,
      queryAccess: zone.queryAccess ?? "",
      queryAccessNetworkACL: this.normalizeStringArray(
        zone.queryAccessNetworkACL,
      ),
    };

    if (includeConditionalFields) {
      result.zoneTransfer = zone.zoneTransfer ?? "";
      result.zoneTransferNetworkACL = this.normalizeStringArray(
        zone.zoneTransferNetworkACL,
      );
      result.zoneTransferTsigKeyNames = this.normalizeStringArray(
        zone.zoneTransferTsigKeyNames,
      );
      result.notify = zone.notify ?? "";
      result.notifyNameServers = this.normalizeStringArray(
        zone.notifyNameServers,
      );
    }

    return result as Record<ZoneComparisonField, unknown>;
  }

  private normalizeStringArray(values: string[] | null | undefined): string[] {
    if (!values || values.length === 0) {
      return [];
    }

    const filtered = values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (filtered.length === 0) {
      return [];
    }

    return [...filtered].sort((a, b) => a.localeCompare(b));
  }

  private areZoneValuesEqual(left: unknown, right: unknown): boolean {
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) {
        return false;
      }

      return left.every((value, index) => value === right[index]);
    }

    return left === right;
  }

  private zoneFieldLabel(field: ZoneComparisonField | "presence"): string {
    return ZONE_FIELD_LABELS[field] ?? field;
  }

  async request<T>(
    node: TechnitiumNodeConfig,
    config: AxiosRequestConfig,
  ): Promise<T> {
    try {
      const axiosConfig: AxiosRequestConfig = {
        baseURL: node.baseUrl,
        timeout: 30_000, // Increased to 30s for VPN/remote development
        // Accept self-signed certificates for internal Technitium DNS servers
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        ...config,
      };

      // Add token to request params
      const params = axiosConfig.params as unknown;
      if (params instanceof URLSearchParams) {
        if (!params.has("token")) {
          params.set("token", node.token);
        }
      } else {
        const paramsObject =
          params && typeof params === "object"
            ? (params as Record<string, unknown>)
            : {};

        if (!("token" in paramsObject)) {
          axiosConfig.params = { ...paramsObject, token: node.token };
        }
      }
      const response: AxiosResponse<T> = await axios.request<T>(axiosConfig);

      return response.data;
    } catch (error) {
      throw this.normalizeAxiosError(error, node.id);
    }
  }

  private findNode(nodeId: string): TechnitiumNodeConfig {
    const target = this.nodeConfigs.find(
      (node) => node.id.toLowerCase() === nodeId.toLowerCase(),
    );

    if (!target) {
      throw new NotFoundException(
        `Technitium DNS node "${nodeId}" is not configured.`,
      );
    }

    return target;
  }

  private normalizeScopeName(name: string): string {
    return (name ?? "").trim();
  }

  private buildDhcpScopeFormData(scope: TechnitiumDhcpScope): URLSearchParams {
    const form = new URLSearchParams();

    const assign = (
      key: string,
      value: string | number | boolean | null | undefined,
    ) => {
      if (value === undefined) {
        return;
      }

      if (value === null) {
        form.set(key, "");
        return;
      }

      form.set(key, String(value));
    };

    const hasOwn = (key: keyof TechnitiumDhcpScope): boolean =>
      Object.prototype.hasOwnProperty.call(scope, key) as boolean;

    const assignCommaList = (
      key: string,
      values: string[] | null | undefined,
      owns: boolean,
    ) => {
      if (!owns) {
        return;
      }

      if (!values || values.length === 0) {
        form.set(key, "");
        return;
      }

      form.set(key, values.join(","));
    };

    assign("name", scope.name);
    assign("startingAddress", scope.startingAddress);
    assign("endingAddress", scope.endingAddress);
    assign("subnetMask", scope.subnetMask);
    assign(
      "leaseTimeDays",
      hasOwn("leaseTimeDays") ? scope.leaseTimeDays : undefined,
    );
    assign(
      "leaseTimeHours",
      hasOwn("leaseTimeHours") ? scope.leaseTimeHours : undefined,
    );
    assign(
      "leaseTimeMinutes",
      hasOwn("leaseTimeMinutes") ? scope.leaseTimeMinutes : undefined,
    );
    assign(
      "offerDelayTime",
      hasOwn("offerDelayTime") ? scope.offerDelayTime : undefined,
    );
    assign(
      "pingCheckEnabled",
      hasOwn("pingCheckEnabled") ? scope.pingCheckEnabled : undefined,
    );
    assign(
      "pingCheckTimeout",
      hasOwn("pingCheckTimeout") ? scope.pingCheckTimeout : undefined,
    );
    assign(
      "pingCheckRetries",
      hasOwn("pingCheckRetries") ? scope.pingCheckRetries : undefined,
    );
    assign("domainName", hasOwn("domainName") ? scope.domainName : undefined);
    assignCommaList(
      "domainSearchList",
      scope.domainSearchList,
      hasOwn("domainSearchList"),
    );
    assign("dnsUpdates", hasOwn("dnsUpdates") ? scope.dnsUpdates : undefined);
    assign("dnsTtl", hasOwn("dnsTtl") ? scope.dnsTtl : undefined);
    assign(
      "serverAddress",
      hasOwn("serverAddress") ? scope.serverAddress : undefined,
    );
    assign(
      "serverHostName",
      hasOwn("serverHostName") ? scope.serverHostName : undefined,
    );
    assign(
      "bootFileName",
      hasOwn("bootFileName") ? scope.bootFileName : undefined,
    );
    assign(
      "routerAddress",
      hasOwn("routerAddress") ? scope.routerAddress : undefined,
    );
    assign(
      "useThisDnsServer",
      hasOwn("useThisDnsServer") ? scope.useThisDnsServer : undefined,
    );
    assignCommaList("dnsServers", scope.dnsServers, hasOwn("dnsServers"));
    assignCommaList("winsServers", scope.winsServers, hasOwn("winsServers"));
    assignCommaList("ntpServers", scope.ntpServers, hasOwn("ntpServers"));
    assignCommaList(
      "ntpServerDomainNames",
      scope.ntpServerDomainNames,
      hasOwn("ntpServerDomainNames"),
    );

    if (hasOwn("staticRoutes")) {
      if (!scope.staticRoutes || scope.staticRoutes.length === 0) {
        form.set("staticRoutes", "");
      } else {
        const flattened = scope.staticRoutes.flatMap((route) => [
          route.destination ?? "",
          route.subnetMask ?? "",
          route.router ?? "",
        ]);
        form.set("staticRoutes", flattened.join("|"));
      }
    }

    if (hasOwn("vendorInfo")) {
      if (!scope.vendorInfo || scope.vendorInfo.length === 0) {
        form.set("vendorInfo", "");
      } else {
        const flattened = scope.vendorInfo.flatMap((info) => [
          info.identifier ?? "",
          info.information ?? "",
        ]);
        form.set("vendorInfo", flattened.join("|"));
      }
    }

    assignCommaList(
      "capwapAcIpAddresses",
      scope.capwapAcIpAddresses,
      hasOwn("capwapAcIpAddresses"),
    );
    assignCommaList(
      "tftpServerAddresses",
      scope.tftpServerAddresses,
      hasOwn("tftpServerAddresses"),
    );

    if (hasOwn("genericOptions")) {
      if (!scope.genericOptions || scope.genericOptions.length === 0) {
        form.set("genericOptions", "");
      } else {
        const flattened = scope.genericOptions.flatMap((option) => [
          option.code?.toString() ?? "",
          option.value ?? "",
        ]);
        form.set("genericOptions", flattened.join("|"));
      }
    }

    if (hasOwn("exclusions")) {
      if (!scope.exclusions || scope.exclusions.length === 0) {
        form.set("exclusions", "");
      } else {
        const flattened = scope.exclusions.flatMap((exclusion) => [
          exclusion.startingAddress ?? "",
          exclusion.endingAddress ?? "",
        ]);
        form.set("exclusions", flattened.join("|"));
      }
    }

    if (hasOwn("reservedLeases")) {
      if (!scope.reservedLeases || scope.reservedLeases.length === 0) {
        form.set("reservedLeases", "");
      } else {
        const flattened = scope.reservedLeases.flatMap((lease) => [
          lease.hostName ?? "",
          lease.hardwareAddress ?? "",
          lease.address ?? "",
          lease.comments ?? "",
        ]);
        form.set("reservedLeases", flattened.join("|"));
      }
    }

    assign(
      "allowOnlyReservedLeases",
      hasOwn("allowOnlyReservedLeases")
        ? scope.allowOnlyReservedLeases
        : undefined,
    );
    assign(
      "blockLocallyAdministeredMacAddresses",
      hasOwn("blockLocallyAdministeredMacAddresses")
        ? scope.blockLocallyAdministeredMacAddresses
        : undefined,
    );
    assign(
      "ignoreClientIdentifierOption",
      hasOwn("ignoreClientIdentifierOption")
        ? scope.ignoreClientIdentifierOption
        : undefined,
    );

    return form;
  }

  private buildQueryLogParams(
    filters: TechnitiumQueryLogFilters,
  ): Record<string, string | number | boolean> {
    const params: Record<string, string | number | boolean> = {};
    const assign = <K extends keyof TechnitiumQueryLogFilters>(key: K) => {
      const value = filters[key];
      if (value === undefined || value === null) {
        return;
      }

      if (typeof value === "string") {
        if (value.trim().length === 0) {
          return;
        }

        params[key] = value;
        return;
      }

      params[key] = value;
    };

    assign("pageNumber");
    assign("entriesPerPage");
    assign("descendingOrder");
    assign("start");
    assign("end");
    // Technitium DNS API uses 'client' parameter, not 'clientIpAddress'
    if (filters.clientIpAddress) {
      params["client"] = filters.clientIpAddress;
    }
    assign("protocol");
    assign("responseType");
    assign("rcode");
    assign("qname");
    assign("qtype");
    assign("qclass");

    console.log("🔍 buildQueryLogParams - filters:", filters);
    console.log("🔍 buildQueryLogParams - params:", params);

    return params;
  }

  private async resolveQueryLogger(
    node: TechnitiumNodeConfig,
  ): Promise<TechnitiumQueryLoggerMetadata> {
    const cached = this.queryLoggerCache.get(node.id);
    if (cached) {
      return cached;
    }

    if (node.queryLoggerAppName && node.queryLoggerClassPath) {
      const metadata: TechnitiumQueryLoggerMetadata = {
        name: node.queryLoggerAppName,
        classPath: node.queryLoggerClassPath,
      };
      this.queryLoggerCache.set(node.id, metadata);
      return metadata;
    }

    const appsEnvelope = await this.request<
      TechnitiumApiResponse<TechnitiumAppsListPayload>
    >(node, { method: "GET", url: "/api/apps/list" });

    const payload = this.unwrapApiResponse(appsEnvelope, node.id, "apps list");
    const apps = payload.apps ?? [];

    for (const app of apps) {
      if (!app?.name) {
        continue;
      }

      for (const dnsApp of app.dnsApps ?? []) {
        if (dnsApp?.isQueryLogger && dnsApp.classPath) {
          const metadata: TechnitiumQueryLoggerMetadata = {
            name: app.name,
            classPath: dnsApp.classPath,
          };
          this.queryLoggerCache.set(node.id, metadata);
          return metadata;
        }
      }
    }

    throw new ServiceUnavailableException(
      `Technitium DNS node "${node.id}" does not report any query logger apps.`,
    );
  }

  private unwrapApiResponse<T>(
    envelope: TechnitiumApiResponse<T>,
    nodeId: string,
    context: string,
  ): T {
    if (!envelope) {
      throw new ServiceUnavailableException(
        `Technitium DNS node "${nodeId}" returned no data while fetching ${context}.`,
      );
    }

    if (envelope.status !== "ok") {
      const detail =
        envelope.errorMessage ?? envelope.innerErrorMessage ?? "unknown error";
      throw new ServiceUnavailableException(
        `Technitium DNS node "${nodeId}" rejected ${context}: ${detail}.`,
      );
    }

    if (envelope.response === undefined) {
      throw new ServiceUnavailableException(
        `Technitium DNS node "${nodeId}" did not include a response payload for ${context}.`,
      );
    }

    return envelope.response;
  }

  private normalizeAxiosError(error: unknown, nodeId: string): HttpException {
    if (this.isAxiosError(error)) {
      const axiosError = error;

      if (axiosError.response) {
        const { status, data, statusText } = axiosError.response;
        const message =
          typeof data === "string"
            ? data
            : ((data as Record<string, unknown>)?.message ?? statusText);

        return new HttpException(
          {
            message: message ?? "Technitium DNS API request failed",
            nodeId,
            details: data,
          },
          status ?? 500,
        );
      }

      this.logger.error(
        `Network error while contacting Technitium DNS node "${nodeId}": ${axiosError.message}`,
      );

      return new ServiceUnavailableException(
        `Unable to reach Technitium DNS node "${nodeId}". Check connectivity and credentials.`,
      );
    }

    this.logger.error(
      `Unexpected error while contacting Technitium DNS node "${nodeId}"`,
      error as Error,
    );
    return new ServiceUnavailableException(
      "Unexpected error while contacting Technitium DNS node.",
    );
  }

  private isAxiosError(error: unknown): error is AxiosError {
    return !!error && typeof error === "object" && "isAxiosError" in error;
  }
}
