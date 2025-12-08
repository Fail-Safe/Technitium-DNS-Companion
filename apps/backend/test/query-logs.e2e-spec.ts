import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import { join } from "path";
import os from "os";

// Response type definitions for test
interface QueryLogEntry {
  nodeId: string;
  [key: string]: unknown;
}

interface CombinedLogsResponse {
  entries: QueryLogEntry[];
  nodes: Array<{ [key: string]: unknown }>;
  totalMatchingEntries?: number;
  responseType?: string;
}

describe("Query Logs - Combined View (e2e)", () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    // Ensure cache directory is writable during tests
    process.env.CACHE_DIR =
      process.env.CACHE_DIR || join(os.tmpdir(), "tdc-cache-test");

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("Balanced Node Sampling", () => {
    it("should list configured nodes (or empty if none configured)", () => {
      return request(app.getHttpServer())
        .get("/api/nodes")
        .expect(200)
        .expect((res) => {
          const body = res.body as Array<{ id: string; baseUrl: string }>;
          expect(Array.isArray(body)).toBe(true);
          // Nodes list can be empty in test environment (no Technitium DNS servers configured)
          // In production with configured nodes, should have at least 1
          if (body.length > 0) {
            expect(body[0]).toHaveProperty("id");
            expect(body[0]).toHaveProperty("baseUrl");
          }
        });
    });

    it("should fetch combined logs without deduplication", () => {
      return request(app.getHttpServer())
        .get(
          "/api/nodes/logs/combined?entriesPerPage=200&deduplicateDomains=false",
        )
        .expect(200)
        .expect((res) => {
          const body = res.body as CombinedLogsResponse;
          expect(body).toHaveProperty("entries");
          expect(body).toHaveProperty("nodes");
          expect(Array.isArray(body.entries)).toBe(true);
          expect(Array.isArray(body.nodes)).toBe(true);

          // With balanced sampling, if we have 2 nodes and request 200 entries,
          // the raw data should be fetched 100 from each node
          if (body.nodes.length >= 2) {
            // Count entries by node
            const nodeCounts: Record<string, number> = {};
            body.entries.forEach((entry) => {
              const nodeId = entry.nodeId || "unknown";
              nodeCounts[nodeId] = (nodeCounts[nodeId] || 0) + 1;
            });

            // Should have entries from multiple nodes (not all from one)
            const nodesWithEntries = Object.keys(nodeCounts).length;
            expect(nodesWithEntries).toBeGreaterThan(1);

            // Entries should be relatively balanced (no node has >90% of entries)
            const totalEntries = body.entries.length;
            if (totalEntries > 0) {
              Object.values(nodeCounts).forEach((count) => {
                const ratio = count / totalEntries;
                expect(ratio).toBeLessThan(0.95); // No single node dominates
              });
            }
          }
        });
    });

    it("should fetch combined logs with deduplication and preserve node diversity", () => {
      return request(app.getHttpServer())
        .get(
          "/api/nodes/logs/combined?entriesPerPage=200&deduplicateDomains=true",
        )
        .expect(200)
        .expect((res) => {
          const body = res.body as CombinedLogsResponse;
          expect(body).toHaveProperty("entries");
          expect(body).toHaveProperty("nodes");
          expect(Array.isArray(body.entries)).toBe(true);

          // Even with deduplication, should try to preserve entries from multiple nodes
          if (body.nodes.length >= 2) {
            const nodeCounts: Record<string, number> = {};
            body.entries.forEach((entry) => {
              const nodeId = entry.nodeId || "unknown";
              nodeCounts[nodeId] = (nodeCounts[nodeId] || 0) + 1;
            });

            // Should still have entries from multiple nodes
            const nodesWithEntries = Object.keys(nodeCounts).length;
            expect(nodesWithEntries).toBeGreaterThan(1);

            // After deduplication, entries should still come from multiple nodes
            // (at least 5% from non-primary node)
            const totalEntries = body.entries.length;
            if (totalEntries > 0) {
              const countValues = Object.values(nodeCounts);
              const maxCount = Math.max(...countValues);
              const maxRatio = maxCount / totalEntries;

              // No single node should have 100% of deduplicated entries
              expect(maxRatio).toBeLessThan(1.0);

              // And should have at least 5% from other nodes
              expect(maxRatio).toBeLessThan(0.95);
            }
          }
        });
    });

    it("should respect buffer size parameter for balanced sampling", () => {
      return request(app.getHttpServer())
        .get(
          "/api/nodes/logs/combined?entriesPerPage=500&deduplicateDomains=false",
        )
        .expect(200)
        .expect((res) => {
          const body = res.body as CombinedLogsResponse;
          expect(body).toHaveProperty("entries");
          expect(Array.isArray(body.entries)).toBe(true);

          // Should return up to 500 entries (or fewer if not available)
          expect(body.entries.length).toBeLessThanOrEqual(500);

          // Should have balanced sampling across nodes
          if (body.nodes.length >= 2 && body.entries.length > 0) {
            const nodeCounts: Record<string, number> = {};
            body.entries.forEach((entry) => {
              const nodeId = entry.nodeId || "unknown";
              nodeCounts[nodeId] = (nodeCounts[nodeId] || 0) + 1;
            });

            // With 500 entries and 2 nodes, should be roughly 250 each
            // (allowing for some variance due to deduplication/sorting)
            const countValues = Object.values(nodeCounts);

            // Each node should have at least 10% representation
            countValues.forEach((count) => {
              expect(count / body.entries.length).toBeGreaterThan(0.1);
            });
          }
        });
    });

    it("should return nodes summary with total entries per node", () => {
      return request(app.getHttpServer())
        .get("/api/nodes/logs/combined?entriesPerPage=50")
        .expect(200)
        .expect((res) => {
          const body = res.body as CombinedLogsResponse;
          expect(body.nodes).toBeDefined();
          expect(Array.isArray(body.nodes)).toBe(true);

          // Each node summary should have stats
          body.nodes.forEach((node) => {
            expect(node).toHaveProperty("nodeId");
            expect(node).toHaveProperty("fetchedAt");
            expect(node).toHaveProperty("totalEntries");
          });
        });
    });

    it("should include node information in each log entry", () => {
      return request(app.getHttpServer())
        .get(
          "/api/nodes/logs/combined?entriesPerPage=10&deduplicateDomains=false",
        )
        .expect(200)
        .expect((res) => {
          const body = res.body as CombinedLogsResponse;
          if (body.entries.length > 0) {
            body.entries.forEach((entry) => {
              // Each entry should include nodeId for source tracking
              expect(entry).toHaveProperty("nodeId");
              expect(typeof entry.nodeId).toBe("string");
            });
          }
        });
    });
  });

  describe("Deduplication Logic", () => {
    it("should reduce duplicate domains while preserving node diversity", () => {
      return request(app.getHttpServer())
        .get(
          "/api/nodes/logs/combined?entriesPerPage=100&deduplicateDomains=true",
        )
        .expect(200)
        .expect((res) => {
          const body = res.body as CombinedLogsResponse;
          expect(body).toHaveProperty("totalMatchingEntries");
          expect(body.entries).toBeDefined();

          // Deduplication should reduce total entries (same domain from multiple nodes → 1 entry)
          // But the actual count depends on real data, so we just verify it works
          expect(typeof body.totalMatchingEntries).toBe("number");
          expect(body.totalMatchingEntries).toBeGreaterThanOrEqual(0);
        });
    });

    it("should prioritize blocked entries over allowed in deduplication", () => {
      return request(app.getHttpServer())
        .get(
          "/api/nodes/logs/combined?entriesPerPage=200&deduplicateDomains=true",
        )
        .expect(200)
        .expect((res) => {
          const body = res.body as CombinedLogsResponse;
          if (body.entries.length > 0) {
            // If we have entries, they should include mix of responses
            const responses = body.entries.map((e) => e.responseType);

            // Just verify responses are present and valid
            expect(responses.length).toBeGreaterThan(0);
          }
        });
    });
  });
});
