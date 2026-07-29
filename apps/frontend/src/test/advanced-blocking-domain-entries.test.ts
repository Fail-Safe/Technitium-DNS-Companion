import { describe, expect, it } from "vitest";
import type { AdvancedBlockingConfig } from "../types/advancedBlocking";
import {
  getNewRegexEntryCandidate,
  isRegexDomainType,
} from "../utils/advanced-blocking-domain-entries";

const config = {
  groups: [
    {
      allowedRegex: ["^allowed\\.example$"],
      blockedRegex: ["^blocked\\.example$"],
    },
  ],
} as AdvancedBlockingConfig;

describe("Advanced Blocking domain entries", () => {
  it("identifies both regex domain types", () => {
    expect(isRegexDomainType("allowedRegex")).toBe(true);
    expect(isRegexDomainType("blockedRegex")).toBe(true);
    expect(isRegexDomainType("allowed")).toBe(false);
    expect(isRegexDomainType("blocked")).toBe(false);
  });

  it("prepares a trimmed new regex entry for the draggable preview", () => {
    expect(
      getNewRegexEntryCandidate(
        "  ^new\\.example$  ",
        "allowedRegex",
        config,
      ),
    ).toBe("^new\\.example$");
  });

  it("does not prepare an entry that already exists for the selected type", () => {
    expect(
      getNewRegexEntryCandidate(
        "^allowed\\.example$",
        "allowedRegex",
        config,
      ),
    ).toBeNull();
    expect(
      getNewRegexEntryCandidate(
        "^blocked\\.example$",
        "blockedRegex",
        config,
      ),
    ).toBeNull();
  });
});
