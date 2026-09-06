import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationPage } from "../pages/AutomationPage";
import type {
  DnsTemporaryOverride,
  RunDnsScheduleEvaluatorResponse,
} from "../types/dnsSchedules";

const { pushToast, request, state } = vi.hoisted(() => ({
  pushToast: vi.fn(),
  request: vi.fn(),
  state: {
    nodes: [],
    advancedBlocking: { nodes: [] },
    loadingAdvancedBlocking: false,
    reloadAdvancedBlocking: vi.fn(),
  },
}));
vi.mock("../config", () => ({ apiFetch: request, apiFetchStatus: request }));
vi.mock("../context/useToast", () => ({ useToast: () => ({ pushToast }) }));
vi.mock("../context/useTechnitiumState", () => ({
  useTechnitiumState: () => state,
}));

describe("Automation recovery status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockApi(
    pending: number,
    errors = 0,
    results: RunDnsScheduleEvaluatorResponse["results"] = [],
    overrides: DnsTemporaryOverride[] = [],
  ) {
    request.mockImplementation((url: string) => {
      let body: unknown = [];
      if (url.endsWith("evaluator/status"))
        body = {
          enabled: true,
          intervalMs: 30000,
          tokenReady: true,
          pendingRecoveryCount: pending,
        };
      else if (url.endsWith("evaluator/run"))
        body = {
          dryRun: false,
          evaluatedSchedules: 1,
          results,
          applied: 0,
          removed: 0,
          skipped: 0,
          errored: errors,
          pendingRecoveryCount: pending,
        };
      else if (url.endsWith("token/status"))
        body = { configured: true, valid: true };
      else if (url.endsWith("storage/status"))
        body = { enabled: true, ready: true };
      else if (url.endsWith("smtp/status")) body = { enabled: false };
      else if (url.endsWith("dns-overrides/temporary")) body = overrides;
      else if (url.includes("dns-overrides/temporary/"))
        body = { ...overrides[0], enabled: true };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    });
  }

  it("shows durable pending work without marking it applied", async () => {
    mockApi(2);
    render(<AutomationPage />);
    const status = await screen.findByText(/DNS changes awaiting recovery:/);
    expect(status).toHaveTextContent("DNS changes awaiting recovery: 2");
    expect(status).toHaveClass("log-alerts__warn");
  });

  it.each([
    [1, 0],
    [0, 1],
  ])(
    "avoids a success toast for %i pending changes and %i errors",
    async (pending, errors) => {
      mockApi(pending, errors);
      render(<AutomationPage />);
      await screen.findByText(/DNS changes awaiting recovery:/);
      fireEvent.click(screen.getByRole("button", { name: /^Run now$/i }));
      await waitFor(() =>
        expect(pushToast).toHaveBeenCalledWith(
          expect.objectContaining({
            tone: "error",
            message: expect.stringContaining("awaiting recovery"),
          }),
        ),
      );
      expect(pushToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ tone: "success" }),
      );
    },
  );

  it("reports a completed run normally", async () => {
    mockApi(0);
    render(<AutomationPage />);
    await screen.findByText(/DNS changes awaiting recovery:/);
    fireEvent.click(screen.getByRole("button", { name: /^Run now$/i }));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "success" }),
      ),
    );
  });

  const resultFor = (
    reason: string,
  ): RunDnsScheduleEvaluatorResponse["results"] => [
    {
      scheduleId: "test",
      scheduleName: "Test override",
      nodeId: "primary",
      action: "skipped",
      reason,
    },
  ];

  it.each([
    "no-validated-primary",
    "node-not-configured",
    "no-configured-nodes",
    "deferred-advanced-blocking-cleanup",
    "deferred-node-unreachable: ECONNREFUSED",
  ])("shows %s as incomplete with a visible result", async (reason) => {
    mockApi(0, 0, resultFor(reason));
    render(<AutomationPage />);
    await screen.findByText(/DNS changes awaiting recovery:/);
    fireEvent.click(screen.getByRole("button", { name: /^Run now$/i }));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: "error",
          message: expect.stringContaining("deferred"),
        }),
      ),
    );
    expect(
      await screen.findByRole("cell", { name: "Test override" }),
    ).toBeVisible();
    expect(pushToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ tone: "success" }),
    );
  });

  it.each([
    "already-applied",
    "already-inactive",
    "dry-run-would-apply",
    "dry-run-would-remove-stale",
  ])("keeps %s as a harmless skip", async (reason) => {
    mockApi(0, 0, resultFor(reason));
    render(<AutomationPage />);
    await screen.findByText(/DNS changes awaiting recovery:/);
    fireEvent.click(screen.getByRole("button", { name: /^Run now$/i }));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "success" }),
      ),
    );
    expect(
      screen.queryByRole("cell", { name: "Test override" }),
    ).not.toBeInTheDocument();
  });

  it.each(["enable", "save"])(
    "does not report an unresolved override as applied after %s",
    async (mutation) => {
      const override: DnsTemporaryOverride = {
        id: "test",
        name: "Test override",
        enabled: false,
        action: "allow",
        advancedBlockingGroupNames: ["test"],
        domainEntries: ["managed.test"],
        domainGroupNames: [],
        nodeIds: ["primary"],
        flushCacheOnChange: false,
        notifyEmails: [],
        notifyDebounceSeconds: 300,
        expiresAt: null,
        createdAt: "2026-09-05T12:00:00Z",
        updatedAt: "2026-09-05T12:00:00Z",
      };
      mockApi(0, 0, resultFor("no-validated-primary"), [override]);
      render(<AutomationPage />);
      await screen.findByText(/DNS changes awaiting recovery:/);
      fireEvent.click(screen.getByRole("button", { name: /^Temporary/ }));
      if (mutation === "enable")
        fireEvent.click(await screen.findByTitle("Enable override"));
      else {
        fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
      }
      await waitFor(() =>
        expect(pushToast).toHaveBeenCalledWith(
          expect.objectContaining({
            tone: "error",
            message: expect.stringContaining(
              "Saved, but DNS changes are incomplete",
            ),
          }),
        ),
      );
      expect(request).toHaveBeenCalledWith(
        "/nodes/dns-schedules/evaluator/run",
        expect.any(Object),
      );
      expect(pushToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ tone: "success" }),
      );
    },
  );
});
