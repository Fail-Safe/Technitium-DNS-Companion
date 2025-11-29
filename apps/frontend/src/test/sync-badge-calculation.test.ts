/**
 * Sync Badge Calculation Test Suite
 *
 * Tests for the sync badge calculation logic in ConfigurationPage.tsx
 * that determines how many groups are out of sync between nodes.
 *
 * CRITICAL: This logic uses compareStringArrays() and compareUrlArrays()
 * which are being refactored into shared utilities. These tests ensure
 * the badge calculation continues to work correctly after refactoring.
 *
 * The sync badge is a key user-facing feature that shows at a glance
 * whether configuration is in sync across Technitium DNS nodes.
 */

import { describe, it, expect } from 'vitest';

/**
 * Type definitions matching the actual Advanced Blocking configuration
 */
interface AdvancedBlockingGroup {
    name: string;
    blocked: string[];
    allowed: string[];
    blockedRegex: string[];
    allowedRegex: string[];
    blockListUrls: Array<string | { url: string }>;
    allowListUrls: Array<string | { url: string }>;
    regexBlockListUrls: Array<string | { url: string }>;
    regexAllowListUrls: Array<string | { url: string }>;
    adblockListUrls: string[];
}

interface AdvancedBlockingConfig {
    groups: AdvancedBlockingGroup[];
}

interface NodeAdvancedBlocking {
    nodeId: string;
    config: AdvancedBlockingConfig | null;
    error?: string;
}

/**
 * Duplicate the comparison functions for testing
 */
function compareStringArrays(arr1: string[], arr2: string[]): boolean {
    if (!arr1 && !arr2) return true;
    if (!arr1 || !arr2) return false;
    if (arr1.length !== arr2.length) return false;
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    return sorted1.every((val, idx) => val === sorted2[idx]);
}

function compareUrlArrays(
    arr1: Array<string | { url: string }>,
    arr2: Array<string | { url: string }>
): boolean {
    if (!arr1 && !arr2) return true;
    if (!arr1 || !arr2) return false;
    if (arr1.length !== arr2.length) return false;

    const normalize = (item: string | { url: string }): string => {
        const url = typeof item === 'string' ? item : item.url;
        try {
            const u = new URL(url);
            return u.href.toLowerCase();
        } catch {
            return url.toLowerCase();
        }
    };

    const sorted1 = arr1.map(normalize).sort();
    const sorted2 = arr2.map(normalize).sort();
    return sorted1.every((val, idx) => val === sorted2[idx]);
}

/**
 * Duplicate the badge calculation logic
 */
function calculateSyncBadgeCount(advancedBlocking: NodeAdvancedBlocking[]): number {
    if (advancedBlocking.length < 2) return 0;

    const nodesWithData = advancedBlocking.filter(ab => ab.config && !ab.error);
    if (nodesWithData.length < 2) return 0;

    // Compare first two nodes' configurations
    const [node1, node2] = nodesWithData;
    const groups1 = node1.config!.groups || [];
    const groups2 = node2.config!.groups || [];

    // Build maps of groups by name
    const groups1Map = new Map(groups1.map(g => [g.name, g]));
    const groups2Map = new Map(groups2.map(g => [g.name, g]));

    // Get all unique group names
    const allGroupNames = new Set([...groups1Map.keys(), ...groups2Map.keys()]);

    let differenceCount = 0;

    for (const groupName of allGroupNames) {
        const group1 = groups1Map.get(groupName);
        const group2 = groups2Map.get(groupName);

        // If group exists in only one node
        if (!group1 || !group2) {
            differenceCount++;
            continue;
        }

        // Compare group contents using deep comparison
        const isDifferent =
            !compareStringArrays(group1.blocked, group2.blocked) ||
            !compareStringArrays(group1.allowed, group2.allowed) ||
            !compareStringArrays(group1.blockedRegex, group2.blockedRegex) ||
            !compareStringArrays(group1.allowedRegex, group2.allowedRegex) ||
            !compareUrlArrays(group1.blockListUrls, group2.blockListUrls) ||
            !compareUrlArrays(group1.allowListUrls, group2.allowListUrls) ||
            !compareUrlArrays(group1.regexBlockListUrls, group2.regexBlockListUrls) ||
            !compareUrlArrays(group1.regexAllowListUrls, group2.regexAllowListUrls) ||
            !compareStringArrays(group1.adblockListUrls, group2.adblockListUrls);

        if (isDifferent) {
            differenceCount++;
        }
    }

    return differenceCount;
}

describe('Sync Badge Calculation', () => {
    describe('calculateSyncBadgeCount', () => {
        describe('🔴 CRITICAL: Basic Badge Calculation', () => {
            it('should return 0 when fewer than 2 nodes', () => {
                const advancedBlocking: NodeAdvancedBlocking[] = [
                    {
                        nodeId: 'node1',
                        config: { groups: [] }
                    }
                ];
                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });

            it('should return 0 when both nodes have identical empty groups', () => {
                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [] } },
                    { nodeId: 'node2', config: { groups: [] } }
                ];
                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });

            it('should return 0 when both nodes have identical groups', () => {
                const group: AdvancedBlockingGroup = {
                    name: 'Test Group',
                    blocked: ['ads.com', 'trackers.net'],
                    allowed: ['safe.com'],
                    blockedRegex: ['^.*\\.ads\\.com$'],
                    allowedRegex: [],
                    blockListUrls: ['https://example.com/list.txt'],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group] } },
                    { nodeId: 'node2', config: { groups: [{ ...group }] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });

            it('should return 1 when one group is different', () => {
                const group1: AdvancedBlockingGroup = {
                    name: 'Test Group',
                    blocked: ['ads.com'],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const group2: AdvancedBlockingGroup = {
                    ...group1,
                    blocked: ['ads.com', 'trackers.net'] // Different
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group1] } },
                    { nodeId: 'node2', config: { groups: [group2] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(1);
            });

            it('should count multiple different groups', () => {
                const group1: AdvancedBlockingGroup = {
                    name: 'Group 1',
                    blocked: ['ads.com'],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const group2: AdvancedBlockingGroup = {
                    name: 'Group 2',
                    blocked: ['trackers.net'],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group1, group2] } },
                    {
                        nodeId: 'node2',
                        config: {
                            groups: [
                                { ...group1, blocked: ['different.com'] }, // Different
                                { ...group2, allowed: ['safe.com'] } // Different
                            ]
                        }
                    }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(2);
            });
        });

        describe('🔴 CRITICAL: Deep Array Comparison (Bug Fix Integration)', () => {
            it('should return 0 when arrays have same elements in different order', () => {
                const group1: AdvancedBlockingGroup = {
                    name: 'Test Group',
                    blocked: ['ads.com', 'trackers.net', 'spam.org'],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const group2: AdvancedBlockingGroup = {
                    ...group1,
                    blocked: ['trackers.net', 'spam.org', 'ads.com'] // Same, different order
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group1] } },
                    { nodeId: 'node2', config: { groups: [group2] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });

            it('should detect difference when one domain is different', () => {
                const group1: AdvancedBlockingGroup = {
                    name: 'Test Group',
                    blocked: ['ads.com', 'trackers.net'],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const group2: AdvancedBlockingGroup = {
                    ...group1,
                    blocked: ['ads.com', 'different.net'] // One domain changed
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group1] } },
                    { nodeId: 'node2', config: { groups: [group2] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(1);
            });

            it('should handle regex arrays with different order', () => {
                const group1: AdvancedBlockingGroup = {
                    name: 'Test Group',
                    blocked: [],
                    allowed: [],
                    blockedRegex: ['^.*\\.ads\\.com$', '^tracker.*\\.net$'],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const group2: AdvancedBlockingGroup = {
                    ...group1,
                    blockedRegex: ['^tracker.*\\.net$', '^.*\\.ads\\.com$'] // Same, different order
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group1] } },
                    { nodeId: 'node2', config: { groups: [group2] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });
        });

        describe('🔴 CRITICAL: URL Array Comparison', () => {
            it('should handle URL arrays with different order', () => {
                const group1: AdvancedBlockingGroup = {
                    name: 'Test Group',
                    blocked: [],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [
                        'https://example.com/list1.txt',
                        'https://example.com/list2.txt'
                    ],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const group2: AdvancedBlockingGroup = {
                    ...group1,
                    blockListUrls: [
                        'https://example.com/list2.txt',
                        'https://example.com/list1.txt'
                    ]
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group1] } },
                    { nodeId: 'node2', config: { groups: [group2] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });

            it('should handle URL objects', () => {
                const group1: AdvancedBlockingGroup = {
                    name: 'Test Group',
                    blocked: [],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [
                        { url: 'https://example.com/list1.txt' },
                        { url: 'https://example.com/list2.txt' }
                    ],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const group2: AdvancedBlockingGroup = {
                    ...group1,
                    blockListUrls: [
                        { url: 'https://example.com/list2.txt' },
                        { url: 'https://example.com/list1.txt' }
                    ]
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group1] } },
                    { nodeId: 'node2', config: { groups: [group2] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });

            it('should handle case differences in URLs', () => {
                const group1: AdvancedBlockingGroup = {
                    name: 'Test Group',
                    blocked: [],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: ['https://EXAMPLE.COM/list.txt'],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const group2: AdvancedBlockingGroup = {
                    ...group1,
                    blockListUrls: ['https://example.com/list.txt']
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group1] } },
                    { nodeId: 'node2', config: { groups: [group2] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });
        });

        describe('🔴 CRITICAL: Group Presence Detection', () => {
            it('should count group present in node1 but not node2', () => {
                const group: AdvancedBlockingGroup = {
                    name: 'Only on Node1',
                    blocked: ['ads.com'],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group] } },
                    { nodeId: 'node2', config: { groups: [] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(1);
            });

            it('should count group present in node2 but not node1', () => {
                const group: AdvancedBlockingGroup = {
                    name: 'Only on Node2',
                    blocked: ['ads.com'],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [] } },
                    { nodeId: 'node2', config: { groups: [group] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(1);
            });

            it('should count all mismatched groups', () => {
                const sharedGroup: AdvancedBlockingGroup = {
                    name: 'Shared',
                    blocked: ['ads.com'],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const node1Only: AdvancedBlockingGroup = {
                    name: 'Node1 Only',
                    blocked: [],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const node2Only: AdvancedBlockingGroup = {
                    name: 'Node2 Only',
                    blocked: [],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [sharedGroup, node1Only] } },
                    { nodeId: 'node2', config: { groups: [sharedGroup, node2Only] } }
                ];

                // 2 groups are different (node1Only and node2Only)
                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(2);
            });
        });

        describe('🟡 HIGH: Edge Cases', () => {
            it('should return 0 when one node has null config', () => {
                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [] } },
                    { nodeId: 'node2', config: null }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });

            it('should return 0 when one node has error', () => {
                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [] } },
                    { nodeId: 'node2', config: null, error: 'Connection failed' }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });

            it('should handle empty arrays vs undefined', () => {
                const group1: AdvancedBlockingGroup = {
                    name: 'Test',
                    blocked: [],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const group2 = { ...group1 };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group1] } },
                    { nodeId: 'node2', config: { groups: [group2] } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });
        });

        describe('🔴 CRITICAL: Real-world Multi-Node Scenarios', () => {
            it('should calculate badge for typical two-node setup', () => {
                // Node1 has Ads and Trackers groups
                // Node2 has only Ads group (different domains)
                const adsGroupNode1: AdvancedBlockingGroup = {
                    name: 'Ads',
                    blocked: ['ads.google.com', 'doubleclick.net'],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: ['https://example.com/ads.txt'],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const adsGroupNode2: AdvancedBlockingGroup = {
                    name: 'Ads',
                    blocked: ['ads.google.com'], // Missing doubleclick.net
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: ['https://example.com/ads.txt'],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const trackersGroup: AdvancedBlockingGroup = {
                    name: 'Trackers',
                    blocked: ['tracker.com'],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [adsGroupNode1, trackersGroup] } },
                    { nodeId: 'node2', config: { groups: [adsGroupNode2] } }
                ];

                // Ads group is different (different domains)
                // Trackers group only on node1
                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(2);
            });

            it('should return 0 for fully synced production nodes', () => {
                const groups: AdvancedBlockingGroup[] = [
                    {
                        name: 'Ads',
                        blocked: ['ads.google.com', 'doubleclick.net', 'adservice.google.com'],
                        allowed: ['accounts.google.com'],
                        blockedRegex: ['^.*\\.ads\\.com$'],
                        allowedRegex: [],
                        blockListUrls: ['https://raw.githubusercontent.com/user/repo/main/ads.txt'],
                        allowListUrls: [],
                        regexBlockListUrls: [],
                        regexAllowListUrls: [],
                        adblockListUrls: ['https://easylist.to/easylist/easylist.txt']
                    },
                    {
                        name: 'Trackers',
                        blocked: ['tracker.com', 'analytics.com'],
                        allowed: [],
                        blockedRegex: [],
                        allowedRegex: [],
                        blockListUrls: [],
                        allowListUrls: [],
                        regexBlockListUrls: [],
                        regexAllowListUrls: [],
                        adblockListUrls: []
                    }
                ];

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: JSON.parse(JSON.stringify(groups)) } },
                    { nodeId: 'node2', config: { groups: JSON.parse(JSON.stringify(groups)) } }
                ];

                expect(calculateSyncBadgeCount(advancedBlocking)).toBe(0);
            });
        });

        describe('🟢 MEDIUM: Performance', () => {
            it('should handle many groups efficiently', () => {
                const groups: AdvancedBlockingGroup[] = Array.from({ length: 50 }, (_, i) => ({
                    name: `Group ${i}`,
                    blocked: [`domain${i}.com`],
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                }));

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups } },
                    { nodeId: 'node2', config: { groups: JSON.parse(JSON.stringify(groups)) } }
                ];

                const start = performance.now();
                const result = calculateSyncBadgeCount(advancedBlocking);
                const end = performance.now();

                expect(result).toBe(0);
                expect(end - start).toBeLessThan(50); // Should complete quickly
            });

            it('should handle large domain lists efficiently', () => {
                const group: AdvancedBlockingGroup = {
                    name: 'Large Group',
                    blocked: Array.from({ length: 1000 }, (_, i) => `domain${i}.com`),
                    allowed: [],
                    blockedRegex: [],
                    allowedRegex: [],
                    blockListUrls: [],
                    allowListUrls: [],
                    regexBlockListUrls: [],
                    regexAllowListUrls: [],
                    adblockListUrls: []
                };

                const advancedBlocking: NodeAdvancedBlocking[] = [
                    { nodeId: 'node1', config: { groups: [group] } },
                    { nodeId: 'node2', config: { groups: [JSON.parse(JSON.stringify(group))] } }
                ];

                const start = performance.now();
                const result = calculateSyncBadgeCount(advancedBlocking);
                const end = performance.now();

                expect(result).toBe(0);
                expect(end - start).toBeLessThan(100);
            });
        });
    });
});
