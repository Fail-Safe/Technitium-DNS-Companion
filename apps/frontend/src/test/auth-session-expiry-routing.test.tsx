import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import LoginPage from "../pages/LoginPage";

let mockedAuthStatus: {
  sessionAuthEnabled: boolean;
  authenticated: boolean;
  configuredNodeIds: string[];
  nodeIds: string[];
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
      },
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
      login: vi.fn(async () => {}),
      logout: vi.fn(async () => {}),
    }),
  };
});

describe("Auth routing when node session expires", () => {
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
});
