import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TechnitiumProvider,
  useTechnitiumState,
} from "../context/TechnitiumContext";

/**
 * TechnitiumContext React Hook Integration Tests
 *
 * PURPOSE: Validate React lifecycle behavior, hook dependencies, and prevent regressions
 * like infinite loops that traditional API tests won't catch.
 *
 * CRITICAL COVERAGE:
 * - Prevents infinite re-render loops from hook dependencies
 * - Validates API calls happen exactly once (not repeatedly)
 * - Tests component mounting/unmounting behavior
 * - Ensures state updates don't trigger cascading effects
 * - Monitors network request counts
 *
 * WHY THIS MATTERS:
 * - E2E tests don't catch infinite loops in React hooks
 * - Unit tests mock fetch but don't render components
 * - Hook dependency arrays can cause subtle infinite loops
 * - This test suite would have caught the checkNodeApps infinite loop bug
 */

describe("TechnitiumContext React Hook Integration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleErrorSpy: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Spy on fetch to monitor API calls
    fetchSpy = vi.spyOn(global, "fetch");

    // Suppress expected console errors in tests
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Mock successful /api/nodes response
    fetchSpy.mockImplementation((url: string | URL | Request) => {
      if (url === "/api/nodes") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              { id: "node1", name: "Node 1", baseUrl: "http://node1.test" },
              { id: "node2", name: "Node 2", baseUrl: "http://node2.test" },
            ]),
        } as Response);
      }

      // Mock /api/nodes/:id/apps
      if (typeof url === "string" && url.includes("/apps")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              nodeId: "node1",
              apps: [],
              hasAdvancedBlocking: false,
              fetchedAt: new Date().toISOString(),
            }),
        } as Response);
      }

      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  /**
   * CRITICAL TEST #1: Prevent Infinite Loops
   *
   * This test would have caught the checkNodeApps infinite loop bug.
   * It monitors render count and ensures it stabilizes after initial mount.
   */
  describe("Infinite Loop Prevention", () => {
    it("should not cause infinite re-renders on mount", async () => {
      const renderCount = { current: 0 };

      const wrapper = ({ children }: { children: ReactNode }) => {
        renderCount.current++;
        return <TechnitiumProvider>{children}</TechnitiumProvider>;
      };

      renderHook(() => useTechnitiumState(), { wrapper });

      // Wait for initial renders to complete
      await waitFor(
        () => {
          expect(renderCount.current).toBeGreaterThan(0);
        },
        { timeout: 1000 },
      );

      const finalRenderCount = renderCount.current;

      // Wait a bit more to ensure no additional renders
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should not continue rendering after stabilization
      // Typically: 1 (initial) + 1-2 (after state updates) = 2-3 total
      expect(renderCount.current).toBeLessThan(10);
      expect(renderCount.current).toBe(finalRenderCount); // No new renders
    });

    it("should stabilize after nodes load without continuous re-renders", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      // Wait for nodes to load
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      const nodeCountAfterLoad = result.current.nodes.length;

      // Wait and verify nodes don't keep changing
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(result.current.nodes.length).toBe(nodeCountAfterLoad);
    });
  });

  describe("DHCP Snapshots", () => {
    it("sends origin when creating an automatic snapshot", async () => {
      const snapshotMeta = {
        id: "snap-1",
        nodeId: "node1",
        createdAt: "2025-01-01T00:00:00Z",
        scopeCount: 3,
        origin: "automatic" as const,
      };

      fetchSpy.mockImplementation(
        (url: string | URL | Request, options?: RequestInit) => {
          if (url === "/api/nodes") {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve([
                  { id: "node1", name: "Node 1", baseUrl: "http://node1.test" },
                ]),
            } as Response);
          }

          if (typeof url === "string" && url.includes("/apps")) {
            return Promise.resolve({
              ok: true,
              json: () =>
                Promise.resolve({
                  nodeId: "node1",
                  apps: [],
                  hasAdvancedBlocking: false,
                  fetchedAt: new Date().toISOString(),
                }),
            } as Response);
          }

          if (typeof url === "string" && url.includes("/dhcp/snapshots")) {
            expect(options?.method).toBe("POST");
            expect(options?.body).toBe(JSON.stringify({ origin: "automatic" }));
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve(snapshotMeta),
            } as Response);
          }

          return Promise.resolve({ ok: false, status: 404 } as Response);
        },
      );

      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      await waitFor(() => {
        expect(result.current.nodes.length).toBeGreaterThan(0);
      });

      const created = await result.current.createDhcpSnapshot(
        "node1",
        "automatic",
      );
      expect(created.origin).toBe("automatic");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/dhcp/snapshots"),
        expect.objectContaining({
          body: JSON.stringify({ origin: "automatic" }),
        }),
      );
    });
  });

  /**
   * CRITICAL TEST #2: API Call Monitoring
   *
   * Ensures each endpoint is called the correct number of times.
   * Prevents excessive API calls from hook dependency issues.
   */
  describe("API Call Count Validation", () => {
    it("should call /api/nodes exactly once on mount", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      // Wait for nodes to load
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      // Count how many times /api/nodes was called
      const nodesApiCalls = fetchSpy.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any[]) => call[0] === "/api/nodes",
      );

      expect(nodesApiCalls.length).toBe(1);
    });

    it("should call /api/nodes/:id/apps exactly once per node after load", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      // Wait for nodes to load
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBe(2);
        },
        { timeout: 2000 },
      );

      // Wait for app checks to complete
      await waitFor(
        () => {
          const hasAdvancedBlockingDefined = result.current.nodes.every(
            (node) => node.hasAdvancedBlocking !== undefined,
          );
          return hasAdvancedBlockingDefined;
        },
        { timeout: 3000 },
      );

      // Count /apps calls
      const appsCalls = fetchSpy.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any[]) =>
          typeof call[0] === "string" && call[0].includes("/apps"),
      );

      // Should be called exactly once per node (2 nodes = 2 calls)
      expect(appsCalls.length).toBe(2);
    });

    it("should not make excessive API calls over time", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      // Wait for initial load
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBe(2);
        },
        { timeout: 2000 },
      );

      // Record call count after initial stabilization
      const initialCallCount = fetchSpy.mock.calls.length;

      // Wait additional time to detect any runaway calls
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Should not have made additional calls (maybe +2 for apps check)
      const finalCallCount = fetchSpy.mock.calls.length;
      expect(finalCallCount - initialCallCount).toBeLessThanOrEqual(3);
    });
  });

  /**
   * CRITICAL TEST #3: Hook Dependency Validation
   *
   * Tests that useEffect and useCallback dependencies are correct.
   */
  describe("Hook Dependency Correctness", () => {
    it("should not recreate checkNodeApps callback unnecessarily", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result, rerender } = renderHook(() => useTechnitiumState(), {
        wrapper,
      });

      // Wait for nodes to load
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBe(2);
        },
        { timeout: 2000 },
      );

      // Force a rerender
      rerender();

      // Apps endpoint should still only be called once per node
      const appsCalls = fetchSpy.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any[]) =>
          typeof call[0] === "string" && call[0].includes("/apps"),
      );

      expect(appsCalls.length).toBeLessThanOrEqual(2);
    });

    it("should use ref to prevent duplicate app checks", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      // Wait for complete initialization
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBe(2);
        },
        { timeout: 2000 },
      );

      await waitFor(
        () => {
          return result.current.nodes.every(
            (node) => node.hasAdvancedBlocking !== undefined,
          );
        },
        { timeout: 3000 },
      );

      const initialAppsCalls = fetchSpy.mock.calls.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (call: any[]) =>
          typeof call[0] === "string" && call[0].includes("/apps"),
      ).length;

      // Manually call fetchNodeOverviews (simulates user action)
      await act(async () => {
        await result.current.fetchNodeOverviews();
      });

      // Apps should NOT be checked again
      const finalAppsCalls = fetchSpy.mock.calls.filter(
        (call: Array<unknown>) =>
          typeof call[0] === "string" && call[0].includes("/apps"),
      ).length;

      expect(finalAppsCalls).toBe(initialAppsCalls); // No new calls
    });
  });

  /**
   * CRITICAL TEST #4: State Management
   *
   * Validates state updates are predictable and don't cause cascading effects.
   */
  describe("State Update Stability", () => {
    it("should load nodes state exactly once", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      // Initially empty
      expect(result.current.nodes).toEqual([]);

      // Wait for load
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBe(2);
        },
        { timeout: 2000 },
      );

      // Verify node structure
      expect(result.current.nodes[0]).toMatchObject({
        id: "node1",
        name: "Node 1",
        baseUrl: "http://node1.test",
        status: "unknown",
      });
    });

    it("should update hasAdvancedBlocking without changing other node properties", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      // Wait for nodes
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBe(2);
        },
        { timeout: 2000 },
      );

      const initialNodeId = result.current.nodes[0].id;
      const initialNodeName = result.current.nodes[0].name;

      // Wait for app check
      await waitFor(
        () => {
          return result.current.nodes[0].hasAdvancedBlocking !== undefined;
        },
        { timeout: 3000 },
      );

      // Node identity should remain the same
      expect(result.current.nodes[0].id).toBe(initialNodeId);
      expect(result.current.nodes[0].name).toBe(initialNodeName);
      expect(result.current.nodes[0].hasAdvancedBlocking).toBe(false);
    });

    it("should handle failed node configuration gracefully", async () => {
      // Mock fetch failure
      fetchSpy.mockImplementationOnce(() =>
        Promise.resolve({ ok: false, status: 500 } as Response),
      );

      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      // Should not throw, should return empty nodes
      await waitFor(
        () => {
          expect(result.current.nodes).toEqual([]);
        },
        { timeout: 2000 },
      );

      // Should have logged error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to load nodes configuration"),
        expect.any(Error),
      );
    });
  });

  /**
   * CRITICAL TEST #5: Memory Leaks & Cleanup
   *
   * Ensures no memory leaks from unmounted components or dangling timers.
   */
  describe("Component Lifecycle & Cleanup", () => {
    it("should not throw errors when unmounting", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result, unmount } = renderHook(() => useTechnitiumState(), {
        wrapper,
      });

      // Wait for initial load
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBe(2);
        },
        { timeout: 2000 },
      );

      // Unmount should not throw
      expect(() => unmount()).not.toThrow();
    });

    it("should not make API calls after unmount", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result, unmount } = renderHook(() => useTechnitiumState(), {
        wrapper,
      });

      // Wait for load
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBe(2);
        },
        { timeout: 2000 },
      );

      const callCountBeforeUnmount = fetchSpy.mock.calls.length;

      // Unmount
      unmount();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Should not have made additional calls after unmount
      expect(fetchSpy.mock.calls.length).toBe(callCountBeforeUnmount);
    });
  });

  /**
   * CRITICAL TEST #6: Context Methods
   *
   * Validates exported methods work correctly without side effects.
   */
  describe("Context Method Integration", () => {
    it("should provide all expected context methods", async () => {
      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      // Wait for initial load
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBe(2);
        },
        { timeout: 2000 },
      );

      // Verify all methods exist
      expect(result.current.reloadAdvancedBlocking).toBeInstanceOf(Function);
      expect(result.current.fetchNodeOverviews).toBeInstanceOf(Function);
      expect(result.current.saveAdvancedBlockingConfig).toBeInstanceOf(
        Function,
      );
      expect(result.current.loadNodeLogs).toBeInstanceOf(Function);
      expect(result.current.loadCombinedLogs).toBeInstanceOf(Function);
      expect(result.current.loadDhcpScopes).toBeInstanceOf(Function);
      expect(result.current.loadDhcpScope).toBeInstanceOf(Function);
      expect(result.current.cloneDhcpScope).toBeInstanceOf(Function);
      expect(result.current.updateDhcpScope).toBeInstanceOf(Function);
      expect(result.current.loadZones).toBeInstanceOf(Function);
      expect(result.current.loadCombinedZones).toBeInstanceOf(Function);
    });

    it("should handle fetchNodeOverviews without causing infinite loops", async () => {
      // Mock overview endpoint
      fetchSpy.mockImplementation((url: string | URL | Request) => {
        if (url === "/api/nodes") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve([
                { id: "node1", name: "Node 1", baseUrl: "http://node1.test" },
              ]),
          } as Response);
        }

        if (typeof url === "string" && url.includes("/overview")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                nodeId: "node1",
                version: "1.0.0",
                uptime: 3600,
                totalZones: 10,
                totalQueries: 1000,
                totalBlockedQueries: 50,
                totalApps: 2,
                hasAdvancedBlocking: true,
                fetchedAt: new Date().toISOString(),
              }),
          } as Response);
        }

        if (typeof url === "string" && url.includes("/zones/combined")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ zones: [] }),
          } as Response);
        }

        return Promise.resolve({ ok: false, status: 404 } as Response);
      });

      const wrapper = ({ children }: { children: ReactNode }) => (
        <TechnitiumProvider>{children}</TechnitiumProvider>
      );

      const { result } = renderHook(() => useTechnitiumState(), { wrapper });

      // Wait for initial load
      await waitFor(
        () => {
          expect(result.current.nodes.length).toBe(1);
        },
        { timeout: 2000 },
      );

      const callCountBefore = fetchSpy.mock.calls.length;

      // Call fetchNodeOverviews
      await act(async () => {
        await result.current.fetchNodeOverviews();
      });

      // Should have made overview and zones/combined calls
      await waitFor(
        () => {
          const overviewCalls = fetchSpy.mock.calls.filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (call: any[]) =>
              typeof call[0] === "string" && call[0].includes("/overview"),
          );
          expect(overviewCalls.length).toBeGreaterThan(0);
        },
        { timeout: 2000 },
      );

      const callCountAfter = fetchSpy.mock.calls.length;

      // Wait to ensure no runaway calls
      await new Promise((resolve) => setTimeout(resolve, 500));

      const finalCallCount = fetchSpy.mock.calls.length;

      // Should not continue making calls
      expect(finalCallCount).toBe(callCountAfter);
      expect(finalCallCount - callCountBefore).toBeLessThan(10);
    });
  });
});
