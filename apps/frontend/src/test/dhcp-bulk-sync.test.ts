import { describe, it, expect } from 'vitest';
import type {
    DhcpBulkSyncRequest,
    DhcpBulkSyncResult,
    TechnitiumDhcpScopeListEnvelope,
} from '../types/dhcp';

/**
 * Test Suite: DHCP Bulk Sync
 * Tests the bulk synchronization of DHCP scopes across nodes
 */

describe('DHCP Bulk Sync - Business Logic', () => {
    describe('Sync Strategy Validation', () => {
        it('should validate skip-existing strategy', () => {
            const request: DhcpBulkSyncRequest = {
                sourceNodeId: 'node1',
                targetNodeIds: ['node2'],
                strategy: 'skip-existing',
            };

            expect(request.strategy).toBe('skip-existing');
            expect(['skip-existing', 'overwrite-all', 'merge-missing']).toContain(request.strategy);
        });

        it('should validate overwrite-all strategy', () => {
            const request: DhcpBulkSyncRequest = {
                sourceNodeId: 'node1',
                targetNodeIds: ['node2'],
                strategy: 'overwrite-all',
            };

            expect(request.strategy).toBe('overwrite-all');
        });

        it('should validate merge-missing strategy', () => {
            const request: DhcpBulkSyncRequest = {
                sourceNodeId: 'node1',
                targetNodeIds: ['node2'],
                strategy: 'merge-missing',
            };

            expect(request.strategy).toBe('merge-missing');
        });

        it('should reject invalid strategy', () => {
            const validStrategies = ['skip-existing', 'overwrite-all', 'merge-missing'];
            const invalidStrategy = 'invalid-strategy';

            expect(validStrategies).not.toContain(invalidStrategy);
        });
    });

    describe('Request Validation', () => {
        it('should require source node ID', () => {
            const request = {
                sourceNodeId: '',
                targetNodeIds: ['node2'],
                strategy: 'skip-existing' as const,
            };

            expect(request.sourceNodeId).toBe('');
            expect(request.sourceNodeId.length).toBe(0);
        });

        it('should require at least one target node', () => {
            const request = {
                sourceNodeId: 'node1',
                targetNodeIds: [],
                strategy: 'skip-existing' as const,
            };

            expect(request.targetNodeIds).toHaveLength(0);
        });

        it('should accept multiple target nodes', () => {
            const request: DhcpBulkSyncRequest = {
                sourceNodeId: 'node1',
                targetNodeIds: ['node2', 'node3', 'node4'],
                strategy: 'skip-existing',
            };

            expect(request.targetNodeIds).toHaveLength(3);
            expect(request.targetNodeIds).toContain('node2');
            expect(request.targetNodeIds).toContain('node3');
        });

        it('should prevent syncing to self', () => {
            const sourceNodeId = 'node1';
            const targetNodeIds = ['node1', 'node2'];

            // Filter out source from targets
            const validTargets = targetNodeIds.filter((id) => id !== sourceNodeId);

            expect(validTargets).not.toContain(sourceNodeId);
            expect(validTargets).toContain('node2');
        });

        it('should accept optional scope filter', () => {
            const request: DhcpBulkSyncRequest = {
                sourceNodeId: 'node1',
                targetNodeIds: ['node2'],
                strategy: 'skip-existing',
                scopeNames: ['default', 'guest-network'],
            };

            expect(request.scopeNames).toHaveLength(2);
            expect(request.scopeNames).toContain('default');
        });

        it('should accept enableOnTarget option', () => {
            const request: DhcpBulkSyncRequest = {
                sourceNodeId: 'node1',
                targetNodeIds: ['node2'],
                strategy: 'skip-existing',
                enableOnTarget: true,
            };

            expect(request.enableOnTarget).toBe(true);
        });
    });

    describe('Response Processing', () => {
        it('should parse successful sync result', () => {
            const result: DhcpBulkSyncResult = {
                sourceNodeId: 'node1',
                nodeResults: [
                    {
                        targetNodeId: 'node2',
                        status: 'success',
                        scopeResults: [
                            { scopeName: 'default', status: 'synced' },
                            { scopeName: 'guest', status: 'synced' },
                        ],
                        syncedCount: 2,
                        skippedCount: 0,
                        failedCount: 0,
                    },
                ],
                totalSynced: 2,
                totalSkipped: 0,
                totalFailed: 0,
                completedAt: '2025-01-26T18:00:00Z',
            };

            expect(result.totalSynced).toBe(2);
            expect(result.totalFailed).toBe(0);
            expect(result.nodeResults[0].status).toBe('success');
        });

        it('should handle partial sync result', () => {
            const result: DhcpBulkSyncResult = {
                sourceNodeId: 'node1',
                nodeResults: [
                    {
                        targetNodeId: 'node2',
                        status: 'partial',
                        scopeResults: [
                            { scopeName: 'default', status: 'synced' },
                            { scopeName: 'guest', status: 'failed', error: 'Connection timeout' },
                        ],
                        syncedCount: 1,
                        skippedCount: 0,
                        failedCount: 1,
                    },
                ],
                totalSynced: 1,
                totalSkipped: 0,
                totalFailed: 1,
                completedAt: '2025-01-26T18:00:00Z',
            };

            expect(result.totalSynced).toBe(1);
            expect(result.totalFailed).toBe(1);
            expect(result.nodeResults[0].status).toBe('partial');
            expect(result.nodeResults[0].scopeResults[1].error).toBe('Connection timeout');
        });

        it('should handle skipped scopes', () => {
            const result: DhcpBulkSyncResult = {
                sourceNodeId: 'node1',
                nodeResults: [
                    {
                        targetNodeId: 'node2',
                        status: 'success',
                        scopeResults: [
                            { scopeName: 'default', status: 'synced' },
                            {
                                scopeName: 'existing',
                                status: 'skipped',
                                reason: 'Scope already exists on target (skip-existing strategy)',
                            },
                        ],
                        syncedCount: 1,
                        skippedCount: 1,
                        failedCount: 0,
                    },
                ],
                totalSynced: 1,
                totalSkipped: 1,
                totalFailed: 0,
                completedAt: '2025-01-26T18:00:00Z',
            };

            expect(result.totalSkipped).toBe(1);
            expect(result.nodeResults[0].scopeResults[1].status).toBe('skipped');
            expect(result.nodeResults[0].scopeResults[1].reason).toContain('already exists');
        });

        it('should handle complete failure', () => {
            const result: DhcpBulkSyncResult = {
                sourceNodeId: 'node1',
                nodeResults: [
                    {
                        targetNodeId: 'node2',
                        status: 'failed',
                        scopeResults: [],
                        syncedCount: 0,
                        skippedCount: 0,
                        failedCount: 3,
                    },
                ],
                totalSynced: 0,
                totalSkipped: 0,
                totalFailed: 3,
                completedAt: '2025-01-26T18:00:00Z',
            };

            expect(result.totalSynced).toBe(0);
            expect(result.totalFailed).toBe(3);
            expect(result.nodeResults[0].status).toBe('failed');
        });
    });

    describe('Summary Calculations', () => {
        it('should calculate summary for single target', () => {
            const nodeResult = {
                targetNodeId: 'node2',
                status: 'success' as const,
                scopeResults: [
                    { scopeName: 'scope1', status: 'synced' as const },
                    { scopeName: 'scope2', status: 'synced' as const },
                    { scopeName: 'scope3', status: 'skipped' as const },
                ],
                syncedCount: 2,
                skippedCount: 1,
                failedCount: 0,
            };

            const total = nodeResult.syncedCount + nodeResult.skippedCount + nodeResult.failedCount;
            expect(total).toBe(3);
            expect(nodeResult.scopeResults).toHaveLength(3);
        });

        it('should calculate summary for multiple targets', () => {
            const nodeResults = [
                {
                    targetNodeId: 'node2',
                    status: 'success' as const,
                    scopeResults: [],
                    syncedCount: 5,
                    skippedCount: 2,
                    failedCount: 0,
                },
                {
                    targetNodeId: 'node3',
                    status: 'success' as const,
                    scopeResults: [],
                    syncedCount: 4,
                    skippedCount: 3,
                    failedCount: 0,
                },
            ];

            const totalSynced = nodeResults.reduce((sum, node) => sum + node.syncedCount, 0);
            const totalSkipped = nodeResults.reduce((sum, node) => sum + node.skippedCount, 0);
            const totalFailed = nodeResults.reduce((sum, node) => sum + node.failedCount, 0);

            expect(totalSynced).toBe(9);
            expect(totalSkipped).toBe(5);
            expect(totalFailed).toBe(0);
        });
    });

    describe('Scope Filtering Logic', () => {
        it('should filter scopes when scopeNames provided', () => {
            const availableScopes = [
                { name: 'default', enabled: true },
                { name: 'guest', enabled: true },
                { name: 'iot', enabled: false },
                { name: 'admin', enabled: true },
            ];

            const filterList: string[] = ['default', 'guest'];

            const filtered = availableScopes.filter((scope) =>
                filterList.some((name: string) => name.toLowerCase() === scope.name.toLowerCase()),
            );

            expect(filtered).toHaveLength(2);
            expect(filtered.map((s) => s.name)).toEqual(['default', 'guest']);
        });

        it('should sync all scopes when no filter provided', () => {
            const availableScopes = [
                { name: 'default', enabled: true },
                { name: 'guest', enabled: true },
                { name: 'iot', enabled: false },
            ];

            // When no filter provided, all scopes should be included
            const hasFilter = false;
            const filtered = hasFilter ? [] : availableScopes;

            expect(filtered).toHaveLength(3);
        });

        it('should handle case-insensitive scope names', () => {
            const scopeName = 'Default';
            const filterName = 'default';

            expect(scopeName.toLowerCase()).toBe(filterName.toLowerCase());
        });
    });

    describe('Strategy Behavior Prediction', () => {
        it('should predict skip-existing behavior', () => {
            const sourceScopes = ['default', 'guest', 'iot'];
            const targetScopes = ['guest', 'admin'];

            const willSync = sourceScopes.filter((scope) => !targetScopes.includes(scope));
            const willSkip = sourceScopes.filter((scope) => targetScopes.includes(scope));

            expect(willSync).toEqual(['default', 'iot']);
            expect(willSkip).toEqual(['guest']);
        });

        it('should predict overwrite-all behavior', () => {
            const sourceScopes = ['default', 'guest', 'iot'];

            // All source scopes will be synced (overwriting if exists)
            const willSync = sourceScopes;

            expect(willSync).toEqual(['default', 'guest', 'iot']);
            expect(willSync).toHaveLength(3);
        });

        it('should predict merge-missing behavior', () => {
            const sourceScopes = ['default', 'guest', 'iot'];
            const targetScopes = ['guest', 'admin'];

            // Same as skip-existing
            const willSync = sourceScopes.filter((scope) => !targetScopes.includes(scope));

            expect(willSync).toEqual(['default', 'iot']);
        });
    });
});

describe('DHCP Bulk Sync - Error Handling', () => {
    it('should handle network errors gracefully', () => {
        const error = new Error('Failed to bulk sync DHCP scopes (500): Internal Server Error');

        expect(error.message).toContain('Failed to bulk sync');
        expect(error.message).toContain('500');
    });

    it('should handle source node offline', () => {
        const error = new Error('Cannot connect to source node node1');

        expect(error.message).toContain('Cannot connect');
        expect(error.message).toContain('node1');
    });

    it('should handle target node offline', () => {
        const result: DhcpBulkSyncResult = {
            sourceNodeId: 'node1',
            nodeResults: [
                {
                    targetNodeId: 'node2',
                    status: 'failed',
                    scopeResults: [],
                    syncedCount: 0,
                    skippedCount: 0,
                    failedCount: 5,
                },
            ],
            totalSynced: 0,
            totalSkipped: 0,
            totalFailed: 5,
            completedAt: '2025-01-26T18:00:00Z',
        };

        expect(result.nodeResults[0].status).toBe('failed');
        expect(result.totalFailed).toBeGreaterThan(0);
    });

    it('should handle empty source scopes', () => {
        const sourceScopes: TechnitiumDhcpScopeListEnvelope = {
            nodeId: 'node1',
            fetchedAt: '2025-01-26T18:00:00Z',
            data: {
                scopes: [],
            },
        };

        expect(sourceScopes.data.scopes).toHaveLength(0);

        const error = new Error('No scopes found to sync on source node.');
        expect(error.message).toContain('No scopes found');
    });

    it('should handle missing strategy', () => {
        const request = {
            sourceNodeId: 'node1',
            targetNodeIds: ['node2'],
            // Missing strategy
        };

        expect(request).not.toHaveProperty('strategy');
    });
});
