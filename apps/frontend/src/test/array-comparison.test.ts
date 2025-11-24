/**
 * Array Comparison Functions Test Suite
 *
 * Tests for compareStringArrays() and compareUrlArrays() functions
 * extracted to utils/arrayComparison.ts.
 *
 * These tests ensure the utility functions work correctly for sync detection
 * and badge calculation logic across Technitium DNS nodes.
 */

import { describe, it, expect } from 'vitest';
import { compareStringArrays, compareUrlArrays } from '../utils/arrayComparison';

describe('Array Comparison Functions', () => {
    describe('compareStringArrays', () => {
        describe('🔴 CRITICAL: Basic Equality', () => {
            it('should return true for two empty arrays', () => {
                expect(compareStringArrays([], [])).toBe(true);
            });

            it('should return true for two identical arrays', () => {
                expect(compareStringArrays(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
            });

            it('should return true for arrays with same elements in different order', () => {
                expect(compareStringArrays(['c', 'a', 'b'], ['a', 'b', 'c'])).toBe(true);
            });

            it('should return false for arrays with different elements', () => {
                expect(compareStringArrays(['a', 'b', 'c'], ['a', 'b', 'd'])).toBe(false);
            });

            it('should return false for arrays with different lengths', () => {
                expect(compareStringArrays(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
            });
        });

        describe('🔴 CRITICAL: Undefined/Null Handling', () => {
            it('should return true when both arrays are undefined', () => {
                expect(compareStringArrays(undefined, undefined)).toBe(true);
            });

            it('should return false when first array is undefined', () => {
                expect(compareStringArrays(undefined, ['a'])).toBe(false);
            });

            it('should return false when second array is undefined', () => {
                expect(compareStringArrays(['a'], undefined)).toBe(false);
            });

            it('should return false when comparing empty array to undefined', () => {
                expect(compareStringArrays([], undefined)).toBe(false);
            });

            it('should return false when comparing undefined to empty array', () => {
                expect(compareStringArrays(undefined, [])).toBe(false);
            });
        });

        describe('🟡 HIGH: Edge Cases', () => {
            it('should handle arrays with duplicate values', () => {
                expect(compareStringArrays(['a', 'a', 'b'], ['a', 'b', 'a'])).toBe(true);
            });

            it('should detect differences with duplicate values', () => {
                expect(compareStringArrays(['a', 'a', 'b'], ['a', 'b', 'b'])).toBe(false);
            });

            it('should handle empty strings', () => {
                expect(compareStringArrays(['', 'a'], ['a', ''])).toBe(true);
            });

            it('should be case-sensitive', () => {
                expect(compareStringArrays(['A', 'b'], ['a', 'B'])).toBe(false);
            });

            it('should handle whitespace correctly', () => {
                expect(compareStringArrays([' a ', 'b'], ['a', ' b'])).toBe(false);
            });

            it('should handle special characters', () => {
                expect(compareStringArrays(['!@#$%', '^&*()'], ['^&*()', '!@#$%'])).toBe(true);
            });

            it('should handle unicode characters', () => {
                expect(compareStringArrays(['café', '日本語'], ['日本語', 'café'])).toBe(true);
            });

            it('should handle very long arrays efficiently', () => {
                const arr1 = Array.from({ length: 1000 }, (_, i) => `domain${i}.com`);
                const arr2 = [...arr1].reverse();
                expect(compareStringArrays(arr1, arr2)).toBe(true);
            });
        });

        describe('🟡 HIGH: Real-world Domain Scenarios', () => {
            it('should compare allowed domains correctly', () => {
                const domains1 = ['example.com', 'test.org', 'demo.net'];
                const domains2 = ['demo.net', 'example.com', 'test.org'];
                expect(compareStringArrays(domains1, domains2)).toBe(true);
            });

            it('should detect added domain', () => {
                const domains1 = ['example.com', 'test.org'];
                const domains2 = ['example.com', 'test.org', 'new.com'];
                expect(compareStringArrays(domains1, domains2)).toBe(false);
            });

            it('should detect removed domain', () => {
                const domains1 = ['example.com', 'test.org', 'old.com'];
                const domains2 = ['example.com', 'test.org'];
                expect(compareStringArrays(domains1, domains2)).toBe(false);
            });

            it('should handle regex patterns', () => {
                const patterns1 = ['(\\.|^)cdn\\d\\.example\\.com$', '^test.*\\.org$'];
                const patterns2 = ['^test.*\\.org$', '(\\.|^)cdn\\d\\.example\\.com$'];
                expect(compareStringArrays(patterns1, patterns2)).toBe(true);
            });
        });
    });

    describe('compareUrlArrays', () => {
        describe('🔴 CRITICAL: URL Normalization', () => {
            it('should be case-sensitive for URLs (production behavior)', () => {
                // Production uses exact string comparison for URL entries
                expect(compareUrlArrays(
                    ['https://Example.COM/path'],
                    ['https://example.com/path']
                )).toBe(false);
            });

            it('should handle protocol differences', () => {
                expect(compareUrlArrays(
                    ['https://example.com'],
                    ['http://example.com']
                )).toBe(false);
            });

            it('should handle trailing slashes', () => {
                // URL API normalizes trailing slashes
                expect(compareUrlArrays(
                    ['https://example.com/'],
                    ['https://example.com/']
                )).toBe(true);
            });

            it('should handle query parameters in order', () => {
                expect(compareUrlArrays(
                    ['https://example.com?a=1&b=2'],
                    ['https://example.com?a=1&b=2']
                )).toBe(true);
            });

            it('should detect different query parameter order (URL API preserves order)', () => {
                expect(compareUrlArrays(
                    ['https://example.com?a=1&b=2'],
                    ['https://example.com?b=2&a=1']
                )).toBe(false);
            });
        });

        describe('🔴 CRITICAL: String Entry Handling', () => {
            it('should handle plain strings (non-URL format)', () => {
                expect(compareUrlArrays(
                    ['not-a-url'],
                    ['not-a-url']
                )).toBe(true);
            });

            it('should handle mixed valid and invalid URLs', () => {
                expect(compareUrlArrays(
                    ['https://example.com', 'not-a-url'],
                    ['not-a-url', 'https://example.com']
                )).toBe(true);
            });

            it('should be case-sensitive for string entries (production behavior)', () => {
                // Production uses exact string comparison
                expect(compareUrlArrays(
                    ['NOT-A-URL'],
                    ['not-a-url']
                )).toBe(false);
            });
        });

        describe('🟡 HIGH: Real-world Blocklist Scenarios', () => {
            it('should compare blocklist URLs correctly (order-independent)', () => {
                const urls1 = [
                    'https://raw.githubusercontent.com/user/repo/main/list1.txt',
                    'https://example.com/blocklist.txt'
                ];
                const urls2 = [
                    'https://example.com/blocklist.txt',
                    'https://raw.githubusercontent.com/user/repo/main/list1.txt'
                ];
                expect(compareUrlArrays(urls1, urls2)).toBe(true);
            });

            it('should detect added blocklist URL', () => {
                const urls1 = ['https://example.com/list1.txt'];
                const urls2 = ['https://example.com/list1.txt', 'https://example.com/list2.txt'];
                expect(compareUrlArrays(urls1, urls2)).toBe(false);
            });

            it('should handle URLs with ports', () => {
                expect(compareUrlArrays(
                    ['https://example.com:8080/list.txt'],
                    ['https://example.com:8080/list.txt']
                )).toBe(true);
            });

            it('should detect different ports', () => {
                expect(compareUrlArrays(
                    ['https://example.com:8080/list.txt'],
                    ['https://example.com:9090/list.txt']
                )).toBe(false);
            });
        });

        describe('🟡 HIGH: Edge Cases', () => {
            it('should handle empty arrays', () => {
                expect(compareUrlArrays([], [])).toBe(true);
            });

            it('should handle undefined arrays', () => {
                expect(compareUrlArrays(undefined, undefined)).toBe(true);
            });

            it('should handle one undefined array', () => {
                expect(compareUrlArrays(['https://example.com'], undefined)).toBe(false);
            });

            it('should handle duplicate URLs', () => {
                expect(compareUrlArrays(
                    ['https://example.com', 'https://example.com'],
                    ['https://example.com', 'https://example.com']
                )).toBe(true);
            });

            it('should handle URLs with anchors', () => {
                expect(compareUrlArrays(
                    ['https://example.com#anchor'],
                    ['https://example.com#anchor']
                )).toBe(true);
            });

            it('should detect different anchors', () => {
                expect(compareUrlArrays(
                    ['https://example.com#anchor1'],
                    ['https://example.com#anchor2']
                )).toBe(false);
            });
        });
    });

    describe('🔴 CRITICAL: Integration with Sync Detection', () => {
        it('should correctly detect no changes in zone configuration', () => {
            // Simulate zone configuration comparison
            const zone1Allowed = ['example.com', 'test.org'];
            const zone2Allowed = ['test.org', 'example.com'];
            const zone1Blocked = ['ads.com', 'trackers.net'];
            const zone2Blocked = ['trackers.net', 'ads.com'];

            expect(compareStringArrays(zone1Allowed, zone2Allowed)).toBe(true);
            expect(compareStringArrays(zone1Blocked, zone2Blocked)).toBe(true);
        });

        it('should correctly detect changes in zone configuration', () => {
            const zone1Allowed = ['example.com', 'test.org'];
            const zone2Allowed = ['example.com', 'test.org', 'new.com'];

            expect(compareStringArrays(zone1Allowed, zone2Allowed)).toBe(false);
        });

        it('should correctly detect blocklist URL changes', () => {
            const node1Lists = ['https://example.com/list1.txt', 'https://example.com/list2.txt'];
            const node2Lists = ['https://example.com/list2.txt', 'https://example.com/list3.txt'];

            expect(compareUrlArrays(node1Lists, node2Lists)).toBe(false);
        });
    });
});
