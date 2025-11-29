import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/**
 * Service for checking and parsing Hagezi DNS blocklist updates from GitHub
 */

export interface HageziListInfo {
    id: string;
    name: string;
    url: string;
    description: string;
    category: 'multi' | 'security' | 'content';
    entries?: string;
}

export interface HageziUpdateCheckResult {
    success: boolean;
    timestamp: string;
    lists: HageziListInfo[];
    rawCommitDate?: string;
    error?: string;
}

@Injectable()
export class BlockListCatalogService {
    private readonly logger = new Logger(BlockListCatalogService.name);

    // Cache for parsed lists (avoid fetching too frequently)
    private cache: {
        data: HageziUpdateCheckResult | null;
        timestamp: number;
    } = { data: null, timestamp: 0 };

    // Cache for 1 hour
    private readonly CACHE_TTL_MS = 60 * 60 * 1000;

    constructor(private readonly httpService: HttpService) { }

    /**
     * Fetch and parse the Hagezi README to extract current list URLs
     * Uses the raw README from GitHub
     */
    async checkHageziUpdates(forceRefresh = false): Promise<HageziUpdateCheckResult> {
        // Return cached data if still valid
        const now = Date.now();
        if (!forceRefresh && this.cache.data && (now - this.cache.timestamp) < this.CACHE_TTL_MS) {
            this.logger.debug('Returning cached Hagezi list data');
            return this.cache.data;
        }

        try {
            this.logger.log('Fetching Hagezi README from GitHub...');

            const readmeUrl = 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/README.md';
            const response = await firstValueFrom(
                this.httpService.get<string>(readmeUrl, {
                    timeout: 30000,
                    responseType: 'text',
                })
            );

            const readme = response.data;
            const lists = this.parseHageziReadme(readme);

            const result: HageziUpdateCheckResult = {
                success: true,
                timestamp: new Date().toISOString(),
                lists,
            };

            // Update cache
            this.cache = { data: result, timestamp: now };

            this.logger.log(`Successfully parsed ${lists.length} Hagezi lists`);
            return result;

        } catch (error) {
            this.logger.error('Failed to fetch Hagezi README:', error);
            return {
                success: false,
                timestamp: new Date().toISOString(),
                lists: [],
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Parse the Hagezi README markdown to extract list URLs
     * Focuses on the "Wildcard Domains" format which is recommended for TechnitiumDNS
     */
    private parseHageziReadme(readme: string): HageziListInfo[] {
        const lists: HageziListInfo[] = [];

        // Pattern to find Wildcard Domains links (TechnitiumDNS compatible)
        // Looking for patterns like: [Link](https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/xxx-onlydomains.txt)
        const wildcardPattern = /\[Link\]\((https:\/\/cdn\.jsdelivr\.net\/gh\/hagezi\/dns-blocklists@latest\/wildcard\/([a-z0-9.-]+)-onlydomains\.txt)\)/gi;

        // Also capture entries count from nearby text like "**Entries:** 333514 domains"
        const sections = readme.split(/###\s+/);

        // Map of known list IDs to metadata
        const listMetadata: Record<string, { name: string; description: string; category: 'multi' | 'security' | 'content' }> = {
            'light': { name: 'Hagezi Light', description: 'Basic protection - Ads, Tracking, Metrics', category: 'multi' },
            'multi': { name: 'Hagezi Normal', description: 'All-round protection - Ads, Tracking, Malware, Scam', category: 'multi' },
            'pro': { name: 'Hagezi Pro', description: 'Extended protection - Balanced blocking', category: 'multi' },
            'pro.plus': { name: 'Hagezi Pro++', description: 'Maximum protection - Aggressive blocking', category: 'multi' },
            'ultimate': { name: 'Hagezi Ultimate', description: 'Aggressive protection - Strictest blocking', category: 'multi' },
            'tif': { name: 'Hagezi TIF (Threat Intelligence)', description: 'Malware, Phishing, Scam, Spam', category: 'security' },
            'tif.medium': { name: 'Hagezi TIF Medium', description: 'Threat Intelligence - Medium version', category: 'security' },
            'tif.mini': { name: 'Hagezi TIF Mini', description: 'Threat Intelligence - Mini version', category: 'security' },
            'fake': { name: 'Hagezi Fake', description: 'Protects against internet scams, traps & fakes', category: 'security' },
            'popupads': { name: 'Hagezi Pop-Up Ads', description: 'Blocks annoying and malicious pop-up ads', category: 'multi' },
            'gambling': { name: 'Hagezi Gambling', description: 'Blocks gambling content', category: 'content' },
            'gambling.medium': { name: 'Hagezi Gambling Medium', description: 'Gambling - Medium version', category: 'content' },
            'gambling.mini': { name: 'Hagezi Gambling Mini', description: 'Gambling - Mini version', category: 'content' },
            'nsfw': { name: 'Hagezi NSFW/Adult', description: 'Blocks adult content', category: 'content' },
            'social': { name: 'Hagezi Social Networks', description: 'Blocks social networks', category: 'content' },
            'anti.piracy': { name: 'Hagezi Anti-Piracy', description: 'Blocks piracy sites', category: 'content' },
            'doh-vpn-proxy-bypass': { name: 'Hagezi DoH/VPN/Proxy Bypass', description: 'Prevents DNS bypass methods', category: 'security' },
            'doh': { name: 'Hagezi DoH Bypass', description: 'Blocks encrypted DNS servers', category: 'security' },
            'dyndns': { name: 'Hagezi Dynamic DNS', description: 'Blocks dynamic DNS services', category: 'security' },
            'hoster': { name: 'Hagezi Badware Hoster', description: 'Blocks known badware hosters', category: 'security' },
            'urlshortener': { name: 'Hagezi URL Shortener', description: 'Blocks URL shorteners', category: 'security' },
            'nosafesearch': { name: 'Hagezi No Safesearch', description: 'Blocks search engines without Safesearch', category: 'content' },
        };

        // Find all wildcard domain links
        let match: RegExpExecArray | null;
        const seenUrls = new Set<string>();

        while ((match = wildcardPattern.exec(readme)) !== null) {
            const url = match[1];
            const filename = match[2]; // e.g., "pro", "light", "tif"

            // Skip duplicates
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);

            const metadata = listMetadata[filename];
            if (metadata) {
                lists.push({
                    id: `hagezi-${filename.replace(/\./g, '-')}`,
                    name: metadata.name,
                    url,
                    description: metadata.description,
                    category: metadata.category,
                });
            } else {
                // Unknown list - still add it with generic metadata
                lists.push({
                    id: `hagezi-${filename.replace(/\./g, '-')}`,
                    name: `Hagezi ${filename.charAt(0).toUpperCase() + filename.slice(1)}`,
                    url,
                    description: 'Hagezi blocklist',
                    category: 'multi',
                });
            }
        }

        return lists;
    }

    /**
     * Compare current catalog with fetched lists to find updates
     */
    async compareWithCatalog(currentUrls: string[]): Promise<{
        newLists: HageziListInfo[];
        changedUrls: Array<{ oldUrl: string; newUrl: string; listName: string }>;
    }> {
        const fetchResult = await this.checkHageziUpdates();

        if (!fetchResult.success) {
            return { newLists: [], changedUrls: [] };
        }

        const currentUrlSet = new Set(currentUrls);
        const fetchedUrlMap = new Map(fetchResult.lists.map(l => [l.id, l]));

        // Find new lists (URLs we don't have)
        const newLists = fetchResult.lists.filter(l => !currentUrlSet.has(l.url));

        // For now, we can't easily detect changed URLs without storing old IDs
        // This would require tracking list IDs in the catalog

        return {
            newLists,
            changedUrls: [],
        };
    }
}
