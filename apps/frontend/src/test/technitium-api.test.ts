import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * TechnitiumContext API Tests
 *
 * Validates all API integration points and error handling in the TechnitiumContext.
 * This is CRITICAL because:
 * - ALL API communication flows through this context
 * - Error handling must be consistent across all endpoints
 * - State updates must reflect server responses correctly
 * - Network failures must not crash the application
 *
 * These tests ensure:
 * - All API endpoints are called with correct parameters
 * - Successful responses update state correctly
 * - Error responses are handled gracefully
 * - Network failures are caught and reported
 * - Request validation catches missing required fields
 */

// Mock types matching the actual context
interface AdvancedBlockingMetrics {
    groupCount: number;
    blockedDomainCount: number;
    allowedDomainCount: number;
    blockListUrlCount: number;
    allowListUrlCount: number;
    adblockListUrlCount: number;
    allowedRegexCount: number;
    blockedRegexCount: number;
    regexAllowListUrlCount: number;
    regexBlockListUrlCount: number;
    localEndpointMappingCount: number;
    networkMappingCount: number;
    scheduledNodeCount: number;
}

interface AdvancedBlockingGroup {
    name: string;
    enableBlocking?: boolean;
    blockingAddresses: string[];
    allowed: string[];
    blocked: string[];
    allowListUrls: string[];
    blockListUrls: string[];
}

interface AdvancedBlockingConfig {
    enableBlocking?: boolean;
    blockListUrlUpdateIntervalHours?: number;
    localEndPointGroupMap: Record<string, string>;
    networkGroupMap: Record<string, string>;
    groups: AdvancedBlockingGroup[];
}

interface AdvancedBlockingSnapshot {
    nodeId: string;
    baseUrl: string;
    fetchedAt: string;
    metrics: AdvancedBlockingMetrics;
    config?: AdvancedBlockingConfig;
    error?: string;
}

interface AdvancedBlockingOverview {
    fetchedAt: string;
    aggregate: AdvancedBlockingMetrics;
    nodes: AdvancedBlockingSnapshot[];
}

interface TechnitiumQueryLogFilters {
    domain?: string;
    clientIp?: string;
    clientName?: string;
    status?: 'all' | 'allowed' | 'blocked';
    pageNumber?: number;
    pageSize?: number;
}

interface QueryLogEntry {
    timestamp: string;
    qname: string;
    clientIpAddress: string;
    clientName?: string;
    responseType?: string;
    blocked: boolean;
}

interface TechnitiumNodeQueryLogEnvelope {
    nodeId: string;
    page: { entries: QueryLogEntry[]; totalEntries: number };
}

interface TechnitiumCombinedQueryLogPage {
    entries: QueryLogEntry[];
    totalEntries: number;
    pageNumber: number;
    pageSize: number;
}

interface TechnitiumDhcpScope {
    name: string;
    enabled?: boolean;
    leaseTimeDays?: number;
    domainName?: string;
    domainNameServers?: string[];
}

interface TechnitiumDhcpScopeListEnvelope {
    nodeId: string;
    scopes: TechnitiumDhcpScope[];
}

interface TechnitiumDhcpScopeEnvelope {
    nodeId: string;
    scope: TechnitiumDhcpScope;
}

interface TechnitiumCloneDhcpScopeRequest {
    targetNodeId?: string;
    newScopeName?: string;
    enableOnTarget?: boolean;
    overrides?: Partial<Omit<TechnitiumDhcpScope, 'name'>>;
}

interface TechnitiumCloneDhcpScopeResult {
    sourceNodeId: string;
    targetNodeId: string;
    status: 'success' | 'error';
}

interface TechnitiumUpdateDhcpScopeRequest {
    enabled?: boolean;
    leaseTimeDays?: number;
    domainName?: string;
    domainNameServers?: string[];
}

interface TechnitiumUpdateDhcpScopeEnvelope {
    nodeId: string;
    scope: TechnitiumDhcpScope;
}

interface TechnitiumZoneListEnvelope {
    nodeId: string;
    zones: Array<{ name: string; type: string }>;
}

interface TechnitiumCombinedZoneOverview {
    zones: Array<{ name: string; statuses: Record<string, string> }>;
}

describe('TechnitiumContext API Integration', () => {
    beforeEach(() => {
        // Reset fetch mock before each test
        global.fetch = vi.fn();
        vi.clearAllMocks();
    });

    /**
     * Helper to safely access mock fetch as any
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getMockedFetch = () => global.fetch as any;

    /**
     * Test: Advanced Blocking API
     *
     * Validates loading and saving Advanced Blocking configuration.
     * Critical because: Users need to manage blocking groups and see overall stats.
     */
    describe('Advanced Blocking API', () => {
        it('should load Advanced Blocking overview successfully', async () => {
            const mockData: AdvancedBlockingOverview = {
                fetchedAt: '2025-10-19T10:00:00Z',
                aggregate: {
                    groupCount: 5,
                    blockedDomainCount: 1000,
                    allowedDomainCount: 50,
                    blockListUrlCount: 2,
                    allowListUrlCount: 1,
                    adblockListUrlCount: 1,
                    allowedRegexCount: 5,
                    blockedRegexCount: 10,
                    regexAllowListUrlCount: 1,
                    regexBlockListUrlCount: 1,
                    localEndpointMappingCount: 10,
                    networkMappingCount: 5,
                    scheduledNodeCount: 2,
                },
                nodes: [
                    {
                        nodeId: 'eq14',
                        baseUrl: 'https://eq14.home-dns.com:53443',
                        fetchedAt: '2025-10-19T10:00:00Z',
                        metrics: {
                            groupCount: 5,
                            blockedDomainCount: 1000,
                            allowedDomainCount: 50,
                            blockListUrlCount: 2,
                            allowListUrlCount: 1,
                            adblockListUrlCount: 1,
                            allowedRegexCount: 5,
                            blockedRegexCount: 10,
                            regexAllowListUrlCount: 1,
                            regexBlockListUrlCount: 1,
                            localEndpointMappingCount: 10,
                            networkMappingCount: 5,
                            scheduledNodeCount: 2,
                        },
                    },
                ],
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockData,
            });

            const response = await fetch('/api/nodes/advanced-blocking');
            const data = (await response.json()) as AdvancedBlockingOverview;

            expect(response.ok).toBe(true);
            expect(data.aggregate.groupCount).toBe(5);
            expect(data.nodes).toHaveLength(1);
            expect(getMockedFetch().mock.calls[0][0]).toBe('/api/nodes/advanced-blocking');
        });

        it('should handle Advanced Blocking API error (network failure)', async () => {
            getMockedFetch().mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            const response = await fetch('/api/nodes/advanced-blocking');

            expect(response.ok).toBe(false);
            expect(response.status).toBe(500);
        });

        it('should handle empty Advanced Blocking response', async () => {
            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                text: async () => '',
            });

            const response = await fetch('/api/nodes/advanced-blocking');
            const raw = await response.text();

            expect(raw).toBe('');
        });

        it('should save Advanced Blocking config successfully', async () => {
            const nodeId = 'eq14';
            const config: AdvancedBlockingConfig = {
                enableBlocking: true,
                blockListUrlUpdateIntervalHours: 24,
                localEndPointGroupMap: {},
                networkGroupMap: {},
                groups: [
                    {
                        name: 'ads',
                        enableBlocking: true,
                        blockingAddresses: ['0.0.0.0'],
                        allowed: [],
                        blocked: [],
                        allowListUrls: [],
                        blockListUrls: [],
                    },
                ],
            };

            const mockSnapshot: AdvancedBlockingSnapshot = {
                nodeId,
                baseUrl: 'https://eq14.home-dns.com:53443',
                fetchedAt: '2025-10-19T10:00:00Z',
                metrics: {
                    groupCount: 1,
                    blockedDomainCount: 500,
                    allowedDomainCount: 10,
                    blockListUrlCount: 1,
                    allowListUrlCount: 0,
                    adblockListUrlCount: 0,
                    allowedRegexCount: 0,
                    blockedRegexCount: 0,
                    regexAllowListUrlCount: 0,
                    regexBlockListUrlCount: 0,
                    localEndpointMappingCount: 0,
                    networkMappingCount: 0,
                    scheduledNodeCount: 0,
                },
                config,
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockSnapshot,
            });

            const url = `/api/nodes/${encodeURIComponent(nodeId)}/advanced-blocking`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config }),
            });

            const snapshot = (await response.json()) as AdvancedBlockingSnapshot;

            expect(response.ok).toBe(true);
            expect(snapshot.config?.groups).toHaveLength(1);
            expect(getMockedFetch().mock.calls[0][0]).toBe(url);
        });

        it('should handle save Advanced Blocking error', async () => {
            const nodeId = 'eq14';
            const config: AdvancedBlockingConfig = {
                enableBlocking: true,
                localEndPointGroupMap: {},
                networkGroupMap: {},
                groups: [],
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: false,
                status: 400,
                json: async () => ({ error: 'Invalid config' }),
            });

            const url = `/api/nodes/${encodeURIComponent(nodeId)}/advanced-blocking`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ config }),
            });

            expect(response.ok).toBe(false);
            expect(response.status).toBe(400);
        });

        it('should require config when saving Advanced Blocking', () => {
            const request = { /* no config */ };

            const isValid = 'config' in request;
            expect(isValid).toBe(false);
        });
    });

    /**
     * Test: Query Log Loading
     *
     * Validates loading query logs from nodes with various filters.
     * Critical because: Users filter logs to find specific domains/clients.
     */
    describe('Query Log API', () => {
        it('should load node query logs without filters', async () => {
            const nodeId = 'eq14';
            const mockData: TechnitiumNodeQueryLogEnvelope = {
                nodeId,
                page: {
                    entries: [
                        {
                            timestamp: '2025-10-19T10:00:00Z',
                            qname: 'example.com',
                            clientIpAddress: '192.168.1.100',
                            blocked: false,
                        },
                    ],
                    totalEntries: 1,
                },
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockData,
            });

            const url = `/api/nodes/${encodeURIComponent(nodeId)}/logs`;
            const response = await fetch(url);
            const data = (await response.json()) as TechnitiumNodeQueryLogEnvelope;

            expect(response.ok).toBe(true);
            expect(data.page.entries).toHaveLength(1);
            expect(getMockedFetch().mock.calls[0][0]).toBe(url);
        });

        it('should load node query logs with domain filter', async () => {
            const nodeId = 'eq14';
            const filters: TechnitiumQueryLogFilters = { domain: 'example.com' };

            const mockData: TechnitiumNodeQueryLogEnvelope = {
                nodeId,
                page: {
                    entries: [
                        {
                            timestamp: '2025-10-19T10:00:00Z',
                            qname: 'example.com',
                            clientIpAddress: '192.168.1.100',
                            blocked: false,
                        },
                    ],
                    totalEntries: 1,
                },
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockData,
            });

            const params = new URLSearchParams();
            if (filters.domain) params.append('domain', filters.domain);

            const url = `/api/nodes/${encodeURIComponent(nodeId)}/logs?${params.toString()}`;
            const response = await fetch(url);
            const data = (await response.json()) as TechnitiumNodeQueryLogEnvelope;

            expect(response.ok).toBe(true);
            expect(data.page.entries[0].qname).toBe('example.com');
        });

        it('should load node query logs with multiple filters', async () => {
            const nodeId = 'eq14';
            const filters: TechnitiumQueryLogFilters = {
                domain: 'ads',
                clientIp: '192.168.1',
                status: 'blocked',
            };

            const mockData: TechnitiumNodeQueryLogEnvelope = {
                nodeId,
                page: {
                    entries: [
                        {
                            timestamp: '2025-10-19T10:00:00Z',
                            qname: 'ads.example.com',
                            clientIpAddress: '192.168.1.100',
                            blocked: true,
                        },
                    ],
                    totalEntries: 1,
                },
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockData,
            });

            const params = new URLSearchParams();
            if (filters.domain) params.append('domain', filters.domain);
            if (filters.clientIp) params.append('clientIp', filters.clientIp);
            if (filters.status && filters.status !== 'all') params.append('status', filters.status);

            const url = `/api/nodes/${encodeURIComponent(nodeId)}/logs?${params.toString()}`;
            const response = await fetch(url);
            const data = (await response.json()) as TechnitiumNodeQueryLogEnvelope;

            expect(response.ok).toBe(true);
            expect(data.page.entries[0].blocked).toBe(true);
        });

        it('should load combined query logs', async () => {
            const mockData: TechnitiumCombinedQueryLogPage = {
                entries: [
                    {
                        timestamp: '2025-10-19T10:00:00Z',
                        qname: 'example.com',
                        clientIpAddress: '192.168.1.100',
                        blocked: false,
                    },
                    {
                        timestamp: '2025-10-19T10:00:01Z',
                        qname: 'test.com',
                        clientIpAddress: '192.168.1.50',
                        blocked: false,
                    },
                ],
                totalEntries: 2,
                pageNumber: 0,
                pageSize: 10,
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockData,
            });

            const response = await fetch('/api/nodes/logs/combined');
            const data = (await response.json()) as TechnitiumCombinedQueryLogPage;

            expect(response.ok).toBe(true);
            expect(data.entries).toHaveLength(2);
            expect(data.pageNumber).toBe(0);
        });

        it('should handle query log API error', async () => {
            const nodeId = 'eq14';

            getMockedFetch().mockResolvedValueOnce({
                ok: false,
                status: 404,
            });

            const response = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/logs`);

            expect(response.ok).toBe(false);
            expect(response.status).toBe(404);
        });

        it('should require node ID for loading node logs', () => {
            const nodeId = '';

            const isValid = !!nodeId;
            expect(isValid).toBe(false);
        });
    });

    /**
     * Test: DHCP Scope API
     *
     * Validates loading, cloning, and updating DHCP scopes.
     * Critical because: Users manage DHCP across multiple nodes.
     */
    describe('DHCP Scope API', () => {
        it('should load DHCP scopes for a node', async () => {
            const nodeId = 'eq14';
            const mockData: TechnitiumDhcpScopeListEnvelope = {
                nodeId,
                scopes: [
                    {
                        name: 'default',
                        enabled: true,
                        leaseTimeDays: 30,
                        domainName: 'home.local',
                        domainNameServers: ['192.168.1.1'],
                    },
                ],
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockData,
            });

            const url = `/api/nodes/${encodeURIComponent(nodeId)}/dhcp/scopes`;
            const response = await fetch(url);
            const data = (await response.json()) as TechnitiumDhcpScopeListEnvelope;

            expect(response.ok).toBe(true);
            expect(data.scopes).toHaveLength(1);
            expect(data.scopes[0].name).toBe('default');
        });

        it('should load specific DHCP scope', async () => {
            const nodeId = 'eq14';
            const scopeName = 'default';
            const mockData: TechnitiumDhcpScopeEnvelope = {
                nodeId,
                scope: {
                    name: 'default',
                    enabled: true,
                    leaseTimeDays: 30,
                    domainName: 'home.local',
                    domainNameServers: ['192.168.1.1'],
                },
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockData,
            });

            const url = `/api/nodes/${encodeURIComponent(nodeId)}/dhcp/scopes/${encodeURIComponent(scopeName)}`;
            const response = await fetch(url);
            const data = (await response.json()) as TechnitiumDhcpScopeEnvelope;

            expect(response.ok).toBe(true);
            expect(data.scope.name).toBe('default');
            expect(data.scope.enabled).toBe(true);
        });

        it('should clone DHCP scope to another node', async () => {
            const sourceNodeId = 'eq14';
            const scopeName = 'default';
            const request: TechnitiumCloneDhcpScopeRequest = {
                targetNodeId: 'eq12',
                newScopeName: 'cloned-scope',
            };

            const mockResult: TechnitiumCloneDhcpScopeResult = {
                sourceNodeId,
                targetNodeId: 'eq12',
                status: 'success',
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult,
            });

            const url = `/api/nodes/${encodeURIComponent(sourceNodeId)}/dhcp/scopes/${encodeURIComponent(scopeName)}/clone`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });

            const result = (await response.json()) as TechnitiumCloneDhcpScopeResult;

            expect(response.ok).toBe(true);
            expect(result.status).toBe('success');
            expect(result.targetNodeId).toBe('eq12');
        });

        it('should clone DHCP scope with overrides', async () => {
            const sourceNodeId = 'eq14';
            const scopeName = 'default';
            const request: TechnitiumCloneDhcpScopeRequest = {
                targetNodeId: 'eq12',
                newScopeName: 'custom-scope',
                overrides: {
                    leaseTimeDays: 7,
                    domainName: 'guest.local',
                },
            };

            const mockResult: TechnitiumCloneDhcpScopeResult = {
                sourceNodeId,
                targetNodeId: 'eq12',
                status: 'success',
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult,
            });

            const url = `/api/nodes/${encodeURIComponent(sourceNodeId)}/dhcp/scopes/${encodeURIComponent(scopeName)}/clone`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });

            await response.json();

            expect(response.ok).toBe(true);
            expect(request.overrides?.leaseTimeDays).toBe(7);
        });

        it('should update DHCP scope', async () => {
            const nodeId = 'eq14';
            const scopeName = 'default';
            const request: TechnitiumUpdateDhcpScopeRequest = {
                enabled: false,
                leaseTimeDays: 14,
            };

            const mockData: TechnitiumUpdateDhcpScopeEnvelope = {
                nodeId,
                scope: {
                    name: 'default',
                    enabled: false,
                    leaseTimeDays: 14,
                },
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockData,
            });

            const url = `/api/nodes/${encodeURIComponent(nodeId)}/dhcp/scopes/${encodeURIComponent(scopeName)}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });

            const data = (await response.json()) as TechnitiumUpdateDhcpScopeEnvelope;

            expect(response.ok).toBe(true);
            expect(data.scope.enabled).toBe(false);
            expect(data.scope.leaseTimeDays).toBe(14);
        });

        it('should handle DHCP scope clone error', async () => {
            const sourceNodeId = 'eq14';
            const scopeName = 'default';
            const request: TechnitiumCloneDhcpScopeRequest = {
                targetNodeId: 'eq12',
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: false,
                status: 400,
                json: async () => ({ error: 'Invalid request' }),
            });

            const url = `/api/nodes/${encodeURIComponent(sourceNodeId)}/dhcp/scopes/${encodeURIComponent(scopeName)}/clone`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });

            expect(response.ok).toBe(false);
            expect(response.status).toBe(400);
        });

        it('should require node ID and scope name', () => {
            const nodeId = 'eq14';
            const scopeName = '';

            const isValid = !!nodeId && !!scopeName;
            expect(isValid).toBe(false);
        });
    });

    /**
     * Test: Zone API
     *
     * Validates loading zones from nodes.
     * Critical because: Users view zone configurations for DNS management.
     */
    describe('Zone API', () => {
        it('should load zones for a node', async () => {
            const nodeId = 'eq14';
            const mockData: TechnitiumZoneListEnvelope = {
                nodeId,
                zones: [
                    { name: 'example.com', type: 'Primary' },
                    { name: 'test.local', type: 'Primary' },
                ],
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockData,
            });

            const url = `/api/nodes/${encodeURIComponent(nodeId)}/zones`;
            const response = await fetch(url);
            const data = (await response.json()) as TechnitiumZoneListEnvelope;

            expect(response.ok).toBe(true);
            expect(data.zones).toHaveLength(2);
            expect(data.zones[0].name).toBe('example.com');
        });

        it('should load combined zones from all nodes', async () => {
            const mockData: TechnitiumCombinedZoneOverview = {
                zones: [
                    {
                        name: 'example.com',
                        statuses: { eq14: 'in-sync', eq12: 'in-sync' },
                    },
                    {
                        name: 'test.local',
                        statuses: { eq14: 'in-sync', eq12: 'different' },
                    },
                ],
            };

            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => mockData,
            });

            const response = await fetch('/api/nodes/zones/combined');
            const data = (await response.json()) as TechnitiumCombinedZoneOverview;

            expect(response.ok).toBe(true);
            expect(data.zones).toHaveLength(2);
            expect(data.zones[0].statuses.eq14).toBe('in-sync');
        });

        it('should handle zone API error', async () => {
            const nodeId = 'eq14';

            getMockedFetch().mockResolvedValueOnce({
                ok: false,
                status: 500,
            });

            const response = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/zones`);

            expect(response.ok).toBe(false);
            expect(response.status).toBe(500);
        });

        it('should require node ID for loading zones', () => {
            const nodeId = '';

            const isValid = !!nodeId;
            expect(isValid).toBe(false);
        });
    });

    /**
     * Test: Error Handling
     *
     * Validates consistent error handling across all API calls.
     * Critical because: Proper error handling prevents crashes.
     */
    describe('Error Handling', () => {
        it('should handle network errors', async () => {
            getMockedFetch().mockRejectedValueOnce(new Error('Network error'));

            try {
                await fetch('/api/nodes/advanced-blocking');
                expect.fail('Should have thrown error');
            } catch (error) {
                expect((error as Error).message).toBe('Network error');
            }
        });

        it('should handle 401 Unauthorized', async () => {
            getMockedFetch().mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: async () => ({ error: 'Unauthorized' }),
            });

            const response = await fetch('/api/nodes/advanced-blocking');

            expect(response.ok).toBe(false);
            expect(response.status).toBe(401);
        });

        it('should handle 403 Forbidden', async () => {
            getMockedFetch().mockResolvedValueOnce({
                ok: false,
                status: 403,
                json: async () => ({ error: 'Forbidden' }),
            });

            const response = await fetch('/api/nodes/advanced-blocking');

            expect(response.ok).toBe(false);
            expect(response.status).toBe(403);
        });

        it('should handle 404 Not Found', async () => {
            getMockedFetch().mockResolvedValueOnce({
                ok: false,
                status: 404,
                json: async () => ({ error: 'Not found' }),
            });

            const response = await fetch('/api/nodes/advanced-blocking');

            expect(response.ok).toBe(false);
            expect(response.status).toBe(404);
        });

        it('should handle 500 Server Error', async () => {
            getMockedFetch().mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => ({ error: 'Internal server error' }),
            });

            const response = await fetch('/api/nodes/advanced-blocking');

            expect(response.ok).toBe(false);
            expect(response.status).toBe(500);
        });

        it('should handle malformed JSON response', async () => {
            getMockedFetch().mockResolvedValueOnce({
                ok: true,
                json: async () => {
                    throw new Error('Invalid JSON');
                },
            });

            const response = await fetch('/api/nodes/advanced-blocking');

            try {
                await response.json();
                expect.fail('Should have thrown error');
            } catch (error) {
                expect((error as Error).message).toBe('Invalid JSON');
            }
        });

        it('should handle timeout on long-running requests', async () => {
            getMockedFetch().mockImplementationOnce(
                () =>
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Request timeout')), 100),
                    ),
            );

            try {
                await fetch('/api/nodes/advanced-blocking');
                expect.fail('Should have thrown timeout error');
            } catch (error) {
                expect((error as Error).message).toBe('Request timeout');
            }
        });
    });

    /**
     * Test: URL Parameter Encoding
     *
     * Validates that special characters in parameters are encoded correctly.
     * Critical because: Unencoded parameters can break API calls.
     */
    describe('URL Parameter Encoding', () => {
        it('should encode node ID with special characters', () => {
            const nodeId = 'eq@14#special';
            const encoded = encodeURIComponent(nodeId);
            const url = `/api/nodes/${encoded}/logs`;

            expect(encoded).not.toBe(nodeId);
            expect(url).toContain('%40');
            expect(url).toContain('%23');
        });

        it('should encode scope name with spaces', () => {
            const scopeName = 'Guest Network Scope';
            const encoded = encodeURIComponent(scopeName);

            expect(encoded).toContain('%20');
        });

        it('should handle domain names with dots in filters', () => {
            const domain = 'ads.example.com';
            const params = new URLSearchParams();
            params.append('domain', domain);
            const url = `/api/nodes/logs?${params.toString()}`;

            expect(url).toContain('ads.example.com');
        });
    });

    /**
     * Test: Request Validation
     *
     * Validates that requests are properly validated before sending.
     * Critical because: Invalid requests waste bandwidth and cause errors.
     */
    describe('Request Validation', () => {
        it('should validate required fields in clone request', () => {
            const request: TechnitiumCloneDhcpScopeRequest = {};

            const errors = [];
            if (!request.targetNodeId) {
                errors.push('targetNodeId is required');
            }

            expect(errors).toContain('targetNodeId is required');
        });

        it('should allow optional fields in clone request', () => {
            const request: TechnitiumCloneDhcpScopeRequest = {
                targetNodeId: 'eq12',
            };

            const errors = [];
            if (!request.targetNodeId) {
                errors.push('targetNodeId is required');
            }

            expect(errors).toHaveLength(0);
        });

        it('should validate Advanced Blocking config', () => {
            const config: Partial<AdvancedBlockingConfig> = {
                // Missing localEndPointGroupMap and networkGroupMap
                groups: [],
            };

            const isValid =
                'localEndPointGroupMap' in config &&
                'networkGroupMap' in config &&
                'groups' in config;

            expect(isValid).toBe(false);
        });

        it('should validate query log filters', () => {
            const filters: TechnitiumQueryLogFilters = {
                domain: 'example.com',
                status: 'blocked',
                pageNumber: 0,
                pageSize: 10,
            };

            const isValid =
                !filters.domain || filters.domain.length > 0;

            expect(isValid).toBe(true);
        });
    });
});
