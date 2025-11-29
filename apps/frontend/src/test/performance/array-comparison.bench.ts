/**
 * Array Comparison Performance Benchmarks
 *
 * Measures performance of compareStringArrays() and compareUrlArrays()
 * to validate that extracting to utils doesn't degrade performance.
 *
 * Run with: npm run test:bench
 */

import { bench, describe } from 'vitest';

// Current implementation (duplicated in ConfigurationPage.tsx and ConfigurationSyncView.tsx)
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

// Generate test data
function generateStringArray(size: number): string[] {
    return Array.from({ length: size }, (_, i) => `domain${i}.example.com`);
}

function generateUrlArray(size: number): string[] {
    return Array.from({ length: size }, (_, i) => `https://list${i}.example.com/blocklist.txt`);
}

describe('Array Comparison Performance', () => {
    describe('compareStringArrays - Identical Arrays', () => {
        bench('10 items', () => {
            const arr = generateStringArray(10);
            compareStringArrays(arr, [...arr]);
        });

        bench('100 items', () => {
            const arr = generateStringArray(100);
            compareStringArrays(arr, [...arr]);
        });

        bench('1,000 items', () => {
            const arr = generateStringArray(1000);
            compareStringArrays(arr, [...arr]);
        });

        bench('10,000 items', () => {
            const arr = generateStringArray(10000);
            compareStringArrays(arr, [...arr]);
        });
    });

    describe('compareStringArrays - Different Order', () => {
        bench('100 items (reversed)', () => {
            const arr = generateStringArray(100);
            const reversed = [...arr].reverse();
            compareStringArrays(arr, reversed);
        });

        bench('1,000 items (reversed)', () => {
            const arr = generateStringArray(1000);
            const reversed = [...arr].reverse();
            compareStringArrays(arr, reversed);
        });
    });

    describe('compareStringArrays - Different Content', () => {
        bench('1,000 items (early difference)', () => {
            const arr1 = generateStringArray(1000);
            const arr2 = [...arr1];
            arr2[0] = 'different.example.com';
            compareStringArrays(arr1, arr2);
        });

        bench('1,000 items (late difference)', () => {
            const arr1 = generateStringArray(1000);
            const arr2 = [...arr1];
            arr2[999] = 'different.example.com';
            compareStringArrays(arr1, arr2);
        });
    });

    describe('compareUrlArrays - Typical Blocklist Sizes', () => {
        bench('5 URLs (small group)', () => {
            const arr = generateUrlArray(5);
            compareUrlArrays(arr, [...arr]);
        });

        bench('25 URLs (medium group)', () => {
            const arr = generateUrlArray(25);
            compareUrlArrays(arr, [...arr]);
        });

        bench('100 URLs (large group)', () => {
            const arr = generateUrlArray(100);
            compareUrlArrays(arr, [...arr]);
        });
    });

    describe('Real-World Scenarios', () => {
        bench('Node1 vs Node2 sync check (50 groups × 20 domains)', () => {
            // Simulate checking 50 groups, each with ~20 domains
            const results: boolean[] = [];
            for (let i = 0; i < 50; i++) {
                const arr1 = generateStringArray(20);
                const arr2 = [...arr1];
                // 20% of groups have differences
                if (i % 5 === 0) {
                    arr2[0] = `modified${i}.example.com`;
                }
                results.push(compareStringArrays(arr1, arr2));
            }
        });

        bench('Badge calculation (10 groups with URL lists)', () => {
            // Simulate badge calculation checking multiple array types
            let differences = 0;
            for (let i = 0; i < 10; i++) {
                const blocked1 = generateStringArray(50);
                const blocked2 = [...blocked1];
                const urls1 = generateUrlArray(10);
                const urls2 = [...urls1];

                if (!compareStringArrays(blocked1, blocked2)) differences++;
                if (!compareUrlArrays(urls1, urls2)) differences++;
            }
            return differences; // Track differences for benchmark validation
        });
    });
});
