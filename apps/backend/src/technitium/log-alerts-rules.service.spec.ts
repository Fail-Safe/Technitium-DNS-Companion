import { BadRequestException, NotFoundException } from "@nestjs/common";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { CompanionDbService } from "./companion-db.service";
import { LogAlertsRulesService } from "./log-alerts-rules.service";
import type { LogAlertRuleDraft } from "./log-alerts.types";

describe("LogAlertsRulesService", () => {
  let service: LogAlertsRulesService;
  let companionDb: CompanionDbService;
  let tempDir: string;
  let previousEnabled: string | undefined;

  const createDraft = (
    overrides?: Partial<LogAlertRuleDraft>,
  ): LogAlertRuleDraft => ({
    name: "Block ads for kids",
    enabled: true,
    outcomeMode: "blocked-only",
    domainPattern: "*.ads.example.com",
    domainPatternType: "wildcard",
    clientIdentifier: "kid-tablet",
    advancedBlockingGroupNames: ["Kids"],
    debounceSeconds: 900,
    emailRecipients: ["alerts@example.com"],
    ...overrides,
  });

  beforeEach(() => {
    previousEnabled = process.env.LOG_ALERT_RULES_ENABLED;

    tempDir = mkdtempSync(join(tmpdir(), "log-alert-rules-"));
    process.env.LOG_ALERT_RULES_ENABLED = "true";
    process.env.COMPANION_DB_PATH = join(tempDir, "companion.sqlite");

    companionDb = new CompanionDbService();
    companionDb.onModuleInit();

    service = new LogAlertsRulesService(companionDb);
    service.onModuleInit();
  });

  afterEach(() => {
    companionDb.onModuleDestroy();
    rmSync(tempDir, { recursive: true, force: true });

    if (previousEnabled === undefined) {
      delete process.env.LOG_ALERT_RULES_ENABLED;
    } else {
      process.env.LOG_ALERT_RULES_ENABLED = previousEnabled;
    }
    delete process.env.COMPANION_DB_PATH;
  });

  it("creates and lists rules", () => {
    const created = service.createRule(createDraft());
    expect(created.id).toBeTruthy();
    expect(created.name).toBe("Block ads for kids");
    expect(created.emailRecipients).toEqual(["alerts@example.com"]);

    const rules = service.listRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe(created.id);
  });

  it("toggles rule enabled state", () => {
    const created = service.createRule(createDraft({ enabled: true }));
    const updated = service.setRuleEnabled(created.id, false);

    expect(updated.enabled).toBe(false);
    expect(service.listRules()[0]?.enabled).toBe(false);
  });

  it("rejects duplicate rule names", () => {
    service.createRule(createDraft({ name: "Home alerts" }));

    expect(() =>
      service.createRule(createDraft({ name: "home alerts" })),
    ).toThrow(BadRequestException);
  });

  it("deletes rules and throws for missing rule", () => {
    const created = service.createRule(createDraft());
    const deleted = service.deleteRule(created.id);

    expect(deleted).toEqual({ deleted: true, ruleId: created.id });
    expect(service.listRules()).toHaveLength(0);
    expect(() => service.deleteRule(created.id)).toThrow(NotFoundException);
  });
});
