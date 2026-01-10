import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiFetch,
  ApiFetchError,
  getAuthUnauthorizedEventName,
  getNetworkErrorEventName,
  getNetworkRecoveredEventName,
} from "../config";

describe("apiFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("throws ApiFetchError(kind=network) and emits a network event when fetch rejects", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    const networkErrorEvents: Array<unknown> = [];
    const networkRecoveredEvents: Array<unknown> = [];
    const onNetworkError = (event: Event) => {
      networkErrorEvents.push(event);
    };
    const onNetworkRecovered = (event: Event) => {
      networkRecoveredEvents.push(event);
    };

    const networkErrorEventName = getNetworkErrorEventName();
    const networkRecoveredEventName = getNetworkRecoveredEventName();
    window.addEventListener(networkErrorEventName, onNetworkError);
    window.addEventListener(networkRecoveredEventName, onNetworkRecovered);

    try {
      await apiFetch("/nodes");
      throw new Error("Expected apiFetch to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiFetchError);
      const apiError = error as ApiFetchError;
      expect(apiError.kind).toBe("network");
      expect(apiError.path).toBe("/nodes");
      expect(apiError.url).toBe("/api/nodes");
    } finally {
      window.removeEventListener(networkErrorEventName, onNetworkError);
      window.removeEventListener(networkRecoveredEventName, onNetworkRecovered);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(networkErrorEvents.length).toBeGreaterThanOrEqual(1);

    const last = networkErrorEvents[
      networkErrorEvents.length - 1
    ] as CustomEvent<{ url: string; path: string; online?: boolean }>;
    expect(last.detail.path).toBe("/nodes");
    expect(last.detail.url).toBe("/api/nodes");

    // Recovery: the first successful response after a network failure should emit
    // a single recovered event.
    const fetchMock2 = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock2);

    const recoveredEvents: Array<unknown> = [];
    const recoveredHandler = (event: Event) => recoveredEvents.push(event);
    window.addEventListener(networkRecoveredEventName, recoveredHandler);
    try {
      const response = await apiFetch("/nodes");
      expect(response.status).toBe(200);
    } finally {
      window.removeEventListener(networkRecoveredEventName, recoveredHandler);
    }

    expect(recoveredEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("emits unauthorized event when the backend returns 401", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    const events: Event[] = [];
    const handler = (event: Event) => events.push(event);
    const eventName = getAuthUnauthorizedEventName();
    window.addEventListener(eventName, handler);

    try {
      const response = await apiFetch("/nodes");
      expect(response.status).toBe(401);
    } finally {
      window.removeEventListener(eventName, handler);
    }

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("does not emit network events for aborted fetches", async () => {
    const abortError = new DOMException(
      "The operation was aborted.",
      "AbortError",
    );
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    const networkErrorEvents: Event[] = [];
    const networkRecoveredEvents: Event[] = [];
    const onNetworkError = (event: Event) => networkErrorEvents.push(event);
    const onNetworkRecovered = (event: Event) =>
      networkRecoveredEvents.push(event);

    window.addEventListener(getNetworkErrorEventName(), onNetworkError);
    window.addEventListener(getNetworkRecoveredEventName(), onNetworkRecovered);

    const controller = new AbortController();
    controller.abort();

    try {
      await apiFetch("/nodes", { signal: controller.signal });
      throw new Error("Expected apiFetch to throw");
    } catch (error) {
      expect(error).not.toBeInstanceOf(ApiFetchError);
      expect(error).toBe(abortError);
    } finally {
      window.removeEventListener(getNetworkErrorEventName(), onNetworkError);
      window.removeEventListener(
        getNetworkRecoveredEventName(),
        onNetworkRecovered,
      );
    }

    expect(networkErrorEvents.length).toBe(0);
    expect(networkRecoveredEvents.length).toBe(0);
  });
});
