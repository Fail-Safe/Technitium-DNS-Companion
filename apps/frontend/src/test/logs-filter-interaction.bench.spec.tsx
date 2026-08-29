import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOG_FILTER_DEBOUNCE_MS,
  useDebouncedLogFilters,
} from "../hooks/useDebouncedLogFilters";
import { shouldBypassApiRuntimeCache } from "../../pwa-cache-policy";
import {
  isLogsRequestBusy,
  refreshSecondsForDisplayMode,
} from "../utils/logs-request-policy";

const runBenchmarks = process.env.RUN_LOG_FILTER_BENCHMARKS === "true";
const describeBenchmarks = runBenchmarks ? describe : describe.skip;

describeBenchmarks("DNS Logs filter interaction benchmark", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("measures request coalescing and the one-character gate", () => {
    const typed = renderHook(
      ({ client }) => useDebouncedLogFilters("", client),
      { initialProps: { client: "" } },
    );
    const appliedValues: string[] = [];

    for (const value of ["m", "me", "mel"]) {
      typed.rerender({ client: value });
      act(() => vi.advanceTimersByTime(100));
      if (
        typed.result.current.queryClientFilter &&
        appliedValues.at(-1) !== typed.result.current.queryClientFilter
      ) {
        appliedValues.push(typed.result.current.queryClientFilter);
      }
    }
    act(() => vi.advanceTimersByTime(LOG_FILTER_DEBOUNCE_MS));
    if (
      typed.result.current.queryClientFilter &&
      appliedValues.at(-1) !== typed.result.current.queryClientFilter
    ) {
      appliedValues.push(typed.result.current.queryClientFilter);
    }

    const single = renderHook(
      ({ client }) => useDebouncedLogFilters("", client),
      { initialProps: { client: "" } },
    );
    single.rerender({ client: "m" });
    act(() => vi.advanceTimersByTime(LOG_FILTER_DEBOUNCE_MS));
    const automaticSingleCharacterRequests = single.result.current
      .queryClientFilter
      ? 1
      : 0;
    act(() => single.result.current.commitClientFilter());

    const result = {
      model: {
        values: ["m", "me", "mel"],
        intervalMs: 100,
        debounceMs: LOG_FILTER_DEBOUNCE_MS,
      },
      baseline: {
        typedRequests: 3,
        automaticSingleCharacterRequests: 1,
      },
      debounced: {
        typedRequests: appliedValues.length,
        appliedValues,
        automaticSingleCharacterRequests,
        explicitSingleCharacterRequests: single.result.current
          .queryClientFilter
          ? 1
          : 0,
      },
    };

    console.log(JSON.stringify(result, null, 2));
    expect(result.debounced.typedRequests).toBe(1);
    expect(result.debounced.appliedValues).toEqual(["mel"]);
    expect(result.debounced.automaticSingleCharacterRequests).toBe(0);
    expect(result.debounced.explicitSingleCharacterRequests).toBe(1);
  });

  it("measures request admission for the production HAR interaction", () => {
    const harBaseline = {
      browserCancelled: 10,
      cancelledButWorkboxContinued: 10,
      rapidPageSelections: 5,
      paginatedDwellSeconds: 30,
      refreshSeconds: 3,
    };

    const paginatedRefreshSeconds = refreshSecondsForDisplayMode(
      "paginated",
      harBaseline.refreshSeconds,
      harBaseline.refreshSeconds,
    );
    const queryLogsBypassWorkbox = shouldBypassApiRuntimeCache(
      "/api/nodes/logs/combined/stored",
    );
    const after = {
      cancelledRequestsRoutedThroughWorkbox: queryLogsBypassWorkbox
        ? 0
        : harBaseline.browserCancelled,
      admittedRapidPageRequests: [
        "idle",
        "refreshing",
        "refreshing",
        "refreshing",
        "refreshing",
      ].filter((state) => !isLogsRequestBusy(state as "idle" | "refreshing"))
        .length,
      paginatedAutomaticRefreshes:
        paginatedRefreshSeconds > 0
          ? Math.floor(
              harBaseline.paginatedDwellSeconds / paginatedRefreshSeconds,
            )
          : 0,
    };

    const result = {
      baseline: {
        cancelledRequestsRoutedThroughWorkbox:
          harBaseline.cancelledButWorkboxContinued,
        admittedRapidPageRequests: harBaseline.rapidPageSelections,
        paginatedAutomaticRefreshes:
          harBaseline.paginatedDwellSeconds / harBaseline.refreshSeconds,
      },
      controlledAfter: after,
    };

    console.log(JSON.stringify(result, null, 2));
    expect(result.controlledAfter).toEqual({
      cancelledRequestsRoutedThroughWorkbox: 0,
      admittedRapidPageRequests: 1,
      paginatedAutomaticRefreshes: 0,
    });
  });
});
