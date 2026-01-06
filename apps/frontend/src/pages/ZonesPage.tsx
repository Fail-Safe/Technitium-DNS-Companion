import {
  faClockRotateLeft,
  faHourglassHalf,
  faRotate,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmModal } from "../components/common/ConfirmModal";
import { PullToRefreshIndicator } from "../components/common/PullToRefreshIndicator";
import { ZoneSnapshotDrawer } from "../components/zones/ZoneSnapshotDrawer";
import { ZonesPageSkeleton } from "../components/zones/ZonesPageSkeleton";
import { apiFetch } from "../config";
import { useTechnitiumState } from "../context/TechnitiumContext";
import { useToast } from "../context/ToastContext";
import { useIsClusterEnabled, usePrimaryNode } from "../hooks/usePrimaryNode";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import type {
  SplitHorizonPtrApplyResponse,
  SplitHorizonPtrPreviewResponse,
  SplitHorizonPtrSourceZoneCandidate,
  SplitHorizonPtrSourceZonesResponse,
} from "../types/splitHorizonPtr";
import type {
  TechnitiumCombinedZoneOverview,
  TechnitiumCombinedZoneRecordsOverview,
  TechnitiumZoneComparison,
  TechnitiumZoneNodeState,
  TechnitiumZoneRecord,
  TechnitiumZoneStatus,
} from "../types/zones";
import { parseKeyValueLine } from "../utils/zoneRecordDataParsing";
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

const renderRecordData = (
  record: TechnitiumZoneRecord,
  mode: RecordDataFormat,
) => {
  const formatted = formatRecordData(record, mode);
  const lines = formatted.split("\n");

  return (
    <>
      {lines.map((line, index) => {
        const parsedKeyValue = parseKeyValueLine(line);
        const showNewline = index < lines.length - 1;

        if (!parsedKeyValue) {
          return (
            <span key={`${index}-${line}`}>
              {line}
              {showNewline ? "\n" : null}
            </span>
          );
        }

        const { indent, key, value } = parsedKeyValue;
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
  const {
    nodes,
    loadCombinedZones,
    loadCombinedZoneRecords,
    listZoneSnapshots,
    createZoneSnapshot,
    getZoneSnapshot,
    deleteZoneSnapshot,
    updateZoneSnapshotNote,
    setZoneSnapshotPinned,
    restoreZoneSnapshot,
  } = useTechnitiumState();
  const { pushToast } = useToast();

  const formatPtrOwnerFqdn = useCallback(
    (recordName: string, zoneName: string) => {
      const name = (recordName ?? "").trim();
      const zone = (zoneName ?? "").trim().replace(/\.$/, "");
      if (!zone) return name;
      if (!name || name === "@") return zone;
      return `${name}.${zone}`;
    },
    [],
  );

  const [ptrSourceZoneName, setPtrSourceZoneName] = useState("");
  const [ptrSourceZoneCandidates, setPtrSourceZoneCandidates] = useState<
    SplitHorizonPtrSourceZoneCandidate[]
  >([]);
  const [ptrSourceZoneCandidatesState, setPtrSourceZoneCandidatesState] =
    useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [ptrShowUnchanged, setPtrShowUnchanged] = useState(false);
  const [ptrSkipUnresolvedConflicts, setPtrSkipUnresolvedConflicts] =
    useState(true);
  const [ptrAdoptExistingPtrRecords, setPtrAdoptExistingPtrRecords] =
    useState(false);
  const [ptrSourceHostnameResolutions, setPtrSourceHostnameResolutions] =
    useState<Record<string, string>>({});
  const [ptrPreviewState, setPtrPreviewState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; data: SplitHorizonPtrPreviewResponse }
    | { status: "error"; error: string }
  >({ status: "idle" });
  const [ptrCatalogZoneName, setPtrCatalogZoneName] = useState<string>("");
  const [ptrApplyState, setPtrApplyState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "loaded"; data: SplitHorizonPtrApplyResponse }
    | { status: "error"; error: string }
  >({ status: "idle" });

  type ZonesPageTab = "zones" | "split-horizon";
  const [activeZonesTab, setActiveZonesTab] = useState<ZonesPageTab>("zones");
  const [splitHorizonInstalled, setSplitHorizonInstalled] =
    useState<boolean>(false);

  const [showSnapshotDrawer, setShowSnapshotDrawer] = useState(false);

  const [quickSnapshotModalOpen, setQuickSnapshotModalOpen] = useState(false);
  const [quickSnapshotZoneName, setQuickSnapshotZoneName] =
    useState<string>("");
  const [quickSnapshotNote, setQuickSnapshotNote] = useState<string>("");
  const [quickSnapshotSaving, setQuickSnapshotSaving] = useState(false);

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

  const runPtrPreview = useCallback(async () => {
    const zoneName = ptrSourceZoneName.trim();
    if (!zoneName) {
      pushToast({
        message: "Please enter a forward zone name.",
        tone: "error",
      });
      return;
    }

    setPtrPreviewState({ status: "loading" });
    setPtrApplyState({ status: "idle" });
    setPtrSourceHostnameResolutions({});

    try {
      const response = await apiFetch("/split-horizon/ptr/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zoneName,
          adoptExistingPtrRecords: ptrAdoptExistingPtrRecords,
        }),
      });

      if (!response.ok) {
        throw new Error(`Preview failed (${response.status})`);
      }

      const data = (await response.json()) as SplitHorizonPtrPreviewResponse;
      setPtrPreviewState({ status: "loaded", data });

      if (!data.catalogZones || data.catalogZones.length === 0) {
        setPtrCatalogZoneName("");
      }

      if (!data.splitHorizonInstalled) {
        pushToast({
          message:
            "Split Horizon app does not appear to be installed on the selected node.",
          tone: "info",
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to preview PTR sync.";
      setPtrPreviewState({ status: "error", error: message });
      pushToast({ message, tone: "error" });
    }
  }, [ptrSourceZoneName, pushToast, ptrAdoptExistingPtrRecords]);

  const runPtrApply = useCallback(async () => {
    const zoneName = ptrSourceZoneName.trim();
    if (!zoneName) {
      pushToast({
        message: "Please enter a forward zone name.",
        tone: "error",
      });
      return;
    }

    if (ptrPreviewState.status !== "loaded") {
      pushToast({ message: "Run Preview first.", tone: "error" });
      return;
    }

    const unresolvedConflicts = ptrPreviewState.data.plannedRecords.filter(
      (record) => {
        if (record.status !== "conflict") return false;

        if (record.conflictReason === "multiple-source-hostnames") {
          const chosen = (ptrSourceHostnameResolutions[record.ip] ?? "").trim();
          return chosen.length === 0;
        }

        return true;
      },
    ).length;

    if (!ptrSkipUnresolvedConflicts && unresolvedConflicts > 0) {
      pushToast({
        message:
          "Unresolved conflicts remain. Resolve them or enable 'Skip unresolved conflicts'.",
        tone: "error",
      });
      return;
    }

    setPtrApplyState({ status: "loading" });

    const catalogZoneName = ptrCatalogZoneName.trim() || undefined;

    const sourceHostnameResolutions = Object.entries(
      ptrSourceHostnameResolutions,
    )
      .map(([ip, hostname]) => ({ ip: ip.trim(), hostname: hostname.trim() }))
      .filter((entry) => entry.ip.length > 0 && entry.hostname.length > 0);

    try {
      const response = await apiFetch("/split-horizon/ptr/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zoneName,
          adoptExistingPtrRecords: ptrAdoptExistingPtrRecords,
          conflictPolicy: ptrSkipUnresolvedConflicts ? "skip" : "fail",
          catalogZoneName,
          ...(sourceHostnameResolutions.length > 0 ?
            { sourceHostnameResolutions }
          : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`Apply failed (${response.status})`);
      }

      const data = (await response.json()) as SplitHorizonPtrApplyResponse;
      setPtrApplyState({ status: "loaded", data });

      const {
        createdZones,
        createdRecords,
        updatedRecords,
        deletedRecords,
        skippedConflicts,
        noops,
        errors,
      } = data.summary;
      if (errors > 0) {
        pushToast({
          message: `PTR sync applied with ${errors} error(s). Updated ${updatedRecords}, created ${createdRecords} (zones ${createdZones}), deleted ${deletedRecords}, skipped conflicts ${skippedConflicts}, no-ops ${noops}. See Apply results below.`,
          tone: "error",
        });
      } else {
        pushToast({
          message: `PTR sync applied. Updated ${updatedRecords}, created ${createdRecords} (zones ${createdZones}), deleted ${deletedRecords}, skipped conflicts ${skippedConflicts}, no-ops ${noops}.`,
          tone: "success",
        });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to apply PTR sync.";
      setPtrApplyState({ status: "error", error: message });
      pushToast({ message, tone: "error" });
    }
  }, [
    ptrCatalogZoneName,
    ptrPreviewState,
    ptrSourceZoneName,
    pushToast,
    ptrSkipUnresolvedConflicts,
    ptrSourceHostnameResolutions,
    ptrAdoptExistingPtrRecords,
  ]);

  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      setPtrSourceZoneCandidates([]);
      setPtrSourceZoneCandidatesState("idle");
      setSplitHorizonInstalled(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setPtrSourceZoneCandidatesState("loading");
      try {
        const response = await apiFetch("/split-horizon/ptr/source-zones", {
          method: "GET",
        });

        if (!response.ok) {
          throw new Error(`Failed to load source zones (${response.status})`);
        }

        const data =
          (await response.json()) as unknown as SplitHorizonPtrSourceZonesResponse;

        if (cancelled) return;

        setSplitHorizonInstalled(data.splitHorizonInstalled === true);
        setPtrSourceZoneCandidates(data.zones ?? []);
        setPtrSourceZoneCandidatesState("loaded");
      } catch {
        if (cancelled) return;
        setSplitHorizonInstalled(false);
        setPtrSourceZoneCandidates([]);
        setPtrSourceZoneCandidatesState("error");
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [nodes]);

  useEffect(() => {
    if (!splitHorizonInstalled && activeZonesTab === "split-horizon") {
      setActiveZonesTab("zones");
    }
  }, [activeZonesTab, splitHorizonInstalled]);

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
  const primaryNode = usePrimaryNode(nodes);
  // Zone writes (and snapshot restore) are only valid on the Primary node when clustering is enabled.
  const snapshotNode = isClustered ? primaryNode : nodes[0];

  const openQuickSnapshotModal = useCallback((zoneName: string) => {
    const normalizedZoneName = (zoneName ?? "").trim();
    if (!normalizedZoneName) {
      return;
    }

    setQuickSnapshotZoneName(normalizedZoneName);
    setQuickSnapshotNote("");
    setQuickSnapshotModalOpen(true);
  }, []);

  const closeQuickSnapshotModal = useCallback(() => {
    if (quickSnapshotSaving) {
      return;
    }

    setQuickSnapshotModalOpen(false);
    setQuickSnapshotZoneName("");
    setQuickSnapshotNote("");
  }, [quickSnapshotSaving]);

  const confirmQuickSnapshot = useCallback(async () => {
    if (quickSnapshotSaving) {
      return;
    }

    const nodeId = snapshotNode?.id;
    const zoneName = (quickSnapshotZoneName ?? "").trim();
    const note = quickSnapshotNote.trim();

    if (!nodeId || !zoneName) {
      return;
    }

    setQuickSnapshotSaving(true);
    try {
      await createZoneSnapshot(nodeId, {
        zones: [zoneName],
        origin: "manual",
        note: note.length > 0 ? note : undefined,
      });

      pushToast({
        message: `Snapshot saved for ${zoneName}.`,
        tone: "success",
      });

      setQuickSnapshotModalOpen(false);
      setQuickSnapshotZoneName("");
      setQuickSnapshotNote("");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save snapshot.";
      pushToast({ message, tone: "error" });
    } finally {
      setQuickSnapshotSaving(false);
    }
  }, [
    createZoneSnapshot,
    pushToast,
    quickSnapshotNote,
    quickSnapshotSaving,
    quickSnapshotZoneName,
    snapshotNode?.id,
  ]);

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
      <button
        type="button"
        className="drawer-pull"
        aria-label="Open DNS zone history"
        onClick={() => setShowSnapshotDrawer(true)}
        disabled={!snapshotNode?.id}
      >
        <FontAwesomeIcon
          icon={faClockRotateLeft}
          style={{ marginBottom: "0.5rem" }}
        />
        DNS Zone History
      </button>
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

        {splitHorizonInstalled ?
          <div className="configuration__tab-switcher">
            <button
              type="button"
              className={`configuration__tab ${activeZonesTab === "zones" ? "configuration__tab--active" : ""}`}
              onClick={() => setActiveZonesTab("zones")}
            >
              Zones
            </button>
            <button
              type="button"
              className={`configuration__tab ${activeZonesTab === "split-horizon" ? "configuration__tab--active" : ""}`}
              onClick={() => setActiveZonesTab("split-horizon")}
            >
              Split Horizon
            </button>
          </div>
        : null}

        {!splitHorizonInstalled || activeZonesTab === "zones" ?
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
        : null}

        {splitHorizonInstalled && activeZonesTab === "split-horizon" ?
          <section className="zones-page__ptr-sync">
            <div className="zones-page__ptr-sync-header">
              <h2 className="zones-page__ptr-sync-title">
                SplitHorizon → PTR Sync
              </h2>
              <p className="zones-page__ptr-sync-subtitle">
                Preview and apply PTR records from SplitHorizon.SimpleAddress
                APP records in a forward zone.
              </p>
            </div>

            <div className="zones-page__ptr-sync-form">
              <label
                className="zones-page__ptr-sync-label"
                htmlFor="ptr-source-zone"
              >
                Forward zone name
              </label>

              <div className="zones-page__ptr-sync-field zones-page__ptr-sync-field--grow">
                <input
                  id="ptr-source-zone"
                  type="text"
                  list="ptr-source-zone-suggestions"
                  className="zones-page__ptr-sync-input"
                  placeholder="example.com"
                  value={ptrSourceZoneName}
                  onChange={(event) => setPtrSourceZoneName(event.target.value)}
                  disabled={
                    ptrPreviewState.status === "loading" ||
                    ptrApplyState.status === "loading"
                  }
                />
                <datalist id="ptr-source-zone-suggestions">
                  {ptrSourceZoneCandidates.map((candidate) => (
                    <option
                      key={candidate.zoneName}
                      value={candidate.zoneName}
                    />
                  ))}
                </datalist>
              </div>

              <div className="zones-page__ptr-sync-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => void runPtrPreview()}
                  disabled={
                    ptrPreviewState.status === "loading" ||
                    ptrApplyState.status === "loading"
                  }
                >
                  {ptrPreviewState.status === "loading" ?
                    "Previewing…"
                  : "Preview"}
                </button>
                <button
                  type="button"
                  className="button primary"
                  onClick={() => void runPtrApply()}
                  disabled={
                    ptrApplyState.status === "loading" ||
                    ptrPreviewState.status !== "loaded"
                  }
                >
                  {ptrApplyState.status === "loading" ? "Applying…" : "Apply"}
                </button>
              </div>

              <small className="zones-page__ptr-sync-hint">
                {ptrSourceZoneCandidatesState === "loading" ?
                  "Loading zone suggestions… "
                : ""}
                Suggestions show zones with SplitHorizon.SimpleAddress records.
                Defaults: IPv4 /24 reverse zones, IPv6 /64 reverse zones.
              </small>
            </div>

            <div className="zones-page__ptr-sync-options">
              <label className="zones-page__ptr-sync-checkbox">
                <input
                  type="checkbox"
                  checked={ptrShowUnchanged}
                  onChange={(event) =>
                    setPtrShowUnchanged(event.target.checked)
                  }
                  disabled={ptrPreviewState.status !== "loaded"}
                />
                Show unchanged items
              </label>

              <label className="zones-page__ptr-sync-checkbox">
                <input
                  type="checkbox"
                  checked={ptrSkipUnresolvedConflicts}
                  onChange={(event) =>
                    setPtrSkipUnresolvedConflicts(event.target.checked)
                  }
                  disabled={ptrPreviewState.status !== "loaded"}
                />
                Skip unresolved conflicts
              </label>

              <label className="zones-page__ptr-sync-checkbox">
                <input
                  type="checkbox"
                  checked={ptrAdoptExistingPtrRecords}
                  onChange={(event) =>
                    setPtrAdoptExistingPtrRecords(event.target.checked)
                  }
                  disabled={
                    ptrPreviewState.status !== "loaded" ||
                    ptrApplyState.status === "loading"
                  }
                />
                Advanced: adopt existing PTR records
              </label>
            </div>

            {ptrAdoptExistingPtrRecords ?
              <div className="zones-page__ptr-sync-warnings" role="status">
                Advanced option enabled: existing PTR records may be tagged as
                managed by Technitium DNS Companion. Once adopted, those PTRs
                can be deleted in later runs if the Split Horizon mapping no
                longer includes them.
              </div>
            : null}

            {ptrPreviewState.status === "error" ?
              <div className="zones-page__ptr-sync-error" role="status">
                {ptrPreviewState.error}
              </div>
            : null}

            {ptrPreviewState.status === "loaded" ?
              (() => {
                const plannedZonesToCreate =
                  ptrPreviewState.data.plannedZones.filter(
                    (zone) => zone.status === "create-zone",
                  ).length;

                const plannedRecords = ptrPreviewState.data.plannedRecords;
                const plannedCreate = plannedRecords.filter(
                  (record) => record.status === "create-record",
                ).length;
                const plannedUpdate = plannedRecords.filter(
                  (record) => record.status === "update-record",
                ).length;
                const plannedDelete = plannedRecords.filter(
                  (record) => record.status === "delete-record",
                ).length;
                const plannedNoop = plannedRecords.filter(
                  (record) => record.status === "already-correct",
                ).length;
                const plannedConflict = plannedRecords.filter(
                  (record) => record.status === "conflict",
                ).length;

                const plannedZones = ptrPreviewState.data.plannedZones;
                const plannedZonesSorted = [...plannedZones].sort((a, b) =>
                  a.zoneName.localeCompare(b.zoneName),
                );

                const plannedZonesVisible =
                  ptrShowUnchanged ? plannedZonesSorted : (
                    plannedZonesSorted.filter(
                      (zone) => zone.status === "create-zone",
                    )
                  );

                const plannedRecordsVisible =
                  ptrShowUnchanged ? plannedRecords : (
                    plannedRecords.filter(
                      (record) => record.status !== "already-correct",
                    )
                  );

                const plannedRecordsSorted = [...plannedRecordsVisible].sort(
                  (a, b) => {
                    const zoneCompare = a.ptrZoneName.localeCompare(
                      b.ptrZoneName,
                    );
                    if (zoneCompare !== 0) return zoneCompare;
                    const ownerCompare = a.ptrRecordName.localeCompare(
                      b.ptrRecordName,
                    );
                    if (ownerCompare !== 0) return ownerCompare;
                    return a.ip.localeCompare(b.ip);
                  },
                );

                const recordStatusToBadge = (
                  status: SplitHorizonPtrPreviewResponse["plannedRecords"][number]["status"],
                ) => {
                  switch (status) {
                    case "create-record":
                      return "badge badge--success";
                    case "update-record":
                      return "badge badge--warning";
                    case "delete-record":
                      return "badge badge--warning";
                    case "already-correct":
                      return "badge badge--muted";
                    case "conflict":
                      return "badge badge--error";
                    default:
                      return "badge badge--muted";
                  }
                };

                const zoneStatusToBadge = (
                  status: SplitHorizonPtrPreviewResponse["plannedZones"][number]["status"],
                ) => {
                  switch (status) {
                    case "create-zone":
                      return "badge badge--warning";
                    case "zone-exists":
                      return "badge badge--muted";
                    default:
                      return "badge badge--muted";
                  }
                };

                const catalogZones = ptrPreviewState.data.catalogZones ?? [];

                return (
                  <div className="zones-page__ptr-sync-results">
                    <div className="zones-page__ptr-sync-metrics">
                      <div className="zones-page__ptr-sync-metric">
                        <span className="zones-page__ptr-sync-metric-label">
                          Node
                        </span>
                        <span className="zones-page__ptr-sync-metric-value">
                          {ptrPreviewState.data.nodeId}
                        </span>
                      </div>
                      <div className="zones-page__ptr-sync-metric">
                        <span className="zones-page__ptr-sync-metric-label">
                          Reverse zones to create
                        </span>
                        <span className="zones-page__ptr-sync-metric-value">
                          {plannedZonesToCreate}
                        </span>
                      </div>
                      <div className="zones-page__ptr-sync-metric">
                        <span className="zones-page__ptr-sync-metric-label">
                          Record changes
                        </span>
                        <span className="zones-page__ptr-sync-metric-value">
                          Create {plannedCreate} • Update {plannedUpdate} • No
                          change {plannedNoop} • Delete {plannedDelete} •
                          Conflicts {plannedConflict}
                        </span>
                      </div>
                    </div>

                    {catalogZones.length > 0 ?
                      <div className="zones-page__ptr-sync-field">
                        <label
                          className="zones-page__ptr-sync-label"
                          htmlFor="ptr-catalog-zone"
                        >
                          Catalog zone for new reverse zones
                        </label>
                        <select
                          id="ptr-catalog-zone"
                          className="zones-page__ptr-sync-select"
                          value={ptrCatalogZoneName}
                          onChange={(event) =>
                            setPtrCatalogZoneName(event.target.value)
                          }
                          disabled={ptrApplyState.status === "loading"}
                        >
                          <option value="">Do not add to a catalog</option>
                          {catalogZones.map((zone) => (
                            <option key={zone.name} value={zone.name}>
                              {zone.name} ({zone.type})
                            </option>
                          ))}
                        </select>
                        <small className="zones-page__ptr-sync-hint">
                          Only used when the apply step needs to create missing
                          reverse zones.
                        </small>
                      </div>
                    : null}

                    {(
                      ptrPreviewState.data.warnings &&
                      ptrPreviewState.data.warnings.length > 0
                    ) ?
                      <div
                        className="zones-page__ptr-sync-warnings"
                        role="status"
                      >
                        {ptrPreviewState.data.warnings.join(" ")}
                      </div>
                    : null}

                    <div className="zones-page__ptr-sync-diff">
                      <h3 className="zones-page__ptr-sync-diff-title">
                        Planned changes
                      </h3>

                      <div className="zones-page__ptr-sync-diff-section">
                        <div className="zones-page__ptr-sync-diff-section-header">
                          <span className="zones-page__ptr-sync-diff-section-title">
                            Reverse zones
                          </span>
                          <span className="zones-page__ptr-sync-diff-section-caption">
                            {ptrShowUnchanged ?
                              `${plannedZonesSorted.length} total`
                            : `${plannedZonesVisible.length} shown of ${plannedZonesSorted.length}`
                            }
                          </span>
                        </div>

                        {plannedZonesVisible.length === 0 ?
                          <div className="zones-page__ptr-sync-diff-empty">
                            {plannedZonesSorted.length === 0 ?
                              "No reverse zones discovered from SplitHorizon records."
                            : "No reverse zones need to be created."}
                          </div>
                        : <div className="zones-page__ptr-sync-table-wrap">
                            <table className="zones-page__ptr-sync-table">
                              <thead>
                                <tr>
                                  <th scope="col">Status</th>
                                  <th scope="col">Zone</th>
                                  <th scope="col">Records</th>
                                </tr>
                              </thead>
                              <tbody>
                                {plannedZonesVisible.map((zone) => (
                                  <tr key={zone.zoneName}>
                                    <td>
                                      <span
                                        className={zoneStatusToBadge(
                                          zone.status,
                                        )}
                                      >
                                        {zone.status === "create-zone" ?
                                          "Create"
                                        : "Exists"}
                                      </span>
                                    </td>
                                    <td className="zones-page__ptr-sync-mono">
                                      {zone.zoneName}
                                    </td>
                                    <td>{zone.recordCount}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        }
                      </div>

                      <div className="zones-page__ptr-sync-diff-section">
                        <div className="zones-page__ptr-sync-diff-section-header">
                          <span className="zones-page__ptr-sync-diff-section-title">
                            PTR records
                          </span>
                          <span className="zones-page__ptr-sync-diff-section-caption">
                            {ptrShowUnchanged ?
                              `${plannedRecords.length} total`
                            : `${plannedRecordsSorted.length} shown of ${plannedRecords.length}`
                            }
                          </span>
                        </div>

                        {plannedRecordsSorted.length === 0 ?
                          <div className="zones-page__ptr-sync-diff-empty">
                            {plannedRecords.length === 0 ?
                              "No PTR records planned."
                            : "No actionable PTR record changes."}
                          </div>
                        : <div className="zones-page__ptr-sync-table-wrap">
                            <table className="zones-page__ptr-sync-table">
                              <thead>
                                <tr>
                                  <th scope="col">Status</th>
                                  <th scope="col">PTR record</th>
                                  <th scope="col">Target hostname</th>
                                  <th scope="col">IP</th>
                                </tr>
                              </thead>
                              <tbody>
                                {plannedRecordsSorted.map((record) => {
                                  const ownerFqdn = formatPtrOwnerFqdn(
                                    record.ptrRecordName,
                                    record.ptrZoneName,
                                  );

                                  const conflictExplanation =
                                    record.status === "conflict" ?
                                      (
                                        record.conflictReason ===
                                        "multiple-source-hostnames"
                                      ) ?
                                        "Conflict: multiple Split Horizon hostnames map to this IP."
                                      : (
                                        record.conflictReason ===
                                        "multiple-existing-ptr-targets"
                                      ) ?
                                        "Conflict: multiple existing PTR targets already exist for this record."
                                      : "Conflict: competing targets detected."
                                    : undefined;

                                  const canResolveSourceHostnameConflict =
                                    record.status === "conflict" &&
                                    record.conflictReason ===
                                      "multiple-source-hostnames" &&
                                    Array.isArray(record.conflictTargets) &&
                                    record.conflictTargets.length > 0;

                                  const selectedHostname =
                                    canResolveSourceHostnameConflict ?
                                      (ptrSourceHostnameResolutions[
                                        record.ip
                                      ] ?? "")
                                    : "";

                                  const displayTargetHostname =
                                    (
                                      canResolveSourceHostnameConflict &&
                                      selectedHostname.trim().length > 0
                                    ) ?
                                      selectedHostname
                                    : record.targetHostname;

                                  return (
                                    <tr
                                      key={`${record.ip}-${record.ptrZoneName}-${record.ptrRecordName}`}
                                    >
                                      <td>
                                        <span
                                          className={recordStatusToBadge(
                                            record.status,
                                          )}
                                        >
                                          {record.status === "create-record" ?
                                            "Create"
                                          : record.status === "update-record" ?
                                            "Update"
                                          : record.status === "delete-record" ?
                                            "Delete"
                                          : (
                                            record.status === "already-correct"
                                          ) ?
                                            "No change"
                                          : "Conflict"}
                                        </span>
                                      </td>
                                      <td className="zones-page__ptr-sync-mono">
                                        {ownerFqdn}
                                      </td>
                                      <td className="zones-page__ptr-sync-mono">
                                        {displayTargetHostname}
                                        {record.status === "conflict" ?
                                          <div className="zones-page__ptr-sync-conflict">
                                            {conflictExplanation}

                                            {canResolveSourceHostnameConflict ?
                                              <div>
                                                <select
                                                  className="zones-page__ptr-sync-select"
                                                  value={selectedHostname}
                                                  onChange={(event) => {
                                                    const next =
                                                      event.target.value;
                                                    setPtrSourceHostnameResolutions(
                                                      (prev) => ({
                                                        ...prev,
                                                        [record.ip]: next,
                                                      }),
                                                    );
                                                  }}
                                                  aria-label={`Choose desired hostname for ${record.ip}`}
                                                  disabled={
                                                    ptrApplyState.status ===
                                                    "loading"
                                                  }
                                                >
                                                  <option value="">
                                                    Choose desired hostname…
                                                  </option>
                                                  {(
                                                    record.conflictTargets ?? []
                                                  ).map((target) => (
                                                    <option
                                                      key={target}
                                                      value={target}
                                                    >
                                                      {target}
                                                    </option>
                                                  ))}
                                                </select>
                                                <small className="zones-page__ptr-sync-hint">
                                                  Used during Apply.
                                                </small>
                                                {(
                                                  selectedHostname.trim()
                                                    .length > 0
                                                ) ?
                                                  <small className="zones-page__ptr-sync-hint">
                                                    Resolved (will apply winner
                                                    on Apply).
                                                  </small>
                                                : null}
                                              </div>
                                            : (
                                              record.conflictTargets &&
                                              record.conflictTargets.length > 0
                                            ) ?
                                              <span className="zones-page__ptr-sync-conflict-targets">
                                                {record.conflictTargets.join(
                                                  ", ",
                                                )}
                                              </span>
                                            : null}
                                          </div>
                                        : null}
                                      </td>
                                      <td className="zones-page__ptr-sync-mono">
                                        {record.ip}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                );
              })()
            : null}

            {ptrApplyState.status === "error" ?
              <div className="zones-page__ptr-sync-error" role="status">
                {ptrApplyState.error}
              </div>
            : null}

            {ptrApplyState.status === "loaded" ?
              <div className="zones-page__ptr-sync-apply-results">
                <div className="zones-page__ptr-sync-apply-summary">
                  Applied on <strong>{ptrApplyState.data.nodeId}</strong>:
                  created zones{" "}
                  <strong>{ptrApplyState.data.summary.createdZones}</strong>,
                  created records{" "}
                  <strong>{ptrApplyState.data.summary.createdRecords}</strong>,
                  updated records{" "}
                  <strong>{ptrApplyState.data.summary.updatedRecords}</strong>,
                  deleted records{" "}
                  <strong>{ptrApplyState.data.summary.deletedRecords}</strong>,
                  skipped conflicts{" "}
                  <strong>{ptrApplyState.data.summary.skippedConflicts}</strong>
                  , no-ops <strong>{ptrApplyState.data.summary.noops}</strong>,
                  errors <strong>{ptrApplyState.data.summary.errors}</strong>.
                </div>

                {(() => {
                  const actions = ptrApplyState.data.actions ?? [];

                  const actionKindLabel = (
                    kind: (typeof actions)[number]["kind"],
                  ): string => {
                    switch (kind) {
                      case "create-zone":
                        return "Create zone";
                      case "create-record":
                        return "Create record";
                      case "update-record":
                        return "Update record";
                      case "delete-record":
                        return "Delete record";
                      case "skip-conflict":
                        return "Skip conflict";
                      case "noop":
                        return "No-op";
                      default:
                        return kind;
                    }
                  };

                  const actionToBadge = (
                    action: (typeof actions)[number],
                  ): string => {
                    if (!action.ok) return "badge badge--error";
                    switch (action.kind) {
                      case "create-zone":
                      case "create-record":
                      case "update-record":
                        return "badge badge--success";
                      case "delete-record":
                        return "badge badge--warning";
                      case "skip-conflict":
                        return "badge badge--warning";
                      case "noop":
                      default:
                        return "badge badge--muted";
                    }
                  };

                  if (actions.length === 0) return null;

                  return (
                    <div className="zones-page__ptr-sync-diff">
                      <div className="zones-page__ptr-sync-diff-section">
                        <div className="zones-page__ptr-sync-diff-section-header">
                          <span className="zones-page__ptr-sync-diff-section-title">
                            Apply actions
                          </span>
                          <span className="zones-page__ptr-sync-diff-section-caption">
                            {actions.length} total
                          </span>
                        </div>

                        <div className="zones-page__ptr-sync-table-wrap">
                          <table className="zones-page__ptr-sync-table">
                            <thead>
                              <tr>
                                <th scope="col">Result</th>
                                <th scope="col">Action</th>
                                <th
                                  scope="col"
                                  className="zones-page__ptr-sync-apply-actions-ip"
                                >
                                  IP
                                </th>
                                <th scope="col">PTR record</th>
                                <th scope="col">Current</th>
                                <th scope="col">Target</th>
                                <th scope="col">Message</th>
                              </tr>
                            </thead>
                            <tbody>
                              {actions.map((action, index) => (
                                <tr key={`${action.kind}-${index}`}>
                                  <td>
                                    <span className={actionToBadge(action)}>
                                      {action.ok ? "OK" : "Failed"}
                                    </span>
                                  </td>
                                  <td>{actionKindLabel(action.kind)}</td>
                                  <td
                                    className={
                                      "zones-page__ptr-sync-mono zones-page__ptr-sync-apply-actions-ip"
                                    }
                                  >
                                    {action.ip ?? ""}
                                  </td>
                                  <td className="zones-page__ptr-sync-mono">
                                    {action.ptrRecordFqdn ?? ""}
                                  </td>
                                  <td className="zones-page__ptr-sync-mono">
                                    {action.currentTargetHostname ?? ""}
                                  </td>
                                  <td className="zones-page__ptr-sync-mono">
                                    {action.targetHostname ?? ""}
                                  </td>
                                  <td>{action.message ?? ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {(
                  ptrApplyState.data.warnings &&
                  ptrApplyState.data.warnings.length > 0
                ) ?
                  <div className="zones-page__ptr-sync-warnings" role="status">
                    {ptrApplyState.data.warnings.join(" ")}
                  </div>
                : null}
              </div>
            : null}
          </section>
        : null}

        {!splitHorizonInstalled || activeZonesTab === "zones" ?
          <>
            <div className="zones-page__toolbar">
              <div className="zones-page__search">
                <label
                  className="zones-page__search-label"
                  htmlFor="zones-search"
                >
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
                <div className="zones-page__empty">
                  Unable to load zone data.
                </div>
              : null}

              {(
                loadState !== "loading" &&
                filteredZones.length === 0 &&
                overview
              ) ?
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

                const selectedRecordType =
                  recordTypeFiltersByKey[zoneKey] ?? "all";
                const userCreatedOnly = userCreatedOnlyByKey[zoneKey] ?? false;
                const recordSearchQuery = recordSearchQueryByKey[zoneKey] ?? "";

                const applyRecordFilters = (
                  records: TechnitiumZoneRecord[],
                ) => {
                  const filtered = records.filter((record) => {
                    if (userCreatedOnly && !isUserCreatedRecord(record)) {
                      return false;
                    }

                    if (selectedRecordType !== "all") {
                      if (
                        normalizeRecordType(record.type) !== selectedRecordType
                      ) {
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
                          onClick={() => {
                            const zoneName = (zone.name ?? "").trim();
                            if (!zoneName || !snapshotNode?.id) {
                              return;
                            }
                            openQuickSnapshotModal(zoneName);
                          }}
                          disabled={
                            !snapshotNode?.id || !(zone.name ?? "").trim()
                          }
                          title={
                            !snapshotNode?.id ?
                              "DNS Zone History is only available on the Primary node"
                            : !(zone.name ?? "").trim() ?
                              "Root zone cannot be snapshotted"
                            : undefined
                          }
                        >
                          Save snapshot
                        </button>
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
                                                {normalizeRecordType(
                                                  record.type,
                                                )}
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
          </>
        : null}
      </div>

      <ZoneSnapshotDrawer
        isOpen={showSnapshotDrawer}
        nodeId={snapshotNode?.id}
        nodeName={snapshotNode?.name}
        onClose={() => setShowSnapshotDrawer(false)}
        listSnapshots={listZoneSnapshots}
        createSnapshot={createZoneSnapshot}
        getSnapshotDetail={getZoneSnapshot}
        deleteSnapshot={deleteZoneSnapshot}
        updateSnapshotNote={updateZoneSnapshotNote}
        setSnapshotPinned={setZoneSnapshotPinned}
        restoreSnapshot={restoreZoneSnapshot}
        onRestoreSuccess={async () => {
          await fetchOverview("refresh");
        }}
      />

      <ConfirmModal
        isOpen={quickSnapshotModalOpen}
        title={`Save snapshot`}
        variant="info"
        confirmLabel={quickSnapshotSaving ? "Saving…" : "Create snapshot"}
        cancelLabel="Cancel"
        confirmDisabled={
          quickSnapshotSaving ||
          !snapshotNode?.id ||
          quickSnapshotZoneName.trim().length === 0
        }
        cancelDisabled={quickSnapshotSaving}
        onCancel={closeQuickSnapshotModal}
        onConfirm={() => void confirmQuickSnapshot()}
        message={
          <div>
            {quickSnapshotZoneName ?
              <div
                style={{
                  marginBottom: "1rem",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <span>Zone: </span>
                <span
                  style={{
                    fontWeight: "bold",
                    fontFamily: "var(--font-mono, monospace)",
                    marginLeft: "0.5rem",
                  }}
                >
                  {quickSnapshotZoneName}
                </span>
              </div>
            : null}
            <label
              htmlFor="zones-page-quick-snapshot-note"
              className="confirm-modal__message"
              style={{ display: "block", marginTop: "0.75rem" }}
            >
              Note (optional)
            </label>
            <textarea
              id="zones-page-quick-snapshot-note"
              className="snapshot-drawer__textarea"
              rows={3}
              value={quickSnapshotNote}
              onChange={(event) => setQuickSnapshotNote(event.target.value)}
              placeholder="e.g. Before updating allowlist"
              autoFocus
              disabled={quickSnapshotSaving}
            />
          </div>
        }
      />
    </>
  );
}

export default ZonesPage;
