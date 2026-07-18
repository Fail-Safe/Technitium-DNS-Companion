import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDnsOverridesPrecedenceNoteDismissed,
  rememberDnsOverridesPrecedenceNoteDismissed,
} from "../utils/dns-overrides-precedence-note";

describe("DNS Overrides precedence note", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows the note when no dismissal has been saved", () => {
    expect(isDnsOverridesPrecedenceNoteDismissed()).toBe(false);
  });

  it("remembers a dismissal across reads", () => {
    rememberDnsOverridesPrecedenceNoteDismissed();

    expect(isDnsOverridesPrecedenceNoteDismissed()).toBe(true);
  });

  it("does not treat unrelated stored values as a dismissal", () => {
    window.localStorage.setItem("dnsOverridesPrecedenceNoteDismissed", "false");

    expect(isDnsOverridesPrecedenceNoteDismissed()).toBe(false);
  });

  it("keeps the note available when browser storage cannot be read", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(isDnsOverridesPrecedenceNoteDismissed()).toBe(false);
  });
});
