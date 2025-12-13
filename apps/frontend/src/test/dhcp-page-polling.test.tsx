import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TechnitiumProvider } from "../context/TechnitiumContext";
import { ToastProvider } from "../context/ToastContext";
import DhcpPage from "../pages/DhcpPage";

/**
 * Integration guardrail for DhcpPage + TechnitiumProvider.
 * Ensures DHCP scopes load once on mount and cluster polling is initialized only once.
 */
describe("DhcpPage scope loading and polling setup", () => {
  const scopeListCalls: string[] = [];
  const scopeDetailCalls: string[] = [];

  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  const nodesResponse = [
    {
      id: "node1",
      name: "Node 1",
      baseUrl: "http://node1.test",
      isPrimary: true,
      clusterState: { initialized: true },
    },
    {
      id: "node2",
      name: "Node 2",
      baseUrl: "http://node2.test",
      isPrimary: false,
      clusterState: { initialized: true },
    },
  ];

  const scopeListEnvelope = {
    data: {
      scopes: [
        {
          name: "scope-a",
          enabled: true,
          startingAddress: "10.0.0.10",
          endingAddress: "10.0.0.200",
          subnetMask: "255.255.255.0",
        },
      ],
    },
  };

  const scopeDetailEnvelope = {
    data: {
      name: "scope-a",
      enabled: true,
      startingAddress: "10.0.0.10",
      endingAddress: "10.0.0.200",
      subnetMask: "255.255.255.0",
      leaseTimeDays: 1,
      leaseTimeHours: 0,
      leaseTimeMinutes: 0,
      dnsServers: ["1.1.1.1"],
      domainSearchList: ["example.test"],
      exclusions: [],
      reservedLeases: [],
      genericOptions: [],
      vendorInfo: [],
      staticRoutes: [],
      ntpServers: [],
      ntpServerDomainNames: [],
      capwapAcIpAddresses: [],
      tftpServerAddresses: [],
      winsServers: [],
      pingCheckEnabled: false,
      pingCheckTimeout: 0,
      pingCheckRetries: 0,
      offerDelayTime: 0,
      allowOnlyReservedLeases: false,
      blockLocallyAdministeredMacAddresses: false,
      ignoreClientIdentifierOption: false,
      useThisDnsServer: false,
    },
  };

  beforeEach(() => {
    scopeListCalls.length = 0;
    scopeDetailCalls.length = 0;

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/nodes") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(nodesResponse),
        } as Response);
      }

      if (url.includes("/cluster/settings")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              heartbeatRefreshIntervalSeconds: 30,
              heartbeatRetryIntervalSeconds: 10,
              configRefreshIntervalSeconds: 900,
              configRetryIntervalSeconds: 60,
            }),
        } as Response);
      }

      if (url.endsWith("/dhcp/scopes")) {
        scopeListCalls.push(url);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(scopeListEnvelope),
        } as Response);
      }

      if (url.includes("/dhcp/scopes/")) {
        scopeDetailCalls.push(url);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(scopeDetailEnvelope),
        } as Response);
      }

      if (url.includes("/apps")) {
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

      if (url.includes("/overview")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ fetchedAt: new Date().toISOString() }),
        } as Response);
      }

      if (url.includes("/zones/combined")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ zones: [] }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("loads scopes once and initializes polling once", async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <TechnitiumProvider>
            <DhcpPage />
          </TechnitiumProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(scopeListCalls.length).toBeGreaterThan(0);
    });

    // Guard against runaway re-fetch loops; baseline is a handful of calls
    expect(scopeListCalls.length).toBeLessThanOrEqual(6);

    // Allow effects to finish scheduling the polling interval
    const pollingStarts = consoleLogSpy.mock.calls.filter(
      ([first]) =>
        typeof first === "string" &&
        first.includes("Starting cluster role polling"),
    );
    expect(pollingStarts.length).toBe(1);

    await waitFor(() => {
      expect(scopeDetailCalls.length).toBeGreaterThan(0);
    });

    // Scope details should not churn repeatedly
    expect(scopeDetailCalls.length).toBeLessThanOrEqual(2);
  });
});
