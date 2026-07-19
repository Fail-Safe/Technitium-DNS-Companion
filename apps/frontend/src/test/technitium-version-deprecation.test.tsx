import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TechnitiumVersionDeprecationBanner } from "../components/common/TechnitiumVersionDeprecationBanner";
import {
  isDeprecatedTechnitiumVersion,
  parseTechnitiumVersion,
} from "../utils/technitium-version-support";

describe("Technitium version deprecation", () => {
  it("parses common Technitium version formats", () => {
    expect(parseTechnitiumVersion("14.3")).toEqual({ major: 14, minor: 3 });
    expect(parseTechnitiumVersion("v15.4.0")).toEqual({
      major: 15,
      minor: 4,
    });
  });

  it("classifies pre-v15 releases as deprecated", () => {
    expect(isDeprecatedTechnitiumVersion("13.6")).toBe(true);
    expect(isDeprecatedTechnitiumVersion("14.3")).toBe(true);
    expect(isDeprecatedTechnitiumVersion("15.0")).toBe(false);
    expect(isDeprecatedTechnitiumVersion("Unknown")).toBe(false);
  });

  it("lists affected nodes and the future minimum version", () => {
    render(
      <TechnitiumVersionDeprecationBanner
        nodes={[
          { id: "node-a", name: "Node A", version: "14.3" },
          { id: "node-b", name: "Node B", version: "13.6" },
        ]}
      />,
    );

    expect(
      screen.getByText("Technitium DNS upgrade required before Companion 2.0"),
    ).toBeInTheDocument();
    expect(screen.getByText(/v15\.3 or later/)).toBeInTheDocument();
    expect(
      screen.getByText("Affected nodes: Node A (14.3), Node B (13.6)"),
    ).toBeInTheDocument();
  });

  it("renders nothing when all nodes meet the current policy", () => {
    const { container } = render(
      <TechnitiumVersionDeprecationBanner nodes={[]} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
