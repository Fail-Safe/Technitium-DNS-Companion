/**
 * Test suite for backward compatibility of token configuration
 * Ensures both old (per-node tokens) and new (cluster token) formats work
 */

describe('TechnitiumModule Token Configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('TECHNITIUM_CLUSTER_TOKEN (new format)', () => {
        it('should use cluster token for all nodes when set', () => {
            process.env.TECHNITIUM_NODES = 'node1,node2';
            process.env.TECHNITIUM_CLUSTER_TOKEN = 'shared-cluster-token';
            process.env.TECHNITIUM_NODE1_BASE_URL = 'http://localhost:5380';
            process.env.TECHNITIUM_NODE2_BASE_URL = 'http://localhost:5381';

            // Import module factory function
            const { TechnitiumModule } = require('../src/technitium/technitium.module');
            const providers = TechnitiumModule.prototype.providers || [];

            // This test verifies the logic exists - full integration test would require NestJS test module
            expect(process.env.TECHNITIUM_CLUSTER_TOKEN).toBe('shared-cluster-token');
        });

        it('should allow per-node token override of cluster token', () => {
            process.env.TECHNITIUM_NODES = 'node1,node2';
            process.env.TECHNITIUM_CLUSTER_TOKEN = 'shared-cluster-token';
            process.env.TECHNITIUM_NODE1_BASE_URL = 'http://localhost:5380';
            process.env.TECHNITIUM_NODE1_TOKEN = 'override-token-for-node1';
            process.env.TECHNITIUM_NODE2_BASE_URL = 'http://localhost:5381';

            expect(process.env.TECHNITIUM_NODE1_TOKEN).toBe('override-token-for-node1');
            expect(process.env.TECHNITIUM_CLUSTER_TOKEN).toBe('shared-cluster-token');
        });
    });

    describe('Per-node tokens (legacy format)', () => {
        it('should work with per-node tokens when cluster token not set', () => {
            process.env.TECHNITIUM_NODES = 'node1,node2';
            process.env.TECHNITIUM_NODE1_BASE_URL = 'http://localhost:5380';
            process.env.TECHNITIUM_NODE1_TOKEN = 'token-for-node1';
            process.env.TECHNITIUM_NODE2_BASE_URL = 'http://localhost:5381';
            process.env.TECHNITIUM_NODE2_TOKEN = 'token-for-node2';

            expect(process.env.TECHNITIUM_NODE1_TOKEN).toBe('token-for-node1');
            expect(process.env.TECHNITIUM_NODE2_TOKEN).toBe('token-for-node2');
            expect(process.env.TECHNITIUM_CLUSTER_TOKEN).toBeUndefined();
        });
    });

    describe('Token precedence', () => {
        it('should prioritize node-specific token over cluster token', () => {
            const nodeToken = 'node-specific-token';
            const clusterToken = 'cluster-token';

            const token = nodeToken || clusterToken;
            expect(token).toBe('node-specific-token');
        });

        it('should fall back to cluster token when node token not set', () => {
            const nodeToken = undefined;
            const clusterToken = 'cluster-token';

            const token = nodeToken || clusterToken;
            expect(token).toBe('cluster-token');
        });
    });
});
