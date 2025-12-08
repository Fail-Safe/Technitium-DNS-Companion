import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import { createHash } from "crypto";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import { TechnitiumService } from "./technitium.service";
import { DomainListPersistenceService } from "./domain-list-persistence.service";
import type {
  AdvancedBlockingConfig,
  AdvancedBlockingGroup,
  AdvancedBlockingUrlEntry,
} from "./advanced-blocking.types";

// ===== EXPORTED TYPES =====

export interface ListMetadata {
  url: string;
  hash: string;
  domainCount: number;
  patternCount?: number; // For regex lists
  lineCount: number;
  commentCount: number;
  fetchedAt: string;
  errorMessage?: string;
  isRegex?: boolean;
}

export interface DomainCheckResult {
  domain: string;
  found: boolean;
  foundIn?: {
    type:
      | "blocklist"
      | "allowlist"
      | "regex-blocklist"
      | "regex-allowlist"
      | "manual-blocked"
      | "manual-allowed";
    source: string; // URL or "manual"
    groupName?: string; // For manual entries (single group)
    groups?: string[]; // For URL-based lists (multiple groups can use same list)
    matchedPattern?: string; // For regex matches
    matchedDomain?: string; // For wildcard matches (e.g., "pet" matching "uptime.kuma.pet")
  }[];
}

/**
 * Policy simulation result for a specific group
 */
export interface GroupPolicyResult {
  domain: string;
  groupName: string;
  finalAction: "blocked" | "allowed" | "none"; // Final effective action
  reasons: {
    action: "block" | "allow";
    type:
      | "blocklist"
      | "allowlist"
      | "regex-blocklist"
      | "regex-allowlist"
      | "manual-blocked"
      | "manual-allowed";
    source: string; // URL or "manual"
    matchedPattern?: string; // For regex matches
    matchedDomain?: string; // For wildcard matches (e.g., "pet" matching "uptime.kuma.pet")
  }[];
  evaluation: string; // Human-readable explanation
}

export interface ListSearchResult {
  url: string;
  hash: string;
  matches: string[];
  totalDomains: number;
  isRegex?: boolean;
}

// ===== INTERNAL TYPES =====

interface CachedList {
  url: string;
  hash: string;
  domains: Set<string>;
  fetchedAt: Date;
  lineCount: number;
  commentCount: number;
  errorMessage?: string;
}

interface CachedRegexList {
  url: string;
  hash: string;
  patterns: RegExp[];
  rawPatterns: string[]; // Store original patterns for display
  fetchedAt: Date;
  lineCount: number;
  commentCount: number;
  errorMessage?: string;
}

@Injectable()
export class DomainListCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainListCacheService.name);
  private readonly cache = new Map<string, Map<string, CachedList>>(); // nodeId -> (hash -> CachedList)
  private readonly regexCache = new Map<string, Map<string, CachedRegexList>>(); // nodeId -> (hash -> CachedRegexList)
  private readonly refreshInterval = 24 * 60 * 60 * 1000; // 24 hours (fallback default)
  private readonly refreshTimers = new Map<string, NodeJS.Timeout>(); // nodeId -> timer
  private readonly lastRefreshTimes = new Map<string, Date>(); // nodeId -> last refresh timestamp
  private readonly configHashes = new Map<string, string>(); // nodeId -> config hash (to detect changes)
  private initializationTimer?: NodeJS.Timeout; // deferred startup timer

  constructor(
    private readonly httpService: HttpService,
    private readonly advancedBlockingService: AdvancedBlockingService,
    private readonly technitiumService: TechnitiumService,
    private readonly persistenceService: DomainListPersistenceService,
  ) {}

  /**
   * Initialize scheduled refreshes when the module starts
   */
  async onModuleInit() {
    this.logger.log("Domain List Cache Service initialized");

    // Initialize persistence layer
    try {
      await this.persistenceService.initialize();
      this.logger.log("Persistence layer initialized");

      // Load cached data from disk
      await this.loadCachesFromDisk();
    } catch (error) {
      this.logger.error("Failed to initialize persistence:", error);
    }

    // Start scheduled refreshes after a short delay to allow other services to initialize
    this.initializationTimer = setTimeout(() => {
      this.initializeScheduledRefreshes()
        .catch((err) => {
          this.logger.error("Failed to initialize scheduled refreshes:", err);
        })
        .finally(() => {
          this.initializationTimer = undefined;
        });
    }, 5000); // 5 second delay
  }

  /**
   * Clean up timers when the module is destroyed
   */
  onModuleDestroy() {
    if (this.initializationTimer) {
      clearTimeout(this.initializationTimer);
      this.initializationTimer = undefined;
    }
    this.stopScheduledRefreshes();
  }

  /**
   * Start scheduled refresh for a specific node based on its config
   */
  private async scheduleNodeRefresh(nodeId: string): Promise<void> {
    try {
      // Get the node's Advanced Blocking config to read the refresh interval
      const snapshot = await this.advancedBlockingService.getSnapshot(nodeId);
      const config = snapshot.config;

      if (!config) {
        this.logger.warn(
          `No Advanced Blocking config found for node ${nodeId}, skipping scheduled refresh`,
        );
        return;
      }

      // Get the refresh interval from config (default to 24 hours if not set)
      const intervalHours = config.blockListUrlUpdateIntervalHours ?? 24;
      const intervalMs = intervalHours * 60 * 60 * 1000;

      // Clear any existing timer for this node
      const existingTimer = this.refreshTimers.get(nodeId);
      if (existingTimer) {
        clearInterval(existingTimer);
      }

      this.logger.log(
        `Scheduling automatic refresh for node ${nodeId} every ${intervalHours} hours`,
      );

      // Set up the new timer
      const timer = setInterval(() => {
        this.logger.log(`Automatic refresh triggered for node ${nodeId}`);
        // Use void to suppress the async warning - refresh runs in background
        void this.refreshLists(nodeId).catch((err: unknown) => {
          this.logger.error(
            `Failed to auto-refresh lists for node ${nodeId}:`,
            err,
          );
        });
      }, intervalMs);

      this.refreshTimers.set(nodeId, timer);
    } catch (error) {
      this.logger.error(
        `Failed to schedule refresh for node ${nodeId}:`,
        error,
      );
    }
  }

  /**
   * Initialize scheduled refreshes for all configured nodes
   */
  async initializeScheduledRefreshes(): Promise<void> {
    this.logger.log("Initializing scheduled list refreshes...");
    const nodes = await this.technitiumService.listNodes();

    for (const node of nodes) {
      await this.scheduleNodeRefresh(node.id);
    }

    this.logger.log(
      `Scheduled refreshes initialized for ${nodes.length} node(s)`,
    );
  }

  /**
   * Stop all scheduled refreshes
   */
  stopScheduledRefreshes(): void {
    this.logger.log("Stopping all scheduled refreshes");
    for (const [nodeId, timer] of this.refreshTimers.entries()) {
      clearInterval(timer);
      this.logger.log(`Stopped scheduled refresh for node ${nodeId}`);
    }
    this.refreshTimers.clear();
  }

  /**
   * Load all cached data from disk on startup
   */
  private async loadCachesFromDisk(): Promise<void> {
    this.logger.log("Loading caches from disk...");

    try {
      const nodes = await this.technitiumService.listNodes();
      let totalLoaded = 0;

      for (const node of nodes) {
        const hashes = await this.persistenceService.listNodeCaches(node.id);

        for (const hash of hashes) {
          const cached = await this.persistenceService.loadCache(node.id, hash);

          if (cached) {
            // Load into memory cache
            if (cached.domains) {
              // Regular list
              if (!this.cache.has(node.id)) {
                this.cache.set(node.id, new Map());
              }

              this.cache
                .get(node.id)!
                .set(hash, {
                  url: cached.url,
                  hash,
                  domains: new Set(cached.domains),
                  fetchedAt: cached.fetchedAt,
                  lineCount: cached.lineCount,
                  commentCount: cached.commentCount,
                  errorMessage: cached.errorMessage,
                });

              totalLoaded++;
            } else if (cached.patterns) {
              // Regex list
              if (!this.regexCache.has(node.id)) {
                this.regexCache.set(node.id, new Map());
              }

              // Recompile regex patterns
              const patterns: RegExp[] = [];
              for (const pattern of cached.patterns) {
                try {
                  patterns.push(new RegExp(pattern, "i"));
                } catch {
                  this.logger.warn(
                    `Failed to compile regex pattern: ${pattern}`,
                  );
                }
              }

              this.regexCache
                .get(node.id)!
                .set(hash, {
                  url: cached.url,
                  hash,
                  patterns,
                  rawPatterns: cached.patterns,
                  fetchedAt: cached.fetchedAt,
                  lineCount: cached.lineCount,
                  commentCount: cached.commentCount,
                  errorMessage: cached.errorMessage,
                });

              totalLoaded++;
            }
          }
        }
      }

      this.logger.log(`Loaded ${totalLoaded} cached lists from disk`);
    } catch (error) {
      this.logger.error("Failed to load caches from disk:", error);
    }
  }

  /**
   * Get metadata about all lists configured for a node
   */
  async getListsMetadata(
    nodeId: string,
  ): Promise<{
    blocklists: ListMetadata[];
    allowlists: ListMetadata[];
    regexBlocklists: ListMetadata[];
    regexAllowlists: ListMetadata[];
  }> {
    // Check if config has changed and invalidate cache if needed
    await this.ensureCacheValid(nodeId);

    const snapshot = await this.advancedBlockingService.getSnapshot(nodeId);
    const config = snapshot.config;

    if (!config) {
      return {
        blocklists: [],
        allowlists: [],
        regexBlocklists: [],
        regexAllowlists: [],
      };
    }

    const blocklistUrls = this.extractAllUrls(config, "blockListUrls");
    const allowlistUrls = this.extractAllUrls(config, "allowListUrls");
    const regexBlocklistUrls = this.extractAllUrls(
      config,
      "blockListRegexUrls",
    );
    const regexAllowlistUrls = this.extractAllUrls(
      config,
      "allowListRegexUrls",
    );

    const [blocklists, allowlists, regexBlocklists, regexAllowlists] =
      await Promise.all([
        this.getOrFetchMultiple(nodeId, blocklistUrls),
        this.getOrFetchMultiple(nodeId, allowlistUrls),
        this.getOrFetchMultipleRegex(nodeId, regexBlocklistUrls),
        this.getOrFetchMultipleRegex(nodeId, regexAllowlistUrls),
      ]);

    return {
      blocklists: blocklists.map((list) => this.listToMetadata(list)),
      allowlists: allowlists.map((list) => this.listToMetadata(list)),
      regexBlocklists: regexBlocklists.map((list) =>
        this.regexListToMetadata(list),
      ),
      regexAllowlists: regexAllowlists.map((list) =>
        this.regexListToMetadata(list),
      ),
    };
  }

  /**
   * Get all domains from all lists for a node
   */
  async getAllDomains(
    nodeId: string,
    search?: string,
    searchMode?: "text" | "regex",
    typeFilter?: "all" | "allow" | "block",
    page: number = 1,
    limit: number = 1000,
  ): Promise<{
    lastRefreshed: Date | null;
    domains: Array<{
      domain: string;
      type: "allow" | "block";
      sources: Array<{ url: string; groups: string[] }>;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    // Check if config has changed and invalidate cache if needed
    await this.ensureCacheValid(nodeId);

    const snapshot = await this.advancedBlockingService.getSnapshot(nodeId);
    const config = snapshot.config;

    if (!config) {
      return {
        lastRefreshed: this.lastRefreshTimes.get(nodeId) || null,
        domains: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
    }

    // Build URL-to-groups mappings for both block and allow lists
    const blocklistUrlToGroups = this.buildUrlToGroupsMap(
      config,
      "blockListUrls",
    );
    const allowlistUrlToGroups = this.buildUrlToGroupsMap(
      config,
      "allowListUrls",
    );

    const blocklistUrls = this.extractAllUrls(config, "blockListUrls");
    const allowlistUrls = this.extractAllUrls(config, "allowListUrls");

    const [blocklists, allowlists] = await Promise.all([
      this.getOrFetchMultiple(nodeId, blocklistUrls),
      this.getOrFetchMultiple(nodeId, allowlistUrls),
    ]);

    // Create a map to aggregate domains by domain name
    const domainMap = new Map<
      string,
      {
        domain: string;
        type: "allow" | "block";
        sources: Map<string, Set<string>>; // url -> Set of group names
      }
    >();

    // Process blocklists
    for (const list of blocklists) {
      const groups = blocklistUrlToGroups.get(list.url) || [];
      for (const domain of list.domains) {
        const normalized = this.normalizeDomain(domain);
        if (!domainMap.has(normalized)) {
          domainMap.set(normalized, {
            domain: normalized,
            type: "block",
            sources: new Map(),
          });
        }
        const entry = domainMap.get(normalized)!;
        if (!entry.sources.has(list.url)) {
          entry.sources.set(list.url, new Set());
        }
        groups.forEach((g) => entry.sources.get(list.url)!.add(g));
      }
    }

    // Process allowlists (override type to 'allow')
    for (const list of allowlists) {
      const groups = allowlistUrlToGroups.get(list.url) || [];
      for (const domain of list.domains) {
        const normalized = this.normalizeDomain(domain);
        if (!domainMap.has(normalized)) {
          domainMap.set(normalized, {
            domain: normalized,
            type: "allow",
            sources: new Map(),
          });
        }
        const entry = domainMap.get(normalized)!;
        entry.type = "allow"; // Allow lists take precedence
        if (!entry.sources.has(list.url)) {
          entry.sources.set(list.url, new Set());
        }
        groups.forEach((g) => entry.sources.get(list.url)!.add(g));
      }
    }

    // Add manual entries from each group
    const groups = Array.isArray(config.groups) ? config.groups : [];
    for (const group of groups) {
      // Manual blocked domains
      if (Array.isArray(group.blocked)) {
        for (const domain of group.blocked) {
          const normalized = this.normalizeDomain(domain);
          if (!domainMap.has(normalized)) {
            domainMap.set(normalized, {
              domain: normalized,
              type: "block",
              sources: new Map(),
            });
          }
          const entry = domainMap.get(normalized)!;
          const manualSource = "Manual Entry";
          if (!entry.sources.has(manualSource)) {
            entry.sources.set(manualSource, new Set());
          }
          entry.sources.get(manualSource)!.add(group.name);
        }
      }

      // Manual allowed domains
      if (Array.isArray(group.allowed)) {
        for (const domain of group.allowed) {
          const normalized = this.normalizeDomain(domain);
          if (!domainMap.has(normalized)) {
            domainMap.set(normalized, {
              domain: normalized,
              type: "allow",
              sources: new Map(),
            });
          }
          const entry = domainMap.get(normalized)!;
          entry.type = "allow"; // Allow takes precedence
          const manualSource = "Manual Entry";
          if (!entry.sources.has(manualSource)) {
            entry.sources.set(manualSource, new Set());
          }
          entry.sources.get(manualSource)!.add(group.name);
        }
      }

      // Regex blocked patterns
      if (Array.isArray(group.blockedRegex)) {
        for (const pattern of group.blockedRegex) {
          const normalized = this.normalizeDomain(pattern);
          if (!domainMap.has(normalized)) {
            domainMap.set(normalized, {
              domain: normalized,
              type: "block",
              sources: new Map(),
            });
          }
          const entry = domainMap.get(normalized)!;
          const regexSource = "Regex Pattern (Manual)";
          if (!entry.sources.has(regexSource)) {
            entry.sources.set(regexSource, new Set());
          }
          entry.sources.get(regexSource)!.add(group.name);
        }
      }

      // Regex allowed patterns
      if (Array.isArray(group.allowedRegex)) {
        for (const pattern of group.allowedRegex) {
          const normalized = this.normalizeDomain(pattern);
          if (!domainMap.has(normalized)) {
            domainMap.set(normalized, {
              domain: normalized,
              type: "allow",
              sources: new Map(),
            });
          }
          const entry = domainMap.get(normalized)!;
          entry.type = "allow"; // Allow takes precedence
          const regexSource = "Regex Pattern (Manual)";
          if (!entry.sources.has(regexSource)) {
            entry.sources.set(regexSource, new Set());
          }
          entry.sources.get(regexSource)!.add(group.name);
        }
      }
    }

    // Convert to array and flatten sources
    let domains = Array.from(domainMap.values()).map((entry) => ({
      domain: entry.domain,
      type: entry.type,
      sources: Array.from(entry.sources.entries()).map(([url, groupsSet]) => ({
        url,
        groups: Array.from(groupsSet),
      })),
    }));

    // Apply type filter
    if (typeFilter && typeFilter !== "all") {
      domains = domains.filter((d) => d.type === typeFilter);
    }

    // Apply search filter
    if (search && search.trim()) {
      const searchTrim = search.trim();
      if (searchMode === "regex") {
        try {
          const regex = new RegExp(searchTrim);
          domains = domains.filter((d) => regex.test(d.domain));
        } catch {
          // Invalid regex - return empty results
          domains = [];
        }
      } else {
        // Text search (case-insensitive substring + parent domain matching)
        const searchLower = searchTrim.toLowerCase();
        domains = domains.filter((d) => {
          const domainLower = d.domain.toLowerCase();

          // Direct substring match
          if (domainLower.includes(searchLower)) {
            return true;
          }

          // Check if this domain is a parent of the search term (wildcard match)
          // e.g., searching "cdn3.editmysite.com" should find "editmysite.com"
          if (searchLower.includes(".")) {
            const searchParts = searchLower.split(".");
            for (let i = 1; i < searchParts.length; i++) {
              const parentDomain = searchParts.slice(i).join(".");
              if (domainLower === parentDomain) {
                return true;
              }
            }
          }

          return false;
        });
      }
    }

    // Calculate pagination
    const total = domains.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    // Apply pagination
    const paginatedDomains = domains.slice(startIndex, endIndex);

    return {
      lastRefreshed: this.lastRefreshTimes.get(nodeId) || null,
      domains: paginatedDomains,
      pagination: { page, limit, total, totalPages },
    };
  }

  /**
   * Check if a domain exists in any blocklist or allowlist
   */
  async checkDomain(
    nodeId: string,
    domain: string,
  ): Promise<DomainCheckResult> {
    // Check if config has changed and invalidate cache if needed
    await this.ensureCacheValid(nodeId);

    const snapshot = await this.advancedBlockingService.getSnapshot(nodeId);
    const config = snapshot.config;

    if (!config) {
      return { domain, found: false };
    }

    const normalizedDomain = this.normalizeDomain(domain);
    const foundIn: DomainCheckResult["foundIn"] = [];

    // Check manual entries in each group
    const groups = Array.isArray(config.groups) ? config.groups : [];
    for (const group of groups) {
      if (
        group.blocked?.some((d) => this.normalizeDomain(d) === normalizedDomain)
      ) {
        foundIn.push({
          type: "manual-blocked",
          source: "manual",
          groupName: group.name,
        });
      }
      if (
        group.allowed?.some((d) => this.normalizeDomain(d) === normalizedDomain)
      ) {
        foundIn.push({
          type: "manual-allowed",
          source: "manual",
          groupName: group.name,
        });
      }

      // Check manual regex patterns
      if (group.allowedRegex && Array.isArray(group.allowedRegex)) {
        for (const pattern of group.allowedRegex) {
          try {
            const regex = new RegExp(pattern);
            if (regex.test(normalizedDomain)) {
              foundIn.push({
                type: "regex-allowlist",
                source: "manual",
                groupName: group.name,
                matchedPattern: pattern,
              });
            }
          } catch {
            this.logger.warn(
              `Invalid regex pattern in allowedRegex for group ${group.name}: ${pattern}`,
            );
          }
        }
      }

      if (group.blockedRegex && Array.isArray(group.blockedRegex)) {
        for (const pattern of group.blockedRegex) {
          try {
            const regex = new RegExp(pattern);
            if (regex.test(normalizedDomain)) {
              foundIn.push({
                type: "regex-blocklist",
                source: "manual",
                groupName: group.name,
                matchedPattern: pattern,
              });
            }
          } catch {
            this.logger.warn(
              `Invalid regex pattern in blockedRegex for group ${group.name}: ${pattern}`,
            );
          }
        }
      }
    }

    // Build URL-to-groups mappings
    const blocklistUrlToGroups = this.buildUrlToGroupsMap(
      config,
      "blockListUrls",
    );
    const allowlistUrlToGroups = this.buildUrlToGroupsMap(
      config,
      "allowListUrls",
    );
    const regexBlocklistUrlToGroups = this.buildUrlToGroupsMap(
      config,
      "blockListRegexUrls",
    );
    const regexAllowlistUrlToGroups = this.buildUrlToGroupsMap(
      config,
      "allowListRegexUrls",
    );

    // Check URL-based lists
    const blocklistUrls = this.extractAllUrls(config, "blockListUrls");
    const allowlistUrls = this.extractAllUrls(config, "allowListUrls");
    const regexBlocklistUrls = this.extractAllUrls(
      config,
      "blockListRegexUrls",
    );
    const regexAllowlistUrls = this.extractAllUrls(
      config,
      "allowListRegexUrls",
    );

    const [blocklists, allowlists, regexBlocklists, regexAllowlists] =
      await Promise.all([
        this.getOrFetchMultiple(nodeId, blocklistUrls),
        this.getOrFetchMultiple(nodeId, allowlistUrls),
        this.getOrFetchMultipleRegex(nodeId, regexBlocklistUrls),
        this.getOrFetchMultipleRegex(nodeId, regexAllowlistUrls),
      ]);

    // Check exact domain lists (with wildcard subdomain matching)
    for (const list of blocklists) {
      const match = this.domainMatchesSetWithMatch(
        normalizedDomain,
        list.domains,
      );
      if (match.matched) {
        foundIn.push({
          type: "blocklist",
          source: list.url,
          groups: blocklistUrlToGroups.get(list.url),
          matchedDomain: match.matchedDomain,
        });
      }
    }

    for (const list of allowlists) {
      const match = this.domainMatchesSetWithMatch(
        normalizedDomain,
        list.domains,
      );
      if (match.matched) {
        foundIn.push({
          type: "allowlist",
          source: list.url,
          groups: allowlistUrlToGroups.get(list.url),
          matchedDomain: match.matchedDomain,
        });
      }
    }

    // Check regex lists
    for (const list of regexBlocklists) {
      for (let i = 0; i < list.patterns.length; i++) {
        if (list.patterns[i].test(normalizedDomain)) {
          foundIn.push({
            type: "regex-blocklist",
            source: list.url,
            matchedPattern: list.rawPatterns[i],
            groups: regexBlocklistUrlToGroups.get(list.url),
          });
          break; // Only report first match per list
        }
      }
    }

    for (const list of regexAllowlists) {
      for (let i = 0; i < list.patterns.length; i++) {
        if (list.patterns[i].test(normalizedDomain)) {
          foundIn.push({
            type: "regex-allowlist",
            source: list.url,
            matchedPattern: list.rawPatterns[i],
            groups: regexAllowlistUrlToGroups.get(list.url),
          });
          break; // Only report first match per list
        }
      }
    }

    return {
      domain: normalizedDomain,
      found: foundIn.length > 0,
      foundIn: foundIn.length > 0 ? foundIn : undefined,
    };
  }

  /**
   * Simulate the effective policy for a domain in a specific group
   * This implements Technitium's policy resolution logic:
   * 1. Check manual entries (allowed/blocked arrays in group config)
   * 2. Check allowlists (if found, domain is allowed)
   * 3. Check blocklists (if found, domain is blocked)
   * 4. If not found anywhere, no action (allowed by default)
   */
  async simulateGroupPolicy(
    nodeId: string,
    groupName: string,
    domain: string,
  ): Promise<GroupPolicyResult> {
    // Check if config has changed and invalidate cache if needed
    await this.ensureCacheValid(nodeId);

    const snapshot = await this.advancedBlockingService.getSnapshot(nodeId);
    const config = snapshot.config;

    if (!config || !config.groups || !Array.isArray(config.groups)) {
      return {
        domain,
        groupName,
        finalAction: "none",
        reasons: [],
        evaluation: `Group configuration not found`,
      };
    }

    const group = config.groups.find((g) => g.name === groupName);

    if (!group) {
      return {
        domain,
        groupName,
        finalAction: "none",
        reasons: [],
        evaluation: `Group "${groupName}" not found`,
      };
    }
    const normalizedDomain = this.normalizeDomain(domain);
    const reasons: GroupPolicyResult["reasons"] = [];

    // 1. Check manual entries (highest priority)
    if (group.allowed?.includes(normalizedDomain)) {
      reasons.push({
        action: "allow",
        type: "manual-allowed",
        source: "manual",
      });
    }

    if (group.blocked?.includes(normalizedDomain)) {
      reasons.push({
        action: "block",
        type: "manual-blocked",
        source: "manual",
      });
    }

    // Check manual regex patterns
    if (group.allowedRegex && Array.isArray(group.allowedRegex)) {
      for (const pattern of group.allowedRegex) {
        try {
          const regex = new RegExp(pattern);
          if (regex.test(normalizedDomain)) {
            reasons.push({
              action: "allow",
              type: "regex-allowlist",
              source: "manual",
              matchedPattern: pattern,
            });
          }
        } catch {
          this.logger.warn(`Invalid regex pattern in allowedRegex: ${pattern}`);
        }
      }
    }

    if (group.blockedRegex && Array.isArray(group.blockedRegex)) {
      for (const pattern of group.blockedRegex) {
        try {
          const regex = new RegExp(pattern);
          if (regex.test(normalizedDomain)) {
            reasons.push({
              action: "block",
              type: "regex-blocklist",
              source: "manual",
              matchedPattern: pattern,
            });
          }
        } catch {
          this.logger.warn(`Invalid regex pattern in blockedRegex: ${pattern}`);
        }
      }
    }

    // 2. Check allowlists (with wildcard subdomain matching)
    const allowlistUrls = this.extractUrlsFromGroup(group, "allowListUrls");
    const allowlists = await this.getOrFetchMultiple(nodeId, allowlistUrls);
    for (const list of allowlists) {
      const match = this.domainMatchesSetWithMatch(
        normalizedDomain,
        list.domains,
      );
      if (match.matched) {
        reasons.push({
          action: "allow",
          type: "allowlist",
          source: list.url,
          matchedDomain: match.matchedDomain,
        });
      }
    }

    // 3. Check regex allowlists
    const regexAllowlistUrls = this.extractUrlsFromGroup(
      group,
      "allowListRegexUrls",
    );
    const regexAllowlists = await this.getOrFetchMultipleRegex(
      nodeId,
      regexAllowlistUrls,
    );
    for (const list of regexAllowlists) {
      for (let i = 0; i < list.patterns.length; i++) {
        if (list.patterns[i].test(normalizedDomain)) {
          reasons.push({
            action: "allow",
            type: "regex-allowlist",
            source: list.url,
            matchedPattern: list.rawPatterns[i],
          });
          break; // Only first match per list
        }
      }
    }

    // 4. Check blocklists (with wildcard subdomain matching)
    const blocklistUrls = this.extractUrlsFromGroup(group, "blockListUrls");
    const blocklists = await this.getOrFetchMultiple(nodeId, blocklistUrls);
    for (const list of blocklists) {
      const match = this.domainMatchesSetWithMatch(
        normalizedDomain,
        list.domains,
      );
      if (match.matched) {
        reasons.push({
          action: "block",
          type: "blocklist",
          source: list.url,
          matchedDomain: match.matchedDomain,
        });
      }
    }

    // 5. Check regex blocklists
    const regexBlocklistUrls = this.extractUrlsFromGroup(
      group,
      "blockListRegexUrls",
    );
    const regexBlocklists = await this.getOrFetchMultipleRegex(
      nodeId,
      regexBlocklistUrls,
    );
    for (const list of regexBlocklists) {
      for (let i = 0; i < list.patterns.length; i++) {
        if (list.patterns[i].test(normalizedDomain)) {
          reasons.push({
            action: "block",
            type: "regex-blocklist",
            source: list.url,
            matchedPattern: list.rawPatterns[i],
          });
          break; // Only first match per list
        }
      }
    }

    // Determine final action based on Technitium's precedence rules
    let finalAction: "blocked" | "allowed" | "none" = "none";
    let evaluation = "";

    // Manual blocked takes highest priority
    if (reasons.some((r) => r.type === "manual-blocked")) {
      finalAction = "blocked";
      evaluation = "Domain is manually blocked in group configuration";
    }
    // Then manual allowed
    else if (reasons.some((r) => r.type === "manual-allowed")) {
      finalAction = "allowed";
      evaluation = "Domain is manually allowed in group configuration";
    }
    // Then allowlists (regex or exact)
    else if (
      reasons.some(
        (r) => r.type === "allowlist" || r.type === "regex-allowlist",
      )
    ) {
      finalAction = "allowed";
      const count = reasons.filter(
        (r) => r.type === "allowlist" || r.type === "regex-allowlist",
      ).length;
      evaluation = `Domain found in ${count} allowlist${count > 1 ? "s" : ""}`;
    }
    // Finally blocklists (regex or exact)
    else if (
      reasons.some(
        (r) => r.type === "blocklist" || r.type === "regex-blocklist",
      )
    ) {
      finalAction = "blocked";
      const count = reasons.filter(
        (r) => r.type === "blocklist" || r.type === "regex-blocklist",
      ).length;
      evaluation = `Domain found in ${count} blocklist${count > 1 ? "s" : ""}`;
    }
    // Not found in any list
    else {
      finalAction = "none";
      evaluation = "Domain not found in any lists (allowed by default)";
    }

    return {
      domain: normalizedDomain,
      groupName,
      finalAction,
      reasons,
      evaluation,
    };
  }

  /**
   * Search for domains matching a pattern across all lists
   */
  async searchDomains(
    nodeId: string,
    query: string,
    options: {
      type?: "blocklist" | "allowlist" | "regex-blocklist" | "regex-allowlist";
      limit?: number;
    } = {},
  ): Promise<ListSearchResult[]> {
    // Check if config has changed and invalidate cache if needed
    await this.ensureCacheValid(nodeId);

    const snapshot = await this.advancedBlockingService.getSnapshot(nodeId);
    const config = snapshot.config;

    if (!config) {
      return [];
    }

    const { type = "blocklist", limit = 100 } = options;

    // Handle regex lists
    if (type === "regex-blocklist" || type === "regex-allowlist") {
      const urls =
        type === "regex-blocklist" ?
          this.extractAllUrls(config, "blockListRegexUrls")
        : this.extractAllUrls(config, "allowListRegexUrls");

      const lists = await this.getOrFetchMultipleRegex(nodeId, urls);
      const normalizedQuery = this.normalizeDomain(query).toLowerCase();

      return lists.map((list) => {
        const matches: string[] = [];
        for (const pattern of list.rawPatterns) {
          if (pattern.toLowerCase().includes(normalizedQuery)) {
            matches.push(pattern);
            if (matches.length >= limit) break;
          }
        }
        return {
          url: list.url,
          hash: list.hash,
          matches,
          totalDomains: list.patterns.length,
          isRegex: true,
        };
      });
    }

    // Handle exact domain lists
    const urls =
      type === "blocklist" ?
        this.extractAllUrls(config, "blockListUrls")
      : this.extractAllUrls(config, "allowListUrls");

    const lists = await this.getOrFetchMultiple(nodeId, urls);
    const normalizedQuery = this.normalizeDomain(query).toLowerCase();

    return lists.map((list) => {
      const matches: string[] = [];
      for (const domain of list.domains) {
        if (domain.includes(normalizedQuery)) {
          matches.push(domain);
          if (matches.length >= limit) break;
        }
      }
      return {
        url: list.url,
        hash: list.hash,
        matches,
        totalDomains: list.domains.size,
      };
    });
  }

  /**
   * Get domains from a specific list (paginated)
   */
  getListDomains(
    nodeId: string,
    listHash: string,
    page = 1,
    limit = 100,
  ): {
    domains: string[];
    total: number;
    page: number;
    totalPages: number;
    metadata: ListMetadata;
  } {
    const nodeCache = this.cache.get(nodeId);
    const cachedList = nodeCache?.get(listHash);

    if (!cachedList) {
      throw new Error(`List with hash ${listHash} not found in cache`);
    }

    const domainsArray = Array.from(cachedList.domains).sort();
    const total = domainsArray.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;

    return {
      domains: domainsArray.slice(start, end),
      total,
      page,
      totalPages,
      metadata: this.listToMetadata(cachedList),
    };
  }

  /**
   * Force refresh all lists for a node
   */
  async refreshLists(nodeId: string): Promise<void> {
    this.logger.log(`Forcing refresh of all lists for node ${nodeId}`);
    const nodeCache = this.cache.get(nodeId);
    if (nodeCache) {
      nodeCache.clear();
    }
    const regexNodeCache = this.regexCache.get(nodeId);
    if (regexNodeCache) {
      regexNodeCache.clear();
    }
    await this.getListsMetadata(nodeId);

    // Update last refresh time
    this.lastRefreshTimes.set(nodeId, new Date());

    // Reschedule the refresh timer in case the config has changed
    await this.scheduleNodeRefresh(nodeId);
  }

  /**
   * Clear cache for a specific node
   */
  clearCache(nodeId: string): void {
    this.cache.delete(nodeId);
    this.logger.log(`Cleared cache for node ${nodeId}`);
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    this.cache.clear();
    this.logger.log("Cleared all blocklist caches");
  }

  /**
   * Generate a hash of the list URL configuration to detect changes
   */
  private generateConfigHash(config: AdvancedBlockingConfig | null): string {
    if (!config) return "";

    // Collect all URLs from all groups, sorted for consistent hashing
    const allUrls = new Set<string>();

    const groups = Array.isArray(config.groups) ? config.groups : [];
    for (const group of groups) {
      // Collect URLs from typed fields
      const blockListEntries: AdvancedBlockingUrlEntry[] =
        group.blockListUrls ?? [];
      const allowListEntries: AdvancedBlockingUrlEntry[] =
        group.allowListUrls ?? [];
      const blockListRegexEntries: AdvancedBlockingUrlEntry[] =
        group.regexBlockListUrls ?? [];
      const allowListRegexEntries: AdvancedBlockingUrlEntry[] =
        group.regexAllowListUrls ?? [];

      const allEntries = [
        ...blockListEntries,
        ...allowListEntries,
        ...blockListRegexEntries,
        ...allowListRegexEntries,
      ];

      for (const entry of allEntries) {
        const url = typeof entry === "string" ? entry : entry.url;
        if (url) allUrls.add(url);
      }
    }

    // Sort URLs and create a stable string representation
    const sortedUrls = Array.from(allUrls).sort();
    const configString = sortedUrls.join("|");

    // Hash the configuration
    return createHash("sha256").update(configString).digest("hex");
  }

  /**
   * Check if the Advanced Blocking configuration has changed for a node
   * Returns true if config changed (cache should be invalidated)
   */
  private async checkConfigChanged(nodeId: string): Promise<boolean> {
    try {
      const snapshot = await this.advancedBlockingService.getSnapshot(nodeId);
      const currentHash = this.generateConfigHash(snapshot.config ?? null);
      const previousHash = this.configHashes.get(nodeId);

      // First time checking - store hash but don't trigger refresh
      if (previousHash === undefined) {
        this.configHashes.set(nodeId, currentHash);
        return false;
      }

      // Check if hash changed
      if (currentHash !== previousHash) {
        this.logger.log(`Configuration change detected for node ${nodeId}`);
        this.configHashes.set(nodeId, currentHash);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(
        `Failed to check config changes for node ${nodeId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Ensure cache is valid by checking for config changes
   * Clears cache if configuration has changed
   */
  private async ensureCacheValid(nodeId: string): Promise<void> {
    const configChanged = await this.checkConfigChanged(nodeId);

    if (configChanged) {
      this.logger.log(`Config changed for node ${nodeId}, invalidating cache`);
      const nodeCache = this.cache.get(nodeId);
      if (nodeCache) {
        nodeCache.clear();
      }
      const regexNodeCache = this.regexCache.get(nodeId);
      if (regexNodeCache) {
        regexNodeCache.clear();
      }
    }
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Extract URLs from a specific group (not all groups)
   */
  private extractUrlsFromGroup(
    group: AdvancedBlockingGroup,
    field:
      | "blockListUrls"
      | "allowListUrls"
      | "blockListRegexUrls"
      | "allowListRegexUrls",
  ): string[] {
    const urls: string[] = [];
    const entries = (group[field] as AdvancedBlockingUrlEntry[]) || [];
    for (const entry of entries) {
      const url = typeof entry === "string" ? entry : entry.url;
      if (url) urls.push(url);
    }
    return urls;
  }

  private extractAllUrls(
    config: AdvancedBlockingConfig,
    field:
      | "blockListUrls"
      | "allowListUrls"
      | "blockListRegexUrls"
      | "allowListRegexUrls",
  ): string[] {
    const urls = new Set<string>();
    const groups = Array.isArray(config.groups) ? config.groups : [];

    for (const group of groups) {
      const entries = (group[field] as AdvancedBlockingUrlEntry[]) || [];
      for (const entry of entries) {
        const url = typeof entry === "string" ? entry : entry.url;
        if (url) urls.add(url);
      }
    }

    return Array.from(urls);
  }

  /**
   * Build a mapping of URL → group names that use that URL
   */
  private buildUrlToGroupsMap(
    config: AdvancedBlockingConfig,
    field:
      | "blockListUrls"
      | "allowListUrls"
      | "blockListRegexUrls"
      | "allowListRegexUrls",
  ): Map<string, string[]> {
    const urlToGroups = new Map<string, string[]>();
    const groups = Array.isArray(config.groups) ? config.groups : [];

    for (const group of groups) {
      const entries = (group[field] as AdvancedBlockingUrlEntry[]) || [];
      for (const entry of entries) {
        const url = typeof entry === "string" ? entry : entry.url;
        if (url) {
          if (!urlToGroups.has(url)) {
            urlToGroups.set(url, []);
          }
          const groupsList = urlToGroups.get(url);
          if (groupsList) {
            groupsList.push(group.name);
          }
        }
      }
    }

    return urlToGroups;
  }

  private async getOrFetchMultiple(
    nodeId: string,
    urls: string[],
  ): Promise<CachedList[]> {
    return Promise.all(urls.map((url) => this.getOrFetchList(nodeId, url)));
  }

  private async getOrFetchList(
    nodeId: string,
    url: string,
  ): Promise<CachedList> {
    const hash = this.hashUrl(url);
    const nodeCache = this.cache.get(nodeId) || new Map<string, CachedList>();

    if (!this.cache.has(nodeId)) {
      this.cache.set(nodeId, nodeCache);
    }

    const cached = nodeCache.get(hash);
    if (
      cached &&
      Date.now() - cached.fetchedAt.getTime() < this.refreshInterval
    ) {
      return cached;
    }

    this.logger.log(`Fetching blocklist from ${url}`);
    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { timeout: 30000, responseType: "text" }),
      );

      const content = response.data as string;
      const { domains, lineCount, commentCount } = this.parseDomains(content);

      const cachedList: CachedList = {
        url,
        hash,
        domains,
        fetchedAt: new Date(),
        lineCount,
        commentCount,
      };

      nodeCache.set(hash, cachedList);
      this.logger.log(
        `Cached ${domains.size} domains from ${url} (${lineCount} lines, ${commentCount} comments)`,
      );

      // Save to persistent storage (async, don't wait)
      void this.persistenceService
        .saveCache(
          nodeId,
          url,
          hash,
          Array.from(domains),
          null, // Not a regex list
          lineCount,
          commentCount,
          response.headers?.["etag"] as string | undefined,
          response.headers?.["last-modified"] as string | undefined,
        )
        .catch((err) => {
          this.logger.error(`Failed to persist cache for ${url}:`, err);
        });

      return cachedList;
    } catch (error) {
      this.logger.error(`Failed to fetch blocklist from ${url}`, error);

      // Return cached version even if expired, or create empty error entry
      if (cached) {
        return cached;
      }

      const errorList: CachedList = {
        url,
        hash,
        domains: new Set(),
        fetchedAt: new Date(),
        lineCount: 0,
        commentCount: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
      };

      nodeCache.set(hash, errorList);

      // Save error state to disk (async, don't wait)
      void this.persistenceService
        .saveCache(
          nodeId,
          url,
          hash,
          [],
          null,
          0,
          0,
          undefined,
          undefined,
          errorList.errorMessage,
        )
        .catch((err) => {
          this.logger.error(`Failed to persist error cache for ${url}:`, err);
        });

      return errorList;
    }
  }

  /**
   * Fetch multiple regex lists in parallel
   */
  private async getOrFetchMultipleRegex(
    nodeId: string,
    urls: string[],
  ): Promise<CachedRegexList[]> {
    return Promise.all(
      urls.map((url) => this.getOrFetchRegexList(nodeId, url)),
    );
  }

  /**
   * Fetch or retrieve a single regex list from cache
   */
  private async getOrFetchRegexList(
    nodeId: string,
    url: string,
  ): Promise<CachedRegexList> {
    const hash = this.hashUrl(url);
    const nodeCache =
      this.regexCache.get(nodeId) || new Map<string, CachedRegexList>();

    if (!this.regexCache.has(nodeId)) {
      this.regexCache.set(nodeId, nodeCache);
    }

    const cached = nodeCache.get(hash);
    if (
      cached &&
      Date.now() - cached.fetchedAt.getTime() < this.refreshInterval
    ) {
      return cached;
    }

    this.logger.log(`Fetching regex blocklist from ${url}`);
    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { timeout: 30000, responseType: "text" }),
      );

      const content = response.data as string;
      const { patterns, rawPatterns, lineCount, commentCount } =
        this.parseRegexPatterns(content);

      const cachedList: CachedRegexList = {
        url,
        hash,
        patterns,
        rawPatterns,
        fetchedAt: new Date(),
        lineCount,
        commentCount,
      };

      nodeCache.set(hash, cachedList);
      this.logger.log(
        `Cached ${patterns.length} regex patterns from ${url} (${lineCount} lines, ${commentCount} comments)`,
      );

      // Save to persistent storage (async, don't wait)
      void this.persistenceService
        .saveCache(
          nodeId,
          url,
          hash,
          null, // Not a regular list
          rawPatterns,
          lineCount,
          commentCount,
          response.headers?.["etag"] as string | undefined,
          response.headers?.["last-modified"] as string | undefined,
        )
        .catch((err) => {
          this.logger.error(`Failed to persist regex cache for ${url}:`, err);
        });

      return cachedList;
    } catch (error) {
      this.logger.error(`Failed to fetch regex blocklist from ${url}`, error);

      // Return cached version even if expired, or create empty error entry
      if (cached) {
        return cached;
      }

      const errorList: CachedRegexList = {
        url,
        hash,
        patterns: [],
        rawPatterns: [],
        fetchedAt: new Date(),
        lineCount: 0,
        commentCount: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
      };

      nodeCache.set(hash, errorList);

      // Save error state to disk (async, don't wait)
      void this.persistenceService
        .saveCache(
          nodeId,
          url,
          hash,
          null,
          [],
          0,
          0,
          undefined,
          undefined,
          errorList.errorMessage,
        )
        .catch((err) => {
          this.logger.error(
            `Failed to persist error regex cache for ${url}:`,
            err,
          );
        });

      return errorList;
    }
  }

  private parseDomains(content: string): {
    domains: Set<string>;
    lineCount: number;
    commentCount: number;
  } {
    const domains = new Set<string>();
    const lines = content.split(/\r?\n/);
    let commentCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) continue;

      // Skip comments
      if (trimmed.startsWith("#") || trimmed.startsWith("!")) {
        commentCount++;
        continue;
      }

      // Parse hosts file format: "127.0.0.1 domain.com" or "0.0.0.0 domain.com"
      // Or plain domain format: "domain.com"
      const parts = trimmed.split(/\s+/);
      const domain = parts.length > 1 ? parts[1] : parts[0];

      if (domain && this.isValidDomain(domain)) {
        domains.add(this.normalizeDomain(domain));
      }
    }

    return { domains, lineCount: lines.length, commentCount };
  }

  /**
   * Parse regex patterns from a text file
   * Handles comments (# and !) and compiles valid regex patterns
   */
  private parseRegexPatterns(content: string): {
    patterns: RegExp[];
    rawPatterns: string[];
    lineCount: number;
    commentCount: number;
  } {
    const patterns: RegExp[] = [];
    const rawPatterns: string[] = [];
    const lines = content.split(/\r?\n/);
    let commentCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) continue;

      // Skip comments
      if (trimmed.startsWith("#") || trimmed.startsWith("!")) {
        commentCount++;
        continue;
      }

      // Attempt to compile regex pattern
      try {
        const pattern = new RegExp(trimmed, "i"); // Case-insensitive
        patterns.push(pattern);
        rawPatterns.push(trimmed);
      } catch (error) {
        this.logger.warn(
          `Invalid regex pattern "${trimmed}": ${error instanceof Error ? error.message : String(error)}`,
        );
        commentCount++; // Count invalid patterns as comments
      }
    }

    return { patterns, rawPatterns, lineCount: lines.length, commentCount };
  }

  /**
   * Check if a domain matches any entry in a domain set.
   * Supports both exact matches and wildcard subdomain matches.
   * For example, if the set contains "gambling.com", this will match:
   * - "gambling.com" (exact)
   * - "test.gambling.com" (subdomain)
   * - "www.test.gambling.com" (nested subdomain)
   */
  private domainMatchesSet(domain: string, domainSet: Set<string>): boolean {
    // First check for exact match (fast O(1) lookup)
    if (domainSet.has(domain)) {
      return true;
    }

    // Check if any parent domain matches (wildcard matching)
    // For "test.gambling.com", check "gambling.com", then "com"
    const parts = domain.split(".");
    for (let i = 1; i < parts.length; i++) {
      const parentDomain = parts.slice(i).join(".");
      if (domainSet.has(parentDomain)) {
        return true;
      }
    }

    return false;
  }

  private domainMatchesSetWithMatch(
    domain: string,
    domainSet: Set<string>,
  ): { matched: boolean; matchedDomain?: string } {
    // First check for exact match (fast O(1) lookup)
    if (domainSet.has(domain)) {
      return { matched: true, matchedDomain: domain };
    }

    // Check if any parent domain matches (wildcard matching)
    // For "test.gambling.com", check "gambling.com", then "com"
    const parts = domain.split(".");
    for (let i = 1; i < parts.length; i++) {
      const parentDomain = parts.slice(i).join(".");
      if (domainSet.has(parentDomain)) {
        return { matched: true, matchedDomain: parentDomain };
      }
    }

    return { matched: false };
  }

  private hashUrl(url: string): string {
    return createHash("sha256").update(url).digest("hex");
  }

  private listToMetadata(list: CachedList): ListMetadata {
    return {
      url: list.url,
      hash: list.hash,
      domainCount: list.domains.size,
      lineCount: list.lineCount,
      commentCount: list.commentCount,
      fetchedAt: list.fetchedAt.toISOString(),
      errorMessage: list.errorMessage,
    };
  }

  /**
   * Convert a cached regex list to metadata for API responses
   */
  private regexListToMetadata(list: CachedRegexList): ListMetadata {
    return {
      url: list.url,
      hash: list.hash,
      domainCount: 0, // Regex lists don't have exact domain counts
      patternCount: list.patterns.length,
      isRegex: true,
      lineCount: list.lineCount,
      commentCount: list.commentCount,
      fetchedAt: list.fetchedAt.toISOString(),
      errorMessage: list.errorMessage,
    };
  }

  private normalizeDomain(domain: string): string {
    return domain.toLowerCase().trim();
  }

  private isValidDomain(domain: string): boolean {
    // Basic validation: valid domain characters
    // Accepts both single-label domains (TLDs like "fyi", "com") and multi-label domains (example.com)
    // Pattern explanation:
    // - Must start with alphanumeric
    // - Can contain alphanumeric and hyphens (but not at the end of a label)
    // - Can optionally have dots with more labels
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(
      domain,
    );
  }
}
