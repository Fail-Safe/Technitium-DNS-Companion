export type DnsScheduleAction = "block" | "allow";
export type DnsScheduleTargetType = "advanced-blocking" | "built-in";

export interface DnsScheduleDraft {
  name: string;
  enabled: boolean;
  /**
   * Targeting mode.
   * - "advanced-blocking" (default): writes to an AB group on the node.
   * - "built-in": writes to Technitium's server-wide blocked/allowed zone.
   *   Notifications are not supported in this mode.
   */
  targetType: DnsScheduleTargetType;
  /**
   * Names of the Advanced Blocking groups to target (case-sensitive).
   * At least one entry required when targetType is "advanced-blocking"; ignored otherwise.
   */
  advancedBlockingGroupNames: string[];
  /**
   * Whether to add entries to the `blocked` or `allowed` list of the target group
   * during the active window.
   */
  action: DnsScheduleAction;
  /**
   * Individual domain entries to add to the list during the active window.
   */
  domainEntries: string[];
  /**
   * Domain Group names whose entries are resolved and added during the active
   * window. Entries are resolved fresh on each evaluation run so updates to a
   * Domain Group are automatically reflected without re-saving the schedule.
   * Only exact-match entries from each group are used.
   */
  domainGroupNames: string[];
  /**
   * Days of week when the schedule is active.
   * 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
   * Empty array means every day.
   *
   * For overnight schedules (startTime > endTime), this refers to the day the
   * window *starts*. E.g. daysOfWeek: [1] (Monday), startTime: "22:00", endTime:
   * "07:00" → active Mon 22:00 through Tue 07:00.
   */
  daysOfWeek: number[];
  /**
   * Window start time in 24h "HH:MM" format, evaluated in `timezone`.
   */
  startTime: string;
  /**
   * Window end time in 24h "HH:MM" format.
   * May be less than startTime for overnight windows (e.g. 22:00–07:00).
   */
  endTime: string;
  /**
   * IANA timezone identifier, e.g. "America/New_York" or "UTC".
   */
  timezone: string;
  /**
   * Specific node IDs to apply this schedule to.
   * Empty array means apply to all configured nodes.
   */
  nodeIds: string[];
  /**
   * When true, the evaluator flushes the DNS resolver cache for each resolved
   * domain entry immediately after applying or removing the schedule entries.
   * Best-effort — requires DNS Server: Modify permission on the schedule token.
   */
  flushCacheOnChange: boolean;
  /**
   * Email addresses to notify when blocked domains in this schedule are queried
   * during the active window. Delivered via the Log Alerts email infrastructure.
   * Empty array disables notifications.
   */
  notifyEmails: string[];
  /**
   * Minimum seconds between repeat alert emails for this schedule's linked rule.
   * Default 300 (5 minutes). 0 = no debounce (deliver every match).
   */
  notifyDebounceSeconds: number;
  /**
   * Optional free-text message appended to the top of alert emails for this
   * schedule. Useful for adding context, e.g. "Bedtime rule — devices in Kids
   * profile should not be online after 9 PM."
   */
  notifyMessage?: string;
  /**
   * When true and notifyMessage is set, the alert email body consists only of
   * notifyMessage (no technical details). Intended for non-technical recipients.
   * Default false.
   */
  notifyMessageOnly?: boolean;
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
  /**
   * Whether TECHNITIUM_SCHEDULE_TOKEN is set in the environment.
   */
  configured: boolean;
  /**
   * null = not yet validated; true = valid; false = invalid.
   */
  valid: boolean | null;
  username?: string;
  reason?: string;
  /**
   * Whether the token has Apps: Modify permission needed to write AB config.
   * null when not yet validated.
   */
  hasAppsModify: boolean | null;
  /**
   * Whether the token has Cache: Modify permission needed to flush DNS cache.
   * null when not yet validated.
   */
  hasCacheModify: boolean | null;
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

export interface RunDnsScheduleEvaluatorRequest {
  dryRun?: boolean;
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
