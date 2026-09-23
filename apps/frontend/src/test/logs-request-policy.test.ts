import { describe, expect, it } from "vitest";
import {
  isLogsRequestBusy,
  refreshSecondsForDisplayMode,
} from "../utils/logs-request-policy";

describe("DNS Logs request policy", () => {
  it("treats initial and subsequent loads as pager-blocking work", () => {
    expect(isLogsRequestBusy("loading")).toBe(true);
    expect(isLogsRequestBusy("refreshing")).toBe(true);
    expect(isLogsRequestBusy("idle")).toBe(false);
    expect(isLogsRequestBusy("error")).toBe(false);
  });

  it("preserves the active interval or explicit pause when entering paginated mode", () => {
    expect(refreshSecondsForDisplayMode("paginated", 0, 3)).toBe(0);
    expect(refreshSecondsForDisplayMode("paginated", 3, 3)).toBe(3);
    expect(refreshSecondsForDisplayMode("paginated", 30, 3)).toBe(30);
  });

  it("preserves or restores refresh when entering Tail mode", () => {
    expect(refreshSecondsForDisplayMode("tail", 30, 3)).toBe(30);
    expect(refreshSecondsForDisplayMode("tail", 0, 3)).toBe(3);
  });
});
