/**
 * Levenshtein Distance & Similarity Test Suite
 *
 * Tests for the Levenshtein distance algorithm and areSimilar() function
 * extracted to utils/levenshtein.ts.
 *
 * These functions are used in ConfigurationSyncView.tsx for detecting
 * domain modifications (purple badges). This ensures that modification
 * detection works correctly and doesn't falsely flag additions/removals.
 */

import { describe, it, expect } from 'vitest';
import { levenshteinDistance, areSimilar } from '../utils/levenshtein';

describe('Levenshtein Distance & Similarity', () => {
    describe('levenshteinDistance', () => {
        describe('🔴 CRITICAL: Basic Distance Calculations', () => {
            it('should return 0 for identical strings', () => {
                expect(levenshteinDistance('hello', 'hello')).toBe(0);
            });

            it('should return length for completely different strings', () => {
                expect(levenshteinDistance('abc', 'xyz')).toBe(3);
            });

            it('should return 1 for single character substitution', () => {
                expect(levenshteinDistance('cat', 'bat')).toBe(1);
            });

            it('should return 1 for single character insertion', () => {
                expect(levenshteinDistance('cat', 'cats')).toBe(1);
            });

            it('should return 1 for single character deletion', () => {
                expect(levenshteinDistance('cats', 'cat')).toBe(1);
            });

            it('should handle empty strings', () => {
                expect(levenshteinDistance('', '')).toBe(0);
                expect(levenshteinDistance('hello', '')).toBe(5);
                expect(levenshteinDistance('', 'world')).toBe(5);
            });
        });

        describe('🟡 HIGH: Complex Transformations', () => {
            it('should calculate distance for multiple operations', () => {
                // kitten -> sitten (substitution k->s)
                // sitten -> sittin (substitution e->i)
                // sittin -> sitting (insertion g)
                expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
            });

            it('should handle reversed strings', () => {
                expect(levenshteinDistance('abc', 'cba')).toBe(2);
            });

            it('should handle strings with repeated characters', () => {
                expect(levenshteinDistance('aaa', 'aab')).toBe(1);
                expect(levenshteinDistance('aaaa', 'aa')).toBe(2);
            });

            it('should be case-sensitive', () => {
                expect(levenshteinDistance('Hello', 'hello')).toBe(1);
            });
        });

        describe('🟡 HIGH: Domain Name Scenarios', () => {
            it('should calculate distance for similar domains', () => {
                expect(levenshteinDistance('example.com', 'example.org')).toBe(3);
            });

            it('should calculate distance for subdomain changes', () => {
                expect(levenshteinDistance('www.example.com', 'api.example.com')).toBe(3);
            });

            it('should calculate distance for typos', () => {
                expect(levenshteinDistance('gooogle.com', 'google.com')).toBe(1);
            });

            it('should handle regex pattern changes', () => {
                expect(levenshteinDistance(
                    '(\\.|^)cdn1\\.example\\.com$',
                    '(\\.|^)cdn2\\.example\\.com$'
                )).toBe(1);
            });
        });
    });

    describe('areSimilar', () => {
        describe('🔴 CRITICAL: 60% Threshold (Default)', () => {
            it('should return true for identical strings', () => {
                expect(areSimilar('example.com', 'example.com')).toBe(true);
            });

            it('should return true for 1-char difference in short domain (85% similar)', () => {
                // 'test.com' vs 'best.com' = 1 edit / 8 chars = 87.5% similar
                expect(areSimilar('test.com', 'best.com')).toBe(true);
            });

            it('should return true for subdomain change (78% similar)', () => {
                // 'www.example.com' vs 'api.example.com' = 3 edits / 15 chars = 80% similar
                expect(areSimilar('www.example.com', 'api.example.com')).toBe(true);
            });

            it('should return true for TLD change (75% similar)', () => {
                // 'example.com' vs 'example.org' = 3 edits / 11 chars = 72.7% similar
                expect(areSimilar('example.com', 'example.org')).toBe(true);
            });

            it('should return false for completely different domains', () => {
                expect(areSimilar('google.com', 'facebook.com')).toBe(false);
            });

            it('should return false for short strings with low similarity', () => {
                expect(areSimilar('abc', 'xyz')).toBe(false);
            });
        });

        describe('🔴 CRITICAL: Edge Cases for Modification Detection', () => {
            it('should detect typo corrections as modifications', () => {
                expect(areSimilar('gooogle.com', 'google.com')).toBe(true);
            });

            it('should detect number changes in CDN domains', () => {
                expect(areSimilar('cdn1.example.com', 'cdn2.example.com')).toBe(true);
            });

            it('should detect prefix additions', () => {
                expect(areSimilar('example.com', 'my-example.com')).toBe(true);
            });

            it('should NOT treat short to long additions as modifications', () => {
                // 'abc.com' vs 'verylongdomain.com' should be considered different, not modified
                expect(areSimilar('abc.com', 'verylongdomain.com')).toBe(false);
            });

            it('should handle empty string comparisons', () => {
                expect(areSimilar('', '')).toBe(true);
                expect(areSimilar('example.com', '')).toBe(false);
                expect(areSimilar('', 'example.com')).toBe(false);
            });
        });

        describe('🟡 HIGH: Custom Threshold Testing', () => {
            it('should respect 90% threshold for strict matching', () => {
                // 'example.com' vs 'example.org' = 72.7% similar
                expect(areSimilar('example.com', 'example.org', 0.9)).toBe(false);

                // 'test.com' vs 'best.com' = 87.5% similar
                expect(areSimilar('test.com', 'best.com', 0.9)).toBe(false);

                // 'example.com' vs 'example.co' = 90.9% similar
                expect(areSimilar('example.com', 'example.co', 0.9)).toBe(true);
            });

            it('should respect 40% threshold for loose matching', () => {
                // Even very different strings might match
                expect(areSimilar('example.com', 'exmpl.org', 0.4)).toBe(true);
            });

            it('should respect 100% threshold (exact match only)', () => {
                expect(areSimilar('example.com', 'example.com', 1.0)).toBe(true);
                expect(areSimilar('example.com', 'example.co', 1.0)).toBe(false);
            });
        });

        describe('🟡 HIGH: Regex Pattern Modifications', () => {
            it('should detect similar regex patterns', () => {
                expect(areSimilar(
                    '(\\.|^)cdn1\\.example\\.com$',
                    '(\\.|^)cdn2\\.example\\.com$'
                )).toBe(true);
            });

            it('should detect regex anchor changes', () => {
                expect(areSimilar(
                    '^example\\.com',
                    'example\\.com$'
                )).toBe(true);
            });

            it('should NOT match completely different patterns', () => {
                expect(areSimilar(
                    '(\\.|^)cdn\\..*\\.example\\.com$',
                    '^test\\.org$'
                )).toBe(false);
            });
        });

        describe('🟡 HIGH: Real-world Sync Scenarios', () => {
            it('should detect domain spelling correction as modification', () => {
                // User corrects typo in domain
                expect(areSimilar('faceboook.com', 'facebook.com')).toBe(true);
            });

            it('should detect version number changes as modification', () => {
                expect(areSimilar('api-v1.example.com', 'api-v2.example.com')).toBe(true);
            });

            it('should detect subdomain renames as modification', () => {
                expect(areSimilar('staging.example.com', 'prod.example.com')).toBe(true);
            });

            it('should NOT falsely flag additions as modifications', () => {
                // When a completely new domain is added, it should not be considered
                // a modification of an existing domain
                const existingDomains = ['google.com', 'facebook.com', 'twitter.com'];
                const newDomain = 'instagram.com';

                const isSimilarToAny = existingDomains.some(d => areSimilar(d, newDomain));
                expect(isSimilarToAny).toBe(false);
            });

            it('should NOT falsely flag removals as modifications', () => {
                const domain1 = 'example.com';
                const domain2 = 'completely-different-domain.net';

                expect(areSimilar(domain1, domain2)).toBe(false);
            });
        });

        describe('🟢 MEDIUM: Performance Considerations', () => {
            it('should handle long domains efficiently', () => {
                const longDomain1 = 'very-long-subdomain-name-with-many-parts.example.com';
                const longDomain2 = 'very-long-subdomain-name-with-some-parts.example.com';

                const start = performance.now();
                const result = areSimilar(longDomain1, longDomain2);
                const end = performance.now();

                expect(result).toBe(true);
                expect(end - start).toBeLessThan(10); // Should complete in < 10ms
            });

            it('should handle multiple comparisons efficiently', () => {
                const domains = Array.from({ length: 100 }, (_, i) => `domain${i}.com`);
                const testDomain = 'domain50.com';

                const start = performance.now();
                domains.forEach(d => areSimilar(d, testDomain));
                const end = performance.now();

                expect(end - start).toBeLessThan(100); // 100 comparisons in < 100ms
            });
        });
    });

    describe('🔴 CRITICAL: Integration with calculateDomainDiff', () => {
        it('should correctly identify modifications vs additions', () => {
            const oldDomains = ['example.com', 'test.org'];
            const newDomains = ['example.org', 'test.org']; // example.com modified to example.org

            // Simulate the modification detection logic
            const added: string[] = [];
            const modified: Array<{ oldValue: string; newValue: string }> = [];

            newDomains.forEach(newDomain => {
                const similarOldDomain = oldDomains.find(oldDomain =>
                    areSimilar(oldDomain, newDomain) && oldDomain !== newDomain
                );

                if (similarOldDomain) {
                    modified.push({ oldValue: similarOldDomain, newValue: newDomain });
                } else if (!oldDomains.includes(newDomain)) {
                    added.push(newDomain);
                }
            });

            expect(modified).toHaveLength(1);
            expect(modified[0]).toEqual({ oldValue: 'example.com', newValue: 'example.org' });
            expect(added).toHaveLength(0);
        });

        it('should correctly identify pure additions', () => {
            const oldDomains = ['example.com', 'test.org'];
            const newDomains = ['example.com', 'test.org', 'newsite.net'];

            const added = newDomains.filter(nd =>
                !oldDomains.includes(nd) &&
                !oldDomains.some(od => areSimilar(od, nd) && od !== nd)
            );

            expect(added).toEqual(['newsite.net']);
        });

        it('should correctly identify pure removals', () => {
            const oldDomains = ['example.com', 'test.org', 'oldsite.net'];
            const newDomains = ['example.com', 'test.org'];

            const removed = oldDomains.filter(od =>
                !newDomains.includes(od) &&
                !newDomains.some(nd => areSimilar(od, nd) && od !== nd)
            );

            expect(removed).toEqual(['oldsite.net']);
        });

        it('should handle complex diff with all three types', () => {
            const oldDomains = ['example.com', 'test.org', 'oldsite.net'];
            const newDomains = ['example.org', 'test.org', 'newsite.com'];

            // example.com -> example.org (modification)
            // oldsite.net removed
            // newsite.com added

            const added: string[] = [];
            const removed: string[] = [];
            const modified: Array<{ oldValue: string; newValue: string }> = [];

            // Find modifications and additions
            newDomains.forEach(newDomain => {
                const similarOldDomain = oldDomains.find(oldDomain =>
                    areSimilar(oldDomain, newDomain) && oldDomain !== newDomain
                );

                if (similarOldDomain) {
                    modified.push({ oldValue: similarOldDomain, newValue: newDomain });
                } else if (!oldDomains.includes(newDomain)) {
                    added.push(newDomain);
                }
            });

            // Find removals (excluding those that were modified)
            const modifiedOldValues = modified.map(m => m.oldValue);
            oldDomains.forEach(oldDomain => {
                if (!newDomains.includes(oldDomain) && !modifiedOldValues.includes(oldDomain)) {
                    const similarNewDomain = newDomains.find(nd =>
                        areSimilar(oldDomain, nd) && oldDomain !== nd
                    );
                    if (!similarNewDomain) {
                        removed.push(oldDomain);
                    }
                }
            });

            expect(modified).toEqual([{ oldValue: 'example.com', newValue: 'example.org' }]);
            expect(added).toEqual(['newsite.com']);
            expect(removed).toEqual(['oldsite.net']);
        });
    });
});
