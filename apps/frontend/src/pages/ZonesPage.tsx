import { faHourglassHalf, faRotate } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PullToRefreshIndicator } from "../components/common/PullToRefreshIndicator";
import { ZonesPageSkeleton } from "../components/zones/ZonesPageSkeleton";
import { useTechnitiumState } from "../context/TechnitiumContext";
import { useToast } from "../context/ToastContext";
import { useIsClusterEnabled } from "../hooks/usePrimaryNode";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import type {
  TechnitiumCombinedZoneOverview,
  TechnitiumCombinedZoneRecordsOverview,
  TechnitiumZoneComparison,
  TechnitiumZoneNodeState,
  TechnitiumZoneRecord,
  TechnitiumZoneStatus,
} from "../types/zones";
import "./ZonesPage.css";

const NODE_ACCENT_PALETTE_SIZE = 20;

const hashStringToPositiveInt = (value: string) => {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return hash >>> 0;
};

const nodeIdToAccentClass = (nodeId: string) => {
  const index = hashStringToPositiveInt(nodeId) % NODE_ACCENT_PALETTE_SIZE;
  return `zones-page__zone-node--accent-${index}`;
};

type LoadState = "idle" | "loading" | "refreshing" | "error";
type ZoneFilter = "all" | TechnitiumZoneStatus;

type ZoneSummary = {
  total: number;
  inSync: number;
  different: number;
  missing: number;
  unknown: number;
};

const STATUS_LABELS: Record<TechnitiumZoneStatus, string> = {
  "in-sync": "In Sync",
  different: "Different",
  missing: "Missing",
  unknown: "Unknown",
};

const STATUS_BADGE_CLASS: Record<TechnitiumZoneStatus, string> = {
  "in-sync": "badge badge--success",
  different: "badge badge--error",
  missing: "badge badge--warning",
  unknown: "badge badge--muted",
};

const toZoneKey = (zone: TechnitiumZoneComparison) => zone.name || "(root)";

const formatTimestamp = (value?: string) => {
  if (!value) {
    return "—";
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
};

const describeBoolean = (value?: boolean) => {
  if (value === undefined) {
    return undefined;
  }

  return value ? "Yes" : "No";
};

const collectDetails = (node: TechnitiumZoneNodeState) => {
  if (!node.zone) {
    return [] as Array<{ label: string; value: string }>;
  }

  const details: Array<{ label: string; value: string }> = [];
  const { zone } = node;

  if (zone.type) {
    details.push({ label: "Type", value: zone.type });
  }

  if (
    zone.primaryNameServerAddresses &&
    zone.primaryNameServerAddresses.length > 0
  ) {
    details.push({
      label: "Primary Name Server",
      value: zone.primaryNameServerAddresses.join(", "),
    });
  }

  if (zone.dnssecStatus) {
    details.push({ label: "DNSSEC", value: zone.dnssecStatus });
  }

  if (zone.soaSerial !== undefined) {
    details.push({ label: "SOA Serial", value: zone.soaSerial.toString() });
  }

  if (zone.lastModified) {
    details.push({
      label: "Last Modified",
      value: formatTimestamp(zone.lastModified),
    });
  }

  const disabled = describeBoolean(zone.disabled);
  if (disabled) {
    details.push({ label: "Disabled", value: disabled });
  }

  const syncFailed = describeBoolean(zone.syncFailed);
  if (syncFailed) {
    details.push({ label: "Sync Failed", value: syncFailed });
  }

  const notifyFailed = describeBoolean(zone.notifyFailed);
  if (notifyFailed) {
    details.push({ label: "Notify Failed", value: notifyFailed });
  }

  if (zone.expiry) {
    details.push({ label: "Expiry", value: formatTimestamp(zone.expiry) });
  }

  const expired = describeBoolean(zone.isExpired);
  if (expired) {
    details.push({ label: "Expired", value: expired });
  }

  if (zone.notifyFailedFor && zone.notifyFailedFor.length > 0) {
    details.push({
      label: "Notify Targets",
      value: zone.notifyFailedFor.join(", "),
    });
  }

  if (zone.queryAccess) {
    details.push({ label: "Query Access", value: zone.queryAccess });
  }

  if (zone.queryAccessNetworkACL && zone.queryAccessNetworkACL.length > 0) {
    details.push({
      label: "Query Access ACL",
      value: zone.queryAccessNetworkACL.join(", "),
    });
  }

  if (zone.zoneTransfer) {
    details.push({ label: "Zone Transfer", value: zone.zoneTransfer });
  }

  if (zone.notify) {
    details.push({ label: "Notify", value: zone.notify });
  }

  if (zone.notifyNameServers && zone.notifyNameServers.length > 0) {
    details.push({
      label: "Notify Servers",
      value: zone.notifyNameServers.join(", "),
    });
  }

  if (zone.zoneTransferNetworkACL && zone.zoneTransferNetworkACL.length > 0) {
    details.push({
      label: "Zone Transfer ACL",
      value: zone.zoneTransferNetworkACL.join(", "),
    });
  }

  if (
    zone.zoneTransferTsigKeyNames &&
    zone.zoneTransferTsigKeyNames.length > 0
  ) {
    details.push({
      label: "Zone Transfer TSIG Keys",
      value: zone.zoneTransferTsigKeyNames.join(", "),
    });
  }

  return details;
};

type ZoneRecordsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: TechnitiumCombinedZoneRecordsOverview }
  | { status: "error"; error: string };

const recordMatchesQuery = (record: TechnitiumZoneRecord, query: string) => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const name = (record.name ?? "").toLowerCase();
  const type = normalizeRecordType(record.type).toLowerCase();

  if (name.includes(normalized) || type.includes(normalized)) {
    return true;
  }

  const rData: unknown = (record as { rData?: unknown }).rData;
  if (rData === null || rData === undefined) {
    return false;
  }

  if (typeof rData === "string") {
    return rData.toLowerCase().includes(normalized);
  }

  try {
    return JSON.stringify(rData).toLowerCase().includes(normalized);
  } catch {
    return String(rData).toLowerCase().includes(normalized);
  }
};

const SYSTEM_RECORD_TYPES = new Set([
  "SOA",
  "NS",
  // DNSSEC-related types and typical system-managed records
  "RRSIG",
  "DNSKEY",
  "NSEC",
  "NSEC3",
  "NSEC3PARAM",
  "DS",
]);

const normalizeRecordType = (value?: string) =>
  (value || "").trim().toUpperCase();

const isUserCreatedRecord = (record: TechnitiumZoneRecord) => {
  const type = normalizeRecordType(record.type);
  if (!type) {
    return false;
  }

  return !SYSTEM_RECORD_TYPES.has(type);
};

type RecordDataFormat = "auto" | "raw" | "pretty" | "parsed";

const RECORD_DATA_FORMAT_STORAGE_KEY = "zonesPage.recordDataFormat";

const loadRecordDataFormatPreference = (): RecordDataFormat => {
  if (typeof window === "undefined") {
    return "auto";
  }

  try {
    const value = window.localStorage.getItem(RECORD_DATA_FORMAT_STORAGE_KEY);
    if (
      value === "auto" ||
      value === "raw" ||
      value === "pretty" ||
      value === "parsed"
    ) {
      return value;
    }
  } catch {
    // Ignore storage errors (private mode, disabled storage, etc.)
  }

  return "auto";
};

const tryParseJsonString = (value: string): unknown | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  // Only attempt parse for JSON-looking strings to avoid surprises.
  const looksLikeJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksLikeJson) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
};

const deepParseJsonStrings = (value: unknown, depth: number): unknown => {
  if (depth <= 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = tryParseJsonString(value);
    if (parsed !== undefined) {
      return deepParseJsonStrings(parsed, depth - 1);
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => deepParseJsonStrings(entry, depth - 1));
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<
      Record<string, unknown>
    >((acc, [key, entryValue]) => {
      acc[key] = deepParseJsonStrings(entryValue, depth - 1);
      return acc;
    }, {});
  }

  return value;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const formatScalarForParsed = (value: unknown) => {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "—";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const toParsedLines = (
  value: unknown,
  options?: {
    indent?: string;
    maxDepth?: number;
    parseNestedJsonStrings?: boolean;
  },
): string[] => {
  const indent = options?.indent ?? "";
  const maxDepth = options?.maxDepth ?? 2;
  const parseNestedJsonStrings = options?.parseNestedJsonStrings ?? false;

  if (parseNestedJsonStrings && typeof value === "string") {
    const parsed = tryParseJsonString(value);
    if (parsed !== undefined) {
      return toParsedLines(parsed, {
        indent,
        maxDepth,
        parseNestedJsonStrings,
      });
    }
  }

  if (value === null || value === undefined) {
    return [`${indent}—`];
  }

  if (Array.isArray(value)) {
    if (maxDepth <= 0) {
      return [`${indent}[…]`];
    }

    if (value.length === 0) {
      return [`${indent}[]`];
    }

    return value.flatMap((entry, index) => {
      const prefix = `${indent}${index}: `;
      if (entry && typeof entry === "object") {
        return [
          `${prefix}`.trimEnd(),
          ...toParsedLines(entry, {
            indent: `${indent}  `,
            maxDepth: maxDepth - 1,
            parseNestedJsonStrings,
          }),
        ];
      }

      return [`${prefix}${formatScalarForParsed(entry)}`];
    });
  }

  if (typeof value === "object") {
    if (maxDepth <= 0) {
      return [`${indent}{…}`];
    }

    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    if (entries.length === 0) {
      return [`${indent}{}`];
    }

    return entries.flatMap(([key, entryValue]) => {
      const nested =
        parseNestedJsonStrings && typeof entryValue === "string" ?
          tryParseJsonString(entryValue)
        : undefined;

      const effectiveValue = nested !== undefined ? nested : entryValue;
      const label = `${indent}${key}:`;

      if (effectiveValue && typeof effectiveValue === "object") {
        return [
          label,
          ...toParsedLines(effectiveValue, {
            indent: `${indent}  `,
            maxDepth: maxDepth - 1,
            parseNestedJsonStrings,
          }),
        ];
      }

      return [`${label} ${formatScalarForParsed(effectiveValue)}`];
    });
  }

  return [`${indent}${formatScalarForParsed(value)}`];
};

const formatRecordData = (
  record: TechnitiumZoneRecord,
  mode: RecordDataFormat,
) => {
  const rData = record.rData;
  if (rData === null || rData === undefined) {
    return "—";
  }

  if (mode === "raw") {
    if (typeof rData === "string") {
      return rData;
    }

    try {
      return JSON.stringify(rData);
    } catch {
      return String(rData);
    }
  }

  if (mode === "auto") {
    if (typeof rData === "string") {
      return rData;
    }

    if (isPlainObject(rData)) {
      const entries = Object.entries(rData);
      if (entries.length === 1) {
        const [key, value] = entries[0];
        const isPrimitive =
          value === null ||
          value === undefined ||
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean";

        const isJsonLookingString =
          typeof value === "string" && tryParseJsonString(value) !== undefined;
        const isShortString =
          typeof value === "string" ? value.length <= 96 : true;

        if (isPrimitive && !isJsonLookingString && isShortString) {
          return `${key}: ${formatScalarForParsed(value)}`;
        }
      }
    }

    try {
      const compact = JSON.stringify(rData);
      const looksOverEscaped =
        compact.includes("\\n") ||
        compact.includes("\\t") ||
        compact.includes('\\"');

      // Auto should stay compact for small/simple shapes so it differs
      // meaningfully from Parsed. Switch to parsed only for cases where
      // compact JSON tends to be hard to read.
      const keyCount = isPlainObject(rData) ? Object.keys(rData).length : 0;
      const hasNestedObjects =
        isPlainObject(rData) &&
        Object.values(rData).some(
          (value) =>
            Boolean(value) &&
            (Array.isArray(value) || typeof value === "object"),
        );

      const preferParsed =
        looksOverEscaped ||
        Array.isArray(rData) ||
        hasNestedObjects ||
        compact.length > 240 ||
        keyCount > 6;

      if (preferParsed) {
        return toParsedLines(rData, {
          maxDepth: 4,
          parseNestedJsonStrings: true,
        }).join("\n");
      }

      return compact;
    } catch {
      return toParsedLines(rData, {
        maxDepth: 4,
        parseNestedJsonStrings: true,
      }).join("\n");
    }
  }

  if (mode === "pretty") {
    if (typeof rData === "string") {
      const parsed = tryParseJsonString(rData);
      if (parsed !== undefined) {
        try {
          return JSON.stringify(deepParseJsonStrings(parsed, 2), null, 2);
        } catch {
          return rData;
        }
      }

      return rData;
    }

    try {
      return JSON.stringify(deepParseJsonStrings(rData, 2), null, 2);
    } catch {
      return String(rData);
    }
  }

  // mode === "parsed"
  if (typeof rData === "string") {
    const parsed = tryParseJsonString(rData);
    if (parsed !== undefined) {
      return toParsedLines(parsed, {
        maxDepth: 4,
        parseNestedJsonStrings: true,
      }).join("\n");
    }

    return rData;
  }

  return toParsedLines(rData, {
    maxDepth: 4,
    parseNestedJsonStrings: true,
  }).join("\n");
};

const KEY_VALUE_LINE_REGEX = /^(\s*)([^:\n]+):\s(.+)$/;

const renderRecordData = (
  record: TechnitiumZoneRecord,
  mode: RecordDataFormat,
) => {
  const formatted = formatRecordData(record, mode);
  const lines = formatted.split("\n");

  return (
    <>
      {lines.map((line, index) => {
        const match = KEY_VALUE_LINE_REGEX.exec(line);
        const showNewline = index < lines.length - 1;

        if (!match) {
          return (
            <span key={`${index}-${line}`}>
              {line}
              {showNewline ? "\n" : null}
            </span>
          );
        }

        const [, indent, key, value] = match;
        return (
          <span key={`${index}-${indent}-${key}`}>
            {indent}
            <span className="zones-page__record-data-key">{key}: </span>
            <span className="zones-page__record-data-value">{value}</span>
            {showNewline ? "\n" : null}
          </span>
        );
      })}
    </>
  );
};

export function ZonesPage() {
  const { nodes, loadCombinedZones, loadCombinedZoneRecords } =
    useTechnitiumState();
  const { pushToast } = useToast();
  const [overview, setOverview] = useState<
    TechnitiumCombinedZoneOverview | undefined
  >();
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [filter, setFilter] = useState<ZoneFilter>("different");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedMetaZoneKeys, setExpandedMetaZoneKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedRecordsZoneKeys, setExpandedRecordsZoneKeys] = useState<
    Set<string>
  >(() => new Set());
  const [zoneRecordsByKey, setZoneRecordsByKey] = useState<
    Record<string, ZoneRecordsState>
  >({});
  const [recordTypeFiltersByKey, setRecordTypeFiltersByKey] = useState<
    Record<string, string>
  >({});
  const [userCreatedOnlyByKey, setUserCreatedOnlyByKey] = useState<
    Record<string, boolean>
  >({});
  const [recordSearchQueryByKey, setRecordSearchQueryByKey] = useState<
    Record<string, string>
  >({});
  const [recordDataFormat, setRecordDataFormat] = useState<RecordDataFormat>(
    () => loadRecordDataFormatPreference(),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        RECORD_DATA_FORMAT_STORAGE_KEY,
        recordDataFormat,
      );
    } catch {
      // Ignore storage errors
    }
  }, [recordDataFormat]);

  const fetchOverview = useCallback(
    async (mode: "initial" | "refresh") => {
      setLoadState(mode === "refresh" ? "refreshing" : "loading");
      setErrorMessage(undefined);

      try {
        const data = await loadCombinedZones();
        setOverview(data);

        if (
          mode === "initial" &&
          data.zones.every((zone) => zone.status === "in-sync")
        ) {
          setFilter("all");
        }

        setLoadState("idle");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load zones.";
        setErrorMessage(message);
        pushToast({ message, tone: "error" });
        setLoadState("error");
      }
    },
    [loadCombinedZones, pushToast],
  );

  // Pull-to-refresh functionality
  const handlePullToRefresh = useCallback(async () => {
    await fetchOverview("refresh");
  }, [fetchOverview]);

  const pullToRefresh = usePullToRefresh({
    onRefresh: handlePullToRefresh,
    threshold: 80,
    disabled: false,
  });

  useEffect(() => {
    void fetchOverview("initial");
  }, [fetchOverview]);

  const summary: ZoneSummary = useMemo(() => {
    if (!overview) {
      return { total: 0, inSync: 0, different: 0, missing: 0, unknown: 0 };
    }

    const result: ZoneSummary = {
      total: overview.zoneCount,
      inSync: 0,
      different: 0,
      missing: 0,
      unknown: 0,
    };

    overview.zones.forEach((zone) => {
      switch (zone.status) {
        case "in-sync":
          result.inSync += 1;
          break;
        case "different":
          result.different += 1;
          break;
        case "missing":
          result.missing += 1;
          break;
        case "unknown":
          result.unknown += 1;
          break;
        default:
          break;
      }
    });

    return result;
  }, [overview]);

  const filteredZones = useMemo(() => {
    if (!overview) {
      return [] as TechnitiumZoneComparison[];
    }

    const normalizedQuery = searchQuery.trim().toLowerCase();

    if (filter === "all") {
      if (!normalizedQuery) {
        return overview.zones;
      }

      return overview.zones.filter((zone) =>
        (zone.name || "(root)").toLowerCase().includes(normalizedQuery),
      );
    }

    const zones = overview.zones.filter((zone) => zone.status === filter);
    if (!normalizedQuery) {
      return zones;
    }

    return zones.filter((zone) =>
      (zone.name || "(root)").toLowerCase().includes(normalizedQuery),
    );
  }, [overview, filter, searchQuery]);

  const toggleZoneMeta = useCallback((zoneKey: string) => {
    setExpandedMetaZoneKeys((previous) => {
      const next = new Set(previous);

      if (next.has(zoneKey)) {
        next.delete(zoneKey);
      } else {
        next.add(zoneKey);
      }

      return next;
    });
  }, []);

  const toggleZoneRecords = useCallback(
    async (zoneKey: string, zoneName: string) => {
      setExpandedRecordsZoneKeys((previous) => {
        const next = new Set(previous);

        if (next.has(zoneKey)) {
          next.delete(zoneKey);
        } else {
          next.add(zoneKey);
        }

        return next;
      });

      const currentlyExpanded = expandedRecordsZoneKeys.has(zoneKey);
      if (currentlyExpanded) {
        return;
      }

      const existing = zoneRecordsByKey[zoneKey];
      if (existing?.status === "loading" || existing?.status === "loaded") {
        return;
      }

      setZoneRecordsByKey((previous) => ({
        ...previous,
        [zoneKey]: { status: "loading" },
      }));

      try {
        const data = await loadCombinedZoneRecords(zoneName);
        setZoneRecordsByKey((previous) => ({
          ...previous,
          [zoneKey]: { status: "loaded", data },
        }));
      } catch (error) {
        const message =
          error instanceof Error ?
            error.message
          : "Failed to load zone records.";
        setZoneRecordsByKey((previous) => ({
          ...previous,
          [zoneKey]: { status: "error", error: message },
        }));
        pushToast({ message, tone: "error" });
      }
    },
    [
      expandedRecordsZoneKeys,
      loadCombinedZoneRecords,
      pushToast,
      zoneRecordsByKey,
    ],
  );

  const nodeCount = overview?.nodes.length ?? 0;

  const summaryCards = useMemo(
    () => [
      {
        key: "total",
        label: "Total Zones",
        value: summary.total,
        caption:
          nodeCount === 1 ?
            "Modifiable across 1 node"
          : `Modifiable across ${nodeCount} nodes`,
      },
      {
        key: "different",
        label: "Differences",
        value: summary.different,
        caption: "Need review to reconcile",
      },
      {
        key: "missing",
        label: "Missing",
        value: summary.missing,
        caption: "Missing on at least one node",
      },
      {
        key: "in-sync",
        label: "In Sync",
        value: summary.inSync,
        caption: "Consistent across nodes",
      },
      {
        key: "unknown",
        label: "Unknown",
        value: summary.unknown,
        caption: "Unable to compare",
      },
    ],
    [summary, nodeCount],
  );

  const isClustered = useIsClusterEnabled(nodes);

  const nodeAccentClassById = useMemo(() => {
    const ids = new Set<string>();

    nodes.forEach((node) => {
      if (node.id) {
        ids.add(node.id);
      }
    });

    (overview?.nodes ?? []).forEach((node) => {
      if (node.nodeId) {
        ids.add(node.nodeId);
      }
    });

    (overview?.zones ?? []).forEach((zone) => {
      zone.nodes.forEach((node) => {
        if (node.nodeId) {
          ids.add(node.nodeId);
        }
      });
    });

    const orderedIds = Array.from(ids).sort((a, b) => a.localeCompare(b));

    if (orderedIds.length > NODE_ACCENT_PALETTE_SIZE) {
      console.warn(
        `ZonesPage: node color palette supports ${NODE_ACCENT_PALETTE_SIZE} distinct node ids; found ${orderedIds.length}. Colors will repeat.`,
      );
    }

    return orderedIds.reduce<Record<string, string>>((acc, id, index) => {
      acc[id] = `zones-page__zone-node--accent-${
        index % NODE_ACCENT_PALETTE_SIZE
      }`;
      return acc;
    }, {});
  }, [nodes, overview]);

  // Show skeleton while loading initial data
  if (loadState === "loading" && !overview) {
    return <ZonesPageSkeleton />;
  }

  return (
    <>
      <PullToRefreshIndicator
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
        isRefreshing={pullToRefresh.isRefreshing}
      />
      <div ref={pullToRefresh.containerRef} className="zones-page">
        <header className="zones-page__header">
          <div className="zones-page__header-content">
            <div className="zones-page__title-row">
              <div className="zones-page__title-group">
                <h1 className="zones-page__title">🌐 Authoritative Zones</h1>
                <p className="zones-page__subtitle">
                  {overview ?
                    `Tracking ${summary.total} zone${summary.total === 1 ? "" : "s"} across ${nodeCount} node${nodeCount === 1 ? "" : "s"}`
                  : isClustered ?
                    "Monitor authoritative zones across your Technitium DNS cluster."
                  : "Monitor authoritative zones across your Technitium DNS servers."
                  }
                </p>
              </div>
              <div className="zones-page__header-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => void fetchOverview("refresh")}
                  disabled={
                    loadState === "loading" || loadState === "refreshing"
                  }
                >
                  {loadState === "refreshing" ?
                    <>
                      <FontAwesomeIcon icon={faRotate} spin /> Refreshing…
                    </>
                  : loadState === "loading" ?
                    <>
                      <FontAwesomeIcon icon={faHourglassHalf} /> Loading…
                    </>
                  : <>
                      <FontAwesomeIcon icon={faRotate} /> Refresh
                    </>
                  }
                </button>
              </div>
            </div>
            <div className="zones-page__meta-row">
              <span className="zones-page__meta-info">
                🧭{" "}
                {nodeCount === 0 ?
                  "Waiting for node data"
                : nodeCount === 1 ?
                  "1 node connected"
                : `${nodeCount} ${isClustered ? "clustered" : "unclustered"} nodes connected`
                }
              </span>
              <span className="zones-page__meta-info">
                {overview ?
                  `Updated ${formatTimestamp(overview.fetchedAt)}`
                : "Collecting zone data…"}
              </span>
            </div>
            {errorMessage ?
              <p className="zones-page__error" role="status">
                {errorMessage}
              </p>
            : null}
          </div>
        </header>

        <section className="zones-page__overview">
          <ul className="zones-page__summary-grid" role="list">
            {summaryCards.map((card) => (
              <li key={card.key}>
                <button
                  type="button"
                  className={`zones-page__summary-card zones-page__summary-card--${card.key}${
                    (
                      filter === card.key ||
                      (card.key === "total" && filter === "all")
                    ) ?
                      " zones-page__summary-card--active"
                    : ""
                  }`}
                  onClick={() =>
                    setFilter(
                      card.key === "total" ? "all" : (card.key as ZoneFilter),
                    )
                  }
                  disabled={card.value === 0}
                >
                  <span className="zones-page__summary-card-label">
                    {card.label}
                  </span>
                  <span className="zones-page__summary-card-value">
                    {card.value}
                  </span>
                  <span className="zones-page__summary-card-caption">
                    {card.caption}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="zones-page__toolbar">
          <div className="zones-page__search">
            <label className="zones-page__search-label" htmlFor="zones-search">
              Search
            </label>
            <input
              id="zones-search"
              type="search"
              className="zones-page__search-input"
              placeholder="Search zones…"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          <div className="zones-page__result-count">
            Showing <strong>{filteredZones.length}</strong> of{" "}
            <strong>{summary.total}</strong> zones
          </div>
        </div>

        <div className="zones-page__list">
          {loadState === "loading" && filteredZones.length === 0 ?
            <div className="zones-page__empty">Collecting zone data…</div>
          : null}

          {loadState === "error" && filteredZones.length === 0 ?
            <div className="zones-page__empty">Unable to load zone data.</div>
          : null}

          {loadState !== "loading" && filteredZones.length === 0 && overview ?
            <div className="zones-page__empty">
              No zones match the current filter.
            </div>
          : null}

          {filteredZones.map((zone) => {
            const zoneKey = toZoneKey(zone);
            const isMetaExpanded = expandedMetaZoneKeys.has(zoneKey);
            const isRecordsExpanded = expandedRecordsZoneKeys.has(zoneKey);
            const recordsState = zoneRecordsByKey[zoneKey] ?? {
              status: "idle",
            };
            const canLoadRecords = Boolean(
              zone.name && zone.name.trim().length > 0,
            );

            const recordsAvailableTypes = (() => {
              if (recordsState.status !== "loaded") {
                return [] as string[];
              }

              const types = new Set<string>();
              recordsState.data.nodes.forEach((node) => {
                node.records?.forEach((record) => {
                  const type = normalizeRecordType(record.type);
                  if (type) {
                    types.add(type);
                  }
                });
              });

              return Array.from(types).sort((a, b) => a.localeCompare(b));
            })();

            const selectedRecordType = recordTypeFiltersByKey[zoneKey] ?? "all";
            const userCreatedOnly = userCreatedOnlyByKey[zoneKey] ?? false;
            const recordSearchQuery = recordSearchQueryByKey[zoneKey] ?? "";

            const applyRecordFilters = (records: TechnitiumZoneRecord[]) => {
              const filtered = records.filter((record) => {
                if (userCreatedOnly && !isUserCreatedRecord(record)) {
                  return false;
                }

                if (selectedRecordType !== "all") {
                  if (normalizeRecordType(record.type) !== selectedRecordType) {
                    return false;
                  }
                }

                if (recordSearchQuery.trim()) {
                  if (!recordMatchesQuery(record, recordSearchQuery)) {
                    return false;
                  }
                }

                return true;
              });

              return filtered;
            };

            return (
              <article
                key={`${zoneKey}-${zone.status}`}
                className="zones-page__zone-card"
              >
                <header className="zones-page__zone-header">
                  <h2 className="zones-page__zone-name">
                    {zone.name || "(root)"}
                  </h2>
                  <div className="zones-page__zone-header-actions">
                    <span className={STATUS_BADGE_CLASS[zone.status]}>
                      {STATUS_LABELS[zone.status]}
                    </span>
                    <button
                      type="button"
                      className="zones-page__zone-details-toggle"
                      aria-expanded={isMetaExpanded}
                      onClick={() => toggleZoneMeta(zoneKey)}
                    >
                      {isMetaExpanded ? "Hide meta" : "Show meta"}
                    </button>
                    <button
                      type="button"
                      className="zones-page__zone-details-toggle"
                      aria-expanded={isRecordsExpanded}
                      onClick={() =>
                        void toggleZoneRecords(zoneKey, zone.name ?? "")
                      }
                      disabled={!canLoadRecords}
                    >
                      {isRecordsExpanded ? "Hide records" : "Show records"}
                    </button>
                  </div>
                </header>
                {zone.differences && zone.differences.length > 0 ?
                  <div className="zones-page__differences">
                    {zone.differences.map((difference, index) => (
                      <span
                        key={`${difference}-${index}`}
                        className="badge badge--info"
                      >
                        {difference}
                      </span>
                    ))}
                  </div>
                : null}
                {!isMetaExpanded ?
                  <div
                    className="zones-page__zone-node-statuses"
                    aria-label="Node status summary"
                  >
                    {zone.nodes.map((node) => {
                      const badgeClass =
                        node.error ? "badge badge--error"
                        : node.zone ? "badge badge--success"
                        : "badge badge--warning";

                      const badgeLabel =
                        node.error ? "Error"
                        : node.zone ? "OK"
                        : "Missing";

                      return (
                        <span
                          key={node.nodeId}
                          className="zones-page__zone-node-status"
                        >
                          <span className="zones-page__zone-node-id">
                            {node.nodeId}
                          </span>
                          <span className={badgeClass}>{badgeLabel}</span>
                        </span>
                      );
                    })}
                  </div>
                : <div className="zones-page__zone-nodes">
                    {zone.nodes.map((node) => (
                      <section
                        key={node.nodeId}
                        className={`zones-page__zone-node ${
                          nodeAccentClassById[node.nodeId] ??
                          nodeIdToAccentClass(node.nodeId)
                        }`}
                      >
                        <div className="zones-page__zone-node-header">
                          <div className="zones-page__zone-node-title">
                            {node.nodeId}
                          </div>
                        </div>
                        {node.error ?
                          <div className="zones-page__zone-node-body">
                            <p className="zones-page__zone-node-error">
                              {node.error}
                            </p>
                          </div>
                        : null}
                        {!node.error && !node.zone ?
                          <div className="zones-page__zone-node-body">
                            <p className="zones-page__zone-node-missing">
                              Zone not present.
                            </p>
                          </div>
                        : null}
                        {!node.error && node.zone ?
                          <div className="zones-page__zone-node-body">
                            <div className="zones-page__details-grid">
                              {collectDetails(node).map((detail, index) => (
                                <div
                                  key={`${detail.label}-${index}`}
                                  className="zones-page__detail-item"
                                >
                                  <span className="zones-page__detail-label">
                                    {detail.label}
                                  </span>
                                  <span className="zones-page__detail-value">
                                    {detail.value}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        : null}
                      </section>
                    ))}
                  </div>
                }

                {isRecordsExpanded ?
                  <div className="zones-page__records">
                    <div className="zones-page__records-toolbar">
                      <div className="zones-page__records-controls">
                        <label className="zones-page__records-control zones-page__records-control--search">
                          <span className="zones-page__records-control-label">
                            Search
                          </span>
                          <div className="zones-page__records-search-field">
                            <input
                              type="search"
                              className="zones-page__records-search"
                              placeholder="Search records…"
                              value={recordSearchQuery}
                              onChange={(event) =>
                                setRecordSearchQueryByKey((previous) => ({
                                  ...previous,
                                  [zoneKey]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key !== "Escape") {
                                  return;
                                }

                                if (!recordSearchQuery.trim()) {
                                  return;
                                }

                                event.preventDefault();
                                setRecordSearchQueryByKey((previous) => ({
                                  ...previous,
                                  [zoneKey]: "",
                                }));
                              }}
                              disabled={recordsState.status !== "loaded"}
                            />
                            {recordSearchQuery.trim() ?
                              <button
                                type="button"
                                className="zones-page__records-search-clear"
                                onClick={() =>
                                  setRecordSearchQueryByKey((previous) => ({
                                    ...previous,
                                    [zoneKey]: "",
                                  }))
                                }
                                disabled={recordsState.status !== "loaded"}
                              >
                                Clear
                              </button>
                            : null}
                          </div>
                        </label>

                        <label className="zones-page__records-control">
                          <span className="zones-page__records-control-label">
                            Type
                          </span>
                          <select
                            className="zones-page__records-select"
                            value={selectedRecordType}
                            onChange={(event) =>
                              setRecordTypeFiltersByKey((previous) => ({
                                ...previous,
                                [zoneKey]: event.target.value,
                              }))
                            }
                            disabled={recordsState.status !== "loaded"}
                          >
                            <option value="all">All</option>
                            {recordsAvailableTypes.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="zones-page__records-control">
                          <span className="zones-page__records-control-label">
                            Data
                          </span>
                          <select
                            className="zones-page__records-select"
                            value={recordDataFormat}
                            onChange={(event) =>
                              setRecordDataFormat(
                                event.target.value as RecordDataFormat,
                              )
                            }
                          >
                            <option value="auto">Auto</option>
                            <option value="raw">Raw</option>
                            <option value="pretty">Pretty JSON</option>
                            <option value="parsed">Parsed</option>
                          </select>
                        </label>

                        <label className="zones-page__records-checkbox">
                          <input
                            type="checkbox"
                            checked={userCreatedOnly}
                            onChange={(event) =>
                              setUserCreatedOnlyByKey((previous) => ({
                                ...previous,
                                [zoneKey]: event.target.checked,
                              }))
                            }
                            disabled={recordsState.status !== "loaded"}
                          />
                          <span>User-created only</span>
                        </label>
                      </div>
                    </div>

                    {recordsState.status === "loading" ?
                      <div className="zones-page__records-empty">
                        Loading records…
                      </div>
                    : null}

                    {recordsState.status === "error" ?
                      <div className="zones-page__records-empty">
                        {recordsState.error}
                      </div>
                    : null}

                    {recordsState.status === "loaded" ?
                      <div className="zones-page__records-nodes">
                        {recordsState.data.nodes.map((node) => {
                          if (node.error) {
                            return (
                              <section
                                key={node.nodeId}
                                className="zones-page__records-node"
                              >
                                <div className="zones-page__records-node-header">
                                  <div className="zones-page__records-node-title">
                                    {node.nodeId}
                                  </div>
                                  <div className="zones-page__records-node-meta">
                                    {formatTimestamp(node.fetchedAt)}
                                  </div>
                                </div>
                                <div className="zones-page__records-empty">
                                  {node.error}
                                </div>
                              </section>
                            );
                          }

                          const records = applyRecordFilters(
                            node.records ?? [],
                          );
                          return (
                            <section
                              key={node.nodeId}
                              className="zones-page__records-node"
                            >
                              <div className="zones-page__records-node-header">
                                <div className="zones-page__records-node-title">
                                  {node.nodeId}
                                </div>
                                <div className="zones-page__records-node-meta">
                                  {formatTimestamp(node.fetchedAt)}
                                </div>
                              </div>
                              {records.length === 0 ?
                                <div className="zones-page__records-empty">
                                  No records match the filter.
                                </div>
                              : <div className="zones-page__records-table-wrapper">
                                  <table className="zones-page__records-table">
                                    <thead>
                                      <tr>
                                        <th>Name</th>
                                        <th>Type</th>
                                        <th>TTL</th>
                                        <th>Data</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {records.map((record, index) => (
                                        <tr
                                          key={`${record.name}-${record.type}-${index}`}
                                        >
                                          <td className="zones-page__records-cell-name">
                                            {record.name}
                                          </td>
                                          <td className="zones-page__records-cell-type">
                                            {normalizeRecordType(record.type)}
                                          </td>
                                          <td className="zones-page__records-cell-ttl">
                                            {record.ttl ?? "—"}
                                          </td>
                                          <td className="zones-page__records-cell-data">
                                            {renderRecordData(
                                              record,
                                              recordDataFormat,
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              }
                            </section>
                          );
                        })}
                      </div>
                    : null}
                  </div>
                : null}
              </article>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default ZonesPage;
