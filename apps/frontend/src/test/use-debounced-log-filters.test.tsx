import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOG_FILTER_DEBOUNCE_MS,
  useDebouncedLogFilters,
} from "../hooks/useDebouncedLogFilters";

describe("useDebouncedLogFilters", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces a typed client filter into one applied value", () => {
    const { result, rerender } = renderHook(
      ({ client }) => useDebouncedLogFilters("", client),
      { initialProps: { client: "" } },
    );

    rerender({ client: "m" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ client: "me" });
    act(() => vi.advanceTimersByTime(100));
    rerender({ client: "mel" });

    act(() => vi.advanceTimersByTime(LOG_FILTER_DEBOUNCE_MS - 1));
    expect(result.current.queryClientFilter).toBe("");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.queryClientFilter).toBe("mel");
    expect(result.current.clientFilterPending).toBe(false);
  });

  it("requires an explicit commit for a one-character client filter", () => {
    const { result, rerender } = renderHook(
      ({ client }) => useDebouncedLogFilters("", client),
      { initialProps: { client: "" } },
    );

    rerender({ client: "m" });
    act(() => vi.advanceTimersByTime(LOG_FILTER_DEBOUNCE_MS));

    expect(result.current.queryClientFilter).toBe("");
    expect(result.current.clientFilterPending).toBe(true);

    act(() => result.current.commitClientFilter());
    expect(result.current.queryClientFilter).toBe("m");
    expect(result.current.clientFilterPending).toBe(false);
  });

  it("clears an explicitly committed client filter after the debounce", () => {
    const { result, rerender } = renderHook(
      ({ client }) => useDebouncedLogFilters("", client),
      { initialProps: { client: "m" } },
    );

    act(() => result.current.commitClientFilter());
    expect(result.current.queryClientFilter).toBe("m");

    rerender({ client: "" });
    act(() => vi.advanceTimersByTime(LOG_FILTER_DEBOUNCE_MS));
    expect(result.current.queryClientFilter).toBe("");
  });

  it("debounces domains but allows explicit commits immediately", () => {
    const { result, rerender } = renderHook(
      ({ domain }) => useDebouncedLogFilters(domain, ""),
      { initialProps: { domain: "" } },
    );

    rerender({ domain: "example.com" });
    expect(result.current.queryDomainFilter).toBe("");

    act(() => result.current.commitDomainFilter());
    expect(result.current.queryDomainFilter).toBe("example.com");
  });
});
