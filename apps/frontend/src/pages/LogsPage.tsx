import {
    faBan,
    faCheck,
    faFile,
    faRotate,
    faSquare,
    faSquareCheck,
    faTowerBroadcast,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { ReactNode } from "react";
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Tooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";
import {
    SkeletonLogEntries,
    SkeletonLogsStats,
    SkeletonLogsSummary,
} from "../components/common/LoadingSkeleton";
import { PullToRefreshIndicator } from "../components/common/PullToRefreshIndicator";
import { apiFetch, getAuthRedirectReason } from "../config";
import { useTechnitiumState } from "../context/useTechnitiumState";
import { useToast } from "../context/useToast";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import type {
    AdvancedBlockingConfig,
    AdvancedBlockingGroup,
} from "../types/advancedBlocking";
import type { DomainCheckResult, DomainListEntry } from "../types/technitium";
import type {
    TechnitiumCombinedNodeLogSnapshot,
    TechnitiumCombinedQueryLogEntry,
    TechnitiumCombinedQueryLogPage,
    TechnitiumNodeQueryLogEnvelope,
    TechnitiumQueryLogStorageStatus,
} from "../types/technitiumLogs";

type ViewMode = "combined" | "node";

type DisplayMode = "paginated" | "tail";

type LoadingState = "idle" | "loading" | "refreshing" | "error";

const DEFAULT_ENTRIES_PER_PAGE = 25;
const PAGINATED_ROWS_PER_PAGE_OPTIONS = [25, 50, 100, 200];
const DEFAULT_TAIL_BUFFER_SIZE = 50;
const TAIL_BUFFER_SIZE_OPTIONS = [
  { label: "50 entries", value: 50 },
  { label: "100 entries", value: 100 },
  { label: "200 entries", value: 200 },
  { label: "500 entries", value: 500 },
  { label: "1000 entries", value: 1000 },
];
const TAIL_MODE_DEFAULT_REFRESH = 3; // 3 seconds
const REFRESH_OPTIONS = [
  { label: "1 second", value: 1 },
  { label: "3 seconds", value: 3 },
  { label: "5 seconds", value: 5 },
  { label: "10 seconds", value: 10 },
  { label: "15 seconds", value: 15 },
  { label: "30 seconds", value: 30 },
  { label: "1 minute", value: 60 },
];

// If the browser/network stack gets into a weird state (sleep/VPN drop/offline),
// fetch() can hang for a long time without resolving/rejecting. That leaves our
// in-flight guard stuck and stops auto-refresh permanently until a focus/resume
// event happens. Enforce a hard timeout so the page can self-recover.
const LOGS_FETCH_TIMEOUT_MS = 25000;

const DOMAIN_BLOCK_SOURCE_HOVER_DELAY_MS = 300;
const DOMAIN_BLOCK_SOURCE_CACHE_MAX_ENTRIES = 500;

type OptionalColumnKey = "protocol" | "qclass" | "answer" | "responseTime";

type StatusFilter = "all" | "allowed" | "blocked";

type ColumnId =
  | "group-badge"
  | "select"
  | "timestamp"
  | "node"
  | "client"
  | "response"
  | "responseTime"
  | "status"
  | "protocol"
  | "rcode"
  | "qtype"
  | "qclass"
  | "domain"
  | "answer";

interface ColumnDefinition {
  id: ColumnId;
  label: string;
  className: string;
  optionalKey?: OptionalColumnKey;
  cellClassName?: string;
  render: (entry: TechnitiumCombinedQueryLogEntry) => ReactNode;
  getTitle?: (entry: TechnitiumCombinedQueryLogEntry) => string | undefined;
}

type ColumnVisibility = {
  protocol: boolean;
  qclass: boolean;
  answer: boolean;
  responseTime: boolean;
};

type MobileLayoutMode = "compact-table" | "card-view";

const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  protocol: false,
  qclass: false,
  answer: false,
  responseTime: true,
};

const COLUMN_VISIBILITY_STORAGE_KEY = "technitiumLogs.columnVisibility";
const TAIL_BUFFER_SIZE_STORAGE_KEY = "technitiumLogs.tailBufferSize";
const PAGINATED_ROWS_PER_PAGE_STORAGE_KEY =
  "technitiumLogs.paginatedRowsPerPage";
const DEDUPLICATE_DOMAINS_STORAGE_KEY = "technitiumLogs.deduplicateDomains";
const FILTER_TIP_DISMISSED_KEY = "technitiumLogs.filterTipDismissed";
const SELECTION_TIP_DISMISSED_KEY = "technitiumLogs.selectionTipDismissed";
const MOBILE_LAYOUT_MODE_KEY = "technitiumLogs.mobileLayoutMode";
const LOGS_DEBUG_RESUME_STORAGE_KEY = "technitiumLogs.debugResume";

const isLogsResumeDebugEnabled = () => {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage.getItem(LOGS_DEBUG_RESUME_STORAGE_KEY) === "true"
    );
  } catch {
    return false;
  }
};

const BLOCKED_RESPONSE_KEYWORDS = ["block", "filter", "deny"];
const EMPTY_RESPONSE_FILTER_VALUE = "__EMPTY__";

const isEntryBlocked = (entry: TechnitiumCombinedQueryLogEntry): boolean => {
  const response = entry.responseType?.toLowerCase() ?? "";
  if (
    response &&
    BLOCKED_RESPONSE_KEYWORDS.some((keyword) => response.includes(keyword))
  ) {
    return true;
  }

  return false;
};

/**
 * Floating action button for toggling live tail mode
 */
interface FloatingLiveToggleProps {
  isLive: boolean;
  refreshSeconds: number;
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void;
  pausedTitle?: string;
}

function FloatingLiveToggle({
  isLive,
  refreshSeconds,
  onToggle,
  pausedTitle,
}: FloatingLiveToggleProps) {
  return (
    <button
      type="button"
      className={`logs-page__floating-live-toggle ${isLive ? "logs-page__floating-live-toggle--live" : "logs-page__floating-live-toggle--paused"}`}
      onClick={onToggle}
      aria-label={isLive ? "Pause live updates" : "Resume live updates"}
      title={
        isLive ? "Pause live updates" : (pausedTitle ?? "Resume live updates")
      }
      style={
        isLive ?
          ({
            "--refresh-duration": `${refreshSeconds}s`,
          } as React.CSSProperties)
        : undefined
      }
    >
      {/* Progress ring (only shown when live) */}
      {isLive && (
        <svg className="logs-page__floating-live-progress" viewBox="0 0 64 64">
          <circle
            cx="32"
            cy="32"
            r="28"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="logs-page__floating-live-progress-ring"
          />
        </svg>
      )}

      {/* Icon */}
      {isLive ?
        <svg
          className="logs-page__floating-live-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
      : <svg
          className="logs-page__floating-live-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      }
    </button>
  );
}

const OPTIONAL_COLUMN_OPTIONS: Array<{
  key: OptionalColumnKey;
  label: string;
  description: string;
}> = [
  {
    key: "protocol",
    label: "Protocol",
    description: "Include DNS transport protocol (UDP/TCP/DoH/etc.).",
  },
  {
    key: "qclass",
    label: "QClass",
    description: "Show the DNS query class (typically IN).",
  },
  {
    key: "answer",
    label: "Answer",
    description: "Show the DNS query response.",
  },
  {
    key: "responseTime",
    label: "Response time",
    description: "Surface Technitium DNS reported query handling duration.",
  },
];

const formatResponseRtt = (value?: number): string => {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "—";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }

  if (value >= 10) {
    return `${value.toFixed(0)} ms`;
  }

  return `${value.toFixed(2)} ms`;
};

const getResponseTimeTooltip = (
  entry: TechnitiumCombinedQueryLogEntry,
): string | undefined => {
  // Only show tooltip when there's no RTT data
  if (
    entry.responseRtt !== undefined &&
    entry.responseRtt !== null &&
    !Number.isNaN(entry.responseRtt)
  ) {
    return undefined;
  }

  const responseType = entry.responseType ?? "this response type";
  return `Response time not measured for ${responseType} responses`;
};

const buildEntryDedupKey = (entry: TechnitiumCombinedQueryLogEntry): string => {
  const nodeId = entry.nodeId ?? "unknown";
  const rowNumber = entry.rowNumber ?? 0;
  const timestamp = entry.timestamp ?? "";
  const domain = entry.qname ?? "";
  return `${nodeId}::${rowNumber}::${timestamp}::${domain}`;
};

const safeParseTimestamp = (value?: string): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }

  return parsed;
};

const buildDefaultRegexPattern = (domain: string): string => {
  const sanitized = domain.trim().replace(/\.+$/, "");
  if (sanitized.length === 0) {
    return "";
  }

  const escaped = sanitized
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(\\.|^)${escaped}$`;
};

interface GroupOverrideInfo {
  blockedExact: boolean;
  blockedRegexMatches: string[];
  allowedExact: boolean;
  allowedRegexMatches: string[];
}

interface DomainGroupDetails {
  groupNumber: number;
  groupName: string;
  blockedExact: boolean;
  blockedRegexMatches: string[];
  allowedExact: boolean;
  allowedRegexMatches: string[];
}

type CoverageEntry = { name: string; description: string };

const matchesPattern = (pattern: string, domain: string): boolean => {
  try {
    return new RegExp(pattern, "i").test(domain);
  } catch (error) {
    console.warn(
      "Invalid regex pattern in Advanced Blocking configuration",
      error,
    );
    return false;
  }
};

const extractGroupOverrides = (
  group: AdvancedBlockingGroup,
  domain: string,
): GroupOverrideInfo => {
  if (!domain) {
    return {
      blockedExact: false,
      blockedRegexMatches: [],
      allowedExact: false,
      allowedRegexMatches: [],
    };
  }

  const blockedExact = group.blocked.includes(domain);
  const allowedExact = group.allowed.includes(domain);
  const blockedRegexMatches = group.blockedRegex.filter((pattern) =>
    matchesPattern(pattern, domain),
  );
  const allowedRegexMatches = group.allowedRegex.filter((pattern) =>
    matchesPattern(pattern, domain),
  );

  return {
    blockedExact,
    blockedRegexMatches,
    allowedExact,
    allowedRegexMatches,
  };
};

const collectActionOverrides = (
  groups: AdvancedBlockingGroup[],
  domain: string,
  action: "block" | "allow",
) => {
  const selected = new Set<string>();
  const regexMatches: string[] = [];
  let hasExact = false;

  if (!domain) {
    return { selected, hasExact, regexMatches };
  }

  groups.forEach((group) => {
    const overrides = extractGroupOverrides(group, domain);
    if (action === "block") {
      if (overrides.blockedExact) {
        hasExact = true;
        selected.add(group.name);
      }
      if (overrides.blockedRegexMatches.length > 0) {
        regexMatches.push(...overrides.blockedRegexMatches);
        selected.add(group.name);
      }
    } else {
      if (overrides.allowedExact) {
        hasExact = true;
        selected.add(group.name);
      }
      if (overrides.allowedRegexMatches.length > 0) {
        regexMatches.push(...overrides.allowedRegexMatches);
        selected.add(group.name);
      }
    }
  });

  return { selected, hasExact, regexMatches };
};

const RESPONSE_BADGE_MAP = new Map<string, { icon: string; className: string }>(
  [
    [
      "authoritative",
      { icon: "A", className: "logs-page__response-badge--authoritative" },
    ],
    [
      "recursive",
      { icon: "R", className: "logs-page__response-badge--recursive" },
    ],
    ["cached", { icon: "C", className: "logs-page__response-badge--cached" }],
    ["blocked", { icon: "B", className: "logs-page__response-badge--blocked" }],
    [
      "upstreamblocked",
      { icon: "UB", className: "logs-page__response-badge--upstream-blocked" },
    ],
    [
      "cacheblocked",
      { icon: "CB", className: "logs-page__response-badge--cache-blocked" },
    ],
  ],
);

const classifyResponseType = (value?: string) => {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized) {
    return { icon: "?", className: "logs-page__response-badge--unknown" };
  }

  const sanitized = normalized.replace(/[^a-z]/g, "");
  const mapped = RESPONSE_BADGE_MAP.get(sanitized);

  if (mapped) {
    return mapped;
  }

  if (normalized.includes("upstream") && normalized.includes("block")) {
    return RESPONSE_BADGE_MAP.get("upstreamblocked")!;
  }

  if (normalized.includes("cache") && normalized.includes("block")) {
    return RESPONSE_BADGE_MAP.get("cacheblocked")!;
  }

  if (normalized.includes("authoritative")) {
    return RESPONSE_BADGE_MAP.get("authoritative")!;
  }

  if (normalized.includes("recursive")) {
    return RESPONSE_BADGE_MAP.get("recursive")!;
  }

  if (normalized.includes("cache")) {
    return RESPONSE_BADGE_MAP.get("cached")!;
  }

  if (normalized.includes("block") || normalized.includes("deny")) {
    return RESPONSE_BADGE_MAP.get("blocked")!;
  }

  return { icon: "I", className: "logs-page__response-badge--info" };
};

const buildTableColumns = (
  onStatusClick: (
    entry: TechnitiumCombinedQueryLogEntry,
    forceToggle?: boolean,
  ) => void,
  onClientClick: (
    entry: TechnitiumCombinedQueryLogEntry,
    shiftKey: boolean,
  ) => void,
  onDomainClick: (
    entry: TechnitiumCombinedQueryLogEntry,
    shiftKey: boolean,
  ) => void,
  onDomainHover: (entry: TechnitiumCombinedQueryLogEntry) => void,
  selectedDomains: Set<string>,
  onToggleDomain: (domain: string) => void,
  domainToGroupMap: Map<string, number>,
  domainGroupDetailsMap: Map<string, DomainGroupDetails>,
): ColumnDefinition[] => {
  return [
    {
      id: "group-badge",
      label: "",
      className: "logs-page__col--group-badge",
      cellClassName: "logs-page__cell--group-badge",
      render: (entry) => {
        const domain = entry.qname ?? "";
        const groupNumber = domainToGroupMap.get(domain);
        const groupDetails = domainGroupDetailsMap.get(domain);

        if (groupNumber === undefined || !groupDetails) {
          return null;
        }

        // Build tooltip content
        const tooltipLines: string[] = [];
        tooltipLines.push(`Group ${groupNumber}: ${groupDetails.groupName}`);
        tooltipLines.push("━━━━━━━━━━━━━━━━");

        if (groupDetails.blockedExact) {
          tooltipLines.push("✓ Blocked (Exact Match)");
          tooltipLines.push(`  • ${domain}`);
        } else if (groupDetails.blockedRegexMatches.length > 0) {
          tooltipLines.push("✓ Blocked (Regex Match)");
          groupDetails.blockedRegexMatches.forEach((pattern) => {
            tooltipLines.push(`  • Pattern: ${pattern}`);
          });
        }

        if (groupDetails.allowedExact) {
          tooltipLines.push("✓ Allowed (Exact Match)");
          tooltipLines.push(`  • ${domain}`);
        } else if (groupDetails.allowedRegexMatches.length > 0) {
          tooltipLines.push("✓ Allowed (Regex Match)");
          groupDetails.allowedRegexMatches.forEach((pattern) => {
            tooltipLines.push(`  • Pattern: ${pattern}`);
          });
        }

        const tooltipText = tooltipLines.join("\n");

        return (
          <div
            className={`logs-page__group-badge logs-page__group-badge--${groupNumber}`}
            title={tooltipText}
          >
            {groupNumber}
          </div>
        );
      },
    } as ColumnDefinition,
    {
      id: "select",
      label: "", // Will be handled separately with select-all checkbox
      className: "logs-page__col--select",
      cellClassName: "logs-page__cell--select",
      render: (entry) => {
        const domain = entry.qname;
        if (!domain) {
          return null;
        }
        return (
          <input
            type="checkbox"
            checked={selectedDomains.has(domain)}
            onChange={() => onToggleDomain(domain)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${domain}`}
          />
        );
      },
    } as ColumnDefinition,
    {
      id: "timestamp",
      label: "Timestamp",
      className: "logs-page__col--timestamp",
      cellClassName: "logs-page__cell--timestamp",
      render: (entry) => new Date(entry.timestamp).toLocaleString(),
    },
    {
      id: "node",
      label: "Node",
      className: "logs-page__col--node",
      render: (entry) => entry.nodeId,
    },
    {
      id: "client",
      label: "Client",
      className: "logs-page__col--client",
      cellClassName: "logs-page__cell--clickable",
      render: (entry) => {
        const hasHostname =
          entry.clientName && entry.clientName.trim().length > 0;
        const hasIp =
          entry.clientIpAddress && entry.clientIpAddress.trim().length > 0;

        if (!hasHostname && !hasIp) {
          return "—";
        }

        return (
          <div
            className="logs-page__client-info"
            data-copy-ip={hasIp ? entry.clientIpAddress : undefined}
            data-copy-hostname={hasHostname ? entry.clientName : undefined}
            onClick={(e) => onClientClick(entry, e.shiftKey)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClientClick(entry, e.shiftKey);
              }
            }}
          >
            {hasHostname && hasIp ?
              <>
                <div className="logs-page__client-hostname">
                  {entry.clientName}
                </div>
                <div className="logs-page__client-ip">
                  {entry.clientIpAddress}
                </div>
              </>
            : hasHostname ?
              <div className="logs-page__client-hostname">
                {entry.clientName}
              </div>
            : <div className="logs-page__client-ip">
                {entry.clientIpAddress}
              </div>
            }
          </div>
        );
      },
      getTitle: (entry) => {
        const parts: string[] = [];
        if (entry.clientName) parts.push(entry.clientName);
        if (entry.clientIpAddress) parts.push(entry.clientIpAddress);
        const tooltip = parts.length > 0 ? parts.join(" - ") : undefined;
        return tooltip ? `${tooltip} (click to filter)` : "Click to filter";
      },
    },
    {
      id: "response",
      label: "Response",
      className: "logs-page__col--response",
      cellClassName: "logs-page__cell--response",
      render: (entry) => {
        const label = entry.responseType ?? "—";

        if (!entry.responseType) {
          return label;
        }

        const { icon, className } = classifyResponseType(entry.responseType);

        return (
          <span
            className={`logs-page__response-badge ${className}`}
            data-copy-value={label}
          >
            <span className="logs-page__response-badge-icon" aria-hidden="true">
              {icon}
            </span>
            <span>{label}</span>
          </span>
        );
      },
      getTitle: (entry) => entry.responseType ?? undefined,
    },
    {
      id: "responseTime",
      label: "Response time",
      className: "logs-page__col--response-time",
      optionalKey: "responseTime",
      render: (entry) => {
        const formattedTime = formatResponseRtt(entry.responseRtt);
        const tooltip = getResponseTimeTooltip(entry);
        const copyValue = formattedTime === "—" ? undefined : formattedTime;

        if (tooltip) {
          return (
            <span
              data-tooltip-id="response-time-tooltip"
              data-tooltip-content={tooltip}
              data-copy-value={copyValue}
            >
              {formattedTime}
            </span>
          );
        }

        return <span data-copy-value={copyValue}>{formattedTime}</span>;
      },
    },
    {
      id: "status",
      label: "Status",
      className: "logs-page__col--status",
      cellClassName: "logs-page__cell--status",
      render: (entry) => {
        const blocked = isEntryBlocked(entry);
        const statusClass =
          blocked ?
            "logs-page__status-button--blocked"
          : "logs-page__status-button--allowed";
        const label = blocked ? "Blocked" : "Allowed";
        const hoverLabel = blocked ? "Allow?" : "Block?";

        return (
          <button
            type="button"
            className={`badge logs-page__status-button ${statusClass}`}
            data-copy-value={label}
            onClick={(event) => {
              event.stopPropagation();
              onStatusClick(entry);
            }}
          >
            <span className="logs-page__status-label logs-page__status-label--default">
              {label}
            </span>
            <span className="logs-page__status-label logs-page__status-label--hover">
              {hoverLabel}
            </span>
          </button>
        );
      },
    },
    {
      id: "protocol",
      label: "Protocol",
      className: "logs-page__col--protocol",
      optionalKey: "protocol",
      render: (entry) => entry.protocol ?? "—",
    },
    {
      id: "rcode",
      label: "RCode",
      className: "logs-page__col--rcode",
      render: (entry) => entry.rcode ?? "—",
    },
    {
      id: "qtype",
      label: "QType",
      className: "logs-page__col--qtype",
      render: (entry) => entry.qtype ?? "—",
    },
    {
      id: "qclass",
      label: "QClass",
      className: "logs-page__col--qclass",
      optionalKey: "qclass",
      render: (entry) => entry.qclass ?? "—",
    },
    {
      id: "domain",
      label: "Domain",
      className: "logs-page__col--domain",
      cellClassName: "logs-page__cell--domain logs-page__cell--clickable",
      render: (entry) => {
        const domain = entry.qname ?? "—";
        if (domain === "—") {
          return domain;
        }

        /**
         * SECURITY NOTE (XSS):
         * This column builds a small HTML snippet for the tooltip and later renders it via
         * `dangerouslySetInnerHTML` (see the shared tooltip render() below).
         *
         * Query logs (domains/answers/etc.) can be influenced by network clients, so treat
         * these values as untrusted input.
         *
         * Mitigation:
         * - Every dynamic/untrusted value interpolated into the tooltip HTML MUST be escaped
         *   using `escapeTooltipHtml()`.
         * - Only static markup (our own <div>/<strong> structure and a few CSS classes) is
         *   allowed to remain unescaped.
         *
         * If you add new fields to this tooltip, do not interpolate raw values.
         */
        const escapeTooltipHtml = (value: string): string => {
          return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        };

        const isBlocked = isEntryBlocked(entry);

        // Build comprehensive tooltip with entry and block/allow information
        const groupDetails = domainGroupDetailsMap.get(domain);

        // Build HTML string for tooltip content.
        // IMPORTANT: Any dynamic values must be escaped via `escapeTooltipHtml()`.
        // let tooltipHtml = `<div style="font-family: 'Menlo, Monaco, Consolas, monospace'; line-height: 1.5;">`;
        let tooltipHtml = `<div><strong>Domain:</strong> ${escapeTooltipHtml(domain)}</div>`;
        tooltipHtml += `<div><strong>Type:</strong> ${escapeTooltipHtml(entry.qtype ?? "Unknown")}</div>`;

        if (entry.responseType) {
          const iconChar =
            entry.responseType === "Blocked" ? "🚫"
            : entry.responseType === "Allowed" ? "✅"
            : "📄";
          tooltipHtml += `<div style="margin-top: 8px;"><strong>Status:</strong> ${iconChar} ${escapeTooltipHtml(entry.responseType)}</div>`;
        }

        if (groupDetails) {
          tooltipHtml += `<div style="margin-top: 8px;"><div><strong>Group:</strong> ${escapeTooltipHtml(groupDetails.groupName)}</div>`;
          if (groupDetails.blockedExact) {
            tooltipHtml += `<div class="tooltip-blocked" style="margin-left: 12px;">→ Blocked (Exact Match)</div>`;
          }
          if (groupDetails.blockedRegexMatches.length > 0) {
            tooltipHtml += `<div style="margin-left: 12px;"><div class="tooltip-blocked">→ Blocked by Regex:</div>`;
            groupDetails.blockedRegexMatches.forEach((pattern) => {
              tooltipHtml += `<div style="margin-left: 24px; font-size: 12px;">${escapeTooltipHtml(pattern)}</div>`;
            });
            tooltipHtml += `</div>`;
          }
          if (groupDetails.allowedExact) {
            tooltipHtml += `<div class="tooltip-allowed" style="margin-left: 12px;">→ Allowed (Exact Match)</div>`;
          }
          if (groupDetails.allowedRegexMatches.length > 0) {
            tooltipHtml += `<div style="margin-left: 12px;"><div class="tooltip-allowed">→ Allowed by Regex:</div>`;
            groupDetails.allowedRegexMatches.forEach((pattern) => {
              tooltipHtml += `<div style="margin-left: 24px; font-size: 12px;">${escapeTooltipHtml(pattern)}</div>`;
            });
            tooltipHtml += `</div>`;
          }
          tooltipHtml += `</div>`;
        }

        if (entry.answer) {
          const answers = entry.answer.split(",").map((a) => a.trim());
          tooltipHtml += `<div style="margin-top: 8px;"><div><strong>Answer:</strong></div>`;

          if (answers.length > 1) {
            // Helper to check if a record type can chain to other records
            const isChainableRecord = (answer: string): boolean => {
              const upper = answer.toUpperCase();
              return (
                upper.startsWith("CNAME ") ||
                upper.startsWith("DNAME ") ||
                upper.startsWith("SRV ") ||
                upper.startsWith("MX ")
              );
            };

            const hasChainableRecord = answers.some((a) =>
              isChainableRecord(a),
            );

            // Pre-calculate indent levels for each record
            const recordLevels: number[] = [];
            let currentIndentLevel = 0;
            let lastWasChainable = false;
            let hasSeenFirstNonChainable = false;

            answers.forEach((answer, index) => {
              const isChainable = isChainableRecord(answer);

              if (index > 0) {
                if (lastWasChainable && isChainable) {
                  currentIndentLevel++;
                } else if (
                  lastWasChainable &&
                  !isChainable &&
                  !hasSeenFirstNonChainable
                ) {
                  currentIndentLevel++;
                  hasSeenFirstNonChainable = true;
                }
              }

              recordLevels.push(currentIndentLevel);
              lastWasChainable = isChainable;
            });

            // Now render with proper branch characters
            answers.forEach((answer, index) => {
              const level = recordLevels[index];

              // Build the tree branch with box-drawing characters
              let branch = "";
              if (hasChainableRecord && index > 0) {
                // Check if there are more records at the same level after this one
                let hasMoreAtSameLevel = false;
                for (let i = index + 1; i < answers.length; i++) {
                  if (recordLevels[i] === level) {
                    hasMoreAtSameLevel = true;
                    break;
                  } else if (recordLevels[i] < level) {
                    // We've gone back to a shallower level, no more peers
                    break;
                  }
                }

                // Use ├ if there are more at same level, └ if this is the last at this level
                branch = hasMoreAtSameLevel ? "├─→ " : "└─→ ";
              }

              const indent = "&nbsp;&nbsp;&nbsp;&nbsp;".repeat(level);
              tooltipHtml += `<div style="margin-left: 12px; font-size: 12px;">${indent}${branch}${escapeTooltipHtml(answer)}</div>`;
            });
          } else {
            // Single answer
            tooltipHtml += `<div style="margin-left: 12px; font-size: 12px;">${escapeTooltipHtml(answers[0])}</div>`;
          }

          tooltipHtml += `</div>`;
        }

        tooltipHtml += `<div style="margin-top: 12px; font-size: 12px; opacity: 0.8;">💡 Click to filter logs by this domain</div>`;
        tooltipHtml += `</div>`;

        return (
          <span
            onClick={(e) => onDomainClick(entry, e.shiftKey)}
            onMouseEnter={() => onDomainHover(entry)}
            onFocus={() => onDomainHover(entry)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onDomainClick(entry, e.shiftKey);
              }
            }}
            data-tooltip-id="domain-tooltip-shared"
            data-tooltip-content={tooltipHtml}
            data-domain={domain}
            data-node-id={entry.nodeId}
            data-is-blocked={isBlocked ? "true" : "false"}
          >
            {domain}
          </span>
        );
      },
    },
    {
      id: "answer",
      label: "Answer",
      className: "logs-page__col--answer",
      cellClassName: "logs-page__cell--answer",
      optionalKey: "answer",
      render: (entry) => entry.answer ?? "—",
      getTitle: (entry) => entry.answer ?? undefined,
    },
  ];
};

/**
 * Swipeable Card Component for mobile gestures
 * Swipe-Left: Toggle Block/Allow
 * Swipe-Right: Toggle Selection
 */
function SwipeableCard({
  children,
  className,
  isBlocked,
  isSelected,
  domain,
  onToggleBlock,
  onToggleSelect,
  onSwipeStart,
}: {
  children: ReactNode;
  className: string;
  isBlocked: boolean;
  isSelected: boolean;
  domain: string;
  onToggleBlock: () => void;
  onToggleSelect: () => void;
  onSwipeStart?: () => void;
}) {
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchStartY, setTouchStartY] = useState<number | null>(null);
  const [touchCurrent, setTouchCurrent] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [hasHorizontalSwipe, setHasHorizontalSwipe] = useState(false);

  const resetTouchState = () => {
    setTouchStart(null);
    setTouchStartY(null);
    setTouchCurrent(null);
    setSwipeOffset(0);
    setIsSwiping(false);
    setHasHorizontalSwipe(false);
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    setTouchStart(touch.clientX);
    setTouchStartY(touch.clientY);
    setTouchCurrent(touch.clientX);
    setSwipeOffset(0);
    setIsSwiping(false);
    setHasHorizontalSwipe(false);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStart === null || touchStartY === null) {
      return;
    }

    const touch = e.touches[0];
    const currentX = touch.clientX;
    const currentY = touch.clientY;
    const diffX = currentX - touchStart;
    const diffY = currentY - touchStartY;

    if (!hasHorizontalSwipe) {
      const absX = Math.abs(diffX);
      const absY = Math.abs(diffY);
      const detectionThreshold = 12;

      if (absY > absX && absY > detectionThreshold) {
        // Treat as vertical scrolling; do not pause updates or translate card
        return;
      }

      if (absX > detectionThreshold && absX > absY) {
        setHasHorizontalSwipe(true);
        setIsSwiping(true);
        onSwipeStart?.();
      } else {
        return;
      }
    }

    const maxSwipe = 150;
    const resistanceFactor = 0.3;
    let offset = diffX;

    if (Math.abs(diffX) > maxSwipe) {
      const excess = Math.abs(diffX) - maxSwipe;
      offset =
        diffX > 0 ?
          maxSwipe + excess * resistanceFactor
        : -maxSwipe - excess * resistanceFactor;
    }

    setTouchCurrent(currentX);
    setSwipeOffset(offset);
  };

  const handleTouchEnd = () => {
    if (!hasHorizontalSwipe || touchStart === null || touchCurrent === null) {
      resetTouchState();
      return;
    }

    const swipeDistance = touchCurrent - touchStart;
    const threshold = 80; // Minimum swipe distance to trigger action

    if (swipeDistance < -threshold) {
      // Swipe left - Toggle Block/Allow
      onToggleBlock();
    } else if (swipeDistance > threshold) {
      // Swipe right - Toggle Selection
      if (domain) {
        onToggleSelect();
      }
    }

    // Reset swipe state
    resetTouchState();
  };

  const handleTouchCancel = () => {
    resetTouchState();
  };

  // Determine which action button to show based on swipe direction
  const showLeftAction = swipeOffset < -30; // Swiping left (Block/Allow)
  const showRightAction = swipeOffset > 30; // Swiping right (Select)

  return (
    <div className="logs-page__card-wrapper">
      {/* Left action (Block/Allow) - revealed when swiping left */}
      <div
        className={`logs-page__card-swipe-action logs-page__card-swipe-action--left ${showLeftAction ? "visible" : ""}`}
      >
        <button
          type="button"
          className={`logs-page__card-swipe-btn ${isBlocked ? "logs-page__card-swipe-btn--allow" : "logs-page__card-swipe-btn--block"}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleBlock();
          }}
        >
          <>
            <FontAwesomeIcon icon={isBlocked ? faCheck : faBan} />{" "}
            {isBlocked ? "Allow" : "Block"}
          </>
        </button>
      </div>

      {/* Right action (Select) - revealed when swiping right */}
      <div
        className={`logs-page__card-swipe-action logs-page__card-swipe-action--right ${showRightAction ? "visible" : ""}`}
      >
        <button
          type="button"
          className="logs-page__card-swipe-btn logs-page__card-swipe-btn--select"
          onClick={(e) => {
            e.stopPropagation();
            if (domain) onToggleSelect();
          }}
        >
          <>
            <FontAwesomeIcon icon={isSelected ? faSquare : faSquareCheck} />{" "}
            {isSelected ? "Deselect" : "Select"}
          </>
        </button>
      </div>

      {/* Card content */}
      <div
        className={className}
        style={{
          transform: `translateX(${swipeOffset}px)`,
          transition: isSwiping ? "none" : "transform 0.3s ease-out",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Render a card-based view optimized for mobile
 */
const renderCardsView = (
  entries: TechnitiumCombinedQueryLogEntry[],
  selectedDomains: Set<string>,
  domainToGroupMap: Map<string, number>,
  domainGroupDetailsMap: Map<string, DomainGroupDetails>,
  onToggleDomain: (domain: string) => void,
  onStatusClick: (
    entry: TechnitiumCombinedQueryLogEntry,
    forceToggle?: boolean,
  ) => void,
  onClientClick: (
    entry: TechnitiumCombinedQueryLogEntry,
    shiftKey: boolean,
  ) => void,
  onDomainClick: (
    entry: TechnitiumCombinedQueryLogEntry,
    shiftKey: boolean,
  ) => void,
  loadingState: "idle" | "loading" | "refreshing",
  isFilteringActive: boolean,
  deduplicateDomains: boolean,
  columnVisibility: ColumnVisibility,
  onSwipeStart?: () => void,
) => {
  if (loadingState === "loading") {
    return <SkeletonLogEntries entries={DEFAULT_ENTRIES_PER_PAGE} />;
  }

  if (entries.length === 0) {
    return (
      <div className="logs-page__cards-empty">
        {isFilteringActive ?
          "No log entries match the current filters."
        : "No log entries found for the selected view."}
      </div>
    );
  }

  return (
    <div className="logs-page__cards">
      {entries.map((entry) => {
        const domain = entry.qname ?? "";
        const isSelected = selectedDomains.has(domain);
        const groupNumber = domainToGroupMap.get(domain);
        const groupDetails = domainGroupDetailsMap.get(domain);
        const isBlocked = isEntryBlocked(entry);
        const responseBadge = classifyResponseType(entry.responseType);

        // Build card class name
        let cardClassName = "logs-page__card";
        if (isBlocked) {
          cardClassName += " logs-page__card--blocked";
        }
        if (isSelected && groupNumber !== undefined) {
          const colorIndex = (groupNumber - 1) % 10;
          cardClassName += ` logs-page__card--selected-color-${colorIndex}`;
        }

        return (
          <SwipeableCard
            key={`${entry.nodeId}-${entry.rowNumber}-${entry.timestamp}`}
            className={cardClassName}
            isBlocked={isBlocked}
            isSelected={isSelected}
            domain={domain}
            onToggleBlock={() => onStatusClick(entry)}
            onToggleSelect={() => onToggleDomain(domain)}
            onSwipeStart={onSwipeStart}
          >
            {/* Card Header: Checkbox + Domain + Status */}
            <div className="logs-page__card-header">
              <div className="logs-page__card-select">
                {domain && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleDomain(domain)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${domain}`}
                  />
                )}
                {groupNumber !== undefined && groupDetails && (
                  <span
                    className={`logs-page__card-group-badge logs-page__card-group-badge--${groupNumber}`}
                    title={(() => {
                      // Build tooltip content
                      const tooltipLines: string[] = [];
                      tooltipLines.push(
                        `Group ${groupNumber}: ${groupDetails.groupName}`,
                      );
                      tooltipLines.push("━━━━━━━━━━━━━━━━");

                      if (groupDetails.blockedExact) {
                        tooltipLines.push("✓ Blocked (Exact Match)");
                        tooltipLines.push(`  • ${domain}`);
                      } else if (groupDetails.blockedRegexMatches.length > 0) {
                        tooltipLines.push("✓ Blocked (Regex Match)");
                        groupDetails.blockedRegexMatches.forEach((pattern) => {
                          tooltipLines.push(`  • Pattern: ${pattern}`);
                        });
                      }

                      if (groupDetails.allowedExact) {
                        tooltipLines.push("✓ Allowed (Exact Match)");
                        tooltipLines.push(`  • ${domain}`);
                      } else if (groupDetails.allowedRegexMatches.length > 0) {
                        tooltipLines.push("✓ Allowed (Regex Match)");
                        groupDetails.allowedRegexMatches.forEach((pattern) => {
                          tooltipLines.push(`  • Pattern: ${pattern}`);
                        });
                      }

                      return tooltipLines.join("\n");
                    })()}
                  >
                    {groupNumber}
                  </span>
                )}
              </div>
              <div
                className="logs-page__card-domain"
                onClick={(e) => onDomainClick(entry, e.shiftKey)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onDomainClick(entry, e.shiftKey);
                  }
                }}
              >
                {domain || "(no domain)"}
              </div>
              <button
                type="button"
                className={`logs-page__card-status logs-page__card-status--${responseBadge.className}`}
                onClick={() => onStatusClick(entry)}
                title={
                  isBlocked ?
                    "Blocked - Click to allow"
                  : "Allowed - Click to block"
                }
              >
                {responseBadge.icon}
              </button>
            </div>

            {/* Card Body: Key info */}
            <div className="logs-page__card-body">
              <div className="logs-page__card-row">
                <span className="logs-page__card-label">Client:</span>
                <span
                  className="logs-page__card-value logs-page__card-value--clickable"
                  onClick={(e) => onClientClick(entry, e.shiftKey)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onClientClick(entry, e.shiftKey);
                    }
                  }}
                  title="Click to filter by client"
                >
                  {entry.clientName && entry.clientName.trim().length > 0 ?
                    <div className="logs-page__card-client-info">
                      <div className="logs-page__card-client-hostname">
                        {entry.clientName}
                      </div>
                      {entry.clientIpAddress && (
                        <div className="logs-page__card-client-ip">
                          {entry.clientIpAddress}
                        </div>
                      )}
                    </div>
                  : (entry.clientIpAddress ?? "—")}
                </span>
              </div>
              {!deduplicateDomains && (
                <div className="logs-page__card-row">
                  <span className="logs-page__card-label">Type:</span>
                  <span className="logs-page__card-value">
                    {entry.qtype ?? "—"}
                  </span>
                </div>
              )}
              {columnVisibility.protocol && entry.protocol && (
                <div className="logs-page__card-row">
                  <span className="logs-page__card-label">Protocol:</span>
                  <span className="logs-page__card-value">
                    {entry.protocol}
                  </span>
                </div>
              )}
              {columnVisibility.qclass && entry.qclass && (
                <div className="logs-page__card-row">
                  <span className="logs-page__card-label">Class:</span>
                  <span className="logs-page__card-value">{entry.qclass}</span>
                </div>
              )}
              <div className="logs-page__card-row">
                <span className="logs-page__card-label">Time:</span>
                <span className="logs-page__card-value">
                  {entry.timestamp ?
                    new Date(entry.timestamp).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "—"}
                </span>
              </div>
              {columnVisibility.responseTime &&
                entry.responseRtt &&
                entry.responseRtt > 0 && (
                  <div className="logs-page__card-row">
                    <span className="logs-page__card-label">
                      Response Time:
                    </span>
                    <span className="logs-page__card-value">
                      {formatResponseRtt(entry.responseRtt)}
                    </span>
                  </div>
                )}
              {columnVisibility.answer && entry.answer && (
                <div className="logs-page__card-row">
                  <span className="logs-page__card-label">Answer:</span>
                  <span className="logs-page__card-value logs-page__card-value--answer">
                    {entry.answer}
                  </span>
                </div>
              )}
            </div>
          </SwipeableCard>
        );
      })}
    </div>
  );
};

const loadInitialColumnVisibility = (): ColumnVisibility => {
  if (typeof window === "undefined") {
    return DEFAULT_COLUMN_VISIBILITY;
  }

  try {
    const stored = window.localStorage.getItem(COLUMN_VISIBILITY_STORAGE_KEY);
    if (!stored) {
      return DEFAULT_COLUMN_VISIBILITY;
    }

    const parsed = JSON.parse(stored) as Partial<ColumnVisibility> | null;
    if (!parsed) {
      return DEFAULT_COLUMN_VISIBILITY;
    }

    return {
      ...DEFAULT_COLUMN_VISIBILITY,
      ...parsed,
    } satisfies ColumnVisibility;
  } catch (error) {
    console.warn("Failed to parse column visibility settings", error);
    return DEFAULT_COLUMN_VISIBILITY;
  }
};

const loadFilterTipDismissed = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const stored = window.localStorage.getItem(FILTER_TIP_DISMISSED_KEY);
    return stored === "true";
  } catch (error) {
    console.warn("Failed to load filter tip dismissed state", error);
    return false;
  }
};

const loadSelectionTipDismissed = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const stored = window.localStorage.getItem(SELECTION_TIP_DISMISSED_KEY);
    return stored === "true";
  } catch (error) {
    console.warn("Failed to load selection tip dismissed state", error);
    return false;
  }
};

const loadMobileLayoutMode = (): MobileLayoutMode => {
  if (typeof window === "undefined") {
    return "card-view";
  }

  try {
    const stored = window.localStorage.getItem(MOBILE_LAYOUT_MODE_KEY);
    if (stored === "card-view" || stored === "compact-table") {
      return stored;
    }
    return "card-view";
  } catch (error) {
    console.warn("Failed to load mobile layout mode", error);
    return "card-view";
  }
};

const loadTailBufferSize = (): number => {
  if (typeof window === "undefined") {
    return DEFAULT_TAIL_BUFFER_SIZE;
  }

  try {
    const stored = window.localStorage.getItem(TAIL_BUFFER_SIZE_STORAGE_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn("Failed to load tail buffer size", error);
  }

  return DEFAULT_TAIL_BUFFER_SIZE;
};

const loadPaginatedRowsPerPage = (): number => {
  if (typeof window === "undefined") {
    return DEFAULT_ENTRIES_PER_PAGE;
  }

  try {
    const stored = window.localStorage.getItem(
      PAGINATED_ROWS_PER_PAGE_STORAGE_KEY,
    );
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (
        !Number.isNaN(parsed) &&
        PAGINATED_ROWS_PER_PAGE_OPTIONS.includes(parsed)
      ) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn("Failed to load paginated rows-per-page setting", error);
  }

  return DEFAULT_ENTRIES_PER_PAGE;
};

const loadDeduplicateDomains = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const stored = window.localStorage.getItem(DEDUPLICATE_DOMAINS_STORAGE_KEY);
    return stored === "true";
  } catch (error) {
    console.warn("Failed to load deduplicate domains setting", error);
    return false;
  }
};

interface BlockDialogState {
  entry: TechnitiumCombinedQueryLogEntry;
}

// Memoized table row component to prevent unnecessary re-renders
interface LogTableRowProps {
  entry: TechnitiumCombinedQueryLogEntry;
  activeColumns: ColumnDefinition[];
  selectedDomains: Set<string>;
  domainToGroupMap: Map<string, number>;
  newEntryTimestamps: Set<string>;
  isEntryBlocked: (entry: TechnitiumCombinedQueryLogEntry) => boolean;
}

const LogTableRow = React.memo<LogTableRowProps>(
  ({
    entry,
    activeColumns,
    selectedDomains,
    domainToGroupMap,
    newEntryTimestamps,
    isEntryBlocked,
  }) => {
    const domain = entry.qname ?? "";
    const isSelected = selectedDomains.has(domain);
    const groupNumber = domainToGroupMap.get(domain);
    const isNewEntry = newEntryTimestamps.has(entry.timestamp);

    // Build class name
    let rowClassName = "logs-page__row";

    if (isEntryBlocked(entry)) {
      rowClassName += " logs-page__row--blocked";
    }

    // Add new entry indicator
    if (isNewEntry) {
      rowClassName += " logs-page__row--new";
    }

    // Only add group class if domain is selected
    // Use modulo 10 for cycling through 10 colors
    if (isSelected && groupNumber !== undefined) {
      const colorIndex = (groupNumber - 1) % 10; // Subtract 1 because groupNumber starts at 1
      rowClassName += ` logs-page__row--selected-color-${colorIndex}`;
    }

    return (
      <tr
        key={`${entry.nodeId}-${entry.rowNumber}-${entry.timestamp}`}
        className={rowClassName}
      >
        {activeColumns.map((column) => {
          const content = column.render(entry);
          const title = column.getTitle ? column.getTitle(entry) : undefined;
          const cellClass =
            column.cellClassName ?
              `${column.cellClassName} logs-page__cell`
            : "logs-page__cell";

          return (
            <td
              key={column.id}
              className={cellClass}
              title={title}
              data-column-id={column.id}
            >
              {content}
            </td>
          );
        })}
      </tr>
    );
  },
);

LogTableRow.displayName = "LogTableRow";

export function LogsPage() {
  const {
    nodes,
    loadCombinedLogs,
    loadNodeLogs,
    loadQueryLogStorageStatus,
    loadStoredCombinedLogs,
    loadStoredNodeLogs,
    advancedBlocking,
    reloadAdvancedBlocking,
    saveAdvancedBlockingConfig,
  } = useTechnitiumState();

  const { pushToast } = useToast();

  type DomainBlockSourceLookupStatus = "idle" | "loading" | "loaded" | "error";

  type DomainBlockSourceLookupState = {
    status: DomainBlockSourceLookupStatus;
    fetchedAt?: number;
    result?: DomainCheckResult;
    error?: string;
  };

  const normalizeDomainForLookup = useCallback((raw: string): string => {
    return raw.trim().replace(/\.$/, "").toLowerCase();
  }, []);

  const getDomainBlockSourceCacheKey = useCallback(
    (nodeId: string, domain: string): string => {
      return `${nodeId}::${normalizeDomainForLookup(domain)}`;
    },
    [normalizeDomainForLookup],
  );

  const [domainBlockSourceByKey, setDomainBlockSourceByKey] = useState<
    Record<string, DomainBlockSourceLookupState>
  >({});
  const domainBlockSourceRef = useRef(domainBlockSourceByKey);

  useEffect(() => {
    domainBlockSourceRef.current = domainBlockSourceByKey;
  }, [domainBlockSourceByKey]);

  const [activeDomainTooltipKey, setActiveDomainTooltipKey] = useState<
    string | null
  >(null);
  const [expandedDomainTooltipKey, setExpandedDomainTooltipKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    setExpandedDomainTooltipKey(null);
  }, [activeDomainTooltipKey]);

  const domainBlockSourceHoverTimerRef = useRef<number | null>(null);
  const domainBlockSourceAbortRef = useRef<AbortController | null>(null);
  const domainTooltipAnchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    return () => {
      if (domainBlockSourceHoverTimerRef.current !== null) {
        window.clearTimeout(domainBlockSourceHoverTimerRef.current);
        domainBlockSourceHoverTimerRef.current = null;
      }
      domainBlockSourceAbortRef.current?.abort();
      domainBlockSourceAbortRef.current = null;
    };
  }, []);

  const fetchDomainBlockSources = useCallback(
    async (nodeId: string, domain: string, signal: AbortSignal) => {
      const cleanDomain = normalizeDomainForLookup(domain);

      const response = await apiFetch(
        `/domain-lists/${encodeURIComponent(nodeId)}/check?domain=${encodeURIComponent(cleanDomain)}`,
        { signal },
      );

      if (!response.ok) {
        throw new Error(
          `Failed to check domain lists for ${nodeId} (${response.status})`,
        );
      }

      const payload = (await response.json()) as
        | DomainCheckResult
        | { error: string };

      if ("error" in payload) {
        throw new Error(payload.error);
      }

      return payload;
    },
    [normalizeDomainForLookup],
  );

  const triggerDomainBlockSourceLookupImmediate = useCallback(
    (nodeId: string, domain: string) => {
      if (!nodeId || domain.trim().length === 0) {
        return;
      }

      const key = getDomainBlockSourceCacheKey(nodeId, domain);
      setActiveDomainTooltipKey(key);

      const existing = domainBlockSourceRef.current[key];
      if (existing?.status === "loaded" || existing?.status === "loading") {
        return;
      }

      if (domainBlockSourceHoverTimerRef.current !== null) {
        window.clearTimeout(domainBlockSourceHoverTimerRef.current);
        domainBlockSourceHoverTimerRef.current = null;
      }

      domainBlockSourceAbortRef.current?.abort();
      domainBlockSourceAbortRef.current = null;

      const abortController = new AbortController();
      domainBlockSourceAbortRef.current = abortController;

      setDomainBlockSourceByKey((prev) => ({
        ...prev,
        [key]: { status: "loading" },
      }));

      fetchDomainBlockSources(nodeId, domain, abortController.signal)
        .then((result) => {
          setDomainBlockSourceByKey((prev) => {
            const now = Date.now();
            const next: Record<string, DomainBlockSourceLookupState> = {
              ...prev,
              [key]: { status: "loaded", result, fetchedAt: now },
            };

            const keys = Object.keys(next);
            if (keys.length <= DOMAIN_BLOCK_SOURCE_CACHE_MAX_ENTRIES) {
              return next;
            }

            keys
              .sort(
                (a, b) => (next[a].fetchedAt ?? 0) - (next[b].fetchedAt ?? 0),
              )
              .slice(0, keys.length - DOMAIN_BLOCK_SOURCE_CACHE_MAX_ENTRIES)
              .forEach((oldKey) => {
                delete next[oldKey];
              });

            return next;
          });
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) {
            return;
          }

          const message =
            error instanceof Error ? error.message : String(error);
          setDomainBlockSourceByKey((prev) => ({
            ...prev,
            [key]: { status: "error", error: message, fetchedAt: Date.now() },
          }));
        });
    },
    [fetchDomainBlockSources, getDomainBlockSourceCacheKey],
  );

  const scheduleDomainBlockSourceLookup = useCallback(
    (entry: TechnitiumCombinedQueryLogEntry) => {
      if (!isEntryBlocked(entry)) {
        return;
      }

      const nodeId = entry.nodeId;
      const domain = entry.qname?.trim() ?? "";
      if (!nodeId || domain.length === 0) {
        return;
      }

      const key = getDomainBlockSourceCacheKey(nodeId, domain);
      setActiveDomainTooltipKey(key);

      const existing = domainBlockSourceRef.current[key];
      if (existing?.status === "loaded" || existing?.status === "loading") {
        return;
      }

      if (domainBlockSourceHoverTimerRef.current !== null) {
        window.clearTimeout(domainBlockSourceHoverTimerRef.current);
        domainBlockSourceHoverTimerRef.current = null;
      }

      // If we begin a new hover lookup, cancel any in-flight request for the prior anchor.
      domainBlockSourceAbortRef.current?.abort();
      domainBlockSourceAbortRef.current = null;

      domainBlockSourceHoverTimerRef.current = window.setTimeout(() => {
        domainBlockSourceHoverTimerRef.current = null;

        const latest = domainBlockSourceRef.current[key];
        if (latest?.status === "loaded" || latest?.status === "loading") {
          return;
        }

        triggerDomainBlockSourceLookupImmediate(nodeId, domain);
      }, DOMAIN_BLOCK_SOURCE_HOVER_DELAY_MS);
    },
    [getDomainBlockSourceCacheKey, triggerDomainBlockSourceLookupImmediate],
  );

  const isBlockMatch = useCallback((type: string | undefined): boolean => {
    return (
      type === "blocklist" ||
      type === "regex-blocklist" ||
      type === "manual-blocked"
    );
  }, []);

  const getBlockMatchDedupeKey = useCallback(
    (match: DomainListEntry): string => {
      const sortedGroups =
        match.groups ? [...match.groups].sort().join(",") : "";

      return [
        match.type ?? "",
        match.source ?? "",
        match.groupName ?? "",
        sortedGroups,
        match.matchedPattern ?? "",
        match.matchedDomain ?? "",
      ].join("||");
    },
    [],
  );

  const formatBlockMatchLabel = useCallback(
    (match: DomainListEntry): string => {
      const typeLabel =
        match.type === "manual-blocked" ? "Manual"
        : match.type === "regex-blocklist" ? "Regex"
        : "Blocklist";

      const sourceLabel = match.source === "manual" ? "manual" : match.source;

      const details: string[] = [];
      if (match.groupName) details.push(`group=${match.groupName}`);
      if (match.matchedPattern) details.push(`pattern=${match.matchedPattern}`);
      if (match.matchedDomain) details.push(`match=${match.matchedDomain}`);
      if (match.groups && match.groups.length > 0) {
        details.push(`groups=${[...match.groups].sort().join(", ")}`);
      }

      return details.length > 0 ?
          `${typeLabel}: ${sourceLabel} (${details.join(", ")})`
        : `${typeLabel}: ${sourceLabel}`;
    },
    [],
  );

  type LogsTableContextMenuItem =
    | { label: string; action: "copy"; value: string }
    | { label: string; action: "open"; href: string };

  type LogsTableContextMenuState = {
    x: number;
    y: number;
    items: LogsTableContextMenuItem[];
  };

  const [logsTableContextMenu, setLogsTableContextMenu] =
    useState<LogsTableContextMenuState | null>(null);
  const logsTableContextMenuRef = useRef<HTMLDivElement | null>(null);
  const logsTableContextMenuOpenRef = useRef<boolean>(false);

  const logsTableContextMenuResumeRef = useRef<{
    shouldResume: boolean;
    previousRefreshSeconds: number;
  } | null>(null);
  const logsRefreshSecondsRef = useRef<number>(0);
  const setLogsRefreshSecondsRef = useRef<React.Dispatch<
    React.SetStateAction<number>
  > | null>(null);
  const setLogsIsAutoRefreshRef = useRef<React.Dispatch<
    React.SetStateAction<boolean>
  > | null>(null);

  const closeLogsTableContextMenu = useCallback(() => {
    setLogsTableContextMenu(null);

    const resumeState = logsTableContextMenuResumeRef.current;
    if (resumeState?.shouldResume) {
      logsTableContextMenuResumeRef.current = null;

      const resumeTo = resumeState.previousRefreshSeconds;
      if (resumeTo > 0) {
        setLogsRefreshSecondsRef.current?.(resumeTo);
      }
    }
  }, []);

  const pauseLiveRefreshForLogsContextMenu = useCallback(() => {
    const currentSeconds = logsRefreshSecondsRef.current;

    if (currentSeconds > 0) {
      logsTableContextMenuResumeRef.current = {
        shouldResume: true,
        previousRefreshSeconds: currentSeconds,
      };
      // Pause immediately.
      setLogsIsAutoRefreshRef.current?.(false);
      setLogsRefreshSecondsRef.current?.(0);
      return;
    }

    logsTableContextMenuResumeRef.current = null;
  }, []);

  const copyTextToClipboard = useCallback(async (text: string) => {
    if (text.length === 0) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // Fallback below.
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }, []);

  const extractContextMenuItemsFromTarget = useCallback(
    (target: EventTarget | null): LogsTableContextMenuItem[] | null => {
      if (!target || !(target instanceof HTMLElement)) {
        return null;
      }

      const isValidHttpUrl = (value: string): boolean => {
        if (!value) {
          return false;
        }

        try {
          const parsed = new URL(value);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      };

      // If the user right-clicked inside the domain tooltip, provide tooltip-specific copy options.
      const tooltipRoot =
        (target.closest("#domain-tooltip-shared") as HTMLElement | null) ??
        ((target.closest(".domain-tooltip") as HTMLElement | null)?.closest(
          "#domain-tooltip-shared",
        ) as HTMLElement | null);

      if (tooltipRoot) {
        const anchor = domainTooltipAnchorRef.current;
        const anchorDomain = anchor?.getAttribute("data-domain")?.trim() ?? "";
        const anchorNodeId = anchor?.getAttribute("data-node-id")?.trim() ?? "";

        const matchTarget = target.closest(
          "[data-logs-tooltip-block-source]",
        ) as HTMLElement | null;

        // If the user right-clicked a specific "Likely blocked by" match, offer granular options.
        if (matchTarget) {
          const label =
            matchTarget.getAttribute("data-block-match-label") ?? "";
          const source =
            matchTarget.getAttribute("data-block-match-source") ?? "";
          const pattern =
            matchTarget.getAttribute("data-block-match-pattern") ?? "";

          const items: LogsTableContextMenuItem[] = [];

          if (anchorDomain) {
            items.push({
              label: "Copy Domain",
              action: "copy",
              value: anchorDomain,
            });
          }

          if (label) {
            items.push({ label: "Copy Match", action: "copy", value: label });
          }

          if (source) {
            items.push({ label: "Copy Source", action: "copy", value: source });
            if (isValidHttpUrl(source)) {
              items.push({
                label: "Open Source URL",
                action: "open",
                href: source,
              });
            }
          }

          if (pattern) {
            items.push({
              label: "Copy Pattern",
              action: "copy",
              value: pattern,
            });
          }

          return items.length > 0 ? items : null;
        }

        // Otherwise, offer general tooltip copy options.
        const items: LogsTableContextMenuItem[] = [];
        if (anchorDomain) {
          items.push({
            label: "Copy Domain",
            action: "copy",
            value: anchorDomain,
          });
        }
        if (anchorNodeId) {
          items.push({
            label: "Copy Node",
            action: "copy",
            value: anchorNodeId,
          });
        }

        return items.length > 0 ? items : null;
      }

      const cell = target.closest("td");
      if (!cell || !cell.closest("tbody")) {
        return null;
      }

      const columnId = (cell as HTMLElement).dataset.columnId;

      if (columnId === "client") {
        const container = (cell as HTMLElement).querySelector(
          ".logs-page__client-info",
        );
        if (!container) {
          return null;
        }

        const ip = container.getAttribute("data-copy-ip")?.trim() ?? "";
        const hostname =
          container.getAttribute("data-copy-hostname")?.trim() ?? "";

        if (ip.length > 0 && hostname.length > 0) {
          return [
            { label: "Copy IP", action: "copy", value: ip },
            { label: "Copy Hostname", action: "copy", value: hostname },
          ];
        }

        if (ip.length > 0) {
          return [{ label: "Copy IP", action: "copy", value: ip }];
        }

        if (hostname.length > 0) {
          return [{ label: "Copy Hostname", action: "copy", value: hostname }];
        }

        return null;
      }

      // Prefer explicit copy value inside the cell (Response, Status, Response Time, etc.)
      const explicitInCell = (cell as HTMLElement).querySelector(
        "[data-copy-value]",
      );
      if (explicitInCell) {
        const value =
          explicitInCell.getAttribute("data-copy-value")?.trim() ?? "";

        if (columnId === "responseTime" && value === "—") {
          return null;
        }

        return value.length > 0 && value !== "—" ?
            [{ label: "Copy", action: "copy", value }]
          : null;
      }

      const value = (cell as HTMLElement).innerText.trim();

      if (columnId === "responseTime" && value === "—") {
        return null;
      }

      return value.length > 0 && value !== "—" ?
          [{ label: "Copy", action: "copy", value }]
        : null;
    },
    [],
  );

  const handleLogsTableContextMenu = useCallback(
    (event: React.MouseEvent) => {
      // Allow native browser context menu via modifier.
      if (event.shiftKey) {
        closeLogsTableContextMenu();
        return;
      }

      const items = extractContextMenuItemsFromTarget(event.target);
      if (!items || items.length === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      pauseLiveRefreshForLogsContextMenu();
      setLogsTableContextMenu({ x: event.clientX, y: event.clientY, items });
    },
    [
      closeLogsTableContextMenu,
      extractContextMenuItemsFromTarget,
      pauseLiveRefreshForLogsContextMenu,
    ],
  );

  const handleContextMenuAction = useCallback(
    async (item: LogsTableContextMenuItem) => {
      if (item.action === "copy") {
        if (!item.value) {
          return;
        }
        await copyTextToClipboard(item.value);
        closeLogsTableContextMenu();
        return;
      }

      if (item.action === "open") {
        if (!item.href) {
          return;
        }

        window.open(item.href, "_blank", "noopener,noreferrer");
        closeLogsTableContextMenu();
      }
    },
    [closeLogsTableContextMenu, copyTextToClipboard],
  );

  useEffect(() => {
    logsTableContextMenuOpenRef.current = Boolean(logsTableContextMenu);
  }, [logsTableContextMenu]);

  useEffect(() => {
    if (!logsTableContextMenu) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeLogsTableContextMenu();
      }
    };

    const handleCloseOnViewportChange = () => {
      closeLogsTableContextMenu();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleCloseOnViewportChange);
    window.addEventListener("scroll", handleCloseOnViewportChange, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleCloseOnViewportChange);
      window.removeEventListener("scroll", handleCloseOnViewportChange, true);
    };
  }, [closeLogsTableContextMenu, logsTableContextMenu]);

  useEffect(() => {
    if (!logsTableContextMenu || !logsTableContextMenuRef.current) {
      return;
    }

    const rect = logsTableContextMenuRef.current.getBoundingClientRect();
    const padding = 8;

    let nextX = logsTableContextMenu.x;
    let nextY = logsTableContextMenu.y;

    if (nextX + rect.width + padding > window.innerWidth) {
      nextX = Math.max(padding, window.innerWidth - rect.width - padding);
    }

    if (nextY + rect.height + padding > window.innerHeight) {
      nextY = Math.max(padding, window.innerHeight - rect.height - padding);
    }

    if (nextX === logsTableContextMenu.x && nextY === logsTableContextMenu.y) {
      return;
    }

    setLogsTableContextMenu((current) => {
      if (!current) {
        return current;
      }

      if (current.x === nextX && current.y === nextY) {
        return current;
      }

      return { ...current, x: nextX, y: nextY };
    });
  }, [logsTableContextMenu]);

  const [mode, setMode] = useState<ViewMode>("combined");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("tail");
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    () => nodes[0]?.id ?? "",
  );
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [combinedPage, setCombinedPage] = useState<
    TechnitiumCombinedQueryLogPage | undefined
  >();
  const [combinedNodeSnapshots, setCombinedNodeSnapshots] = useState<
    TechnitiumCombinedNodeLogSnapshot[]
  >([]);
  const [nodeSnapshot, setNodeSnapshot] = useState<
    TechnitiumNodeQueryLogEnvelope | undefined
  >();

  useEffect(() => {
    if (mode !== "combined") {
      setCombinedNodeSnapshots([]);
    }
  }, [mode]);
  const [refreshSeconds, setRefreshSeconds] = useState<number>(
    TAIL_MODE_DEFAULT_REFRESH,
  );
  const [refreshTick, setRefreshTick] = useState<number>(0);
  const [isAutoRefresh, setIsAutoRefresh] = useState<boolean>(false);

  useEffect(() => {
    logsRefreshSecondsRef.current = refreshSeconds;
  }, [refreshSeconds]);

  useEffect(() => {
    setLogsRefreshSecondsRef.current = setRefreshSeconds;
    setLogsIsAutoRefreshRef.current = setIsAutoRefresh;
  }, [setRefreshSeconds, setIsAutoRefresh]);

  const [queryLogStorageStatus, setQueryLogStorageStatus] =
    useState<TechnitiumQueryLogStorageStatus | null>(null);
  const storedLogsReady = queryLogStorageStatus?.ready === true;
  const queryLogRetentionHours = queryLogStorageStatus?.retentionHours ?? 24;

  const logsSourceKind =
    displayMode === "tail" ? "live"
    : storedLogsReady ? "stored"
    : "live";

  const logsSourceLabel =
    logsSourceKind === "stored" ? "Stored (SQLite)" : "Live (Nodes)";
  const logsSourceTitle =
    logsSourceKind === "stored" ?
      "Stored logs are served from Companion's SQLite store (fast + cacheable)."
    : "Live logs are fetched directly from the Technitium DNS nodes.";

  const storedResponseCache = queryLogStorageStatus?.responseCache;
  const storedResponseCacheLookups =
    (storedResponseCache?.hits ?? 0) + (storedResponseCache?.misses ?? 0);
  const storedResponseCacheHitRatePercent =
    storedResponseCache && storedResponseCacheLookups > 0 ?
      Math.round((storedResponseCache.hits / storedResponseCacheLookups) * 100)
    : null;

  useEffect(() => {
    const abortController = new AbortController();

    loadQueryLogStorageStatus({ signal: abortController.signal })
      .then((status) => setQueryLogStorageStatus(status))
      .catch((error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "name" in error &&
          (error as { name?: string }).name === "AbortError"
        ) {
          return;
        }

        // Treat errors as "not ready" so the UI stays safe.
        setQueryLogStorageStatus(null);
      });

    return () => abortController.abort();
  }, [loadQueryLogStorageStatus]);

  // Tail mode state
  const [tailBuffer, setTailBuffer] = useState<
    TechnitiumCombinedQueryLogEntry[]
  >([]);
  const [tailPaused, setTailPaused] = useState<boolean>(false);
  const [tailNewestTimestamp, setTailNewestTimestamp] = useState<string | null>(
    null,
  );
  const [newEntryTimestamps, setNewEntryTimestamps] = useState<Set<string>>(
    new Set(),
  );

  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsPopupHorizontalAlign, setSettingsPopupHorizontalAlign] =
    useState<"left" | "right">("left");
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const [filtersVisible, setFiltersVisible] = useState<boolean>(false);
  const [statisticsExpanded, setStatisticsExpanded] = useState<boolean>(false);
  const [mobileControlsExpanded, setMobileControlsExpanded] =
    useState<boolean>(false);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibility>(
    loadInitialColumnVisibility,
  );
  const [tailBufferSize, setTailBufferSize] =
    useState<number>(loadTailBufferSize);
  const [paginatedRowsPerPage, setPaginatedRowsPerPage] = useState<number>(
    loadPaginatedRowsPerPage,
  );
  const [deduplicateDomains, setDeduplicateDomains] = useState<boolean>(
    loadDeduplicateDomains,
  );

  // After the first successful load, keep the existing table visible during subsequent loads.
  // This avoids window scroll jumps when paging (Prev/Next) by preventing large layout shrink.
  const hasLoadedAnyLogsRef = useRef<boolean>(false);

  // Prevent overlapping log loads (auto-refresh can otherwise stack requests if a call takes longer than refresh interval)
  const logsFetchInFlightRef = useRef<boolean>(false);
  const logsFetchAbortRef = useRef<AbortController | null>(null);
  const logsResumeDebugToastAtRef = useRef<number>(0);

  const [blockDialog, setBlockDialog] = useState<
    BlockDialogState | undefined
  >();
  const [blockSelectedGroups, setBlockSelectedGroups] = useState<Set<string>>(
    new Set<string>(),
  );
  const [blockError, setBlockError] = useState<string | undefined>();
  const [isBlocking, setIsBlocking] = useState<boolean>(false);
  const [blockMode, setBlockMode] = useState<"exact" | "regex">("exact");
  const [blockRegexValue, setBlockRegexValue] = useState<string>("");
  const [blockingAction, setBlockingAction] = useState<"block" | "allow">(
    "block",
  );
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [clientFilter, setClientFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [responseFilter, setResponseFilter] = useState<string>("all");
  const [qtypeFilter, setQtypeFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // If an End Date/Time is set, results are no longer "current".
  // Auto-pause live refresh while an end date is active, and restore when cleared.
  const endDateAutoPauseActiveRef = useRef<boolean>(false);
  const endDateAutoResumeSecondsRef = useRef<number | null>(null);

  useEffect(() => {
    const hasEndDate = endDate.trim().length > 0;
    const isLive = refreshSeconds > 0;

    if (hasEndDate) {
      if (isLive) {
        endDateAutoPauseActiveRef.current = true;
        endDateAutoResumeSecondsRef.current = refreshSeconds;
        setIsAutoRefresh(false);
        setRefreshSeconds(0);
      }

      return;
    }

    if (!endDateAutoPauseActiveRef.current) {
      return;
    }

    // Don't resume while the logs context menu is open; it owns pause/resume.
    if (logsTableContextMenuOpenRef.current) {
      return;
    }

    const resumeSeconds = endDateAutoResumeSecondsRef.current;
    endDateAutoPauseActiveRef.current = false;
    endDateAutoResumeSecondsRef.current = null;

    if (refreshSeconds === 0 && typeof resumeSeconds === "number") {
      setRefreshSeconds(resumeSeconds);
    }
  }, [endDate, refreshSeconds, setIsAutoRefresh, setRefreshSeconds]);

  // Date presets and End Date/Time are inherently non-live views.
  // If an end date is set, force paginated mode (tail mode is always "now").
  useEffect(() => {
    const hasEndDate = endDate.trim().length > 0;
    if (!hasEndDate) {
      return;
    }

    if (displayMode !== "tail") {
      return;
    }

    setDisplayMode("paginated");
    setTailBuffer([]);
    setTailNewestTimestamp(null);
    setTailPaused(false);
  }, [displayMode, endDate]);
  const [filterTipDismissed, setFilterTipDismissed] = useState<boolean>(
    loadFilterTipDismissed,
  );
  const [selectionTipDismissed, setSelectionTipDismissed] = useState<boolean>(
    loadSelectionTipDismissed,
  );
  const [mobileLayoutMode, setMobileLayoutMode] =
    useState<MobileLayoutMode>(loadMobileLayoutMode);
  const [selectedDomains, setSelectedDomains] = useState<Set<string>>(
    new Set(),
  );
  const [bulkAction, setBulkAction] = useState<"block" | "allow" | null>(null);

  // Pull-to-refresh functionality for mobile
  const handlePullToRefresh = useCallback(async () => {
    if (logsFetchInFlightRef.current) {
      return;
    }
    setIsAutoRefresh(true);
    setRefreshTick((prev) => prev + 1);
    // Wait a bit for the refresh to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }, []);

  const pullToRefresh = usePullToRefresh({
    onRefresh: handlePullToRefresh,
    threshold: 80,
    disabled: false,
  });

  const handleClientClick = useCallback(
    (entry: TechnitiumCombinedQueryLogEntry, shiftKey: boolean) => {
      const hostname = entry.clientName?.trim() || "";
      const ip = entry.clientIpAddress?.trim() || "";

      // In paginated mode, filtering is done server-side against the SQLite store.
      // Stored logs persist the best-known client hostname, so prefer hostname
      // when it exists (fallback to IP).
      const filterValue =
        displayMode === "paginated" ?
          hostname && hostname !== ip ?
            hostname
          : ip || hostname
        : hostname || ip;

      if (!filterValue) {
        return;
      }

      if (shiftKey) {
        // Shift+click: keep domain filter, set client filter
        setClientFilter(filterValue);
      } else {
        // Normal click: set client filter, clear domain filter
        setClientFilter(filterValue);
        setDomainFilter("");
      }
    },
    [displayMode],
  );

  const handleDomainClick = useCallback(
    (entry: TechnitiumCombinedQueryLogEntry, shiftKey: boolean) => {
      const domain = entry.qname?.trim() || "";

      if (!domain) {
        return;
      }

      if (shiftKey) {
        // Shift+click: keep client filter, set domain filter
        setDomainFilter(domain);
      } else {
        // Normal click: set domain filter, clear client filter
        setDomainFilter(domain);
        setClientFilter("");
      }
    },
    [],
  );

  const dismissFilterTip = useCallback(() => {
    setFilterTipDismissed(true);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(FILTER_TIP_DISMISSED_KEY, "true");
      } catch (error) {
        console.warn("Failed to save filter tip dismissed state", error);
      }
    }
  }, []);

  const dismissSelectionTip = useCallback(() => {
    setSelectionTipDismissed(true);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SELECTION_TIP_DISMISSED_KEY, "true");
      } catch (error) {
        console.warn("Failed to save selection tip dismissed state", error);
      }
    }
  }, []);

  const toggleDomainSelection = useCallback((domain: string) => {
    // Pause auto-refresh when selecting domains and set dropdown to "Pause"
    setIsAutoRefresh(false);
    setRefreshSeconds(0);

    setSelectedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedDomains(new Set());
    setBulkAction(null);
  }, []);

  // Lazy load Advanced Blocking data - only when needed
  const ensureAdvancedBlockingLoaded = useCallback(async () => {
    if (!advancedBlocking) {
      await reloadAdvancedBlocking();
    }
  }, [advancedBlocking, reloadAdvancedBlocking]);

  const initiateBulkAction = useCallback(
    async (action: "block" | "allow") => {
      if (selectedDomains.size === 0) {
        return;
      }
      // Ensure advanced blocking data is loaded before bulk action
      await ensureAdvancedBlockingLoaded();

      // Pause auto-refresh when opening bulk action modal
      if (displayMode === "tail") {
        setRefreshSeconds(0);
      }

      setBulkAction(action);
      setBlockingAction(action);
      setBlockMode("exact");
      setBlockSelectedGroups(new Set());
      setBlockError(undefined);
    },
    [
      selectedDomains.size,
      ensureAdvancedBlockingLoaded,
      displayMode,
      setRefreshSeconds,
    ],
  );

  const handleStatusClick = useCallback(
    async (entry: TechnitiumCombinedQueryLogEntry, forceToggle = false) => {
      // Ensure advanced blocking data is loaded before opening dialog
      await ensureAdvancedBlockingLoaded();

      const domain = entry.qname ?? "";
      const snapshot = advancedBlocking?.nodes?.find(
        (nodeConfig) => nodeConfig.nodeId === entry.nodeId,
      );
      const groups = snapshot?.config?.groups ?? [];
      const defaultRegex = domain ? buildDefaultRegexPattern(domain) : "";
      const blockSummary = collectActionOverrides(groups, domain, "block");
      const allowSummary = collectActionOverrides(groups, domain, "allow");
      const blockRegexPatterns = blockSummary.regexMatches;
      const allowRegexPatterns = allowSummary.regexMatches;
      const hasBlockedExact = blockSummary.hasExact;
      const hasAllowedExact = allowSummary.hasExact;

      const blockedDominant = blockRegexPatterns.length > 0 || hasBlockedExact;
      const allowDominant = allowRegexPatterns.length > 0 || hasAllowedExact;

      // Default action should be the OPPOSITE of current state
      // If currently blocked → offer to allow; if currently allowed → offer to block
      let initialAction: "block" | "allow" =
        blockedDominant ?
          "allow" // Currently blocked, so offer to allow
        : allowDominant ?
          "block" // Currently allowed, so offer to block
        : entry.responseType && isEntryBlocked(entry) ?
          "allow" // Blocked by list, so offer to allow
        : "block"; // Not blocked, so offer to block

      // If called from swipe (forceToggle=true), invert the action again
      if (forceToggle) {
        initialAction = initialAction === "block" ? "allow" : "block";
      }

      const sourceMatches =
        initialAction === "block" ? blockRegexPatterns : allowRegexPatterns;
      const initialMode: "exact" | "regex" =
        initialAction === "block" ?
          hasBlockedExact ? "exact"
          : sourceMatches.length > 0 ? "regex"
          : "exact"
        : hasAllowedExact ? "exact"
        : sourceMatches.length > 0 ? "regex"
        : "exact";
      const initialRegex =
        sourceMatches.length > 0 ? sourceMatches[0] : defaultRegex;

      const initialSelection =
        initialAction === "block" ?
          blockSummary.selected
        : allowSummary.selected;
      setBlockSelectedGroups(new Set(initialSelection));
      setBlockingAction(initialAction);
      setBlockMode(initialMode);
      setBlockRegexValue(initialRegex);
      setBlockError(undefined);
      setIsBlocking(false);
      setBlockDialog({ entry });

      // Pause auto-refresh when opening the modal (similar to mobile swipe behavior)
      if (displayMode === "tail") {
        setTailPaused(true);
        setRefreshSeconds(0);
      }
    },
    [
      advancedBlocking,
      setBlockDialog,
      setBlockError,
      setBlockSelectedGroups,
      setIsBlocking,
      ensureAdvancedBlockingLoaded,
      displayMode,
      setTailPaused,
      setRefreshSeconds,
    ],
  );

  // Create domain-to-group mapping for visual grouping
  const domainToGroupMap = useMemo(() => {
    const selectedDomainsList = Array.from(selectedDomains);
    const map = new Map<string, number>();
    selectedDomainsList.forEach((domain, index) => {
      map.set(domain, index + 1); // Start from 1, increment sequentially
    });
    return map;
  }, [selectedDomains]);

  // Create detailed group information for each domain (for tooltips)
  // This is separate from domainToGroupMap - it shows Advanced Blocking rules for ANY domain (not just selected)
  const domainGroupDetailsMap = useMemo(() => {
    const map = new Map<string, DomainGroupDetails>();

    if (
      !advancedBlocking ||
      !advancedBlocking.nodes ||
      advancedBlocking.nodes.length === 0
    ) {
      return map;
    }

    // Get groups from the first available node snapshot
    const firstSnapshot = advancedBlocking.nodes.find(
      (snapshot) => snapshot.config?.groups,
    );
    const groups = firstSnapshot?.config?.groups ?? [];

    if (groups.length === 0) {
      return map;
    }

    // Build a helper function to check a domain against all groups
    const checkDomainInGroups = (domain: string) => {
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const overrides = extractGroupOverrides(group, domain);

        // If this group has any rules for this domain, record it
        if (
          overrides.blockedExact ||
          overrides.blockedRegexMatches.length > 0 ||
          overrides.allowedExact ||
          overrides.allowedRegexMatches.length > 0
        ) {
          map.set(domain, {
            groupNumber: i + 1, // Use actual group index, not selection index
            groupName: group.name,
            blockedExact: overrides.blockedExact,
            blockedRegexMatches: overrides.blockedRegexMatches,
            allowedExact: overrides.allowedExact,
            allowedRegexMatches: overrides.allowedRegexMatches,
          });
          return; // Use first matching group
        }
      }
    };

    // Get all visible domains from current logs
    const visibleDomains = new Set<string>();
    if (displayMode === "tail") {
      tailBuffer.forEach((entry) => {
        if (entry.qname) visibleDomains.add(entry.qname);
      });
    } else {
      (mode === "combined" ?
        combinedPage?.entries
      : nodeSnapshot?.data.entries
      )?.forEach((entry) => {
        if (entry.qname) visibleDomains.add(entry.qname);
      });
    }

    // Check each visible domain
    visibleDomains.forEach((domain) => checkDomainInGroups(domain));

    return map;
  }, [
    advancedBlocking,
    displayMode,
    tailBuffer,
    combinedPage,
    nodeSnapshot,
    mode,
  ]);

  const baseColumns = useMemo(
    () =>
      buildTableColumns(
        handleStatusClick,
        handleClientClick,
        handleDomainClick,
        scheduleDomainBlockSourceLookup,
        selectedDomains,
        toggleDomainSelection,
        domainToGroupMap,
        domainGroupDetailsMap,
      ),
    [
      handleStatusClick,
      handleClientClick,
      handleDomainClick,
      scheduleDomainBlockSourceLookup,
      selectedDomains,
      toggleDomainSelection,
      domainToGroupMap,
      domainGroupDetailsMap,
    ],
  );

  const nodeMap = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );

  const activeColumns = useMemo(() => {
    // Columns to hide on mobile in compact-table mode
    const mobileHiddenColumns = [
      "node",
      "protocol",
      "qclass",
      "answer",
      "responseTime",
      "rcode",
    ];
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

    const columns = baseColumns.filter((column) => {
      // Hide QTYPE column when deduplicating domains
      if (deduplicateDomains && column.id === "qtype") {
        return false;
      }

      // On mobile in compact-table mode, hide certain columns
      if (
        isMobile &&
        mobileLayoutMode === "compact-table" &&
        mobileHiddenColumns.includes(column.id)
      ) {
        return false;
      }

      const key = column.optionalKey;
      if (!key) {
        return true;
      }

      return columnVisibility[key];
    });

    return columns.length > 0 ? columns : baseColumns;
  }, [baseColumns, columnVisibility, deduplicateDomains, mobileLayoutMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      COLUMN_VISIBILITY_STORAGE_KEY,
      JSON.stringify(columnVisibility),
    );
  }, [columnVisibility]);

  // Calculate popup horizontal alignment when settings menu opens
  useEffect(() => {
    if (!settingsOpen || !settingsButtonRef.current) {
      return;
    }

    const buttonRect = settingsButtonRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const popupWidth = 500; // max-width from CSS

    // Check if there's enough space to the right when aligned left
    const spaceRight = viewportWidth - buttonRect.left;

    // If there's enough space on the right, align left (default)
    // Otherwise, align right to prevent overflow
    if (spaceRight >= popupWidth) {
      setSettingsPopupHorizontalAlign("left");
    } else {
      setSettingsPopupHorizontalAlign("right");
    }
  }, [settingsOpen]);

  const toggleColumnVisibility = (key: OptionalColumnKey) => {
    setColumnVisibility((prev) => {
      const next: ColumnVisibility = { ...prev, [key]: !prev[key] };
      return next;
    });
  };

  const handleTailBufferSizeChange = useCallback((newSize: number) => {
    setTailBufferSize(newSize);
    try {
      window.localStorage.setItem(
        TAIL_BUFFER_SIZE_STORAGE_KEY,
        String(newSize),
      );
    } catch (error) {
      console.warn("Failed to save tail buffer size to localStorage", error);
    }
  }, []);

  const handlePaginatedRowsPerPageChange = useCallback((next: number) => {
    if (!PAGINATED_ROWS_PER_PAGE_OPTIONS.includes(next)) {
      return;
    }

    setPageNumber(1);
    setPaginatedRowsPerPage(next);

    try {
      window.localStorage.setItem(
        PAGINATED_ROWS_PER_PAGE_STORAGE_KEY,
        String(next),
      );
    } catch (error) {
      console.warn(
        "Failed to save paginated rows-per-page setting to localStorage",
        error,
      );
    }
  }, []);

  const toggleDeduplicateDomains = useCallback(() => {
    setDeduplicateDomains((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          DEDUPLICATE_DOMAINS_STORAGE_KEY,
          String(next),
        );
      } catch (error) {
        console.warn(
          "Failed to save deduplicate domains setting to localStorage",
          error,
        );
      }
      // Reset QTYPE filter when enabling deduplication (since filter becomes hidden)
      if (next) {
        setQtypeFilter("all");
      }
      return next;
    });
  }, []);

  // Date/time filter helpers
  const formatDateForInput = useCallback((date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }, []);

  const parseDateInputMs = useCallback((value: string): number | null => {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }, []);

  const clampDateRange = useCallback(
    (nextStart: string, nextEnd: string) => {
      const nowMs = Date.now();
      const retentionStartMs = nowMs - queryLogRetentionHours * 60 * 60 * 1000;

      const startMsRaw = parseDateInputMs(nextStart);
      const endMsRaw = parseDateInputMs(nextEnd);

      // Clamp end first (end cannot be in the future).
      let endMs = endMsRaw;
      if (endMs !== null) {
        endMs = Math.min(nowMs, Math.max(retentionStartMs, endMs));
      }

      // Clamp start within retention window, and never after end.
      let startMs = startMsRaw;
      if (startMs !== null) {
        const maxStartMs = endMs ?? nowMs;
        startMs = Math.min(maxStartMs, Math.max(retentionStartMs, startMs));
      }

      // If both are set and clamping caused inversion, align start to end.
      if (startMs !== null && endMs !== null && startMs > endMs) {
        startMs = endMs;
      }

      setStartDate(
        startMs !== null ? formatDateForInput(new Date(startMs)) : "",
      );
      setEndDate(endMs !== null ? formatDateForInput(new Date(endMs)) : "");
    },
    [formatDateForInput, parseDateInputMs, queryLogRetentionHours],
  );

  const formatDateForApi = useCallback((dateString: string): string => {
    if (!dateString) return "";
    // Convert from datetime-local format (YYYY-MM-DDTHH:mm) to ISO 8601
    return new Date(dateString).toISOString();
  }, []);

  const applyDatePreset = useCallback(
    (preset: "last-hour" | "last-24h" | "today" | "yesterday" | "clear") => {
      const now = new Date();

      switch (preset) {
        case "last-hour": {
          const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
          clampDateRange(
            formatDateForInput(oneHourAgo),
            formatDateForInput(now),
          );
          break;
        }

        case "last-24h": {
          const twentyFourHoursAgo = new Date(
            now.getTime() - 24 * 60 * 60 * 1000,
          );
          clampDateRange(
            formatDateForInput(twentyFourHoursAgo),
            formatDateForInput(now),
          );
          break;
        }

        case "today": {
          const startOfToday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
            0,
            0,
            0,
          );
          clampDateRange(
            formatDateForInput(startOfToday),
            formatDateForInput(now),
          );
          break;
        }

        case "yesterday": {
          const startOfYesterday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - 1,
            0,
            0,
            0,
          );
          const endOfYesterday = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - 1,
            23,
            59,
            59,
          );
          clampDateRange(
            formatDateForInput(startOfYesterday),
            formatDateForInput(endOfYesterday),
          );
          break;
        }

        case "clear":
          clampDateRange("", "");
          break;
      }
    },
    [clampDateRange, formatDateForInput],
  );

  const blockDialogSnapshot = useMemo(() => {
    if (!blockDialog) {
      return undefined;
    }

    return advancedBlocking?.nodes?.find(
      (snapshot) => snapshot.nodeId === blockDialog.entry.nodeId,
    );
  }, [advancedBlocking, blockDialog]);

  const blockAvailableGroups = useMemo(
    () => blockDialogSnapshot?.config?.groups ?? [],
    [blockDialogSnapshot],
  );

  const blockDomainValue = blockDialog?.entry.qname ?? "";
  const defaultRegexSuggestion = useMemo(
    () => (blockDomainValue ? buildDefaultRegexPattern(blockDomainValue) : ""),
    [blockDomainValue],
  );
  const blockNodeLabel =
    blockDialog ?
      (nodeMap.get(blockDialog.entry.nodeId)?.name ?? blockDialog.entry.nodeId)
    : "";
  const isBlockedEntry =
    blockDialog ? isEntryBlocked(blockDialog.entry) : false;
  const blockCoverage = useMemo<CoverageEntry[]>(() => {
    if (!blockDialog || !blockDialog.entry.qname) {
      return [];
    }

    const domain = blockDialog.entry.qname;
    return blockAvailableGroups.flatMap<CoverageEntry>((group) => {
      const overrides = extractGroupOverrides(group, domain);
      const details: CoverageEntry[] = [];

      if (overrides.blockedExact) {
        details.push({ name: group.name, description: "Exact domain match" });
      }

      overrides.blockedRegexMatches.forEach((pattern) => {
        details.push({
          name: group.name,
          description: `Regex pattern ${pattern}`,
        });
      });

      return details;
    });
  }, [blockAvailableGroups, blockDialog]);

  const allowCoverage = useMemo<CoverageEntry[]>(() => {
    if (!blockDialog || !blockDialog.entry.qname) {
      return [];
    }

    const domain = blockDialog.entry.qname;
    return blockAvailableGroups.flatMap<CoverageEntry>((group) => {
      const overrides = extractGroupOverrides(group, domain);
      const details: CoverageEntry[] = [];

      if (overrides.allowedExact) {
        details.push({
          name: group.name,
          description: "Allowed via exact override",
        });
      }

      overrides.allowedRegexMatches.forEach((pattern) => {
        details.push({
          name: group.name,
          description: `Allowed via regex ${pattern}`,
        });
      });

      return details;
    });
  }, [blockAvailableGroups, blockDialog]);

  // For bulk actions, collect groups from all nodes
  const availableGroupsForSelection = useMemo(() => {
    if (bulkAction) {
      // Get union of all groups from all nodes
      const groupMap = new Map<string, AdvancedBlockingGroup>();
      const nodes = advancedBlocking?.nodes ?? [];

      nodes.forEach((snapshot) => {
        const groups = snapshot.config?.groups ?? [];
        groups.forEach((group) => {
          if (!groupMap.has(group.name)) {
            groupMap.set(group.name, group);
          }
        });
      });

      return Array.from(groupMap.values());
    }
    return blockAvailableGroups;
  }, [bulkAction, advancedBlocking, blockAvailableGroups]);

  const modalTitle =
    blockingAction === "allow" ? "Allow domain"
    : isBlockedEntry ? "Update block"
    : "Block domain";
  const confirmButtonLabel =
    isBlocking ? "Saving…"
    : blockingAction === "block" ?
      blockCoverage.length > 0 ?
        "Save changes"
      : "Block domain"
    : allowCoverage.length > 0 ? "Save changes"
    : "Allow domain";

  const handleToggleBlockGroup = useCallback(
    (groupName: string) => {
      setBlockSelectedGroups((prev) => {
        const next = new Set(prev);
        if (next.has(groupName)) {
          next.delete(groupName);
        } else {
          next.add(groupName);
        }
        return next;
      });
      setBlockError(undefined);
    },
    [setBlockError],
  );

  const handleSelectAllGroups = useCallback(() => {
    setBlockSelectedGroups(
      new Set<string>(availableGroupsForSelection.map((group) => group.name)),
    );
    setBlockError(undefined);
  }, [availableGroupsForSelection, setBlockError]);

  const handleSelectNoGroups = useCallback(() => {
    setBlockSelectedGroups(new Set<string>());
    setBlockError(undefined);
  }, [setBlockError]);

  const handleActionChange = useCallback(
    (nextAction: "block" | "allow") => {
      if (!blockDialog || nextAction === blockingAction) {
        return;
      }

      const domain = blockDialog.entry.qname ?? "";
      const summary = collectActionOverrides(
        blockAvailableGroups,
        domain,
        nextAction,
      );
      const nextMode: "exact" | "regex" =
        summary.hasExact ? "exact"
        : summary.regexMatches.length > 0 ? "regex"
        : "exact";

      setBlockingAction(nextAction);
      setBlockSelectedGroups(new Set(summary.selected));
      setBlockMode(nextMode);
      setBlockError(undefined);

      if (nextMode === "regex") {
        const nextPattern =
          summary.regexMatches[0] ?? defaultRegexSuggestion ?? "";
        setBlockRegexValue(nextPattern);
      }
    },
    [
      blockDialog,
      blockingAction,
      blockAvailableGroups,
      defaultRegexSuggestion,
      setBlockSelectedGroups,
      setBlockingAction,
      setBlockMode,
      setBlockError,
      setBlockRegexValue,
    ],
  );

  const closeBlockDialog = useCallback(() => {
    setBlockDialog(undefined);
    setBlockSelectedGroups(new Set<string>());
    setBlockError(undefined);
    setIsBlocking(false);
    setBlockMode("exact");
    setBlockRegexValue("");
    setBulkAction(null);

    // Resume auto-refresh when closing the modal (similar to mobile swipe behavior)
    if (displayMode === "tail" && tailPaused) {
      setTailPaused(false);
    }
  }, [displayMode, tailPaused, setTailPaused]);

  const handleConfirmBlock = useCallback(async () => {
    if (!blockDialog) {
      return;
    }

    const domain = blockDialog.entry.qname?.trim();
    const isCurrentlyBlocked = isEntryBlocked(blockDialog.entry);
    const isCurrentlyAllowed = allowCoverage.length > 0;
    if (!domain) {
      setBlockError("This log entry does not include a domain name.");
      return;
    }

    if (blockingAction === "block") {
      if (!isCurrentlyBlocked && blockSelectedGroups.size === 0) {
        setBlockError("Select at least one group to apply the block.");
        return;
      }
    } else if (!isCurrentlyAllowed && blockSelectedGroups.size === 0) {
      setBlockError("Select at least one group to apply the allow override.");
      return;
    }

    const snapshot = blockDialogSnapshot;
    if (!snapshot?.config) {
      setBlockError(
        "Advanced Blocking configuration is not available for this node.",
      );
      return;
    }

    const regexPattern = blockMode === "regex" ? blockRegexValue.trim() : "";
    if (blockMode === "regex") {
      if (regexPattern.length === 0) {
        setBlockError(
          blockingAction === "block" ?
            "Provide a regex pattern to block."
          : "Provide a regex pattern to allow.",
        );
        return;
      }

      try {
        // Validate regex before persisting to config.
        new RegExp(regexPattern);
      } catch {
        setBlockError("The regex pattern is not valid.");
        return;
      }
    }

    const updatedGroups = snapshot.config.groups.map((group) => {
      const shouldHave = blockSelectedGroups.has(group.name);
      const overrides = extractGroupOverrides(group, domain);

      let nextBlocked = group.blocked;
      let nextBlockedRegex = group.blockedRegex;
      let nextAllowed = group.allowed;
      let nextAllowedRegex = group.allowedRegex;

      let blockedChanged = false;
      let blockedRegexChanged = false;
      let allowedChanged = false;
      let allowedRegexChanged = false;

      const ensureBlockedExact = () => {
        if (!nextBlocked.includes(domain)) {
          nextBlocked = [...nextBlocked, domain];
          blockedChanged = true;
        }
      };

      const removeBlockedExact = () => {
        if (nextBlocked.includes(domain)) {
          nextBlocked = nextBlocked.filter((value) => value !== domain);
          blockedChanged = true;
        }
      };

      const ensureBlockedRegex = (pattern: string) => {
        if (!nextBlockedRegex.includes(pattern)) {
          nextBlockedRegex = [...nextBlockedRegex, pattern];
          blockedRegexChanged = true;
        }
      };

      const removeBlockedRegex = (pattern: string) => {
        if (nextBlockedRegex.includes(pattern)) {
          nextBlockedRegex = nextBlockedRegex.filter(
            (value) => value !== pattern,
          );
          blockedRegexChanged = true;
        }
      };

      const ensureAllowedExact = () => {
        if (!nextAllowed.includes(domain)) {
          nextAllowed = [...nextAllowed, domain];
          allowedChanged = true;
        }
      };

      const removeAllowedExact = () => {
        if (nextAllowed.includes(domain)) {
          nextAllowed = nextAllowed.filter((value) => value !== domain);
          allowedChanged = true;
        }
      };

      const ensureAllowedRegex = (pattern: string) => {
        if (!nextAllowedRegex.includes(pattern)) {
          nextAllowedRegex = [...nextAllowedRegex, pattern];
          allowedRegexChanged = true;
        }
      };

      const removeAllowedRegex = (pattern: string) => {
        if (nextAllowedRegex.includes(pattern)) {
          nextAllowedRegex = nextAllowedRegex.filter(
            (value) => value !== pattern,
          );
          allowedRegexChanged = true;
        }
      };

      if (blockingAction === "block") {
        if (shouldHave) {
          if (blockMode === "regex") {
            overrides.blockedRegexMatches.forEach((pattern) => {
              if (pattern !== regexPattern) {
                removeBlockedRegex(pattern);
              }
            });
            if (regexPattern.length > 0) {
              ensureBlockedRegex(regexPattern);
            }
            if (overrides.blockedExact) {
              removeBlockedExact();
            }
          } else {
            ensureBlockedExact();
            overrides.blockedRegexMatches.forEach((pattern) =>
              removeBlockedRegex(pattern),
            );
          }

          if (overrides.allowedExact) {
            removeAllowedExact();
          }
          overrides.allowedRegexMatches.forEach((pattern) =>
            removeAllowedRegex(pattern),
          );
        } else {
          removeBlockedExact();
          overrides.blockedRegexMatches.forEach((pattern) =>
            removeBlockedRegex(pattern),
          );
          if (blockMode === "regex" && regexPattern.length > 0) {
            removeBlockedRegex(regexPattern);
          }
        }
      } else {
        if (shouldHave) {
          if (blockMode === "regex") {
            overrides.allowedRegexMatches.forEach((pattern) => {
              if (pattern !== regexPattern) {
                removeAllowedRegex(pattern);
              }
            });
            if (regexPattern.length > 0) {
              ensureAllowedRegex(regexPattern);
            }
            if (overrides.allowedExact) {
              removeAllowedExact();
            }
          } else {
            ensureAllowedExact();
            overrides.allowedRegexMatches.forEach((pattern) =>
              removeAllowedRegex(pattern),
            );
          }

          if (overrides.blockedExact) {
            removeBlockedExact();
          }
          overrides.blockedRegexMatches.forEach((pattern) =>
            removeBlockedRegex(pattern),
          );
        } else {
          removeAllowedExact();
          overrides.allowedRegexMatches.forEach((pattern) =>
            removeAllowedRegex(pattern),
          );
          if (blockMode === "regex" && regexPattern.length > 0) {
            removeAllowedRegex(regexPattern);
          }
        }
      }

      if (
        blockedChanged ||
        blockedRegexChanged ||
        allowedChanged ||
        allowedRegexChanged
      ) {
        return {
          ...group,
          blocked: blockedChanged ? nextBlocked : group.blocked,
          blockedRegex:
            blockedRegexChanged ? nextBlockedRegex : group.blockedRegex,
          allowed: allowedChanged ? nextAllowed : group.allowed,
          allowedRegex:
            allowedRegexChanged ? nextAllowedRegex : group.allowedRegex,
        };
      }

      return group;
    });

    const updatedConfig: AdvancedBlockingConfig = {
      ...snapshot.config,
      groups: updatedGroups,
    };

    try {
      setIsBlocking(true);
      await saveAdvancedBlockingConfig(blockDialog.entry.nodeId, updatedConfig);
      setRefreshTick((prev) => prev + 1);
      closeBlockDialog();
    } catch (error) {
      setBlockError(
        error instanceof Error ? error.message : "Failed to apply block.",
      );
      setIsBlocking(false);
    }
  }, [
    blockDialog,
    blockDialogSnapshot,
    blockMode,
    blockRegexValue,
    blockSelectedGroups,
    blockingAction,
    closeBlockDialog,
    saveAdvancedBlockingConfig,
    setRefreshTick,
    setBlockError,
    setIsBlocking,
    allowCoverage,
  ]);

  const handleConfirmBulkAction = useCallback(async () => {
    if (!bulkAction || selectedDomains.size === 0) {
      return;
    }

    if (blockSelectedGroups.size === 0) {
      setBlockError(
        `Select at least one group to ${bulkAction} the selected domains.`,
      );
      return;
    }

    try {
      setIsBlocking(true);
      setBlockError(undefined);

      // Apply to all nodes with Advanced Blocking enabled
      const nodesToUpdate =
        advancedBlocking?.nodes?.filter((snapshot) => snapshot.config) ?? [];

      if (nodesToUpdate.length === 0) {
        setBlockError("No nodes with Advanced Blocking configuration found.");
        setIsBlocking(false);
        return;
      }

      // Update each node's config
      for (const snapshot of nodesToUpdate) {
        const updatedGroups = snapshot.config!.groups.map((group) => {
          const shouldHave = blockSelectedGroups.has(group.name);
          if (!shouldHave) {
            return group;
          }

          let nextBlocked = group.blocked;
          let nextAllowed = group.allowed;
          let changed = false;

          // Add all selected domains to this group
          for (const domain of selectedDomains) {
            if (bulkAction === "block") {
              // Add to blocked, remove from allowed
              if (!nextBlocked.includes(domain)) {
                nextBlocked = [...nextBlocked, domain];
                changed = true;
              }
              if (nextAllowed.includes(domain)) {
                nextAllowed = nextAllowed.filter((d) => d !== domain);
                changed = true;
              }
            } else {
              // Add to allowed, remove from blocked
              if (!nextAllowed.includes(domain)) {
                nextAllowed = [...nextAllowed, domain];
                changed = true;
              }
              if (nextBlocked.includes(domain)) {
                nextBlocked = nextBlocked.filter((d) => d !== domain);
                changed = true;
              }
            }
          }

          if (changed) {
            return { ...group, blocked: nextBlocked, allowed: nextAllowed };
          }

          return group;
        });

        const updatedConfig: AdvancedBlockingConfig = {
          ...snapshot.config!,
          groups: updatedGroups,
        };

        await saveAdvancedBlockingConfig(snapshot.nodeId, updatedConfig);
      }

      setRefreshTick((prev) => prev + 1);
      clearSelection();
      closeBlockDialog();
    } catch (error) {
      setBlockError(
        error instanceof Error ?
          error.message
        : `Failed to ${bulkAction} domains.`,
      );
      setIsBlocking(false);
    }
  }, [
    bulkAction,
    selectedDomains,
    blockSelectedGroups,
    advancedBlocking,
    saveAdvancedBlockingConfig,
    setRefreshTick,
    clearSelection,
    closeBlockDialog,
  ]);

  useEffect(() => {
    if (
      mode === "node" &&
      selectedNodeId &&
      !nodeMap.has(selectedNodeId) &&
      nodes.length > 0
    ) {
      setSelectedNodeId(nodes[0]?.id ?? "");
    }
  }, [mode, nodeMap, nodes, selectedNodeId]);

  useEffect(() => {
    if (refreshSeconds <= 0) {
      setIsAutoRefresh(false);
      return;
    }

    const triggerRefresh = () => {
      if (!document.hidden) {
        // Skip auto-refresh ticks while a load is already in-flight.
        // This avoids request pile-ups and keeps the UI responsive.
        if (logsFetchInFlightRef.current) {
          return;
        }
        setIsAutoRefresh(true);
        setRefreshTick((prev) => prev + 1);
      }
    };

    const timer = window.setInterval(() => {
      triggerRefresh();
    }, refreshSeconds * 1000);

    const handleVisibilityChange = () => {
      if (!document.hidden && refreshSeconds > 0) {
        if (isLogsResumeDebugEnabled()) {
          console.info("[LogsPage] visibility resume", {
            at: new Date().toISOString(),
            refreshSeconds,
            inFlight: logsFetchInFlightRef.current,
          });
        }
        // Some browsers throttle/suspend network requests in background tabs.
        // If a log fetch was in-flight when the tab was backgrounded, the promise
        // may never resolve/reject, leaving logsFetchInFlightRef stuck and
        // preventing subsequent refresh ticks (which also stalls hostname
        // enrichment coming from the combined logs endpoint).
        if (logsFetchInFlightRef.current) {
          if (isLogsResumeDebugEnabled()) {
            console.warn(
              "[LogsPage] Aborting in-flight log fetch on visibility resume (likely background-throttled).",
              {
                at: new Date().toISOString(),
                visibilityState: document.visibilityState,
                refreshSeconds,
              },
            );

            const now = Date.now();
            if (now - logsResumeDebugToastAtRef.current > 30000) {
              logsResumeDebugToastAtRef.current = now;
              pushToast({
                tone: "info",
                timeout: 7000,
                message:
                  "Logs debug: aborted a stuck in-flight fetch on resume (check console).",
              });
            }
          }
          logsFetchAbortRef.current?.abort();
          logsFetchAbortRef.current = null;
          logsFetchInFlightRef.current = false;
        }
        triggerRefresh();
      }
    };

    const handleWindowFocus = () => {
      if (!document.hidden && refreshSeconds > 0) {
        if (isLogsResumeDebugEnabled()) {
          console.info("[LogsPage] window focus", {
            at: new Date().toISOString(),
            refreshSeconds,
            inFlight: logsFetchInFlightRef.current,
          });
        }
        if (logsFetchInFlightRef.current) {
          if (isLogsResumeDebugEnabled()) {
            console.warn(
              "[LogsPage] Aborting in-flight log fetch on window focus (likely background-throttled).",
              {
                at: new Date().toISOString(),
                visibilityState: document.visibilityState,
                refreshSeconds,
              },
            );

            const now = Date.now();
            if (now - logsResumeDebugToastAtRef.current > 30000) {
              logsResumeDebugToastAtRef.current = now;
              pushToast({
                tone: "info",
                timeout: 7000,
                message:
                  "Logs debug: aborted a stuck in-flight fetch on focus (check console).",
              });
            }
          }
          logsFetchAbortRef.current?.abort();
          logsFetchAbortRef.current = null;
          logsFetchInFlightRef.current = false;
        }
        triggerRefresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [pushToast, refreshSeconds]);

  useEffect(() => {
    setIsAutoRefresh(false);
    setPageNumber(1);
  }, [mode, selectedNodeId]);

  // Reset to page 1 when any filter changes
  useEffect(() => {
    setPageNumber(1);
  }, [
    domainFilter,
    clientFilter,
    statusFilter,
    responseFilter,
    qtypeFilter,
    startDate,
    endDate,
  ]);

  // Helper to merge new entries into tail buffer
  const mergeTailEntries = useCallback(
    (
      newEntries: TechnitiumCombinedQueryLogEntry[],
      currentBuffer: TechnitiumCombinedQueryLogEntry[],
      newestTimestamp: string | null,
    ): {
      buffer: TechnitiumCombinedQueryLogEntry[];
      newest: string | null;
      newCount: number;
      newTimestamps: Set<string>;
    } => {
      if (newEntries.length === 0) {
        return {
          buffer: currentBuffer,
          newest: newestTimestamp,
          newCount: 0,
          newTimestamps: new Set(),
        };
      }

      const existingKeys = new Set(currentBuffer.map(buildEntryDedupKey));

      const trulyNewEntries = newEntries.filter((entry) => {
        const key = buildEntryDedupKey(entry);
        if (existingKeys.has(key)) {
          return false;
        }

        existingKeys.add(key);
        return true;
      });

      if (trulyNewEntries.length === 0) {
        return {
          buffer: currentBuffer,
          newest: newestTimestamp,
          newCount: 0,
          newTimestamps: new Set(),
        };
      }

      const newTimestamps = new Set(
        trulyNewEntries.map((entry) => entry.timestamp),
      );

      const merged = [...trulyNewEntries, ...currentBuffer];

      merged.sort((a, b) => {
        const aTime = safeParseTimestamp(a.timestamp);
        const bTime = safeParseTimestamp(b.timestamp);

        if (aTime === null && bTime === null) {
          return 0;
        }

        if (aTime === null) {
          return 1;
        }

        if (bTime === null) {
          return -1;
        }

        return bTime - aTime;
      });

      const limited = merged.slice(0, tailBufferSize);

      let computedNewest = newestTimestamp;
      for (const entry of limited) {
        const parsed = safeParseTimestamp(entry.timestamp);
        if (parsed !== null) {
          computedNewest = new Date(parsed).toISOString();
          break;
        }
      }

      return {
        buffer: limited,
        newest: computedNewest,
        newCount: trulyNewEntries.length,
        newTimestamps,
      };
    },
    [tailBufferSize],
  );

  // Handle display mode changes
  const handleDisplayModeChange = useCallback(
    (nextMode: DisplayMode) => {
      setDisplayMode(nextMode);

      if (nextMode === "tail") {
        // Entering tail mode
        setPageNumber(1);
        setTailBuffer([]);
        setTailNewestTimestamp(null);
        setTailPaused(false);

        // Auto-enable refresh if not already on
        if (refreshSeconds === 0) {
          setRefreshSeconds(TAIL_MODE_DEFAULT_REFRESH);
        }
      } else {
        // Exiting tail mode
        setTailBuffer([]);
        setTailNewestTimestamp(null);
        setTailPaused(false);
      }
    },
    [refreshSeconds],
  );

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    let abortedByTimeout = false;
    const timeoutId = window.setTimeout(() => {
      abortedByTimeout = true;
      abortController.abort();
    }, LOGS_FETCH_TIMEOUT_MS);

    // Cancel any previous in-flight request before starting a new one.
    logsFetchAbortRef.current?.abort();
    logsFetchAbortRef.current = abortController;
    logsFetchInFlightRef.current = true;

    const load = async () => {
      const nextLoadingState =
        displayMode === "tail" ? "refreshing"
        : isAutoRefresh || hasLoadedAnyLogsRef.current ? "refreshing"
        : "loading";
      setLoadingState(nextLoadingState);
      setErrorMessage(undefined);

      try {
        // In tail mode, always fetch page 1 with descending order
        const effectivePageNumber = displayMode === "tail" ? 1 : pageNumber;

        if (mode === "combined") {
          const combinedLogsLoader =
            displayMode === "tail" ? loadCombinedLogs
            : storedLogsReady ? loadStoredCombinedLogs
            : loadCombinedLogs;

          const filterParams = {
            pageNumber: effectivePageNumber,
            entriesPerPage:
              displayMode === "tail" ? tailBufferSize : paginatedRowsPerPage,
            descendingOrder: true,
            deduplicateDomains,
            // Only bypass backend caching in tail mode (real-time view).
            // For paginated browsing, allowing backend caching avoids expensive recomputation on every refresh.
            disableCache: displayMode === "tail" ? true : undefined,
            // In tail mode, fetch all entries without filters (client-side filtering applied later)
            // In paginated mode, apply server-side filters
            ...(displayMode !== "tail" &&
              startDate && { start: formatDateForApi(startDate) }),
            ...(displayMode !== "tail" &&
              endDate && { end: formatDateForApi(endDate) }),
            ...(displayMode !== "tail" &&
              domainFilter.trim() && { qname: domainFilter.trim() }),
            ...(displayMode !== "tail" &&
              clientFilter.trim() && { clientIpAddress: clientFilter.trim() }),
            ...(displayMode !== "tail" &&
              statusFilter !== "all" && { statusFilter }),
            ...(displayMode !== "tail" &&
              responseFilter !== "all" && { responseType: responseFilter }),
            ...(displayMode !== "tail" &&
              qtypeFilter !== "all" && { qtype: qtypeFilter }),
          };

          const data = await combinedLogsLoader(filterParams, {
            signal: abortController.signal,
          });

          if (cancelled) {
            return;
          }

          // If the user opened the custom context menu mid-refresh, don't apply
          // incoming results (it can cause the table to jump under the cursor).
          if (logsTableContextMenuOpenRef.current) {
            setLoadingState("idle");
            return;
          }

          if (data.nodes?.length) {
            setCombinedNodeSnapshots(data.nodes);
          }

          if (displayMode === "tail") {
            // Tail mode: merge new entries
            if (!tailPaused) {
              // Update buffer with new entries
              const { buffer, newest, newTimestamps } = mergeTailEntries(
                data.entries,
                tailBuffer,
                tailNewestTimestamp,
              );
              setTailBuffer(buffer);
              setTailNewestTimestamp(newest);

              // Accumulate new timestamps (don't replace existing ones)
              if (newTimestamps.size > 0) {
                setNewEntryTimestamps((prev) => {
                  const updated = new Set(prev);
                  newTimestamps.forEach((ts) => updated.add(ts));
                  return updated;
                });

                // Clear these specific timestamps after 10 seconds
                newTimestamps.forEach((ts) => {
                  setTimeout(() => {
                    setNewEntryTimestamps((prev) => {
                      const updated = new Set(prev);
                      updated.delete(ts);
                      return updated;
                    });
                  }, 10000);
                });
              }
            }
            // Don't update combinedPage/nodeSnapshot in tail mode
          } else {
            // Paginated mode: normal behavior
            setCombinedPage(data);
            setNodeSnapshot(undefined);
          }
        } else if (selectedNodeId) {
          const nodeLogsLoader =
            displayMode === "tail" ? loadNodeLogs
            : storedLogsReady ? loadStoredNodeLogs
            : loadNodeLogs;

          const data = await nodeLogsLoader(
            selectedNodeId,
            {
              pageNumber: effectivePageNumber,
              entriesPerPage:
                displayMode === "tail" ? tailBufferSize : paginatedRowsPerPage,
              descendingOrder: true,
              deduplicateDomains,
              // Only bypass backend caching in tail mode (real-time view).
              disableCache: displayMode === "tail" ? true : undefined,
              // In tail mode, fetch all entries without filters (client-side filtering applied later)
              // In paginated mode, apply server-side filters
              ...(displayMode !== "tail" &&
                startDate && { start: formatDateForApi(startDate) }),
              ...(displayMode !== "tail" &&
                endDate && { end: formatDateForApi(endDate) }),
              ...(displayMode !== "tail" &&
                domainFilter.trim() && { qname: domainFilter.trim() }),
              ...(displayMode !== "tail" &&
                clientFilter.trim() && {
                  clientIpAddress: clientFilter.trim(),
                }),
              ...(displayMode !== "tail" &&
                statusFilter !== "all" && { statusFilter }),
              ...(displayMode !== "tail" &&
                responseFilter !== "all" && { responseType: responseFilter }),
              ...(displayMode !== "tail" &&
                qtypeFilter !== "all" && { qtype: qtypeFilter }),
            },
            { signal: abortController.signal },
          );

          if (cancelled) {
            return;
          }

          // If the user opened the custom context menu mid-refresh, don't apply
          // incoming results (it can cause the table to jump under the cursor).
          if (logsTableContextMenuOpenRef.current) {
            setLoadingState("idle");
            return;
          }

          const nodeInfo = nodeMap.get(selectedNodeId);
          const entries = data.data?.entries ?? [];
          const enrichedEntries: TechnitiumCombinedQueryLogEntry[] =
            entries.map((entry) => ({
              ...entry,
              nodeId: selectedNodeId,
              baseUrl: nodeInfo?.baseUrl ?? "",
            }));

          if (displayMode === "tail") {
            // Tail mode: merge new entries
            if (!tailPaused) {
              const { buffer, newest, newTimestamps } = mergeTailEntries(
                enrichedEntries,
                tailBuffer,
                tailNewestTimestamp,
              );
              setTailBuffer(buffer);
              setTailNewestTimestamp(newest);

              // Accumulate new timestamps (don't replace existing ones)
              if (newTimestamps.size > 0) {
                setNewEntryTimestamps((prev) => {
                  const updated = new Set(prev);
                  newTimestamps.forEach((ts) => updated.add(ts));
                  return updated;
                });

                // Clear these specific timestamps after 10 seconds
                newTimestamps.forEach((ts) => {
                  setTimeout(() => {
                    setNewEntryTimestamps((prev) => {
                      const updated = new Set(prev);
                      updated.delete(ts);
                      return updated;
                    });
                  }, 10000);
                });
              }
            }
          } else {
            // Paginated mode: normal behavior
            setNodeSnapshot(data);
            setCombinedPage(undefined);
          }
        }

        if (!cancelled) {
          hasLoadedAnyLogsRef.current = true;
          setLoadingState("idle");
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        // Ignore aborts (common when filters change or when auto-refresh ticks while the previous load is still running).
        if (abortController.signal.aborted && !abortedByTimeout) {
          return;
        }

        if (abortController.signal.aborted && abortedByTimeout) {
          setLoadingState("error");
          setErrorMessage(
            `Failed to load logs: request timed out after ${Math.round(
              LOGS_FETCH_TIMEOUT_MS / 1000,
            )}s (check connection).`,
          );
          return;
        }
        setLoadingState("error");
        setErrorMessage((error as Error).message);

        if (displayMode !== "tail") {
          setCombinedPage(undefined);
          setNodeSnapshot(undefined);
        }
      } finally {
        window.clearTimeout(timeoutId);
        // Only clear if this request is still the active one.
        if (!cancelled && logsFetchAbortRef.current === abortController) {
          logsFetchInFlightRef.current = false;
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      logsFetchInFlightRef.current = false;
      abortController.abort();
      if (logsFetchAbortRef.current === abortController) {
        logsFetchAbortRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mode,
    selectedNodeId,
    pageNumber,
    paginatedRowsPerPage,
    refreshTick,
    isAutoRefresh,
    storedLogsReady,
    loadCombinedLogs,
    loadStoredCombinedLogs,
    loadNodeLogs,
    loadStoredNodeLogs,
    displayMode,
    tailPaused,
    mergeTailEntries,
    nodeMap,
    tailBufferSize,
    startDate,
    endDate,
    formatDateForApi,
    domainFilter,
    clientFilter,
    statusFilter,
    responseFilter,
    qtypeFilter,
    deduplicateDomains,
  ]);

  const displayEntries: TechnitiumCombinedQueryLogEntry[] = useMemo(() => {
    // In tail mode, use the tail buffer
    if (displayMode === "tail") {
      return tailBuffer;
    }

    // Paginated mode: use regular data sources
    if (mode === "combined") {
      return combinedPage?.entries ?? [];
    }

    if (mode === "node" && nodeSnapshot) {
      const nodeInfo = nodeMap.get(selectedNodeId);
      const entries = nodeSnapshot.data?.entries ?? [];
      return entries.map((entry) => ({
        ...entry,
        nodeId: selectedNodeId,
        baseUrl: nodeInfo?.baseUrl ?? "",
      }));
    }

    return [];
  }, [
    displayMode,
    tailBuffer,
    mode,
    combinedPage,
    nodeSnapshot,
    nodeMap,
    selectedNodeId,
  ]);

  const responseFilterOptions = useMemo(() => {
    const values = new Set<string>();
    displayEntries.forEach((entry) => {
      const response = entry.responseType?.trim() ?? "";
      if (response.length === 0) {
        values.add(EMPTY_RESPONSE_FILTER_VALUE);
      } else {
        values.add(response);
      }
    });

    return Array.from(values).sort((a, b) => {
      if (a === EMPTY_RESPONSE_FILTER_VALUE) {
        return 1;
      }
      if (b === EMPTY_RESPONSE_FILTER_VALUE) {
        return -1;
      }
      return a.localeCompare(b);
    });
  }, [displayEntries]);

  const qtypeFilterOptions = useMemo(() => {
    const values = new Set<string>();
    displayEntries.forEach((entry) => {
      const qtype = entry.qtype?.trim() ?? "";
      if (qtype.length > 0) {
        values.add(qtype);
      }
    });

    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [displayEntries]);

  // Note: Filtering is done server-side for paginated mode via API parameters
  // In tail mode, we also need to apply client-side filtering to the buffer
  const filteredEntries = useMemo(() => {
    if (displayMode === "tail") {
      // Apply client-side filters to tail buffer
      return displayEntries.filter((entry) => {
        // Domain filter
        if (
          domainFilter.trim() &&
          !entry.qname
            ?.toLowerCase()
            .includes(domainFilter.trim().toLowerCase())
        ) {
          return false;
        }

        // Client IP/hostname filter - check both clientIpAddress and clientName
        if (clientFilter.trim()) {
          const filterLower = clientFilter.trim().toLowerCase();
          const matchesIp = entry.clientIpAddress
            ?.toLowerCase()
            .includes(filterLower);
          const matchesName = entry.clientName
            ?.toLowerCase()
            .includes(filterLower);
          if (!matchesIp && !matchesName) {
            return false;
          }
        }

        // Status filter (blocked/allowed)
        if (statusFilter !== "all") {
          const isBlocked =
            entry.responseType === "Blocked" ||
            entry.responseType === "BlockedEDNS";
          if (statusFilter === "blocked" && !isBlocked) {
            return false;
          }
          if (statusFilter === "allowed" && isBlocked) {
            return false;
          }
        }

        // Response type filter
        if (responseFilter !== "all") {
          const entryResponse = entry.responseType?.trim() ?? "";
          const matchValue =
            responseFilter === EMPTY_RESPONSE_FILTER_VALUE ? "" : (
              responseFilter
            );
          if (entryResponse !== matchValue) {
            return false;
          }
        }

        // Query type filter
        if (qtypeFilter !== "all" && entry.qtype !== qtypeFilter) {
          return false;
        }

        return true;
      });
    }

    // Paginated mode: entries are already filtered by API
    return displayEntries;
  }, [
    displayMode,
    displayEntries,
    domainFilter,
    clientFilter,
    statusFilter,
    responseFilter,
    qtypeFilter,
  ]);

  // Toggle select all - defined here so it has access to filteredEntries
  const toggleSelectAll = useCallback(() => {
    // Pause auto-refresh when selecting domains and set dropdown to "Pause"
    setIsAutoRefresh(false);
    setRefreshSeconds(0);

    // Get all visible domains
    const visibleDomains = filteredEntries
      .map((entry) => entry.qname)
      .filter((domain): domain is string => !!domain);

    // Check if all visible domains are currently selected
    const allVisibleSelected =
      visibleDomains.length > 0 &&
      visibleDomains.every((domain) => selectedDomains.has(domain));

    if (allVisibleSelected) {
      // Deselect all
      setSelectedDomains(new Set());
    } else {
      // Select all visible domains
      setSelectedDomains(new Set(visibleDomains));
    }
  }, [filteredEntries, selectedDomains]);

  const isFilteringActive = useMemo(() => {
    return (
      domainFilter.trim().length > 0 ||
      clientFilter.trim().length > 0 ||
      statusFilter !== "all" ||
      responseFilter !== "all" ||
      qtypeFilter !== "all" ||
      startDate.trim().length > 0 ||
      endDate.trim().length > 0
    );
  }, [
    domainFilter,
    clientFilter,
    statusFilter,
    responseFilter,
    qtypeFilter,
    startDate,
    endDate,
  ]);

  // Calculate statistics from display entries (before deduplication)
  // This shows the actual number of queries, not the deduplicated count
  const statistics = useMemo(() => {
    const stats = {
      total: displayEntries.length,
      allowed: 0,
      blocked: 0,
      cached: 0,
      recursive: 0,
      uniqueClients: new Set<string>(),
      uniqueDomains: new Set<string>(),
      responseTimes: [] as number[],
    };

    displayEntries.forEach((entry) => {
      // Count response types
      const blocked = isEntryBlocked(entry);
      if (blocked) {
        stats.blocked++;
      } else {
        stats.allowed++;
      }

      // Check if cached
      const responseType = entry.responseType?.toLowerCase() ?? "";
      if (responseType.includes("cached")) {
        stats.cached++;
      }
      if (responseType.includes("recursive")) {
        stats.recursive++;
      }

      // Track unique clients (prefer IP for consistency)
      if (entry.clientIpAddress) {
        stats.uniqueClients.add(entry.clientIpAddress);
      }

      // Track unique domains
      if (entry.qname) {
        stats.uniqueDomains.add(entry.qname);
      }

      // Collect response times
      if (entry.responseRtt && entry.responseRtt > 0) {
        stats.responseTimes.push(entry.responseRtt);
      }
    });

    // Calculate average response time
    const avgResponseTime =
      stats.responseTimes.length > 0 ?
        Math.round(
          stats.responseTimes.reduce((sum, time) => sum + time, 0) /
            stats.responseTimes.length,
        )
      : null;

    // Calculate percentages
    const allowedPercent =
      stats.total > 0 ? Math.round((stats.allowed / stats.total) * 100) : 0;
    const blockedPercent =
      stats.total > 0 ? Math.round((stats.blocked / stats.total) * 100) : 0;
    const cachedPercent =
      stats.total > 0 ? Math.round((stats.cached / stats.total) * 100) : 0;

    return {
      total: stats.total,
      allowed: stats.allowed,
      blocked: stats.blocked,
      cached: stats.cached,
      recursive: stats.recursive,
      uniqueClients: stats.uniqueClients.size,
      uniqueDomains: stats.uniqueDomains.size,
      avgResponseTime,
      allowedPercent,
      blockedPercent,
      cachedPercent,
    };
  }, [displayEntries]);

  const resetFilters = useCallback(() => {
    setDomainFilter("");
    setClientFilter("");
    setStatusFilter("all");
    setResponseFilter("all");
    setQtypeFilter("all");
    setStartDate("");
    setEndDate("");
  }, []);

  const totalPages = useMemo(() => {
    if (mode === "combined") {
      return combinedPage?.totalPages ?? 1;
    }

    if (mode === "node") {
      return nodeSnapshot?.data?.totalPages ?? 1;
    }

    return 1;
  }, [mode, combinedPage, nodeSnapshot]);

  const totalEntries = useMemo(() => {
    if (mode === "combined") {
      return combinedPage?.totalEntries ?? 0;
    }

    if (mode === "node") {
      return nodeSnapshot?.data?.totalEntries ?? 0;
    }

    return 0;
  }, [mode, combinedPage, nodeSnapshot]);

  const totalMatchingEntries = useMemo(() => {
    // In tail mode, use the filtered entries count (client-side filtering)
    if (displayMode === "tail") {
      return filteredEntries.length;
    }

    // In paginated mode, use the server-provided count
    if (mode === "combined") {
      return combinedPage?.totalMatchingEntries ?? 0;
    }

    if (mode === "node") {
      return nodeSnapshot?.data?.totalMatchingEntries ?? 0;
    }

    return 0;
  }, [displayMode, filteredEntries, mode, combinedPage, nodeSnapshot]);

  const duplicatesRemoved = useMemo(() => {
    // Only combined mode with deduplication enabled shows duplicate count
    if (mode === "combined" && displayMode === "paginated") {
      return combinedPage?.duplicatesRemoved ?? 0;
    }
    return 0;
  }, [mode, displayMode, combinedPage]);

  const hasMorePages = useMemo(() => {
    if (displayMode !== "paginated") {
      return false;
    }

    if (mode === "combined") {
      return combinedPage?.hasMorePages ?? false;
    }

    if (mode === "node") {
      return nodeSnapshot?.data?.hasMorePages ?? false;
    }

    return false;
  }, [displayMode, mode, combinedPage, nodeSnapshot]);

  const pauseAutoRefreshForManualPaging = useCallback(() => {
    // Manual paging implies the user is inspecting a specific page.
    // Pause auto-refresh so new rows don't reshuffle/replace what they're looking at.
    setIsAutoRefresh(false);
    setRefreshSeconds(0);
  }, [setIsAutoRefresh, setRefreshSeconds]);

  const handlePrevPage = () => {
    pauseAutoRefreshForManualPaging();
    setPageNumber((prev) => Math.max(1, prev - 1));
  };

  const handleNextPage = () => {
    pauseAutoRefreshForManualPaging();
    setPageNumber((prev) => Math.min(totalPages, prev + 1));
  };

  const [pageJumpOpen, setPageJumpOpen] = useState<boolean>(false);
  const [pageJumpValue, setPageJumpValue] = useState<string>("");
  const pageJumpInputRef = useRef<HTMLInputElement | null>(null);

  const openPageJump = useCallback(() => {
    setPageJumpValue(String(pageNumber));
    setPageJumpOpen(true);
  }, [pageNumber]);

  const closePageJump = useCallback(() => {
    setPageJumpOpen(false);
  }, []);

  const commitPageJump = useCallback(() => {
    const raw = pageJumpValue.trim();
    if (!raw) {
      closePageJump();
      return;
    }

    const next = Number.parseInt(raw, 10);
    if (!Number.isFinite(next)) {
      closePageJump();
      return;
    }

    const clamped = Math.min(totalPages, Math.max(1, next));
    pauseAutoRefreshForManualPaging();
    setPageNumber(clamped);
    closePageJump();
  }, [
    closePageJump,
    pageJumpValue,
    pauseAutoRefreshForManualPaging,
    totalPages,
  ]);

  useEffect(() => {
    if (!pageJumpOpen) {
      return;
    }

    const id = window.requestAnimationFrame(() => {
      pageJumpInputRef.current?.focus();
      pageJumpInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(id);
  }, [pageJumpOpen]);

  const handleModeChange = (nextMode: ViewMode) => {
    setIsAutoRefresh(false);
    setMode(nextMode);
  };

  return (
    <>
      <PullToRefreshIndicator
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
        isRefreshing={pullToRefresh.isRefreshing}
      />
      {/* Single shared tooltip for all domain cells */}
      <Tooltip
        id="domain-tooltip-shared"
        place="top"
        className="domain-tooltip"
        clickable
        afterShow={() => {
          const anchor = domainTooltipAnchorRef.current;
          if (!anchor) {
            return;
          }

          const domain = anchor.getAttribute("data-domain") ?? "";
          const nodeId = anchor.getAttribute("data-node-id") ?? "";
          const isBlocked = anchor.getAttribute("data-is-blocked") === "true";

          if (!isBlocked || !domain || !nodeId) {
            return;
          }

          triggerDomainBlockSourceLookupImmediate(nodeId, domain);
        }}
        afterHide={() => {
          setExpandedDomainTooltipKey(null);
        }}
        render={({
          activeAnchor,
          content,
        }: {
          activeAnchor: HTMLElement | null;
          content: string | null;
        }) => {
          if (!activeAnchor) {
            return null;
          }

          const anchor =
            (activeAnchor.closest(
              "[data-tooltip-id='domain-tooltip-shared']",
            ) as HTMLElement | null) ?? activeAnchor;

          domainTooltipAnchorRef.current = anchor;

          const baseHtml =
            typeof content === "string" ? content : (
              (anchor.getAttribute("data-tooltip-content") ?? "")
            );

          const domain = anchor.getAttribute("data-domain") ?? "";
          const nodeId = anchor.getAttribute("data-node-id") ?? "";
          const isBlocked = anchor.getAttribute("data-is-blocked") === "true";

          const key =
            domain && nodeId ?
              getDomainBlockSourceCacheKey(nodeId, domain)
            : null;

          const lookup = key ? domainBlockSourceByKey[key] : undefined;
          const rawMatches =
            lookup?.result?.foundIn?.filter((match) =>
              isBlockMatch(match.type),
            ) ?? [];

          const allMatches =
            rawMatches.length <= 1 ?
              rawMatches
            : Array.from(
                new Map(
                  rawMatches.map((match) => [
                    getBlockMatchDedupeKey(match),
                    match,
                  ]),
                ).values(),
              );
          const expanded =
            key !== null &&
            expandedDomainTooltipKey === key &&
            allMatches.length > 3;
          const matchesToShow = expanded ? allMatches : allMatches.slice(0, 3);
          const remaining = Math.max(
            0,
            allMatches.length - matchesToShow.length,
          );

          return (
            <div onContextMenu={handleLogsTableContextMenu}>
              {/*
               * SECURITY NOTE (XSS): `baseHtml` originates from the domain-cell tooltip string.
               * That string is constructed to escape all dynamic/untrusted values (see
               * `escapeTooltipHtml()` in the Domain column renderer). Do not pass raw/unescaped
               * values into that HTML.
               */}
              <div dangerouslySetInnerHTML={{ __html: baseHtml }} />

              {isBlocked && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 8,
                    borderTop: "1px solid rgba(255, 255, 255, 0.15)",
                  }}
                >
                  <div>
                    <strong>Likely blocked by:</strong>
                  </div>

                  {(!lookup || lookup.status === "idle") && (
                    <div style={{ marginTop: 6, opacity: 0.8 }}>
                      Hover ~0.3s to check block sources…
                    </div>
                  )}

                  {lookup?.status === "loading" && (
                    <div style={{ marginTop: 6, opacity: 0.8 }}>
                      Looking up block sources…
                    </div>
                  )}

                  {lookup?.status === "error" && (
                    <div style={{ marginTop: 6, opacity: 0.8 }}>
                      Unable to determine block source: {lookup.error}
                    </div>
                  )}

                  {lookup?.status === "loaded" && (
                    <>
                      {allMatches.length === 0 ?
                        <div style={{ marginTop: 6, opacity: 0.8 }}>
                          No matching blocklist/rule found (may be blocked by a
                          different mechanism).
                        </div>
                      : <div style={{ marginTop: 6 }}>
                          {matchesToShow.map((match, index) => (
                            <div
                              key={
                                getBlockMatchDedupeKey(match) ||
                                `${match.type}-${match.source}-${index}`
                              }
                              style={{ marginLeft: 12, fontSize: 12 }}
                            >
                              <span
                                data-logs-tooltip-block-source="true"
                                data-block-match-label={formatBlockMatchLabel(
                                  match,
                                )}
                                data-block-match-source={match.source ?? ""}
                                data-block-match-pattern={
                                  match.matchedPattern ?? ""
                                }
                              >
                                <span className="tooltip-blocked">→</span>{" "}
                                {formatBlockMatchLabel(match)}
                              </span>
                            </div>
                          ))}

                          {allMatches.length > 3 && key && (
                            <button
                              type="button"
                              className="domain-tooltip__show-more"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setExpandedDomainTooltipKey(
                                  expanded ? null : key,
                                );
                              }}
                              style={{ marginTop: 8 }}
                            >
                              {expanded ?
                                "Show less"
                              : remaining > 0 ?
                                `Show ${remaining} more`
                              : "Show more"}
                            </button>
                          )}
                        </div>
                      }
                    </>
                  )}
                </div>
              )}
            </div>
          );
        }}
      />
      {/* Tooltip for response time cells */}
      <Tooltip
        id="response-time-tooltip"
        place="top"
        className="domain-tooltip"
      />
      <section ref={pullToRefresh.containerRef} className="logs-page">
        <header className="logs-page__header">
          <div className="logs-page__header-title">
            <h1>Query Logs</h1>
            {/* <p className="logs-page__subtitle">
              Review DNS query activity across Technitium DNS nodes and inspect
              combined views for parity checks.
            </p> */}
          </div>
        </header>

        {loadingState === "error" && errorMessage && (
          <div className="logs-page__error">
            {(
              getAuthRedirectReason() === "session-expired" &&
              /\(401\)/.test(errorMessage)
            ) ?
              <>Companion session expired — redirecting to sign in…</>
            : <>Failed to load logs: {errorMessage}</>}
          </div>
        )}

        {loadingState === "loading" ?
          <SkeletonLogsStats />
        : <div
            className={`logs-page__statistics ${loadingState === "refreshing" ? "refreshing" : ""} ${statisticsExpanded ? "expanded" : "collapsed"}`}
          >
            <div className="logs-page__statistics-header">
              <button
                type="button"
                className="logs-page__statistics-toggle"
                onClick={() => setStatisticsExpanded(!statisticsExpanded)}
                aria-expanded={statisticsExpanded}
              >
                <span className="logs-page__statistics-toggle-icon">
                  {statisticsExpanded ? "▼" : "▶"}
                </span>
                {!statisticsExpanded && (
                  <span className="logs-page__statistics-summary">
                    <strong>{statistics.total}</strong> queries ·
                    <span className="stat-blocked">
                      {" "}
                      {statistics.blocked} blocked ({statistics.blockedPercent}
                      %)
                    </span>{" "}
                    ·
                    <span className="stat-allowed">
                      {" "}
                      {statistics.allowed} allowed ({statistics.allowedPercent}
                      %)
                    </span>
                  </span>
                )}
                {statisticsExpanded && <span>Statistics</span>}
              </button>
            </div>

            {statisticsExpanded && (
              <div className="logs-page__statistics-content">
                <div className="logs-page__stat logs-page__stat--total">
                  <span className="logs-page__stat-icon" aria-hidden="true">
                    📊
                  </span>
                  <span className="logs-page__stat-value">
                    {statistics.total.toLocaleString()}
                  </span>
                  <span className="logs-page__stat-label">queries</span>
                </div>
                <div className="logs-page__stat logs-page__stat--allowed">
                  <span className="logs-page__stat-icon" aria-hidden="true">
                    ✓
                  </span>
                  <span className="logs-page__stat-value">
                    {statistics.allowed.toLocaleString()}
                  </span>
                  <span className="logs-page__stat-label">
                    Allowed ({statistics.allowedPercent}%)
                  </span>
                </div>
                <div className="logs-page__stat logs-page__stat--blocked">
                  <span className="logs-page__stat-icon" aria-hidden="true">
                    ✕
                  </span>
                  <span className="logs-page__stat-value">
                    {statistics.blocked.toLocaleString()}
                  </span>
                  <span className="logs-page__stat-label">
                    Blocked ({statistics.blockedPercent}%)
                  </span>
                </div>
                <div className="logs-page__stat logs-page__stat--cached">
                  <span className="logs-page__stat-icon" aria-hidden="true">
                    ⚡
                  </span>
                  <span className="logs-page__stat-value">
                    {statistics.cached.toLocaleString()}
                  </span>
                  <span className="logs-page__stat-label">
                    Cached ({statistics.cachedPercent}%)
                  </span>
                </div>
                <div className="logs-page__stat logs-page__stat--clients">
                  <span className="logs-page__stat-icon" aria-hidden="true">
                    👥
                  </span>
                  <span className="logs-page__stat-value">
                    {statistics.uniqueClients}
                  </span>
                  <span className="logs-page__stat-label">unique clients</span>
                </div>
                <div className="logs-page__stat logs-page__stat--domains">
                  <span className="logs-page__stat-icon" aria-hidden="true">
                    🌐
                  </span>
                  <span className="logs-page__stat-value">
                    {statistics.uniqueDomains}
                  </span>
                  <span className="logs-page__stat-label">unique domains</span>
                </div>
                {statistics.avgResponseTime !== null && (
                  <div className="logs-page__stat logs-page__stat--response-time">
                    <span className="logs-page__stat-icon" aria-hidden="true">
                      ⏱️
                    </span>
                    <span className="logs-page__stat-value">
                      {statistics.avgResponseTime}ms
                    </span>
                    <span className="logs-page__stat-label">avg response</span>
                  </div>
                )}
              </div>
            )}
          </div>
        }

        {loadingState === "loading" ?
          <SkeletonLogsSummary />
        : <div
            className={`logs-page__summary ${loadingState === "refreshing" ? "refreshing" : ""}`}
          >
            {displayMode === "tail" ?
              <>
                <div>
                  <strong>Buffer size:</strong> {tailBuffer.length} /{" "}
                  {tailBufferSize}
                </div>
                <div className="logs-page__summary-line">
                  <strong>Mode:</strong> Live Tail
                  <span className="logs-page__summary-pills">
                    <span
                      className={`logs-page__meta-pill logs-page__meta-pill--${logsSourceKind}`}
                      title={logsSourceTitle}
                    >
                      {logsSourceLabel}
                    </span>
                    {duplicatesRemoved > 0 && (
                      <span
                        className="logs-page__meta-pill logs-page__meta-pill--dedupe"
                        title="Duplicates removed by domain deduplication"
                      >
                        Deduped {duplicatesRemoved.toLocaleString()}
                      </span>
                    )}
                  </span>
                </div>
                <div>
                  <strong>Last update:</strong>{" "}
                  {tailNewestTimestamp ?
                    new Date(tailNewestTimestamp).toLocaleString()
                  : "—"}
                </div>
                {isFilteringActive && (
                  <div>
                    <strong>Matching entries:</strong>{" "}
                    {totalMatchingEntries.toLocaleString()}
                  </div>
                )}
                {duplicatesRemoved > 0 && (
                  <div className="logs-page__duplicate-info">
                    <strong>
                      <FontAwesomeIcon icon={faRotate} /> Duplicates removed:
                    </strong>{" "}
                    <span className="logs-page__duplicate-count">
                      {duplicatesRemoved.toLocaleString()}
                    </span>
                  </div>
                )}
              </>
            : <>
                <div>
                  <strong>Total entries:</strong>{" "}
                  {totalEntries.toLocaleString()}
                </div>
                <div>
                  <strong>Rows per page:</strong> {paginatedRowsPerPage}
                </div>
                <div className="logs-page__summary-line">
                  <strong>Fetched:</strong>{" "}
                  {mode === "combined" ?
                    combinedPage?.fetchedAt ?
                      new Date(combinedPage.fetchedAt).toLocaleString()
                    : "—"
                  : nodeSnapshot?.fetchedAt ?
                    new Date(nodeSnapshot.fetchedAt).toLocaleString()
                  : "—"}
                  <span className="logs-page__summary-pills">
                    <span
                      className={`logs-page__meta-pill logs-page__meta-pill--${logsSourceKind}`}
                      title={logsSourceTitle}
                    >
                      {logsSourceLabel}
                    </span>
                    {storedLogsReady && storedResponseCache?.enabled && (
                      <span
                        className="logs-page__meta-pill logs-page__meta-pill--cache"
                        title={`SQLite stored-log response cache (server-side). TTL=${Math.round(storedResponseCache.ttlMs / 1000)}s, Size=${storedResponseCache.size}/${storedResponseCache.maxEntries}, Hits=${storedResponseCache.hits}, Misses=${storedResponseCache.misses}, Evictions=${storedResponseCache.evictions}`}
                      >
                        DB Cache
                        {storedResponseCacheHitRatePercent !== null ?
                          ` ${storedResponseCacheHitRatePercent}%`
                        : ""}
                      </span>
                    )}
                    {duplicatesRemoved > 0 && (
                      <span
                        className="logs-page__meta-pill logs-page__meta-pill--dedupe"
                        title="Duplicates removed by domain deduplication"
                      >
                        Deduped {duplicatesRemoved.toLocaleString()}
                      </span>
                    )}
                  </span>
                </div>
                {isFilteringActive && (
                  <div>
                    <strong>Matching entries:</strong>{" "}
                    {totalMatchingEntries.toLocaleString()}
                  </div>
                )}
              </>
            }
          </div>
        }

        {/* Mobile filter toggle button */}
        <button
          type="button"
          className={`logs-page__filters-toggle ${filtersVisible ? "active" : ""}`}
          onClick={() => setFiltersVisible(!filtersVisible)}
          title={filtersVisible ? "Hide filters" : "Show filters"}
        >
          🔍 {filtersVisible ? "Hide" : "Show"} Filters
          {isFilteringActive && !filtersVisible && (
            <span className="logs-page__filters-badge">●</span>
          )}
        </button>

        <div
          className={`logs-page__quick-filters ${loadingState === "refreshing" ? "refreshing" : ""} ${!filtersVisible ? "logs-page__quick-filters--mobile-hidden" : ""}`}
        >
          {!filterTipDismissed && (
            <div className="logs-page__filter-hint">
              <span className="logs-page__filter-hint-text">
                💡 <strong>Tip:</strong> Click any client or domain in the table
                to filter. Hold Shift to combine filters.
              </span>
              <button
                type="button"
                className="logs-page__filter-hint-dismiss"
                onClick={dismissFilterTip}
                aria-label="Dismiss tip"
                title="Don't show this again"
              >
                ✕
              </button>
            </div>
          )}
          <label className="logs-page__quick-filter">
            <span>Start Date/Time</span>
            <input
              id="start-date-filter"
              name="start-date-filter"
              type="datetime-local"
              value={startDate}
              min={formatDateForInput(
                new Date(Date.now() - queryLogRetentionHours * 60 * 60 * 1000),
              )}
              max={endDate || formatDateForInput(new Date())}
              onChange={(event) => clampDateRange(event.target.value, endDate)}
              placeholder="Start date/time"
            />
          </label>
          <label className="logs-page__quick-filter">
            <span>End Date/Time</span>
            <input
              id="end-date-filter"
              name="end-date-filter"
              type="datetime-local"
              value={endDate}
              min={
                startDate ||
                formatDateForInput(
                  new Date(
                    Date.now() - queryLogRetentionHours * 60 * 60 * 1000,
                  ),
                )
              }
              max={formatDateForInput(new Date())}
              onChange={(event) =>
                clampDateRange(startDate, event.target.value)
              }
              placeholder="End date/time"
            />
          </label>
          <label className="logs-page__quick-filter">
            <span>Client</span>
            <input
              id="client-filter"
              name="client-filter"
              type="text"
              placeholder={
                displayMode === "paginated" ?
                  "Hostname/IP contains… (or click client)"
                : "Contains… (or click client)"
              }
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
            />
          </label>
          <label className="logs-page__quick-filter">
            <span>Response</span>
            <select
              id="response-filter"
              name="response-filter"
              value={responseFilter}
              onChange={(event) => setResponseFilter(event.target.value)}
            >
              <option value="all">All</option>
              {responseFilterOptions.map((option) => (
                <option key={option} value={option}>
                  {option === EMPTY_RESPONSE_FILTER_VALUE ?
                    "No response value"
                  : option}
                </option>
              ))}
            </select>
          </label>
          <label className="logs-page__quick-filter">
            <span>Status</span>
            <select
              id="status-filter"
              name="status-filter"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
            >
              <option value="all">All</option>
              <option value="blocked">Blocked</option>
              <option value="allowed">Allowed</option>
            </select>
          </label>
          {!deduplicateDomains && (
            <label className="logs-page__quick-filter">
              <span>Query Type</span>
              <select
                id="qtype-filter"
                name="qtype-filter"
                value={qtypeFilter}
                onChange={(event) => setQtypeFilter(event.target.value)}
              >
                <option value="all">All</option>
                {qtypeFilterOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="logs-page__quick-filter">
            <span>Domain</span>
            <input
              id="domain-filter"
              name="domain-filter"
              type="text"
              placeholder="Contains… (or click domain)"
              value={domainFilter}
              onChange={(event) => setDomainFilter(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="logs-page__filters-reset"
            onClick={resetFilters}
            disabled={!isFilteringActive}
          >
            Clear filters
          </button>
          <div
            className={`logs-page__date-presets ${storedLogsReady ? "" : "logs-page__date-presets--disabled"}`}
            aria-disabled={!storedLogsReady}
          >
            {storedLogsReady ?
              <button
                type="button"
                className="logs-page__date-preset"
                onClick={() => applyDatePreset("last-24h")}
                title="Show logs from the last 24 hours"
              >
                Last 24h
              </button>
            : <span
                className="logs-page__date-preset-disabled"
                title="Requires stored logs (SQLite)"
              >
                <button
                  type="button"
                  className="logs-page__date-preset"
                  disabled
                  aria-disabled="true"
                >
                  Last 24h
                </button>
              </span>
            }

            {storedLogsReady ?
              <button
                type="button"
                className="logs-page__date-preset"
                onClick={() => applyDatePreset("last-hour")}
                title="Show logs from the last hour"
              >
                Last Hour
              </button>
            : <span
                className="logs-page__date-preset-disabled"
                title="Requires stored logs (SQLite)"
              >
                <button
                  type="button"
                  className="logs-page__date-preset"
                  disabled
                  aria-disabled="true"
                >
                  Last Hour
                </button>
              </span>
            }

            {storedLogsReady ?
              <button
                type="button"
                className="logs-page__date-preset"
                onClick={() => applyDatePreset("yesterday")}
                title="Show logs from yesterday"
              >
                Yesterday
              </button>
            : <span
                className="logs-page__date-preset-disabled"
                title="Requires stored logs (SQLite)"
              >
                <button
                  type="button"
                  className="logs-page__date-preset"
                  disabled
                  aria-disabled="true"
                >
                  Yesterday
                </button>
              </span>
            }

            {storedLogsReady ?
              <button
                type="button"
                className="logs-page__date-preset"
                onClick={() => applyDatePreset("today")}
                title="Show logs from today"
              >
                Today
              </button>
            : <span
                className="logs-page__date-preset-disabled"
                title="Requires stored logs (SQLite)"
              >
                <button
                  type="button"
                  className="logs-page__date-preset"
                  disabled
                  aria-disabled="true"
                >
                  Today
                </button>
              </span>
            }

            {(startDate || endDate) && (
              <button
                type="button"
                className="logs-page__date-preset logs-page__date-preset--clear"
                onClick={() => applyDatePreset("clear")}
                title="Clear date filters"
              >
                Clear Dates
              </button>
            )}
          </div>
        </div>

        {!selectionTipDismissed && (
          <div className="logs-page__selection-tip">
            <div className="logs-page__selection-tip-content">
              <span className="logs-page__selection-tip-icon">💡</span>
              <span className="logs-page__selection-tip-text">
                <strong>Selection tip:</strong> Selecting a domain affects all
                query types (A, AAAA, HTTPS, etc.) for that domain. Rows are
                grouped by domain for easier identification.
              </span>
            </div>
            <button
              type="button"
              className="logs-page__selection-tip-dismiss"
              onClick={dismissSelectionTip}
              aria-label="Dismiss selection tip"
            >
              ×
            </button>
          </div>
        )}

        <div
          className={`logs-page__bulk-actions ${selectedDomains.size > 0 ? "visible" : "hidden"}`}
        >
          <div className="logs-page__bulk-actions-info">
            <strong>{selectedDomains.size}</strong> domain
            {selectedDomains.size !== 1 ? "s" : ""} selected
          </div>
          <div className="logs-page__bulk-actions-buttons">
            <button
              type="button"
              className="logs-page__bulk-action-btn logs-page__bulk-action-btn--block"
              onClick={() => initiateBulkAction("block")}
            >
              <FontAwesomeIcon icon={faBan} /> Block Selected
            </button>
            <button
              type="button"
              className="logs-page__bulk-action-btn logs-page__bulk-action-btn--allow"
              onClick={() => initiateBulkAction("allow")}
            >
              ✓ Allow Selected
            </button>
            <button
              type="button"
              className="logs-page__bulk-action-btn logs-page__bulk-action-btn--clear"
              onClick={clearSelection}
            >
              Clear Selection
            </button>
          </div>
        </div>

        {/* Mobile-optimized: Collapsible controls section */}
        <div
          className={`logs-page__mobile-controls ${mobileControlsExpanded ? "expanded" : "collapsed"}`}
        >
          <button
            type="button"
            className="logs-page__mobile-controls-toggle"
            onClick={() => setMobileControlsExpanded(!mobileControlsExpanded)}
            aria-expanded={mobileControlsExpanded}
          >
            <span className="logs-page__mobile-controls-icon">
              {mobileControlsExpanded ? "▼" : "▶"}
            </span>
            <span className="logs-page__mobile-controls-label">
              {mobileControlsExpanded ? "Hide Controls" : "Show Controls"}
            </span>
            {!mobileControlsExpanded && (
              <span className="logs-page__mobile-controls-summary">
                <FontAwesomeIcon
                  icon={displayMode === "paginated" ? faFile : faTowerBroadcast}
                />{" "}
                ·
                {mode === "combined" ?
                  " Combined"
                : ` ${nodes.find((n) => n.id === selectedNodeId)?.name || "Node"}`
                }{" "}
                · Page {pageNumber}/{totalPages}
              </span>
            )}
          </button>

          <div
            className={`logs-page__controls-content ${mobileControlsExpanded ? "visible" : "hidden"}`}
          >
            <div className="logs-page__controls">
              <div className="logs-page__mode-toggle">
                <button
                  type="button"
                  className={
                    displayMode === "tail" ?
                      "toggle-button active"
                    : "toggle-button"
                  }
                  onClick={() => handleDisplayModeChange("tail")}
                >
                  📡 Live Tail
                </button>
                <button
                  type="button"
                  className={
                    displayMode === "paginated" ?
                      "toggle-button active"
                    : "toggle-button"
                  }
                  onClick={() => handleDisplayModeChange("paginated")}
                >
                  <FontAwesomeIcon icon={faFile} /> Paginated
                </button>
              </div>
              <div className="logs-page__mode-toggle">
                <button
                  type="button"
                  className={
                    mode === "combined" ?
                      "toggle-button active"
                    : "toggle-button"
                  }
                  onClick={() => handleModeChange("combined")}
                >
                  Combined View
                </button>
                <button
                  type="button"
                  className={
                    mode === "node" ? "toggle-button active" : "toggle-button"
                  }
                  onClick={() => handleModeChange("node")}
                >
                  Per Node
                </button>
              </div>

              <div className="logs-page__filters">
                <label className="logs-page__filter">
                  Node
                  <select
                    id="logs-node-selector"
                    name="node"
                    value={selectedNodeId}
                    onChange={(event) => {
                      setIsAutoRefresh(false);
                      setSelectedNodeId(event.target.value);
                    }}
                    disabled={mode === "combined"}
                  >
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name}
                      </option>
                    ))}
                  </select>
                </label>
                {displayMode === "paginated" && (
                  <label className="logs-page__filter">
                    Page
                    <div className="logs-page__pager">
                      <button
                        type="button"
                        onClick={handlePrevPage}
                        disabled={pageNumber <= 1 || loadingState === "loading"}
                      >
                        Prev
                      </button>
                      <span>
                        {pageJumpOpen ?
                          <span className="logs-page__pager-page-jump">
                            <input
                              ref={pageJumpInputRef}
                              className="logs-page__pager-page-input"
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={totalPages}
                              value={pageJumpValue}
                              onChange={(event) =>
                                setPageJumpValue(event.target.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  commitPageJump();
                                  return;
                                }

                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  closePageJump();
                                }
                              }}
                              onBlur={() => commitPageJump()}
                              aria-label={`Jump to page (1 to ${totalPages})`}
                            />
                            <span className="logs-page__pager-page-total">
                              / {totalPages}
                            </span>
                          </span>
                        : <button
                            type="button"
                            className="logs-page__pager-page-button"
                            onClick={openPageJump}
                            title="Jump to page"
                          >
                            {pageNumber} / {totalPages}
                          </button>
                        }
                        {hasMorePages && (
                          <span
                            className="logs-page__more-results-warning"
                            title="Fetch limit reached. Use more specific filters to see additional results."
                          >
                            ⚠️ More results may exist
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={handleNextPage}
                        disabled={
                          pageNumber >= totalPages || loadingState === "loading"
                        }
                      >
                        Next
                      </button>
                    </div>
                  </label>
                )}
              </div>
              <div className="logs-page__refresh-controls">
                <button
                  type="button"
                  className={
                    refreshSeconds === 0 ?
                      "logs-page__live-toggle paused"
                    : "logs-page__live-toggle live"
                  }
                  onClick={(event) => {
                    // Prevent any default behavior that could cause page jump
                    event.preventDefault();
                    event.stopPropagation();

                    // Save scroll position before state update
                    const scrollY = window.scrollY;

                    if (refreshSeconds === 0) {
                      // Resume: set to default refresh rate and clear selections
                      setRefreshSeconds(TAIL_MODE_DEFAULT_REFRESH);
                      // Clear selections when resuming (they'll become stale)
                      if (selectedDomains.size > 0) {
                        setSelectedDomains(new Set());
                      }
                      if (bulkAction !== null) {
                        setBulkAction(null);
                      }
                    } else {
                      // Pause: just set to 0, don't touch selections
                      setRefreshSeconds(0);
                    }

                    // Restore scroll position after React renders
                    // Double RAF to ensure scroll restoration happens after all DOM updates
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        window.scrollTo(0, scrollY);
                      });
                    });
                  }}
                  title={
                    refreshSeconds === 0 ?
                      endDate.trim().length > 0 ?
                        "Auto-refresh paused because End Date/Time is set. Clear it to resume."
                      : logsTableContextMenu ?
                        "Auto-refresh paused while the context menu is open."
                      : "Click to resume auto-refresh"
                    : "Click to pause auto-refresh"
                  }
                >
                  {
                    displayMode === "tail" ?
                      // Tail mode: Show entry count in buffer
                      refreshSeconds === 0 ?
                        <>⏸️ Paused ({tailBuffer.length} entries)</>
                      : <>🟢 Live ({tailBuffer.length} entries)</>
                      // Paginated mode: No entry count, simpler labels
                    : refreshSeconds === 0 ?
                      <>⏸️ Paused</>
                    : <>
                        <FontAwesomeIcon icon={faRotate} /> Auto-refresh
                      </>

                  }
                </button>
                <label className="logs-page__filter">
                  Refresh interval
                  <select
                    id="refresh-interval"
                    name="refresh-interval"
                    value={
                      refreshSeconds === 0 ?
                        TAIL_MODE_DEFAULT_REFRESH
                      : refreshSeconds
                    }
                    onChange={(event) => {
                      setIsAutoRefresh(false);
                      const value = Number(event.target.value);
                      setRefreshSeconds(value);

                      // Clear selections when changing refresh rate
                      setSelectedDomains(new Set());
                      setBulkAction(null);
                    }}
                    disabled={refreshSeconds === 0}
                  >
                    {REFRESH_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="logs-page__settings-container">
                <button
                  ref={settingsButtonRef}
                  type="button"
                  className={
                    settingsOpen ?
                      "logs-page__settings-toggle active"
                    : "logs-page__settings-toggle"
                  }
                  onClick={() => setSettingsOpen((prev) => !prev)}
                >
                  Table settings
                </button>

                {settingsOpen && (
                  <>
                    <div
                      className="logs-page__settings-backdrop"
                      onClick={() => setSettingsOpen(false)}
                    />
                    <section
                      className={`logs-page__settings logs-page__settings--${settingsPopupHorizontalAlign}`}
                    >
                      <header>
                        <h2>Table settings</h2>
                        <p>
                          Adjust which optional columns appear in the logs
                          table.
                        </p>
                      </header>
                      <div className="logs-page__settings-options">
                        {OPTIONAL_COLUMN_OPTIONS.map((option) => {
                          const key = option.key;
                          return (
                            <label
                              key={key}
                              className="logs-page__settings-option"
                            >
                              <input
                                type="checkbox"
                                checked={columnVisibility[key]}
                                onChange={() => toggleColumnVisibility(key)}
                              />
                              <div>
                                <span className="logs-page__settings-option-label">
                                  {option.label}
                                </span>
                                <span className="logs-page__settings-option-description">
                                  {option.description}
                                </span>
                              </div>
                            </label>
                          );
                        })}
                      </div>

                      {/* Additional Settings */}
                      <div className="logs-page__settings-options">
                        <label className="logs-page__settings-option">
                          <input
                            type="checkbox"
                            checked={deduplicateDomains}
                            onChange={toggleDeduplicateDomains}
                            className="logs-page__settings-checkbox"
                          />
                          <div>
                            <span className="logs-page__settings-option-label">
                              Deduplicate Domains
                            </span>
                            <span className="logs-page__settings-option-description">
                              Show only the latest query for each unique domain.
                              Useful for quickly scanning recent activity
                              without duplicate entries.
                            </span>
                          </div>
                        </label>
                      </div>

                      {/* Mobile Layout Mode Selection */}
                      <header
                        className="logs-page__mobile-layout-header"
                        style={{ marginTop: "2rem" }}
                      >
                        <h3>Mobile Layout</h3>
                        <p>
                          Choose how logs are displayed on mobile devices
                          (screens under 768px wide).
                        </p>
                      </header>
                      <div className="logs-page__settings-options logs-page__mobile-layout-options">
                        <label className="logs-page__settings-option logs-page__settings-option--radio">
                          <input
                            type="radio"
                            name="mobileLayoutMode"
                            value="compact-table"
                            checked={mobileLayoutMode === "compact-table"}
                            onChange={(e) => {
                              const mode = e.target.value as MobileLayoutMode;
                              setMobileLayoutMode(mode);
                              if (typeof window !== "undefined") {
                                try {
                                  window.localStorage.setItem(
                                    MOBILE_LAYOUT_MODE_KEY,
                                    mode,
                                  );
                                } catch (error) {
                                  console.warn(
                                    "Failed to save mobile layout mode",
                                    error,
                                  );
                                }
                              }
                            }}
                          />
                          <div>
                            <span className="logs-page__settings-option-label">
                              Compact Table
                            </span>
                            <span className="logs-page__settings-option-description">
                              Table with fewer columns (Status, Domain, Client,
                              Time). Best for quick scanning on smaller screens.
                            </span>
                          </div>
                        </label>
                        <label className="logs-page__settings-option logs-page__settings-option--radio">
                          <input
                            type="radio"
                            name="mobileLayoutMode"
                            value="card-view"
                            checked={mobileLayoutMode === "card-view"}
                            onChange={(e) => {
                              const mode = e.target.value as MobileLayoutMode;
                              setMobileLayoutMode(mode);
                              if (typeof window !== "undefined") {
                                try {
                                  window.localStorage.setItem(
                                    MOBILE_LAYOUT_MODE_KEY,
                                    mode,
                                  );
                                } catch (error) {
                                  console.warn(
                                    "Failed to save mobile layout mode",
                                    error,
                                  );
                                }
                              }
                            }}
                          />
                          <div>
                            <span className="logs-page__settings-option-label">
                              Card View
                            </span>
                            <span className="logs-page__settings-option-description">
                              Touch-friendly cards with swipe gestures
                              (swipe-left: Block/Allow, swipe-right: Select).
                              Best for detailed viewing.
                            </span>
                          </div>
                        </label>
                      </div>

                      <header style={{ marginTop: "2rem" }}>
                        <h3>Paginated Settings</h3>
                        <p>Configure page size for paginated browsing.</p>
                      </header>
                      <div className="logs-page__settings-options">
                        <label className="logs-page__settings-option">
                          <div style={{ width: "100%" }}>
                            <span className="logs-page__settings-option-label">
                              Rows per page
                            </span>
                            <select
                              value={paginatedRowsPerPage}
                              onChange={(e) =>
                                handlePaginatedRowsPerPageChange(
                                  Number(e.target.value),
                                )
                              }
                              style={{
                                marginTop: "0.5rem",
                                padding: "0.5rem",
                                borderRadius: "0.5rem",
                                border: "1px solid #dce3ee",
                                width: "100%",
                              }}
                            >
                              {PAGINATED_ROWS_PER_PAGE_OPTIONS.map((value) => (
                                <option key={value} value={value}>
                                  {value}
                                </option>
                              ))}
                            </select>
                            <span className="logs-page__settings-option-description">
                              Applies to Paginated mode only. Changing this will
                              reset to page 1.
                            </span>
                          </div>
                        </label>
                      </div>

                      <header style={{ marginTop: "2rem" }}>
                        <h3>Live Tail Settings</h3>
                        <p>Configure the buffer size for live tail mode.</p>
                      </header>
                      <div className="logs-page__settings-options">
                        <label className="logs-page__settings-option">
                          <div style={{ width: "100%" }}>
                            <span className="logs-page__settings-option-label">
                              Buffer Size
                            </span>
                            <select
                              value={tailBufferSize}
                              onChange={(e) =>
                                handleTailBufferSizeChange(
                                  Number(e.target.value),
                                )
                              }
                              style={{
                                marginTop: "0.5rem",
                                padding: "0.5rem",
                                borderRadius: "0.5rem",
                                border: "1px solid #dce3ee",
                                width: "100%",
                              }}
                            >
                              {TAIL_BUFFER_SIZE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <span className="logs-page__settings-option-description">
                              Maximum number of entries to keep in memory during
                              live tail mode.
                            </span>
                          </div>
                        </label>
                      </div>
                    </section>
                  </>
                )}
              </div>
              <div
                className={`logs-page__refresh-indicator ${loadingState === "refreshing" ? "visible" : "hidden"}`}
              >
                Refreshing…
              </div>
            </div>
          </div>
        </div>

        {/* Conditionally render table or cards based on mobile layout mode */}
        {
          mobileLayoutMode === "card-view" && window.innerWidth < 768 ?
            // Card view for mobile
            <div
              className={`logs-page__cards-wrapper ${loadingState === "refreshing" ? "refreshing" : ""}`}
            >
              {renderCardsView(
                filteredEntries,
                selectedDomains,
                domainToGroupMap,
                domainGroupDetailsMap,
                toggleDomainSelection,
                handleStatusClick,
                handleClientClick,
                handleDomainClick,
                loadingState === "error" ? "idle" : loadingState,
                isFilteringActive,
                deduplicateDomains,
                columnVisibility,
                () => {
                  // Pause auto-refresh when user starts swiping on a card
                  setIsAutoRefresh(false);
                  setRefreshSeconds(0);
                },
              )}
            </div>
            // Table view (desktop or compact-table mode on mobile)
          : <div
              className={`logs-page__table-wrapper ${loadingState === "refreshing" ? "refreshing" : ""}`}
              onContextMenu={handleLogsTableContextMenu}
            >
              <table className="logs-page__table">
                <colgroup>
                  {activeColumns.map((column) => (
                    <col key={column.id} className={column.className} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {activeColumns.map((column) => {
                      if (column.id === "group-badge") {
                        return (
                          <th
                            key={column.id}
                            className="logs-page__header--group-badge"
                          ></th>
                        );
                      }
                      if (column.id === "select") {
                        const allSelected =
                          filteredEntries.length > 0 &&
                          selectedDomains.size === filteredEntries.length;
                        const someSelected =
                          selectedDomains.size > 0 &&
                          selectedDomains.size < filteredEntries.length;
                        return (
                          <th
                            key={column.id}
                            className="logs-page__header--select"
                          >
                            <input
                              id="logs-select-all"
                              name="selectAll"
                              type="checkbox"
                              checked={allSelected}
                              ref={(input) => {
                                if (input) {
                                  input.indeterminate = someSelected;
                                }
                              }}
                              onChange={toggleSelectAll}
                              aria-label="Select all domains"
                              title={
                                allSelected ? "Deselect all"
                                : someSelected ?
                                  "Select all"
                                : "Select all"
                              }
                            />
                          </th>
                        );
                      }
                      return <th key={column.id}>{column.label}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {loadingState === "loading" ?
                    <tr>
                      <td
                        colSpan={activeColumns.length || 1}
                        className="logs-page__loading"
                      >
                        Loading query logs…
                      </td>
                    </tr>
                  : filteredEntries.length === 0 ?
                    <tr>
                      <td
                        colSpan={activeColumns.length || 1}
                        className="logs-page__empty"
                      >
                        {isFilteringActive ?
                          "No log entries match the current filters."
                        : "No log entries found for the selected view."}
                      </td>
                    </tr>
                    // Render only first 50 visible rows instead of all (virtualization will come later)
                    // This is a quick fix until we refactor to use div-based virtualized table
                  : filteredEntries
                      .slice(0, 50)
                      .map((entry) => (
                        <LogTableRow
                          key={`${entry.nodeId}-${entry.rowNumber}-${entry.timestamp}`}
                          entry={entry}
                          activeColumns={activeColumns}
                          selectedDomains={selectedDomains}
                          domainToGroupMap={domainToGroupMap}
                          newEntryTimestamps={newEntryTimestamps}
                          isEntryBlocked={isEntryBlocked}
                        />
                      ))
                  }
                </tbody>
              </table>

              {logsTableContextMenu ?
                <div
                  className="logs-page__context-menu-overlay"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    closeLogsTableContextMenu();
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    closeLogsTableContextMenu();
                  }}
                >
                  <div
                    ref={logsTableContextMenuRef}
                    className="logs-page__context-menu"
                    style={{
                      left: logsTableContextMenu.x,
                      top: logsTableContextMenu.y,
                    }}
                    role="menu"
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    {logsTableContextMenu.items.map((item) => (
                      <button
                        key={`${item.label}-${item.action === "copy" ? item.value : item.href}`}
                        type="button"
                        className="logs-page__context-menu-item"
                        onClick={() => handleContextMenuAction(item)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              : null}
            </div>

        }

        {mode === "combined" && combinedNodeSnapshots.length > 0 ?
          <section className="logs-page__nodes">
            <h2>Node snapshots</h2>
            <ul>
              {combinedNodeSnapshots.map(
                (snapshot: TechnitiumCombinedNodeLogSnapshot) => (
                  <li key={snapshot.nodeId}>
                    <strong>{snapshot.nodeId}</strong> —{" "}
                    {snapshot.error ?
                      `error: ${snapshot.error}`
                    : `${snapshot.totalEntries?.toLocaleString() ?? "0"} entries across ${snapshot.totalPages ?? 0} pages`
                    }{" "}
                    (fetched {new Date(snapshot.fetchedAt).toLocaleString()})
                  </li>
                ),
              )}
            </ul>
          </section>
        : null}

        {blockDialog || bulkAction ?
          <div
            className="logs-page__modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeBlockDialog();
              }
            }}
          >
            <div className="logs-page__modal-content">
              <header className="logs-page__modal-header">
                <h2>
                  {bulkAction ?
                    `Bulk ${bulkAction === "block" ? "Block" : "Allow"} Domains`
                  : modalTitle}
                </h2>
                <button
                  type="button"
                  className="logs-page__modal-close"
                  onClick={closeBlockDialog}
                >
                  Close
                </button>
              </header>
              <div className="logs-page__modal-body">
                {bulkAction ?
                  <>
                    <p>
                      {bulkAction === "block" ? "Block" : "Allow"}{" "}
                      <strong>
                        {selectedDomains.size} domain
                        {selectedDomains.size !== 1 ? "s" : ""}
                      </strong>{" "}
                      in Advanced Blocking groups across all nodes.
                    </p>
                    <section className="logs-page__modal-summary">
                      <h3 className="logs-page__modal-summary-title">
                        Selected domains
                      </h3>
                      <ul className="logs-page__modal-summary-list logs-page__bulk-domain-list">
                        {Array.from(selectedDomains).map((domain) => {
                          const groupNumber = domainToGroupMap.get(domain);
                          const colorIndex =
                            groupNumber ? (groupNumber - 1) % 10 : 0;
                          return (
                            <li
                              key={domain}
                              className="logs-page__bulk-domain-item"
                            >
                              {groupNumber && (
                                <span
                                  className={`logs-page__modal-badge logs-page__modal-badge--color-${colorIndex}`}
                                >
                                  {groupNumber}
                                </span>
                              )}
                              <span className="logs-page__bulk-domain-text">
                                {domain}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  </>
                : <>
                    <p>
                      {isBlockedEntry ?
                        "Adjust Advanced Blocking groups for"
                      : "Add"}{" "}
                      <strong>{blockDomainValue || "Unknown domain"}</strong>{" "}
                      {isBlockedEntry ? "on" : "to Advanced Blocking on"} node{" "}
                      <strong>{blockNodeLabel}</strong>.
                    </p>
                    {isBlockedEntry && blockCoverage.length > 0 ?
                      <section className="logs-page__modal-summary">
                        <h3 className="logs-page__modal-summary-title">
                          Current coverage
                        </h3>
                        <ul className="logs-page__modal-summary-list">
                          {blockCoverage.map((entry) => (
                            <li key={`${entry.name}-${entry.description}`}>
                              <span className="logs-page__modal-summary-group">
                                {entry.name}
                              </span>
                              <span className="logs-page__modal-summary-detail">
                                {entry.description}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    : null}
                    {isBlockedEntry && blockCoverage.length === 0 ?
                      <div className="logs-page__modal-notice">
                        <strong>Blocked via downloaded list</strong>
                        <p>
                          Technitium DNS marked this query as blocked, but none
                          of your manual overrides include the domain. It is
                          likely coming from an external block list feed or an
                          upstream integration. Select a group and save to add
                          an explicit override.
                        </p>
                      </div>
                    : null}
                    {blockDomainValue ?
                      <>
                        <div className="logs-page__modal-action-toggle">
                          <span className="logs-page__modal-action-label">
                            Action
                          </span>
                          <div className="logs-page__modal-action-buttons">
                            <button
                              type="button"
                              className={
                                blockingAction === "block" ?
                                  "toggle-button active"
                                : "toggle-button"
                              }
                              onClick={() => handleActionChange("block")}
                              disabled={isBlocking}
                              aria-pressed={blockingAction === "block"}
                            >
                              Block
                            </button>
                            <button
                              type="button"
                              className={
                                blockingAction === "allow" ?
                                  "toggle-button active"
                                : "toggle-button"
                              }
                              onClick={() => handleActionChange("allow")}
                              disabled={isBlocking}
                              aria-pressed={blockingAction === "allow"}
                            >
                              Allow
                            </button>
                          </div>
                        </div>
                        <fieldset className="logs-page__modal-mode">
                          <legend>
                            {blockingAction === "allow" ?
                              "Allow method"
                            : "Block method"}
                          </legend>
                          <label className="logs-page__modal-mode-option">
                            <input
                              type="radio"
                              name="block-mode"
                              value="exact"
                              checked={blockMode === "exact"}
                              onChange={() => setBlockMode("exact")}
                            />
                            <div>
                              <span className="logs-page__modal-mode-title">
                                Exact domain
                              </span>
                              <span className="logs-page__modal-mode-detail">
                                {blockDomainValue}
                              </span>
                            </div>
                          </label>
                          <label className="logs-page__modal-mode-option">
                            <input
                              type="radio"
                              name="block-mode"
                              value="regex"
                              checked={blockMode === "regex"}
                              onChange={() => {
                                setBlockMode("regex");
                                if (blockRegexValue.trim().length === 0) {
                                  setBlockRegexValue(
                                    buildDefaultRegexPattern(blockDomainValue),
                                  );
                                }
                              }}
                            />
                            <div>
                              <span className="logs-page__modal-mode-title">
                                Regex pattern
                              </span>
                              <span className="logs-page__modal-mode-description">
                                Prefills a regex pattern to match this domain
                                and its subdomains.
                              </span>
                              <input
                                type="text"
                                className="logs-page__modal-mode-input"
                                value={blockRegexValue}
                                onChange={(event) =>
                                  setBlockRegexValue(event.target.value)
                                }
                                disabled={blockMode !== "regex"}
                              />
                            </div>
                          </label>
                        </fieldset>
                      </>
                    : null}
                  </>
                }
                {availableGroupsForSelection.length === 0 ?
                  <p className="logs-page__modal-empty">
                    No Advanced Blocking groups are available
                    {bulkAction ? "" : " for this node"}.
                  </p>
                : <fieldset className="logs-page__modal-groups">
                    <legend>
                      Select groups
                      {bulkAction ? " (will apply to all nodes)" : ""}
                    </legend>
                    <div className="logs-page__modal-group-actions">
                      <button
                        type="button"
                        onClick={handleSelectAllGroups}
                        className="logs-page__modal-link"
                      >
                        All
                      </button>
                      <span aria-hidden="true">·</span>
                      <button
                        type="button"
                        onClick={handleSelectNoGroups}
                        className="logs-page__modal-link"
                      >
                        None
                      </button>
                    </div>
                    {availableGroupsForSelection.map((group) => {
                      const isSelected = blockSelectedGroups.has(group.name);
                      const overrides =
                        blockDomainValue ?
                          extractGroupOverrides(group, blockDomainValue)
                        : undefined;
                      const trimmedRegex = blockRegexValue.trim();
                      const pendingRegex =
                        trimmedRegex || defaultRegexSuggestion;
                      const hasBlockOverride = Boolean(
                        overrides?.blockedExact ||
                        (overrides && overrides.blockedRegexMatches.length > 0),
                      );
                      const hasAllowOverride = Boolean(
                        overrides?.allowedExact ||
                        (overrides && overrides.allowedRegexMatches.length > 0),
                      );
                      const firstBlockRegex = overrides?.blockedRegexMatches[0];
                      const firstAllowRegex = overrides?.allowedRegexMatches[0];

                      let detailMessage: string;

                      if (blockingAction === "block") {
                        if (hasBlockOverride) {
                          detailMessage =
                            overrides?.blockedExact ?
                              "Currently blocked via exact match"
                            : `Currently blocked via regex ${firstBlockRegex ?? "(regex)"}`;
                        } else if (hasAllowOverride) {
                          detailMessage =
                            overrides?.allowedExact ?
                              "Currently allowed via exact override"
                            : `Currently allowed via regex ${firstAllowRegex ?? "(regex)"}`;
                        } else {
                          detailMessage =
                            isBlockedEntry ?
                              "No local override; blocked via list"
                            : "No local override yet";
                        }

                        if (!isSelected && hasBlockOverride) {
                          detailMessage = `${detailMessage} — will remove on save`;
                        } else if (isSelected && !hasBlockOverride) {
                          detailMessage =
                            blockMode === "regex" ?
                              pendingRegex ? `Will add regex ${pendingRegex}`
                              : "Will add regex pattern"
                            : "Will add exact match";
                        }
                      } else {
                        if (hasAllowOverride) {
                          detailMessage =
                            overrides?.allowedExact ?
                              "Currently allowed via exact override"
                            : `Currently allowed via regex ${firstAllowRegex ?? "(regex)"}`;
                        } else if (hasBlockOverride) {
                          detailMessage =
                            overrides?.blockedExact ?
                              "Currently blocked via exact match"
                            : `Currently blocked via regex ${firstBlockRegex ?? "(regex)"}`;
                        } else {
                          detailMessage = "No local override yet";
                        }

                        if (!isSelected && hasAllowOverride) {
                          detailMessage = `${detailMessage} — will remove on save`;
                        } else if (isSelected && !hasAllowOverride) {
                          detailMessage =
                            blockMode === "regex" ?
                              pendingRegex ?
                                `Will add allow regex ${pendingRegex}`
                              : "Will add regex allow override"
                            : "Will add exact allow override";
                        }
                      }

                      return (
                        <label
                          key={group.name}
                          className="logs-page__modal-group"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleBlockGroup(group.name)}
                          />
                          <div className="logs-page__modal-group-label">
                            <span className="logs-page__modal-group-name">
                              {group.name}
                            </span>
                            <span className="logs-page__modal-group-detail">
                              {detailMessage}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </fieldset>
                }
                {blockError ?
                  <div className="logs-page__modal-error">{blockError}</div>
                : null}
              </div>
              <footer className="logs-page__modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={closeBlockDialog}
                  disabled={isBlocking}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={
                    bulkAction ? handleConfirmBulkAction : handleConfirmBlock
                  }
                  disabled={
                    isBlocking ||
                    (bulkAction ? false : blockAvailableGroups.length === 0)
                  }
                >
                  {bulkAction ?
                    isBlocking ?
                      "Applying..."
                    : `${bulkAction === "block" ? "Block" : "Allow"} ${selectedDomains.size} Domains`

                  : confirmButtonLabel}
                </button>
              </footer>
            </div>
          </div>
        : null}

        {/* Floating Live Toggle - Only show in tail mode */}
        {displayMode === "tail" && (
          <FloatingLiveToggle
            isLive={refreshSeconds > 0}
            refreshSeconds={refreshSeconds}
            pausedTitle={
              endDate.trim().length > 0 ?
                "Paused because End Date/Time is set. Clear it to resume."
              : logsTableContextMenu ?
                "Paused while the context menu is open."
              : undefined
            }
            onToggle={(event) => {
              event.preventDefault();
              event.stopPropagation();

              const savedScrollY = window.scrollY;

              if (event.currentTarget instanceof HTMLElement) {
                event.currentTarget.blur();
              }

              if (refreshSeconds > 0) {
                setRefreshSeconds(0);
              } else {
                setRefreshSeconds(TAIL_MODE_DEFAULT_REFRESH);
              }

              requestAnimationFrame(() => {
                window.scrollTo(0, savedScrollY);
              });
            }}
          />
        )}
      </section>
    </>
  );
}

export default LogsPage;
