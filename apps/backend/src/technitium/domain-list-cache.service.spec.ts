import { jest } from "@jest/globals";
import type { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import type { AdvancedBlockingService } from "./advanced-blocking.service";
import {
  DomainListCacheService,
  buildConditionalHeaders,
  parseRetryAfter,
  runWithConcurrencyLimit,
} from "./domain-list-cache.service";
import type { DomainListPersistenceService } from "./domain-list-persistence.service";
import type { TechnitiumService } from "./technitium.service";

describe("DomainListCacheService scheduled refresh auth mode", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("uses background auth to read config and to refresh lists on the interval", async () => {
    const httpService = {} as unknown as HttpService;

    const getSnapshotWithAuth = jest.fn().mockResolvedValue({
      config: {
        blockListUrlUpdateIntervalHours: 0,
        blockListUrlUpdateIntervalMinutes: 1, // 1 minute
      },
    });

    const advancedBlockingService = {
      getSnapshotWithAuth,
    } as unknown as AdvancedBlockingService;

    const technitiumService = {
      listNodes: jest.fn(),
    } as unknown as TechnitiumService;

    const persistenceService = {
      initialize: jest.fn(),
    } as unknown as DomainListPersistenceService;

    const service = new DomainListCacheService(
      httpService,
      advancedBlockingService,
      technitiumService,
      persistenceService,
    );

    const refreshListsSpy = jest
      .spyOn(service, "refreshLists")

      .mockResolvedValue();

    // scheduleNodeRefresh is intentionally private; call it via a runtime
    // lookup for a focused behavior test.
    const schedule = (service as unknown as Record<string, unknown>)[
      "scheduleNodeRefresh"
    ];
    if (typeof schedule !== "function") {
      throw new Error("scheduleNodeRefresh is not available on service");
    }

    await (schedule as (nodeId: string) => Promise<void>).call(service, "nodeA");

    expect(getSnapshotWithAuth).toHaveBeenCalledWith("nodeA", "background");

    // Trigger the interval.
    const timers = jest as unknown as {
      advanceTimersByTime: (msToRun: number) => void;
    };
    timers.advanceTimersByTime(60_000);

    expect(refreshListsSpy).toHaveBeenCalledWith("nodeA", {
      authMode: "background",
    });

    service.stopScheduledRefreshes();
  });
});

// ── Blocklist refresh load-reduction fixes (issue #70) ──────────────────────

describe("buildConditionalHeaders", () => {
  it("returns empty when no cached validators", () => {
    expect(buildConditionalHeaders(undefined)).toEqual({});
    expect(buildConditionalHeaders({})).toEqual({});
  });
  it("sets If-None-Match from cached etag", () => {
    expect(buildConditionalHeaders({ etag: '"abc"' })).toEqual({
      "If-None-Match": '"abc"',
    });
  });
  it("sets If-Modified-Since from cached lastModified", () => {
    expect(
      buildConditionalHeaders({ lastModified: "Wed, 21 Oct 2026 07:28:00 GMT" }),
    ).toEqual({
      "If-Modified-Since": "Wed, 21 Oct 2026 07:28:00 GMT",
    });
  });
  it("sets both when both are present", () => {
    const h = buildConditionalHeaders({
      etag: '"abc"',
      lastModified: "Wed, 21 Oct 2026 07:28:00 GMT",
    });
    expect(h["If-None-Match"]).toBe('"abc"');
    expect(h["If-Modified-Since"]).toBe("Wed, 21 Oct 2026 07:28:00 GMT");
  });
});

describe("parseRetryAfter", () => {
  it("returns null for missing or unparseable values", () => {
    expect(parseRetryAfter(undefined)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("not-a-date-or-number")).toBeNull();
  });
  it("parses seconds-from-now form", () => {
    const before = Date.now();
    const result = parseRetryAfter("60");
    const after = Date.now();
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(result!.getTime()).toBeLessThanOrEqual(after + 60_000);
  });
  it("treats whitespace correctly", () => {
    const before = Date.now();
    const result = parseRetryAfter("  120  ");
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThanOrEqual(before + 120_000);
  });
  it("parses HTTP-date form", () => {
    const result = parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT");
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe("2026-10-21T07:28:00.000Z");
  });
  it("rejects negative seconds", () => {
    expect(parseRetryAfter("-10")).toBeNull();
  });
});

describe("runWithConcurrencyLimit", () => {
  it("preserves input order in the result array", async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await runWithConcurrencyLimit(
      items,
      async (n) => n * 10,
      3,
      0,
    );
    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it("caps simultaneous in-flight workers at maxConcurrent", async () => {
    let inFlight = 0;
    let maxObserved = 0;
    const worker = async (n: number) => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return n;
    };
    await runWithConcurrencyLimit([1, 2, 3, 4, 5, 6, 7, 8], worker, 3, 0);
    expect(maxObserved).toBeLessThanOrEqual(3);
  });

  it("returns empty array for empty input without invoking worker", async () => {
    const worker = jest.fn();
    const result = await runWithConcurrencyLimit([], worker as never, 3, 0);
    expect(result).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });
});

describe("DomainListCacheService.fetchDomainListOnce", () => {
  function makeService(httpGet: jest.Mock) {
    const httpService = { get: httpGet } as unknown as HttpService;
    return new DomainListCacheService(
      httpService,
      {} as unknown as AdvancedBlockingService,
      {} as unknown as TechnitiumService,
      {} as unknown as DomainListPersistenceService,
    );
  }

  type Internals = {
    fetchDomainListOnce: (
      url: string,
      hash: string,
      cached: unknown,
    ) => Promise<{
      notModified: boolean;
      parsed?: { domains: Set<string>; lineCount: number; commentCount: number };
      etag?: string;
      lastModified?: string;
    }>;
    rateLimitedUntil: Map<string, Date>;
  };

  it("sends If-None-Match / If-Modified-Since when cached has validators", async () => {
    const httpGet = jest.fn().mockReturnValue(
      of({
        status: 200,
        headers: { etag: '"new"' },
        data: "example.com\n",
      }),
    );
    const service = makeService(httpGet);
    const internal = service as unknown as Internals;

    await internal.fetchDomainListOnce("https://blocklist.test/list", "h1", {
      etag: '"old"',
      lastModified: "Wed, 21 Oct 2026 07:28:00 GMT",
    });

    expect(httpGet).toHaveBeenCalledTimes(1);
    const [, options] = httpGet.mock.calls[0] as [string, { headers?: Record<string, string> }];
    expect(options.headers?.["If-None-Match"]).toBe('"old"');
    expect(options.headers?.["If-Modified-Since"]).toBe(
      "Wed, 21 Oct 2026 07:28:00 GMT",
    );
  });

  it("returns notModified=true on 304 response", async () => {
    const httpGet = jest.fn().mockReturnValue(
      of({ status: 304, headers: {}, data: "" }),
    );
    const service = makeService(httpGet);
    const internal = service as unknown as Internals;

    const result = await internal.fetchDomainListOnce(
      "https://blocklist.test/list",
      "h2",
      { etag: '"abc"' },
    );

    expect(result.notModified).toBe(true);
    expect(result.parsed).toBeUndefined();
  });

  it("coalesces concurrent fetches for the same URL into one HTTP request", async () => {
    let resolveResponse: ((v: unknown) => void) | undefined;
    const httpGet = jest.fn().mockImplementation(() => {
      return {
        subscribe: (observer: {
          next: (v: unknown) => void;
          complete: () => void;
        }) => {
          resolveResponse = (response: unknown) => {
            observer.next(response);
            observer.complete();
          };
          return { unsubscribe: () => undefined };
        },
      };
    });
    const service = makeService(httpGet);
    const internal = service as unknown as Internals;

    // Two concurrent callers for the same URL hash
    const p1 = internal.fetchDomainListOnce(
      "https://blocklist.test/list",
      "shared-hash",
      undefined,
    );
    const p2 = internal.fetchDomainListOnce(
      "https://blocklist.test/list",
      "shared-hash",
      undefined,
    );

    expect(httpGet).toHaveBeenCalledTimes(1);

    // Resolve the in-flight response
    resolveResponse!({
      status: 200,
      headers: {},
      data: "shared.example.com\n",
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2); // Same promise resolution
    expect(r1.parsed?.domains.has("shared.example.com")).toBe(true);
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it("sets back-off on 429 with Retry-After and skips subsequent fetches", async () => {
    const httpGet = jest.fn().mockReturnValue(
      of({
        status: 429,
        headers: { "retry-after": "120" },
        data: "Too Many Requests",
      }),
    );
    const service = makeService(httpGet);
    const internal = service as unknown as Internals;

    await expect(
      internal.fetchDomainListOnce(
        "https://blocklist.test/oisd",
        "h3",
        undefined,
      ),
    ).rejects.toThrow(/HTTP 429/);

    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(internal.rateLimitedUntil.has("h3")).toBe(true);

    // Second call within the back-off window should NOT hit the network
    await expect(
      internal.fetchDomainListOnce(
        "https://blocklist.test/oisd",
        "h3",
        undefined,
      ),
    ).rejects.toThrow(/back-off active/);

    expect(httpGet).toHaveBeenCalledTimes(1); // still one — no second request
  });

  it("applies default back-off when 429 has no Retry-After header", async () => {
    const httpGet = jest.fn().mockReturnValue(
      of({ status: 429, headers: {}, data: "" }),
    );
    const service = makeService(httpGet);
    const internal = service as unknown as Internals;

    await expect(
      internal.fetchDomainListOnce(
        "https://blocklist.test/oisd",
        "h4",
        undefined,
      ),
    ).rejects.toThrow();

    const backoffUntil = internal.rateLimitedUntil.get("h4");
    expect(backoffUntil).toBeDefined();
    // Default is 1 hour; allow a wide tolerance for test execution time
    const ms = backoffUntil!.getTime() - Date.now();
    expect(ms).toBeGreaterThan(59 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });

  it("clears back-off after a successful fetch", async () => {
    // First call: rate limited
    const httpGet = jest
      .fn()
      .mockReturnValueOnce(
        of({ status: 429, headers: { "retry-after": "0" }, data: "" }),
      )
      .mockReturnValueOnce(
        of({ status: 200, headers: {}, data: "ok.example.com\n" }),
      );
    const service = makeService(httpGet);
    const internal = service as unknown as Internals;

    await expect(
      internal.fetchDomainListOnce(
        "https://blocklist.test/list",
        "h5",
        undefined,
      ),
    ).rejects.toThrow();
    // Retry-After: 0 means immediate retry allowed
    // (enforceRateLimitBackoff sees expired and clears it)
    const result = await internal.fetchDomainListOnce(
      "https://blocklist.test/list",
      "h5",
      undefined,
    );
    expect(result.parsed?.domains.has("ok.example.com")).toBe(true);
    expect(internal.rateLimitedUntil.has("h5")).toBe(false);
  });
});
