/**
 * Built-in Blocking Service
 *
 * Service for managing Technitium DNS's native allow/blocklist functionality.
 * This is the built-in blocking mechanism that does NOT require the Advanced Blocking App.
 *
 * API Reference: https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { TechnitiumService } from "./technitium.service";
import type {
  TechnitiumApiResponse,
  TechnitiumNodeSummary,
} from "./technitium.types";
import type {
  BlockingZoneEntry,
  BlockingZoneListParams,
  BlockingZoneListResponse,
  BlockingZoneAddParams,
  BlockingZoneDeleteParams,
  BlockingZoneImportParams,
  BlockingSettings,
  BuiltInBlockingMetrics,
  BuiltInBlockingSnapshot,
  BuiltInBlockingOverview,
  BlockingZoneOperationResult,
  UpdateBlockingSettingsRequest,
  BlockingStatusOverview,
  NodeBlockingStatus,
  DomainTreeNode,
} from "./built-in-blocking.types";

/** Raw response from /api/allowed/list or /api/blocked/list */
interface RawBlockingListResponse {
  domain: string;
  zones?: string[];
  records?: Array<{
    name: string;
    type: string;
    ttl: number;
    rData: Record<string, unknown>;
  }>;
}

/** Raw settings response from /api/settings/get */
interface RawSettingsResponse {
  enableBlocking?: boolean;
  allowTxtBlockingReport?: boolean;
  blockingType?: string;
  blockingAnswerTtl?: number;
  customBlockingAddresses?: string[];
  blockListUrls?: string[];
  blockListUpdateIntervalHours?: number; // Note: Technitium API uses 'blockListUpdateIntervalHours' (no 'Url')
  blockListNextUpdatedOn?: string;
  temporaryDisableBlockingTill?: string;
}

@Injectable()
export class BuiltInBlockingService {
  private readonly logger = new Logger(BuiltInBlockingService.name);

  constructor(private readonly technitiumService: TechnitiumService) {}

  // ========================================
  // Overview Methods
  // ========================================

  /**
   * Get built-in blocking overview across all configured nodes.
   */
  async getOverview(): Promise<BuiltInBlockingOverview> {
    const summaries = await this.technitiumService.listNodes();
    const snapshots = await Promise.all(
      summaries.map((summary) => this.loadSnapshot(summary)),
    );

    // Use first healthy node for aggregate metrics
    const healthySnapshot = snapshots.find((s) => s.isHealthy);
    const aggregate: BuiltInBlockingMetrics =
      healthySnapshot?.metrics ?? this.emptyMetrics();

    return { fetchedAt: new Date().toISOString(), aggregate, nodes: snapshots };
  }

  /**
   * Get built-in blocking snapshot for a specific node.
   */
  async getSnapshot(nodeId: string): Promise<BuiltInBlockingSnapshot> {
    const summaries = await this.technitiumService.listNodes();
    const summary = summaries.find(
      (node) => node.id.toLowerCase() === nodeId.toLowerCase(),
    );

    if (!summary) {
      throw new NotFoundException(
        `Technitium DNS node "${nodeId}" is not configured.`,
      );
    }

    return this.loadSnapshot(summary);
  }

  /**
   * Get combined blocking status across all nodes.
   * Detects if both Built-in Blocking and Advanced Blocking are active (conflict).
   */
  async getBlockingStatus(): Promise<BlockingStatusOverview> {
    const summaries = await this.technitiumService.listNodes();
    const nodeStatuses: NodeBlockingStatus[] = [];
    const nodesWithAdvancedBlocking: string[] = [];
    const nodesWithBuiltInBlocking: string[] = [];
    let hasConflict = false;

    for (const summary of summaries) {
      try {
        // Get built-in blocking status
        const settings = await this.getBlockingSettings(summary.id);
        const builtInEnabled = settings.enableBlocking ?? false;

        // Check if Advanced Blocking is installed
        // NOTE: /api/apps/list may be unavailable due to permissions/token scope, even when the app is installed.
        // So we treat the apps/list result as a hint and also probe /api/apps/config/get defensively.
        let advancedBlockingInstalled = summary.hasAdvancedBlocking ?? false;

        // Probe Advanced Blocking config to confirm install/enabled status.
        // This makes status detection robust even when apps/list doesn't include the app.
        let advancedBlockingEnabled = false;
        try {
          const abOverview = await this.technitiumService.executeAction<{
            status: string;
            response?: { config?: string | null };
          }>(summary.id, {
            method: "GET",
            url: "/api/apps/config/get",
            params: { name: "Advanced Blocking" },
          });

          if (abOverview.status === "ok") {
            // If we can reach the config endpoint at all, the app is almost certainly installed.
            advancedBlockingInstalled = true;

            if (abOverview.response?.config) {
              const config = JSON.parse(abOverview.response.config) as {
                enableBlocking?: boolean;
              };
              advancedBlockingEnabled = Boolean(config.enableBlocking);
            }
          }
        } catch {
          // If probing fails:
          // - keep advancedBlockingInstalled as-is (apps/list hint)
          // - assume not enabled (safe default)
          if (advancedBlockingInstalled) {
            this.logger.warn(
              `Could not get Advanced Blocking config for node "${summary.id}" (apps/list indicated installed)`,
            );
          } else {
            this.logger.debug(
              `Advanced Blocking config probe failed for node "${summary.id}" (apps/list did not indicate installed)`,
            );
          }
        }

        // Detect conflict
        const nodeHasConflict = builtInEnabled && advancedBlockingEnabled;
        if (nodeHasConflict) {
          hasConflict = true;
        }

        if (advancedBlockingInstalled) {
          nodesWithAdvancedBlocking.push(summary.id);
        }
        if (builtInEnabled) {
          nodesWithBuiltInBlocking.push(summary.id);
        }

        nodeStatuses.push({
          nodeId: summary.id,
          nodeName: summary.name || summary.id,
          builtInEnabled,
          advancedBlockingInstalled,
          advancedBlockingEnabled,
          hasConflict: nodeHasConflict,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to get blocking status for node "${summary.id}":`,
          error,
        );
        nodeStatuses.push({
          nodeId: summary.id,
          nodeName: summary.name || summary.id,
          builtInEnabled: false,
          advancedBlockingInstalled: false,
          advancedBlockingEnabled: false,
          hasConflict: false,
        });
      }
    }

    return {
      fetchedAt: new Date().toISOString(),
      hasConflict,
      nodesWithAdvancedBlocking,
      nodesWithBuiltInBlocking,
      nodes: nodeStatuses,
      conflictWarning: hasConflict
        ? "Both Built-in Blocking and Advanced Blocking are enabled on some nodes. This may cause unpredictable behavior. Consider disabling Built-in Blocking when using Advanced Blocking."
        : undefined,
    };
  }

  // ========================================
  // Tree Structure Utilities
  // ========================================

  /**
   * Build a hierarchical tree structure from a flat list of domains.
   * Converts ["ancestry.com", "google.io", "www.example.com"] into:
   * - com → ancestry
   * - io → google
   * - com → example → www
   */
  private buildDomainTree(domains: string[]): DomainTreeNode {
    const root: DomainTreeNode = {
      label: "<root>",
      fullDomain: "",
      children: [],
      isLeaf: false,
      domainCount: domains.length,
    };

    for (const domain of domains) {
      // Split domain into labels (right-to-left: TLD → 2LD → 3LD → subdomain)
      const labels = domain.split(".").reverse(); // ["com", "example", "www"]

      let currentNode = root;
      let currentFullDomain = "";

      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];

        // Build full domain progressively (com → example.com → www.example.com)
        currentFullDomain =
          i === 0
            ? label
            : `${labels
                .slice(0, i + 1)
                .reverse()
                .join(".")}`;

        // Find or create child node
        let childNode = currentNode.children.find((c) => c.label === label);

        if (!childNode) {
          childNode = {
            label,
            fullDomain: currentFullDomain,
            children: [],
            isLeaf: i === labels.length - 1, // Last label = leaf node
            domainCount: 0,
          };
          currentNode.children.push(childNode);
        }

        // Increment domain count for path traversal
        childNode.domainCount++;

        currentNode = childNode;
      }
    }

    // Sort children alphabetically at each level
    this.sortTreeNodes(root);

    return root;
  }

  /**
   * Recursively sort tree nodes alphabetically by label
   */
  private sortTreeNodes(node: DomainTreeNode): void {
    node.children.sort((a, b) => a.label.localeCompare(b.label));
    for (const child of node.children) {
      this.sortTreeNodes(child);
    }
  }

  // ========================================
  // Allowed Zones Methods
  // ========================================

  /**
   * List allowed domains for a node.
   * Gets all domains recursively and applies search filtering and pagination.
   * Supports both flat list and tree formats.
   */
  async listAllowedZones(
    nodeId: string,
    params?: BlockingZoneListParams,
  ): Promise<BlockingZoneListResponse> {
    // Prefer export API for exact entries (captures wildcards and direct leaves)
    const allDomains = await this.getDomainsFromExport(nodeId, "allowed");

    // Apply search filter if provided (params.domain used as search term)
    let filteredDomains = allDomains;
    if (params?.domain) {
      const searchTerm = params.domain.toLowerCase();
      filteredDomains = allDomains.filter((d) =>
        d.toLowerCase().includes(searchTerm),
      );
    }

    // If tree format requested, build tree and return (no pagination for tree)
    if (params?.format === "tree") {
      const tree = this.buildDomainTree(filteredDomains);
      return {
        domains: filteredDomains.map((d) => ({ domain: d })),
        totalEntries: filteredDomains.length,
        totalPages: 1,
        pageNumber: 0,
        tree,
      };
    }

    // Apply pagination for flat list
    const pageNumber = params?.pageNumber ?? 0;
    const entriesPerPage = params?.entriesPerPage ?? filteredDomains.length;
    const totalEntries = filteredDomains.length;
    const totalPages =
      entriesPerPage > 0 ? Math.ceil(totalEntries / entriesPerPage) : 1;
    const startIndex = pageNumber * entriesPerPage;
    const paginatedDomains = filteredDomains.slice(
      startIndex,
      startIndex + entriesPerPage,
    );

    return {
      domains: paginatedDomains.map((d) => ({ domain: d })),
      totalEntries,
      totalPages,
      pageNumber,
    };
  }

  /**
   * Add a domain to the allowed list.
   */
  async addAllowedZone(
    nodeId: string,
    params: BlockingZoneAddParams,
  ): Promise<BlockingZoneOperationResult> {
    return this.addZone(nodeId, "allowed", params);
  }

  /**
   * Delete a domain from the allowed list.
   */
  async deleteAllowedZone(
    nodeId: string,
    params: BlockingZoneDeleteParams,
  ): Promise<BlockingZoneOperationResult> {
    return this.deleteZone(nodeId, "allowed", params);
  }

  /**
   * Flush (clear) all allowed domains.
   */
  async flushAllowedZones(
    nodeId: string,
  ): Promise<BlockingZoneOperationResult> {
    return this.flushZones(nodeId, "allowed");
  }

  /**
   * Import allowed domains from URL(s).
   */
  async importAllowedZones(
    nodeId: string,
    params: BlockingZoneImportParams,
  ): Promise<BlockingZoneOperationResult> {
    return this.importZones(nodeId, "allowed", params);
  }

  /**
   * Export allowed domains as text file content.
   */
  async exportAllowedZones(nodeId: string): Promise<string> {
    return this.exportZones(nodeId, "allowed");
  }

  // ========================================
  // Blocked Zones Methods
  // ========================================

  /**
   * List blocked domains for a node.
   * Gets all domains recursively and applies search filtering and pagination.
   * Supports both flat list and tree formats.
   */
  async listBlockedZones(
    nodeId: string,
    params?: BlockingZoneListParams,
  ): Promise<BlockingZoneListResponse> {
    // Prefer export API for exact entries (captures wildcards and direct leaves)
    const allDomains = await this.getDomainsFromExport(nodeId, "blocked");

    // Apply search filter if provided (params.domain used as search term)
    let filteredDomains = allDomains;
    if (params?.domain) {
      const searchTerm = params.domain.toLowerCase();
      filteredDomains = allDomains.filter((d) =>
        d.toLowerCase().includes(searchTerm),
      );
    }

    // If tree format requested, build tree and return (no pagination for tree)
    if (params?.format === "tree") {
      const tree = this.buildDomainTree(filteredDomains);
      return {
        domains: filteredDomains.map((d) => ({ domain: d })),
        totalEntries: filteredDomains.length,
        totalPages: 1,
        pageNumber: 0,
        tree,
      };
    }

    // Apply pagination for flat list
    const pageNumber = params?.pageNumber ?? 0;
    const entriesPerPage = params?.entriesPerPage ?? filteredDomains.length;
    const totalEntries = filteredDomains.length;
    const totalPages =
      entriesPerPage > 0 ? Math.ceil(totalEntries / entriesPerPage) : 1;
    const startIndex = pageNumber * entriesPerPage;
    const paginatedDomains = filteredDomains.slice(
      startIndex,
      startIndex + entriesPerPage,
    );

    return {
      domains: paginatedDomains.map((d) => ({ domain: d })),
      totalEntries,
      totalPages,
      pageNumber,
    };
  }

  /**
   * Add a domain to the blocked list.
   */
  async addBlockedZone(
    nodeId: string,
    params: BlockingZoneAddParams,
  ): Promise<BlockingZoneOperationResult> {
    return this.addZone(nodeId, "blocked", params);
  }

  /**
   * Delete a domain from the blocked list.
   */
  async deleteBlockedZone(
    nodeId: string,
    params: BlockingZoneDeleteParams,
  ): Promise<BlockingZoneOperationResult> {
    return this.deleteZone(nodeId, "blocked", params);
  }

  /**
   * Flush (clear) all blocked domains.
   */
  async flushBlockedZones(
    nodeId: string,
  ): Promise<BlockingZoneOperationResult> {
    return this.flushZones(nodeId, "blocked");
  }

  /**
   * Import blocked domains from URL(s).
   */
  async importBlockedZones(
    nodeId: string,
    params: BlockingZoneImportParams,
  ): Promise<BlockingZoneOperationResult> {
    return this.importZones(nodeId, "blocked", params);
  }

  /**
   * Export blocked domains as text file content.
   */
  async exportBlockedZones(nodeId: string): Promise<string> {
    return this.exportZones(nodeId, "blocked");
  }

  /**
   * Fetch domains via Technitium's export endpoint to retain exact entries (including wildcards).
   */
  private async getDomainsFromExport(
    nodeId: string,
    type: "allowed" | "blocked",
  ): Promise<string[]> {
    try {
      const exported = await this.exportZones(nodeId, type);
      return exported
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
    } catch (error) {
      this.logger.warn(
        `Failed to export ${type} zones for node "${nodeId}", falling back to recursive fetch:`,
        error,
      );
      return this.getAllDomainsRecursive(nodeId, type);
    }
  }

  // ========================================
  // Settings Methods
  // ========================================

  /**
   * Get blocking settings for a node.
   */
  async getBlockingSettings(nodeId: string): Promise<BlockingSettings> {
    const response = await this.technitiumService.executeAction<
      TechnitiumApiResponse<RawSettingsResponse>
    >(nodeId, { method: "GET", url: "/api/settings/get", params: {} });

    if (response.status !== "ok" || !response.response) {
      throw new Error(`Failed to get settings from node "${nodeId}"`);
    }

    const settings = response.response;
    return {
      enableBlocking: settings.enableBlocking,
      allowTxtBlockingReport: settings.allowTxtBlockingReport,
      blockingType: settings.blockingType as BlockingSettings["blockingType"],
      blockingAnswerTtl: settings.blockingAnswerTtl,
      customBlockingAddresses: settings.customBlockingAddresses,
      blockListUrls: settings.blockListUrls,
      blockListUrlUpdateIntervalHours: settings.blockListUpdateIntervalHours, // Map from Technitium's field name
      blockListNextUpdatedOn: settings.blockListNextUpdatedOn,
      temporaryDisableBlockingTill: settings.temporaryDisableBlockingTill,
    };
  }

  /**
   * Update blocking settings for a node.
   */
  async updateBlockingSettings(
    nodeId: string,
    settings: UpdateBlockingSettingsRequest,
  ): Promise<BlockingZoneOperationResult> {
    const params: Record<string, string | number | boolean> = {};

    if (settings.enableBlocking !== undefined) {
      params.enableBlocking = settings.enableBlocking;
    }

    if (settings.allowTxtBlockingReport !== undefined) {
      params.allowTxtBlockingReport = settings.allowTxtBlockingReport;
    }

    if (settings.blockingType !== undefined) {
      params.blockingType = settings.blockingType;
    }

    if (settings.blockingAnswerTtl !== undefined) {
      params.blockingAnswerTtl = settings.blockingAnswerTtl;
    }

    if (
      settings.customBlockingAddresses !== undefined &&
      settings.customBlockingAddresses !== null
    ) {
      params.customBlockingAddresses =
        settings.customBlockingAddresses.join(",");
    }

    if (
      settings.blockListUrls !== undefined &&
      settings.blockListUrls !== null
    ) {
      // Technitium expects "false" (not an empty string) to clear existing URLs
      params.blockListUrls =
        settings.blockListUrls.length === 0
          ? false
          : settings.blockListUrls.join(",");
    }

    if (settings.blockListUrlUpdateIntervalHours !== undefined) {
      // Note: Technitium API uses 'blockListUpdateIntervalHours' (no 'Url')
      params.blockListUpdateIntervalHours =
        settings.blockListUrlUpdateIntervalHours;
    }

    try {
      // Build URL with query params directly since Technitium expects them as query string
      const queryParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        queryParams.set(key, String(value));
      }

      // Trace outgoing settings (tokens never logged; values are query params)
      this.logger.debug(
        `Updating blocking settings on node "${nodeId}" with params: ${JSON.stringify(params)}`,
        BuiltInBlockingService.name,
      );

      const envelope = await this.technitiumService.executeAction<
        TechnitiumApiResponse<unknown>
      >(nodeId, {
        method: "GET", // Use GET since params are query string - Technitium accepts both GET/POST
        url: `/api/settings/set?${queryParams.toString()}`,
      });

      this.logger.debug(
        `Technitium responded to settings update on node "${nodeId}": ${JSON.stringify({ status: envelope?.status, errorMessage: envelope?.errorMessage, innerErrorMessage: envelope?.innerErrorMessage })}`,
        BuiltInBlockingService.name,
      );

      if (!envelope || envelope.status !== "ok") {
        const detail =
          envelope?.errorMessage ??
          envelope?.innerErrorMessage ??
          "unknown error";
        throw new Error(`Technitium rejected settings update: ${detail}`);
      }

      // Verify that settings actually applied when caller sent blockListUrls.
      // If Technitium returns a different set (e.g., refuses to clear defaults), return a soft failure instead of 500.
      if (settings.blockListUrls !== undefined) {
        try {
          const refreshed = await this.getBlockingSettings(nodeId);
          const requested = settings.blockListUrls ?? [];
          const applied = refreshed.blockListUrls ?? [];
          const sameLength = requested.length === applied.length;
          const sameValues =
            sameLength && requested.every((url) => applied.includes(url));
          if (!sameValues) {
            this.logger.warn(
              `Mismatch after settings update on node "${nodeId}": requested URLs ${JSON.stringify(requested)} but applied ${JSON.stringify(applied)}`,
            );
            return {
              success: false,
              message: "Technitium did not apply blockListUrls change",
            };
          }
        } catch (verifyError) {
          this.logger.warn(
            `Failed to verify settings on node "${nodeId}": ${verifyError instanceof Error ? verifyError.message : "unknown"}`,
          );
          return {
            success: false,
            message: "Failed to verify settings after update",
          };
        }
      }

      return { success: true, message: "Settings updated successfully" };
    } catch (error) {
      this.logger.error(
        `Failed to update settings on node "${nodeId}":`,
        error,
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Force update block lists from configured URLs.
   */
  async forceBlockListUpdate(
    nodeId: string,
  ): Promise<BlockingZoneOperationResult> {
    try {
      await this.technitiumService.executeAction<
        TechnitiumApiResponse<unknown>
      >(nodeId, { method: "GET", url: "/api/settings/forceUpdateBlockLists" });

      return { success: true, message: "Block list update initiated" };
    } catch (error) {
      this.logger.error(
        `Failed to force block list update on node "${nodeId}":`,
        error,
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Temporarily disable blocking for a specified duration.
   * @param nodeId The node ID
   * @param minutes Duration in minutes to disable blocking
   * @returns The timestamp until which blocking is disabled
   */
  async temporaryDisableBlocking(
    nodeId: string,
    minutes: number,
  ): Promise<{
    success: boolean;
    temporaryDisableBlockingTill?: string;
    message?: string;
  }> {
    try {
      const response = await this.technitiumService.executeAction<
        TechnitiumApiResponse<{ temporaryDisableBlockingTill: string }>
      >(nodeId, {
        method: "GET",
        url: `/api/settings/temporaryDisableBlocking?minutes=${minutes}`,
      });

      if (response.status !== "ok" || !response.response) {
        throw new Error("Failed to temporarily disable blocking");
      }

      return {
        success: true,
        temporaryDisableBlockingTill:
          response.response.temporaryDisableBlockingTill,
      };
    } catch (error) {
      this.logger.error(
        `Failed to temporarily disable blocking on node "${nodeId}":`,
        error,
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Re-enable blocking (by setting minutes to 0 which clears the temporary disable).
   * @param nodeId The node ID
   */
  async reEnableBlocking(nodeId: string): Promise<BlockingZoneOperationResult> {
    try {
      // Setting minutes=0 re-enables blocking immediately
      await this.technitiumService.executeAction<
        TechnitiumApiResponse<unknown>
      >(nodeId, {
        method: "GET",
        url: "/api/settings/temporaryDisableBlocking?minutes=0",
      });

      return { success: true, message: "Blocking re-enabled" };
    } catch (error) {
      this.logger.error(
        `Failed to re-enable blocking on node "${nodeId}":`,
        error,
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ========================================
  // Private Helper Methods
  // ========================================

  private async loadSnapshot(
    summary: TechnitiumNodeSummary,
  ): Promise<BuiltInBlockingSnapshot> {
    const base: BuiltInBlockingSnapshot = {
      nodeId: summary.id,
      baseUrl: summary.baseUrl,
      fetchedAt: new Date().toISOString(),
      metrics: this.emptyMetrics(),
      isHealthy: false,
    };

    try {
      // Get settings to check if blocking is enabled and get block list URLs
      const settings = await this.getBlockingSettings(summary.id);

      // Get allowed domains count
      const allowedResponse = await this.listZones(summary.id, "allowed", {
        pageNumber: 0,
        entriesPerPage: 1,
      });

      // Get blocked domains count
      const blockedResponse = await this.listZones(summary.id, "blocked", {
        pageNumber: 0,
        entriesPerPage: 1,
      });

      return {
        ...base,
        metrics: {
          allowedCount:
            allowedResponse.totalEntries ?? allowedResponse.domains.length,
          blockedCount:
            blockedResponse.totalEntries ?? blockedResponse.domains.length,
          blockListUrlCount: settings.blockListUrls?.length ?? 0,
          blockingEnabled: settings.enableBlocking ?? false,
        },
        isHealthy: true,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to load snapshot for node "${summary.id}":`,
        error,
      );
      return {
        ...base,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async listZones(
    nodeId: string,
    type: "allowed" | "blocked",
    params?: BlockingZoneListParams,
  ): Promise<BlockingZoneListResponse> {
    const queryParams: Record<string, string> = {};

    // If a specific domain is provided, browse into that zone
    if (params?.domain) {
      queryParams.domain = params.domain;
    }

    const response = await this.technitiumService.executeAction<
      TechnitiumApiResponse<RawBlockingListResponse>
    >(nodeId, { method: "GET", url: `/api/${type}/list`, params: queryParams });

    if (response.status !== "ok" || !response.response) {
      throw new Error(`Failed to list ${type} zones from node "${nodeId}"`);
    }

    const data = response.response;

    // Convert zones array to domain entries
    // zones contains subzone names at this level (e.g., ["ads", "tracking"] for .com)
    const domains: BlockingZoneEntry[] = (data.zones ?? []).map(
      (zone: string) => {
        // If we're at root level, zone is the full domain (e.g., "example.com")
        // If we're browsing a parent domain, we need to construct full domain
        const fullDomain = params?.domain ? `${zone}.${params.domain}` : zone;
        return { domain: fullDomain };
      },
    );

    return {
      domains,
      // No pagination in Technitium's API - all zones at this level are returned
      totalEntries: domains.length,
      totalPages: 1,
      pageNumber: 0,
    };
  }

  /**
   * Recursively get all domains from the allow/block list
   * The Technitium API uses a zone-browsing model, so we need to walk the tree.
   *
   * API behavior:
   * - When there are multiple zones: returns `zones: ["com", "net", ...]`
   * - When there's a single domain or viewing a specific domain: returns `domain: "example.com"` with `records`
   * - `zones` contains subdomains when drilling into a domain
   */
  private async getAllDomainsRecursive(
    nodeId: string,
    type: "allowed" | "blocked",
    parentDomain?: string,
    maxDepth: number = 10,
  ): Promise<string[]> {
    if (maxDepth <= 0) {
      this.logger.warn(
        `Max depth reached for ${type} on node ${nodeId}, parentDomain: ${parentDomain}`,
      );
      return [];
    }

    const queryParams: Record<string, string> = {};
    if (parentDomain) {
      queryParams.domain = parentDomain;
    }

    this.logger.debug(
      `Fetching ${type} list for node ${nodeId}, parentDomain: ${parentDomain || "<root>"}`,
    );

    const response = await this.technitiumService.executeAction<
      TechnitiumApiResponse<RawBlockingListResponse>
    >(nodeId, { method: "GET", url: `/api/${type}/list`, params: queryParams });

    if (response.status !== "ok" || !response.response) {
      this.logger.warn(
        `Failed to get ${type} list for node ${nodeId}, parentDomain: ${parentDomain}`,
      );
      return [];
    }

    const data = response.response;
    this.logger.debug(
      `Response for ${type} on ${parentDomain || "<root>"}: zones=${data.zones?.length || 0}, domain=${data.domain}, records=${data.records?.length || 0}`,
    );
    const allDomains: string[] = [];

    // Case 1: API returned a specific domain directly (single domain or drilling into a domain)
    // This happens when there's only one domain at this level, or we're viewing a specific domain
    if (data.domain && data.records && data.records.length > 0) {
      // If we're at root level (no parentDomain) and API returned a domain with records,
      // this is a blocked domain
      if (!parentDomain) {
        allDomains.push(data.domain);
      } else if (data.domain === parentDomain) {
        // If we're drilling into a domain and it has records, it's blocked
        allDomains.push(parentDomain);
      }
    }

    // Case 2: API returned zones to recurse into
    if (data.zones && data.zones.length > 0) {
      this.logger.debug(
        `Recursing into ${data.zones.length} zones under ${parentDomain || "<root>"}: ${data.zones.join(", ")}`,
      );
      for (const zone of data.zones) {
        // Zones array contains full domain names when at TLD level (e.g., ["ancestry.com", "example.com"] under "com")
        // But contains subdomain parts when drilling deeper (e.g., ["www", "mail"] under "example.com")
        // If the zone already ends with the parent domain, it's a full domain name
        const fullDomain =
          parentDomain &&
          !zone.endsWith(`.${parentDomain}`) &&
          zone !== parentDomain
            ? `${zone}.${parentDomain}`
            : zone;

        // Recurse to find actual blocked entries
        const subDomains = await this.getAllDomainsRecursive(
          nodeId,
          type,
          fullDomain,
          maxDepth - 1,
        );
        if (subDomains.length > 0) {
          this.logger.debug(
            `Found ${subDomains.length} domains under ${fullDomain}`,
          );
          allDomains.push(...subDomains);
          continue;
        }

        // If no subdomains were returned, treat this zone as a leaf.
        // This captures wildcards (e.g., "*.zeronet.org") and direct entries
        // that don't expose records via the API response.
        const checkResponse = await this.technitiumService.executeAction<
          TechnitiumApiResponse<RawBlockingListResponse>
        >(nodeId, {
          method: "GET",
          url: `/api/${type}/list`,
          params: { domain: fullDomain },
        });

        if (
          checkResponse.status === "ok" &&
          checkResponse.response?.records &&
          checkResponse.response.records.length > 0
        ) {
          this.logger.debug(
            `Zone ${fullDomain} has records, adding as blocked domain`,
          );
          allDomains.push(fullDomain);
        } else {
          // No subdomains and no records — assume this is a configured leaf zone.
          allDomains.push(fullDomain);
        }
      }
    }

    this.logger.debug(
      `Returning ${allDomains.length} total domains from ${parentDomain || "<root>"}`,
    );
    return allDomains;
  }

  private async addZone(
    nodeId: string,
    type: "allowed" | "blocked",
    params: BlockingZoneAddParams,
  ): Promise<BlockingZoneOperationResult> {
    try {
      const queryParams = new URLSearchParams();
      queryParams.set("domain", params.domain);

      await this.technitiumService.executeAction<
        TechnitiumApiResponse<unknown>
      >(nodeId, {
        method: "GET",
        url: `/api/${type}/add?${queryParams.toString()}`,
      });

      return {
        success: true,
        message: `Domain "${params.domain}" added to ${type} list`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to add domain to ${type} list on node "${nodeId}":`,
        error,
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async deleteZone(
    nodeId: string,
    type: "allowed" | "blocked",
    params: BlockingZoneDeleteParams,
  ): Promise<BlockingZoneOperationResult> {
    try {
      const queryParams = new URLSearchParams();
      queryParams.set("domain", params.domain);

      await this.technitiumService.executeAction<
        TechnitiumApiResponse<unknown>
      >(nodeId, {
        method: "GET",
        url: `/api/${type}/delete?${queryParams.toString()}`,
      });

      return {
        success: true,
        message: `Domain "${params.domain}" removed from ${type} list`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to delete domain from ${type} list on node "${nodeId}":`,
        error,
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async flushZones(
    nodeId: string,
    type: "allowed" | "blocked",
  ): Promise<BlockingZoneOperationResult> {
    try {
      await this.technitiumService.executeAction<
        TechnitiumApiResponse<unknown>
      >(nodeId, { method: "GET", url: `/api/${type}/flush` });

      return { success: true, message: `All ${type} domains cleared` };
    } catch (error) {
      this.logger.error(
        `Failed to flush ${type} zones on node "${nodeId}":`,
        error,
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async importZones(
    nodeId: string,
    type: "allowed" | "blocked",
    params: BlockingZoneImportParams,
  ): Promise<BlockingZoneOperationResult> {
    try {
      const listUrl = Array.isArray(params.listUrl)
        ? params.listUrl.join(",")
        : params.listUrl;
      const queryParams = new URLSearchParams();
      queryParams.set("listUrl", listUrl);

      await this.technitiumService.executeAction<
        TechnitiumApiResponse<unknown>
      >(nodeId, {
        method: "GET",
        url: `/api/${type}/import?${queryParams.toString()}`,
      });

      return {
        success: true,
        message: `Imported domains to ${type} list from URL(s)`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to import ${type} zones on node "${nodeId}":`,
        error,
      );
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async exportZones(
    nodeId: string,
    type: "allowed" | "blocked",
  ): Promise<string> {
    // Export returns plain text, not JSON
    const response = await this.technitiumService.executeAction<string>(
      nodeId,
      { method: "GET", url: `/api/${type}/export`, params: {} },
    );

    // The response might be wrapped in a JSON envelope or might be plain text
    // Technitium typically returns plain text for export endpoints
    if (typeof response === "string") {
      return response;
    }

    // If it's wrapped in JSON, try to extract it
    if (typeof response === "object" && response !== null) {
      const envelope = response as TechnitiumApiResponse<{ content?: string }>;
      if (envelope.response?.content) {
        return envelope.response.content;
      }
    }

    return "";
  }

  private emptyMetrics(): BuiltInBlockingMetrics {
    return {
      allowedCount: 0,
      blockedCount: 0,
      blockListUrlCount: 0,
      blockingEnabled: false,
    };
  }
}
