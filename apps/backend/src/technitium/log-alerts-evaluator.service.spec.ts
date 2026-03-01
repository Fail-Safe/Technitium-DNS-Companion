import { ServiceUnavailableException } from "@nestjs/common";
import { LogAlertsEvaluatorService } from "./log-alerts-evaluator.service";
import type { QueryLogSqliteService } from "./query-log-sqlite.service";
import type { LogAlertsRulesService } from "./log-alerts-rules.service";
import type { LogAlertsEmailService } from "./log-alerts-email.service";
import type { AdvancedBlockingService } from "./advanced-blocking.service";
import type { LogAlertRule, LogAlertsSmtpStatus } from "./log-alerts.types";

describe("LogAlertsEvaluatorService", () => {
  const nowIso = new Date("2026-02-26T00:00:00.000Z").toISOString();
  const sampleRule: LogAlertRule = {
    id: "rule-1",
    name: "Blocked ads for kid tablet",
    enabled: true,
    outcomeMode: "blocked-only",
    domainPattern: "*.ads.example.com",
    domainPatternType: "wildcard",
    clientIdentifier: "192.168.1.20",
    advancedBlockingGroupNames: undefined,
    debounceSeconds: 900,
    emailRecipients: ["alerts@example.com"],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const smtpReady: LogAlertsSmtpStatus = {
    configured: true,
    ready: true,
    secure: false,
    host: "smtp.example.com",
    port: 587,
    from: "alerts@example.com",
    authConfigured: true,
    missing: [],
  };

  const createService = (options?: {
    smtpReady?: boolean;
    entries?: Array<{
      nodeId: string;
      baseUrl: string;
      timestamp: string;
      qname: string;
      clientIpAddress: string;
      responseType: string;
    }>;
    rules?: LogAlertRule[];
  }) => {
    const queryLogSqliteService = {
      getIsEnabled: jest.fn().mockReturnValue(true),
      getStoredCombinedLogs: jest.fn().mockResolvedValue({
        fetchedAt: nowIso,
        pageNumber: 1,
        entriesPerPage: 500,
        totalPages: 1,
        totalEntries: options?.entries?.length ?? 1,
        totalMatchingEntries: options?.entries?.length ?? 1,
        descendingOrder: true,
        entries: options?.entries ?? [
          {
            nodeId: "node1",
            baseUrl: "http://node1.test",
            timestamp: "2026-02-26T00:00:01.000Z",
            qname: "api.ads.example.com",
            clientIpAddress: "192.168.1.20",
            responseType: "Blocked",
          },
        ],
        nodes: [],
      }),
    } as unknown as QueryLogSqliteService;

    const logAlertsRulesService = {
      listRules: jest.fn().mockReturnValue(options?.rules ?? [sampleRule]),
    } as unknown as LogAlertsRulesService;

    const logAlertsEmailService = {
      getSmtpStatus: jest.fn().mockReturnValue({
        ...smtpReady,
        ready: options?.smtpReady ?? true,
      }),
      sendRuleAlertEmail: jest.fn().mockResolvedValue({
        accepted: ["alerts@example.com"],
        rejected: [],
        messageId: "message-id",
      }),
    } as unknown as LogAlertsEmailService;

    const advancedBlockingService = {
      getSnapshotWithAuth: jest.fn().mockResolvedValue({
        config: {
          localEndPointGroupMap: {},
          networkGroupMap: {},
          groups: [],
        },
      }),
    } as unknown as AdvancedBlockingService;

    const service = new LogAlertsEvaluatorService(
      queryLogSqliteService,
      logAlertsRulesService,
      logAlertsEmailService,
      advancedBlockingService,
    );

    return {
      service,
      queryLogSqliteService,
      logAlertsRulesService,
      logAlertsEmailService,
    };
  };

  it("sends alert emails when matching entries are found", async () => {
    const { service, logAlertsEmailService } = createService();
    const result = await service.runNow(false);

    expect(result.evaluatedRules).toBe(1);
    expect(result.matchedRules).toBe(1);
    expect(result.alertsSent).toBe(1);
    expect(logAlertsEmailService.sendRuleAlertEmail).toHaveBeenCalledTimes(1);
  });

  it("does not re-send when no newer matching entries are found", async () => {
    const { service, logAlertsEmailService } = createService();

    const firstRun = await service.runNow(false);
    const secondRun = await service.runNow(false);

    expect(firstRun.alertsSent).toBe(1);
    expect(secondRun.alertsSent).toBe(0);
    expect(logAlertsEmailService.sendRuleAlertEmail).toHaveBeenCalledTimes(1);
  });

  it("allows dry-run execution when SMTP is not ready", async () => {
    const { service } = createService({ smtpReady: false });
    const result = await service.runNow(true);
    expect(result.dryRun).toBe(true);
    expect(result.matchedRules).toBe(1);
    expect(result.alertsSent).toBe(0);
  });

  it("blocks non-dry-run execution when SMTP is not ready", async () => {
    const { service } = createService({ smtpReady: false });
    await expect(service.runNow(false)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
