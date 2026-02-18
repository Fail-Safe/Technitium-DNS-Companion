import { describe, expect, it } from "vitest";
import {
    buildDomainExclusionMatchers,
    isDomainExcluded,
    parseDomainExclusionPatterns,
} from "../utils/domainExclusion";

describe("domain exclusion", () => {
  it("parses comma/newline separated list and de-duplicates values", () => {
    const parsed = parseDomainExclusionPatterns(
      "*.trackingdomain.com, ads.example.com\nADS.EXAMPLE.COM\n",
    );

    expect(parsed).toEqual(["*.trackingdomain.com", "ads.example.com"]);
  });

  it("matches wildcard exclusions case-insensitively", () => {
    const matchers = buildDomainExclusionMatchers("*.trackingdomain.com");

    expect(isDomainExcluded("cdn.trackingdomain.com", matchers)).toBe(true);
    expect(isDomainExcluded("CDN.TRACKINGDOMAIN.COM", matchers)).toBe(true);
    expect(isDomainExcluded("trackingdomain.com", matchers)).toBe(false);
  });

  it("matches exact exclusions and ignores trailing dots", () => {
    const matchers = buildDomainExclusionMatchers("noise.example.com.");

    expect(isDomainExcluded("noise.example.com", matchers)).toBe(true);
    expect(isDomainExcluded("noise.example.com.", matchers)).toBe(true);
    expect(isDomainExcluded("api.noise.example.com", matchers)).toBe(false);
  });
});
