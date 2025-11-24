/**
 * Domain Consolidation Logic Test Suite
 *
 * Tests for the domain consolidation logic in DnsToolsPage.tsx that merges
 * group assignments when displaying domains from multiple Advanced Blocking groups.
 *
 * This ensures that domains appearing in multiple groups are correctly consolidated
 * with all their group memberships shown.
 */

import { describe, it, expect } from 'vitest';
import { consolidateDomainsByGroups, type DomainEntryWithGroups } from '../utils/domainConsolidation';

// Type alias for test readability
type DomainEntry = DomainEntryWithGroups;

// Use the imported utility function
const consolidateDomains = consolidateDomainsByGroups;

describe('Domain Consolidation Logic', () => {
    describe('consolidateDomains', () => {
        describe('🔴 CRITICAL: Basic Consolidation', () => {
            it('should return empty array for empty input', () => {
                expect(consolidateDomains([])).toEqual([]);
            });

            it('should preserve single domain entry', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group1'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(1);
                expect(result[0]).toEqual(input[0]);
            });

            it('should consolidate duplicate domains with same listUrl', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group1'] },
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group2'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(1);
                expect(result[0].domain).toBe('example.com');
                expect(result[0].listUrl).toBe('custom');
                expect(result[0].groups).toEqual(['Group1', 'Group2']);
            });

            it('should NOT consolidate same domain with different listUrls', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group1'] },
                    { domain: 'example.com', listUrl: 'https://list.com/block.txt', groups: ['Group2'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(2);
                expect(result[0].groups).toEqual(['Group1']);
                expect(result[1].groups).toEqual(['Group2']);
            });
        });

        describe('🔴 CRITICAL: Group Merging', () => {
            it('should merge multiple groups correctly', () => {
                const input: DomainEntry[] = [
                    { domain: 'ads.com', listUrl: 'custom', groups: ['Ads'] },
                    { domain: 'ads.com', listUrl: 'custom', groups: ['Trackers'] },
                    { domain: 'ads.com', listUrl: 'custom', groups: ['Malware'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(1);
                expect(result[0].groups).toEqual(['Ads', 'Trackers', 'Malware']);
            });

            it('should avoid duplicate groups when merging', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group1', 'Group2'] },
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group2', 'Group3'] },
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group1', 'Group4'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(1);
                expect(result[0].groups).toEqual(['Group1', 'Group2', 'Group3', 'Group4']);
                expect(result[0].groups).toHaveLength(4); // No duplicates
            });

            it('should preserve group order (first occurrence wins)', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: ['Alpha', 'Beta'] },
                    { domain: 'example.com', listUrl: 'custom', groups: ['Gamma'] },
                    { domain: 'example.com', listUrl: 'custom', groups: ['Delta'] }
                ];
                const result = consolidateDomains(input);

                expect(result[0].groups).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
            });
        });

        describe('🟡 HIGH: Multiple Domain Scenarios', () => {
            it('should handle multiple different domains', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group1'] },
                    { domain: 'test.org', listUrl: 'custom', groups: ['Group1'] },
                    { domain: 'demo.net', listUrl: 'custom', groups: ['Group2'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(3);
                expect(result.map(d => d.domain)).toEqual(['example.com', 'test.org', 'demo.net']);
            });

            it('should consolidate some domains while keeping others separate', () => {
                const input: DomainEntry[] = [
                    { domain: 'ads.com', listUrl: 'custom', groups: ['Ads'] },
                    { domain: 'ads.com', listUrl: 'custom', groups: ['Trackers'] },
                    { domain: 'example.com', listUrl: 'custom', groups: ['Safe'] },
                    { domain: 'test.org', listUrl: 'custom', groups: ['Testing'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(3);
                const adsEntry = result.find(d => d.domain === 'ads.com');
                expect(adsEntry?.groups).toEqual(['Ads', 'Trackers']);
            });
        });

        describe('🟡 HIGH: List URL Differentiation', () => {
            it('should keep separate entries for different list sources', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group1'] },
                    { domain: 'example.com', listUrl: 'https://blocklist1.com/list.txt', groups: ['Group1'] },
                    { domain: 'example.com', listUrl: 'https://blocklist2.com/list.txt', groups: ['Group1'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(3);
                expect(result.map(d => d.listUrl)).toEqual([
                    'custom',
                    'https://blocklist1.com/list.txt',
                    'https://blocklist2.com/list.txt'
                ]);
            });

            it('should consolidate within same listUrl but not across different listUrls', () => {
                const input: DomainEntry[] = [
                    { domain: 'ads.com', listUrl: 'custom', groups: ['Group1'] },
                    { domain: 'ads.com', listUrl: 'custom', groups: ['Group2'] },
                    { domain: 'ads.com', listUrl: 'https://list.com/ads.txt', groups: ['Group3'] },
                    { domain: 'ads.com', listUrl: 'https://list.com/ads.txt', groups: ['Group4'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(2);

                const customEntry = result.find(d => d.listUrl === 'custom');
                expect(customEntry?.groups).toEqual(['Group1', 'Group2']);

                const listEntry = result.find(d => d.listUrl === 'https://list.com/ads.txt');
                expect(listEntry?.groups).toEqual(['Group3', 'Group4']);
            });
        });

        describe('🟡 HIGH: Edge Cases', () => {
            it('should handle empty groups array', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: [] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(1);
                expect(result[0].groups).toEqual([]);
            });

            it('should handle entry with no groups vs entry with groups', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: [] },
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group1'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(1);
                expect(result[0].groups).toEqual(['Group1']);
            });

            it('should handle special characters in domain names', () => {
                const input: DomainEntry[] = [
                    { domain: '*.example.com', listUrl: 'custom', groups: ['Group1'] },
                    { domain: '*.example.com', listUrl: 'custom', groups: ['Group2'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(1);
                expect(result[0].domain).toBe('*.example.com');
                expect(result[0].groups).toEqual(['Group1', 'Group2']);
            });

            it('should handle regex patterns in domain names', () => {
                const input: DomainEntry[] = [
                    { domain: '(\\.|^)cdn\\d\\.example\\.com$', listUrl: 'custom', groups: ['CDN'] },
                    { domain: '(\\.|^)cdn\\d\\.example\\.com$', listUrl: 'custom', groups: ['Regex'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(1);
                expect(result[0].groups).toEqual(['CDN', 'Regex']);
            });

            it('should handle case-sensitive domain comparison', () => {
                const input: DomainEntry[] = [
                    { domain: 'Example.com', listUrl: 'custom', groups: ['Group1'] },
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group2'] }
                ];
                const result = consolidateDomains(input);

                // Domains are case-sensitive in the consolidation logic
                expect(result).toHaveLength(2);
            });

            it('should handle very long group lists', () => {
                const manyGroups = Array.from({ length: 50 }, (_, i) => `Group${i}`);
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: manyGroups.slice(0, 25) },
                    { domain: 'example.com', listUrl: 'custom', groups: manyGroups.slice(25, 50) }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(1);
                expect(result[0].groups).toHaveLength(50);
            });
        });

        describe('🔴 CRITICAL: Immutability', () => {
            it('should not mutate input array', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group1'] },
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group2'] }
                ];
                const inputCopy = JSON.parse(JSON.stringify(input));

                consolidateDomains(input);

                expect(input).toEqual(inputCopy);
            });

            it('should not mutate input domain entries', () => {
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group1'] },
                    { domain: 'example.com', listUrl: 'custom', groups: ['Group2'] }
                ];

                consolidateDomains(input);

                expect(input[0].groups).toEqual(['Group1']);
                expect(input[1].groups).toEqual(['Group2']);
            });

            it('should return new group arrays, not references', () => {
                const sharedGroups = ['Group1'];
                const input: DomainEntry[] = [
                    { domain: 'example.com', listUrl: 'custom', groups: sharedGroups }
                ];

                const result = consolidateDomains(input);
                result[0].groups.push('Group2');

                expect(sharedGroups).toEqual(['Group1']); // Original not affected
            });
        });

        describe('🔴 CRITICAL: Real-world Advanced Blocking Scenarios', () => {
            it('should consolidate domains from "Ads" and "Trackers" groups', () => {
                const input: DomainEntry[] = [
                    { domain: 'doubleclick.net', listUrl: 'custom', groups: ['Ads'] },
                    { domain: 'doubleclick.net', listUrl: 'custom', groups: ['Trackers'] },
                    { domain: 'facebook.com', listUrl: 'custom', groups: ['Social Media'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(2);
                const doubleclick = result.find(d => d.domain === 'doubleclick.net');
                expect(doubleclick?.groups).toEqual(['Ads', 'Trackers']);
            });

            it('should handle custom domains across multiple client groups', () => {
                const input: DomainEntry[] = [
                    { domain: 'work-site.com', listUrl: 'custom', groups: ['Adults'] },
                    { domain: 'work-site.com', listUrl: 'custom', groups: ['Teenagers'] },
                    { domain: 'game-site.com', listUrl: 'custom', groups: ['Kids'] },
                    { domain: 'game-site.com', listUrl: 'custom', groups: ['Teenagers'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(2);
                const workSite = result.find(d => d.domain === 'work-site.com');
                expect(workSite?.groups).toEqual(['Adults', 'Teenagers']);

                const gameSite = result.find(d => d.domain === 'game-site.com');
                expect(gameSite?.groups).toEqual(['Kids', 'Teenagers']);
            });

            it('should separate custom entries from blocklist entries', () => {
                const input: DomainEntry[] = [
                    { domain: 'ads.example.com', listUrl: 'custom', groups: ['Custom Block'] },
                    { domain: 'ads.example.com', listUrl: 'https://someadlist.com/list.txt', groups: ['EasyList'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(2);
                expect(result[0].listUrl).toBe('custom');
                expect(result[1].listUrl).toBe('https://someadlist.com/list.txt');
            });

            it('should handle complex multi-group, multi-source scenario', () => {
                const input: DomainEntry[] = [
                    // Custom entries
                    { domain: 'blocked.com', listUrl: 'custom', groups: ['Custom1'] },
                    { domain: 'blocked.com', listUrl: 'custom', groups: ['Custom2'] },
                    // Blocklist 1
                    { domain: 'blocked.com', listUrl: 'https://list1.com/block.txt', groups: ['Group1'] },
                    { domain: 'blocked.com', listUrl: 'https://list1.com/block.txt', groups: ['Group2'] },
                    // Blocklist 2
                    { domain: 'blocked.com', listUrl: 'https://list2.com/block.txt', groups: ['Group3'] },
                    // Other domain
                    { domain: 'other.com', listUrl: 'custom', groups: ['Custom1'] }
                ];
                const result = consolidateDomains(input);

                expect(result).toHaveLength(4);

                const customBlocked = result.find(d => d.domain === 'blocked.com' && d.listUrl === 'custom');
                expect(customBlocked?.groups).toEqual(['Custom1', 'Custom2']);

                const list1Blocked = result.find(d => d.domain === 'blocked.com' && d.listUrl === 'https://list1.com/block.txt');
                expect(list1Blocked?.groups).toEqual(['Group1', 'Group2']);

                const list2Blocked = result.find(d => d.domain === 'blocked.com' && d.listUrl === 'https://list2.com/block.txt');
                expect(list2Blocked?.groups).toEqual(['Group3']);

                const other = result.find(d => d.domain === 'other.com');
                expect(other?.groups).toEqual(['Custom1']);
            });
        });

        describe('🟢 MEDIUM: Performance', () => {
            it('should handle large number of entries efficiently', () => {
                const input: DomainEntry[] = [];
                for (let i = 0; i < 1000; i++) {
                    input.push({
                        domain: `domain${i % 100}.com`,
                        listUrl: 'custom',
                        groups: [`Group${i % 10}`]
                    });
                }

                const start = performance.now();
                const result = consolidateDomains(input);
                const end = performance.now();

                expect(result.length).toBeLessThanOrEqual(100); // Max 100 unique domains
                expect(end - start).toBeLessThan(50); // Should complete in < 50ms
            });

            it('should handle many groups per domain efficiently', () => {
                const input: DomainEntry[] = [];
                for (let i = 0; i < 100; i++) {
                    input.push({
                        domain: 'popular.com',
                        listUrl: 'custom',
                        groups: [`Group${i}`]
                    });
                }

                const start = performance.now();
                const result = consolidateDomains(input);
                const end = performance.now();

                expect(result).toHaveLength(1);
                expect(result[0].groups).toHaveLength(100);
                expect(end - start).toBeLessThan(20); // Should be fast
            });
        });
    });
});
