import { Test, TestingModule } from '@nestjs/testing';
import { TechnitiumService } from './technitium.service';
import { TechnitiumModule } from './technitium.module';
import { runBenchmarkSuite } from './technitium.benchmark';
import type { TechnitiumQueryLogFilters } from './technitium.types';

/**
 * Performance benchmark script for getCombinedQueryLogs.
 *
 * Run with: npm run test:benchmark
 *
 * Measures:
 * - Cold request (first call, no cache)
 * - Warm request (subsequent calls)
 * - Deduplication on/off comparison
 * - Different page sizes
 * - Different entry counts per node
 */

describe('TechnitiumService Performance Benchmarks', () => {
    let service: TechnitiumService;

    beforeAll(async () => {
        // Validate environment configuration
        const nodes = process.env.TECHNITIUM_NODES;
        if (!nodes) {
            throw new Error(
                'TECHNITIUM_NODES environment variable not set. ' +
                'Set it to comma-separated node IDs (e.g., "node1,node2")',
            );
        }

        // Use the TechnitiumModule which handles node configuration from environment
        const module: TestingModule = await Test.createTestingModule({
            imports: [TechnitiumModule],
        }).compile();

        service = module.get<TechnitiumService>(TechnitiumService);
    });    // Skip benchmarks in CI or if explicitly disabled
    const shouldSkip = process.env.CI === 'true' || process.env.SKIP_BENCHMARKS === 'true';
    const describeOrSkip = shouldSkip ? describe.skip : describe;

    describeOrSkip('Baseline Performance', () => {
        it('should benchmark cold request (no dedup)', async () => {
            const filters: TechnitiumQueryLogFilters = {
                pageNumber: 1,
                entriesPerPage: 50,
                deduplicateDomains: false,
            };

            await runBenchmarkSuite(
                'getCombinedQueryLogs - Cold Request - No Dedup',
                () => service.getCombinedQueryLogs(filters),
                3, // Run 3 times
            );
        }, 60000); // 60s timeout

        it('should benchmark cold request (with dedup)', async () => {
            const filters: TechnitiumQueryLogFilters = {
                pageNumber: 1,
                entriesPerPage: 50,
                deduplicateDomains: true,
            };

            await runBenchmarkSuite(
                'getCombinedQueryLogs - Cold Request - With Dedup',
                () => service.getCombinedQueryLogs(filters),
                3,
            );
        }, 60000);

        it('should benchmark warm requests (no dedup)', async () => {
            const filters: TechnitiumQueryLogFilters = {
                pageNumber: 1,
                entriesPerPage: 50,
                deduplicateDomains: false,
            };

            // Prime the cache with one call
            await service.getCombinedQueryLogs(filters);

            // Now benchmark subsequent calls
            await runBenchmarkSuite(
                'getCombinedQueryLogs - Warm Request - No Dedup',
                () => service.getCombinedQueryLogs(filters),
                5,
            );
        }, 60000);

        it('should benchmark warm requests (with dedup)', async () => {
            const filters: TechnitiumQueryLogFilters = {
                pageNumber: 1,
                entriesPerPage: 50,
                deduplicateDomains: true,
            };

            // Prime the cache
            await service.getCombinedQueryLogs(filters);

            // Benchmark subsequent calls
            await runBenchmarkSuite(
                'getCombinedQueryLogs - Warm Request - With Dedup',
                () => service.getCombinedQueryLogs(filters),
                5,
            );
        }, 60000);

        it('should benchmark large page size (100 entries)', async () => {
            const filters: TechnitiumQueryLogFilters = {
                pageNumber: 1,
                entriesPerPage: 100,
                deduplicateDomains: true,
            };

            await runBenchmarkSuite(
                'getCombinedQueryLogs - Large Page (100 entries)',
                () => service.getCombinedQueryLogs(filters),
                3,
            );
        }, 60000);

        it('should benchmark pagination (page 5)', async () => {
            const filters: TechnitiumQueryLogFilters = {
                pageNumber: 5,
                entriesPerPage: 50,
                deduplicateDomains: true,
            };

            await runBenchmarkSuite(
                'getCombinedQueryLogs - Page 5 (with over-fetch)',
                () => service.getCombinedQueryLogs(filters),
                3,
            );
        }, 60000);

        it('should benchmark with filters', async () => {
            const filters: TechnitiumQueryLogFilters = {
                pageNumber: 1,
                entriesPerPage: 50,
                deduplicateDomains: true,
                domain: 'google',
                responseType: 'Allowed',
                qtype: 'A',
            };

            await runBenchmarkSuite(
                'getCombinedQueryLogs - With Filters',
                () => service.getCombinedQueryLogs(filters),
                3,
            );
        }, 60000);
    });

    describeOrSkip('Memory Usage', () => {
        it('should measure memory impact of large result set', async () => {
            const filters: TechnitiumQueryLogFilters = {
                pageNumber: 1,
                entriesPerPage: 200,
                deduplicateDomains: true,
            };

            const startHeap = process.memoryUsage().heapUsed;
            console.log(`\nStarting heap: ${(startHeap / 1024 / 1024).toFixed(2)}MB`);

            await service.getCombinedQueryLogs(filters);

            const endHeap = process.memoryUsage().heapUsed;
            console.log(`Ending heap: ${(endHeap / 1024 / 1024).toFixed(2)}MB`);
            console.log(`Memory delta: ${((endHeap - startHeap) / 1024 / 1024).toFixed(2)}MB\n`);

            // Force GC if available (run node with --expose-gc flag)
            if (global.gc) {
                global.gc();
                const afterGC = process.memoryUsage().heapUsed;
                console.log(`After GC: ${(afterGC / 1024 / 1024).toFixed(2)}MB`);
                console.log(`Retained: ${((afterGC - startHeap) / 1024 / 1024).toFixed(2)}MB\n`);
            }
        }, 60000);
    });
});
