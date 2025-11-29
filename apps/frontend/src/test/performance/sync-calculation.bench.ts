/**
 * Sync Badge Calculation Performance Benchmarks
 *
 * Measures performance of the sync badge calculation logic
 * that compares configurations across nodes.
 *
 * Run with: npm run test:bench
 */

import { bench, describe } from 'vitest';

// Types
interface AdvancedBlockingGroup {
    name: string;
    enableBlocking?: boolean;
    allowTxtBlockingReport?: boolean;
    blockAsNxDomain?: boolean;
    blockingAddresses: string[];
    allowed: string[];
    blocked: string[];
    allowListUrls: string[];
    blockListUrls: string[];
    allowedRegex: string[];
    blockedRegex: string[];
    regexAllowListUrls: string[];
    regexBlockListUrls: string[];
    adblockListUrls: string[];
}

interface AdvancedBlockingConfig {
    enableBlocking?: boolean;
    blockListUrlUpdateIntervalHours?: number;
    localEndPointGroupMap: Record<string, string>;
    networkGroupMap: Record<string, string>;
    groups: AdvancedBlockingGroup[];
}

// Comparison functions
function compareStringArrays(arr1: string[], arr2: string[]): boolean {
    if (arr1.length !== arr2.length) return false;
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    return sorted1.every((v, i) => v === sorted2[i]);
}

function compareUrlArrays(arr1: string[], arr2: string[]): boolean {
    if (arr1.length !== arr2.length) return false;
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    return sorted1.every((v, i) => v === sorted2[i]);
}

// Badge calculation logic (simplified from ConfigurationPage.tsx)
function calculateSyncBadgeCount(
    config1: AdvancedBlockingConfig | null,
    config2: AdvancedBlockingConfig | null
): number {
    if (!config1 || !config2) return 0;

    const groups1 = config1.groups;
    const groups2 = config2.groups;

    const allGroupNames = new Set([
        ...groups1.map((g) => g.name),
        ...groups2.map((g) => g.name),
    ]);

    let differenceCount = 0;

    allGroupNames.forEach((groupName) => {
        const group1 = groups1.find((g) => g.name === groupName);
        const group2 = groups2.find((g) => g.name === groupName);

        if (!group1 || !group2) {
            differenceCount++;
        } else {
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
    });

    return differenceCount;
}

// Test data generators
function generateGroup(name: string, domainCount: number, urlCount: number): AdvancedBlockingGroup {
    return {
        name,
        enableBlocking: true,
        allowTxtBlockingReport: false,
        blockAsNxDomain: false,
        blockingAddresses: ['0.0.0.0'],
        blocked: Array.from({ length: domainCount }, (_, i) => `blocked${i}.${name}.com`),
        allowed: Array.from({ length: Math.floor(domainCount / 2) }, (_, i) => `allowed${i}.${name}.com`),
        blockedRegex: Array.from({ length: Math.floor(domainCount / 4) }, (_, i) => `.*\\.ads${i}\\.${name}\\.com$`),
        allowedRegex: Array.from({ length: Math.floor(domainCount / 8) }, (_, i) => `.*\\.safe${i}\\.${name}\\.com$`),
        blockListUrls: Array.from({ length: urlCount }, (_, i) => `https://list${i}.${name}.com/blocklist.txt`),
        allowListUrls: Array.from({ length: Math.floor(urlCount / 2) }, (_, i) => `https://list${i}.${name}.com/allowlist.txt`),
        regexBlockListUrls: Array.from({ length: Math.floor(urlCount / 2) }, (_, i) => `https://list${i}.${name}.com/regex-block.txt`),
        regexAllowListUrls: [],
        adblockListUrls: Array.from({ length: urlCount }, (_, i) => `https://list${i}.${name}.com/adblock.txt`),
    };
}

function generateConfig(groupCount: number, domainsPerGroup: number, urlsPerGroup: number): AdvancedBlockingConfig {
    return {
        enableBlocking: true,
        blockListUrlUpdateIntervalHours: 24,
        localEndPointGroupMap: {},
        networkGroupMap: {},
        groups: Array.from({ length: groupCount }, (_, i) => generateGroup(`group${i}`, domainsPerGroup, urlsPerGroup)),
    };
}

describe('Sync Badge Calculation Performance', () => {
    describe('Identical Configurations', () => {
        bench('5 groups (small setup)', () => {
            const config = generateConfig(5, 20, 5);
            calculateSyncBadgeCount(config, config);
        });

        bench('25 groups (typical setup)', () => {
            const config = generateConfig(25, 50, 10);
            calculateSyncBadgeCount(config, config);
        });

        bench('50 groups (large setup)', () => {
            const config = generateConfig(50, 100, 15);
            calculateSyncBadgeCount(config, config);
        });

        bench('100 groups (extreme setup)', () => {
            const config = generateConfig(100, 100, 10);
            calculateSyncBadgeCount(config, config);
        });
    });

    describe('Configurations with Differences', () => {
        bench('25 groups (5 different)', () => {
            const config1 = generateConfig(25, 50, 10);
            const config2 = generateConfig(25, 50, 10);
            // Make 5 groups different
            for (let i = 0; i < 5; i++) {
                config2.groups[i].blocked.push(`extra${i}.example.com`);
            }
            calculateSyncBadgeCount(config1, config2);
        });

        bench('50 groups (10 different)', () => {
            const config1 = generateConfig(50, 100, 15);
            const config2 = generateConfig(50, 100, 15);
            // Make 10 groups different
            for (let i = 0; i < 10; i++) {
                config2.groups[i].allowed.push(`extra${i}.example.com`);
            }
            calculateSyncBadgeCount(config1, config2);
        });

        bench('50 groups (all different)', () => {
            const config1 = generateConfig(50, 100, 15);
            const config2 = generateConfig(50, 100, 15);
            // Make all groups different
            config2.groups.forEach((g, i) => {
                g.blocked.push(`extra${i}.example.com`);
            });
            calculateSyncBadgeCount(config1, config2);
        });
    });

    describe('Real-World Node1/Node2 Scenarios', () => {
        bench('Production scenario (30 groups, mostly in sync)', () => {
            const node1Config = generateConfig(30, 75, 12);
            const node2Config = generateConfig(30, 75, 12);

            // Simulate realistic differences:
            // - 2 groups only on Node1
            node1Config.groups.push(generateGroup('node1-only-1', 10, 2));
            node1Config.groups.push(generateGroup('node1-only-2', 15, 3));

            // - 3 groups with minor differences
            node2Config.groups[5].blocked.push('extra-blocked.example.com');
            node2Config.groups[10].allowed.push('extra-allowed.example.com');
            node2Config.groups[15].blockListUrls.push('https://extra-list.com/blocklist.txt');

            calculateSyncBadgeCount(node1Config, node2Config);
        });

        bench('Heavy usage (50 groups, 1000 domains each)', () => {
            const config1 = generateConfig(50, 1000, 20);
            const config2 = generateConfig(50, 1000, 20);
            calculateSyncBadgeCount(config1, config2);
        });
    });

    describe('Edge Cases', () => {
        bench('Empty configurations', () => {
            const config: AdvancedBlockingConfig = {
                enableBlocking: true,
                blockListUrlUpdateIntervalHours: 24,
                localEndPointGroupMap: {},
                networkGroupMap: {},
                groups: [],
            };
            calculateSyncBadgeCount(config, config);
        });

        bench('One empty, one full (25 groups)', () => {
            const emptyConfig: AdvancedBlockingConfig = {
                enableBlocking: true,
                blockListUrlUpdateIntervalHours: 24,
                localEndPointGroupMap: {},
                networkGroupMap: {},
                groups: [],
            };
            const fullConfig = generateConfig(25, 50, 10);
            calculateSyncBadgeCount(emptyConfig, fullConfig);
        });
    });
});
