import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomationPage } from "../pages/AutomationPage";

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

  function mockApi(pending: number, errors = 0) {
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
          results: [],
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
});
