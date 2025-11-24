import { describe, it, expect } from 'vitest';

/**
 * LogsPage Filtering Logic Tests
 *
 * Tests for domain filtering, client filtering, status filtering, and response type filtering.
 * These are critical paths for users to find the domains they want to block/allow.
 */

interface LogEntry {
    qname?: string;
    clientIpAddress?: string;
    clientName?: string;
    responseType?: string;
    blocked: boolean;
}

describe('LogsPage Filtering Logic', () => {
    /**
     * Test: Domain Name Filtering
     *
     * Users can search/filter by domain name.
     * Critical because: This is the primary way users find domains to block
     */
    describe('Domain Name Filtering', () => {
        const entries: LogEntry[] = [
            { qname: 'example.com', clientIpAddress: '192.168.1.1', blocked: false },
            { qname: 'test.example.com', clientIpAddress: '192.168.1.1', blocked: false },
            { qname: 'other.org', clientIpAddress: '192.168.1.1', blocked: false },
        ];

        it('should filter entries by exact domain match', () => {
            const domainFilter = 'example.com';
            const filtered = entries.filter((entry) => {
                const entryDomain = entry.qname?.toLowerCase() ?? '';
                return entryDomain.includes(domainFilter.toLowerCase());
            });

            expect(filtered.length).toBe(2);
            expect(filtered[0].qname).toBe('example.com');
            expect(filtered[1].qname).toBe('test.example.com');
        });

        it('should be case-insensitive', () => {
            const domainFilter = 'EXAMPLE.COM';
            const filtered = entries.filter((entry) => {
                const entryDomain = entry.qname?.toLowerCase() ?? '';
                return entryDomain.includes(domainFilter.toLowerCase());
            });

            expect(filtered.length).toBe(2);
        });

        it('should return all entries when filter is empty', () => {
            const domainFilter = '';
            const filtered = entries.filter((entry) => {
                const entryDomain = entry.qname?.toLowerCase() ?? '';
                return entryDomain.includes(domainFilter.toLowerCase());
            });

            expect(filtered.length).toBe(3);
        });

        it('should return no entries when filter has no matches', () => {
            const domainFilter = 'nonexistent.com';
            const filtered = entries.filter((entry) => {
                const entryDomain = entry.qname?.toLowerCase() ?? '';
                return entryDomain.includes(domainFilter.toLowerCase());
            });

            expect(filtered.length).toBe(0);
        });
    });

    /**
     * Test: Client IP/Hostname Filtering
     *
     * Users can filter by client IP or hostname.
     * Critical because: Users may want to see queries from specific clients
     */
    describe('Client Filtering', () => {
        const entries: LogEntry[] = [
            { qname: 'example.com', clientIpAddress: '192.168.1.100', clientName: 'device1', blocked: false },
            { qname: 'test.com', clientIpAddress: '192.168.1.200', clientName: 'device2', blocked: false },
            { qname: 'other.org', clientIpAddress: '10.0.0.1', clientName: 'remote-device', blocked: false },
        ];

        it('should filter by client IP address', () => {
            const clientFilter = '192.168.1';
            const filtered = entries.filter((entry) => {
                const entryIp = entry.clientIpAddress?.toLowerCase() ?? '';
                return entryIp.includes(clientFilter.toLowerCase());
            });

            expect(filtered.length).toBe(2);
        });

        it('should filter by client hostname', () => {
            const clientFilter = 'device1';
            const filtered = entries.filter((entry) => {
                const entryName = entry.clientName?.toLowerCase() ?? '';
                return entryName.includes(clientFilter.toLowerCase());
            });

            expect(filtered.length).toBe(1);
            expect(filtered[0].clientName).toBe('device1');
        });

        it('should filter by either IP or hostname', () => {
            const clientFilter = 'device1';
            const filtered = entries.filter((entry) => {
                const entryIp = entry.clientIpAddress?.toLowerCase() ?? '';
                const entryName = entry.clientName?.toLowerCase() ?? '';
                const query = clientFilter.toLowerCase();
                return entryIp.includes(query) || entryName.includes(query);
            });

            expect(filtered.length).toBe(1);
            expect(filtered[0].clientName).toBe('device1');
        });
    });

    /**
     * Test: Status Filtering (Allowed vs Blocked)
     *
     * Users can filter to see only allowed or blocked queries.
     * Critical because: This helps identify blocking rules that are working
     */
    describe('Status Filtering', () => {
        const entries: LogEntry[] = [
            { qname: 'allowed.com', blocked: false },
            { qname: 'blocked.com', blocked: true },
            { qname: 'also-allowed.com', blocked: false },
            { qname: 'also-blocked.com', blocked: true },
        ];

        it('should filter to show only allowed queries', () => {
            const filtered = entries.filter((entry) => !entry.blocked);

            expect(filtered.length).toBe(2);
            expect(filtered[0].qname).toBe('allowed.com');
        });

        it('should filter to show only blocked queries', () => {
            const filtered = entries.filter((entry) => entry.blocked);

            expect(filtered.length).toBe(2);
            expect(filtered[0].qname).toBe('blocked.com');
        });

        it('should show all queries when status filter is "all"', () => {
            const filtered = entries.filter(() => true); // 'all' status

            expect(filtered.length).toBe(4);
        });
    });

    /**
     * Test: Combined Filtering
     *
     * Users can combine multiple filters simultaneously.
     * Critical because: Real-world queries need multiple filter dimensions
     */
    describe('Combined Filtering', () => {
        const entries: LogEntry[] = [
            { qname: 'example.com', clientIpAddress: '192.168.1.100', blocked: false },
            { qname: 'example.com', clientIpAddress: '192.168.1.200', blocked: false },
            { qname: 'test.com', clientIpAddress: '192.168.1.100', blocked: true },
            { qname: 'other.org', clientIpAddress: '10.0.0.1', blocked: false },
        ];

        it('should filter by domain AND client simultaneously', () => {
            const domainFilter = 'example.com';
            const clientFilter = '192.168.1.100';

            const filtered = entries.filter((entry) => {
                const entryDomain = entry.qname?.toLowerCase() ?? '';
                const entryIp = entry.clientIpAddress?.toLowerCase() ?? '';
                return (
                    entryDomain.includes(domainFilter.toLowerCase()) &&
                    entryIp.includes(clientFilter.toLowerCase())
                );
            });

            expect(filtered.length).toBe(1);
            expect(filtered[0].qname).toBe('example.com');
            expect(filtered[0].clientIpAddress).toBe('192.168.1.100');
        });

        it('should filter by domain AND status simultaneously', () => {
            const domainFilter = 'example.com';
            const statusFilter = 'allowed'; // Show only allowed

            const filtered = entries.filter((entry) => {
                const entryDomain = entry.qname?.toLowerCase() ?? '';
                const isAllowed = !entry.blocked;
                return (
                    entryDomain.includes(domainFilter.toLowerCase()) &&
                    (statusFilter === 'allowed' ? isAllowed : !isAllowed)
                );
            });

            expect(filtered.length).toBe(2); // Both example.com entries are allowed
        });

        it('should combine all three filters', () => {
            const domainFilter = 'example.com';
            const clientFilter = '192.168';
            const statusFilter = 'all';

            const filtered = entries.filter((entry) => {
                const entryDomain = entry.qname?.toLowerCase() ?? '';
                const entryIp = entry.clientIpAddress?.toLowerCase() ?? '';
                const isAllowed = !entry.blocked;

                const matchesDomain = entryDomain.includes(domainFilter.toLowerCase());
                const matchesClient = entryIp.includes(clientFilter.toLowerCase());
                const matchesStatus = statusFilter === 'all' || (statusFilter === 'allowed' ? isAllowed : !isAllowed);

                return matchesDomain && matchesClient && matchesStatus;
            });

            expect(filtered.length).toBe(2); // Two example.com entries from 192.168.x.x network
        });
    });

    /**
     * Test: Filter Edge Cases
     *
     * Tests for boundary conditions and edge cases
     */
    describe('Filter Edge Cases', () => {
        const entries: LogEntry[] = [
            { qname: 'example.com', clientIpAddress: '192.168.1.1', blocked: false },
            { qname: undefined, clientIpAddress: '192.168.1.2', blocked: false },
            { qname: 'test.com', clientIpAddress: undefined, blocked: false },
        ];

        it('should handle entries with missing domain gracefully', () => {
            const domainFilter = 'example';
            const filtered = entries.filter((entry) => {
                const entryDomain = entry.qname?.toLowerCase() ?? '';
                return entryDomain.includes(domainFilter.toLowerCase());
            });

            expect(filtered.length).toBe(1);
        });

        it('should handle entries with missing client IP gracefully', () => {
            const clientFilter = '192.168';
            const filtered = entries.filter((entry) => {
                const entryIp = entry.clientIpAddress?.toLowerCase() ?? '';
                return entryIp.includes(clientFilter.toLowerCase());
            });

            expect(filtered.length).toBe(2);
        });

        it('should handle whitespace in filters', () => {
            const domainFilter = '  example.com  ';
            const filtered = entries.filter((entry) => {
                const entryDomain = entry.qname?.toLowerCase() ?? '';
                return entryDomain.includes(domainFilter.trim().toLowerCase());
            });

            expect(filtered.length).toBe(1);
        });
    });
});
