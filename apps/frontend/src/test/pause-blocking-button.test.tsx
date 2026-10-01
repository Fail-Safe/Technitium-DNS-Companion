import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ current: undefined as unknown }));
const toast = vi.hoisted(() => ({ pushToast: vi.fn() }));
vi.mock("../context/useTechnitiumState", () => ({
  useOptionalTechnitiumState: () => state.current,
}));
vi.mock("../context/useToast", () => ({ useToast: () => toast }));

import { PauseBlockingButton } from "../components/layout/PauseBlockingButton";
import { AdvancedBlockingRecoveryBanner } from "../components/layout/AdvancedBlockingRecoveryBanner";

const pause = {
  paused: true,
  confirmedPausedTargetCount: 1,
  pendingTargetCount: 0,
  targets: [
    {
      writeTargetNodeId: "cluster:default:dns.example",
      status: "active" as const,
      expiresAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    },
  ],
};

describe("PauseBlockingButton", () => {
  beforeEach(() => {
    toast.pushToast.mockReset();
  });
  it("renders for installed and enabled Advanced Blocking without a Built-in overview", async () => {
    const reloadAdvancedBlockingPause = vi.fn().mockResolvedValue(undefined);
    state.current = {
      blockingStatus: {
        nodes: [
          {
            nodeId: "dns1",
            builtInEnabled: false,
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: true,
          },
          {
            nodeId: "dns2",
            builtInEnabled: false,
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: true,
          },
        ],
      },
      reloadAdvancedBlockingPause,
    };

    render(<PauseBlockingButton />);

    expect(
      screen.getByRole("button", { name: "Pause blocking" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(reloadAdvancedBlockingPause).toHaveBeenCalled());
  });
  it("keeps a confirmed Advanced pause visible after its live root flag is false", async () => {
    const reloadAdvancedBlockingPause = vi.fn().mockResolvedValue(undefined);
    const resumeAdvancedBlocking = vi.fn().mockResolvedValue({
      ...pause,
      paused: false,
      confirmedPausedTargetCount: 0,
      targets: [],
    });
    state.current = {
      blockingStatus: {
        nodes: [
          {
            nodeId: "advanced",
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: false,
          },
        ],
      },
      advancedBlockingPause: pause,
      reloadAdvancedBlockingPause,
      resumeAdvancedBlocking,
      reloadAdvancedBlocking: vi.fn().mockResolvedValue(undefined),
      reloadBuiltInBlocking: vi.fn().mockResolvedValue(undefined),
      builtInBlocking: { nodes: [] },
    };
    render(<PauseBlockingButton />);
    expect(screen.getByText(/Paused/)).toBeInTheDocument();
    await waitFor(() => expect(reloadAdvancedBlockingPause).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Blocking paused/i }));
    const resume = screen.getByRole("menuitem", { name: /Resume now/i });
    expect(resume).toBeInTheDocument();
    fireEvent.click(resume);
    await waitFor(() => expect(resumeAdvancedBlocking).toHaveBeenCalled());
  });

  it("resumes both effective methods in a mixed deployment", async () => {
    const resumeAdvancedBlocking = vi.fn().mockResolvedValue({
      ...pause,
      paused: false,
      confirmedPausedTargetCount: 0,
      targets: [],
    });
    const reEnableBlocking = vi.fn().mockResolvedValue(undefined);
    state.current = {
      blockingStatus: {
        nodes: [
          {
            nodeId: "advanced",
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: true,
          },
          {
            nodeId: "built-in",
            advancedBlockingInstalled: false,
            advancedBlockingEnabled: false,
          },
        ],
      },
      advancedBlockingPause: pause,
      reloadAdvancedBlockingPause: vi.fn().mockResolvedValue(undefined),
      resumeAdvancedBlocking,
      reloadAdvancedBlocking: vi.fn().mockResolvedValue(undefined),
      reEnableBlocking,
      reloadBuiltInBlocking: vi.fn().mockResolvedValue(undefined),
      builtInBlocking: {
        nodes: [
          {
            nodeId: "built-in",
            isHealthy: true,
            metrics: {
              temporaryDisableBlockingTill: "2030-01-01T00:00:00.000Z",
            },
          },
        ],
      },
    };
    render(<PauseBlockingButton />);
    fireEvent.click(screen.getByRole("button", { name: /Blocking paused/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Resume now/i }));
    await waitFor(() => expect(resumeAdvancedBlocking).toHaveBeenCalled());
    await waitFor(() =>
      expect(reEnableBlocking).toHaveBeenCalledWith("built-in"),
    );
  });

  it("does not report success for an unconfirmed Advanced Blocking pause or empty Built-in target set", async () => {
    const pauseAdvancedBlocking = vi.fn().mockResolvedValue({
      paused: false,
      confirmedPausedTargetCount: 0,
      pendingTargetCount: 0,
      targets: [],
    });
    state.current = {
      blockingStatus: {
        nodes: [
          {
            nodeId: "dns1",
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: true,
          },
        ],
      },
      pauseAdvancedBlocking,
      reloadAdvancedBlocking: vi.fn().mockResolvedValue(undefined),
      reloadAdvancedBlockingPause: vi.fn().mockResolvedValue(undefined),
    };

    render(<PauseBlockingButton />);
    fireEvent.click(screen.getByRole("button", { name: "Pause blocking" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "5 minutes" }));

    await waitFor(() => expect(pauseAdvancedBlocking).toHaveBeenCalledWith(5));
    expect(toast.pushToast).toHaveBeenCalledWith({
      message: "Advanced Blocking pause was not confirmed.",
      tone: "error",
    });
    expect(toast.pushToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ tone: "success" }),
    );
  });

  it("reports only the Advanced result when no Built-in targets exist", async () => {
    const pauseAdvancedBlocking = vi.fn().mockResolvedValue({
      paused: true,
      confirmedPausedTargetCount: 1,
      pendingTargetCount: 0,
      targets: [],
    });
    state.current = {
      blockingStatus: {
        nodes: [
          {
            nodeId: "dns1",
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: true,
          },
        ],
      },
      pauseAdvancedBlocking,
      reloadAdvancedBlocking: vi.fn().mockResolvedValue(undefined),
      reloadAdvancedBlockingPause: vi.fn().mockResolvedValue(undefined),
    };

    render(<PauseBlockingButton />);
    fireEvent.click(screen.getByRole("button", { name: "Pause blocking" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "5 minutes" }));

    await waitFor(() => expect(pauseAdvancedBlocking).toHaveBeenCalledWith(5));
    expect(toast.pushToast).toHaveBeenCalledWith({
      message: "Advanced Blocking paused for 5 minutes.",
      tone: "success",
    });
    expect(toast.pushToast.mock.calls).toHaveLength(1);
  });

  it("pauses both methods and reports each successful operation in a mixed deployment", async () => {
    const pauseAdvancedBlocking = vi.fn().mockResolvedValue({
      paused: true,
      confirmedPausedTargetCount: 1,
      pendingTargetCount: 0,
      targets: [],
    });
    const temporaryDisableBlocking = vi.fn().mockResolvedValue(undefined);
    state.current = {
      blockingStatus: {
        nodes: [
          {
            nodeId: "advanced",
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: true,
          },
          {
            nodeId: "built-in",
            advancedBlockingInstalled: false,
            advancedBlockingEnabled: false,
          },
        ],
      },
      builtInBlocking: {
        nodes: [
          {
            nodeId: "built-in",
            isHealthy: true,
            metrics: { blockingEnabled: true },
          },
        ],
      },
      pauseAdvancedBlocking,
      temporaryDisableBlocking,
      reloadAdvancedBlocking: vi.fn().mockResolvedValue(undefined),
      reloadAdvancedBlockingPause: vi.fn().mockResolvedValue(undefined),
      reloadBuiltInBlocking: vi.fn().mockResolvedValue(undefined),
    };

    render(<PauseBlockingButton />);
    fireEvent.click(screen.getByRole("button", { name: "Pause blocking" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "5 minutes" }));

    await waitFor(() =>
      expect(temporaryDisableBlocking).toHaveBeenCalledWith("built-in", 5),
    );
    expect(toast.pushToast).toHaveBeenCalledWith({
      message: "Advanced Blocking paused for 5 minutes.",
      tone: "success",
    });
    expect(toast.pushToast).toHaveBeenCalledWith({
      message: "Built-in Blocking paused for 5 minutes.",
      tone: "success",
    });
  });
});

describe("PauseBlockingButton recovery and mixed methods", () => {
  beforeEach(() => {
    toast.pushToast.mockReset();
  });

  function context() {
    return {
      blockingStatus: {
        nodes: [
          {
            nodeId: "dns1",
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: true,
          },
        ],
      },
      builtInBlocking: {
        nodes: [
          {
            nodeId: "dns1",
            isHealthy: true,
            metrics: {
              blockingEnabled: true,
              temporaryDisableBlockingTill: undefined as string | undefined,
            },
          },
        ],
      },
      advancedBlockingPause: undefined as typeof pause | undefined,
      pauseAdvancedBlocking: vi.fn().mockResolvedValue(pause),
      resumeAdvancedBlocking: vi.fn().mockResolvedValue({
        paused: false,
        confirmedPausedTargetCount: 0,
        pendingTargetCount: 0,
        targets: [],
      }),
      temporaryDisableBlocking: vi.fn().mockResolvedValue(undefined),
      reEnableBlocking: vi.fn().mockResolvedValue(undefined),
      reloadAdvancedBlocking: vi.fn().mockResolvedValue(undefined),
      reloadAdvancedBlockingPause: vi.fn().mockResolvedValue(undefined),
      reloadBuiltInBlocking: vi.fn().mockResolvedValue(undefined),
    };
  }

  it.each([0, 1])(
    "reports pending confirmation informationally with %i confirmed targets",
    async (confirmed) => {
      const ctx = context();
      state.current = {
        ...ctx,
        builtInBlocking: { nodes: [] },
        pauseAdvancedBlocking: vi.fn().mockResolvedValue({
          ...pause,
          paused: confirmed > 0,
          confirmedPausedTargetCount: confirmed,
          pendingTargetCount: 1,
          targets: [{ ...pause.targets[0], status: "activation-pending" }],
        }),
      };
      render(<PauseBlockingButton />);
      fireEvent.click(screen.getByRole("button", { name: "Pause blocking" }));
      expect(screen.getByRole("note")).toHaveTextContent(
        "pauses all app groups",
      );
      expect(screen.getByRole("note")).toHaveTextContent(
        "until resume is confirmed",
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "5 minutes" }));
      await waitFor(() =>
        expect(toast.pushToast).toHaveBeenCalledWith(
          expect.objectContaining({
            tone: "info",
            message: expect.stringContaining("pending"),
          }),
        ),
      );
      expect(toast.pushToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ tone: "success" }),
      );
      expect(toast.pushToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ tone: "error" }),
      );
    },
  );

  it("pauses both methods on the same node", async () => {
    const ctx = context();
    state.current = ctx;
    render(<PauseBlockingButton />);
    fireEvent.click(screen.getByRole("button", { name: "Pause blocking" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "5 minutes" }));
    await waitFor(() =>
      expect(ctx.pauseAdvancedBlocking).toHaveBeenCalledWith(5),
    );
    await waitFor(() =>
      expect(ctx.temporaryDisableBlocking).toHaveBeenCalledWith("dns1", 5),
    );
  });

  it("keeps failed restore ownership visible after reload", () => {
    const ctx = context();
    state.current = {
      ...ctx,
      builtInBlocking: { nodes: [] },
      blockingStatus: {
        nodes: [
          {
            nodeId: "dns1",
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: false,
          },
        ],
      },
      advancedBlockingPause: {
        paused: false,
        confirmedPausedTargetCount: 0,
        pendingTargetCount: 1,
        targets: [
          {
            ...pause.targets[0],
            status: "resume-pending",
            lastError: "offline",
          },
        ],
      },
    };
    render(<PauseBlockingButton />);
    fireEvent.click(
      screen.getByRole("button", { name: /Advanced Blocking resume failed/ }),
    );
    expect(screen.getByText("Resume failed")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Resume now" }),
    ).toBeInTheDocument();
  });

  it("resumes Built-in even when Advanced resume is rejected", async () => {
    const ctx = context();
    ctx.advancedBlockingPause = pause;
    ctx.builtInBlocking.nodes[0].metrics.temporaryDisableBlockingTill =
      "2030-01-01T00:00:00Z";
    ctx.resumeAdvancedBlocking.mockRejectedValue(new Error("forbidden"));
    state.current = ctx;
    render(<PauseBlockingButton />);
    fireEvent.click(screen.getByRole("button", { name: /Blocking paused/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Resume now" }));
    await waitFor(() =>
      expect(ctx.reEnableBlocking).toHaveBeenCalledWith("dns1"),
    );
    await waitFor(() =>
      expect(toast.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: "error",
          message: expect.stringContaining("forbidden"),
        }),
      ),
    );
    expect(toast.pushToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ tone: "success" }),
    );
  });

  it("does not announce resume success when Advanced restore remains pending and no Built-in targets exist", async () => {
    const ctx = context();
    state.current = {
      ...ctx,
      builtInBlocking: { nodes: [] },
      advancedBlockingPause: pause,
      resumeAdvancedBlocking: vi.fn().mockResolvedValue({
        paused: false,
        pendingTargetCount: 1,
        targets: [
          {
            ...pause.targets[0],
            status: "resume-pending",
            lastError: "restore failed",
          },
        ],
      }),
    };
    render(<PauseBlockingButton />);
    fireEvent.click(screen.getByRole("button", { name: /Blocking paused/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Resume now" }));
    await waitFor(() =>
      expect(toast.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "error" }),
      ),
    );
    expect(toast.pushToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ tone: "success" }),
    );
  });

  it("reports unreadable Advanced targets instead of announcing complete success", async () => {
    const ctx = context();
    state.current = {
      ...ctx,
      builtInBlocking: { nodes: [] },
      pauseAdvancedBlocking: vi.fn().mockResolvedValue({
        ...pause,
        probeErrors: [{ nodeId: "dns2", error: "offline" }],
      }),
    };
    render(<PauseBlockingButton />);
    fireEvent.click(screen.getByRole("button", { name: "Pause blocking" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "5 minutes" }));
    await waitFor(() =>
      expect(toast.pushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: "error",
          message: expect.stringContaining("dns2: offline"),
        }),
      ),
    );
    expect(toast.pushToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ tone: "success" }),
    );
  });

  it("extends a native pause even though its live blockingEnabled flag is false", async () => {
    const ctx = context();
    ctx.blockingStatus.nodes[0].advancedBlockingEnabled = false;
    ctx.blockingStatus.nodes[0].advancedBlockingInstalled = false;
    ctx.builtInBlocking.nodes[0].metrics.blockingEnabled = false;
    ctx.builtInBlocking.nodes[0].metrics.temporaryDisableBlockingTill =
      "2030-01-01T00:00:00Z";
    state.current = ctx;
    render(<PauseBlockingButton />);
    fireEvent.click(screen.getByRole("button", { name: /Blocking paused/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "5 minutes" }));
    await waitFor(() =>
      expect(ctx.temporaryDisableBlocking).toHaveBeenCalledWith("dns1", 5),
    );
    expect(ctx.pauseAdvancedBlocking).not.toHaveBeenCalled();
  });
});

describe("Advanced Blocking recovery warning", () => {
  afterEach(() => vi.useRealTimers());
  function recovery(status: string, expiresAt: string, lastError?: string) {
    state.current = {
      advancedBlockingPause: {
        ...pause,
        targets: [{ ...pause.targets[0], status, expiresAt, lastError }],
      },
    };
  }

  it.each(["active", "activation-pending", "resume-pending"])(
    "shows the target and cause after expiry even while the row remains %s",
    (status) => {
      recovery(
        status,
        "2000-01-01T00:00:00Z",
        "Current Primary credential unavailable",
      );
      render(<AdvancedBlockingRecoveryBanner />);
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("resume failed");
      expect(alert).toHaveTextContent("Blocking may still be disabled");
      expect(alert).toHaveTextContent("cluster:default:dns.example");
      expect(alert).toHaveTextContent("Current Primary credential unavailable");
      expect(alert).toHaveTextContent("Apps: Modify on the current Primary");
      expect(alert).toHaveTextContent("Resume now");
    },
  );

  it("distinguishes awaiting restoration from a reported failure", () => {
    recovery("resume-pending", "2030-01-01T00:00:00Z");
    render(<AdvancedBlockingRecoveryBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("not yet confirmed");
  });

  it("does not call an unexpired activation failure a resume failure", () => {
    recovery("activation-pending", "2030-01-01T00:00:00Z", "offline");
    render(<AdvancedBlockingRecoveryBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("persists across remount and clears after confirmed restoration", () => {
    recovery("resume-pending", "2000-01-01T00:00:00Z", "offline");
    const first = render(<AdvancedBlockingRecoveryBanner />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    first.unmount();
    const second = render(<AdvancedBlockingRecoveryBanner />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    state.current = { advancedBlockingPause: { ...pause, targets: [] } };
    second.rerender(<AdvancedBlockingRecoveryBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns as expiry passes without waiting for a successful status refresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
    recovery("activation-pending", "2026-10-01T12:00:01Z", "offline");
    render(
      <>
        <PauseBlockingButton />
        <AdvancedBlockingRecoveryBanner />
      </>,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("alert")).toHaveTextContent("resume failed");
    expect(screen.getByRole("button", { name: /resume failed/ })).toHaveClass(
      "app-header__pause--error",
    );
  });

  it("lists only targets awaiting restoration in a mixed pause", () => {
    state.current = {
      advancedBlockingPause: {
        ...pause,
        targets: [
          { ...pause.targets[0], writeTargetNodeId: "node:healthy" },
          {
            ...pause.targets[0],
            writeTargetNodeId: "node:offline",
            status: "resume-pending",
            lastError: "offline",
          },
        ],
      },
    };
    render(<AdvancedBlockingRecoveryBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent("node:offline");
    expect(screen.getByRole("alert")).not.toHaveTextContent("node:healthy");
  });
});
