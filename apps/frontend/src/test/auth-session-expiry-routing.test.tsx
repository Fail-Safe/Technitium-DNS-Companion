import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LoginPage from "../pages/LoginPage";
import { isNodeSessionRequiredButMissing } from "../utils/authSession";

const authMock = vi.hoisted(() => ({
  login: vi.fn(),
  continueWithSso: vi.fn(),
}));

let mockedAuthError: string | null = null;
let mockedSsoSuppressed = false;

let mockedAuthStatus: {
  sessionAuthEnabled: boolean;
  authenticated: boolean;
  configuredNodeIds: string[];
  nodeIds: string[];
  unreachableNodeIds?: string[];
  trustedSso?: {
    enabled: boolean;
    available: boolean;
    manualLoginAllowed: boolean;
    error?: "identity-not-authorized" | "invalid-proxy-assertion";
  };
} | null = null;

vi.mock("../context/useAuth", async () => {
  const actual =
    await vi.importActual<typeof import("../context/useAuth")>(
      "../context/useAuth",
    );

  return {
    ...actual,
    useAuth: () => ({
      status: {
        sessionAuthEnabled: mockedAuthStatus?.sessionAuthEnabled ?? true,
        authenticated: mockedAuthStatus?.authenticated ?? true,
        configuredNodeIds: mockedAuthStatus?.configuredNodeIds ?? ["node1"],
        nodeIds: mockedAuthStatus?.nodeIds ?? [],
        unreachableNodeIds: mockedAuthStatus?.unreachableNodeIds ?? [],
        trustedSso: mockedAuthStatus?.trustedSso,
      },
      loading: false,
      error: mockedAuthError,
      refresh: vi.fn(async () => {}),
      login: authMock.login,
      logout: vi.fn(async () => {}),
      continueWithSso: authMock.continueWithSso,
      ssoSuppressed: mockedSsoSuppressed,
    }),
  };
});

describe("Auth routing when node session expires", () => {
  beforeEach(() => {
    authMock.login.mockReset();
    authMock.login.mockResolvedValue(undefined);
    authMock.continueWithSso.mockReset();
    authMock.continueWithSso.mockResolvedValue(undefined);
    mockedAuthError = null;
    mockedSsoSuppressed = false;
  });

  it("shows login page (does not redirect) when cookie is valid but nodeIds is empty", () => {
    mockedAuthStatus = {
      sessionAuthEnabled: true,
      authenticated: true,
      configuredNodeIds: ["node1"],
      nodeIds: [],
    };

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/" element={<div>HOME</div>} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("HOME")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("shows login page (does not redirect) when some configured nodes are missing from nodeIds", () => {
    mockedAuthStatus = {
      sessionAuthEnabled: true,
      authenticated: true,
      configuredNodeIds: ["node1", "node2"],
      nodeIds: ["node1"],
    };

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/" element={<div>HOME</div>} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText("HOME")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
  });

  it("shows session-expired message when redirected with that reason", () => {
    mockedAuthStatus = {
      sessionAuthEnabled: true,
      authenticated: false,
      configuredNodeIds: ["node1"],
      nodeIds: ["node1"],
    };

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/login",
            state: { from: { pathname: "/logs" }, reason: "session-expired" },
          },
        ]}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Your Companion session expired. Please sign in again."),
    ).toBeInTheDocument();
  });

  it("marks the 2FA code as required after Technitium requires TOTP", async () => {
    const user = userEvent.setup();
    mockedAuthStatus = {
      sessionAuthEnabled: true,
      authenticated: false,
      configuredNodeIds: ["node1"],
      nodeIds: [],
    };
    authMock.login.mockRejectedValueOnce(
      new Error(
        "Unable to authenticate to any configured Technitium node\nnode1 (failed/2fa-required): A time-based one-time password (TOTP) is required for user: admin",
      ),
    );

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("Username"), "admin");
    await user.type(screen.getByLabelText("Password"), "secret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Enter your 2FA code and try again."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("2FA code (required)")).toHaveFocus();
  });

  it("does not require login when missing node tokens are only for unreachable nodes", () => {
    expect(
      isNodeSessionRequiredButMissing({
        sessionAuthEnabled: true,
        authenticated: true,
        configuredNodeIds: ["node1", "node2"],
        nodeIds: ["node2"],
        unreachableNodeIds: ["node1"],
      }),
    ).toBe(false);
  });

  it("still requires login when a reachable configured node has no token", () => {
    expect(
      isNodeSessionRequiredButMissing({
        sessionAuthEnabled: true,
        authenticated: true,
        configuredNodeIds: ["node1", "node2"],
        nodeIds: ["node2"],
        unreachableNodeIds: [],
      }),
    ).toBe(true);
  });

  it.each([
    ["identity-not-authorized" as const, "Access denied"],
    ["invalid-proxy-assertion" as const, "SSO is unavailable"],
  ])("shows the %s SSO state without a password form", (error, heading) => {
    mockedAuthStatus = {
      sessionAuthEnabled: true,
      authenticated: false,
      configuredNodeIds: ["node1"],
      nodeIds: [],
      trustedSso: {
        enabled: true,
        available: false,
        manualLoginAllowed: false,
        error,
      },
    };

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("keeps the password form visible for direct break-glass access", () => {
    mockedAuthStatus = {
      sessionAuthEnabled: true,
      authenticated: false,
      configuredNodeIds: ["node1"],
      nodeIds: [],
      trustedSso: {
        enabled: true,
        available: false,
        manualLoginAllowed: true,
      },
    };
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
  });

  it("offers Continue with SSO after a deliberate local logout", async () => {
    const user = userEvent.setup();
    mockedSsoSuppressed = true;
    mockedAuthStatus = {
      sessionAuthEnabled: true,
      authenticated: false,
      configuredNodeIds: ["node1"],
      nodeIds: [],
      trustedSso: {
        enabled: true,
        available: true,
        manualLoginAllowed: false,
      },
    };
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Continue with SSO" }));
    expect(authMock.continueWithSso).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });
});
