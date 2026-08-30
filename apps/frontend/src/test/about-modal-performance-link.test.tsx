import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AboutModal } from "../components/common/AboutModal";

vi.mock("../hooks/useLatestRelease", () => ({
  useLatestRelease: () => ({
    latestVersion: null,
    latestReleaseUrl: null,
    isChecking: false,
    isUpdateAvailable: false,
    error: null,
  }),
}));

describe("AboutModal performance documentation", () => {
  it("links to the public DNS Logs performance overview", () => {
    render(<AboutModal isOpen onClose={vi.fn()} />);

    const link = screen.getByRole("link", {
      name: /DNS Logs Performance/i,
    });

    expect(link).toHaveAttribute(
      "href",
      "https://fail-safe.github.io/Technitium-DNS-Companion/performance/",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
