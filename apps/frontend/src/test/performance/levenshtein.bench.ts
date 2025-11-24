/**
 * Levenshtein Distance Performance Benchmarks
 *
 * Measures performance of levenshteinDistance() and areSimilar()
 * from utils/levenshtein.ts to ensure modification detection
 * remains fast after refactoring.
 *
 * Run with: npm run test:bench
 */

import { bench, describe } from 'vitest';
import { levenshteinDistance, areSimilar } from '../../utils/levenshtein';

describe('Levenshtein Distance Performance', () => {
    describe('levenshteinDistance - Identical Strings', () => {
        bench('10 characters', () => {
            const str = 'example.com';
            levenshteinDistance(str, str);
        });

        bench('50 characters', () => {
            const str = 'subdomain.with.multiple.levels.example.com';
            levenshteinDistance(str, str);
        });

        bench('100 characters', () => {
            const str = 'very.long.subdomain.name.with.many.levels.for.testing.performance.of.algorithm.example.com';
            levenshteinDistance(str, str);
        });

        bench('200 characters', () => {
            const str = 'extremely.long.subdomain.name.with.many.many.levels.for.comprehensive.testing.of.performance.of.levenshtein.algorithm.in.production.environments.example.com.with.more.subdomains.added.here';
            levenshteinDistance(str, str);
        });
    });

    describe('levenshteinDistance - Small Differences', () => {
        bench('10 chars (1 char different)', () => {
            levenshteinDistance('example.com', 'example.net');
        });

        bench('50 chars (1 char different)', () => {
            levenshteinDistance(
                'subdomain.example.com',
                'subdomain.example.net'
            );
        });

        bench('50 chars (typo at start)', () => {
            levenshteinDistance(
                'cdn1.example.com',
                'cdn2.example.com'
            );
        });
    });

    describe('levenshteinDistance - Large Differences', () => {
        bench('Completely different (20 chars)', () => {
            levenshteinDistance(
                'google.com',
                'facebook.com'
            );
        });

        bench('Completely different (50 chars)', () => {
            levenshteinDistance(
                'subdomain.google.com',
                'different.facebook.com'
            );
        });
    });

    describe('areSimilar - Domain Name Scenarios', () => {
        bench('CDN number change (cdn1 → cdn2)', () => {
            areSimilar('cdn1.example.com', 'cdn2.example.com');
        });

        bench('Regex modification (added prefix)', () => {
            areSimilar(
                'cdn\\d+\\.example\\.com$',
                '(\\.|^)cdn\\d+\\.example\\.com$'
            );
        });

        bench('Minor typo fix', () => {
            areSimilar('gooogle.com', 'google.com');
        });

        bench('Subdomain added', () => {
            areSimilar('example.com', 'subdomain.example.com');
        });

        bench('Different domains (not similar)', () => {
            areSimilar('google.com', 'facebook.com');
        });
    });

    describe('Real-World Sync Scenarios', () => {
        bench('Check 100 domains for modifications', () => {
            const results: boolean[] = [];
            for (let i = 0; i < 100; i++) {
                const domain1 = `cdn${i}.example.com`;
                const domain2 = i % 10 === 0 ? `cdn${i + 1}.example.com` : domain1;
                results.push(areSimilar(domain1, domain2));
            }
        });

        bench('Detect modifications in 50-item diff', () => {
            const sourceList = Array.from({ length: 50 }, (_, i) => `domain${i}.example.com`);
            const targetList = sourceList.map((d, i) =>
                i % 5 === 0 ? d.replace('.com', '.net') : d
            );

            const modifications: Array<{ old: string; new: string }> = [];

            sourceList.forEach((source) => {
                targetList.forEach((target) => {
                    if (source !== target && areSimilar(source, target)) {
                        modifications.push({ old: source, new: target });
                    }
                });
            });
        });

        bench('Purple badge calculation (10 modified domains)', () => {
            // Simulate finding modifications between two lists
            const sourceList = ['cdn1.ex.com', 'cdn2.ex.com', 'cdn3.ex.com', 'ad.ex.com', 'tracking.ex.com'];
            const targetList = ['cdn1.ex.net', 'cdn2.ex.net', 'cdn3.ex.net', 'ad.ex.net', 'tracking.ex.net'];

            const modifications: number[] = [];

            sourceList.forEach((source) => {
                targetList.forEach((target) => {
                    if (areSimilar(source, target)) {
                        modifications.push(levenshteinDistance(source, target));
                    }
                });
            });
        });
    });
});
