import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { NodeSessionExpiredBanner } from "../components/common/NodeSessionExpiredBanner";

function PathEcho() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

describe("NodeSessionExpiredBanner", () => {
  it("renders when session auth is enabled and some configured nodes are missing", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <PathEcho />
                <NodeSessionExpiredBanner
                  sessionAuthEnabled={true}
                  authenticated={true}
                  configuredNodeIds={["node1", "node2"]}
                  nodeIds={["node1"]}
                />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Sign in required");
    expect(
      screen.getByRole("button", { name: "Sign in again" }),
    ).toBeInTheDocument();
  });

  it("navigates to /login when CTA is clicked and hides on the login route", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <PathEcho />
                <NodeSessionExpiredBanner
                  sessionAuthEnabled={true}
                  authenticated={true}
                  configuredNodeIds={["node1", "node2"]}
                  nodeIds={["node1"]}
                />
              </>
            }
          />
          <Route
            path="/login"
            element={
              <>
                <PathEcho />
                <div>LOGIN</div>
                <NodeSessionExpiredBanner
                  sessionAuthEnabled={true}
                  authenticated={true}
                  configuredNodeIds={["node1", "node2"]}
                  nodeIds={["node1"]}
                />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("path")).toHaveTextContent("/");
    await user.click(screen.getByRole("button", { name: "Sign in again" }));

    expect(screen.getByTestId("path")).toHaveTextContent("/login");
    expect(screen.getByText("LOGIN")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
