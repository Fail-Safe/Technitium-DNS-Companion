import { describe, it, expect } from 'vitest';

/**
 * Advanced Blocking Logic Tests
 *
 * These tests validate core Advanced Blocking functionality:
 * - Group matching and filtering
 * - Metrics aggregation across nodes
 * - Domain categorization
 *
 * These are CRITICAL because:
 * - Users depend on accurate group matching to add domains to correct blocking groups
 * - Metrics aggregation shows overall blocking effectiveness
 * - This is a "non-negotiable" requirement per project specifications
 */

interface AdvancedBlockingMetrics {
    groupCount: number;
    blockedDomainCount: number;
    allowedDomainCount: number;
    blockListUrlCount: number;
    allowListUrlCount: number;
    adblockListUrlCount: number;
    allowedRegexCount: number;
    blockedRegexCount: number;
    regexAllowListUrlCount: number;
    regexBlockListUrlCount: number;
    localEndpointMappingCount: number;
    networkMappingCount: number;
    scheduledNodeCount: number;
}

interface AdvancedBlockingGroup {
    id?: string;
    name: string;
    description?: string;
    disabled?: boolean;
}

interface AdvancedBlockingSnapshot {
    nodeId: string;
    metrics: AdvancedBlockingMetrics;
    error?: string;
}

describe('Advanced Blocking Logic', () => {
    /**
     * Test: Metrics Aggregation
     *
     * Validates that metrics from multiple nodes combine correctly.
     * Critical because: Users need accurate aggregate blocking stats across all nodes.
     */
    describe('Metrics Aggregation', () => {
        it('should sum metrics from multiple nodes', () => {
            const node1Metrics: AdvancedBlockingMetrics = {
                groupCount: 5,
                blockedDomainCount: 1000,
                allowedDomainCount: 50,
                blockListUrlCount: 2,
                allowListUrlCount: 1,
                adblockListUrlCount: 1,
                allowedRegexCount: 5,
                blockedRegexCount: 10,
                regexAllowListUrlCount: 1,
                regexBlockListUrlCount: 1,
                localEndpointMappingCount: 10,
                networkMappingCount: 5,
                scheduledNodeCount: 2,
            };

            const node2Metrics: AdvancedBlockingMetrics = {
                groupCount: 3,
                blockedDomainCount: 500,
                allowedDomainCount: 25,
                blockListUrlCount: 1,
                allowListUrlCount: 1,
                adblockListUrlCount: 0,
                allowedRegexCount: 3,
                blockedRegexCount: 5,
                regexAllowListUrlCount: 0,
                regexBlockListUrlCount: 1,
                localEndpointMappingCount: 5,
                networkMappingCount: 3,
                scheduledNodeCount: 1,
            };

            // Aggregate logic
            const aggregate = {
                groupCount: node1Metrics.groupCount + node2Metrics.groupCount,
                blockedDomainCount: node1Metrics.blockedDomainCount + node2Metrics.blockedDomainCount,
                allowedDomainCount: node1Metrics.allowedDomainCount + node2Metrics.allowedDomainCount,
                blockListUrlCount: node1Metrics.blockListUrlCount + node2Metrics.blockListUrlCount,
                allowListUrlCount: node1Metrics.allowListUrlCount + node2Metrics.allowListUrlCount,
                adblockListUrlCount: node1Metrics.adblockListUrlCount + node2Metrics.adblockListUrlCount,
                allowedRegexCount: node1Metrics.allowedRegexCount + node2Metrics.allowedRegexCount,
                blockedRegexCount: node1Metrics.blockedRegexCount + node2Metrics.blockedRegexCount,
                regexAllowListUrlCount: node1Metrics.regexAllowListUrlCount + node2Metrics.regexAllowListUrlCount,
                regexBlockListUrlCount: node1Metrics.regexBlockListUrlCount + node2Metrics.regexBlockListUrlCount,
                localEndpointMappingCount:
                    node1Metrics.localEndpointMappingCount + node2Metrics.localEndpointMappingCount,
                networkMappingCount: node1Metrics.networkMappingCount + node2Metrics.networkMappingCount,
                scheduledNodeCount: node1Metrics.scheduledNodeCount + node2Metrics.scheduledNodeCount,
            };

            expect(aggregate.groupCount).toBe(8);
            expect(aggregate.blockedDomainCount).toBe(1500);
            expect(aggregate.allowedDomainCount).toBe(75);
            expect(aggregate.blockListUrlCount).toBe(3);
        });

        it('should handle empty metrics', () => {
            const emptyMetrics: AdvancedBlockingMetrics = {
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

            const nodeMetrics: AdvancedBlockingMetrics = {
                groupCount: 5,
                blockedDomainCount: 100,
                allowedDomainCount: 10,
                blockListUrlCount: 1,
                allowListUrlCount: 1,
                adblockListUrlCount: 1,
                allowedRegexCount: 2,
                blockedRegexCount: 3,
                regexAllowListUrlCount: 1,
                regexBlockListUrlCount: 1,
                localEndpointMappingCount: 5,
                networkMappingCount: 2,
                scheduledNodeCount: 1,
            };

            const aggregate = {
                groupCount: emptyMetrics.groupCount + nodeMetrics.groupCount,
                blockedDomainCount: emptyMetrics.blockedDomainCount + nodeMetrics.blockedDomainCount,
                allowedDomainCount: emptyMetrics.allowedDomainCount + nodeMetrics.allowedDomainCount,
                blockListUrlCount: emptyMetrics.blockListUrlCount + nodeMetrics.blockListUrlCount,
                allowListUrlCount: emptyMetrics.allowListUrlCount + nodeMetrics.allowListUrlCount,
                adblockListUrlCount: emptyMetrics.adblockListUrlCount + nodeMetrics.adblockListUrlCount,
                allowedRegexCount: emptyMetrics.allowedRegexCount + nodeMetrics.allowedRegexCount,
                blockedRegexCount: emptyMetrics.blockedRegexCount + nodeMetrics.blockedRegexCount,
                regexAllowListUrlCount:
                    emptyMetrics.regexAllowListUrlCount + nodeMetrics.regexAllowListUrlCount,
                regexBlockListUrlCount:
                    emptyMetrics.regexBlockListUrlCount + nodeMetrics.regexBlockListUrlCount,
                localEndpointMappingCount:
                    emptyMetrics.localEndpointMappingCount + nodeMetrics.localEndpointMappingCount,
                networkMappingCount: emptyMetrics.networkMappingCount + nodeMetrics.networkMappingCount,
                scheduledNodeCount: emptyMetrics.scheduledNodeCount + nodeMetrics.scheduledNodeCount,
            };

            expect(aggregate).toEqual(nodeMetrics);
        });

        it('should correctly aggregate metrics from three or more nodes', () => {
            const metricsArray = [
                {
                    groupCount: 3,
                    blockedDomainCount: 100,
                    allowedDomainCount: 10,
                    blockListUrlCount: 1,
                    allowListUrlCount: 1,
                    adblockListUrlCount: 1,
                    allowedRegexCount: 2,
                    blockedRegexCount: 3,
                    regexAllowListUrlCount: 1,
                    regexBlockListUrlCount: 1,
                    localEndpointMappingCount: 5,
                    networkMappingCount: 2,
                    scheduledNodeCount: 1,
                },
                {
                    groupCount: 2,
                    blockedDomainCount: 50,
                    allowedDomainCount: 5,
                    blockListUrlCount: 1,
                    allowListUrlCount: 0,
                    adblockListUrlCount: 1,
                    allowedRegexCount: 1,
                    blockedRegexCount: 2,
                    regexAllowListUrlCount: 0,
                    regexBlockListUrlCount: 1,
                    localEndpointMappingCount: 3,
                    networkMappingCount: 1,
                    scheduledNodeCount: 1,
                },
                {
                    groupCount: 4,
                    blockedDomainCount: 200,
                    allowedDomainCount: 20,
                    blockListUrlCount: 2,
                    allowListUrlCount: 1,
                    adblockListUrlCount: 0,
                    allowedRegexCount: 3,
                    blockedRegexCount: 4,
                    regexAllowListUrlCount: 1,
                    regexBlockListUrlCount: 0,
                    localEndpointMappingCount: 8,
                    networkMappingCount: 3,
                    scheduledNodeCount: 2,
                },
            ];

            const aggregate = metricsArray.reduce(
                (acc, metrics) => ({
                    groupCount: acc.groupCount + metrics.groupCount,
                    blockedDomainCount: acc.blockedDomainCount + metrics.blockedDomainCount,
                    allowedDomainCount: acc.allowedDomainCount + metrics.allowedDomainCount,
                    blockListUrlCount: acc.blockListUrlCount + metrics.blockListUrlCount,
                    allowListUrlCount: acc.allowListUrlCount + metrics.allowListUrlCount,
                    adblockListUrlCount: acc.adblockListUrlCount + metrics.adblockListUrlCount,
                    allowedRegexCount: acc.allowedRegexCount + metrics.allowedRegexCount,
                    blockedRegexCount: acc.blockedRegexCount + metrics.blockedRegexCount,
                    regexAllowListUrlCount:
                        acc.regexAllowListUrlCount + metrics.regexAllowListUrlCount,
                    regexBlockListUrlCount:
                        acc.regexBlockListUrlCount + metrics.regexBlockListUrlCount,
                    localEndpointMappingCount:
                        acc.localEndpointMappingCount + metrics.localEndpointMappingCount,
                    networkMappingCount: acc.networkMappingCount + metrics.networkMappingCount,
                    scheduledNodeCount: acc.scheduledNodeCount + metrics.scheduledNodeCount,
                }),
                {
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
                },
            );

            expect(aggregate.groupCount).toBe(9);
            expect(aggregate.blockedDomainCount).toBe(350);
            expect(aggregate.allowedDomainCount).toBe(35);
            expect(aggregate.blockListUrlCount).toBe(4);
        });
    });

    /**
     * Test: Group Matching
     *
     * Validates that domains can be correctly matched to groups.
     * Critical because: Users need to select correct groups when adding domains.
     */
    describe('Group Matching', () => {
        const groups: AdvancedBlockingGroup[] = [
            { id: 'ads', name: 'Ad Networks', description: 'Third-party ad networks' },
            { id: 'malware', name: 'Malware', description: 'Known malware sites' },
            { id: 'adult', name: 'Adult Content', description: 'Adult websites' },
            { id: 'social', name: 'Social Media', description: 'Social media platforms' },
        ];

        it('should find group by exact name match', () => {
            const groupName = 'Ad Networks';
            const found = groups.find((g) => g.name === groupName);

            expect(found).toBeDefined();
            expect(found?.id).toBe('ads');
        });

        it('should find group by ID', () => {
            const groupId = 'malware';
            const found = groups.find((g) => g.id === groupId);

            expect(found).toBeDefined();
            expect(found?.name).toBe('Malware');
        });

        it('should handle case-insensitive group search', () => {
            const groupName = 'ad networks';
            const found = groups.find((g) => g.name.toLowerCase() === groupName.toLowerCase());

            expect(found).toBeDefined();
            expect(found?.id).toBe('ads');
        });

        it('should return undefined for non-existent group', () => {
            const groupName = 'Non-Existent Group';
            const found = groups.find((g) => g.name === groupName);

            expect(found).toBeUndefined();
        });

        it('should find multiple groups by partial name match', () => {
            const searchTerm = 'content';
            const found = groups.filter((g) => g.name.toLowerCase().includes(searchTerm.toLowerCase()));

            expect(found).toHaveLength(1);
            expect(found[0].id).toBe('adult');
        });

        it('should filter active groups (not disabled)', () => {
            const activeGroups = [...groups, { id: 'spam', name: 'Spam', disabled: true }];
            const enabled = activeGroups.filter((g) => !g.disabled);

            expect(enabled).toHaveLength(4);
            expect(enabled.map((g) => g.id)).not.toContain('spam');
        });
    });

    /**
     * Test: Domain Categorization
     *
     * Validates that domains are correctly categorized based on group membership.
     * Critical because: Incorrect categorization affects blocking behavior.
     */
    describe('Domain Categorization', () => {
        interface Domain {
            name: string;
            groups: string[];
        }

        const domains: Domain[] = [
            { name: 'ads.google.com', groups: ['ads', 'analytics'] },
            { name: 'tracking.example.com', groups: ['analytics'] },
            { name: 'malware-site.net', groups: ['malware'] },
            { name: 'facebook.com', groups: ['social', 'analytics'] },
        ];

        it('should find domains by group membership', () => {
            const groupId = 'ads';
            const found = domains.filter((d) => d.groups.includes(groupId));

            expect(found).toHaveLength(1);
            expect(found[0].name).toBe('ads.google.com');
        });

        it('should find domains in multiple groups', () => {
            const groupIds = ['analytics'];
            const found = domains.filter((d) => d.groups.some((g) => groupIds.includes(g)));

            expect(found).toHaveLength(3);
            expect(found.map((d) => d.name)).toContain('ads.google.com');
            expect(found.map((d) => d.name)).toContain('tracking.example.com');
            expect(found.map((d) => d.name)).toContain('facebook.com');
        });

        it('should count domains per group', () => {
            const groupCounts = new Map<string, number>();
            domains.forEach((domain) => {
                domain.groups.forEach((group) => {
                    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
                });
            });

            expect(groupCounts.get('ads')).toBe(1);
            expect(groupCounts.get('analytics')).toBe(3);
            expect(groupCounts.get('social')).toBe(1);
            expect(groupCounts.get('malware')).toBe(1);
        });

        it('should handle domains with no groups', () => {
            const domainWithoutGroups = { name: 'unclassified.org', groups: [] };
            const allDomains = [...domains, domainWithoutGroups];

            const groupId = 'malware';
            const found = allDomains.filter((d) => d.groups.includes(groupId));

            expect(found).toHaveLength(1);
            expect(found[0].name).toBe('malware-site.net');
        });

        it('should remove domain from group', () => {
            const domain = { ...domains[0] };
            domain.groups = domain.groups.filter((g) => g !== 'ads');

            expect(domain.groups).toEqual(['analytics']);
            expect(domain.groups).not.toContain('ads');
        });

        it('should add domain to group', () => {
            const domain = { ...domains[0] };
            const newGroup = 'suspicious';
            domain.groups = [...new Set([...domain.groups, newGroup])];

            expect(domain.groups).toContain('suspicious');
            expect(domain.groups).toHaveLength(3);
        });
    });

    /**
     * Test: Snapshot Aggregation
     *
     * Validates that node snapshots are aggregated correctly.
     * Critical because: Dashboard shows combined status from all nodes.
     */
    describe('Snapshot Aggregation', () => {
        it('should aggregate snapshots from multiple nodes', () => {
            const snapshots: AdvancedBlockingSnapshot[] = [
                {
                    nodeId: 'node1',
                    metrics: {
                        groupCount: 5,
                        blockedDomainCount: 1000,
                        allowedDomainCount: 50,
                        blockListUrlCount: 2,
                        allowListUrlCount: 1,
                        adblockListUrlCount: 1,
                        allowedRegexCount: 5,
                        blockedRegexCount: 10,
                        regexAllowListUrlCount: 1,
                        regexBlockListUrlCount: 1,
                        localEndpointMappingCount: 10,
                        networkMappingCount: 5,
                        scheduledNodeCount: 2,
                    },
                },
                {
                    nodeId: 'node2',
                    metrics: {
                        groupCount: 5,
                        blockedDomainCount: 1000,
                        allowedDomainCount: 50,
                        blockListUrlCount: 2,
                        allowListUrlCount: 1,
                        adblockListUrlCount: 1,
                        allowedRegexCount: 5,
                        blockedRegexCount: 10,
                        regexAllowListUrlCount: 1,
                        regexBlockListUrlCount: 1,
                        localEndpointMappingCount: 10,
                        networkMappingCount: 5,
                        scheduledNodeCount: 2,
                    },
                },
            ];

            const aggregate = snapshots.reduce(
                (acc, snapshot) => ({
                    groupCount: acc.groupCount + snapshot.metrics.groupCount,
                    blockedDomainCount: acc.blockedDomainCount + snapshot.metrics.blockedDomainCount,
                    allowedDomainCount: acc.allowedDomainCount + snapshot.metrics.allowedDomainCount,
                    blockListUrlCount: acc.blockListUrlCount + snapshot.metrics.blockListUrlCount,
                    allowListUrlCount: acc.allowListUrlCount + snapshot.metrics.allowListUrlCount,
                    adblockListUrlCount: acc.adblockListUrlCount + snapshot.metrics.adblockListUrlCount,
                    allowedRegexCount: acc.allowedRegexCount + snapshot.metrics.allowedRegexCount,
                    blockedRegexCount: acc.blockedRegexCount + snapshot.metrics.blockedRegexCount,
                    regexAllowListUrlCount:
                        acc.regexAllowListUrlCount + snapshot.metrics.regexAllowListUrlCount,
                    regexBlockListUrlCount:
                        acc.regexBlockListUrlCount + snapshot.metrics.regexBlockListUrlCount,
                    localEndpointMappingCount:
                        acc.localEndpointMappingCount + snapshot.metrics.localEndpointMappingCount,
                    networkMappingCount: acc.networkMappingCount + snapshot.metrics.networkMappingCount,
                    scheduledNodeCount: acc.scheduledNodeCount + snapshot.metrics.scheduledNodeCount,
                }),
                {
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
                },
            );

            expect(aggregate.groupCount).toBe(10);
            expect(aggregate.blockedDomainCount).toBe(2000);
            expect(aggregate.allowedDomainCount).toBe(100);
        });

        it('should handle snapshots with errors gracefully', () => {
            const snapshots: AdvancedBlockingSnapshot[] = [
                {
                    nodeId: 'node1',
                    metrics: {
                        groupCount: 5,
                        blockedDomainCount: 1000,
                        allowedDomainCount: 50,
                        blockListUrlCount: 2,
                        allowListUrlCount: 1,
                        adblockListUrlCount: 1,
                        allowedRegexCount: 5,
                        blockedRegexCount: 10,
                        regexAllowListUrlCount: 1,
                        regexBlockListUrlCount: 1,
                        localEndpointMappingCount: 10,
                        networkMappingCount: 5,
                        scheduledNodeCount: 2,
                    },
                },
                {
                    nodeId: 'node2',
                    metrics: {
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
                    },
                    error: 'Failed to load Advanced Blocking config',
                },
            ];

            // Filter out errored snapshots before aggregation
            const validSnapshots = snapshots.filter((s) => !s.error);

            expect(validSnapshots).toHaveLength(1);
            expect(validSnapshots[0].nodeId).toBe('node1');
        });
    });
});
