import type { HttpService } from "@nestjs/axios";
import type { AdvancedBlockingService } from "./advanced-blocking.service";
import { DomainListCacheService } from "./domain-list-cache.service";
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue(undefined as any);

    // scheduleNodeRefresh is intentionally private; we call it via `any` for a
    // focused behavior test.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).scheduleNodeRefresh("eq14");

    expect(getSnapshotWithAuth).toHaveBeenCalledWith("eq14", "background");

    // Trigger the interval.
    jest.advanceTimersByTime(60_000);

    expect(refreshListsSpy).toHaveBeenCalledWith("eq14", {
      authMode: "background",
    });

    service.stopScheduledRefreshes();
  });
});
