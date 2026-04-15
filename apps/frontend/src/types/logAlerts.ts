export type LogAlertOutcomeMode = "blocked-only" | "all-outcomes";

export type LogAlertDomainPatternType = "exact" | "wildcard" | "regex";

export interface LogAlertRuleDraft {
  name: string;
  // Optional friendly label. Schedule-linked rules use this to carry a
  // human-readable name while the `name` field stays as the link key.
  displayName?: string;
  enabled: boolean;
  outcomeMode: LogAlertOutcomeMode;
  domainPattern: string;
  domainPatternType: LogAlertDomainPatternType;
  clientIdentifier?: string;
  advancedBlockingGroupNames?: string[];
  debounceSeconds: number;
  emailRecipients: string[];
}

export interface LogAlertRule extends LogAlertRuleDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface ValidateLogAlertRuleRequest {
  rule: Partial<LogAlertRuleDraft>;
}

export interface ValidateLogAlertRuleResponse {
  valid: boolean;
  normalizedRule?: LogAlertRuleDraft;
  errors?: string[];
}

export interface LogAlertRulesStorageStatus {
  enabled: boolean;
  ready: boolean;
  dbPath?: string;
}

export interface LogAlertCapabilitiesResponse {
  outcomeModes: LogAlertOutcomeMode[];
  domainPatternTypes: LogAlertDomainPatternType[];
  defaults: {
    outcomeMode: LogAlertOutcomeMode;
    domainPatternType: LogAlertDomainPatternType;
    debounceSeconds: number;
  };
  notes: string[];
}

export interface LogAlertsSmtpStatus {
  configured: boolean;
  ready: boolean;
  secure: boolean;
  host?: string;
  port?: number;
  from?: string;
  authConfigured: boolean;
  missing: string[];
}

export interface LogAlertsSendTestEmailRequest {
  to: string | string[];
  subject?: string;
  text?: string;
}

export interface LogAlertsSendTestEmailResponse {
  accepted: string[];
  rejected: string[];
  messageId?: string;
  response?: string;
}

export interface LogAlertRuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  matchedCount: number;
  latestMatchAt?: string;
  debounced: boolean;
  alertSent: boolean;
  reason?: string;
  error?: string;
}

export interface RunLogAlertEvaluatorRequest {
  dryRun?: boolean;
}

export interface RunLogAlertEvaluatorResponse {
  dryRun: boolean;
  scannedEntries: number;
  evaluatedRules: number;
  matchedRules: number;
  alertsSent: number;
  triggeredAt: string;
  rules: LogAlertRuleEvaluationResult[];
}

export interface LogAlertEvaluatorStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  maxEntriesPerPage: number;
  maxPagesPerRun: number;
  lookbackSeconds: number;
  sqliteReady: boolean;
  smtpReady: boolean;
  lastRunAt?: string;
  lastSuccessfulRunAt?: string;
  lastRunError?: string;
  lastRunDryRun?: boolean;
  lastScannedEntries?: number;
  lastEvaluatedRules?: number;
  lastMatchedRules?: number;
  lastAlertsSent?: number;
}
