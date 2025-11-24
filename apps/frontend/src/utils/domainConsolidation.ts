/**
 * Domain Consolidation Utilities
 *
 * Used by DNS Tools to consolidate domain entries when displaying domains from
 * multiple Advanced Blocking groups. Ensures that domains appearing in multiple
 * groups or lists are properly merged for cleaner display.
 */

/**
 * Domain entry with group memberships (for multi-group domain display)
 */
export interface DomainEntryWithGroups {
    domain: string;
    listUrl: string;
    groups: string[];
}

/**
 * Domain source from Advanced Blocking API
 */
export interface DomainSource {
    url: string;
    groups: string[];
}

/**
 * Consolidated domain entry with multiple sources
 */
export interface AllDomainEntry {
    domain: string;
    type: string;
    sources: DomainSource[];
}

/**
 * Consolidate domains that appear in multiple groups
 *
 * When displaying domains from multiple Advanced Blocking groups, this function
 * merges entries for the same domain+listUrl combination and consolidates their
 * group memberships.
 *
 * @param domains - Array of domain entries from various groups
 * @returns Consolidated array with merged group memberships
 *
 * @example
 * const domains = [
 *   { domain: 'ads.example.com', listUrl: 'https://...', groups: ['Ads'] },
 *   { domain: 'ads.example.com', listUrl: 'https://...', groups: ['Trackers'] }
 * ];
 *
 * consolidateDomainsByGroups(domains);
 * // Returns: [{ domain: 'ads.example.com', listUrl: 'https://...', groups: ['Ads', 'Trackers'] }]
 */
export function consolidateDomainsByGroups(
    domains: DomainEntryWithGroups[]
): DomainEntryWithGroups[] {
    const domainMap = new Map<string, DomainEntryWithGroups>();

    domains.forEach((entry) => {
        const key = `${entry.domain}|${entry.listUrl}`;

        if (domainMap.has(key)) {
            // Merge groups into existing entry, avoiding duplicates
            const existing = domainMap.get(key)!;
            entry.groups.forEach((group) => {
                if (!existing.groups.includes(group)) {
                    existing.groups.push(group);
                }
            });
        } else {
            // First occurrence - clone the entry to avoid mutating the original
            domainMap.set(key, {
                ...entry,
                groups: [...entry.groups],
            });
        }
    });

    return Array.from(domainMap.values());
}

/**
 * Consolidate domain entries by domain and type
 *
 * Used in DNS Tools "All Domains" view to merge sources for the same domain+type
 * combination. Each unique domain+type gets one row with all sources listed.
 *
 * @param domains - Array of domain entries with sources
 * @returns Consolidated array with merged sources per domain+type
 *
 * @example
 * const domains = [
 *   { domain: 'ads.com', type: 'blocked', sources: [{ url: 'list1.txt', groups: ['Ads'] }] },
 *   { domain: 'ads.com', type: 'blocked', sources: [{ url: 'list2.txt', groups: ['Trackers'] }] }
 * ];
 *
 * consolidateDomainsByType(domains);
 * // Returns: [{ domain: 'ads.com', type: 'blocked', sources: [list1, list2] }]
 */
export function consolidateDomainsByType(
    domains: AllDomainEntry[]
): AllDomainEntry[] {
    const consolidationMap = new Map<string, AllDomainEntry>();

    domains.forEach(entry => {
        const key = `${entry.domain}|${entry.type}`;

        if (consolidationMap.has(key)) {
            // Merge sources into existing entry, avoiding duplicates
            const existing = consolidationMap.get(key)!;
            const existingUrls = new Set(existing.sources.map(s => s.url));

            entry.sources.forEach(source => {
                if (!existingUrls.has(source.url)) {
                    existing.sources.push(source);
                    existingUrls.add(source.url);
                }
            });
        } else {
            // First occurrence - create new entry with cloned sources
            consolidationMap.set(key, {
                domain: entry.domain,
                type: entry.type,
                sources: [...entry.sources]
            });
        }
    });

    return Array.from(consolidationMap.values());
}
