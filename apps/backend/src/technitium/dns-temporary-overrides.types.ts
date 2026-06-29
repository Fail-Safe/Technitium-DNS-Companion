import type { DnsScheduleAction } from "./dns-schedules.types";

export type DnsTemporaryOverrideDurationPreset =
  | "one-hour"
  | "two-hours"
  | "until-tomorrow"
  | "until-turned-off"
  | "custom";

export interface DnsTemporaryOverrideDraft {
  name: string;
  enabled: boolean;
  advancedBlockingGroupNames: string[];
  action: DnsScheduleAction;
  domainEntries: string[];
  domainGroupNames: string[];
  nodeIds: string[];
  flushCacheOnChange: boolean;
  notifyEmails: string[];
  notifyDebounceSeconds: number;
  notifyMessage?: string;
  notifyMessageOnly?: boolean;
  notifySubjectTemplate?: string;
  expiresAt?: string | null;
}

export interface DnsTemporaryOverride extends DnsTemporaryOverrideDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
}
