import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TechnitiumProvider } from "../context/TechnitiumContext";
import { ToastProvider } from "../context/ToastContext";
import { ZonesPage } from "../pages/ZonesPage";

describe("ZonesPage SplitHorizon PTR sync", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleErrorSpy: any;
  let includeCatalogZones = true;

  beforeEach(() => {
    vi.clearAllMocks();

    includeCatalogZones = true;

    fetchSpy = vi.spyOn(global, "fetch");
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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

      if (url === "/api/nodes/zones/combined") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              fetchedAt: new Date().toISOString(),
              zoneCount: 0,
              nodes: [],
              zones: [],
            }),
        } as Response);
      }

      if (url === "/api/split-horizon/ptr/source-zones") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              fetchedAt: new Date().toISOString(),
              nodeId: "node1",
              splitHorizonInstalled: true,
              zones: [],
            }),
        } as Response);
      }

      if (url === "/api/split-horizon/ptr/preview") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              fetchedAt: new Date().toISOString(),
              nodeId: "node1",
              zoneName: "example.com",
              splitHorizonInstalled: true,
              ipv4ZonePrefixLength: 24,
              ipv6ZonePrefixLength: 64,
              ...(includeCatalogZones ?
                { catalogZones: [{ name: "Catalog", type: "Catalog" }] }
              : {}),
              sourceRecords: [],
              plannedZones: [],
              plannedRecords: [],
            }),
        } as Response);
      }

      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
  });

  it("shows catalog dropdown when preview returns catalogZones", async () => {
    render(
      <ToastProvider>
        <TechnitiumProvider>
          <ZonesPage />
        </TechnitiumProvider>
      </ToastProvider>,
    );

    // Wait for ZonesPage to render (it starts with a skeleton while loading).
    await screen.findByRole("heading", { name: /Authoritative Zones/i });

    const user = userEvent.setup();

    // Switch to the Split Horizon tab (PTR sync UI lives there).
    await user.click(
      await screen.findByRole("button", { name: /Split Horizon/i }),
    );

    await user.type(screen.getByLabelText(/Forward zone name/i), "example.com");

    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Catalog zone for new reverse zones/i),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/Catalog \(Catalog\)/i)).toBeInTheDocument();
  });

  it("does not show catalog dropdown when preview has no catalogZones", async () => {
    includeCatalogZones = false;

    render(
      <ToastProvider>
        <TechnitiumProvider>
          <ZonesPage />
        </TechnitiumProvider>
      </ToastProvider>,
    );

    await screen.findByRole("heading", { name: /Authoritative Zones/i });

    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /Split Horizon/i }),
    );

    await user.type(screen.getByLabelText(/Forward zone name/i), "example.com");

    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(
        screen.queryByLabelText(/Catalog zone for new reverse zones/i),
      ).not.toBeInTheDocument();
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });
});
