import type { AdvancedBlockingConfig } from "./advanced-blocking.types";
import type { AdvancedBlockingService } from "./advanced-blocking.service";
import { ConfigSyncSchedulerService } from "./config-sync-scheduler.service";
import type { DnsFilteringSnapshotService } from "./dns-filtering-snapshot.service";
import type { LogAlertsEmailService } from "./log-alerts-email.service";

describe("ConfigSyncSchedulerService", () => {
  const sourceConfig: AdvancedBlockingConfig = {
    enableBlocking: true,
    localEndPointGroupMap: {},
    networkGroupMap: {},
    groups: [],
  };
  const targetConfig: AdvancedBlockingConfig = {
    ...sourceConfig,
    enableBlocking: false,
  };

  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.NODE_ENV = "test";
    process.env.CONFIG_SYNC_ENABLED = "true";
    process.env.CONFIG_SYNC_SOURCE_NODE = "primary";
    process.env.CONFIG_SYNC_TARGET_NODES = "secondary-a,secondary-b";
    process.env.CONFIG_SYNC_INTERVAL_MINUTES = "15";
    process.env.CONFIG_SYNC_NOTIFY_EMAILS = "ops@example.com";
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  function createService() {
    const advancedBlockingService = {
      getSnapshotWithAuth: jest.fn(),
      setConfigWithAuth: jest.fn(),
    };
    const snapshotService = { saveSnapshot: jest.fn() };
    const emailService = {
      sendConfigSyncFailureAlert: jest.fn().mockResolvedValue(null),
    };
    const service = new ConfigSyncSchedulerService(
      advancedBlockingService as unknown as AdvancedBlockingService,
      snapshotService as unknown as DnsFilteringSnapshotService,
      emailService as unknown as LogAlertsEmailService,
    );

    return {
      service,
      advancedBlockingService,
      snapshotService,
      emailService,
    };
  }

  function nodeSnapshot(nodeId: string, config: AdvancedBlockingConfig) {
    return {
      nodeId,
      baseUrl: `https://${nodeId}.example.test`,
      fetchedAt: new Date().toISOString(),
      metrics: {},
      config,
    };
  }

  it("skips converged targets and snapshots divergent targets before syncing", async () => {
    const { service, advancedBlockingService, snapshotService, emailService } =
      createService();
    advancedBlockingService.getSnapshotWithAuth
      .mockResolvedValueOnce(nodeSnapshot("primary", sourceConfig))
      .mockResolvedValueOnce(nodeSnapshot("secondary-a", sourceConfig))
      .mockResolvedValueOnce(nodeSnapshot("secondary-b", targetConfig));
    advancedBlockingService.setConfigWithAuth.mockResolvedValue(
      nodeSnapshot("secondary-b", sourceConfig),
    );

    const result = await service.runNow();

    expect(result.targets).toEqual([
      { nodeId: "secondary-a", status: "in-sync" },
      { nodeId: "secondary-b", status: "synced" },
    ]);
    expect(snapshotService.saveSnapshot).toHaveBeenCalledWith(
      "secondary-b",
      "advanced-blocking",
      "automatic",
      "Automatic snapshot before scheduled sync from primary",
      "schedule",
    );
    expect(advancedBlockingService.setConfigWithAuth).toHaveBeenCalledWith(
      "secondary-b",
      sourceConfig,
      "schedule",
    );
    expect(emailService.sendConfigSyncFailureAlert).not.toHaveBeenCalled();
  });

  it("sends one failure alert until a successful run resets suppression", async () => {
    const { service, advancedBlockingService, emailService } = createService();
    const setFailureRun = () => {
      advancedBlockingService.getSnapshotWithAuth
        .mockResolvedValueOnce(nodeSnapshot("primary", sourceConfig))
        .mockRejectedValueOnce(new Error("secondary unavailable"))
        .mockResolvedValueOnce(nodeSnapshot("secondary-b", sourceConfig));
    };

    setFailureRun();
    await service.runNow();
    setFailureRun();
    await service.runNow();
    expect(emailService.sendConfigSyncFailureAlert).toHaveBeenCalledTimes(1);

    advancedBlockingService.getSnapshotWithAuth
      .mockResolvedValueOnce(nodeSnapshot("primary", sourceConfig))
      .mockResolvedValueOnce(nodeSnapshot("secondary-a", sourceConfig))
      .mockResolvedValueOnce(nodeSnapshot("secondary-b", sourceConfig));
    await service.runNow();

    setFailureRun();
    await service.runNow();
    expect(emailService.sendConfigSyncFailureAlert).toHaveBeenCalledTimes(2);
  });

  it("records and alerts when the source cannot be read", async () => {
    const { service, advancedBlockingService, emailService } = createService();
    advancedBlockingService.getSnapshotWithAuth.mockRejectedValue(
      new Error("source unavailable"),
    );

    const result = await service.runNow();

    expect(result.targets).toEqual([
      {
        nodeId: "primary",
        status: "failed",
        error: "source unavailable",
      },
    ]);
    expect(emailService.sendConfigSyncFailureAlert).toHaveBeenCalledTimes(1);
    expect(service.getStatus().lastRun).toEqual(result);
  });

  it("exposes configuration without recipient addresses", () => {
    const { service } = createService();

    expect(service.getStatus()).toMatchObject({
      enabled: true,
      configured: true,
      running: false,
      intervalMinutes: 15,
      sourceNodeId: "primary",
      targetNodeIds: ["secondary-a", "secondary-b"],
      notificationRecipientCount: 1,
    });
    expect(JSON.stringify(service.getStatus())).not.toContain(
      "ops@example.com",
    );
  });
});
