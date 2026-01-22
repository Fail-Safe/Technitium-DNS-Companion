import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BackgroundTokenSecurityBanner } from "../components/common/BackgroundTokenSecurityBanner";

describe("BackgroundTokenSecurityBanner", () => {
  it("renders nothing when the background token is not unsafe", () => {
    const { container } = render(
      <BackgroundTokenSecurityBanner
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
