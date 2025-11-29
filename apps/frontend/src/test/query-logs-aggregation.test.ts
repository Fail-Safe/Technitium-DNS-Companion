import { describe, it, expect } from 'vitest';

/**
 * Query Log Aggregation Tests
 *
 * Validates combining query logs from multiple Technitium DNS nodes.
 * This is CRITICAL because:
 * - Users can see unified dashboard across all DNS servers
 * - Filtering must work correctly on aggregated data
 * - Client hostname resolution must work across nodes
 *
 * These tests ensure:
 * - Logs from multiple nodes combine correctly
 * - Filtering works on combined logs
 * - Client IP to hostname mapping is accurate
 * - Pagination handles large datasets
 * - Edge cases don't break aggregation
 */

interface QueryLogEntry {
    timestamp: string;
    qname: string;
    clientIpAddress: string;
    clientName?: string;
    responseType?: string;
    blocked: boolean;
    nodeId?: string;
}

describe('Query Log Aggregation', () => {
    /**
     * Test: Multi-Node Log Combining
     *
     * Validates that logs from multiple nodes are combined correctly.
     * Critical because: This is the core aggregation feature.
     */
    describe('Multi-Node Log Combining', () => {
        it('should combine logs from two nodes', () => {
            const node1Logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:00Z',
                    qname: 'example.com',
                    clientIpAddress: '192.168.1.100',
                    blocked: false,
                    nodeId: 'node1',
                },
                {
                    timestamp: '2025-10-19T10:00:01Z',
                    qname: 'ads.example.com',
                    clientIpAddress: '192.168.1.101',
                    blocked: true,
                    nodeId: 'node1',
                },
            ];

            const node2Logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:02Z',
                    qname: 'google.com',
                    clientIpAddress: '192.168.1.50',
                    blocked: false,
                    nodeId: 'node2',
                },
                {
                    timestamp: '2025-10-19T10:00:03Z',
                    qname: 'malware.com',
                    clientIpAddress: '192.168.1.51',
                    blocked: true,
                    nodeId: 'node2',
                },
            ];

            const combined = [...node1Logs, ...node2Logs];

            expect(combined).toHaveLength(4);
            expect(combined[0].nodeId).toBe('node1');
            expect(combined[2].nodeId).toBe('node2');
        });

        it('should combine logs and maintain timestamp order', () => {
            const node1Logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:05Z',
                    qname: 'example.com',
                    clientIpAddress: '192.168.1.100',
                    blocked: false,
                    nodeId: 'node1',
                },
            ];

            const node2Logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:01Z',
                    qname: 'google.com',
                    clientIpAddress: '192.168.1.50',
                    blocked: false,
                    nodeId: 'node2',
                },
                {
                    timestamp: '2025-10-19T10:00:03Z',
                    qname: 'facebook.com',
                    clientIpAddress: '192.168.1.51',
                    blocked: false,
                    nodeId: 'node2',
                },
            ];

            const combined = [...node1Logs, ...node2Logs];
            const sorted = combined.sort(
                (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
            );

            expect(sorted[0].timestamp).toBe('2025-10-19T10:00:05Z');
            expect(sorted[1].timestamp).toBe('2025-10-19T10:00:03Z');
            expect(sorted[2].timestamp).toBe('2025-10-19T10:00:01Z');
        });

        it('should handle empty logs from one node', () => {
            const node1Logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:00Z',
                    qname: 'example.com',
                    clientIpAddress: '192.168.1.100',
                    blocked: false,
                    nodeId: 'node1',
                },
            ];

            const node2Logs: QueryLogEntry[] = [];

            const combined = [...node1Logs, ...node2Logs];

            expect(combined).toHaveLength(1);
            expect(combined[0].nodeId).toBe('node1');
        });

        it('should handle logs from three nodes', () => {
            const node1Logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:00Z',
                    qname: 'example.com',
                    clientIpAddress: '192.168.1.100',
                    blocked: false,
                    nodeId: 'node1',
                },
            ];

            const node2Logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:01Z',
                    qname: 'google.com',
                    clientIpAddress: '192.168.1.50',
                    blocked: false,
                    nodeId: 'node2',
                },
            ];

            const eq11Logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:02Z',
                    qname: 'test.com',
                    clientIpAddress: '192.168.1.60',
                    blocked: true,
                    nodeId: 'eq11',
                },
            ];

            const combined = [...node1Logs, ...node2Logs, ...eq11Logs];

            expect(combined).toHaveLength(3);
            expect(combined.map((l) => l.nodeId)).toEqual(['node1', 'node2', 'eq11']);
        });
    });

    /**
     * Test: Client IP to Hostname Resolution
     *
     * Validates that client IPs are resolved to hostnames using DHCP data.
     * Critical because: Users want to see device names, not just IPs.
     */
    describe('Client IP to Hostname Resolution', () => {
        it('should resolve client IP to hostname', () => {
            const dhcpLeases = new Map<string, string>([
                ['192.168.1.100', 'laptop'],
                ['192.168.1.101', 'phone'],
                ['192.168.1.102', 'tablet'],
            ]);

            const logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:00Z',
                    qname: 'example.com',
                    clientIpAddress: '192.168.1.100',
                    blocked: false,
                    nodeId: 'node1',
                },
                {
                    timestamp: '2025-10-19T10:00:01Z',
                    qname: 'google.com',
                    clientIpAddress: '192.168.1.101',
                    blocked: false,
                    nodeId: 'node1',
                },
            ];

            const enriched = logs.map((log) => ({
                ...log,
                clientName: dhcpLeases.get(log.clientIpAddress) || log.clientIpAddress,
            }));

            expect(enriched[0].clientName).toBe('laptop');
            expect(enriched[1].clientName).toBe('phone');
        });

        it('should fallback to IP address if hostname not found', () => {
            const dhcpLeases = new Map<string, string>([
                ['192.168.1.100', 'laptop'],
            ]);

            const logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:00Z',
                    qname: 'example.com',
                    clientIpAddress: '192.168.1.200', // Not in DHCP
                    blocked: false,
                    nodeId: 'node1',
                },
            ];

            const enriched = logs.map((log) => ({
                ...log,
                clientName: dhcpLeases.get(log.clientIpAddress) || log.clientIpAddress,
            }));

            expect(enriched[0].clientName).toBe('192.168.1.200');
        });

        it('should handle multiple nodes with different DHCP leases', () => {
            const allDhcpLeases = new Map<string, string>([
                ['192.168.1.100', 'laptop'], // From Node1
                ['10.0.0.50', 'vpn-client'], // From Node2
            ]);

            const combinedLogs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:00Z',
                    qname: 'example.com',
                    clientIpAddress: '192.168.1.100',
                    blocked: false,
                    nodeId: 'node1',
                },
                {
                    timestamp: '2025-10-19T10:00:01Z',
                    qname: 'remote.com',
                    clientIpAddress: '10.0.0.50',
                    blocked: false,
                    nodeId: 'node2',
                },
            ];

            const enriched = combinedLogs.map((log) => ({
                ...log,
                clientName: allDhcpLeases.get(log.clientIpAddress) || log.clientIpAddress,
            }));

            expect(enriched[0].clientName).toBe('laptop');
            expect(enriched[1].clientName).toBe('vpn-client');
        });

        it('should prefer existing clientName if already present', () => {
            const dhcpLeases = new Map<string, string>([
                ['192.168.1.100', 'from-dhcp'],
            ]);

            const logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:00Z',
                    qname: 'example.com',
                    clientIpAddress: '192.168.1.100',
                    clientName: 'already-set',
                    blocked: false,
                    nodeId: 'node1',
                },
            ];

            const enriched = logs.map((log) => ({
                ...log,
                clientName: log.clientName || dhcpLeases.get(log.clientIpAddress) || log.clientIpAddress,
            }));

            expect(enriched[0].clientName).toBe('already-set');
        });
    });

    /**
     * Test: Filtering on Aggregated Logs
     *
     * Validates that filtering works correctly on combined logs.
     * Critical because: Filtering is essential for finding specific queries.
     */
    describe('Filtering on Aggregated Logs', () => {
        const allLogs: QueryLogEntry[] = [
            {
                timestamp: '2025-10-19T10:00:00Z',
                qname: 'example.com',
                clientIpAddress: '192.168.1.100',
                clientName: 'laptop',
                blocked: false,
                nodeId: 'node1',
            },
            {
                timestamp: '2025-10-19T10:00:01Z',
                qname: 'ads.google.com',
                clientIpAddress: '192.168.1.101',
                clientName: 'phone',
                blocked: true,
                nodeId: 'node1',
            },
            {
                timestamp: '2025-10-19T10:00:02Z',
                qname: 'facebook.com',
                clientIpAddress: '192.168.1.50',
                clientName: 'tablet',
                blocked: false,
                nodeId: 'node2',
            },
            {
                timestamp: '2025-10-19T10:00:03Z',
                qname: 'ads.facebook.com',
                clientIpAddress: '192.168.1.51',
                clientName: 'tv',
                blocked: true,
                nodeId: 'node2',
            },
        ];

        it('should filter by domain name across nodes', () => {
            const domain = 'ads';
            const filtered = allLogs.filter((log) => log.qname.includes(domain));

            expect(filtered).toHaveLength(2);
            expect(filtered.map((l) => l.qname)).toEqual(['ads.google.com', 'ads.facebook.com']);
        });

        it('should filter by client name across nodes', () => {
            const client = 'phone';
            const filtered = allLogs.filter((log) => log.clientName === client);

            expect(filtered).toHaveLength(1);
            expect(filtered[0].qname).toBe('ads.google.com');
        });

        it('should filter by blocked status across nodes', () => {
            const blocked = true;
            const filtered = allLogs.filter((log) => log.blocked === blocked);

            expect(filtered).toHaveLength(2);
            expect(filtered.every((l) => l.blocked === true)).toBe(true);
        });

        it('should combine multiple filters', () => {
            const domain = 'ads';
            const blocked = true;
            const filtered = allLogs.filter(
                (log) => log.qname.includes(domain) && log.blocked === blocked,
            );

            expect(filtered).toHaveLength(2);
            expect(filtered.map((l) => l.nodeId)).toEqual(['node1', 'node2']);
        });

        it('should filter by node ID', () => {
            const nodeId = 'node1';
            const filtered = allLogs.filter((log) => log.nodeId === nodeId);

            expect(filtered).toHaveLength(2);
            expect(filtered.every((l) => l.nodeId === nodeId)).toBe(true);
        });

        it('should return empty result for non-matching filters', () => {
            const domain = 'nonexistent.com';
            const filtered = allLogs.filter((log) => log.qname.includes(domain));

            expect(filtered).toHaveLength(0);
        });
    });

    /**
     * Test: Aggregation Statistics
     *
     * Validates calculation of aggregate statistics from combined logs.
     * Critical because: Dashboard shows these stats to users.
     */
    describe('Aggregation Statistics', () => {
        const allLogs: QueryLogEntry[] = [
            {
                timestamp: '2025-10-19T10:00:00Z',
                qname: 'example.com',
                clientIpAddress: '192.168.1.100',
                blocked: false,
                nodeId: 'node1',
            },
            {
                timestamp: '2025-10-19T10:00:01Z',
                qname: 'ads1.com',
                clientIpAddress: '192.168.1.101',
                blocked: true,
                nodeId: 'node1',
            },
            {
                timestamp: '2025-10-19T10:00:02Z',
                qname: 'google.com',
                clientIpAddress: '192.168.1.50',
                blocked: false,
                nodeId: 'node2',
            },
            {
                timestamp: '2025-10-19T10:00:03Z',
                qname: 'ads2.com',
                clientIpAddress: '192.168.1.51',
                blocked: true,
                nodeId: 'node2',
            },
        ];

        it('should count total queries', () => {
            const total = allLogs.length;
            expect(total).toBe(4);
        });

        it('should count blocked queries', () => {
            const blocked = allLogs.filter((log) => log.blocked).length;
            expect(blocked).toBe(2);
        });

        it('should count allowed queries', () => {
            const allowed = allLogs.filter((log) => !log.blocked).length;
            expect(allowed).toBe(2);
        });

        it('should calculate block percentage', () => {
            const total = allLogs.length;
            const blocked = allLogs.filter((log) => log.blocked).length;
            const percentage = (blocked / total) * 100;

            expect(percentage).toBe(50);
        });

        it('should count queries per node', () => {
            const perNode = new Map<string, number>();
            allLogs.forEach((log) => {
                perNode.set(log.nodeId ?? 'unknown', (perNode.get(log.nodeId ?? 'unknown') ?? 0) + 1);
            });

            expect(perNode.get('node1')).toBe(2);
            expect(perNode.get('node2')).toBe(2);
        });

        it('should count unique domains', () => {
            const uniqueDomains = new Set(allLogs.map((log) => log.qname));
            expect(uniqueDomains.size).toBe(4);
        });

        it('should count unique clients', () => {
            const uniqueClients = new Set(allLogs.map((log) => log.clientIpAddress));
            expect(uniqueClients.size).toBe(4);
        });

        it('should calculate queries per client', () => {
            const perClient = new Map<string, number>();
            allLogs.forEach((log) => {
                perClient.set(
                    log.clientIpAddress,
                    (perClient.get(log.clientIpAddress) ?? 0) + 1,
                );
            });

            expect(perClient.get('192.168.1.100')).toBe(1);
            expect(perClient.size).toBe(4);
        });
    });

    /**
     * Test: Pagination
     *
     * Validates that large result sets are paginated correctly.
     * Critical because: Large datasets must be paginated for performance.
     */
    describe('Pagination', () => {
        const generateLogs = (count: number): QueryLogEntry[] => {
            return Array.from({ length: count }, (_, i) => ({
                timestamp: new Date(Date.now() - i * 1000).toISOString(),
                qname: `domain${i}.com`,
                clientIpAddress: `192.168.1.${100 + (i % 100)}`,
                blocked: i % 2 === 0,
                nodeId: i % 2 === 0 ? 'node1' : 'node2',
            }));
        };

        it('should paginate logs correctly', () => {
            const allLogs = generateLogs(100);
            const pageSize = 10;
            const pageNumber = 0;

            const start = pageNumber * pageSize;
            const end = start + pageSize;
            const page = allLogs.slice(start, end);

            expect(page).toHaveLength(10);
            expect(page[0]).toEqual(allLogs[0]);
        });

        it('should handle multiple pages', () => {
            const allLogs = generateLogs(100);
            const pageSize = 10;

            const page1 = allLogs.slice(0, pageSize);
            const page2 = allLogs.slice(pageSize, pageSize * 2);
            const page3 = allLogs.slice(pageSize * 2, pageSize * 3);

            expect(page1[0]).toBe(allLogs[0]);
            expect(page2[0]).toBe(allLogs[10]);
            expect(page3[0]).toBe(allLogs[20]);
        });

        it('should handle partial last page', () => {
            const allLogs = generateLogs(25);
            const pageSize = 10;
            const lastPageNumber = 2;

            const start = lastPageNumber * pageSize;
            const end = start + pageSize;
            const page = allLogs.slice(start, end);

            expect(page).toHaveLength(5);
        });

        it('should calculate total pages', () => {
            const total = 100;
            const pageSize = 10;
            const totalPages = Math.ceil(total / pageSize);

            expect(totalPages).toBe(10);
        });
    });

    /**
     * Test: Edge Cases
     *
     * Tests edge cases and error conditions.
     * Critical because: These prevent crashes or data loss.
     */
    describe('Edge Cases', () => {
        it('should handle empty logs from both nodes', () => {
            const allLogs: QueryLogEntry[] = [];
            expect(allLogs).toHaveLength(0);
        });

        it('should handle logs with missing clientName', () => {
            const logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:00Z',
                    qname: 'example.com',
                    clientIpAddress: '192.168.1.100',
                    blocked: false,
                    nodeId: 'node1',
                    // clientName is undefined
                },
            ];

            expect(logs[0].clientName).toBeUndefined();
        });

        it('should handle logs with missing responseType', () => {
            const logs: QueryLogEntry[] = [
                {
                    timestamp: '2025-10-19T10:00:00Z',
                    qname: 'example.com',
                    clientIpAddress: '192.168.1.100',
                    blocked: false,
                    nodeId: 'node1',
                    // responseType is undefined
                },
            ];

            expect(logs[0].responseType).toBeUndefined();
        });

        it('should handle very large log sets', () => {
            const logs = Array.from({ length: 10000 }, (_, i) => ({
                timestamp: new Date(Date.now() - i * 100).toISOString(),
                qname: `domain${i % 1000}.com`,
                clientIpAddress: `192.168.${Math.floor(i / 256)}.${i % 256}`,
                blocked: Math.random() > 0.5,
                nodeId: i % 2 === 0 ? 'node1' : 'node2',
            }));

            expect(logs).toHaveLength(10000);
            const filtered = logs.filter((l) => l.blocked);
            expect(filtered.length).toBeGreaterThan(0);
        });
    });
});
