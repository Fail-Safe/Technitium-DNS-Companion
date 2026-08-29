import { performance } from "node:perf_hooks";
import { DhcpSnapshotService } from "./dhcp-snapshot.service";
import { TechnitiumService } from "./technitium.service";
import type {
  TechnitiumNodeConfig,
  TechnitiumQueryLogEntry,
} from "./technitium.types";

const RUN = process.env.RUN_DHCP_CAPABILITY_BENCHMARKS === "true";
const describeOrSkip = RUN ? describe : describe.skip;
const SAMPLE_COUNT = 9;
const STORED_ITERATIONS_PER_SAMPLE = 1000;

const nodes: TechnitiumNodeConfig[] = [
  { id: "active", baseUrl: "https://active.test", token: "test" },
  { id: "inactive", baseUrl: "https://inactive.test", token: "test" },
  {
    id: "slow-inactive",
    baseUrl: "https://slow-inactive.test",
    token: "test",
  },
];

const storedEntries: TechnitiumQueryLogEntry[] = Array.from(
  { length: 50 },
  (_, index) => ({
    timestamp: "2026-08-29T12:00:00.000Z",
    qname: "example.test",
    clientIpAddress: `192.0.2.${index + 1}`,
    clientName: `client-${index + 1}`,
  }),
);

interface BenchmarkInternals {
  request: jest.Mock;
  getDhcpLeases: jest.Mock;
  getAllDhcpLeasesWithOptions: (options: {
    authMode: "background";
  }) => Promise<Map<string, string>>;
  refreshDhcpScopeCapabilitiesIfNeeded: () => Promise<void>;
  dhcpLeaseCacheForBackground?: {
    map: Map<string, string>;
    fetchedAt: number;
  };
}

const delay = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

const nodeLatencyMs = (nodeId: string) =>
  nodeId === "slow-inactive" ? 80 : 10;

const median = (samples: number[]) => {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const summarize = (samples: number[]) => ({
  medianMs: median(samples),
  minMs: Math.min(...samples),
  maxMs: Math.max(...samples),
});

describeOrSkip("DHCP capability routing benchmark", () => {
  it("compares all-node fan-out, capability routing, and cached-only storage", async () => {
    let baselineLeaseCalls = 0;
    const baselineSamples: number[] = [];
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      const startedAt = performance.now();
      await Promise.all(
        nodes.map(async (node) => {
          baselineLeaseCalls += 1;
          await delay(nodeLatencyMs(node.id));
          return new Map<string, string>();
        }),
      );
      baselineSamples.push(performance.now() - startedAt);
    }

    const service = new TechnitiumService(nodes, new DhcpSnapshotService());
    const internal = service as unknown as BenchmarkInternals;
    let scopeCalls = 0;
    let routedLeaseCalls = 0;
    internal.request = jest.fn(async (node: TechnitiumNodeConfig) => {
      scopeCalls += 1;
      await delay(nodeLatencyMs(node.id));
      return {
        status: "ok",
        response: {
          scopes: [
            {
              name: `${node.id}-scope`,
              enabled: node.id === "active",
            },
          ],
        },
      };
    });
    internal.getDhcpLeases = jest.fn(async (node: TechnitiumNodeConfig) => {
      routedLeaseCalls += 1;
      await delay(nodeLatencyMs(node.id));
      return new Map([["192.0.2.1", "client"]]);
    });

    const discoveryStartedAt = performance.now();
    await internal.refreshDhcpScopeCapabilitiesIfNeeded();
    const discoveryMs = performance.now() - discoveryStartedAt;

    const routedSamples: number[] = [];
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      internal.dhcpLeaseCacheForBackground = undefined;
      const startedAt = performance.now();
      await internal.getAllDhcpLeasesWithOptions({ authMode: "background" });
      routedSamples.push(performance.now() - startedAt);
    }

    let cachedLeaseCalls = 0;
    internal.getDhcpLeases = jest.fn(() => {
      cachedLeaseCalls += 1;
      return Promise.resolve(new Map());
    });
    const storedSamples: number[] = [];
    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      const startedAt = performance.now();
      for (
        let iteration = 0;
        iteration < STORED_ITERATIONS_PER_SAMPLE;
        iteration += 1
      ) {
        service.enrichQueryLogEntriesWithCachedHostnames(storedEntries);
      }
      storedSamples.push(
        (performance.now() - startedAt) / STORED_ITERATIONS_PER_SAMPLE,
      );
    }
    service.onModuleDestroy();

    const result = {
      model: {
        activeNodeMs: 10,
        inactiveNodeMs: 10,
        slowInactiveNodeMs: 80,
        nodes: 3,
        activeNodes: 1,
        samples: SAMPLE_COUNT,
      },
      baseline: {
        ...summarize(baselineSamples),
        leaseCalls: baselineLeaseCalls,
        callsPerRefresh: baselineLeaseCalls / SAMPLE_COUNT,
      },
      capabilityRouting: {
        ...summarize(routedSamples),
        discoveryMs,
        scopeCalls,
        leaseCalls: routedLeaseCalls,
        callsPerRefresh: routedLeaseCalls / SAMPLE_COUNT,
      },
      storedCachedOnly: {
        ...summarize(storedSamples),
        iterationsPerSample: STORED_ITERATIONS_PER_SAMPLE,
        leaseCalls: cachedLeaseCalls,
      },
    };

    console.log(`\n${JSON.stringify(result, null, 2)}\n`);

    expect(result.baseline.callsPerRefresh).toBe(3);
    expect(result.capabilityRouting.callsPerRefresh).toBe(1);
    expect(result.storedCachedOnly.leaseCalls).toBe(0);
  });
});
