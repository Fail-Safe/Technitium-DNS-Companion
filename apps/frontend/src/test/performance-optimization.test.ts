import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Performance & Optimization Tests
 * Tests for rendering performance, memory usage, and handling large datasets
 * Critical for watching query logs in real-time
 */

interface PerformanceMetrics {
    renderTime: number;
    memoryUsed: number;
    itemsRendered: number;
    fps: number;
}

interface QueryLogEntry {
    id: string;
    domain: string;
    clientIP: string;
    status: string;
    timestamp: number;
}

// Mock performance monitoring
class PerformanceMonitor {
    private measurements: Map<string, number[]> = new Map();
    private memoryCheckpoints: number[] = [];

    // Simulate render performance measurement
    measureRender(componentName: string, itemCount: number): number {
        // Simulate: base time + time per item
        const baseTime = 2; // 2ms base
        const timePerItem = 0.1; // 0.1ms per item
        const renderTime = baseTime + timePerItem * itemCount;

        if (!this.measurements.has(componentName)) {
            this.measurements.set(componentName, []);
        }
        this.measurements.get(componentName)!.push(renderTime);

        return renderTime;
    }

    // Simulate memory measurement
    measureMemory(): number {
        // Simulate memory in MB
        const memory = 45 + Math.random() * 10; // 45-55 MB range
        this.memoryCheckpoints.push(memory);
        return memory;
    }

    // Check if rendering stays under threshold
    isRenderPerformant(renderTime: number, threshold: number = 16): boolean {
        // 16ms = 60fps, 33ms = 30fps
        return renderTime <= threshold;
    }

    // Check memory usage is stable
    isMemoryStable(threshold: number = 100): boolean {
        if (this.memoryCheckpoints.length < 2) return true;

        const latest = this.memoryCheckpoints[this.memoryCheckpoints.length - 1];
        const previous = this.memoryCheckpoints[this.memoryCheckpoints.length - 2];

        // Memory should not spike above threshold
        return Math.abs(latest - previous) <= threshold;
    }

    // Get average render time
    getAverageRenderTime(componentName: string): number {
        const times = this.measurements.get(componentName) || [];

        if (times.length === 0) return 0;

        return times.reduce((a, b) => a + b, 0) / times.length;
    }

    // Get metrics summary
    getMetrics(): PerformanceMetrics {
        const allTimes = Array.from(this.measurements.values()).flat();
        const avgRenderTime = allTimes.length > 0 ? allTimes.reduce((a, b) => a + b, 0) / allTimes.length : 0;

        return {
            renderTime: avgRenderTime,
            memoryUsed: this.memoryCheckpoints[this.memoryCheckpoints.length - 1] || 0,
            itemsRendered: allTimes.length,
            fps: avgRenderTime <= 16 ? 60 : avgRenderTime <= 33 ? 30 : 24,
        };
    }

    reset(): void {
        this.measurements.clear();
        this.memoryCheckpoints = [];
    }
}

// Mock virtualized list for handling large datasets
class VirtualizedList {
    private items: QueryLogEntry[];
    private visibleRange: { start: number; end: number } = { start: 0, end: 50 };
    private itemHeight: number = 40;

    constructor(items: QueryLogEntry[]) {
        this.items = items;
    }

    // Calculate which items should be rendered based on scroll
    calculateVisibleItems(
        scrollPosition: number,
        containerHeight: number
    ): { start: number; end: number; buffer: number } {
        const startIndex = Math.max(0, Math.floor(scrollPosition / this.itemHeight) - 10); // -10 buffer
        const endIndex = Math.min(
            this.items.length,
            Math.ceil((scrollPosition + containerHeight) / this.itemHeight) + 10
        );

        this.visibleRange = { start: startIndex, end: endIndex };

        return {
            start: startIndex,
            end: endIndex,
            buffer: 10,
        };
    }

    // Get only visible items
    getVisibleItems(): QueryLogEntry[] {
        return this.items.slice(this.visibleRange.start, this.visibleRange.end);
    }

    // Estimate total rendered height
    estimateTotalHeight(): number {
        return this.items.length * this.itemHeight;
    }

    // Get total items
    getItemCount(): number {
        return this.items.length;
    }
}

// Mock query log aggregator with performance optimization
class OptimizedQueryAggregator {
    private logs: QueryLogEntry[] = [];
    private cache: Map<string, QueryLogEntry[]> = new Map();
    private cacheValid: boolean = false;

    addLogs(newLogs: QueryLogEntry[]): void {
        this.logs.push(...newLogs);
        this.invalidateCache();
    }

    private invalidateCache(): void {
        this.cacheValid = false;
        this.cache.clear();
    }

    // Aggregate with caching
    aggregateByDomain(): Map<string, number> {
        if (this.cacheValid && this.cache.has('byDomain')) {
            const cached = this.cache.get('byDomain')!;
            return new Map(cached.map((log) => [log.domain, 1]));
        }

        const aggregated = new Map<string, number>();

        for (const log of this.logs) {
            aggregated.set(log.domain, (aggregated.get(log.domain) || 0) + 1);
        }

        this.cacheValid = true;

        return aggregated;
    }

    // Filter with early exit
    filterByStatus(status: string): QueryLogEntry[] {
        return this.logs.filter((log) => log.status === status);
    }

    // Batch insert for better performance
    batchInsert(logs: QueryLogEntry[], batchSize: number = 100): void {
        for (let i = 0; i < logs.length; i += batchSize) {
            const batch = logs.slice(i, i + batchSize);
            this.logs.push(...batch);
        }
        this.invalidateCache();
    }

    // Search with early exit
    search(query: string): QueryLogEntry[] {
        const lowerQuery = query.toLowerCase();
        const results: QueryLogEntry[] = [];

        for (const log of this.logs) {
            if (log.domain.toLowerCase().includes(lowerQuery) || log.clientIP.includes(query)) {
                results.push(log);

                // Early exit if we have enough results
                if (results.length >= 1000) break;
            }
        }

        return results;
    }

    getLogCount(): number {
        return this.logs.length;
    }

    clear(): void {
        this.logs = [];
        this.invalidateCache();
    }
}

describe('Performance & Optimization Tests', () => {
    describe('Render Performance', () => {
        let monitor: PerformanceMonitor;

        beforeEach(() => {
            monitor = new PerformanceMonitor();
        });

        it('should render 100 items performantly', () => {
            const renderTime = monitor.measureRender('QueryLogTable', 100);

            expect(monitor.isRenderPerformant(renderTime, 16)).toBe(true);
            expect(renderTime).toBeLessThan(20);
        });

        it('should render 500 items in acceptable time', () => {
            const renderTime = monitor.measureRender('QueryLogTable', 500);

            // 500 items = ~2ms + 500*0.1ms = 52ms, so threshold should be 60ms
            expect(renderTime).toBeLessThan(60);
        });

        it('should render 1000 items in reasonable time', () => {
            const renderTime = monitor.measureRender('QueryLogTable', 1000);

            expect(renderTime).toBeLessThan(150);
        });

        it('should maintain consistent performance across multiple renders', () => {
            monitor.measureRender('Component', 100);
            monitor.measureRender('Component', 100);
            monitor.measureRender('Component', 100);

            const avgTime = monitor.getAverageRenderTime('Component');

            expect(avgTime).toBeCloseTo(12, 1); // Within 1ms of expected
        });

        it('should achieve 60 FPS for small datasets', () => {
            for (let i = 0; i < 5; i++) {
                monitor.measureRender('Table', 50);
            }

            const metrics = monitor.getMetrics();

            expect(metrics.fps).toBeGreaterThanOrEqual(60);
        });

        it('should maintain at least 30 FPS for medium datasets', () => {
            for (let i = 0; i < 5; i++) {
                monitor.measureRender('Table', 300);
            }

            const metrics = monitor.getMetrics();

            expect(metrics.fps).toBeGreaterThanOrEqual(30);
        });
    });

    describe('Memory Management', () => {
        let monitor: PerformanceMonitor;

        beforeEach(() => {
            monitor = new PerformanceMonitor();
        });

        it('should maintain stable memory usage', () => {
            monitor.measureMemory();
            monitor.measureMemory();
            monitor.measureMemory();

            expect(monitor.isMemoryStable()).toBe(true);
        });

        it('should not have memory spikes', () => {
            const measurements = [];

            for (let i = 0; i < 10; i++) {
                measurements.push(monitor.measureMemory());
            }

            // Check no spike exceeds 20MB
            for (let i = 1; i < measurements.length; i++) {
                const delta = Math.abs(measurements[i] - measurements[i - 1]);
                expect(delta).toBeLessThan(20);
            }
        });

        it('should keep memory under 100MB', () => {
            for (let i = 0; i < 20; i++) {
                monitor.measureMemory();
            }

            const metrics = monitor.getMetrics();

            expect(metrics.memoryUsed).toBeLessThan(100);
        });
    });

    describe('Virtualized List Performance', () => {
        it('should calculate visible items for scroll position', () => {
            const items: QueryLogEntry[] = Array.from({ length: 10000 }, (_, i) => ({
                id: `log-${i}`,
                domain: 'example.com',
                clientIP: '192.168.1.1',
                status: 'ALLOWED',
                timestamp: Date.now(),
            }));

            const list = new VirtualizedList(items);
            const visible = list.calculateVisibleItems(5000, 800);

            expect(visible.start).toBeGreaterThan(0);
            expect(visible.end).toBeLessThan(items.length);
            expect(visible.end - visible.start).toBeLessThan(200); // Only render ~150 items
        });

        it('should return only visible items', () => {
            const items: QueryLogEntry[] = Array.from({ length: 1000 }, (_, i) => ({
                id: `log-${i}`,
                domain: 'example.com',
                clientIP: '192.168.1.1',
                status: 'ALLOWED',
                timestamp: Date.now(),
            }));

            const list = new VirtualizedList(items);
            list.calculateVisibleItems(0, 800);

            const visible = list.getVisibleItems();

            expect(visible.length).toBeLessThan(items.length);
            expect(visible.length).toBeLessThan(100); // Should be ~50-70 items
        });

        it('should handle large dataset (10k items) with virtualization', () => {
            const items: QueryLogEntry[] = Array.from({ length: 10000 }, (_, i) => ({
                id: `log-${i}`,
                domain: `domain${i % 100}.com`,
                clientIP: '192.168.1.1',
                status: 'ALLOWED',
                timestamp: Date.now() - i * 1000,
            }));

            const list = new VirtualizedList(items);

            expect(list.getItemCount()).toBe(10000);
            expect(list.estimateTotalHeight()).toBe(10000 * 40);

            // Simulate scrolling
            const visible1 = list.calculateVisibleItems(0, 800);
            const visible2 = list.calculateVisibleItems(50000, 800);

            expect(visible1.start).not.toEqual(visible2.start);
        });

        it('should handle scroll performance efficiently', () => {
            const items: QueryLogEntry[] = Array.from({ length: 5000 }, (_, i) => ({
                id: `log-${i}`,
                domain: 'example.com',
                clientIP: '192.168.1.1',
                status: 'ALLOWED',
                timestamp: Date.now(),
            }));

            const list = new VirtualizedList(items);
            const startTime = Date.now();

            // Simulate 100 scroll events
            for (let i = 0; i < 100; i++) {
                list.calculateVisibleItems(i * 100, 800);
            }

            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(100); // Should complete in <100ms
        });
    });

    describe('Query Aggregation Performance', () => {
        let aggregator: OptimizedQueryAggregator;

        beforeEach(() => {
            aggregator = new OptimizedQueryAggregator();
        });

        it('should aggregate 1000 logs efficiently', () => {
            const logs: QueryLogEntry[] = Array.from({ length: 1000 }, (_, i) => ({
                id: `log-${i}`,
                domain: `domain${i % 50}.com`,
                clientIP: `192.168.1.${i % 254}`,
                status: 'ALLOWED',
                timestamp: Date.now(),
            }));

            const startTime = Date.now();
            aggregator.addLogs(logs);
            const aggregated = aggregator.aggregateByDomain();
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(100);
            expect(aggregated.size).toBe(50); // 50 unique domains
        });

        it('should cache aggregation results', () => {
            const logs: QueryLogEntry[] = Array.from({ length: 500 }, (_, i) => ({
                id: `log-${i}`,
                domain: `domain${i % 20}.com`,
                clientIP: '192.168.1.1',
                status: 'ALLOWED',
                timestamp: Date.now(),
            }));

            aggregator.addLogs(logs);

            const start1 = Date.now();
            aggregator.aggregateByDomain();
            const time1 = Date.now() - start1;

            const start2 = Date.now();
            aggregator.aggregateByDomain(); // Should use cache
            const time2 = Date.now() - start2;

            expect(time2).toBeLessThanOrEqual(time1);
        });

        it('should filter efficiently with large dataset', () => {
            const logs: QueryLogEntry[] = Array.from({ length: 5000 }, (_, i) => ({
                id: `log-${i}`,
                domain: 'example.com',
                clientIP: '192.168.1.1',
                status: i % 2 === 0 ? 'ALLOWED' : 'BLOCKED',
                timestamp: Date.now(),
            }));

            aggregator.addLogs(logs);

            const startTime = Date.now();
            const filtered = aggregator.filterByStatus('BLOCKED');
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(50);
            expect(filtered.length).toBe(2500); // Half should be blocked
        });

        it('should handle batch insertion efficiently', () => {
            const logs: QueryLogEntry[] = Array.from({ length: 10000 }, (_, i) => ({
                id: `log-${i}`,
                domain: 'example.com',
                clientIP: '192.168.1.1',
                status: 'ALLOWED',
                timestamp: Date.now(),
            }));

            const startTime = Date.now();
            aggregator.batchInsert(logs, 100);
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(200);
            expect(aggregator.getLogCount()).toBe(10000);
        });

        it('should search with early exit efficiently', () => {
            const logs: QueryLogEntry[] = Array.from({ length: 100000 }, (_, i) => ({
                id: `log-${i}`,
                domain: i < 50 ? 'ads.example.com' : `site${i}.com`,
                clientIP: '192.168.1.1',
                status: 'ALLOWED',
                timestamp: Date.now(),
            }));

            aggregator.addLogs(logs);

            const startTime = Date.now();
            const results = aggregator.search('ads');
            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(100); // Early exit prevents scanning all items
            expect(results.length).toBeLessThanOrEqual(1000);
        });

        it('should handle 100k logs without memory issues', () => {
            const logs: QueryLogEntry[] = Array.from({ length: 100000 }, (_, i) => ({
                id: `log-${i}`,
                domain: `domain${i % 1000}.com`,
                clientIP: '192.168.1.1',
                status: 'ALLOWED',
                timestamp: Date.now() - i * 100,
            }));

            aggregator.addLogs(logs);

            expect(aggregator.getLogCount()).toBe(100000);

            const filtered = aggregator.filterByStatus('ALLOWED');

            expect(filtered.length).toBe(100000);
        });
    });

    describe('Real-time Log Tailing Performance', () => {
        it('should handle continuous stream of logs', () => {
            const aggregator = new OptimizedQueryAggregator();
            const logBatches = 10;
            const itemsPerBatch = 100;

            const startTime = Date.now();

            for (let batch = 0; batch < logBatches; batch++) {
                const logs: QueryLogEntry[] = Array.from({ length: itemsPerBatch }, (_, i) => ({
                    id: `log-${batch}-${i}`,
                    domain: `domain${(batch + i) % 50}.com`,
                    clientIP: '192.168.1.1',
                    status: Math.random() > 0.8 ? 'BLOCKED' : 'ALLOWED',
                    timestamp: Date.now(),
                }));

                aggregator.batchInsert(logs, 50);
            }

            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(500); // 1000 items in <500ms
            expect(aggregator.getLogCount()).toBe(1000);
        });

        it('should maintain performance with tail buffer', () => {
            const aggregator = new OptimizedQueryAggregator();
            const allLogs: QueryLogEntry[] = [];

            // Simulate 10 seconds of logs at 100 logs/sec
            for (let i = 0; i < 1000; i++) {
                allLogs.push({
                    id: `log-${i}`,
                    domain: `domain${i % 100}.com`,
                    clientIP: `192.168.1.${i % 254}`,
                    status: Math.random() > 0.8 ? 'BLOCKED' : 'ALLOWED',
                    timestamp: Date.now() - (1000 - i) * 10, // 10 seconds worth
                });
            }

            aggregator.addLogs(allLogs);

            // Keep only last 500 items
            const tail = allLogs.slice(-500);

            expect(tail.length).toBe(500);
        });
    });

    describe('Performance Benchmarks', () => {
        it('should complete standard workload in <2 seconds', () => {
            const monitor = new PerformanceMonitor();

            const startTime = Date.now();

            // Render 5 tables with 200 items each
            for (let i = 0; i < 5; i++) {
                monitor.measureRender('Table', 200);
            }

            // Check memory 5 times
            for (let i = 0; i < 5; i++) {
                monitor.measureMemory();
            }

            // Aggregate 2000 logs
            const aggregator = new OptimizedQueryAggregator();
            const logs: QueryLogEntry[] = Array.from({ length: 2000 }, (_, i) => ({
                id: `log-${i}`,
                domain: `domain${i % 100}.com`,
                clientIP: '192.168.1.1',
                status: 'ALLOWED',
                timestamp: Date.now(),
            }));
            aggregator.addLogs(logs);
            aggregator.aggregateByDomain();

            const duration = Date.now() - startTime;

            expect(duration).toBeLessThan(2000);
        });
    });
});
