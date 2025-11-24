/**
 * Performance benchmarking utilities for Technitium DNS API operations.
 *
 * Use these utilities to measure and compare performance before/after optimizations.
 * Results should be logged to console and optionally saved to benchmark reports.
 */

interface BenchmarkResult {
    operationName: string;
    timestamp: string;
    durationMs: number;
    memoryUsedMB?: number;
    metadata?: Record<string, unknown>;
}

interface CombinedLogsMetrics {
    totalDurationMs: number;
    fetchDurationMs: number;
    processingDurationMs: number;
    entriesFetched: number;
    entriesAfterFilter: number;
    entriesAfterDedup?: number;
    entriesReturned: number;
    nodeCount: number;
    cacheHit?: boolean;
    memoryUsedMB?: number;
}

/**
 * Decorator to benchmark a method execution time.
 * Logs results to console and optionally saves to array.
 */
export function Benchmark(operationName?: string) {
    return function (
        target: unknown,
        propertyKey: string,
        descriptor: PropertyDescriptor,
    ) {
        const originalMethod = descriptor.value;
        const opName = operationName || propertyKey;

        descriptor.value = async function (...args: unknown[]) {
            const startTime = performance.now();
            const startMemory = process.memoryUsage().heapUsed;

            try {
                const result = await originalMethod.apply(this, args);
                const endTime = performance.now();
                const endMemory = process.memoryUsage().heapUsed;
                const durationMs = endTime - startTime;
                const memoryUsedMB = (endMemory - startMemory) / 1024 / 1024;

                console.log(
                    `[BENCHMARK] ${opName}: ${durationMs.toFixed(2)}ms | Memory: ${memoryUsedMB.toFixed(2)}MB`,
                );

                return result;
            } catch (error) {
                const endTime = performance.now();
                const durationMs = endTime - startTime;
                console.error(
                    `[BENCHMARK] ${opName}: FAILED after ${durationMs.toFixed(2)}ms`,
                );
                throw error;
            }
        };

        return descriptor;
    };
}

/**
 * Manual benchmark wrapper for measuring specific code blocks.
 */
export class BenchmarkTimer {
    private startTime: number;
    private startMemory: number;
    private checkpoints: Array<{ name: string; time: number; memory: number }> = [];

    constructor(private operationName: string) {
        this.startTime = performance.now();
        this.startMemory = process.memoryUsage().heapUsed;
    }

    /**
     * Mark a checkpoint in the operation.
     */
    checkpoint(name: string): void {
        this.checkpoints.push({
            name,
            time: performance.now(),
            memory: process.memoryUsage().heapUsed,
        });
    }

    /**
     * Finish benchmark and log results.
     */
    end(metadata?: Record<string, unknown>): BenchmarkResult {
        const endTime = performance.now();
        const endMemory = process.memoryUsage().heapUsed;
        const durationMs = endTime - this.startTime;
        const memoryUsedMB = (endMemory - this.startMemory) / 1024 / 1024;

        // Log overall timing
        console.log(
            `\n[BENCHMARK] ${this.operationName}:`,
            `\n  Total: ${durationMs.toFixed(2)}ms`,
            `\n  Memory: ${memoryUsedMB.toFixed(2)}MB`,
        );

        // Log checkpoint details
        if (this.checkpoints.length > 0) {
            console.log(`  Checkpoints:`);
            let lastTime = this.startTime;
            let lastMemory = this.startMemory;

            for (const checkpoint of this.checkpoints) {
                const deltaDurationMs = checkpoint.time - lastTime;
                const deltaMemoryMB = (checkpoint.memory - lastMemory) / 1024 / 1024;
                console.log(
                    `    ${checkpoint.name}: +${deltaDurationMs.toFixed(2)}ms, +${deltaMemoryMB.toFixed(2)}MB`,
                );
                lastTime = checkpoint.time;
                lastMemory = checkpoint.memory;
            }
        }

        // Log metadata if provided
        if (metadata) {
            console.log(`  Metadata:`, metadata);
        }

        console.log(''); // Empty line for readability

        return {
            operationName: this.operationName,
            timestamp: new Date().toISOString(),
            durationMs,
            memoryUsedMB,
            metadata,
        };
    }
}

/**
 * Create a detailed benchmark report for getCombinedQueryLogs.
 */
export function benchmarkCombinedLogs(
    timer: BenchmarkTimer,
    metrics: CombinedLogsMetrics,
): BenchmarkResult {
    const metadata = {
        totalDurationMs: metrics.totalDurationMs,
        fetchDurationMs: metrics.fetchDurationMs,
        processingDurationMs: metrics.processingDurationMs,
        fetchPercentage: ((metrics.fetchDurationMs / metrics.totalDurationMs) * 100).toFixed(1) + '%',
        processingPercentage: ((metrics.processingDurationMs / metrics.totalDurationMs) * 100).toFixed(1) + '%',
        entriesFetched: metrics.entriesFetched,
        entriesAfterFilter: metrics.entriesAfterFilter,
        entriesAfterDedup: metrics.entriesAfterDedup,
        entriesReturned: metrics.entriesReturned,
        reductionRatio: metrics.entriesAfterDedup
            ? ((1 - metrics.entriesAfterDedup / metrics.entriesAfterFilter) * 100).toFixed(1) + '%'
            : 'N/A',
        nodeCount: metrics.nodeCount,
        cacheHit: metrics.cacheHit ?? false,
    };

    return timer.end(metadata);
}

/**
 * Simple performance measurement wrapper.
 */
export async function measureAsync<T>(
    operationName: string,
    operation: () => Promise<T>,
): Promise<T> {
    const timer = new BenchmarkTimer(operationName);
    try {
        const result = await operation();
        timer.end();
        return result;
    } catch (error) {
        timer.end({ error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}

/**
 * Run a benchmark multiple times and report statistics.
 */
export async function runBenchmarkSuite<T>(
    suiteName: string,
    operation: () => Promise<T>,
    iterations: number = 5,
): Promise<{
    min: number;
    max: number;
    avg: number;
    median: number;
    stdDev: number;
}> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Benchmark Suite: ${suiteName}`);
    console.log(`Iterations: ${iterations}`);
    console.log('='.repeat(60));

    const durations: number[] = [];

    for (let i = 0; i < iterations; i++) {
        console.log(`\nIteration ${i + 1}/${iterations}:`);
        const startTime = performance.now();
        await operation();
        const endTime = performance.now();
        const duration = endTime - startTime;
        durations.push(duration);
        console.log(`Duration: ${duration.toFixed(2)}ms`);
    }

    // Calculate statistics
    const sorted = [...durations].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const sum = durations.reduce((acc, d) => acc + d, 0);
    const avg = sum / durations.length;
    const median = sorted[Math.floor(sorted.length / 2)];

    // Standard deviation
    const variance = durations.reduce((acc, d) => acc + Math.pow(d - avg, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Results for ${suiteName}:`);
    console.log(`  Min:     ${min.toFixed(2)}ms`);
    console.log(`  Max:     ${max.toFixed(2)}ms`);
    console.log(`  Average: ${avg.toFixed(2)}ms`);
    console.log(`  Median:  ${median.toFixed(2)}ms`);
    console.log(`  Std Dev: ${stdDev.toFixed(2)}ms`);
    console.log('='.repeat(60) + '\n');

    return { min, max, avg, median, stdDev };
}
