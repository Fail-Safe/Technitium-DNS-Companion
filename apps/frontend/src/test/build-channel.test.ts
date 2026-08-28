import { describe, expect, it } from "vitest";
import {
  describeBuildChannel,
  formatBuildChannelStatus,
} from "../utils/build-channel";

describe("build channel presentation", () => {
  it("identifies beta builds without treating stable equality as update status", () => {
    const details = describeBuildChannel("beta");

    expect(details).toEqual({
      kind: "beta",
      badge: "BETA",
      statusLabel: "Running beta preview",
    });
    expect(formatBuildChannelStatus(details, "1.10.1", false)).toBe(
      "Running beta preview · Latest stable: v1.10.1",
    );
  });

  it("leaves stable builds on the release update path", () => {
    const details = describeBuildChannel("stable");

    expect(details).toEqual({
      kind: "stable",
      badge: null,
      statusLabel: null,
    });
    expect(formatBuildChannelStatus(details, "1.10.1", false)).toBeNull();
  });

  it("marks local builds as development builds", () => {
    const details = describeBuildChannel(" development ");

    expect(details.kind).toBe("development");
    expect(details.badge).toBe("DEV");
    expect(formatBuildChannelStatus(details, null, false)).toBe(
      "Development build",
    );
  });

  it("fails unknown channels into an explicit preview state", () => {
    const details = describeBuildChannel("unexpected-channel");

    expect(details.kind).toBe("preview");
    expect(details.badge).toBe("PREVIEW");
    expect(formatBuildChannelStatus(details, null, true)).toBe(
      "Running preview build · Stable release check unavailable",
    );
  });
});
