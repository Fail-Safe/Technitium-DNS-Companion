export type DnsScheduleAction = "block" | "allow";

export interface DnsScheduleDraft {
  name: string;
  enabled: boolean;
  advancedBlockingGroupName: string;
  action: DnsScheduleAction;
  domainEntries: string[];
  domainGroupNames: string[];
  flushCacheOnChange: boolean;
  /** Email addresses to notify when blocked domains are queried during the active window. */
  notifyEmails: string[];
  /** Minimum seconds between repeat alert emails. Default 300. */
  notifyDebounceSeconds: number;
  /** 0=Sun, 1=Mon, ..., 6=Sat. Empty = every day. */
  daysOfWeek: number[];
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"
  timezone: string;
  nodeIds: string[];
}

export interface DnsSchedule extends DnsScheduleDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface DnsSchedulesStorageStatus {
  enabled: boolean;
  ready: boolean;
  dbPath?: string;
}

export interface DnsScheduleTokenStatus {
  configured: boolean;
  valid: boolean | null;
  username?: string;
  reason?: string;
  hasAppsModify: boolean | null;
}

export interface DnsScheduleEvaluatorStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  tokenReady: boolean;
  lastRunAt?: string;
  lastSuccessfulRunAt?: string;
  lastRunError?: string;
  lastApplied?: number;
  lastRemoved?: number;
  lastSkipped?: number;
  lastErrored?: number;
}

export interface DnsScheduleApplicationResult {
  scheduleId: string;
  scheduleName: string;
  nodeId: string;
  action: "applied" | "removed" | "skipped" | "error";
  reason?: string;
  error?: string;
}

export interface RunDnsScheduleEvaluatorResponse {
  dryRun: boolean;
  triggeredAt: string;
  evaluatedSchedules: number;
  results: DnsScheduleApplicationResult[];
  applied: number;
  removed: number;
  skipped: number;
  errored: number;
}

export interface DnsScheduleStateEntry {
  scheduleId: string;
  nodeId: string;
  appliedAt: string;
}

export interface LogAlertsSmtpStatus {
  configured: boolean;
  ready: boolean;
  secure: boolean;
  host?: string;
  port?: number;
}
