import { jest } from "@jest/globals";
import type { HttpService } from "@nestjs/axios";
import { of, Subject, throwError } from "rxjs";
import type { AdvancedBlockingService } from "./advanced-blocking.service";
import {
  DomainListCacheService,
  buildConditionalHeaders,
  formatFetchErrorForLog,
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

    await (schedule as (nodeId: string) => Promise<void>).call(
      service,
      "nodeA",
    );

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
      buildConditionalHeaders({
        lastModified: "Wed, 21 Oct 2026 07:28:00 GMT",
      }),
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

describe("formatFetchErrorForLog", () => {
  it("summarizes Axios network errors without dumping request internals", () => {
    const error = Object.assign(new Error("AggregateError"), {
      name: "AxiosError",
      code: "ETIMEDOUT",
      config: { headers: { Authorization: "should-not-appear" } },
      request: { socket: { _events: "should-not-appear" } },
      cause: {
        errors: [
          {
            code: "ETIMEDOUT",
            address: "57.128.255.167",
            port: 443,
          },
          {
            code: "ENETUNREACH",
            address: "2001:41d0:601:1100::8a86",
            port: 443,
          },
        ],
      },
    });

    const summary = formatFetchErrorForLog(error);

    expect(summary).toContain("AxiosError: AggregateError");
    expect(summary).toContain("code=ETIMEDOUT");
    expect(summary).toContain("ETIMEDOUT 57.128.255.167:443");
    expect(summary).toContain("ENETUNREACH 2001:41d0:601:1100::8a86:443");
    expect(summary).not.toContain("Authorization");
    expect(summary).not.toContain("request");
    expect(summary).not.toContain("_events");
  });

  it("includes HTTP status when a response is present", () => {
    const error = Object.assign(new Error("Request failed"), {
      name: "AxiosError",
      code: "ERR_BAD_RESPONSE",
      response: { status: 503, data: "unavailable" },
    });

    expect(formatFetchErrorForLog(error)).toBe(
      "AxiosError: Request failed; code=ERR_BAD_RESPONSE; status=503",
    );
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
  afterEach(() => {
    jest.useRealTimers();
  });

  function makeService(httpGet: jest.Mock) {
    const httpService = { get: httpGet } as unknown as HttpService;
    return new DomainListCacheService(
      httpService,
      {} as unknown as AdvancedBlockingService,
      {} as unknown as TechnitiumService,
      {
        saveCache: jest.fn().mockResolvedValue(undefined),
      } as unknown as DomainListPersistenceService,
    );
  }

  type Internals = {
    getOrFetchList: (
      nodeId: string,
      url: string,
    ) => Promise<{
      domains: Set<string>;
      errorMessage?: string;
    }>;
    fetchDomainListOnce: (
      url: string,
      hash: string,
      cached: unknown,
    ) => Promise<{
      notModified: boolean;
      parsed?: {
        domains: Set<string>;
        lineCount: number;
        commentCount: number;
      };
      etag?: string;
      lastModified?: string;
    }>;
    rateLimitedUntil: Map<string, Date>;
    transientFailureUntil: Map<string, Date>;
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
    const [, options] = httpGet.mock.calls[0] as [
      string,
      { headers?: Record<string, string> },
    ];
    expect(options.headers?.["If-None-Match"]).toBe('"old"');
    expect(options.headers?.["If-Modified-Since"]).toBe(
      "Wed, 21 Oct 2026 07:28:00 GMT",
    );
  });

  it("returns notModified=true on 304 response", async () => {
    const httpGet = jest
      .fn()
      .mockReturnValue(of({ status: 304, headers: {}, data: "" }));
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

  it("coalesces concurrent same-node cache population into one save", async () => {
    const response$ = new Subject<{
      status: number;
      headers: Record<string, string>;
      data: string;
    }>();
    const httpGet = jest.fn().mockReturnValue(response$);
    const persistenceService = {
      saveCache: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DomainListCacheService(
      { get: httpGet } as unknown as HttpService,
      {} as unknown as AdvancedBlockingService,
      {} as unknown as TechnitiumService,
      persistenceService as unknown as DomainListPersistenceService,
    );
    const internal = service as unknown as Internals;

    const first = internal.getOrFetchList(
      "nodeA",
      "https://blocklist.test/list",
    );
    const second = internal.getOrFetchList(
      "nodeA",
      "https://blocklist.test/list",
    );

    expect(httpGet).toHaveBeenCalledTimes(1);

    response$.next({
      status: 200,
      headers: {},
      data: "coalesced.example.com\n",
    });
    response$.complete();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(firstResult.domains.has("coalesced.example.com")).toBe(true);
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(persistenceService.saveCache).toHaveBeenCalledTimes(1);
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

  it("retries transient transport failures before returning a successful response", async () => {
    jest.useFakeTimers();
    const timeout = Object.assign(new Error("connect timed out"), {
      code: "ETIMEDOUT",
    });
    const httpGet = jest
      .fn()
      .mockReturnValueOnce(throwError(() => timeout))
      .mockReturnValueOnce(
        of({
          status: 200,
          headers: {},
          data: "retried.example.com\n",
        }),
      );
    const service = makeService(httpGet);
    const internal = service as unknown as Internals;

    const resultPromise = internal.fetchDomainListOnce(
      "https://blocklist.test/flaky",
      "flaky-hash",
      undefined,
    );

    expect(httpGet).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;

    expect(httpGet).toHaveBeenCalledTimes(2);
    expect(result.parsed?.domains.has("retried.example.com")).toBe(true);
    expect(internal.transientFailureUntil.has("flaky-hash")).toBe(false);
  });

  it("normalizes wildcard domain-list entries into matchable base domains", async () => {
    const httpGet = jest.fn().mockReturnValue(
      of({
        status: 200,
        headers: {},
        data: [
          "# wildcard list",
          "*.ads.example.com",
          ".tracker.example.net",
          "0.0.0.0 *.hosts-format.example.org",
          "plain.example.edu",
        ].join("\n"),
      }),
    );
    const service = makeService(httpGet);
    const internal = service as unknown as Internals;

    const result = await internal.fetchDomainListOnce(
      "https://blocklist.test/domainswild",
      "wildcard-hash",
      undefined,
    );

    expect(result.parsed?.domains).toEqual(
      new Set([
        "ads.example.com",
        "tracker.example.net",
        "hosts-format.example.org",
        "plain.example.edu",
      ]),
    );
    expect(result.parsed?.commentCount).toBe(1);
  });

  it("does not retry upstream rate-limit responses", async () => {
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
        "https://blocklist.test/rate-limited",
        "rate-limited-hash",
        undefined,
      ),
    ).rejects.toThrow(/HTTP 429/);

    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(internal.rateLimitedUntil.has("rate-limited-hash")).toBe(true);
  });

  it("keeps cold-cache error entries fresh only for the transient failure back-off", async () => {
    jest.useFakeTimers();
    const timeout = Object.assign(new Error("connect timed out"), {
      code: "ETIMEDOUT",
    });
    const httpGet = jest
      .fn()
      .mockReturnValueOnce(throwError(() => timeout))
      .mockReturnValueOnce(throwError(() => timeout))
      .mockReturnValueOnce(throwError(() => timeout))
      .mockReturnValueOnce(
        of({
          status: 200,
          headers: {},
          data: "recovered.example.com\n",
        }),
      );
    const service = makeService(httpGet);
    const internal = service as unknown as Internals;

    const failedPromise = internal.getOrFetchList(
      "nodeA",
      "https://blocklist.test/flaky-cold",
    );
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(3000);
    const failed = await failedPromise;

    expect(failed.errorMessage).toContain("connect timed out");
    expect(httpGet).toHaveBeenCalledTimes(3);

    const stillBackedOff = await internal.getOrFetchList(
      "nodeA",
      "https://blocklist.test/flaky-cold",
    );
    expect(stillBackedOff.errorMessage).toContain("connect timed out");
    expect(httpGet).toHaveBeenCalledTimes(3);

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    const recovered = await internal.getOrFetchList(
      "nodeA",
      "https://blocklist.test/flaky-cold",
    );

    expect(httpGet).toHaveBeenCalledTimes(4);
    expect(recovered.domains.has("recovered.example.com")).toBe(true);
    expect(recovered.errorMessage).toBeUndefined();
  });

  it("applies default back-off when 429 has no Retry-After header", async () => {
    const httpGet = jest
      .fn()
      .mockReturnValue(of({ status: 429, headers: {}, data: "" }));
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
