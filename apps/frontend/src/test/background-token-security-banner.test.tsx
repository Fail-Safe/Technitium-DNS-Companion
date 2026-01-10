import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BackgroundTokenSecurityBanner } from "../components/common/BackgroundTokenSecurityBanner";

describe("BackgroundTokenSecurityBanner", () => {
  it("renders nothing when there is no migration CTA and no unsafe-token banner", () => {
    const { container } = render(
      <BackgroundTokenSecurityBanner
        authenticated={false}
        clusterTokenConfigured={false}
        backgroundPtrToken={{
          configured: false,
          sessionAuthEnabled: true,
          validated: false,
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("shows migration CTA when authenticated and cluster token is configured", async () => {
    const user = userEvent.setup();
    const prevOverflow = document.body.style.overflow;

    render(
      <BackgroundTokenSecurityBanner
        authenticated={true}
        clusterTokenConfigured={true}
        backgroundPtrToken={{
          configured: false,
          sessionAuthEnabled: true,
          validated: false,
        }}
      />,
    );

    expect(
      screen.getByText(/TECHNITIUM_CLUSTER_TOKEN is deprecated/i),
    ).toBeInTheDocument();

    const migrateButton = screen.getByRole("button", { name: "Migrate" });
    expect(migrateButton).toBeInTheDocument();

    // Opening the modal is the critical regression check for the CTA.
    await user.click(migrateButton);

    expect(
      screen.getByRole("dialog", { name: "Create Read-Only Background Token" }),
    ).toBeInTheDocument();
    // Regression check: background page should not scroll behind the modal.
    expect(document.body.style.overflow).toBe("hidden");

    expect(
      screen.getByRole("button", { name: "Create token" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.body.style.overflow).toBe(prevOverflow);
  });

  it("copies generated token when the token textarea is clicked", async () => {
    const user = userEvent.setup();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const tokenValue = "abc123-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            username: "companion-readonly",
            tokenName: "background-ptr",
            token: tokenValue,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BackgroundTokenSecurityBanner
        authenticated={true}
        clusterTokenConfigured={true}
        backgroundPtrToken={{
          configured: false,
          sessionAuthEnabled: true,
          validated: false,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Migrate" }));
    await user.click(screen.getByRole("button", { name: "Create token" }));

    await screen.findByText(/Click the token to copy it:/);

    const textarea = document.querySelector(
      ".background-token-migration-modal__token",
    ) as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();

    await user.click(textarea!);
    expect(writeText).toHaveBeenCalledWith(tokenValue);

    expect(screen.getByText(/Copied!?/)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("shows actionable error when migration is denied", async () => {
    const user = userEvent.setup();

    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            message:
              "Migration failed: TECHNITIUM_CLUSTER_TOKEN was denied permission to create users/tokens.",
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BackgroundTokenSecurityBanner
        authenticated={true}
        clusterTokenConfigured={true}
        backgroundPtrToken={{
          configured: false,
          sessionAuthEnabled: true,
          validated: false,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Migrate" }));
    await user.click(screen.getByRole("button", { name: "Create token" }));

    expect(
      await screen.findByText(/insufficient permissions/i),
    ).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/TECHNITIUM_BACKGROUND_TOKEN/i);

    vi.unstubAllGlobals();
  });

  it("does not show migration CTA when clusterTokenConfigured is undefined", () => {
    const { container } = render(
      <BackgroundTokenSecurityBanner
        authenticated={true}
        clusterTokenConfigured={undefined}
        backgroundPtrToken={{
          configured: false,
          sessionAuthEnabled: true,
          validated: false,
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("shows unsafe-token banner with the correct title for too-privileged tokens", () => {
    render(
      <BackgroundTokenSecurityBanner
        authenticated={false}
        clusterTokenConfigured={false}
        backgroundPtrToken={{
          configured: true,
          sessionAuthEnabled: true,
          validated: true,
          okForPtr: false,
          reason:
            "Generated token is too privileged (has Administration: View permission).",
          username: "companion-readonly",
          tooPrivilegedSections: ["Administration"],
        }}
      />,
    );

    expect(
      screen.getByText("Background token is too privileged"),
    ).toBeInTheDocument();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Generated token is too privileged",
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "user: companion-readonly",
    );
  });

  it("shows unsafe-token banner with access title when the reason indicates missing permissions", () => {
    render(
      <BackgroundTokenSecurityBanner
        authenticated={false}
        clusterTokenConfigured={false}
        backgroundPtrToken={{
          configured: true,
          sessionAuthEnabled: true,
          validated: true,
          okForPtr: false,
          reason:
            "Generated token does not have DnsClient: View permission required for PTR lookups.",
        }}
      />,
    );

    expect(
      screen.getByText("Background token lacks required access"),
    ).toBeInTheDocument();
  });
});
