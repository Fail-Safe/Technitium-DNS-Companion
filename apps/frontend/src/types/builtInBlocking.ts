/**
 * Built-in Blocking Types
 *
 * Types for Technitium DNS's native allow/blocklist functionality.
 * This is the built-in blocking mechanism that does NOT require the Advanced Blocking App.
 */

/**
 * A single entry from the allowed/blocked zones list.
 */
export interface BlockingZoneEntry {
    /** The domain name */
    domain: string;
}

/**
 * Response from /api/built-in-blocking/:nodeId/allowed or /blocked
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
    /** Optional tree structure (when format=tree) */
    tree?: DomainTreeNode;
}

/**
 * Tree node representing a level in the DNS hierarchy
 * Used for tree view display (TLD → 2LD → 3LD → subdomain)
 */
export interface DomainTreeNode {
    /** Label at this level (e.g., "com", "example", "www") */
    label: string;
    /** Full domain name up to this point (e.g., "com", "example.com", "www.example.com") */
    fullDomain: string;
    /** Child nodes (subdomains) */
    children: DomainTreeNode[];
    /** Whether this node is a leaf (actual blocked/allowed domain) */
    isLeaf: boolean;
    /** Number of leaf domains under this node (for display counts) */
    domainCount: number;
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
 * Result from add/delete/import operations
 */
export interface BlockingZoneOperationResult {
    success: boolean;
    message?: string;
    affectedDomains?: number;
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
 * Blocking method type - user's choice of which blocking system to use
 */
export type BlockingMethod = 'built-in' | 'advanced';
