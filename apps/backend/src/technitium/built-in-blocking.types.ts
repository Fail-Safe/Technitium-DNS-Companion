/**
 * Built-in Blocking Types
 *
 * Types for Technitium DNS's native allow/blocklist functionality.
 * This is the built-in blocking mechanism that does NOT require the Advanced Blocking App.
 *
 * API Reference: https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md
 */

/**
 * A single entry from the allowed/blocked zones list.
 * Response from /api/allowed/list or /api/blocked/list
 */
export interface BlockingZoneEntry {
    /** The domain name */
    domain: string;
}

/**
 * Parameters for listing allowed/blocked zones
 */
export interface BlockingZoneListParams {
    /** Domain to search for (partial match) */
    domain?: string;
    /** Page number (starting from 0) */
    pageNumber?: number;
    /** Number of entries per page (default: 15) */
    entriesPerPage?: number;
}

/**
 * Response from /api/allowed/list or /api/blocked/list
 */
export interface BlockingZoneListResponse {
    /** List of domain entries */
    domains: BlockingZoneEntry[];
    /** Total number of entries (for pagination) */
    totalEntries?: number;
    /** Total number of pages */
    totalPages?: number;
    /** Current page number */
    pageNumber?: number;
}

/**
 * Parameters for adding a domain to allowed/blocked list
 */
export interface BlockingZoneAddParams {
    /** Domain to add */
    domain: string;
}

/**
 * Parameters for deleting a domain from allowed/blocked list
 */
export interface BlockingZoneDeleteParams {
    /** Domain to delete */
    domain: string;
}

/**
 * Parameters for importing domains from URL
 */
export interface BlockingZoneImportParams {
    /** URL(s) to import domains from */
    listUrl: string | string[];
}

/**
 * Aggregate metrics for built-in blocking
 */
export interface BuiltInBlockingMetrics {
    /** Number of allowed domains */
    allowedCount: number;
    /** Number of blocked domains */
    blockedCount: number;
    /** Number of block list URLs configured */
    blockListUrlCount: number;
    /** Whether blocking is enabled globally */
    blockingEnabled: boolean;
}

/**
 * Snapshot of built-in blocking configuration for a single node
 */
export interface BuiltInBlockingSnapshot {
    nodeId: string;
    baseUrl: string;
    fetchedAt: string;
    metrics: BuiltInBlockingMetrics;
    /** Whether this node is healthy and responding */
    isHealthy: boolean;
    /** Error message if node is not healthy */
    error?: string;
}

/**
 * Overview of built-in blocking across all nodes
 */
export interface BuiltInBlockingOverview {
    fetchedAt: string;
    /** Aggregate metrics (from first healthy node) */
    aggregate: BuiltInBlockingMetrics;
    /** Per-node snapshots */
    nodes: BuiltInBlockingSnapshot[];
}

/**
 * Settings related to blocking from /api/settings/get
 */
export interface BlockingSettings {
    /** Whether DNS blocking is enabled */
    enableBlocking?: boolean;
    /** Allow TXT type queries to return blocking report */
    allowTxtBlockingReport?: boolean;
    /** Type of blocking response: NxDomain, AnyAddress, CustomAddress */
    blockingType?: 'NxDomain' | 'AnyAddress' | 'CustomAddress';
    /** TTL for blocking response records (seconds) */
    blockingAnswerTtl?: number;
    /** Custom blocking addresses (IPv4 and/or IPv6) */
    customBlockingAddresses?: string[];
    /** Block list URLs */
    blockListUrls?: string[];
    /** Block list URL update interval in hours (0-168) */
    blockListUrlUpdateIntervalHours?: number;
    /** Block list next update time */
    blockListNextUpdatedOn?: string;
    /** Timestamp until which blocking is temporarily disabled (ISO 8601) */
    temporaryDisableBlockingTill?: string;
}

/**
 * Combined blocking status showing both built-in and Advanced Blocking state
 */
export interface BlockingStatus {
    /** Built-in blocking enabled */
    builtInEnabled: boolean;
    /** Advanced Blocking app installed */
    advancedBlockingInstalled: boolean;
    /** Advanced Blocking app has blocking enabled */
    advancedBlockingEnabled: boolean;
    /** Warning if both are enabled (may conflict) */
    conflictWarning?: string;
}

/**
 * Per-node blocking status
 */
export interface NodeBlockingStatus {
    nodeId: string;
    nodeName: string;
    builtInEnabled: boolean;
    advancedBlockingInstalled: boolean;
    advancedBlockingEnabled: boolean;
    hasConflict: boolean;
}

/**
 * Combined blocking status across all nodes
 */
export interface BlockingStatusOverview {
    fetchedAt: string;
    /** Any node has a conflict */
    hasConflict: boolean;
    /** Nodes with Advanced Blocking installed */
    nodesWithAdvancedBlocking: string[];
    /** Nodes with Built-in Blocking enabled */
    nodesWithBuiltInBlocking: string[];
    /** Per-node status */
    nodes: NodeBlockingStatus[];
    /** Warning message if conflicts exist */
    conflictWarning?: string;
}

/**
 * Request to update blocking settings
 */
export interface UpdateBlockingSettingsRequest {
    enableBlocking?: boolean;
    allowTxtBlockingReport?: boolean;
    blockingType?: 'NxDomain' | 'AnyAddress' | 'CustomAddress';
    blockingAnswerTtl?: number;
    customBlockingAddresses?: string[];
    blockListUrls?: string[];
    blockListUrlUpdateIntervalHours?: number;
}

/**
 * Request to temporarily disable blocking
 */
export interface TemporaryDisableBlockingRequest {
    /** Duration in minutes to disable blocking */
    minutes: number;
}

/**
 * Response from temporarily disable blocking endpoint
 */
export interface TemporaryDisableBlockingResponse {
    /** Timestamp until which blocking is disabled (ISO 8601) */
    temporaryDisableBlockingTill: string;
}

/**
 * Result from add/delete/import operations
 */
export interface BlockingZoneOperationResult {
    success: boolean;
    message?: string;
    affectedDomains?: number;
}

/**
 * Request to add/remove domains in bulk
 */
export interface BulkDomainsRequest {
    domains: string[];
}

/**
 * Comparison status for sync operations
 */
export type BlockingListComparisonStatus = 'in-sync' | 'different' | 'unknown';

/**
 * Comparison between nodes for sync operations
 */
export interface BuiltInBlockingComparison {
    allowedStatus: BlockingListComparisonStatus;
    blockedStatus: BlockingListComparisonStatus;
    settingsStatus: BlockingListComparisonStatus;
    differences?: {
        allowedOnlyOnSource?: string[];
        allowedOnlyOnTarget?: string[];
        blockedOnlyOnSource?: string[];
        blockedOnlyOnTarget?: string[];
        settingsDifferences?: string[];
    };
}
