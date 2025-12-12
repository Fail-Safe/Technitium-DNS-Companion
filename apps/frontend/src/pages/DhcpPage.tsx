import {
  faClipboard,
  faMinus,
  faPencil,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmModal } from "../components/common/ConfirmModal";
import { Divider } from "../components/common/Divider";
import { PullToRefreshIndicator } from "../components/common/PullToRefreshIndicator";
import { DhcpSnapshotDrawer } from "../components/dhcp/DhcpSnapshotDrawer";
import { DhcpBulkSyncModal } from "../components/DhcpBulkSyncModal";
import { DhcpBulkSyncResultsModal } from "../components/DhcpBulkSyncResultsModal";
import { useTechnitiumState } from "../context/TechnitiumContext";
import { useToast } from "../context/ToastContext";
import { useNavigationBlocker } from "../hooks/useNavigationBlocker";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import type {
  DhcpBulkSyncRequest,
  DhcpBulkSyncResult,
  DhcpBulkSyncStrategy,
  TechnitiumCloneDhcpScopeResult,
  TechnitiumDhcpExclusionRange,
  TechnitiumDhcpGenericOption,
  TechnitiumDhcpReservedLease,
  TechnitiumDhcpScope,
  TechnitiumDhcpScopeOverrides,
  TechnitiumDhcpScopeSummary,
  TechnitiumDhcpStaticRoute,
  TechnitiumDhcpVendorInfo,
  TechnitiumUpdateDhcpScopeEnvelope,
} from "../types/dhcp";

type LoadState = "idle" | "loading" | "success" | "error";

type CloneState = "idle" | "loading" | "success" | "error";

type UpdateState = "idle" | "loading" | "success" | "error";

type RenameState = "idle" | "loading" | "success" | "error";

type DhcpTabMode = "scope-details" | "clone";

const splitListInput = (value: string): string[] => {
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const arraysEqual = (
  first: string[] | undefined,
  second: string[] | undefined,
): boolean => {
  const a = first ?? [];
  const b = second ?? [];

  if (a.length !== b.length) {
    return false;
  }

  return a.every((value, index) => value === b[index]);
};

const normalizeOptionalString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseLeaseComponent = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseNumericInput = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const createDraftId = (): string => Math.random().toString(36).slice(2, 11);

interface StaticRouteDraft extends TechnitiumDhcpStaticRoute {
  id: string;
}

interface VendorInfoDraft extends TechnitiumDhcpVendorInfo {
  id: string;
}

interface GenericOptionDraft {
  id: string;
  code: string;
  value: string;
  mode: "ascii" | "hex";
}

interface ExclusionDraft extends TechnitiumDhcpExclusionRange {
  id: string;
}

interface ReservedLeaseDraft {
  id: string;
  hostName: string;
  hardwareAddress: string;
  address: string;
  comments: string;
}

type SanitizedCollectionResult<T> = {
  values: T[];
  hasPartial: boolean;
  invalidCode?: boolean;
  invalidValue?: boolean;
};

const arraysEqualBy = <T,>(
  first: T[] | undefined,
  second: T[] | undefined,
  projector: (value: T) => string,
): boolean => {
  const left = (first ?? []).map(projector).sort();
  const right = (second ?? []).map(projector).sort();

  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
};

const normalizeHexValue = (value: string): string | undefined => {
  const withoutPrefixes = value.replace(/0x/gi, "");
  const cleaned = withoutPrefixes.replace(/[^0-9a-fA-F]/g, "").toUpperCase();

  if (cleaned.length === 0 || cleaned.length % 2 !== 0) {
    return undefined;
  }

  const segments = cleaned.match(/.{1,2}/g);
  if (!segments) {
    return undefined;
  }

  return segments.join(":");
};

const asciiToHex = (value: string): string => {
  return Array.from(value)
    .map((char) =>
      char.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase(),
    )
    .join(":");
};

const hexToAscii = (value: string): string | undefined => {
  const cleaned = value.replace(/[^0-9A-Fa-f]/g, "");

  if (cleaned.length === 0 || cleaned.length % 2 !== 0) {
    return undefined;
  }

  let result = "";

  for (let index = 0; index < cleaned.length; index += 2) {
    const pair = cleaned.slice(index, index + 2);
    const code = Number.parseInt(pair, 16);

    if (!Number.isFinite(code)) {
      return undefined;
    }

    result += String.fromCharCode(code);
  }

  return result;
};

const isPrintableAscii = (value: string): boolean => {
  return Array.from(value).every((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code <= 126;
  });
};

const isValidIPv4Address = (value: string): boolean => {
  if (!value || value.trim().length === 0) {
    return true; // Empty is valid (will be checked by required field validation)
  }

  const trimmed = value.trim();
  const parts = trimmed.split(".");

  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && String(num) === part;
  });
};

type GenericOptionPreview =
  | { status: "empty" }
  | { status: "ascii"; hex: string }
  | { status: "hex"; hex: string; ascii?: string; hasNonPrintable: boolean }
  | { status: "invalid" };

const describeGenericOptionValue = (
  entry: GenericOptionDraft,
): GenericOptionPreview => {
  const trimmed = entry.value.trim();

  if (trimmed.length === 0) {
    return { status: "empty" };
  }

  if (entry.mode === "ascii") {
    return { status: "ascii", hex: asciiToHex(entry.value) };
  }

  const normalized = normalizeHexValue(entry.value);

  if (!normalized) {
    return { status: "invalid" };
  }

  const ascii = hexToAscii(normalized);
  const printable = ascii !== undefined && isPrintableAscii(ascii);

  return {
    status: "hex",
    hex: normalized,
    ascii: printable ? ascii : undefined,
    hasNonPrintable: ascii !== undefined && !printable,
  };
};

const buildVendorInfoDraft = (
  info?: TechnitiumDhcpVendorInfo,
): VendorInfoDraft => ({
  id: createDraftId(),
  identifier: info?.identifier ?? "",
  information: info?.information ?? "",
});

const buildGenericOptionDraft = (
  option?: TechnitiumDhcpGenericOption,
): GenericOptionDraft => {
  const id = createDraftId();

  if (!option) {
    return { id, code: "", value: "", mode: "ascii" };
  }

  const normalizedHex = normalizeHexValue(option.value);

  if (normalizedHex) {
    const ascii = hexToAscii(normalizedHex);

    if (ascii !== undefined && isPrintableAscii(ascii)) {
      return { id, code: String(option.code), value: ascii, mode: "ascii" };
    }

    return { id, code: String(option.code), value: normalizedHex, mode: "hex" };
  }

  return { id, code: String(option.code), value: option.value, mode: "hex" };
};

const buildExclusionDraft = (
  range?: TechnitiumDhcpExclusionRange,
): ExclusionDraft => ({
  id: createDraftId(),
  startingAddress: range?.startingAddress ?? "",
  endingAddress: range?.endingAddress ?? "",
});

const buildReservedLeaseDraft = (
  lease?: TechnitiumDhcpReservedLease,
): ReservedLeaseDraft => ({
  id: createDraftId(),
  hostName: lease?.hostName ?? "",
  hardwareAddress: lease?.hardwareAddress ?? "",
  address: lease?.address ?? "",
  comments: lease?.comments ?? "",
});

const buildStaticRouteDraft = (
  route?: TechnitiumDhcpStaticRoute,
): StaticRouteDraft => ({
  id: createDraftId(),
  destination: route?.destination ?? "",
  subnetMask: route?.subnetMask ?? "",
  router: route?.router ?? "",
});

const sanitizeStaticRoutes = (
  routes: StaticRouteDraft[],
): SanitizedCollectionResult<TechnitiumDhcpStaticRoute> => {
  let hasPartial = false;
  const values: TechnitiumDhcpStaticRoute[] = [];

  routes.forEach((route) => {
    const destination = route.destination.trim();
    const subnetMask = route.subnetMask.trim();
    const router = route.router.trim();
    const filled = [destination, subnetMask, router].filter(Boolean).length;

    if (filled === 0) {
      return;
    }

    if (filled < 3) {
      hasPartial = true;
      return;
    }

    values.push({ destination, subnetMask, router });
  });

  return { values, hasPartial };
};

const sanitizeVendorInfo = (
  entries: VendorInfoDraft[],
): SanitizedCollectionResult<TechnitiumDhcpVendorInfo> => {
  let hasPartial = false;
  const values: TechnitiumDhcpVendorInfo[] = [];

  entries.forEach((entry) => {
    const identifier = entry.identifier.trim();
    const information = entry.information.trim();

    if (!identifier && !information) {
      return;
    }

    if (!identifier || !information) {
      hasPartial = true;
      return;
    }

    values.push({ identifier, information });
  });

  return { values, hasPartial };
};

const sanitizeGenericOptions = (
  entries: GenericOptionDraft[],
): SanitizedCollectionResult<TechnitiumDhcpGenericOption> => {
  let hasPartial = false;
  let invalidCode = false;
  let invalidValue = false;
  const values: TechnitiumDhcpGenericOption[] = [];

  entries.forEach((entry) => {
    const codeText = entry.code.trim();
    const rawValue = entry.value;
    const trimmedValue = rawValue.trim();

    if (!codeText && trimmedValue.length === 0) {
      return;
    }

    if (!codeText || trimmedValue.length === 0) {
      hasPartial = true;
      return;
    }

    const parsedCode = parseNumericInput(codeText);

    if (
      parsedCode === undefined ||
      !Number.isFinite(parsedCode) ||
      parsedCode < 0
    ) {
      invalidCode = true;
      return;
    }

    if (entry.mode === "ascii") {
      const hexValue = asciiToHex(rawValue);
      values.push({ code: parsedCode, value: hexValue });
      return;
    }

    const normalizedHex = normalizeHexValue(rawValue);

    if (!normalizedHex) {
      invalidValue = true;
      return;
    }

    values.push({ code: parsedCode, value: normalizedHex });
  });

  return { values, hasPartial, invalidCode, invalidValue };
};

const sanitizeExclusions = (
  entries: ExclusionDraft[],
): SanitizedCollectionResult<TechnitiumDhcpExclusionRange> => {
  let hasPartial = false;
  const values: TechnitiumDhcpExclusionRange[] = [];

  entries.forEach((entry) => {
    const startingAddress = entry.startingAddress.trim();
    const endingAddress = entry.endingAddress.trim();

    if (!startingAddress && !endingAddress) {
      return;
    }

    if (!startingAddress || !endingAddress) {
      hasPartial = true;
      return;
    }

    values.push({ startingAddress, endingAddress });
  });

  return { values, hasPartial };
};

const sanitizeReservedLeases = (
  entries: ReservedLeaseDraft[],
): SanitizedCollectionResult<TechnitiumDhcpReservedLease> => {
  let hasPartial = false;
  const values: TechnitiumDhcpReservedLease[] = [];

  entries.forEach((entry) => {
    const hostName = entry.hostName.trim();
    const hardwareAddress = entry.hardwareAddress.trim();
    const address = entry.address.trim();
    const comments = entry.comments.trim();

    const anyValues = [hostName, hardwareAddress, address, comments].some(
      (value) => value.length > 0,
    );

    if (!anyValues) {
      return;
    }

    if (!hardwareAddress || !address) {
      hasPartial = true;
      return;
    }

    values.push({
      hostName: normalizeOptionalString(hostName),
      hardwareAddress,
      address,
      comments: normalizeOptionalString(comments) ?? undefined,
    });
  });

  return { values, hasPartial };
};

const formatLeaseDuration = (
  scope: TechnitiumDhcpScope | undefined,
): string => {
  if (!scope) {
    return "—";
  }

  const parts: string[] = [];

  if (scope.leaseTimeDays && scope.leaseTimeDays > 0) {
    parts.push(
      `${scope.leaseTimeDays} day${scope.leaseTimeDays === 1 ? "" : "s"}`,
    );
  }

  if (scope.leaseTimeHours && scope.leaseTimeHours > 0) {
    parts.push(
      `${scope.leaseTimeHours} hour${scope.leaseTimeHours === 1 ? "" : "s"}`,
    );
  }

  if (scope.leaseTimeMinutes && scope.leaseTimeMinutes > 0) {
    parts.push(
      `${scope.leaseTimeMinutes} minute${scope.leaseTimeMinutes === 1 ? "" : "s"}`,
    );
  }

  if (parts.length === 0) {
    return "Default";
  }

  return parts.join(" ");
};

const buildScopeKey = (nodeId: string, scopeName: string): string => {
  return `${nodeId.toLowerCase()}::${scopeName.toLowerCase()}`;
};

type DhcpPageTab = "scopes" | "bulk-sync";

export function DhcpPage() {
  const {
    nodes,
    loadDhcpScopes,
    loadDhcpScope,
    cloneDhcpScope,
    renameDhcpScope,
    updateDhcpScope,
    deleteDhcpScope,
    bulkSyncDhcpScopes,
    listDhcpSnapshots,
    createDhcpSnapshot,
    restoreDhcpSnapshot,
    setDhcpSnapshotPinned,
    getDhcpSnapshot,
    deleteDhcpSnapshot,
    updateDhcpSnapshotNote,
  } = useTechnitiumState();
  const { pushToast } = useToast();

  const [activePageTab, setActivePageTab] = useState<DhcpPageTab>("scopes");
  const [activeTab, setActiveTab] = useState<DhcpTabMode>("scope-details");
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    () => nodes[0]?.id ?? "",
  );
  const [scopes, setScopes] = useState<TechnitiumDhcpScopeSummary[]>([]);
  const [scopeCountByNode, setScopeCountByNode] = useState<Map<string, number>>(
    new Map(),
  );
  const [scopeListState, setScopeListState] = useState<LoadState>("idle");
  const [scopeListError, setScopeListError] = useState<string | undefined>();
  const [selectedScopeName, setSelectedScopeName] = useState<
    string | undefined
  >();
  const [scopeDetailState, setScopeDetailState] = useState<LoadState>("idle");
  const [scopeDetailError, setScopeDetailError] = useState<
    string | undefined
  >();
  const [currentScope, setCurrentScope] = useState<
    TechnitiumDhcpScope | undefined
  >();
  const [detailCache, setDetailCache] = useState<
    Map<string, TechnitiumDhcpScope>
  >(() => new Map());
  const [cloneMode, setCloneMode] = useState<"remote" | "local">(() =>
    nodes.some((node) => node.id !== (nodes[0]?.id ?? "")) ? "remote" : "local",
  );
  const [targetNodeId, setTargetNodeId] = useState<string>("");
  const [newScopeName, setNewScopeName] = useState<string>("");
  const [newScopeNameTouched, setNewScopeNameTouched] =
    useState<boolean>(false);
  const [enableOnTarget, setEnableOnTarget] = useState<boolean>(true);
  const [cloneState, setCloneState] = useState<CloneState>("idle");
  const [cloneMessage, setCloneMessage] = useState<string | undefined>();
  const [cloneError, setCloneError] = useState<string | undefined>();
  const [cloneStartingAddress, setCloneStartingAddress] = useState<string>("");
  const [cloneEndingAddress, setCloneEndingAddress] = useState<string>("");
  const [cloneSubnetMask, setCloneSubnetMask] = useState<string>("");
  const [cloneRouterAddress, setCloneRouterAddress] = useState<string>("");
  const [cloneDnsServers, setCloneDnsServers] = useState<string>("");
  const [cloneDomainName, setCloneDomainName] = useState<string>("");
  const [cloneDomainSearchList, setCloneDomainSearchList] =
    useState<string>("");
  const [cloneUseThisDnsServer, setCloneUseThisDnsServer] =
    useState<boolean>(false);
  const [renameScopeName, setRenameScopeName] = useState<string>("");
  const [renameState, setRenameState] = useState<RenameState>("idle");
  const [renameMessage, setRenameMessage] = useState<string | undefined>();
  const [renameError, setRenameError] = useState<string | undefined>();
  const [draftStartingAddress, setDraftStartingAddress] = useState<string>("");
  const [draftEndingAddress, setDraftEndingAddress] = useState<string>("");
  const [draftSubnetMask, setDraftSubnetMask] = useState<string>("");
  const [draftRouterAddress, setDraftRouterAddress] = useState<string>("");
  const [draftDnsServers, setDraftDnsServers] = useState<string>("");
  const [draftDomainName, setDraftDomainName] = useState<string>("");
  const [draftDomainSearchList, setDraftDomainSearchList] =
    useState<string>("");
  const [draftLeaseDays, setDraftLeaseDays] = useState<string>("");
  const [draftLeaseHours, setDraftLeaseHours] = useState<string>("");
  const [draftLeaseMinutes, setDraftLeaseMinutes] = useState<string>("");
  const [draftAllowOnlyReserved, setDraftAllowOnlyReserved] =
    useState<boolean>(false);
  const [draftOfferDelay, setDraftOfferDelay] = useState<string>("");
  const [draftPingCheckEnabled, setDraftPingCheckEnabled] =
    useState<boolean>(false);
  const [draftPingTimeout, setDraftPingTimeout] = useState<string>("");
  const [draftPingRetries, setDraftPingRetries] = useState<string>("");
  const [draftDnsUpdates, setDraftDnsUpdates] = useState<boolean>(false);
  const [draftDnsTtl, setDraftDnsTtl] = useState<string>("");
  const [draftServerAddress, setDraftServerAddress] = useState<string>("");
  const [draftServerHostName, setDraftServerHostName] = useState<string>("");
  const [draftBootFileName, setDraftBootFileName] = useState<string>("");
  const [draftUseThisDnsServer, setDraftUseThisDnsServer] =
    useState<boolean>(false);
  const [draftWinsServers, setDraftWinsServers] = useState<string>("");
  const [draftNtpServers, setDraftNtpServers] = useState<string>("");
  const [draftNtpDomains, setDraftNtpDomains] = useState<string>("");
  const [draftStaticRoutes, setDraftStaticRoutes] = useState<
    StaticRouteDraft[]
  >([]);
  const [draftVendorInfo, setDraftVendorInfo] = useState<VendorInfoDraft[]>([]);
  const [draftCapwapControllers, setDraftCapwapControllers] =
    useState<string>("");
  const [draftTftpServers, setDraftTftpServers] = useState<string>("");
  const [draftGenericOptions, setDraftGenericOptions] = useState<
    GenericOptionDraft[]
  >([]);
  const [draftExclusions, setDraftExclusions] = useState<ExclusionDraft[]>([]);
  const [draftReservedLeases, setDraftReservedLeases] = useState<
    ReservedLeaseDraft[]
  >([]);
  const [draftBlockLocallyAdministered, setDraftBlockLocallyAdministered] =
    useState<boolean>(false);
  const [draftIgnoreClientIdentifier, setDraftIgnoreClientIdentifier] =
    useState<boolean>(false);
  const [draftScopeEnabled, setDraftScopeEnabled] = useState<boolean>(false);
  const [baselineScopeEnabled, setBaselineScopeEnabled] =
    useState<boolean>(false);
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateMessage, setUpdateMessage] = useState<string | undefined>();
  const [updateError, setUpdateError] = useState<string | undefined>();

  // Baseline scope for dirty detection (stored as serialized JSON string)
  const [baselineJson, setBaselineJson] = useState<string | undefined>();
  const [showChangesSummary, setShowChangesSummary] = useState(false);
  const needsBaselineCaptureRef = useRef(false);

  // Bulk sync state
  const [showBulkSyncModal, setShowBulkSyncModal] = useState(false);
  const [bulkSyncInProgress, setBulkSyncInProgress] = useState(false);
  const [bulkSyncResult, setBulkSyncResult] =
    useState<DhcpBulkSyncResult | null>(null);
  const [showBulkSyncResults, setShowBulkSyncResults] = useState(false);
  const [showSnapshotDrawer, setShowSnapshotDrawer] = useState(false);

  // Bulk sync form state (inline in tab)
  const [bulkSyncSourceNodeId, setBulkSyncSourceNodeId] = useState<string>(
    () => nodes[0]?.id ?? "",
  );
  const [bulkSyncTargetNodeIds, setBulkSyncTargetNodeIds] = useState<string[]>(
    [],
  );
  const [bulkSyncStrategy, setBulkSyncStrategy] =
    useState<DhcpBulkSyncStrategy>("skip-existing");
  const [bulkSyncEnableOnTarget, setBulkSyncEnableOnTarget] =
    useState<boolean>(false);

  // Bulk sync preview state
  const [bulkSyncSourceScopes, setBulkSyncSourceScopes] = useState<
    TechnitiumDhcpScopeSummary[]
  >([]);
  const [bulkSyncSourceScopesLoading, setBulkSyncSourceScopesLoading] =
    useState(false);
  const [bulkSyncTargetScopes, setBulkSyncTargetScopes] = useState<
    Map<string, TechnitiumDhcpScopeSummary[]>
  >(new Map());
  const [bulkSyncExpandedScopes, setBulkSyncExpandedScopes] = useState<
    Set<string>
  >(new Set());

  // Bulk sync scope details for diff preview (lazy-loaded when expanded)
  const [bulkSyncSourceScopeDetails, setBulkSyncSourceScopeDetails] = useState<
    Map<string, TechnitiumDhcpScope>
  >(new Map());
  const [bulkSyncTargetScopeDetails, setBulkSyncTargetScopeDetails] = useState<
    Map<string, TechnitiumDhcpScope>
  >(new Map());
  const [bulkSyncScopeDetailsLoading, setBulkSyncScopeDetailsLoading] =
    useState<Set<string>>(new Set());

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string | React.ReactNode;
    variant: "danger" | "warning" | "info";
    confirmLabel: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: "",
    message: "",
    variant: "warning",
    confirmLabel: "Confirm",
    onConfirm: () => {},
  });

  const closeConfirmModal = useCallback(() => {
    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const selectedNodeLabel = selectedNode?.name || selectedNodeId || "—";

  // Bulk sync computed values
  const bulkSyncAvailableTargets = useMemo(() => {
    return nodes.filter((node) => node.id !== bulkSyncSourceNodeId);
  }, [nodes, bulkSyncSourceNodeId]);

  const bulkSyncCanStart = useMemo(() => {
    return (
      bulkSyncSourceNodeId &&
      bulkSyncTargetNodeIds.length > 0 &&
      !bulkSyncInProgress
    );
  }, [bulkSyncSourceNodeId, bulkSyncTargetNodeIds.length, bulkSyncInProgress]);

  const failClone = useCallback(
    (message: string) => {
      setCloneState("error");
      setCloneError(message);
      setCloneMessage(undefined);
      pushToast({ message, tone: "error", timeout: 6000 });
    },
    [pushToast],
  );

  const failUpdate = useCallback(
    (message: string) => {
      setUpdateState("error");
      setUpdateError(message);
      setUpdateMessage(undefined);
      pushToast({ message, tone: "error", timeout: 6000 });
    },
    [pushToast],
  );

  // Pull-to-refresh functionality
  const handlePullToRefresh = useCallback(async () => {
    if (selectedNodeId) {
      try {
        const envelope = await loadDhcpScopes(selectedNodeId);
        const nextScopes = envelope.data?.scopes ?? [];
        setScopes(nextScopes);
      } catch (error) {
        // Silently fail on refresh - user can retry
        console.error("Failed to refresh DHCP scopes:", error);
      }
    }
  }, [loadDhcpScopes, selectedNodeId]);

  const pullToRefresh = usePullToRefresh({
    onRefresh: handlePullToRefresh,
    threshold: 80,
    disabled: !selectedNodeId,
  });

  const syncDraftWithScope = (scope?: TechnitiumDhcpScope) => {
    if (!scope) {
      // Clear baseline when no scope
      setBaselineJson(undefined);
      needsBaselineCaptureRef.current = false;
      setDraftStartingAddress("");
      setDraftEndingAddress("");
      setDraftSubnetMask("");
      setDraftRouterAddress("");
      setDraftDnsServers("");
      setDraftDomainName("");
      setDraftDomainSearchList("");
      setDraftLeaseDays("");
      setDraftLeaseHours("");
      setDraftLeaseMinutes("");
      setDraftAllowOnlyReserved(false);
      setDraftOfferDelay("");
      setDraftPingCheckEnabled(false);
      setDraftPingTimeout("");
      setDraftPingRetries("");
      setDraftDnsUpdates(false);
      setDraftDnsTtl("");
      setDraftServerAddress("");
      setDraftServerHostName("");
      setDraftBootFileName("");
      setDraftUseThisDnsServer(false);
      setDraftWinsServers("");
      setDraftNtpServers("");
      setDraftNtpDomains("");
      setDraftStaticRoutes([]);
      setDraftVendorInfo([]);
      setDraftCapwapControllers("");
      setDraftTftpServers("");
      setCloneStartingAddress("");
      setCloneEndingAddress("");
      setCloneSubnetMask("");
      setCloneRouterAddress("");
      setCloneDnsServers("");
      setCloneDomainName("");
      setCloneDomainSearchList("");
      setCloneUseThisDnsServer(false);
      setDraftGenericOptions([]);
      setDraftExclusions([]);
      setDraftReservedLeases([]);
      setDraftBlockLocallyAdministered(false);
      setDraftIgnoreClientIdentifier(false);
      setCloneStartingAddress("");
      setCloneEndingAddress("");
      setCloneSubnetMask("");
      setCloneRouterAddress("");
      return;
    }

    setDraftStartingAddress(scope.startingAddress ?? "");
    setDraftEndingAddress(scope.endingAddress ?? "");
    setDraftSubnetMask(scope.subnetMask ?? "");
    setDraftRouterAddress(scope.routerAddress ?? "");
    setCloneStartingAddress(scope.startingAddress ?? "");
    setCloneEndingAddress(scope.endingAddress ?? "");
    setCloneSubnetMask(scope.subnetMask ?? "");
    setCloneRouterAddress(scope.routerAddress ?? "");
    setDraftDnsServers((scope.dnsServers ?? []).join("\n"));
    setDraftDomainName(scope.domainName ?? "");
    setDraftDomainSearchList((scope.domainSearchList ?? []).join("\n"));
    setDraftLeaseDays(
      scope.leaseTimeDays !== undefined && scope.leaseTimeDays !== null ?
        String(scope.leaseTimeDays)
      : "",
    );
    setDraftLeaseHours(
      scope.leaseTimeHours !== undefined && scope.leaseTimeHours !== null ?
        String(scope.leaseTimeHours)
      : "",
    );
    setDraftLeaseMinutes(
      scope.leaseTimeMinutes !== undefined && scope.leaseTimeMinutes !== null ?
        String(scope.leaseTimeMinutes)
      : "",
    );
    setDraftAllowOnlyReserved(scope.allowOnlyReservedLeases ?? false);
    setDraftOfferDelay(
      scope.offerDelayTime !== undefined && scope.offerDelayTime !== null ?
        String(scope.offerDelayTime)
      : "",
    );
    setDraftPingCheckEnabled(scope.pingCheckEnabled ?? false);
    setDraftPingTimeout(
      scope.pingCheckTimeout !== undefined && scope.pingCheckTimeout !== null ?
        String(scope.pingCheckTimeout)
      : "",
    );
    setDraftPingRetries(
      scope.pingCheckRetries !== undefined && scope.pingCheckRetries !== null ?
        String(scope.pingCheckRetries)
      : "",
    );
    setDraftDnsUpdates(scope.dnsUpdates ?? false);
    setDraftDnsTtl(
      scope.dnsTtl !== undefined && scope.dnsTtl !== null ?
        String(scope.dnsTtl)
      : "",
    );
    setDraftServerAddress(scope.serverAddress ?? "");
    setDraftServerHostName(scope.serverHostName ?? "");
    setDraftBootFileName(scope.bootFileName ?? "");
    setDraftUseThisDnsServer(scope.useThisDnsServer ?? false);
    setDraftWinsServers((scope.winsServers ?? []).join("\n"));
    setDraftNtpServers((scope.ntpServers ?? []).join("\n"));
    setDraftNtpDomains((scope.ntpServerDomainNames ?? []).join("\n"));
    setDraftStaticRoutes(
      (scope.staticRoutes ?? []).map((route) => buildStaticRouteDraft(route)),
    );
    setDraftVendorInfo(
      (scope.vendorInfo ?? []).map((entry) => buildVendorInfoDraft(entry)),
    );
    setDraftCapwapControllers((scope.capwapAcIpAddresses ?? []).join("\n"));
    setDraftTftpServers((scope.tftpServerAddresses ?? []).join("\n"));
    setDraftGenericOptions(
      (scope.genericOptions ?? []).map((option) =>
        buildGenericOptionDraft(option),
      ),
    );
    setDraftExclusions(
      (scope.exclusions ?? []).map((entry) => buildExclusionDraft(entry)),
    );
    setDraftReservedLeases(
      (scope.reservedLeases ?? []).map((entry) =>
        buildReservedLeaseDraft(entry),
      ),
    );
    setDraftBlockLocallyAdministered(
      scope.blockLocallyAdministeredMacAddresses ?? false,
    );
    setDraftIgnoreClientIdentifier(scope.ignoreClientIdentifierOption ?? false);
    setCloneStartingAddress(scope.startingAddress ?? "");
    setCloneEndingAddress(scope.endingAddress ?? "");
    setCloneSubnetMask(scope.subnetMask ?? "");
    setCloneRouterAddress(scope.routerAddress ?? "");
    setCloneDnsServers((scope.dnsServers ?? []).join("\n"));
    setCloneDomainName(scope.domainName ?? "");
    setCloneDomainSearchList((scope.domainSearchList ?? []).join("\n"));
    setCloneUseThisDnsServer(scope.useThisDnsServer ?? false);

    // Mark that we need to capture baseline after state updates
    needsBaselineCaptureRef.current = true;
  };

  // Serialize draft fields back to a scope object for comparison
  const serializeDraftToScope = useCallback(():
    | Partial<TechnitiumDhcpScope>
    | undefined => {
    if (!currentScope) return undefined;

    const staticRoutesSanitized = sanitizeStaticRoutes(draftStaticRoutes);
    const vendorInfoSanitized = sanitizeVendorInfo(draftVendorInfo);
    const genericOptionsSanitized = sanitizeGenericOptions(draftGenericOptions);
    const exclusionsSanitized = sanitizeExclusions(draftExclusions);
    const reservedLeasesSanitized = sanitizeReservedLeases(draftReservedLeases);

    return {
      name: currentScope.name,
      startingAddress:
        draftStartingAddress.trim() || currentScope.startingAddress,
      endingAddress: draftEndingAddress.trim() || currentScope.endingAddress,
      subnetMask: draftSubnetMask.trim() || currentScope.subnetMask,
      leaseTimeDays: parseLeaseComponent(draftLeaseDays),
      leaseTimeHours: parseLeaseComponent(draftLeaseHours),
      leaseTimeMinutes: parseLeaseComponent(draftLeaseMinutes),
      offerDelayTime: parseLeaseComponent(draftOfferDelay),
      pingCheckEnabled: draftPingCheckEnabled,
      pingCheckTimeout:
        draftPingCheckEnabled ?
          parseLeaseComponent(draftPingTimeout)
        : undefined,
      pingCheckRetries:
        draftPingCheckEnabled ?
          parseLeaseComponent(draftPingRetries)
        : undefined,
      dnsUpdates: draftDnsUpdates,
      dnsTtl: draftDnsUpdates ? parseLeaseComponent(draftDnsTtl) : undefined,
      domainName: draftDomainName.trim() || undefined,
      domainSearchList: splitListInput(draftDomainSearchList),
      useThisDnsServer: draftUseThisDnsServer,
      dnsServers:
        draftUseThisDnsServer ? undefined : splitListInput(draftDnsServers),
      routerAddress: draftRouterAddress.trim() || undefined,
      serverAddress: draftServerAddress.trim() || undefined,
      serverHostName: draftServerHostName.trim() || undefined,
      bootFileName: draftBootFileName.trim() || undefined,
      winsServers: splitListInput(draftWinsServers),
      ntpServers: splitListInput(draftNtpServers),
      ntpServerDomainNames: splitListInput(draftNtpDomains),
      staticRoutes: staticRoutesSanitized.values,
      vendorInfo: vendorInfoSanitized.values,
      capwapAcIpAddresses: splitListInput(draftCapwapControllers),
      tftpServerAddresses: splitListInput(draftTftpServers),
      genericOptions: genericOptionsSanitized.values,
      exclusions: exclusionsSanitized.values,
      reservedLeases: reservedLeasesSanitized.values,
      allowOnlyReservedLeases: draftAllowOnlyReserved,
      blockLocallyAdministeredMacAddresses: draftBlockLocallyAdministered,
      ignoreClientIdentifierOption: draftIgnoreClientIdentifier,
    };
  }, [
    currentScope,
    draftStartingAddress,
    draftEndingAddress,
    draftSubnetMask,
    draftLeaseDays,
    draftLeaseHours,
    draftLeaseMinutes,
    draftOfferDelay,
    draftPingCheckEnabled,
    draftPingTimeout,
    draftPingRetries,
    draftDnsUpdates,
    draftDnsTtl,
    draftDomainName,
    draftDomainSearchList,
    draftUseThisDnsServer,
    draftDnsServers,
    draftRouterAddress,
    draftServerAddress,
    draftServerHostName,
    draftBootFileName,
    draftWinsServers,
    draftNtpServers,
    draftNtpDomains,
    draftStaticRoutes,
    draftVendorInfo,
    draftCapwapControllers,
    draftTftpServers,
    draftGenericOptions,
    draftExclusions,
    draftReservedLeases,
    draftAllowOnlyReserved,
    draftBlockLocallyAdministered,
    draftIgnoreClientIdentifier,
  ]);
  const handleSnapshotRestoreSuccess = useCallback(
    async (nodeId: string) => {
      try {
        const envelope = await loadDhcpScopes(nodeId);
        const nextScopes = envelope.data?.scopes ?? [];

        setScopeCountByNode((prev) => {
          const next = new Map(prev);
          next.set(nodeId, nextScopes.length);
          return next;
        });

        if (nodeId === selectedNodeId) {
          setScopes(nextScopes);

          const stillExists = nextScopes.some(
            (scope) => scope.name === selectedScopeName,
          );
          const nextSelected =
            stillExists ? selectedScopeName : nextScopes[0]?.name;

          if (!stillExists) {
            setSelectedScopeName(nextSelected);
            setCurrentScope(undefined);
          }

          // Clear cached scope details for this node
          setDetailCache((prev) => {
            const next = new Map(prev);
            const prefix = `${nodeId.toLowerCase()}::`;
            for (const key of Array.from(next.keys())) {
              if (key.startsWith(prefix)) {
                next.delete(key);
              }
            }
            return next;
          });

          // Reload current scope details to reflect restored state
          if (nextSelected) {
            try {
              const scopeEnvelope = await loadDhcpScope(nodeId, nextSelected);
              setCurrentScope(scopeEnvelope.data);
              syncDraftWithScope(scopeEnvelope.data);

              const nextSummary = nextScopes.find(
                (scope) => scope.name === nextSelected,
              );
              const nextEnabled = nextSummary?.enabled ?? false;
              setBaselineScopeEnabled(nextEnabled);
              setDraftScopeEnabled(nextEnabled);
              setBaselineJson(JSON.stringify(scopeEnvelope.data));
            } catch (detailError) {
              console.warn("Failed to reload scope after restore", detailError);
            }
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ?
            error.message
          : "Failed to refresh scopes after snapshot restore.";
        pushToast({ message, tone: "info", timeout: 6000 });
      }
    },
    [
      loadDhcpScopes,
      loadDhcpScope,
      selectedNodeId,
      selectedScopeName,
      setScopes,
      syncDraftWithScope,
      setBaselineScopeEnabled,
      setDraftScopeEnabled,
      setBaselineJson,
      pushToast,
    ],
  );

  // Capture baseline after draft state is fully updated
  useEffect(() => {
    if (needsBaselineCaptureRef.current && currentScope) {
      const serialized = serializeDraftToScope();
      if (serialized) {
        setBaselineJson(JSON.stringify(serialized));
        needsBaselineCaptureRef.current = false;
      }
    }
  }, [currentScope, serializeDraftToScope]);

  // Check if scope enabled state differs from baseline
  const isScopeEnabledDirty = draftScopeEnabled !== baselineScopeEnabled;

  // Detect macOS for keyboard shortcut display
  type NavigatorWithUserAgentData = Navigator & {
    userAgentData?: { platform?: string };
  };
  const navWithUserAgent = navigator as NavigatorWithUserAgentData;
  const isMac =
    typeof navigator !== "undefined" &&
    // userAgentData is available in newer browsers; prefer its platform when present
    (navWithUserAgent.userAgentData?.platform?.toLowerCase().includes("mac") ||
      // fall back to userAgent string parsing (navigator.platform is deprecated)
      (typeof navigator.userAgent === "string" &&
        /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)));
  const saveShortcut = isMac ? "⌘S" : "Ctrl+S";

  // Check if draft differs from baseline
  const isDirty = useMemo(() => {
    if (!baselineJson || !currentScope) return isScopeEnabledDirty;
    const draftScope = serializeDraftToScope();
    if (!draftScope) return isScopeEnabledDirty;

    // Compare JSON representations + scope enabled state
    return baselineJson !== JSON.stringify(draftScope) || isScopeEnabledDirty;
  }, [baselineJson, currentScope, serializeDraftToScope, isScopeEnabledDirty]);

  // Warn user before leaving page if there are unsaved changes
  useNavigationBlocker(
    isDirty,
    "You have unsaved changes in DHCP Scope Configuration. Are you sure you want to leave? Your changes will be lost.",
  );

  // Handle tab switching with unsaved changes warning
  const handleTabChange = useCallback(
    (newTab: DhcpTabMode) => {
      if (isDirty && activeTab === "scope-details") {
        setConfirmModal({
          isOpen: true,
          title: "Unsaved Changes",
          message:
            "You have unsaved changes in Scope Configuration. If you switch tabs now, your changes will be lost.\n\nDo you want to discard your changes?",
          variant: "warning",
          confirmLabel: "Discard Changes",
          onConfirm: () => {
            closeConfirmModal();
            setActiveTab(newTab);
          },
        });
        return;
      }
      setActiveTab(newTab);
    },
    [isDirty, activeTab, closeConfirmModal],
  );

  // Handle scope selection with unsaved changes warning
  const handleScopeSelect = useCallback(
    (scopeName: string) => {
      if (isDirty) {
        setConfirmModal({
          isOpen: true,
          title: "Unsaved Changes",
          message:
            "You have unsaved changes for the current scope. If you select a different scope now, your changes will be lost.\n\nDo you want to discard your changes?",
          variant: "warning",
          confirmLabel: "Discard Changes",
          onConfirm: () => {
            closeConfirmModal();
            setSelectedScopeName(scopeName);
          },
        });
        return;
      }
      setSelectedScopeName(scopeName);
    },
    [isDirty, closeConfirmModal],
  );

  // Handle node selection with unsaved changes warning
  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      if (isDirty) {
        setConfirmModal({
          isOpen: true,
          title: "Unsaved Changes",
          message:
            "You have unsaved changes for the current scope. If you switch nodes now, your changes will be lost.\n\nDo you want to discard your changes?",
          variant: "warning",
          confirmLabel: "Discard Changes",
          onConfirm: () => {
            closeConfirmModal();
            setSelectedNodeId(nodeId);
          },
        });
        return;
      }
      setSelectedNodeId(nodeId);
    },
    [isDirty, closeConfirmModal],
  );

  // Compute pending changes for display
  const pendingChanges = useMemo(() => {
    if (!isDirty || !baselineJson || !currentScope) return [];

    // Parse baseline from JSON string
    const baselineScope = JSON.parse(
      baselineJson,
    ) as Partial<TechnitiumDhcpScope>;

    const changes: Array<{
      type: "added" | "removed" | "modified";
      category: string;
      description: string;
      detail?: string;
    }> = [];
    const draftScope = serializeDraftToScope();
    if (!draftScope) return [];

    // Scope enabled/disabled state
    if (isScopeEnabledDirty) {
      changes.push({
        type: "modified",
        category: "Scope Status",
        description:
          draftScopeEnabled ?
            "Enable scope on this node"
          : "Disable scope on this node",
      });
    }

    // Basic settings
    if (draftScope.startingAddress !== baselineScope.startingAddress) {
      changes.push({
        type: "modified",
        category: "IP Range",
        description: `Starting address: ${baselineScope.startingAddress} → ${draftScope.startingAddress}`,
      });
    }

    if (draftScope.endingAddress !== baselineScope.endingAddress) {
      changes.push({
        type: "modified",
        category: "IP Range",
        description: `Ending address: ${baselineScope.endingAddress} → ${draftScope.endingAddress}`,
      });
    }

    if (draftScope.subnetMask !== baselineScope.subnetMask) {
      changes.push({
        type: "modified",
        category: "Network",
        description: `Subnet mask: ${baselineScope.subnetMask} → ${draftScope.subnetMask}`,
      });
    }

    if (draftScope.routerAddress !== baselineScope.routerAddress) {
      changes.push({
        type: "modified",
        category: "Network",
        description: `Router: ${baselineScope.routerAddress || "none"} → ${draftScope.routerAddress || "none"}`,
      });
    }

    // Lease time
    if (
      draftScope.leaseTimeDays !== baselineScope.leaseTimeDays ||
      draftScope.leaseTimeHours !== baselineScope.leaseTimeHours ||
      draftScope.leaseTimeMinutes !== baselineScope.leaseTimeMinutes
    ) {
      changes.push({
        type: "modified",
        category: "Lease Duration",
        description: `Changed from ${formatLeaseDuration(baselineScope as TechnitiumDhcpScope)} to ${formatLeaseDuration(draftScope as TechnitiumDhcpScope)}`,
      });
    }

    // DNS settings
    if (draftScope.useThisDnsServer !== baselineScope.useThisDnsServer) {
      changes.push({
        type: "modified",
        category: "DNS",
        description:
          draftScope.useThisDnsServer ?
            "Changed to use this node as the DNS server"
          : "Changed to use custom DNS servers",
      });
    }

    // DNS servers - detailed diff (only when not using this DNS server)
    if (!draftScope.useThisDnsServer) {
      const baselineDnsServers = baselineScope.dnsServers || [];
      const draftDnsServers = draftScope.dnsServers || [];

      // Show changes by position - pair up old and new values
      const maxLen = Math.max(
        baselineDnsServers.length,
        draftDnsServers.length,
      );
      for (let i = 0; i < maxLen; i++) {
        const oldServer = baselineDnsServers[i];
        const newServer = draftDnsServers[i];

        if (oldServer !== newServer) {
          if (oldServer && newServer) {
            // Modified at this position
            changes.push({
              type: "modified",
              category: "DNS",
              description: `DNS server: ${oldServer} → ${newServer}`,
            });
          } else if (newServer && !oldServer) {
            // Added
            changes.push({
              type: "added",
              category: "DNS",
              description: "DNS server",
              detail: newServer,
            });
          } else if (oldServer && !newServer) {
            // Removed
            changes.push({
              type: "removed",
              category: "DNS",
              description: "DNS server",
              detail: oldServer,
            });
          }
        }
      }
    }

    if (draftScope.domainName !== baselineScope.domainName) {
      changes.push({
        type: "modified",
        category: "DNS",
        description: `Domain suffix: ${baselineScope.domainName || "none"} → ${draftScope.domainName || "none"}`,
      });
    }

    // Domain search list - detailed diff
    const baselineSearchList = baselineScope.domainSearchList || [];
    const draftSearchList = draftScope.domainSearchList || [];

    // Show changes by position - pair up old and new values
    const maxSearchLen = Math.max(
      baselineSearchList.length,
      draftSearchList.length,
    );
    for (let i = 0; i < maxSearchLen; i++) {
      const oldDomain = baselineSearchList[i];
      const newDomain = draftSearchList[i];

      if (oldDomain !== newDomain) {
        if (oldDomain && newDomain) {
          // Modified at this position
          changes.push({
            type: "modified",
            category: "DNS",
            description: `Domain search list: ${oldDomain} → ${newDomain}`,
          });
        } else if (newDomain && !oldDomain) {
          // Added
          changes.push({
            type: "added",
            category: "DNS",
            description: "Domain search list",
            detail: newDomain,
          });
        } else if (oldDomain && !newDomain) {
          // Removed
          changes.push({
            type: "removed",
            category: "DNS",
            description: "Domain search list",
            detail: oldDomain,
          });
        }
      }
    }

    // Reserved leases - detailed diff
    const baselineReserved = baselineScope.reservedLeases || [];
    const draftReserved = draftScope.reservedLeases || [];

    // Create maps for comparison (key = MAC address, which is the unique identifier)
    // Multiple reservations can share the same hostname but must have unique MACs
    const baselineReservedMap = new Map(
      baselineReserved.map((r) => [r.hardwareAddress, r]),
    );
    const draftReservedMap = new Map(
      draftReserved.map((r) => [r.hardwareAddress, r]),
    );

    // Find added reservations
    draftReserved.forEach((reservation) => {
      const key = reservation.hardwareAddress;
      if (!baselineReservedMap.has(key)) {
        changes.push({
          type: "added",
          category: "Reservations",
          description: reservation.hostName || "Unnamed reservation",
          detail: `${reservation.hardwareAddress} → ${reservation.address}`,
        });
      }
    });

    // Find removed reservations
    baselineReserved.forEach((reservation) => {
      const key = reservation.hardwareAddress;
      if (!draftReservedMap.has(key)) {
        changes.push({
          type: "removed",
          category: "Reservations",
          description: reservation.hostName || "Unnamed reservation",
          detail: `${reservation.hardwareAddress} → ${reservation.address}`,
        });
      }
    });

    // Find modified reservations
    draftReserved.forEach((draftRes) => {
      const key = draftRes.hardwareAddress;
      const baselineRes = baselineReservedMap.get(key);
      if (
        baselineRes &&
        JSON.stringify(baselineRes) !== JSON.stringify(draftRes)
      ) {
        // Determine what changed
        const changedFields: string[] = [];
        if (baselineRes.address !== draftRes.address) {
          changedFields.push(
            `IP: ${baselineRes.address} → ${draftRes.address}`,
          );
        }
        if (baselineRes.hardwareAddress !== draftRes.hardwareAddress) {
          changedFields.push(
            `MAC: ${baselineRes.hardwareAddress} → ${draftRes.hardwareAddress}`,
          );
        }
        if ((baselineRes.hostName || "") !== (draftRes.hostName || "")) {
          changedFields.push(
            `Name: ${baselineRes.hostName || "(none)"} → ${draftRes.hostName || "(none)"}`,
          );
        }
        if ((baselineRes.comments || "") !== (draftRes.comments || "")) {
          changedFields.push(
            `Comments: ${baselineRes.comments || "(none)"} → ${draftRes.comments || "(none)"}`,
          );
        }

        changes.push({
          type: "modified",
          category: "Reservations",
          description: draftRes.hostName || draftRes.hardwareAddress,
          detail: changedFields.join(", "),
        });
      }
    });

    // Exclusions - detailed diff
    const baselineExclusions = baselineScope.exclusions || [];
    const draftExclusions = draftScope.exclusions || [];

    // Compare exclusions as strings
    const baselineExclusionStrs = new Set(
      baselineExclusions.map((e) => `${e.startingAddress}-${e.endingAddress}`),
    );
    const draftExclusionStrs = new Set(
      draftExclusions.map((e) => `${e.startingAddress}-${e.endingAddress}`),
    );

    draftExclusions.forEach((exclusion) => {
      const str = `${exclusion.startingAddress}-${exclusion.endingAddress}`;
      if (!baselineExclusionStrs.has(str)) {
        changes.push({
          type: "added",
          category: "Exclusions",
          description: "Exclusion range",
          detail: `${exclusion.startingAddress} - ${exclusion.endingAddress}`,
        });
      }
    });

    baselineExclusions.forEach((exclusion) => {
      const str = `${exclusion.startingAddress}-${exclusion.endingAddress}`;
      if (!draftExclusionStrs.has(str)) {
        changes.push({
          type: "removed",
          category: "Exclusions",
          description: "Exclusion range",
          detail: `${exclusion.startingAddress} - ${exclusion.endingAddress}`,
        });
      }
    });

    // Static routes - detailed diff
    const baselineRoutes = baselineScope.staticRoutes || [];
    const draftRoutes = draftScope.staticRoutes || [];

    const baselineRouteStrs = new Set(
      baselineRoutes.map(
        (r) => `${r.destination}/${r.subnetMask}->${r.router}`,
      ),
    );
    const draftRouteStrs = new Set(
      draftRoutes.map((r) => `${r.destination}/${r.subnetMask}->${r.router}`),
    );

    draftRoutes.forEach((route) => {
      const str = `${route.destination}/${route.subnetMask}->${route.router}`;
      if (!baselineRouteStrs.has(str)) {
        changes.push({
          type: "added",
          category: "Static Routes",
          description: `Route to ${route.destination}`,
          detail: `via ${route.router} (mask: ${route.subnetMask})`,
        });
      }
    });

    baselineRoutes.forEach((route) => {
      const str = `${route.destination}/${route.subnetMask}->${route.router}`;
      if (!draftRouteStrs.has(str)) {
        changes.push({
          type: "removed",
          category: "Static Routes",
          description: `Route to ${route.destination}`,
          detail: `via ${route.router} (mask: ${route.subnetMask})`,
        });
      }
    });

    // Options changes
    if (
      draftScope.allowOnlyReservedLeases !==
      baselineScope.allowOnlyReservedLeases
    ) {
      changes.push({
        type: "modified",
        category: "Options",
        description:
          draftScope.allowOnlyReservedLeases ?
            "Enabled: Allow only reserved leases"
          : "Disabled: Allow only reserved leases",
      });
    }

    if (
      draftScope.blockLocallyAdministeredMacAddresses !==
      baselineScope.blockLocallyAdministeredMacAddresses
    ) {
      changes.push({
        type: "modified",
        category: "Options",
        description:
          draftScope.blockLocallyAdministeredMacAddresses ?
            "Enabled: Block locally administered MACs"
          : "Disabled: Block locally administered MACs",
      });
    }

    if (
      draftScope.ignoreClientIdentifierOption !==
      baselineScope.ignoreClientIdentifierOption
    ) {
      changes.push({
        type: "modified",
        category: "Options",
        description:
          draftScope.ignoreClientIdentifierOption ?
            "Enabled: Ignore client identifier option"
          : "Disabled: Ignore client identifier option",
      });
    }

    if (draftScope.pingCheckEnabled !== baselineScope.pingCheckEnabled) {
      changes.push({
        type: "modified",
        category: "Options",
        description:
          draftScope.pingCheckEnabled ? "Enabled ping check" : (
            "Disabled ping check"
          ),
      });
    }

    // Ping check settings (only show when ping check stays enabled - otherwise the main toggle explains it)
    if (draftScope.pingCheckEnabled && baselineScope.pingCheckEnabled) {
      if (draftScope.pingCheckTimeout !== baselineScope.pingCheckTimeout) {
        changes.push({
          type: "modified",
          category: "Options",
          description: `Ping timeout: ${baselineScope.pingCheckTimeout ?? 0}ms → ${draftScope.pingCheckTimeout ?? 0}ms`,
        });
      }

      if (draftScope.pingCheckRetries !== baselineScope.pingCheckRetries) {
        changes.push({
          type: "modified",
          category: "Options",
          description: `Ping retries: ${baselineScope.pingCheckRetries ?? 0} → ${draftScope.pingCheckRetries ?? 0}`,
        });
      }
    }

    if (draftScope.dnsUpdates !== baselineScope.dnsUpdates) {
      changes.push({
        type: "modified",
        category: "Options",
        description:
          draftScope.dnsUpdates ?
            "Enabled DNS updates"
          : "Disabled DNS updates",
      });
    }

    // DNS TTL (only show when DNS updates stays enabled - otherwise the main toggle explains it)
    if (draftScope.dnsUpdates && baselineScope.dnsUpdates) {
      if (draftScope.dnsTtl !== baselineScope.dnsTtl) {
        changes.push({
          type: "modified",
          category: "DNS",
          description: `DNS TTL: ${baselineScope.dnsTtl ?? 0}s → ${draftScope.dnsTtl ?? 0}s`,
        });
      }
    }

    // Offer delay time
    if (draftScope.offerDelayTime !== baselineScope.offerDelayTime) {
      changes.push({
        type: "modified",
        category: "Options",
        description: `Offer delay: ${baselineScope.offerDelayTime ?? 0}ms → ${draftScope.offerDelayTime ?? 0}ms`,
      });
    }

    // Server identity settings
    if (draftScope.serverAddress !== baselineScope.serverAddress) {
      changes.push({
        type: "modified",
        category: "Server Identity",
        description: `Server address: ${baselineScope.serverAddress || "auto"} → ${draftScope.serverAddress || "auto"}`,
      });
    }

    if (draftScope.serverHostName !== baselineScope.serverHostName) {
      changes.push({
        type: "modified",
        category: "Server Identity",
        description: `Server hostname: ${baselineScope.serverHostName || "none"} → ${draftScope.serverHostName || "none"}`,
      });
    }

    if (draftScope.bootFileName !== baselineScope.bootFileName) {
      changes.push({
        type: "modified",
        category: "Server Identity",
        description: `Boot file: ${baselineScope.bootFileName || "none"} → ${draftScope.bootFileName || "none"}`,
      });
    }

    // Ancillary services arrays
    const compareArrayChanges = (
      baseline: string[] | undefined,
      draft: string[] | undefined,
      category: string,
      itemLabel: string,
    ) => {
      const baseArr = baseline || [];
      const draftArr = draft || [];
      const baseSet = new Set(baseArr);
      const draftSet = new Set(draftArr);

      draftArr.forEach((item) => {
        if (!baseSet.has(item)) {
          changes.push({
            type: "added",
            category,
            description: itemLabel,
            detail: item,
          });
        }
      });

      baseArr.forEach((item) => {
        if (!draftSet.has(item)) {
          changes.push({
            type: "removed",
            category,
            description: itemLabel,
            detail: item,
          });
        }
      });
    };

    compareArrayChanges(
      baselineScope.winsServers,
      draftScope.winsServers,
      "Ancillary Services",
      "WINS server",
    );
    compareArrayChanges(
      baselineScope.ntpServers,
      draftScope.ntpServers,
      "Ancillary Services",
      "NTP server",
    );
    compareArrayChanges(
      baselineScope.ntpServerDomainNames,
      draftScope.ntpServerDomainNames,
      "Ancillary Services",
      "NTP domain",
    );
    compareArrayChanges(
      baselineScope.capwapAcIpAddresses,
      draftScope.capwapAcIpAddresses,
      "Ancillary Services",
      "CAPWAP controller",
    );
    compareArrayChanges(
      baselineScope.tftpServerAddresses,
      draftScope.tftpServerAddresses,
      "Ancillary Services",
      "TFTP server",
    );

    // Vendor info
    const baselineVendor = baselineScope.vendorInfo || [];
    const draftVendor = draftScope.vendorInfo || [];
    const baselineVendorStrs = new Set(
      baselineVendor.map((v) => `${v.identifier}:${v.information}`),
    );
    const draftVendorStrs = new Set(
      draftVendor.map((v) => `${v.identifier}:${v.information}`),
    );

    draftVendor.forEach((v) => {
      const str = `${v.identifier}:${v.information}`;
      if (!baselineVendorStrs.has(str)) {
        changes.push({
          type: "added",
          category: "Vendor Info",
          description: v.identifier,
          detail: v.information,
        });
      }
    });
    baselineVendor.forEach((v) => {
      const str = `${v.identifier}:${v.information}`;
      if (!draftVendorStrs.has(str)) {
        changes.push({
          type: "removed",
          category: "Vendor Info",
          description: v.identifier,
          detail: v.information,
        });
      }
    });

    // Generic options
    const baselineGeneric = baselineScope.genericOptions || [];
    const draftGeneric = draftScope.genericOptions || [];
    const baselineGenericStrs = new Set(
      baselineGeneric.map((g) => `${g.code}:${g.value}`),
    );
    const draftGenericStrs = new Set(
      draftGeneric.map((g) => `${g.code}:${g.value}`),
    );

    draftGeneric.forEach((g) => {
      const str = `${g.code}:${g.value}`;
      if (!baselineGenericStrs.has(str)) {
        changes.push({
          type: "added",
          category: "Generic Options",
          description: `Option ${g.code}`,
          detail: g.value,
        });
      }
    });
    baselineGeneric.forEach((g) => {
      const str = `${g.code}:${g.value}`;
      if (!draftGenericStrs.has(str)) {
        changes.push({
          type: "removed",
          category: "Generic Options",
          description: `Option ${g.code}`,
          detail: g.value,
        });
      }
    });

    return changes;
  }, [
    isDirty,
    baselineJson,
    currentScope,
    serializeDraftToScope,
    isScopeEnabledDirty,
    draftScopeEnabled,
  ]);

  const pendingChangesNote = useMemo(() => {
    if (pendingChanges.length === 0) return undefined;

    const noteParts = pendingChanges.map((change) => {
      const detailText = change.detail ? ` (${change.detail})` : "";
      return `${change.category}: ${change.description}${detailText}`;
    });

    const note = "Auto-captured before:\n" + noteParts.join(" | ");
    const MAX_NOTE_LENGTH = 950;
    return note.length > MAX_NOTE_LENGTH ?
        `${note.slice(0, MAX_NOTE_LENGTH)}…`
      : note;
  }, [pendingChanges]);

  const handleAddStaticRoute = () => {
    setDraftStaticRoutes((previous) => [...previous, buildStaticRouteDraft()]);
  };

  const handleStaticRouteChange = (
    id: string,
    key: keyof TechnitiumDhcpStaticRoute,
    value: string,
  ) => {
    setDraftStaticRoutes((previous) =>
      previous.map((route) =>
        route.id === id ? { ...route, [key]: value } : route,
      ),
    );
  };

  const handleRemoveStaticRoute = (id: string) => {
    setDraftStaticRoutes((previous) =>
      previous.filter((route) => route.id !== id),
    );
  };

  const handleAddVendorInfo = () => {
    setDraftVendorInfo((previous) => [...previous, buildVendorInfoDraft()]);
  };

  const handleVendorInfoChange = (
    id: string,
    key: "identifier" | "information",
    value: string,
  ) => {
    setDraftVendorInfo((previous) =>
      previous.map((entry) =>
        entry.id === id ? { ...entry, [key]: value } : entry,
      ),
    );
  };

  const handleRemoveVendorInfo = (id: string) => {
    setDraftVendorInfo((previous) =>
      previous.filter((entry) => entry.id !== id),
    );
  };

  const handleAddGenericOption = () => {
    setDraftGenericOptions((previous) => [
      ...previous,
      buildGenericOptionDraft(),
    ]);
  };

  const handleGenericOptionChange = (
    id: string,
    key: "code" | "value",
    value: string,
  ) => {
    setDraftGenericOptions((previous) =>
      previous.map((entry) =>
        entry.id === id ? { ...entry, [key]: value } : entry,
      ),
    );
  };

  const handleGenericOptionModeChange = (id: string, mode: "ascii" | "hex") => {
    setDraftGenericOptions((previous) =>
      previous.map((entry) => {
        if (entry.id !== id || entry.mode === mode) {
          return entry;
        }

        if (mode === "ascii") {
          const normalized = normalizeHexValue(entry.value);
          if (!normalized) {
            pushToast({
              message:
                "Provide a valid HEX sequence before switching to ASCII view.",
              tone: "info",
              timeout: 5000,
            });
            return entry;
          }

          const ascii = hexToAscii(normalized);
          if (ascii === undefined || !isPrintableAscii(ascii)) {
            pushToast({
              message:
                "HEX value contains non-printable bytes; keeping HEX format.",
              tone: "info",
              timeout: 5000,
            });
            return entry;
          }

          return { ...entry, mode, value: ascii };
        }

        return { ...entry, mode, value: asciiToHex(entry.value) };
      }),
    );
  };

  const handleRemoveGenericOption = (id: string) => {
    setDraftGenericOptions((previous) =>
      previous.filter((entry) => entry.id !== id),
    );
  };

  const handleAddExclusion = () => {
    setDraftExclusions((previous) => [...previous, buildExclusionDraft()]);
  };

  const handleExclusionChange = (
    id: string,
    key: keyof TechnitiumDhcpExclusionRange,
    value: string,
  ) => {
    setDraftExclusions((previous) =>
      previous.map((entry) =>
        entry.id === id ? { ...entry, [key]: value } : entry,
      ),
    );
  };

  const handleRemoveExclusion = (id: string) => {
    setDraftExclusions((previous) =>
      previous.filter((entry) => entry.id !== id),
    );
  };

  const handleAddReservedLease = () => {
    setDraftReservedLeases((previous) => [
      ...previous,
      buildReservedLeaseDraft(),
    ]);
  };

  const handleReservedLeaseChange = (
    id: string,
    key: "hostName" | "hardwareAddress" | "address" | "comments",
    value: string,
  ) => {
    setDraftReservedLeases((previous) =>
      previous.map((entry) =>
        entry.id === id ? { ...entry, [key]: value } : entry,
      ),
    );
  };

  const handleRemoveReservedLease = (id: string) => {
    setDraftReservedLeases((previous) =>
      previous.filter((entry) => entry.id !== id),
    );
  };

  // Reset draft to baseline
  const handleResetChanges = useCallback(() => {
    if (currentScope) {
      syncDraftWithScope(currentScope);
      setDraftScopeEnabled(baselineScopeEnabled);
      setShowChangesSummary(false);
    }
  }, [currentScope, baselineScopeEnabled]);

  // Keyboard shortcuts: Ctrl/Cmd+S to save, Escape to reset
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle shortcuts when on scopes tab with a scope selected
      if (activePageTab !== "scopes" || !selectedScopeName || !currentScope) {
        return;
      }

      // Ctrl+S or Cmd+S to save
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        if (isDirty && updateState !== "loading") {
          // Trigger save by dispatching a custom event that the save button listens to
          const saveButton = document.querySelector(
            "[data-keyboard-save]",
          ) as HTMLButtonElement;
          if (saveButton && !saveButton.disabled) {
            saveButton.click();
          }
        }
        return;
      }

      // Escape to reset changes
      if (event.key === "Escape") {
        // Don't reset if a modal is open or user is typing in an input
        const activeElement = document.activeElement;
        const isInInput =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement instanceof HTMLSelectElement;

        if (!isInInput && isDirty) {
          handleResetChanges();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    activePageTab,
    selectedScopeName,
    currentScope,
    isDirty,
    updateState,
    handleResetChanges,
  ]);

  // Auto-dismiss success message after 5 seconds
  useEffect(() => {
    if (updateState === "success" && updateMessage) {
      const timer = setTimeout(() => {
        setUpdateMessage(undefined);
        setUpdateState("idle");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [updateState, updateMessage]);

  useEffect(() => {
    if (!selectedNodeId && nodes.length > 0) {
      setSelectedNodeId(nodes[0].id);
    }
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    const hasRemoteTargets = nodes.some((node) => node.id !== selectedNodeId);

    if (!hasRemoteTargets && cloneMode === "remote") {
      setCloneMode("local");
    }
  }, [nodes, selectedNodeId, cloneMode]);

  // Helper function to refresh scope counts for all nodes
  const refreshScopeCounts = useCallback(async () => {
    const counts = new Map<string, number>();
    await Promise.all(
      nodes.map(async (node) => {
        try {
          const envelope = await loadDhcpScopes(node.id);
          counts.set(node.id, envelope.data?.scopes?.length ?? 0);
        } catch {
          counts.set(node.id, 0);
        }
      }),
    );
    setScopeCountByNode(counts);
  }, [nodes, loadDhcpScopes]);

  // Load scope counts for all nodes (for node selector cards)
  useEffect(() => {
    if (nodes.length > 0) {
      refreshScopeCounts();
    }
  }, [nodes, refreshScopeCounts]);

  // Load source node scopes for bulk sync preview
  useEffect(() => {
    let cancelled = false;

    // Only load if we're on the bulk sync tab
    if (activePageTab !== "bulk-sync" || !bulkSyncSourceNodeId) {
      setBulkSyncSourceScopes([]);
      return;
    }

    const loadSourceScopes = async () => {
      setBulkSyncSourceScopesLoading(true);
      try {
        const envelope = await loadDhcpScopes(bulkSyncSourceNodeId);
        if (!cancelled) {
          setBulkSyncSourceScopes(envelope.data?.scopes ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setBulkSyncSourceScopes([]);
          console.warn("Failed to load source node scopes for preview", error);
        }
      } finally {
        if (!cancelled) {
          setBulkSyncSourceScopesLoading(false);
        }
      }
    };

    loadSourceScopes();

    return () => {
      cancelled = true;
    };
  }, [activePageTab, bulkSyncSourceNodeId, loadDhcpScopes]);

  // Load target node scopes for bulk sync preview (to show conflicts)
  useEffect(() => {
    let cancelled = false;

    // Only load if we're on the bulk sync tab and have targets selected
    if (activePageTab !== "bulk-sync" || bulkSyncTargetNodeIds.length === 0) {
      setBulkSyncTargetScopes(new Map());
      return;
    }

    const loadTargetScopes = async () => {
      const scopesMap = new Map<string, TechnitiumDhcpScopeSummary[]>();

      await Promise.all(
        bulkSyncTargetNodeIds.map(async (nodeId) => {
          try {
            const envelope = await loadDhcpScopes(nodeId);
            if (!cancelled) {
              scopesMap.set(nodeId, envelope.data?.scopes ?? []);
            }
          } catch (error) {
            if (!cancelled) {
              scopesMap.set(nodeId, []);
              console.warn(
                `Failed to load scopes for target node ${nodeId}`,
                error,
              );
            }
          }
        }),
      );

      if (!cancelled) {
        setBulkSyncTargetScopes(scopesMap);
      }
    };

    loadTargetScopes();

    return () => {
      cancelled = true;
    };
  }, [activePageTab, bulkSyncTargetNodeIds, loadDhcpScopes]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedNodeId) {
      setScopes([]);
      setSelectedScopeName(undefined);
      setScopeListState("idle");
      setScopeListError(undefined);
      return;
    }

    setScopeListState("loading");
    setScopeListError(undefined);

    loadDhcpScopes(selectedNodeId)
      .then((envelope) => {
        if (cancelled) {
          return;
        }

        const nextScopes = envelope.data?.scopes ?? [];
        setScopes(nextScopes);
        setScopeListState("success");

        // Update scope count for this node
        setScopeCountByNode((prev) => {
          const updated = new Map(prev);
          updated.set(selectedNodeId, nextScopes.length);
          return updated;
        });

        setSelectedScopeName((previous) => {
          if (previous && nextScopes.some((scope) => scope.name === previous)) {
            return previous;
          }
          return nextScopes[0]?.name;
        });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setScopes([]);
        setSelectedScopeName(undefined);
        setScopeListState("error");
        setScopeListError(
          error instanceof Error ?
            error.message
          : "Failed to load DHCP scopes.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, loadDhcpScopes]);

  useEffect(() => {
    if (cloneMode !== "remote") {
      setTargetNodeId("");
      return;
    }

    const remoteNodes = nodes.filter((node) => node.id !== selectedNodeId);

    if (remoteNodes.length === 0) {
      setTargetNodeId("");
      return;
    }

    setTargetNodeId((previous) => {
      if (previous && remoteNodes.some((node) => node.id === previous)) {
        return previous;
      }

      return remoteNodes[0]?.id ?? "";
    });
  }, [cloneMode, nodes, selectedNodeId]);

  const selectedScopeSummary = useMemo(() => {
    if (!selectedScopeName) {
      return undefined;
    }

    return scopes.find((scope) => scope.name === selectedScopeName);
  }, [scopes, selectedScopeName]);

  useEffect(() => {
    if (!selectedScopeName) {
      setEnableOnTarget(cloneMode === "local" ? false : true);
      return;
    }

    if (cloneMode === "local") {
      setEnableOnTarget(false);
      return;
    }

    setEnableOnTarget(selectedScopeSummary?.enabled ?? false);
  }, [selectedScopeName, selectedScopeSummary, cloneMode]);

  useEffect(() => {
    const enabled = selectedScopeSummary?.enabled ?? false;
    setDraftScopeEnabled(enabled);
    setBaselineScopeEnabled(enabled);
  }, [selectedScopeSummary]);

  useEffect(() => {
    setUpdateState("idle");
    setUpdateMessage(undefined);
    setUpdateError(undefined);
  }, [selectedNodeId, selectedScopeName]);

  useEffect(() => {
    setNewScopeNameTouched(false);
  }, [selectedScopeName, cloneMode]);

  useEffect(() => {
    if (!selectedScopeName) {
      setNewScopeName("");
      return;
    }

    if (!newScopeNameTouched) {
      if (cloneMode === "local") {
        setNewScopeName(`${selectedScopeName}-copy`);
      } else {
        setNewScopeName("");
      }
    }
  }, [selectedScopeName, cloneMode, newScopeNameTouched]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedNodeId || !selectedScopeName) {
      setCurrentScope(undefined);
      setScopeDetailState("idle");
      setScopeDetailError(undefined);
      syncDraftWithScope(undefined);
      return;
    }

    const cacheKey = buildScopeKey(selectedNodeId, selectedScopeName);
    const cached = detailCache.get(cacheKey);

    if (cached) {
      setCurrentScope(cached);
      setScopeDetailState("success");
      setScopeDetailError(undefined);
      syncDraftWithScope(cached);
      return;
    }

    setScopeDetailState("loading");
    setScopeDetailError(undefined);

    loadDhcpScope(selectedNodeId, selectedScopeName)
      .then((envelope) => {
        if (cancelled) {
          return;
        }

        const scope = envelope.data;
        setCurrentScope(scope);
        setDetailCache((previous) => {
          const next = new Map(previous);
          next.set(cacheKey, scope);
          return next;
        });
        setScopeDetailState("success");
        syncDraftWithScope(scope);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setCurrentScope(undefined);
        setScopeDetailState("error");
        setScopeDetailError(
          error instanceof Error ?
            error.message
          : "Failed to load scope details.",
        );
        syncDraftWithScope(undefined);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNodeId, selectedScopeName, detailCache, loadDhcpScope]);

  useEffect(() => {
    setCloneState("idle");
    setCloneMessage(undefined);
    setCloneError(undefined);
  }, [selectedNodeId, selectedScopeName, cloneMode]);

  useEffect(() => {
    setRenameScopeName(selectedScopeName ?? "");
    setRenameState("idle");
    setRenameMessage(undefined);
    setRenameError(undefined);
  }, [selectedScopeName, selectedNodeId]);

  const targetNodeOptions = useMemo(() => {
    return nodes.filter((node) => node.id !== selectedNodeId);
  }, [nodes, selectedNodeId]);

  const hasRemoteTargets = targetNodeOptions.length > 0;
  const isLocalClone = cloneMode === "local";
  const trimmedStartingAddress = draftStartingAddress.trim();
  const trimmedEndingAddress = draftEndingAddress.trim();
  const trimmedSubnetMask = draftSubnetMask.trim();
  const trimmedCloneStartingAddress = cloneStartingAddress.trim();
  const trimmedCloneEndingAddress = cloneEndingAddress.trim();
  const trimmedCloneSubnetMask = cloneSubnetMask.trim();
  const trimmedCloneRouterAddress = cloneRouterAddress.trim();
  const trimmedCloneDnsServers = cloneDnsServers.trim();
  const trimmedCloneDomainSearchList = cloneDomainSearchList.trim();
  const trimmedNewScopeName = newScopeName.trim();
  const trimmedRenameScopeName = renameScopeName.trim();
  const effectiveStartingAddress =
    isLocalClone && trimmedCloneStartingAddress.length > 0 ?
      trimmedCloneStartingAddress
    : trimmedStartingAddress;
  const effectiveEndingAddress =
    isLocalClone && trimmedCloneEndingAddress.length > 0 ?
      trimmedCloneEndingAddress
    : trimmedEndingAddress;
  const effectiveSubnetMask =
    isLocalClone && trimmedCloneSubnetMask.length > 0 ?
      trimmedCloneSubnetMask
    : trimmedSubnetMask;
  const cloneSubmitDisabled =
    cloneState === "loading" ||
    updateState === "loading" ||
    effectiveStartingAddress.length === 0 ||
    effectiveEndingAddress.length === 0 ||
    effectiveSubnetMask.length === 0 ||
    (cloneMode === "remote" && !targetNodeId) ||
    (cloneMode === "local" && trimmedNewScopeName.length === 0);
  const renameSubmitDisabled: boolean =
    renameState === "loading" ||
    updateState === "loading" ||
    cloneState === "loading" ||
    trimmedRenameScopeName.length === 0 ||
    (selectedScopeName !== undefined &&
      selectedScopeName !== null &&
      trimmedRenameScopeName.toLowerCase() === selectedScopeName.toLowerCase());

  const prepareScopeOverrides = (
    onError: (message: string) => void,
    rangeOverrides?: {
      startingAddress?: string;
      endingAddress?: string;
      subnetMask?: string;
      routerAddress?: string;
    },
  ): TechnitiumDhcpScopeOverrides | null => {
    if (!currentScope) {
      onError("Scope details are still loading. Try again.");
      return null;
    }

    const startingAddress = (
      rangeOverrides?.startingAddress ?? trimmedStartingAddress
    ).trim();
    const endingAddress = (
      rangeOverrides?.endingAddress ?? trimmedEndingAddress
    ).trim();
    const subnetMask = (rangeOverrides?.subnetMask ?? trimmedSubnetMask).trim();

    if (!startingAddress || !endingAddress || !subnetMask) {
      onError(
        "Starting address, ending address, and subnet mask are required.",
      );
      return null;
    }

    const leaseDaysRaw = draftLeaseDays.trim();
    const leaseHoursRaw = draftLeaseHours.trim();
    const leaseMinutesRaw = draftLeaseMinutes.trim();

    const leaseDays = parseLeaseComponent(draftLeaseDays);
    const leaseHours = parseLeaseComponent(draftLeaseHours);
    const leaseMinutes = parseLeaseComponent(draftLeaseMinutes);

    if (leaseDays === undefined && leaseDaysRaw.length > 0) {
      onError("Lease days must be a non-negative number.");
      return null;
    }

    if (leaseHours === undefined && leaseHoursRaw.length > 0) {
      onError("Lease hours must be a non-negative number.");
      return null;
    }

    if (leaseMinutes === undefined && leaseMinutesRaw.length > 0) {
      onError("Lease minutes must be a non-negative number.");
      return null;
    }

    const offerDelayRaw = draftOfferDelay.trim();
    const offerDelay = parseNumericInput(draftOfferDelay);
    if (offerDelay === undefined && offerDelayRaw.length > 0) {
      onError("Offer delay must be a non-negative number.");
      return null;
    }

    if (offerDelay !== undefined && offerDelay < 0) {
      onError("Offer delay must be a non-negative number.");
      return null;
    }

    const pingTimeoutRaw = draftPingTimeout.trim();
    const pingTimeout = parseNumericInput(draftPingTimeout);
    if (pingTimeout === undefined && pingTimeoutRaw.length > 0) {
      onError("Ping timeout must be a non-negative number.");
      return null;
    }

    if (pingTimeout !== undefined && pingTimeout < 0) {
      onError("Ping timeout must be a non-negative number.");
      return null;
    }

    const pingRetriesRaw = draftPingRetries.trim();
    const pingRetries = parseNumericInput(draftPingRetries);
    if (pingRetries === undefined && pingRetriesRaw.length > 0) {
      onError("Ping retries must be a non-negative number.");
      return null;
    }

    if (pingRetries !== undefined && pingRetries < 0) {
      onError("Ping retries must be a non-negative number.");
      return null;
    }

    const dnsTtlRaw = draftDnsTtl.trim();
    const dnsTtl = parseNumericInput(draftDnsTtl);
    if (dnsTtl === undefined && dnsTtlRaw.length > 0) {
      onError("DNS TTL must be a non-negative number.");
      return null;
    }

    if (dnsTtl !== undefined && dnsTtl < 0) {
      onError("DNS TTL must be a non-negative number.");
      return null;
    }

    const staticRoutesSanitized = sanitizeStaticRoutes(draftStaticRoutes);
    if (staticRoutesSanitized.hasPartial) {
      onError("Static routes require destination, subnet mask, and router.");
      return null;
    }

    const vendorInfoSanitized = sanitizeVendorInfo(draftVendorInfo);
    if (vendorInfoSanitized.hasPartial) {
      onError(
        "Vendor information entries require both identifier and information.",
      );
      return null;
    }

    const genericOptionsSanitized = sanitizeGenericOptions(draftGenericOptions);
    if (genericOptionsSanitized.hasPartial) {
      onError("Generic DHCP options require both code and value.");
      return null;
    }

    if (genericOptionsSanitized.invalidCode) {
      onError("Generic DHCP option codes must be non-negative numbers.");
      return null;
    }

    if (genericOptionsSanitized.invalidValue) {
      onError(
        "Generic DHCP option values in HEX mode must be valid hexadecimal byte sequences.",
      );
      return null;
    }

    const exclusionsSanitized = sanitizeExclusions(draftExclusions);
    if (exclusionsSanitized.hasPartial) {
      onError("Exclusion ranges require both starting and ending addresses.");
      return null;
    }

    const reservedLeasesSanitized = sanitizeReservedLeases(draftReservedLeases);
    if (reservedLeasesSanitized.hasPartial) {
      onError("Reserved leases require an IP address and hardware address.");
      return null;
    }

    const winsServers = splitListInput(draftWinsServers);
    const ntpServers = splitListInput(draftNtpServers);
    const ntpDomains = splitListInput(draftNtpDomains);
    const capwapControllers = splitListInput(draftCapwapControllers);
    const tftpServers = splitListInput(draftTftpServers);

    const normalizedServerAddress = normalizeOptionalString(draftServerAddress);
    const normalizedServerHostName =
      normalizeOptionalString(draftServerHostName);
    const normalizedBootFileName = normalizeOptionalString(draftBootFileName);

    const currentStaticRoutesNormalized = (currentScope.staticRoutes ?? []).map(
      (route) => ({
        destination: route.destination.trim(),
        subnetMask: route.subnetMask.trim(),
        router: route.router.trim(),
      }),
    );

    const currentVendorInfoNormalized = (currentScope.vendorInfo ?? []).map(
      (entry) => ({
        identifier: entry.identifier.trim(),
        information: entry.information.trim(),
      }),
    );

    const currentGenericOptionsNormalized = (
      currentScope.genericOptions ?? []
    ).map((option) => ({
      code: option.code,
      value:
        normalizeHexValue(option.value?.trim() ?? "") ?? option.value.trim(),
    }));

    const currentExclusionsNormalized = (currentScope.exclusions ?? []).map(
      (entry) => ({
        startingAddress: entry.startingAddress.trim(),
        endingAddress: entry.endingAddress.trim(),
      }),
    );

    const currentReservedNormalized = (currentScope.reservedLeases ?? []).map(
      (entry) => ({
        hostName: entry.hostName ?? null,
        hardwareAddress: entry.hardwareAddress.trim(),
        address: entry.address.trim(),
        comments: entry.comments ?? null,
      }),
    );

    const overrides: TechnitiumDhcpScopeOverrides = {};

    if (startingAddress !== currentScope.startingAddress) {
      overrides.startingAddress = startingAddress;
    }

    if (endingAddress !== currentScope.endingAddress) {
      overrides.endingAddress = endingAddress;
    }

    if (subnetMask !== currentScope.subnetMask) {
      overrides.subnetMask = subnetMask;
    }

    const normalizedRouter = normalizeOptionalString(
      rangeOverrides?.routerAddress ?? draftRouterAddress,
    );
    if (normalizedRouter !== (currentScope.routerAddress ?? null)) {
      overrides.routerAddress = normalizedRouter;
    }

    const dnsListRaw =
      isLocalClone && trimmedCloneDnsServers.length > 0 ?
        cloneDnsServers
      : draftDnsServers;
    const dnsList = splitListInput(dnsListRaw);
    if (!arraysEqual(dnsList, currentScope.dnsServers)) {
      overrides.dnsServers = dnsList;
    }

    const domainNameRaw = isLocalClone ? cloneDomainName : draftDomainName;
    const normalizedDomain = normalizeOptionalString(domainNameRaw);
    const currentDomain = currentScope.domainName ?? "";
    if ((normalizedDomain ?? "") !== currentDomain) {
      overrides.domainName = normalizedDomain ?? "";
    }

    const domainSearchRaw =
      isLocalClone && trimmedCloneDomainSearchList.length > 0 ?
        cloneDomainSearchList
      : draftDomainSearchList;
    const searchList = splitListInput(domainSearchRaw);
    if (!arraysEqual(searchList, currentScope.domainSearchList)) {
      overrides.domainSearchList = searchList;
    }

    if (
      leaseDays !== undefined &&
      leaseDays !== (currentScope.leaseTimeDays ?? undefined)
    ) {
      overrides.leaseTimeDays = leaseDays;
    }

    if (
      leaseHours !== undefined &&
      leaseHours !== (currentScope.leaseTimeHours ?? undefined)
    ) {
      overrides.leaseTimeHours = leaseHours;
    }

    if (
      leaseMinutes !== undefined &&
      leaseMinutes !== (currentScope.leaseTimeMinutes ?? undefined)
    ) {
      overrides.leaseTimeMinutes = leaseMinutes;
    }

    if (
      draftAllowOnlyReserved !== (currentScope.allowOnlyReservedLeases ?? false)
    ) {
      overrides.allowOnlyReservedLeases = draftAllowOnlyReserved;
    }

    if (
      offerDelay !== undefined &&
      offerDelay !== (currentScope.offerDelayTime ?? undefined)
    ) {
      overrides.offerDelayTime = offerDelay;
    }

    if (draftPingCheckEnabled !== (currentScope.pingCheckEnabled ?? false)) {
      overrides.pingCheckEnabled = draftPingCheckEnabled;
    }

    if (
      pingTimeout !== undefined &&
      pingTimeout !== (currentScope.pingCheckTimeout ?? undefined)
    ) {
      overrides.pingCheckTimeout = pingTimeout;
    }

    if (
      pingRetries !== undefined &&
      pingRetries !== (currentScope.pingCheckRetries ?? undefined)
    ) {
      overrides.pingCheckRetries = pingRetries;
    }

    if (draftDnsUpdates !== (currentScope.dnsUpdates ?? false)) {
      overrides.dnsUpdates = draftDnsUpdates;
    }

    if (dnsTtl !== undefined && dnsTtl !== (currentScope.dnsTtl ?? undefined)) {
      overrides.dnsTtl = dnsTtl;
    }

    if (normalizedServerAddress !== (currentScope.serverAddress ?? null)) {
      overrides.serverAddress = normalizedServerAddress;
    }

    if (normalizedServerHostName !== (currentScope.serverHostName ?? null)) {
      overrides.serverHostName = normalizedServerHostName;
    }

    if (normalizedBootFileName !== (currentScope.bootFileName ?? null)) {
      overrides.bootFileName = normalizedBootFileName;
    }

    const useThisDnsServer =
      isLocalClone ? cloneUseThisDnsServer : draftUseThisDnsServer;
    if (useThisDnsServer !== (currentScope.useThisDnsServer ?? false)) {
      overrides.useThisDnsServer = useThisDnsServer;
    }

    if (!arraysEqual(winsServers, currentScope.winsServers)) {
      overrides.winsServers = winsServers;
    }

    if (!arraysEqual(ntpServers, currentScope.ntpServers)) {
      overrides.ntpServers = ntpServers;
    }

    if (!arraysEqual(ntpDomains, currentScope.ntpServerDomainNames)) {
      overrides.ntpServerDomainNames = ntpDomains;
    }

    if (!arraysEqual(capwapControllers, currentScope.capwapAcIpAddresses)) {
      overrides.capwapAcIpAddresses = capwapControllers;
    }

    if (!arraysEqual(tftpServers, currentScope.tftpServerAddresses)) {
      overrides.tftpServerAddresses = tftpServers;
    }

    if (
      !arraysEqualBy(
        staticRoutesSanitized.values,
        currentStaticRoutesNormalized,
        (route) => `${route.destination}|${route.subnetMask}|${route.router}`,
      )
    ) {
      overrides.staticRoutes = staticRoutesSanitized.values;
    }

    if (
      !arraysEqualBy(
        vendorInfoSanitized.values,
        currentVendorInfoNormalized,
        (entry) => `${entry.identifier}|${entry.information}`,
      )
    ) {
      overrides.vendorInfo = vendorInfoSanitized.values;
    }

    if (
      !arraysEqualBy(
        genericOptionsSanitized.values,
        currentGenericOptionsNormalized,
        (entry) => `${entry.code}|${entry.value}`,
      )
    ) {
      overrides.genericOptions = genericOptionsSanitized.values;
    }

    if (
      !arraysEqualBy(
        exclusionsSanitized.values,
        currentExclusionsNormalized,
        (entry) => `${entry.startingAddress}|${entry.endingAddress}`,
      )
    ) {
      overrides.exclusions = exclusionsSanitized.values;
    }

    if (
      !arraysEqualBy(
        reservedLeasesSanitized.values,
        currentReservedNormalized,
        (entry) =>
          `${entry.hardwareAddress}|${entry.address}|${entry.hostName ?? ""}|${entry.comments ?? ""}`,
      )
    ) {
      overrides.reservedLeases = reservedLeasesSanitized.values;
    }

    if (
      draftBlockLocallyAdministered !==
      (currentScope.blockLocallyAdministeredMacAddresses ?? false)
    ) {
      overrides.blockLocallyAdministeredMacAddresses =
        draftBlockLocallyAdministered;
    }

    if (
      draftIgnoreClientIdentifier !==
      (currentScope.ignoreClientIdentifierOption ?? false)
    ) {
      overrides.ignoreClientIdentifierOption = draftIgnoreClientIdentifier;
    }

    return overrides;
  };

  const handleResetOverrides = () => {
    syncDraftWithScope(currentScope);
    setNewScopeNameTouched(false);
    setDraftScopeEnabled(selectedScopeSummary?.enabled ?? false);
    setUpdateState("idle");
    setUpdateError(undefined);
    setUpdateMessage(undefined);
  };

  const ensureSnapshot = async (
    node: string | undefined,
    action: string,
    note?: string,
  ) => {
    if (!node) return;
    try {
      const snapshot = await createDhcpSnapshot(node, "automatic");

      if (note?.trim()) {
        try {
          await updateDhcpSnapshotNote(node, snapshot.id, note.trim());
        } catch (noteError) {
          console.warn("Failed to save snapshot note", noteError);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create snapshot.";

      // If the node has no scopes, skip without alarming the user
      if (message.toLowerCase().includes("no scopes")) {
        return;
      }

      pushToast({
        message: `Snapshot skipped before ${action}: ${message}`,
        tone: "error",
        timeout: 6000,
      });
    }
  };

  const ensureSnapshotsForNodes = async (
    nodeIds: Array<string | undefined>,
    action: string,
    note?: string,
  ) => {
    const uniqueNodes = Array.from(
      new Set(nodeIds.filter((nodeId): nodeId is string => Boolean(nodeId))),
    );

    await Promise.all(
      uniqueNodes.map((nodeId) => ensureSnapshot(nodeId, action, note)),
    );
  };

  const handleClone = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedNodeId || !selectedScopeName || !currentScope) {
      failClone("Select a scope to clone before continuing.");
      return;
    }

    const cloneRangeOverride =
      isLocalClone ?
        {
          startingAddress: trimmedCloneStartingAddress || undefined,
          endingAddress: trimmedCloneEndingAddress || undefined,
          subnetMask: trimmedCloneSubnetMask || undefined,
          routerAddress: trimmedCloneRouterAddress || undefined,
        }
      : undefined;

    if (
      !effectiveStartingAddress ||
      !effectiveEndingAddress ||
      !effectiveSubnetMask
    ) {
      failClone(
        "Starting address, ending address, and subnet mask are required.",
      );
      return;
    }

    if (cloneMode === "remote" && !targetNodeId) {
      failClone("Select a target node before cloning.");
      return;
    }

    if (cloneMode === "local") {
      if (!trimmedNewScopeName) {
        failClone("Enter a new scope name when cloning on the same node.");
        return;
      }

      const duplicate = scopes.some(
        (scope) =>
          scope.name.toLowerCase() === trimmedNewScopeName.toLowerCase(),
      );

      if (duplicate) {
        failClone(
          "A scope with that name already exists on this node. Choose another name.",
        );
        return;
      }
    }

    const overrides = prepareScopeOverrides(failClone, cloneRangeOverride);
    if (overrides === null) {
      return;
    }

    setCloneState("loading");
    setCloneError(undefined);
    setCloneMessage(undefined);

    try {
      await ensureSnapshot(selectedNodeId, "cloning DHCP scope");
      if (cloneMode === "remote") {
        await ensureSnapshot(targetNodeId, "cloning DHCP scope to target node");
      }

      const result: TechnitiumCloneDhcpScopeResult = await cloneDhcpScope(
        selectedNodeId,
        selectedScopeName,
        {
          targetNodeId: cloneMode === "remote" ? targetNodeId : undefined,
          newScopeName:
            trimmedNewScopeName.length > 0 ? trimmedNewScopeName : undefined,
          enableOnTarget,
          overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
        },
      );

      const successMessage = `Cloned "${result.sourceScopeName}" to ${result.targetScopeName} on node ${result.targetNodeId}.`;
      setCloneState("success");
      setCloneError(undefined);
      setCloneMessage(successMessage);
      pushToast({ message: successMessage, tone: "success" });

      if (result.targetNodeId === selectedNodeId) {
        try {
          const refreshed = await loadDhcpScopes(selectedNodeId);
          const nextScopes = refreshed.data?.scopes ?? [];
          setScopes(nextScopes);

          const nextSelection = result.targetScopeName;
          setSelectedScopeName(nextSelection);

          setDetailCache((previous) => {
            const next = new Map(previous);
            next.delete(buildScopeKey(selectedNodeId, nextSelection));
            return next;
          });
        } catch (refreshError) {
          console.warn(
            "Failed to refresh DHCP scopes after local clone",
            refreshError,
          );
        }
      }
    } catch (error) {
      failClone(
        error instanceof Error ? error.message : "Failed to clone DHCP scope.",
      );
      return;
    }
  };

  const handleRenameScope = async () => {
    if (!selectedNodeId || !selectedScopeName) {
      setRenameState("error");
      setRenameError("Select a scope before renaming.");
      setRenameMessage(undefined);
      pushToast({
        message: "Select a scope before renaming.",
        tone: "error",
        timeout: 6000,
      });
      return;
    }

    if (!trimmedRenameScopeName) {
      setRenameState("error");
      const message = "Enter a new scope name to continue.";
      setRenameError(message);
      setRenameMessage(undefined);
      pushToast({ message, tone: "error", timeout: 6000 });
      return;
    }

    const currentNameLower = selectedScopeName.toLowerCase();
    const desiredNameLower = trimmedRenameScopeName.toLowerCase();

    if (desiredNameLower === currentNameLower) {
      setRenameState("error");
      const message = "New scope name must be different from the current name.";
      setRenameError(message);
      setRenameMessage(undefined);
      pushToast({ message, tone: "error", timeout: 6000 });
      return;
    }

    const duplicate = scopes.some(
      (scope) =>
        scope.name.toLowerCase() === desiredNameLower &&
        scope.name.toLowerCase() !== currentNameLower,
    );

    if (duplicate) {
      setRenameState("error");
      const message =
        "A scope with that name already exists on this node. Choose another name.";
      setRenameError(message);
      setRenameMessage(undefined);
      pushToast({ message, tone: "error", timeout: 6000 });
      return;
    }

    setRenameState("loading");
    setRenameError(undefined);
    setRenameMessage(undefined);

    try {
      await ensureSnapshot(selectedNodeId, "renaming DHCP scope");

      const result = await renameDhcpScope(selectedNodeId, selectedScopeName, {
        newScopeName: trimmedRenameScopeName,
      });

      const successMessage = `Renamed "${result.sourceScopeName}" to "${result.targetScopeName}" on ${selectedNodeLabel}.`;
      setRenameState("success");
      setRenameMessage(successMessage);
      setRenameError(undefined);
      pushToast({ message: successMessage, tone: "success" });

      const envelope = await loadDhcpScopes(selectedNodeId);
      const nextScopes = envelope.data?.scopes ?? [];
      setScopes(nextScopes);

      setScopeCountByNode((prev) => {
        const updated = new Map(prev);
        updated.set(selectedNodeId, nextScopes.length);
        return updated;
      });

      setSelectedScopeName(result.targetScopeName);
      setRenameScopeName(result.targetScopeName);

      setDetailCache((previous) => {
        const next = new Map(previous);
        next.delete(buildScopeKey(selectedNodeId, selectedScopeName));
        next.delete(buildScopeKey(selectedNodeId, result.targetScopeName));
        return next;
      });

      setCurrentScope(undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to rename DHCP scope.";
      setRenameState("error");
      setRenameError(message);
      setRenameMessage(undefined);
      pushToast({ message, tone: "error", timeout: 6000 });
    }
  };

  const handleUpdate = async () => {
    if (!selectedNodeId || !selectedScopeName) {
      failUpdate("Select a scope before saving changes.");
      return;
    }

    if (!currentScope) {
      failUpdate("Scope details are still loading. Try again.");
      return;
    }

    const overrides = prepareScopeOverrides(failUpdate);
    if (overrides === null) {
      return;
    }

    const hasOverrides = Object.keys(overrides).length > 0;
    const desiredEnabled = draftScopeEnabled;
    const currentEnabled = selectedScopeSummary?.enabled ?? false;
    const enabledChanged = desiredEnabled !== currentEnabled;

    if (!hasOverrides && !enabledChanged) {
      failUpdate("No changes detected to save.");
      return;
    }

    setUpdateState("loading");
    setUpdateError(undefined);
    setUpdateMessage(undefined);

    try {
      await ensureSnapshot(
        selectedNodeId,
        "saving DHCP scope changes",
        pendingChangesNote,
      );

      const response: TechnitiumUpdateDhcpScopeEnvelope = await updateDhcpScope(
        selectedNodeId,
        selectedScopeName,
        {
          overrides: hasOverrides ? overrides : undefined,
          enabled: enabledChanged ? desiredEnabled : undefined,
        },
      );

      const successMessage = `Updated scope "${response.data.scope.name}" on ${selectedNodeLabel}.`;
      setUpdateState("success");
      setUpdateError(undefined);
      setUpdateMessage(successMessage);
      pushToast({ message: successMessage, tone: "success" });

      setCurrentScope(response.data.scope);
      syncDraftWithScope(response.data.scope);
      setDraftScopeEnabled(response.data.enabled);
      setBaselineScopeEnabled(response.data.enabled);

      setScopes((previous) =>
        previous.map((scope) =>
          scope.name === response.data.scope.name ?
            {
              ...scope,
              startingAddress: response.data.scope.startingAddress,
              endingAddress: response.data.scope.endingAddress,
              subnetMask: response.data.scope.subnetMask,
              enabled: response.data.enabled,
            }
          : scope,
        ),
      );

      setDetailCache((previous) => {
        const next = new Map(previous);
        next.set(
          buildScopeKey(selectedNodeId, response.data.scope.name),
          response.data.scope,
        );
        return next;
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update DHCP scope.";
      setUpdateState("error");
      setUpdateError(message);
      setUpdateMessage(undefined);
      pushToast({ message, tone: "error", timeout: 6000 });
    }
  };

  // Delete scope handler
  const handleDeleteScope = () => {
    if (!selectedScopeName) {
      pushToast({ message: "No scope selected to delete.", tone: "error" });
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: "Delete DHCP Scope",
      message: (
        <>
          <p>
            Are you sure you want to delete DHCP scope{" "}
            <strong>"{selectedScopeName}"</strong> from{" "}
            <strong>{selectedNodeLabel}</strong>?
          </p>
          <p style={{ marginTop: "0.75rem", fontWeight: 500 }}>
            This action cannot be undone.
          </p>
        </>
      ),
      variant: "danger",
      confirmLabel: "Delete Scope",
      onConfirm: async () => {
        closeConfirmModal();
        try {
          await ensureSnapshot(selectedNodeId, "deleting DHCP scope");

          const result = await deleteDhcpScope(
            selectedNodeId,
            selectedScopeName,
          );
          pushToast({ message: result.message, tone: "success" });

          // Refresh scope list
          const envelope = await loadDhcpScopes(selectedNodeId);
          const nextScopes = envelope.data?.scopes ?? [];
          setScopes(nextScopes);

          // Update scope count
          setScopeCountByNode((prev) => {
            const updated = new Map(prev);
            updated.set(selectedNodeId, nextScopes.length);
            return updated;
          });

          // Clear selected scope and details
          setSelectedScopeName(nextScopes[0]?.name);
          setCurrentScope(undefined);
          setDetailCache((prev) => {
            const next = new Map(prev);
            next.delete(buildScopeKey(selectedNodeId, selectedScopeName));
            return next;
          });
        } catch (error) {
          const message =
            error instanceof Error ?
              error.message
            : "Failed to delete DHCP scope.";
          pushToast({ message, tone: "error", timeout: 6000 });
        }
      },
    });
  };

  // Bulk sync handlers
  const handleBulkSyncCancel = () => {
    setShowBulkSyncModal(false);
  };

  // Inline bulk sync form handlers
  const handleBulkSyncSourceChange = (nodeId: string) => {
    setBulkSyncSourceNodeId(nodeId);
    // Clear targets when source changes
    setBulkSyncTargetNodeIds([]);
  };

  const handleBulkSyncTargetToggle = (nodeId: string) => {
    setBulkSyncTargetNodeIds((prev) =>
      prev.includes(nodeId) ?
        prev.filter((id) => id !== nodeId)
      : [...prev, nodeId],
    );
  };

  const handleBulkSyncSelectAllTargets = () => {
    setBulkSyncTargetNodeIds(bulkSyncAvailableTargets.map((node) => node.id));
  };

  const handleBulkSyncDeselectAllTargets = () => {
    setBulkSyncTargetNodeIds([]);
  };

  const handleBulkSyncToggleScopeExpanded = async (scopeName: string) => {
    const isCurrentlyExpanded = bulkSyncExpandedScopes.has(scopeName);

    setBulkSyncExpandedScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scopeName)) {
        next.delete(scopeName);
      } else {
        next.add(scopeName);
      }
      return next;
    });

    // If expanding and we don't have details yet, load them
    // Load for both merge-missing and overwrite-all (both show diff comparison)
    if (
      !isCurrentlyExpanded &&
      (bulkSyncStrategy === "merge-missing" ||
        bulkSyncStrategy === "overwrite-all")
    ) {
      const { nodeIds: targetNodeIdsWithScope } =
        getScopeExistsOnTargets(scopeName);

      // Only load if there are targets with this scope (for diff comparison)
      if (targetNodeIdsWithScope.length > 0) {
        // Check if we already have the details cached
        const sourceKey = `${bulkSyncSourceNodeId}:${scopeName}`;
        const hasSourceDetails = bulkSyncSourceScopeDetails.has(sourceKey);

        // Get current target details map to check cache
        const currentTargetDetails = bulkSyncTargetScopeDetails;
        const hasAllTargetDetails = targetNodeIdsWithScope.every((nodeId) =>
          currentTargetDetails.has(`${nodeId}:${scopeName}`),
        );

        if (!hasSourceDetails || !hasAllTargetDetails) {
          // Mark as loading
          setBulkSyncScopeDetailsLoading((prev) =>
            new Set(prev).add(scopeName),
          );

          try {
            // Load source scope details
            if (!hasSourceDetails) {
              const sourceEnvelope = await loadDhcpScope(
                bulkSyncSourceNodeId,
                scopeName,
              );
              if (sourceEnvelope.data) {
                setBulkSyncSourceScopeDetails((prev) => {
                  const next = new Map(prev);
                  next.set(sourceKey, sourceEnvelope.data);
                  return next;
                });
              }
            }

            // Load target scope details for all targets with this scope
            // Use Promise.all for parallel loading
            const targetLoadPromises = targetNodeIdsWithScope
              .filter(
                (nodeId) => !currentTargetDetails.has(`${nodeId}:${scopeName}`),
              )
              .map(async (targetNodeId) => {
                const targetKey = `${targetNodeId}:${scopeName}`;
                try {
                  const targetEnvelope = await loadDhcpScope(
                    targetNodeId,
                    scopeName,
                  );
                  if (targetEnvelope.data) {
                    return { key: targetKey, data: targetEnvelope.data };
                  }
                } catch (err) {
                  console.warn(
                    `Failed to load scope ${scopeName} from ${targetNodeId}`,
                    err,
                  );
                }
                return null;
              });

            const results = await Promise.all(targetLoadPromises);

            // Batch update all target details at once
            const validResults = results.filter(
              (r): r is { key: string; data: TechnitiumDhcpScope } =>
                r !== null,
            );
            if (validResults.length > 0) {
              setBulkSyncTargetScopeDetails((prev) => {
                const next = new Map(prev);
                for (const result of validResults) {
                  next.set(result.key, result.data);
                }
                return next;
              });
            }
          } catch (error) {
            console.warn(
              "Failed to load scope details for diff preview",
              error,
            );
          } finally {
            setBulkSyncScopeDetailsLoading((prev) => {
              const next = new Set(prev);
              next.delete(scopeName);
              return next;
            });
          }
        }
      }
    }
  };

  // Helper to determine if a scope exists on any target
  const getScopeExistsOnTargets = (
    scopeName: string,
  ): { exists: boolean; nodeIds: string[] } => {
    const existingNodeIds: string[] = [];
    for (const [nodeId, scopes] of bulkSyncTargetScopes.entries()) {
      if (scopes.some((s) => s.name === scopeName)) {
        existingNodeIds.push(nodeId);
      }
    }
    return { exists: existingNodeIds.length > 0, nodeIds: existingNodeIds };
  };

  // Preload source/target scope details for merge-missing so badges are accurate without expanding
  const preloadMergeMissingScopeDetails = useCallback(async () => {
    if (bulkSyncStrategy !== "merge-missing") return;
    if (bulkSyncTargetNodeIds.length === 0 || bulkSyncSourceScopes.length === 0)
      return;

    const pending: Promise<void>[] = [];

    for (const scope of bulkSyncSourceScopes) {
      const { nodeIds: targetNodeIdsWithScope } = getScopeExistsOnTargets(
        scope.name,
      );

      if (targetNodeIdsWithScope.length === 0) continue;

      const sourceKey = `${bulkSyncSourceNodeId}:${scope.name}`;
      const needsSource = !bulkSyncSourceScopeDetails.has(sourceKey);

      // enqueue source detail load
      if (needsSource) {
        pending.push(
          (async () => {
            try {
              const sourceEnvelope = await loadDhcpScope(
                bulkSyncSourceNodeId,
                scope.name,
              );
              if (sourceEnvelope.data) {
                setBulkSyncSourceScopeDetails((prev) => {
                  const next = new Map(prev);
                  next.set(sourceKey, sourceEnvelope.data);
                  return next;
                });
              }
            } catch (error) {
              console.warn(
                `Failed to preload source scope ${scope.name} from ${bulkSyncSourceNodeId}`,
                error,
              );
            }
          })(),
        );
      }

      // enqueue target detail loads
      for (const targetNodeId of targetNodeIdsWithScope) {
        const targetKey = `${targetNodeId}:${scope.name}`;
        if (bulkSyncTargetScopeDetails.has(targetKey)) continue;

        pending.push(
          (async () => {
            try {
              const targetEnvelope = await loadDhcpScope(
                targetNodeId,
                scope.name,
              );
              if (targetEnvelope.data) {
                setBulkSyncTargetScopeDetails((prev) => {
                  const next = new Map(prev);
                  next.set(targetKey, targetEnvelope.data);
                  return next;
                });
              }
            } catch (error) {
              console.warn(
                `Failed to preload target scope ${scope.name} from ${targetNodeId}`,
                error,
              );
            }
          })(),
        );
      }
    }

    if (pending.length > 0) {
      setBulkSyncScopeDetailsLoading((prev) => {
        const next = new Set(prev);
        bulkSyncSourceScopes.forEach((scope) => next.add(scope.name));
        return next;
      });

      await Promise.allSettled(pending);

      setBulkSyncScopeDetailsLoading((prev) => {
        const next = new Set(prev);
        bulkSyncSourceScopes.forEach((scope) => next.delete(scope.name));
        return next;
      });
    }
  }, [
    bulkSyncStrategy,
    bulkSyncTargetNodeIds,
    bulkSyncSourceScopes,
    bulkSyncSourceNodeId,
    bulkSyncSourceScopeDetails,
    bulkSyncTargetScopeDetails,
    getScopeExistsOnTargets,
    loadDhcpScope,
  ]);

  useEffect(() => {
    preloadMergeMissingScopeDetails();
  }, [preloadMergeMissingScopeDetails]);

  // Helper to compute differences between source and target scopes
  interface ScopeDiff {
    field: string;
    label: string;
    type: "modified" | "added" | "removed";
    sourceValue?: string;
    targetValue?: string;
  }

  const computeScopeDiff = (
    sourceScope: TechnitiumDhcpScope | undefined,
    targetScope: TechnitiumDhcpScope | undefined,
  ): ScopeDiff[] => {
    const diffs: ScopeDiff[] = [];

    if (!sourceScope) return diffs;

    // If target doesn't exist, show what will be created
    if (!targetScope) {
      if (sourceScope.subnetMask) {
        diffs.push({
          field: "subnetMask",
          label: "Subnet Mask",
          type: "added",
          sourceValue: sourceScope.subnetMask,
        });
      }
      if (sourceScope.startingAddress) {
        diffs.push({
          field: "startingAddress",
          label: "Starting Address",
          type: "added",
          sourceValue: sourceScope.startingAddress,
        });
      }
      if (sourceScope.endingAddress) {
        diffs.push({
          field: "endingAddress",
          label: "Ending Address",
          type: "added",
          sourceValue: sourceScope.endingAddress,
        });
      }
      if (sourceScope.routerAddress) {
        diffs.push({
          field: "routerAddress",
          label: "Router",
          type: "added",
          sourceValue: sourceScope.routerAddress,
        });
      }
      const srcDns = sourceScope.dnsServers?.join(", ");
      if (srcDns) {
        diffs.push({
          field: "dnsServers",
          label: "DNS Servers",
          type: "added",
          sourceValue: srcDns,
        });
      }
      const srcDomain = sourceScope.domainSearchList?.join(", ");
      if (srcDomain) {
        diffs.push({
          field: "domainSearchList",
          label: "Domain Search List",
          type: "added",
          sourceValue: srcDomain,
        });
      }
      if (
        sourceScope.leaseTimeDays ||
        sourceScope.leaseTimeHours ||
        sourceScope.leaseTimeMinutes
      ) {
        const lease = `${sourceScope.leaseTimeDays || 0}d ${sourceScope.leaseTimeHours || 0}h ${sourceScope.leaseTimeMinutes || 0}m`;
        diffs.push({
          field: "leaseTime",
          label: "Lease Time",
          type: "added",
          sourceValue: lease,
        });
      }
      return diffs;
    }

    // Compare individual fields
    const compareSimple = (field: keyof TechnitiumDhcpScope, label: string) => {
      const srcVal = sourceScope[field] as
        | string
        | number
        | boolean
        | undefined;
      const tgtVal = targetScope[field] as
        | string
        | number
        | boolean
        | undefined;
      const srcStr = srcVal?.toString() || "";
      const tgtStr = tgtVal?.toString() || "";

      if (srcStr !== tgtStr) {
        if (!tgtStr && srcStr) {
          diffs.push({ field, label, type: "added", sourceValue: srcStr });
        } else if (tgtStr && !srcStr) {
          diffs.push({ field, label, type: "removed", targetValue: tgtStr });
        } else {
          diffs.push({
            field,
            label,
            type: "modified",
            sourceValue: srcStr,
            targetValue: tgtStr,
          });
        }
      }
    };

    const compareArray = (field: keyof TechnitiumDhcpScope, label: string) => {
      const srcArr = (sourceScope[field] as string[] | undefined) || [];
      const tgtArr = (targetScope[field] as string[] | undefined) || [];
      const srcStr = srcArr.join(", ");
      const tgtStr = tgtArr.join(", ");

      if (srcStr !== tgtStr) {
        if (!tgtStr && srcStr) {
          diffs.push({ field, label, type: "added", sourceValue: srcStr });
        } else if (tgtStr && !srcStr) {
          diffs.push({ field, label, type: "removed", targetValue: tgtStr });
        } else {
          diffs.push({
            field,
            label,
            type: "modified",
            sourceValue: srcStr,
            targetValue: tgtStr,
          });
        }
      }
    };

    // Basic settings
    compareSimple("subnetMask", "Subnet Mask");
    compareSimple("startingAddress", "Starting Address");
    compareSimple("endingAddress", "Ending Address");
    compareSimple("routerAddress", "Router");
    compareArray("dnsServers", "DNS Servers");
    compareArray("domainSearchList", "Domain Search List");

    // Lease time comparison
    const srcLease = `${sourceScope.leaseTimeDays || 0}d ${sourceScope.leaseTimeHours || 0}h ${sourceScope.leaseTimeMinutes || 0}m`;
    const tgtLease = `${targetScope.leaseTimeDays || 0}d ${targetScope.leaseTimeHours || 0}h ${targetScope.leaseTimeMinutes || 0}m`;
    if (srcLease !== tgtLease) {
      diffs.push({
        field: "leaseTime",
        label: "Lease Time",
        type: "modified",
        sourceValue: srcLease,
        targetValue: tgtLease,
      });
    }

    // Domain name comparison
    compareSimple("domainName", "Domain Name");

    // Reserved leases comparison (count)
    const srcReserved = sourceScope.reservedLeases?.length || 0;
    const tgtReserved = targetScope.reservedLeases?.length || 0;
    if (srcReserved !== tgtReserved) {
      diffs.push({
        field: "reservedLeases",
        label: "Reserved Leases",
        type: "modified",
        sourceValue: `${srcReserved} entries`,
        targetValue: `${tgtReserved} entries`,
      });
    }

    // Exclusions comparison (count)
    const srcExclusions = sourceScope.exclusions?.length || 0;
    const tgtExclusions = targetScope.exclusions?.length || 0;
    if (srcExclusions !== tgtExclusions) {
      diffs.push({
        field: "exclusions",
        label: "Exclusions",
        type: "modified",
        sourceValue: `${srcExclusions} entries`,
        targetValue: `${tgtExclusions} entries`,
      });
    }

    return diffs;
  };

  // Extracted bulk sync execution logic
  const performBulkSync = async (request: DhcpBulkSyncRequest) => {
    const snapshotNote = `Auto snapshot before bulk sync (${request.strategy})`;

    setBulkSyncInProgress(true);

    try {
      await ensureSnapshotsForNodes(
        [request.sourceNodeId, ...request.targetNodeIds],
        `bulk syncing DHCP scopes (${request.strategy})`,
        snapshotNote,
      );

      const result = await bulkSyncDhcpScopes(request);
      setBulkSyncResult(result);
      setShowBulkSyncResults(true);

      if (result.totalFailed === 0) {
        pushToast({
          message: `Successfully synced ${result.totalSynced} scope(s) across ${result.nodeResults.length} node(s)`,
          tone: "success",
          timeout: 5000,
        });
      } else if (result.totalSynced > 0) {
        pushToast({
          message: `Partially synced: ${result.totalSynced} succeeded, ${result.totalFailed} failed`,
          tone: "error",
          timeout: 6000,
        });
      } else {
        pushToast({
          message: `Bulk sync failed: ${result.totalFailed} scope(s) could not be synced`,
          tone: "error",
          timeout: 6000,
        });
      }

      for (const nodeResult of result.nodeResults) {
        if (nodeResult.syncedCount > 0) {
          try {
            await loadDhcpScopes(nodeResult.targetNodeId);
          } catch (refreshError) {
            console.warn(
              `Failed to refresh scopes for node ${nodeResult.targetNodeId}`,
              refreshError,
            );
          }
        }
      }
    } catch (error) {
      console.error("Bulk sync failed", error);
      setBulkSyncResult(null);
      pushToast({
        message: "Bulk sync failed. See console for details.",
        tone: "error",
        timeout: 6000,
      });
    } finally {
      setBulkSyncInProgress(false);
    }
  };

  const executeBulkSync = async () => {
    const request: DhcpBulkSyncRequest = {
      sourceNodeId: bulkSyncSourceNodeId,
      targetNodeIds: bulkSyncTargetNodeIds,
      strategy: bulkSyncStrategy,
      enableOnTarget: bulkSyncEnableOnTarget,
    };

    await performBulkSync(request);
  };

  const handleBulkSyncStart = () => {
    if (!bulkSyncCanStart) return;

    const sourceNodeName =
      nodes.find((node) => node.id === bulkSyncSourceNodeId)?.name ||
      bulkSyncSourceNodeId;
    const targetNames = bulkSyncTargetNodeIds
      .map((id) => nodes.find((node) => node.id === id)?.name || id)
      .join(", ");

    if (bulkSyncStrategy === "overwrite-all") {
      setConfirmModal({
        isOpen: true,
        title: "Overwrite Existing Scopes",
        message: (
          <>
            <p style={{ marginTop: "0.75rem" }}>
              Scopes on <strong>{targetNames}</strong> that also exist on
              <strong> {sourceNodeName}</strong> will be overwritten with source
              settings. New scopes will be created when missing.
            </p>
            <p
              style={{
                fontWeight: 500,
                marginTop: "0.25rem",
                color: "var(--color-warning)",
              }}
            >
              This operation replaces existing configuration on targets.
            </p>
            <p
              style={{
                marginTop: "0.75rem",
                fontSize: "0.9em",
                fontWeight: 500,
                color: "var(--color-text-secondary)",
              }}
            >
              Automatic snapshots will be created for all affected nodes before
              proceeding.
            </p>
          </>
        ),
        variant: "warning",
        confirmLabel: "Sync All",
        onConfirm: () => {
          closeConfirmModal();
          executeBulkSync();
        },
      });
      return;
    }

    if (bulkSyncStrategy === "merge-missing") {
      setConfirmModal({
        isOpen: true,
        title: "Merge Missing + Update",
        message: (
          <>
            <p style={{ marginTop: "0.75rem" }}>
              Scopes from <strong>{sourceNodeName}</strong> will be copied to
              <strong> {targetNames}</strong>. Existing scopes on targets will
              be updated to match the source.
            </p>
            <p
              style={{
                marginTop: "0.75rem",
                fontSize: "0.9em",
                fontWeight: 500,
                color: "var(--color-text-secondary)",
              }}
            >
              Automatic snapshots will be created for all affected nodes before
              proceeding.
            </p>
          </>
        ),
        variant: "warning",
        confirmLabel: "Sync All",
        onConfirm: () => {
          closeConfirmModal();
          executeBulkSync();
        },
      });
      return;
    }

    // skip-existing strategy - no confirmation dialog
    executeBulkSync();
  };

  const handleBulkSyncConfirm = async (request: DhcpBulkSyncRequest) => {
    setShowBulkSyncModal(false);
    await performBulkSync(request);
  };

  const handleBulkSyncResultsClose = () => {
    setShowBulkSyncResults(false);
    setBulkSyncResult(null);
  };

  const handleBulkSyncRetry = () => {
    setShowBulkSyncResults(false);
    executeBulkSync();
  };

  return (
    <>
      <section className="dhcp-page" ref={pullToRefresh.containerRef}>
        <PullToRefreshIndicator
          pullDistance={pullToRefresh.pullDistance}
          threshold={pullToRefresh.threshold}
          isRefreshing={pullToRefresh.isRefreshing}
        />

        <header className="dhcp-page__header">
          <div>
            <h1>DHCP Scopes</h1>
            <p>
              Manage DHCP scopes, cloning, and bulk sync across your Technitium
              nodes.
            </p>
          </div>
        </header>

        <div className="configuration__tab-switcher dhcp-page__page-tabs">
          <button
            type="button"
            className={`configuration__tab ${activePageTab === "scopes" ? "configuration__tab--active" : ""}`}
            onClick={() => setActivePageTab("scopes")}
          >
            Scopes
          </button>
          <button
            type="button"
            className={`configuration__tab ${activePageTab === "bulk-sync" ? "configuration__tab--active" : ""}`}
            onClick={() => setActivePageTab("bulk-sync")}
          >
            Bulk Sync
          </button>
        </div>

        {activePageTab === "scopes" && (
          <>
            {/* Node Selector */}
            <div className="node-selector">
              <div className="node-selector__label">
                <strong>Working on Node:</strong>
                <span className="node-selector__hint">
                  Changes will only affect the selected node
                </span>
              </div>
              <div className="node-selector__cards">
                {nodes.map((node) => {
                  const isSelected = node.id === selectedNodeId;
                  const scopeCount = scopeCountByNode.get(node.id) ?? 0;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={`node-selector__card ${isSelected ? "node-selector__card--selected" : ""}`}
                      onClick={() => handleNodeSelect(node.id)}
                    >
                      <div className="node-selector__card-radio">
                        <input
                          type="radio"
                          name="selected-dhcp-node"
                          checked={isSelected}
                          onChange={() => handleNodeSelect(node.id)}
                          aria-label={`Select ${node.name || node.id}`}
                        />
                      </div>
                      <div className="node-selector__card-content">
                        <div className="node-selector__card-header">
                          <strong className="node-selector__card-title">
                            {node.name || node.id}
                          </strong>
                        </div>
                        <div className="node-selector__card-stats">
                          {scopeCount} scope{scopeCount !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Main Content - Stacked Editor Layout */}
            <section className="configuration-editor configuration-editor--stacked">
              <div className="dhcp-page__panels">
                <section className="dhcp-page__card">
                  <header className="dhcp-page__card-header">
                    <div>
                      <h2>Scopes on {selectedNodeLabel}</h2>
                      <p>
                        Select a scope to review details and prepare a clone
                        operation.
                      </p>
                    </div>
                  </header>

                  {scopeListState === "loading" && (
                    <div className="dhcp-page__placeholder">
                      Loading DHCP scopes…
                    </div>
                  )}

                  {scopeListState === "error" && (
                    <div className="dhcp-page__error">
                      {scopeListError ?? "Unable to load DHCP scopes."}
                    </div>
                  )}

                  {scopeListState === "success" && scopes.length === 0 && (
                    <div className="dhcp-page__placeholder">
                      No DHCP scopes configured on {selectedNodeLabel}.
                    </div>
                  )}

                  {scopeListState === "success" && scopes.length > 0 && (
                    <div
                      className="dhcp-page__table-wrapper"
                      role="region"
                      aria-live="polite"
                    >
                      <table className="dhcp-page__table">
                        <thead>
                          <tr>
                            <th scope="col">Scope</th>
                            <th scope="col">Range</th>
                            <th scope="col">Mask</th>
                            <th scope="col">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scopes.map((scope) => {
                            const isSelected = scope.name === selectedScopeName;
                            return (
                              <tr
                                key={scope.name}
                                className={
                                  isSelected ?
                                    "dhcp-page__row dhcp-page__row--selected"
                                  : "dhcp-page__row"
                                }
                                onClick={() => handleScopeSelect(scope.name)}
                              >
                                <td data-title="Scope">
                                  <div className="dhcp-page__scope-name">
                                    {scope.name}
                                  </div>
                                  <div className="dhcp-page__scope-meta">
                                    {scope.networkAddress ?? "Network unknown"}
                                  </div>
                                </td>
                                <td data-title="Range">
                                  {scope.startingAddress} –{" "}
                                  {scope.endingAddress}
                                </td>
                                <td data-title="Mask">{scope.subnetMask}</td>
                                <td data-title="Status">
                                  <span
                                    className={`badge ${scope.enabled ? "badge--success" : "badge--muted"}`}
                                  >
                                    {scope.enabled ? "Enabled" : "Disabled"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="dhcp-page__card">
                  {!selectedScopeName &&
                    scopes.length === 0 &&
                    scopeListState === "success" && (
                      <div className="dhcp-page__placeholder">
                        No DHCP scopes configured on {selectedNodeLabel}. Create
                        scopes in the Technitium DNS web interface.
                      </div>
                    )}

                  {!selectedScopeName && scopes.length > 0 && (
                    <div className="dhcp-page__placeholder">
                      Select a scope from the list to view configuration and
                      clone options.
                    </div>
                  )}

                  {selectedScopeName && scopeDetailState === "loading" && (
                    <div className="dhcp-page__placeholder">
                      Loading scope details…
                    </div>
                  )}

                  {selectedScopeName && scopeDetailState === "error" && (
                    <div className="dhcp-page__error">
                      {scopeDetailError ?? "Unable to load scope details."}
                    </div>
                  )}

                  {selectedScopeName &&
                    scopeDetailState === "success" &&
                    currentScope && (
                      <>
                        {/* Tab Switcher */}
                        <div className="configuration__tab-switcher">
                          <button
                            type="button"
                            className={`configuration__tab ${activeTab === "scope-details" ? "configuration__tab--active" : ""}`}
                            onClick={() => handleTabChange("scope-details")}
                          >
                            Scope Details
                            {isDirty && activeTab === "scope-details" && (
                              <span className="configuration__tab-badge">
                                ●
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            className={`configuration__tab ${activeTab === "clone" ? "configuration__tab--active" : ""}`}
                            onClick={() => handleTabChange("clone")}
                          >
                            Clone
                          </button>
                        </div>

                        <div className="dhcp-page__details">
                          {/* Scope Details Tab */}
                          {activeTab === "scope-details" && (
                            <>
                              <section
                                className="dhcp-page__clone-panel dhcp-page__update-panel dhcp-page__clone-form"
                                aria-labelledby="dhcp-update-scope-title"
                              >
                                <h3 id="dhcp-update-scope-tdhcp-page__clone-griditle">
                                  Scope Configuration
                                </h3>
                                <p className="dhcp-page__clone-intro">
                                  Modify the settings for this DHCP scope on{" "}
                                  {selectedNodeLabel}.
                                </p>

                                <div className="field-group">
                                  <label htmlFor="dhcp-rename-scope">
                                    Rename scope
                                  </label>
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: "0.5rem",
                                      alignItems: "center",
                                    }}
                                  >
                                    <input
                                      id="dhcp-rename-scope"
                                      name="renameScopeName"
                                      type="text"
                                      value={renameScopeName}
                                      onChange={(event) =>
                                        setRenameScopeName(event.target.value)
                                      }
                                      placeholder={selectedScopeName ?? ""}
                                      disabled={renameState === "loading"}
                                    />
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleRenameScope}
                                      disabled={renameSubmitDisabled}
                                      title="Rename this scope on the current node"
                                    >
                                      {renameState === "loading" ?
                                        "Renaming…"
                                      : "Rename"}
                                    </button>
                                  </div>
                                  <p className="field-hint">
                                    Renames this scope on the current node. Use
                                    clone to copy to another node.
                                  </p>
                                  {renameState === "error" && renameError && (
                                    <div
                                      className="dhcp-page__error"
                                      role="alert"
                                    >
                                      {renameError}
                                    </div>
                                  )}
                                  {renameState === "success" &&
                                    renameMessage && (
                                      <div
                                        className="dhcp-page__success"
                                        role="status"
                                      >
                                        {renameMessage}
                                      </div>
                                    )}
                                </div>

                                <div className="field-group field-group--inline">
                                  <label
                                    className="checkbox"
                                    htmlFor="dhcp-scope-enabled-toggle"
                                  >
                                    <input
                                      id="dhcp-scope-enabled-toggle"
                                      name="scopeEnabled"
                                      type="checkbox"
                                      checked={draftScopeEnabled}
                                      onChange={(event) =>
                                        setDraftScopeEnabled(
                                          event.target.checked,
                                        )
                                      }
                                      disabled={updateState === "loading"}
                                    />
                                    <span>Enable scope on this node</span>
                                  </label>
                                </div>

                                <div className="dhcp-page__clone-section-header">
                                  <h4>Network Settings</h4>
                                </div>

                                <div className="dhcp-page__clone-grid">
                                  <div
                                    className={`field-group${!isValidIPv4Address(draftStartingAddress) ? " field-group--error" : ""}`}
                                  >
                                    <label htmlFor="dhcp-starting-address">
                                      Starting address
                                    </label>
                                    <input
                                      id="dhcp-starting-address"
                                      name="startingAddress"
                                      type="text"
                                      value={draftStartingAddress}
                                      onChange={(event) =>
                                        setDraftStartingAddress(
                                          event.target.value,
                                        )
                                      }
                                    />
                                    {!isValidIPv4Address(
                                      draftStartingAddress,
                                    ) && (
                                      <span className="field-group__error-message">
                                        Invalid IPv4 address (each octet must be
                                        0-255)
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className={`field-group${!isValidIPv4Address(draftEndingAddress) ? " field-group--error" : ""}`}
                                  >
                                    <label htmlFor="dhcp-ending-address">
                                      Ending address
                                    </label>
                                    <input
                                      id="dhcp-ending-address"
                                      name="endingAddress"
                                      type="text"
                                      value={draftEndingAddress}
                                      onChange={(event) =>
                                        setDraftEndingAddress(
                                          event.target.value,
                                        )
                                      }
                                    />
                                    {!isValidIPv4Address(
                                      draftEndingAddress,
                                    ) && (
                                      <span className="field-group__error-message">
                                        Invalid IPv4 address (each octet must be
                                        0-255)
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className={`field-group${!isValidIPv4Address(draftSubnetMask) ? " field-group--error" : ""}`}
                                  >
                                    <label htmlFor="dhcp-subnet-mask">
                                      Subnet mask
                                    </label>
                                    <input
                                      id="dhcp-subnet-mask"
                                      name="subnetMask"
                                      type="text"
                                      value={draftSubnetMask}
                                      onChange={(event) =>
                                        setDraftSubnetMask(event.target.value)
                                      }
                                    />
                                    {!isValidIPv4Address(draftSubnetMask) && (
                                      <span className="field-group__error-message">
                                        Invalid IPv4 address (each octet must be
                                        0-255)
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    className={`field-group${!isValidIPv4Address(draftRouterAddress) ? " field-group--error" : ""}`}
                                  >
                                    <label htmlFor="dhcp-router-address">
                                      Router address
                                    </label>
                                    <input
                                      id="dhcp-router-address"
                                      name="routerAddress"
                                      type="text"
                                      value={draftRouterAddress}
                                      placeholder="Optional"
                                      onChange={(event) =>
                                        setDraftRouterAddress(
                                          event.target.value,
                                        )
                                      }
                                    />
                                    {!isValidIPv4Address(
                                      draftRouterAddress,
                                    ) && (
                                      <span className="field-group__error-message">
                                        Invalid IPv4 address (each octet must be
                                        0-255)
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <Divider />
                                <div className="dhcp-page__dns-grid">
                                  <div className="field-group">
                                    <label htmlFor="dhcp-dns-servers">
                                      DNS servers (one per line)
                                    </label>
                                    <textarea
                                      id="dhcp-dns-servers"
                                      name="dnsServers"
                                      rows={3}
                                      value={draftDnsServers}
                                      disabled={draftUseThisDnsServer}
                                      placeholder="192.168.1.1&#10;8.8.8.8"
                                      onChange={(event) =>
                                        setDraftDnsServers(event.target.value)
                                      }
                                    />
                                  </div>
                                  <div className="dhcp-page__domain-fields">
                                    <div className="field-group">
                                      <label htmlFor="dhcp-domain-name">
                                        Domain name
                                      </label>
                                      <input
                                        id="dhcp-domain-name"
                                        name="domainName"
                                        type="text"
                                        value={draftDomainName}
                                        placeholder="example.com"
                                        onChange={(event) =>
                                          setDraftDomainName(event.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="field-group field-group--inline dhcp-page__use-dns-checkbox">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-use-this-dns"
                                      >
                                        <input
                                          id="dhcp-use-this-dns"
                                          name="useThisDnsServer"
                                          type="checkbox"
                                          checked={draftUseThisDnsServer}
                                          onChange={(event) =>
                                            setDraftUseThisDnsServer(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>
                                          Use this node as the DNS server for
                                          DHCP clients
                                        </span>
                                      </label>
                                    </div>
                                  </div>
                                  <div className="field-group">
                                    <label htmlFor="dhcp-domain-search-list">
                                      Domain search list
                                    </label>
                                    <textarea
                                      id="dhcp-domain-search-list"
                                      name="domainSearchList"
                                      rows={3}
                                      value={draftDomainSearchList}
                                      placeholder="home.arpa&#10;example.com"
                                      onChange={(event) =>
                                        setDraftDomainSearchList(
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </div>
                                </div>
                                <Divider />
                                <div className="dhcp-page__clone-grid">
                                  <div className="field-group">
                                    <label htmlFor="dhcp-lease-days">
                                      Lease duration (days)
                                    </label>
                                    <input
                                      id="dhcp-lease-days"
                                      name="leaseDays"
                                      type="number"
                                      min="0"
                                      value={draftLeaseDays}
                                      onChange={(event) =>
                                        setDraftLeaseDays(event.target.value)
                                      }
                                    />
                                  </div>
                                  <div className="field-group">
                                    <label htmlFor="dhcp-lease-hours">
                                      Lease duration (hours)
                                    </label>
                                    <input
                                      id="dhcp-lease-hours"
                                      name="leaseHours"
                                      type="number"
                                      min="0"
                                      max="23"
                                      value={draftLeaseHours}
                                      onChange={(event) =>
                                        setDraftLeaseHours(event.target.value)
                                      }
                                    />
                                  </div>
                                  <div className="field-group">
                                    <label htmlFor="dhcp-lease-minutes">
                                      Lease duration (minutes)
                                    </label>
                                    <input
                                      id="dhcp-lease-minutes"
                                      name="leaseMinutes"
                                      type="number"
                                      min="0"
                                      max="59"
                                      value={draftLeaseMinutes}
                                      onChange={(event) =>
                                        setDraftLeaseMinutes(event.target.value)
                                      }
                                    />
                                  </div>
                                </div>

                                {/* Advanced Configuration Sections */}
                                <details className="dhcp-page__advanced">
                                  <summary>
                                    Lease pacing &amp; validation
                                  </summary>
                                  <div className="dhcp-page__clone-grid dhcp-page__advanced-grid">
                                    <div className="field-group">
                                      <label htmlFor="dhcp-offer-delay">
                                        Offer delay (ms)
                                      </label>
                                      <input
                                        id="dhcp-offer-delay"
                                        name="offerDelay"
                                        type="number"
                                        min="0"
                                        value={draftOfferDelay}
                                        onChange={(event) =>
                                          setDraftOfferDelay(event.target.value)
                                        }
                                      />
                                      <p className="field-hint">
                                        Delay DHCP offers to avoid collisions.
                                      </p>
                                    </div>
                                    <div className="field-group field-group--inline">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-ping-check"
                                      >
                                        <input
                                          id="dhcp-ping-check"
                                          name="pingCheckEnabled"
                                          type="checkbox"
                                          checked={draftPingCheckEnabled}
                                          onChange={(event) =>
                                            setDraftPingCheckEnabled(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>
                                          Ping address before offering lease
                                        </span>
                                      </label>
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-ping-timeout">
                                        Ping timeout (ms)
                                      </label>
                                      <input
                                        id="dhcp-ping-timeout"
                                        name="pingTimeout"
                                        type="number"
                                        min="0"
                                        value={draftPingTimeout}
                                        onChange={(event) =>
                                          setDraftPingTimeout(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-ping-retries">
                                        Ping retries
                                      </label>
                                      <input
                                        id="dhcp-ping-retries"
                                        name="pingRetries"
                                        type="number"
                                        min="0"
                                        value={draftPingRetries}
                                        onChange={(event) =>
                                          setDraftPingRetries(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                  </div>
                                </details>

                                <details className="dhcp-page__advanced">
                                  <summary>
                                    DNS updates &amp; server identity
                                  </summary>
                                  <div className="dhcp-page__clone-grid dhcp-page__advanced-grid">
                                    <div className="field-group field-group--inline">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-dns-updates"
                                      >
                                        <input
                                          id="dhcp-dns-updates"
                                          name="dnsUpdates"
                                          type="checkbox"
                                          checked={draftDnsUpdates}
                                          onChange={(event) =>
                                            setDraftDnsUpdates(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>Allow dynamic DNS updates</span>
                                      </label>
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-dns-ttl">
                                        DNS TTL (seconds)
                                      </label>
                                      <input
                                        id="dhcp-dns-ttl"
                                        name="dnsTtl"
                                        type="number"
                                        min="0"
                                        value={draftDnsTtl}
                                        onChange={(event) =>
                                          setDraftDnsTtl(event.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-server-address">
                                        Server address override
                                      </label>
                                      <input
                                        id="dhcp-server-address"
                                        name="serverAddress"
                                        type="text"
                                        value={draftServerAddress}
                                        placeholder="Optional"
                                        onChange={(event) =>
                                          setDraftServerAddress(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-server-host">
                                        Server hostname
                                      </label>
                                      <input
                                        id="dhcp-server-host"
                                        name="serverHostName"
                                        type="text"
                                        value={draftServerHostName}
                                        placeholder="Optional"
                                        onChange={(event) =>
                                          setDraftServerHostName(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-boot-file">
                                        Boot file name
                                      </label>
                                      <input
                                        id="dhcp-boot-file"
                                        name="bootFileName"
                                        type="text"
                                        value={draftBootFileName}
                                        placeholder="Optional"
                                        onChange={(event) =>
                                          setDraftBootFileName(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group field-group--inline">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-use-this-dns-advanced"
                                      >
                                        <input
                                          id="dhcp-use-this-dns-advanced"
                                          name="useThisDnsServerAdvanced"
                                          type="checkbox"
                                          checked={draftUseThisDnsServer}
                                          onChange={(event) =>
                                            setDraftUseThisDnsServer(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>
                                          Advertise this server as DNS
                                        </span>
                                      </label>
                                    </div>
                                  </div>
                                </details>

                                <details className="dhcp-page__advanced">
                                  <summary>Ancillary services</summary>
                                  <div className="dhcp-page__clone-grid dhcp-page__advanced-grid">
                                    <div className="field-group">
                                      <label htmlFor="dhcp-wins-servers">
                                        WINS servers (one per line)
                                      </label>
                                      <textarea
                                        id="dhcp-wins-servers"
                                        name="winsServers"
                                        value={draftWinsServers}
                                        onChange={(event) =>
                                          setDraftWinsServers(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-ntp-servers">
                                        NTP servers (one per line)
                                      </label>
                                      <textarea
                                        id="dhcp-ntp-servers"
                                        name="ntpServers"
                                        value={draftNtpServers}
                                        onChange={(event) =>
                                          setDraftNtpServers(event.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-ntp-domains">
                                        NTP domains (one per line)
                                      </label>
                                      <textarea
                                        id="dhcp-ntp-domains"
                                        name="ntpDomains"
                                        value={draftNtpDomains}
                                        onChange={(event) =>
                                          setDraftNtpDomains(event.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-capwap">
                                        CAPWAP controllers (one per line)
                                      </label>
                                      <textarea
                                        id="dhcp-capwap"
                                        name="capwapControllers"
                                        value={draftCapwapControllers}
                                        onChange={(event) =>
                                          setDraftCapwapControllers(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-tftp">
                                        TFTP servers (one per line)
                                      </label>
                                      <textarea
                                        id="dhcp-tftp"
                                        name="tftpServers"
                                        value={draftTftpServers}
                                        onChange={(event) =>
                                          setDraftTftpServers(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                  </div>
                                </details>

                                <details className="dhcp-page__advanced">
                                  <summary>Static routes &amp; options</summary>
                                  <div className="dhcp-page__list-section">
                                    <header>
                                      <h4>Static routes</h4>
                                      <p>
                                        Define classless static routes
                                        advertised via option 121.
                                      </p>
                                    </header>
                                    {draftStaticRoutes.length === 0 && (
                                      <p className="dhcp-page__list-empty">
                                        No static routes defined.
                                      </p>
                                    )}
                                    {draftStaticRoutes.map((route) => (
                                      <div
                                        key={route.id}
                                        className="dhcp-page__list-row"
                                      >
                                        <div className="dhcp-page__list-row-grid">
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-static-destination-${route.id}`}
                                            >
                                              Destination
                                            </label>
                                            <input
                                              id={`dhcp-static-destination-${route.id}`}
                                              name={`staticRouteDestination-${route.id}`}
                                              type="text"
                                              value={route.destination}
                                              onChange={(event) =>
                                                handleStaticRouteChange(
                                                  route.id,
                                                  "destination",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-static-mask-${route.id}`}
                                            >
                                              Subnet mask
                                            </label>
                                            <input
                                              id={`dhcp-static-mask-${route.id}`}
                                              name={`staticRouteSubnetMask-${route.id}`}
                                              type="text"
                                              value={route.subnetMask}
                                              onChange={(event) =>
                                                handleStaticRouteChange(
                                                  route.id,
                                                  "subnetMask",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-static-router-${route.id}`}
                                            >
                                              Router
                                            </label>
                                            <input
                                              id={`dhcp-static-router-${route.id}`}
                                              name={`staticRouteRouter-${route.id}`}
                                              type="text"
                                              value={route.router}
                                              onChange={(event) =>
                                                handleStaticRouteChange(
                                                  route.id,
                                                  "router",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="secondary dhcp-page__list-remove"
                                          onClick={() =>
                                            handleRemoveStaticRoute(route.id)
                                          }
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleAddStaticRoute}
                                    >
                                      Add static route
                                    </button>
                                  </div>

                                  <div className="dhcp-page__list-section">
                                    <header>
                                      <h4>Vendor info (option 43)</h4>
                                      <p>
                                        Supply vendor-specific identifier and
                                        payload.
                                      </p>
                                    </header>
                                    {draftVendorInfo.length === 0 && (
                                      <p className="dhcp-page__list-empty">
                                        No vendor entries defined.
                                      </p>
                                    )}
                                    {draftVendorInfo.map((entry) => (
                                      <div
                                        key={entry.id}
                                        className="dhcp-page__list-row"
                                      >
                                        <div className="dhcp-page__list-row-grid">
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-vendor-identifier-${entry.id}`}
                                            >
                                              Identifier
                                            </label>
                                            <input
                                              id={`dhcp-vendor-identifier-${entry.id}`}
                                              name={`vendorIdentifier-${entry.id}`}
                                              type="text"
                                              value={entry.identifier}
                                              onChange={(event) =>
                                                handleVendorInfoChange(
                                                  entry.id,
                                                  "identifier",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-vendor-info-${entry.id}`}
                                            >
                                              Information
                                            </label>
                                            <textarea
                                              id={`dhcp-vendor-info-${entry.id}`}
                                              name={`vendorInformation-${entry.id}`}
                                              value={entry.information}
                                              onChange={(event) =>
                                                handleVendorInfoChange(
                                                  entry.id,
                                                  "information",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="secondary dhcp-page__list-remove"
                                          onClick={() =>
                                            handleRemoveVendorInfo(entry.id)
                                          }
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleAddVendorInfo}
                                    >
                                      Add vendor entry
                                    </button>
                                  </div>

                                  <div className="dhcp-page__list-section">
                                    <header>
                                      <h4>Generic DHCP options</h4>
                                      <p>
                                        Specify additional DHCP options by code.
                                      </p>
                                    </header>
                                    {draftGenericOptions.length === 0 && (
                                      <p className="dhcp-page__list-empty">
                                        No generic options defined.
                                      </p>
                                    )}
                                    {draftGenericOptions.map((entry) => {
                                      const conversion =
                                        describeGenericOptionValue(entry);
                                      const codeId = `dhcp-generic-code-${entry.id}`;
                                      const valueId = `dhcp-generic-value-${entry.id}`;
                                      const asciiToggleDisabled =
                                        entry.mode !== "ascii" &&
                                        (conversion.status === "invalid" ||
                                          (conversion.status === "hex" &&
                                            !conversion.ascii));

                                      return (
                                        <div
                                          key={entry.id}
                                          className="dhcp-page__list-row"
                                        >
                                          <div className="dhcp-page__list-row-grid dhcp-page__list-row-grid--option">
                                            <div className="field-group">
                                              <label htmlFor={codeId}>
                                                Option code
                                              </label>
                                              <input
                                                id={codeId}
                                                name={`genericOptionCode-${entry.id}`}
                                                type="number"
                                                min="0"
                                                value={entry.code}
                                                onChange={(event) =>
                                                  handleGenericOptionChange(
                                                    entry.id,
                                                    "code",
                                                    event.target.value,
                                                  )
                                                }
                                              />
                                            </div>
                                            <div className="field-group">
                                              <div className="dhcp-page__value-header">
                                                <label htmlFor={valueId}>
                                                  Value
                                                </label>
                                                <div className="dhcp-page__value-mode">
                                                  <span>Format</span>
                                                  <div className="dhcp-page__value-mode-buttons">
                                                    <button
                                                      type="button"
                                                      className={
                                                        entry.mode === "ascii" ?
                                                          "active"
                                                        : ""
                                                      }
                                                      onClick={() =>
                                                        handleGenericOptionModeChange(
                                                          entry.id,
                                                          "ascii",
                                                        )
                                                      }
                                                      disabled={
                                                        asciiToggleDisabled
                                                      }
                                                    >
                                                      ASCII
                                                    </button>
                                                    <button
                                                      type="button"
                                                      className={
                                                        entry.mode === "hex" ?
                                                          "active"
                                                        : ""
                                                      }
                                                      onClick={() =>
                                                        handleGenericOptionModeChange(
                                                          entry.id,
                                                          "hex",
                                                        )
                                                      }
                                                    >
                                                      HEX
                                                    </button>
                                                  </div>
                                                </div>
                                              </div>
                                              <textarea
                                                id={valueId}
                                                value={entry.value}
                                                onChange={(event) =>
                                                  handleGenericOptionChange(
                                                    entry.id,
                                                    "value",
                                                    event.target.value,
                                                  )
                                                }
                                                placeholder={
                                                  entry.mode === "ascii" ?
                                                    "ASCII text (e.g., Example)"
                                                  : "Hex bytes (e.g., 45:78:61:6D:70:6C:65)"
                                                }
                                                spellCheck={
                                                  entry.mode === "ascii"
                                                }
                                                rows={
                                                  entry.mode === "ascii" ? 2 : 3
                                                }
                                                className="dhcp-page__textarea"
                                              />
                                              {conversion.status ===
                                                "ascii" && (
                                                <p className="dhcp-page__conversion">
                                                  <strong>HEX:</strong>{" "}
                                                  {conversion.hex}
                                                </p>
                                              )}
                                              {conversion.status === "hex" && (
                                                <p className="dhcp-page__conversion">
                                                  <strong>
                                                    Normalized HEX:
                                                  </strong>{" "}
                                                  {conversion.hex}
                                                  {conversion.ascii && (
                                                    <>
                                                      <br />
                                                      <strong>
                                                        ASCII:
                                                      </strong>{" "}
                                                      {conversion.ascii}
                                                    </>
                                                  )}
                                                  {conversion.hasNonPrintable && (
                                                    <>
                                                      <br />
                                                      <em>
                                                        Contains non-printable
                                                        characters
                                                      </em>
                                                    </>
                                                  )}
                                                </p>
                                              )}
                                              {conversion.status ===
                                                "invalid" && (
                                                <p className="dhcp-page__conversion dhcp-page__conversion--error">
                                                  Enter HEX bytes like 01:02:FF
                                                  or switch to ASCII input.
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            className="secondary dhcp-page__list-remove"
                                            onClick={() =>
                                              handleRemoveGenericOption(
                                                entry.id,
                                              )
                                            }
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      );
                                    })}
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleAddGenericOption}
                                    >
                                      Add option
                                    </button>
                                  </div>
                                </details>

                                <details className="dhcp-page__advanced">
                                  <summary>
                                    Exclusions &amp; reservations
                                  </summary>
                                  <div className="dhcp-page__list-section">
                                    <header>
                                      <h4>Exclusion ranges</h4>
                                      <p>
                                        Reserve blocks of addresses that should
                                        not be handed out.
                                      </p>
                                    </header>
                                    {draftExclusions.length === 0 && (
                                      <p className="dhcp-page__list-empty">
                                        No exclusion ranges defined.
                                      </p>
                                    )}
                                    {draftExclusions.map((entry) => (
                                      <div
                                        key={entry.id}
                                        className="dhcp-page__list-row"
                                      >
                                        <div className="dhcp-page__list-row-grid">
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-exclusion-start-${entry.id}`}
                                            >
                                              Start address
                                            </label>
                                            <input
                                              id={`dhcp-exclusion-start-${entry.id}`}
                                              name={`exclusionStartAddress-${entry.id}`}
                                              type="text"
                                              value={entry.startingAddress}
                                              onChange={(event) =>
                                                handleExclusionChange(
                                                  entry.id,
                                                  "startingAddress",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-exclusion-end-${entry.id}`}
                                            >
                                              End address
                                            </label>
                                            <input
                                              id={`dhcp-exclusion-end-${entry.id}`}
                                              name={`exclusionEndAddress-${entry.id}`}
                                              type="text"
                                              value={entry.endingAddress}
                                              onChange={(event) =>
                                                handleExclusionChange(
                                                  entry.id,
                                                  "endingAddress",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="secondary dhcp-page__list-remove"
                                          onClick={() =>
                                            handleRemoveExclusion(entry.id)
                                          }
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleAddExclusion}
                                    >
                                      Add exclusion
                                    </button>
                                  </div>

                                  <div className="dhcp-page__list-section">
                                    <header>
                                      <h4>Reserved leases</h4>
                                      <p>
                                        Pin specific MAC addresses to fixed IP
                                        assignments.
                                      </p>
                                    </header>
                                    {draftReservedLeases.length === 0 && (
                                      <p className="dhcp-page__list-empty">
                                        No reserved leases defined.
                                      </p>
                                    )}
                                    {draftReservedLeases.map((entry) => (
                                      <div
                                        key={entry.id}
                                        className="dhcp-page__list-row"
                                      >
                                        <div className="dhcp-page__list-row-grid dhcp-page__list-row-grid--wide">
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-reserved-host-${entry.id}`}
                                            >
                                              Hostname
                                            </label>
                                            <input
                                              id={`dhcp-reserved-host-${entry.id}`}
                                              name={`reservedHostName-${entry.id}`}
                                              type="text"
                                              value={entry.hostName}
                                              placeholder="Optional"
                                              onChange={(event) =>
                                                handleReservedLeaseChange(
                                                  entry.id,
                                                  "hostName",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-reserved-mac-${entry.id}`}
                                            >
                                              Hardware address
                                            </label>
                                            <input
                                              id={`dhcp-reserved-mac-${entry.id}`}
                                              name={`reservedHardwareAddress-${entry.id}`}
                                              type="text"
                                              value={entry.hardwareAddress}
                                              onChange={(event) =>
                                                handleReservedLeaseChange(
                                                  entry.id,
                                                  "hardwareAddress",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-reserved-ip-${entry.id}`}
                                            >
                                              IP address
                                            </label>
                                            <input
                                              id={`dhcp-reserved-ip-${entry.id}`}
                                              name={`reservedIpAddress-${entry.id}`}
                                              type="text"
                                              value={entry.address}
                                              onChange={(event) =>
                                                handleReservedLeaseChange(
                                                  entry.id,
                                                  "address",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                        </div>
                                        <div className="dhcp-page__list-row-grid dhcp-page__list-row-grid--wide">
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-reserved-comment-${entry.id}`}
                                            >
                                              Comment
                                            </label>
                                            <textarea
                                              id={`dhcp-reserved-comment-${entry.id}`}
                                              name={`reservedComment-${entry.id}`}
                                              value={entry.comments}
                                              placeholder="Optional"
                                              onChange={(event) =>
                                                handleReservedLeaseChange(
                                                  entry.id,
                                                  "comments",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="secondary dhcp-page__list-remove"
                                          onClick={() =>
                                            handleRemoveReservedLease(entry.id)
                                          }
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleAddReservedLease}
                                    >
                                      Add reserved lease
                                    </button>
                                  </div>

                                  <div className="dhcp-page__advanced-grid dhcp-page__advanced-grid--toggles">
                                    <div className="field-group field-group--inline">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-block-locally-admin"
                                      >
                                        <input
                                          id="dhcp-block-locally-admin"
                                          name="blockLocallyAdministered"
                                          type="checkbox"
                                          checked={
                                            draftBlockLocallyAdministered
                                          }
                                          onChange={(event) =>
                                            setDraftBlockLocallyAdministered(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>
                                          Block locally administered MAC
                                          addresses
                                        </span>
                                      </label>
                                    </div>
                                    <div className="field-group field-group--inline">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-ignore-client-id"
                                      >
                                        <input
                                          id="dhcp-ignore-client-id"
                                          name="ignoreClientId"
                                          type="checkbox"
                                          checked={draftIgnoreClientIdentifier}
                                          onChange={(event) =>
                                            setDraftIgnoreClientIdentifier(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>
                                          Ignore client identifier option
                                        </span>
                                      </label>
                                    </div>
                                  </div>
                                </details>

                                {/* Sticky Save/Reset Footer */}
                                {currentScope && (
                                  <footer className="configuration-editor__footer configuration-editor__footer--sticky">
                                    {isDirty && (
                                      <>
                                        <button
                                          type="button"
                                          className="configuration-editor__footer-hint configuration-editor__footer-hint--clickable"
                                          onClick={() =>
                                            setShowChangesSummary(
                                              !showChangesSummary,
                                            )
                                          }
                                          title="Click to see what will be saved"
                                        >
                                          {pendingChanges.length > 0 ?
                                            `You have unsaved changes (${pendingChanges.length}) ${showChangesSummary ? "▼" : "▲"}`
                                          : "You have unsaved changes"}
                                        </button>

                                        {showChangesSummary && (
                                          <div className="configuration-editor__changes-summary">
                                            {pendingChanges.length > 0 ?
                                              <ul className="configuration-editor__changes-list">
                                                {pendingChanges.map(
                                                  (change, idx) => (
                                                    <li
                                                      key={idx}
                                                      className={`change-item change-item--${change.type}`}
                                                    >
                                                      <span className="change-icon">
                                                        <FontAwesomeIcon
                                                          icon={
                                                            (
                                                              change.type ===
                                                              "added"
                                                            ) ?
                                                              faPlus
                                                            : (
                                                              change.type ===
                                                              "removed"
                                                            ) ?
                                                              faMinus
                                                            : faPencil
                                                          }
                                                        />
                                                      </span>
                                                      <span className="change-type">
                                                        {change.category}
                                                      </span>
                                                      <span className="change-description">
                                                        {change.description}
                                                        {change.detail && (
                                                          <span className="change-detail">
                                                            {" "}
                                                            • {change.detail}
                                                          </span>
                                                        )}
                                                      </span>
                                                    </li>
                                                  ),
                                                )}
                                              </ul>
                                            : <p className="configuration-editor__changes-fallback">
                                                Configuration has been modified.
                                                Click "Save Changes" to apply.
                                              </p>
                                            }
                                          </div>
                                        )}
                                      </>
                                    )}
                                    <div className="configuration-editor__footer-actions">
                                      <button
                                        type="button"
                                        className="danger"
                                        onClick={handleDeleteScope}
                                        disabled={
                                          updateState === "loading" ||
                                          !selectedScopeName
                                        }
                                        title="Delete this DHCP scope"
                                      >
                                        Delete Scope
                                      </button>
                                      <div style={{ flex: 1 }}></div>
                                      <button
                                        type="button"
                                        className="secondary"
                                        title="Discard changes (Escape)"
                                        onClick={handleResetChanges}
                                        disabled={
                                          !isDirty || updateState === "loading"
                                        }
                                      >
                                        Reset
                                      </button>
                                      <button
                                        type="button"
                                        className="primary"
                                        data-keyboard-save
                                        title={`Save Changes (${saveShortcut})`}
                                        onClick={handleUpdate}
                                        disabled={
                                          !isDirty ||
                                          updateState === "loading" ||
                                          cloneState === "loading"
                                        }
                                      >
                                        {updateState === "loading" ?
                                          "Saving…"
                                        : "Save Changes"}
                                      </button>
                                    </div>
                                    {updateState === "success" &&
                                      updateMessage && (
                                        <div
                                          className="dhcp-page__success"
                                          role="status"
                                        >
                                          {updateMessage}
                                        </div>
                                      )}
                                    {updateState === "error" && updateError && (
                                      <div
                                        className="dhcp-page__error"
                                        role="alert"
                                      >
                                        {updateError}
                                      </div>
                                    )}
                                  </footer>
                                )}
                              </section>
                            </>
                          )}

                          {/* Clone Tab */}
                          {activeTab === "clone" && (
                            <form
                              className="dhcp-page__clone-form dhcp-page__clone-panel"
                              onSubmit={handleClone}
                              aria-labelledby="dhcp-clone-form-title"
                            >
                              <fieldset>
                                <legend id="dhcp-clone-form-title">
                                  Clone scope
                                </legend>
                                <p className="dhcp-page__clone-intro">
                                  {cloneMode === "local" ?
                                    "Create a copy of this DHCP scope on the same node with a new name and optional network adjustments."
                                  : "Copy this DHCP scope template to another node with network-specific customizations (IP ranges, subnets, etc.)."
                                  }
                                </p>

                                <div
                                  className="dhcp-page__clone-mode"
                                  role="group"
                                  aria-label="Clone destination"
                                >
                                  <label
                                    className={`dhcp-page__clone-mode-option${
                                      cloneMode === "local" ?
                                        " dhcp-page__clone-mode-option--active"
                                      : ""
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name="dhcp-clone-mode"
                                      value="local"
                                      checked={cloneMode === "local"}
                                      onChange={() => setCloneMode("local")}
                                    />
                                    <div>
                                      <strong>
                                        <FontAwesomeIcon icon={faClipboard} />{" "}
                                        Duplicate on this node
                                      </strong>
                                      <span>
                                        Create a copy with a new name on{" "}
                                        {selectedNodeId || "the same server"}{" "}
                                        (useful for similar subnets)
                                      </span>
                                    </div>
                                  </label>
                                  <label
                                    className={`dhcp-page__clone-mode-option${
                                      cloneMode === "remote" ?
                                        " dhcp-page__clone-mode-option--active"
                                      : ""
                                    }${!hasRemoteTargets ? " dhcp-page__clone-mode-option--disabled" : ""}`}
                                  >
                                    <input
                                      type="radio"
                                      name="dhcp-clone-mode"
                                      value="remote"
                                      checked={cloneMode === "remote"}
                                      disabled={!hasRemoteTargets}
                                      onChange={() => setCloneMode("remote")}
                                    />
                                    <div>
                                      <strong>🌐 Clone to peer node</strong>
                                      <span>
                                        {hasRemoteTargets ?
                                          "Copy scope configuration template to another server with network adjustments"
                                        : "No peer nodes available - add another node to enable cross-node cloning"
                                        }
                                      </span>
                                    </div>
                                  </label>
                                </div>

                                {cloneMode === "remote" && (
                                  <div className="field-group">
                                    <label htmlFor="dhcp-target-node">
                                      Destination node
                                    </label>
                                    <select
                                      id="dhcp-target-node"
                                      name="targetNode"
                                      value={targetNodeId}
                                      onChange={(event) =>
                                        setTargetNodeId(event.target.value)
                                      }
                                    >
                                      <option value="" disabled>
                                        Select destination
                                      </option>
                                      {targetNodeOptions.map((node) => (
                                        <option key={node.id} value={node.id}>
                                          {node.name || node.id}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}

                                <div className="field-group">
                                  <label htmlFor="dhcp-new-name">
                                    New scope name{" "}
                                    {cloneMode === "local" ?
                                      "(required)"
                                    : "(optional)"}
                                  </label>
                                  <input
                                    id="dhcp-new-name"
                                    name="newScopeName"
                                    type="text"
                                    value={newScopeName}
                                    placeholder={
                                      (
                                        cloneMode === "local" &&
                                        selectedScopeName
                                      ) ?
                                        `${selectedScopeName}-copy`
                                      : (selectedScopeName ?? "")
                                    }
                                    onChange={(event) => {
                                      setNewScopeName(event.target.value);
                                      setNewScopeNameTouched(true);
                                    }}
                                  />
                                  {cloneMode === "local" && (
                                    <p className="field-hint">
                                      Name must be unique on this node.
                                    </p>
                                  )}
                                </div>

                                {isLocalClone && (
                                  <>
                                    <div className="dhcp-page__clone-section-header">
                                      <h4>Target IP range &amp; network</h4>
                                      <p className="field-hint">
                                        Adjust the pool for the cloned scope.
                                        The source scope stays unchanged.
                                      </p>
                                    </div>
                                    <div className="dhcp-page__clone-grid">
                                      <div className="field-group">
                                        <label htmlFor="dhcp-clone-start">
                                          Starting address
                                        </label>
                                        <input
                                          id="dhcp-clone-start"
                                          name="cloneStartingAddress"
                                          type="text"
                                          value={cloneStartingAddress}
                                          onChange={(event) =>
                                            setCloneStartingAddress(
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </div>
                                      <div className="field-group">
                                        <label htmlFor="dhcp-clone-end">
                                          Ending address
                                        </label>
                                        <input
                                          id="dhcp-clone-end"
                                          name="cloneEndingAddress"
                                          type="text"
                                          value={cloneEndingAddress}
                                          onChange={(event) =>
                                            setCloneEndingAddress(
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </div>
                                      <div className="field-group">
                                        <label htmlFor="dhcp-clone-subnet">
                                          Subnet mask
                                        </label>
                                        <input
                                          id="dhcp-clone-subnet"
                                          name="cloneSubnetMask"
                                          type="text"
                                          value={cloneSubnetMask}
                                          onChange={(event) =>
                                            setCloneSubnetMask(
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </div>
                                      <div className="field-group">
                                        <label htmlFor="dhcp-clone-router">
                                          Router / gateway (optional)
                                        </label>
                                        <input
                                          id="dhcp-clone-router"
                                          name="cloneRouterAddress"
                                          type="text"
                                          value={cloneRouterAddress}
                                          placeholder="Optional"
                                          onChange={(event) =>
                                            setCloneRouterAddress(
                                              event.target.value,
                                            )
                                          }
                                        />
                                      </div>
                                    </div>

                                    <div
                                      className="dhcp-page__clone-section-header"
                                      style={{ marginTop: "1.25rem" }}
                                    >
                                      <h4>
                                        DNS &amp; domain settings for clone
                                      </h4>
                                      <p className="field-hint">
                                        Override DNS servers, domain name, and
                                        search list for the new scope only.
                                      </p>
                                    </div>
                                    <div className="dhcp-page__clone-grid dhcp-page__clone-grid--triple">
                                      <div className="field-group">
                                        <label htmlFor="dhcp-clone-dns">
                                          DNS servers (one per line)
                                        </label>
                                        <textarea
                                          id="dhcp-clone-dns"
                                          name="cloneDnsServers"
                                          value={cloneDnsServers}
                                          onChange={(event) =>
                                            setCloneDnsServers(
                                              event.target.value,
                                            )
                                          }
                                          rows={4}
                                        />
                                      </div>
                                      <div className="field-group">
                                        <label htmlFor="dhcp-clone-domain">
                                          Domain name
                                        </label>
                                        <input
                                          id="dhcp-clone-domain"
                                          name="cloneDomainName"
                                          type="text"
                                          value={cloneDomainName}
                                          onChange={(event) =>
                                            setCloneDomainName(
                                              event.target.value,
                                            )
                                          }
                                        />
                                        <label
                                          className="checkbox"
                                          htmlFor="dhcp-clone-use-this-dns"
                                          style={{ marginTop: "0.5rem" }}
                                        >
                                          <input
                                            id="dhcp-clone-use-this-dns"
                                            name="cloneUseThisDnsServer"
                                            type="checkbox"
                                            checked={cloneUseThisDnsServer}
                                            onChange={(event) =>
                                              setCloneUseThisDnsServer(
                                                event.target.checked,
                                              )
                                            }
                                          />
                                          <span>
                                            Use this node as the DNS server for
                                            DHCP clients
                                          </span>
                                        </label>
                                      </div>
                                      <div className="field-group">
                                        <label htmlFor="dhcp-clone-search-list">
                                          Domain search list (one per line)
                                        </label>
                                        <textarea
                                          id="dhcp-clone-search-list"
                                          name="cloneDomainSearchList"
                                          value={cloneDomainSearchList}
                                          onChange={(event) =>
                                            setCloneDomainSearchList(
                                              event.target.value,
                                            )
                                          }
                                          rows={4}
                                        />
                                      </div>
                                    </div>
                                  </>
                                )}

                                <div className="field-group field-group--inline">
                                  <label
                                    className="checkbox"
                                    htmlFor="dhcp-enable-target"
                                  >
                                    <input
                                      id="dhcp-enable-target"
                                      name="enableOnTarget"
                                      type="checkbox"
                                      checked={enableOnTarget}
                                      onChange={(event) =>
                                        setEnableOnTarget(event.target.checked)
                                      }
                                    />
                                    <span>
                                      {isLocalClone ?
                                        "Enable new scope after cloning"
                                      : "Enable scope on target after cloning"}
                                    </span>
                                  </label>
                                </div>

                                <Divider className="dhcp-page__clone-divider" />

                                <div className="dhcp-page__clone-section-header">
                                  <h4>Clone Source Configuration</h4>
                                  <p className="field-hint">
                                    The cloned scope will use the current scope
                                    configuration from the "Scope Configuration"
                                    section above.
                                    {cloneMode === "remote" &&
                                      " Make any necessary adjustments in that section before cloning to the target node."}
                                    {cloneMode === "local" &&
                                      " Make any necessary adjustments in that section before creating the copy."}
                                  </p>
                                </div>

                                <details className="dhcp-page__advanced">
                                  <summary>
                                    Lease pacing &amp; validation
                                  </summary>
                                  <div className="dhcp-page__clone-grid dhcp-page__advanced-grid">
                                    <div className="field-group">
                                      <label htmlFor="dhcp-offer-delay">
                                        Offer delay (ms)
                                      </label>
                                      <input
                                        id="dhcp-offer-delay"
                                        name="offerDelay"
                                        type="number"
                                        min="0"
                                        value={draftOfferDelay}
                                        onChange={(event) =>
                                          setDraftOfferDelay(event.target.value)
                                        }
                                      />
                                      <p className="field-hint">
                                        Delay DHCP offers to avoid collisions.
                                      </p>
                                    </div>
                                    <div className="field-group field-group--inline">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-ping-check"
                                      >
                                        <input
                                          id="dhcp-ping-check"
                                          name="pingCheckEnabled"
                                          type="checkbox"
                                          checked={draftPingCheckEnabled}
                                          onChange={(event) =>
                                            setDraftPingCheckEnabled(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>
                                          Ping address before offering lease
                                        </span>
                                      </label>
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-ping-timeout">
                                        Ping timeout (ms)
                                      </label>
                                      <input
                                        id="dhcp-ping-timeout"
                                        name="pingTimeout"
                                        type="number"
                                        min="0"
                                        value={draftPingTimeout}
                                        onChange={(event) =>
                                          setDraftPingTimeout(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-ping-retries">
                                        Ping retries
                                      </label>
                                      <input
                                        id="dhcp-ping-retries"
                                        name="pingRetries"
                                        type="number"
                                        min="0"
                                        value={draftPingRetries}
                                        onChange={(event) =>
                                          setDraftPingRetries(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                  </div>
                                </details>

                                <details className="dhcp-page__advanced">
                                  <summary>
                                    DNS updates &amp; server identity
                                  </summary>
                                  <div className="dhcp-page__clone-grid dhcp-page__advanced-grid">
                                    <div className="field-group field-group--inline">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-dns-updates"
                                      >
                                        <input
                                          id="dhcp-dns-updates"
                                          name="dnsUpdates"
                                          type="checkbox"
                                          checked={draftDnsUpdates}
                                          onChange={(event) =>
                                            setDraftDnsUpdates(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>Allow dynamic DNS updates</span>
                                      </label>
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-dns-ttl">
                                        DNS TTL (seconds)
                                      </label>
                                      <input
                                        id="dhcp-dns-ttl"
                                        name="dnsTtl"
                                        type="number"
                                        min="0"
                                        value={draftDnsTtl}
                                        onChange={(event) =>
                                          setDraftDnsTtl(event.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-server-address">
                                        Server address override
                                      </label>
                                      <input
                                        id="dhcp-server-address"
                                        name="serverAddress"
                                        type="text"
                                        value={draftServerAddress}
                                        placeholder="Optional"
                                        onChange={(event) =>
                                          setDraftServerAddress(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-server-host">
                                        Server hostname
                                      </label>
                                      <input
                                        id="dhcp-server-host"
                                        name="serverHostName"
                                        type="text"
                                        value={draftServerHostName}
                                        placeholder="Optional"
                                        onChange={(event) =>
                                          setDraftServerHostName(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-boot-file">
                                        Boot file name
                                      </label>
                                      <input
                                        id="dhcp-boot-file"
                                        name="bootFileName"
                                        type="text"
                                        value={draftBootFileName}
                                        placeholder="Optional"
                                        onChange={(event) =>
                                          setDraftBootFileName(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group field-group--inline">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-use-this-dns-advanced"
                                      >
                                        <input
                                          id="dhcp-use-this-dns-advanced"
                                          name="useThisDnsServerAdvanced"
                                          type="checkbox"
                                          checked={draftUseThisDnsServer}
                                          onChange={(event) =>
                                            setDraftUseThisDnsServer(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>
                                          Advertise this server as DNS
                                        </span>
                                      </label>
                                    </div>
                                  </div>
                                </details>

                                <details className="dhcp-page__advanced">
                                  <summary>Ancillary services</summary>
                                  <div className="dhcp-page__clone-grid dhcp-page__advanced-grid">
                                    <div className="field-group">
                                      <label htmlFor="dhcp-wins-servers">
                                        WINS servers (one per line)
                                      </label>
                                      <textarea
                                        id="dhcp-wins-servers"
                                        name="winsServers"
                                        value={draftWinsServers}
                                        onChange={(event) =>
                                          setDraftWinsServers(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-ntp-servers">
                                        NTP servers (one per line)
                                      </label>
                                      <textarea
                                        id="dhcp-ntp-servers"
                                        name="ntpServers"
                                        value={draftNtpServers}
                                        onChange={(event) =>
                                          setDraftNtpServers(event.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-ntp-domains">
                                        NTP domains (one per line)
                                      </label>
                                      <textarea
                                        id="dhcp-ntp-domains"
                                        name="ntpDomains"
                                        value={draftNtpDomains}
                                        onChange={(event) =>
                                          setDraftNtpDomains(event.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-capwap">
                                        CAPWAP controllers (one per line)
                                      </label>
                                      <textarea
                                        id="dhcp-capwap"
                                        name="capwapControllers"
                                        value={draftCapwapControllers}
                                        onChange={(event) =>
                                          setDraftCapwapControllers(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                    <div className="field-group">
                                      <label htmlFor="dhcp-tftp">
                                        TFTP servers (one per line)
                                      </label>
                                      <textarea
                                        id="dhcp-tftp"
                                        name="tftpServers"
                                        value={draftTftpServers}
                                        onChange={(event) =>
                                          setDraftTftpServers(
                                            event.target.value,
                                          )
                                        }
                                      />
                                    </div>
                                  </div>
                                </details>

                                <details className="dhcp-page__advanced">
                                  <summary>Static routes &amp; options</summary>
                                  <div className="dhcp-page__list-section">
                                    <header>
                                      <h4>Static routes</h4>
                                      <p>
                                        Define classless static routes
                                        advertised via option 121.
                                      </p>
                                    </header>
                                    {draftStaticRoutes.length === 0 && (
                                      <p className="dhcp-page__list-empty">
                                        No static routes defined.
                                      </p>
                                    )}
                                    {draftStaticRoutes.map((route) => (
                                      <div
                                        key={route.id}
                                        className="dhcp-page__list-row"
                                      >
                                        <div className="dhcp-page__list-row-grid">
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-static-destination-${route.id}`}
                                            >
                                              Destination
                                            </label>
                                            <input
                                              id={`dhcp-static-destination-${route.id}`}
                                              name={`staticRouteDestination-${route.id}`}
                                              type="text"
                                              value={route.destination}
                                              onChange={(event) =>
                                                handleStaticRouteChange(
                                                  route.id,
                                                  "destination",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-static-mask-${route.id}`}
                                            >
                                              Subnet mask
                                            </label>
                                            <input
                                              id={`dhcp-static-mask-${route.id}`}
                                              name={`staticRouteSubnetMask-${route.id}`}
                                              type="text"
                                              value={route.subnetMask}
                                              onChange={(event) =>
                                                handleStaticRouteChange(
                                                  route.id,
                                                  "subnetMask",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-static-router-${route.id}`}
                                            >
                                              Router
                                            </label>
                                            <input
                                              id={`dhcp-static-router-${route.id}`}
                                              name={`staticRouteRouter-${route.id}`}
                                              type="text"
                                              value={route.router}
                                              onChange={(event) =>
                                                handleStaticRouteChange(
                                                  route.id,
                                                  "router",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="secondary dhcp-page__list-remove"
                                          onClick={() =>
                                            handleRemoveStaticRoute(route.id)
                                          }
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleAddStaticRoute}
                                    >
                                      Add static route
                                    </button>
                                  </div>

                                  <div className="dhcp-page__list-section">
                                    <header>
                                      <h4>Vendor info (option 43)</h4>
                                      <p>
                                        Supply vendor-specific identifier and
                                        payload.
                                      </p>
                                    </header>
                                    {draftVendorInfo.length === 0 && (
                                      <p className="dhcp-page__list-empty">
                                        No vendor entries defined.
                                      </p>
                                    )}
                                    {draftVendorInfo.map((entry) => (
                                      <div
                                        key={entry.id}
                                        className="dhcp-page__list-row"
                                      >
                                        <div className="dhcp-page__list-row-grid">
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-vendor-identifier-${entry.id}`}
                                            >
                                              Identifier
                                            </label>
                                            <input
                                              id={`dhcp-vendor-identifier-${entry.id}`}
                                              name={`vendorIdentifier-${entry.id}`}
                                              type="text"
                                              value={entry.identifier}
                                              onChange={(event) =>
                                                handleVendorInfoChange(
                                                  entry.id,
                                                  "identifier",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-vendor-info-${entry.id}`}
                                            >
                                              Information
                                            </label>
                                            <textarea
                                              id={`dhcp-vendor-info-${entry.id}`}
                                              name={`vendorInformation-${entry.id}`}
                                              value={entry.information}
                                              onChange={(event) =>
                                                handleVendorInfoChange(
                                                  entry.id,
                                                  "information",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="secondary dhcp-page__list-remove"
                                          onClick={() =>
                                            handleRemoveVendorInfo(entry.id)
                                          }
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleAddVendorInfo}
                                    >
                                      Add vendor entry
                                    </button>
                                  </div>

                                  <div className="dhcp-page__list-section">
                                    <header>
                                      <h4>Generic DHCP options</h4>
                                      <p>
                                        Specify additional DHCP options by code.
                                      </p>
                                    </header>
                                    {draftGenericOptions.length === 0 && (
                                      <p className="dhcp-page__list-empty">
                                        No generic options defined.
                                      </p>
                                    )}
                                    {draftGenericOptions.map((entry) => {
                                      const conversion =
                                        describeGenericOptionValue(entry);
                                      const codeId = `dhcp-generic-code-${entry.id}`;
                                      const valueId = `dhcp-generic-value-${entry.id}`;
                                      const asciiToggleDisabled =
                                        entry.mode !== "ascii" &&
                                        (conversion.status === "invalid" ||
                                          (conversion.status === "hex" &&
                                            !conversion.ascii));

                                      return (
                                        <div
                                          key={entry.id}
                                          className="dhcp-page__list-row"
                                        >
                                          <div className="dhcp-page__list-row-grid dhcp-page__list-row-grid--option">
                                            <div className="field-group">
                                              <label htmlFor={codeId}>
                                                Option code
                                              </label>
                                              <input
                                                id={codeId}
                                                name={`genericOptionCode-${entry.id}`}
                                                type="number"
                                                min="0"
                                                value={entry.code}
                                                onChange={(event) =>
                                                  handleGenericOptionChange(
                                                    entry.id,
                                                    "code",
                                                    event.target.value,
                                                  )
                                                }
                                              />
                                            </div>
                                            <div className="field-group">
                                              <div className="dhcp-page__value-header">
                                                <label htmlFor={valueId}>
                                                  Value
                                                </label>
                                                <div className="dhcp-page__value-mode">
                                                  <span>Format</span>
                                                  <div className="dhcp-page__value-mode-buttons">
                                                    <button
                                                      type="button"
                                                      className={
                                                        entry.mode === "ascii" ?
                                                          "active"
                                                        : ""
                                                      }
                                                      onClick={() =>
                                                        handleGenericOptionModeChange(
                                                          entry.id,
                                                          "ascii",
                                                        )
                                                      }
                                                      disabled={
                                                        asciiToggleDisabled
                                                      }
                                                    >
                                                      ASCII
                                                    </button>
                                                    <button
                                                      type="button"
                                                      className={
                                                        entry.mode === "hex" ?
                                                          "active"
                                                        : ""
                                                      }
                                                      onClick={() =>
                                                        handleGenericOptionModeChange(
                                                          entry.id,
                                                          "hex",
                                                        )
                                                      }
                                                    >
                                                      HEX
                                                    </button>
                                                  </div>
                                                </div>
                                              </div>
                                              <textarea
                                                id={valueId}
                                                value={entry.value}
                                                onChange={(event) =>
                                                  handleGenericOptionChange(
                                                    entry.id,
                                                    "value",
                                                    event.target.value,
                                                  )
                                                }
                                                placeholder={
                                                  entry.mode === "ascii" ?
                                                    "ASCII text (e.g., Example)"
                                                  : "Hex bytes (e.g., 45:78:61:6D:70:6C:65)"
                                                }
                                                spellCheck={
                                                  entry.mode === "ascii"
                                                }
                                                rows={
                                                  entry.mode === "ascii" ? 2 : 3
                                                }
                                                className="dhcp-page__textarea"
                                              />
                                              {conversion.status ===
                                                "ascii" && (
                                                <p className="dhcp-page__conversion">
                                                  <strong>HEX:</strong>{" "}
                                                  {conversion.hex}
                                                </p>
                                              )}
                                              {conversion.status === "hex" && (
                                                <p className="dhcp-page__conversion">
                                                  <strong>
                                                    Normalized HEX:
                                                  </strong>{" "}
                                                  {conversion.hex}
                                                  {conversion.ascii && (
                                                    <>
                                                      <br />
                                                      <strong>
                                                        ASCII:
                                                      </strong>{" "}
                                                      {conversion.ascii}
                                                    </>
                                                  )}
                                                  {conversion.hasNonPrintable && (
                                                    <>
                                                      <br />
                                                      <em>
                                                        Contains non-printable
                                                        characters
                                                      </em>
                                                    </>
                                                  )}
                                                </p>
                                              )}
                                              {conversion.status ===
                                                "invalid" && (
                                                <p className="dhcp-page__conversion dhcp-page__conversion--error">
                                                  Enter HEX bytes like 01:02:FF
                                                  or switch to ASCII input.
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            className="secondary dhcp-page__list-remove"
                                            onClick={() =>
                                              handleRemoveGenericOption(
                                                entry.id,
                                              )
                                            }
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      );
                                    })}
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleAddGenericOption}
                                    >
                                      Add option
                                    </button>
                                  </div>
                                </details>

                                <details className="dhcp-page__advanced">
                                  <summary>
                                    Exclusions &amp; reservations
                                  </summary>
                                  <div className="dhcp-page__list-section">
                                    <header>
                                      <h4>Exclusion ranges</h4>
                                      <p>
                                        Reserve blocks of addresses that should
                                        not be handed out.
                                      </p>
                                    </header>
                                    {draftExclusions.length === 0 && (
                                      <p className="dhcp-page__list-empty">
                                        No exclusion ranges defined.
                                      </p>
                                    )}
                                    {draftExclusions.map((entry) => (
                                      <div
                                        key={entry.id}
                                        className="dhcp-page__list-row"
                                      >
                                        <div className="dhcp-page__list-row-grid">
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-exclusion-start-${entry.id}`}
                                            >
                                              Start address
                                            </label>
                                            <input
                                              id={`dhcp-exclusion-start-${entry.id}`}
                                              name={`exclusionStartAddress-${entry.id}`}
                                              type="text"
                                              value={entry.startingAddress}
                                              onChange={(event) =>
                                                handleExclusionChange(
                                                  entry.id,
                                                  "startingAddress",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-exclusion-end-${entry.id}`}
                                            >
                                              End address
                                            </label>
                                            <input
                                              id={`dhcp-exclusion-end-${entry.id}`}
                                              name={`exclusionEndAddress-${entry.id}`}
                                              type="text"
                                              value={entry.endingAddress}
                                              onChange={(event) =>
                                                handleExclusionChange(
                                                  entry.id,
                                                  "endingAddress",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="secondary dhcp-page__list-remove"
                                          onClick={() =>
                                            handleRemoveExclusion(entry.id)
                                          }
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleAddExclusion}
                                    >
                                      Add exclusion
                                    </button>
                                  </div>

                                  <div className="dhcp-page__list-section">
                                    <header>
                                      <h4>Reserved leases</h4>
                                      <p>
                                        Pin specific MAC addresses to fixed IP
                                        assignments.
                                      </p>
                                    </header>
                                    {draftReservedLeases.length === 0 && (
                                      <p className="dhcp-page__list-empty">
                                        No reserved leases defined.
                                      </p>
                                    )}
                                    {draftReservedLeases.map((entry) => (
                                      <div
                                        key={entry.id}
                                        className="dhcp-page__list-row"
                                      >
                                        <div className="dhcp-page__list-row-grid dhcp-page__list-row-grid--wide">
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-reserved-host-${entry.id}`}
                                            >
                                              Hostname
                                            </label>
                                            <input
                                              id={`dhcp-reserved-host-${entry.id}`}
                                              name={`reservedHostName-${entry.id}`}
                                              type="text"
                                              value={entry.hostName}
                                              placeholder="Optional"
                                              onChange={(event) =>
                                                handleReservedLeaseChange(
                                                  entry.id,
                                                  "hostName",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-reserved-mac-${entry.id}`}
                                            >
                                              Hardware address
                                            </label>
                                            <input
                                              id={`dhcp-reserved-mac-${entry.id}`}
                                              name={`reservedHardwareAddress-${entry.id}`}
                                              type="text"
                                              value={entry.hardwareAddress}
                                              onChange={(event) =>
                                                handleReservedLeaseChange(
                                                  entry.id,
                                                  "hardwareAddress",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-reserved-ip-${entry.id}`}
                                            >
                                              IP address
                                            </label>
                                            <input
                                              id={`dhcp-reserved-ip-${entry.id}`}
                                              name={`reservedIpAddress-${entry.id}`}
                                              type="text"
                                              value={entry.address}
                                              onChange={(event) =>
                                                handleReservedLeaseChange(
                                                  entry.id,
                                                  "address",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                        </div>
                                        <div className="dhcp-page__list-row-grid dhcp-page__list-row-grid--wide">
                                          <div className="field-group">
                                            <label
                                              htmlFor={`dhcp-reserved-comment-${entry.id}`}
                                            >
                                              Comment
                                            </label>
                                            <textarea
                                              id={`dhcp-reserved-comment-${entry.id}`}
                                              name={`reservedComment-${entry.id}`}
                                              value={entry.comments}
                                              placeholder="Optional"
                                              onChange={(event) =>
                                                handleReservedLeaseChange(
                                                  entry.id,
                                                  "comments",
                                                  event.target.value,
                                                )
                                              }
                                            />
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          className="secondary dhcp-page__list-remove"
                                          onClick={() =>
                                            handleRemoveReservedLease(entry.id)
                                          }
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      className="secondary"
                                      onClick={handleAddReservedLease}
                                    >
                                      Add reserved lease
                                    </button>
                                  </div>

                                  <div className="dhcp-page__advanced-grid dhcp-page__advanced-grid--toggles">
                                    <div className="field-group field-group--inline">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-block-locally-admin"
                                      >
                                        <input
                                          id="dhcp-block-locally-admin"
                                          name="blockLocallyAdministered"
                                          type="checkbox"
                                          checked={
                                            draftBlockLocallyAdministered
                                          }
                                          onChange={(event) =>
                                            setDraftBlockLocallyAdministered(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>
                                          Block locally administered MAC
                                          addresses
                                        </span>
                                      </label>
                                    </div>
                                    <div className="field-group field-group--inline">
                                      <label
                                        className="checkbox"
                                        htmlFor="dhcp-ignore-client-id"
                                      >
                                        <input
                                          id="dhcp-ignore-client-id"
                                          name="ignoreClientId"
                                          type="checkbox"
                                          checked={draftIgnoreClientIdentifier}
                                          onChange={(event) =>
                                            setDraftIgnoreClientIdentifier(
                                              event.target.checked,
                                            )
                                          }
                                        />
                                        <span>
                                          Ignore client identifier option
                                        </span>
                                      </label>
                                    </div>
                                  </div>
                                </details>

                                <div className="dhcp-page__clone-actions">
                                  <button
                                    type="submit"
                                    className="primary"
                                    disabled={cloneSubmitDisabled}
                                  >
                                    {cloneState === "loading" ?
                                      "Cloning…"
                                    : isLocalClone ?
                                      "Clone locally"
                                    : "Clone to node"}
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={handleResetOverrides}
                                    disabled={
                                      cloneState === "loading" ||
                                      updateState === "loading"
                                    }
                                  >
                                    Reset fields
                                  </button>
                                </div>

                                {cloneState === "success" && cloneMessage && (
                                  <div
                                    className="dhcp-page__success"
                                    role="status"
                                  >
                                    {cloneMessage}
                                  </div>
                                )}

                                {cloneState === "error" && cloneError && (
                                  <div
                                    className="dhcp-page__error"
                                    role="alert"
                                  >
                                    {cloneError}
                                  </div>
                                )}
                              </fieldset>
                            </form>
                          )}
                        </div>
                      </>
                    )}
                </section>
              </div>
            </section>
          </>
        )}

        {/* Bulk Sync Tab */}
        {activePageTab === "bulk-sync" && (
          <section className="configuration__editors">
            <div className="configuration-editor">
              <div className="dhcp-bulk-sync-inline">
                <div className="dhcp-bulk-sync-inline__header">
                  <h2>Bulk Sync DHCP Scopes</h2>
                  <p>
                    Synchronize DHCP scopes across multiple nodes efficiently.
                    Configure your source node, target nodes, and sync strategy
                    below.
                  </p>
                </div>

                {nodes.length < 2 ?
                  <div className="dhcp-page__placeholder">
                    <p>
                      ⚠️ At least 2 nodes are required to perform bulk sync
                      operations.
                    </p>
                    <p
                      style={{
                        fontSize: "0.9rem",
                        marginTop: "0.5rem",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Configure additional nodes in your setup to enable this
                      feature.
                    </p>
                  </div>
                : <div className="dhcp-bulk-sync-inline__form">
                    {/* Source Node Selection */}
                    <div className="field-group">
                      <label className="field-group__label">Source Node</label>
                      <div className="field-group__hint">
                        DHCP scopes will be copied from this node
                      </div>
                      <div className="node-selector__cards">
                        {nodes.map((node) => {
                          const isSelected = node.id === bulkSyncSourceNodeId;
                          const scopeCount = scopeCountByNode.get(node.id) ?? 0;
                          return (
                            <button
                              key={node.id}
                              type="button"
                              className={`node-selector__card ${isSelected ? "node-selector__card--selected" : ""}`}
                              onClick={() =>
                                handleBulkSyncSourceChange(node.id)
                              }
                              disabled={bulkSyncInProgress}
                            >
                              <div className="node-selector__card-radio">
                                <input
                                  type="radio"
                                  name="bulk-sync-source-node"
                                  checked={isSelected}
                                  readOnly
                                  aria-label={`Select ${node.name || node.id} as source`}
                                  disabled={bulkSyncInProgress}
                                />
                              </div>
                              <div className="node-selector__card-content">
                                <div className="node-selector__card-header">
                                  <strong className="node-selector__card-title">
                                    {node.name || node.id}
                                  </strong>
                                </div>
                                <div className="node-selector__card-stats">
                                  {scopeCount} scope
                                  {scopeCount !== 1 ? "s" : ""}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Target Nodes Selection */}
                    <div className="field-group">
                      <label className="field-group__label">Target Nodes</label>
                      <div className="field-group__hint">
                        Select one or more nodes to sync to
                      </div>
                      {bulkSyncAvailableTargets.length === 0 ?
                        <div
                          className="field-group__hint field-group__hint--warning"
                          style={{ marginTop: "0.5rem" }}
                        >
                          No other nodes available for syncing
                        </div>
                      : <>
                          <div className="dhcp-bulk-sync-inline__target-actions">
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              onClick={handleBulkSyncSelectAllTargets}
                              disabled={bulkSyncInProgress}
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              onClick={handleBulkSyncDeselectAllTargets}
                              disabled={bulkSyncInProgress}
                            >
                              Deselect All
                            </button>
                          </div>
                          <div className="node-selector__cards">
                            {bulkSyncAvailableTargets.map((node) => {
                              const isSelected = bulkSyncTargetNodeIds.includes(
                                node.id,
                              );
                              const scopeCount =
                                scopeCountByNode.get(node.id) ?? 0;
                              return (
                                <button
                                  key={node.id}
                                  type="button"
                                  className={`node-selector__card ${isSelected ? "node-selector__card--selected" : ""}`}
                                  onClick={() =>
                                    handleBulkSyncTargetToggle(node.id)
                                  }
                                  disabled={bulkSyncInProgress}
                                >
                                  <div className="node-selector__card-checkbox">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      readOnly
                                      aria-label={`Select ${node.name || node.id} as target`}
                                      disabled={bulkSyncInProgress}
                                    />
                                  </div>
                                  <div className="node-selector__card-content">
                                    <div className="node-selector__card-header">
                                      <strong className="node-selector__card-title">
                                        {node.name || node.id}
                                      </strong>
                                    </div>
                                    <div className="node-selector__card-stats">
                                      {scopeCount} scope
                                      {scopeCount !== 1 ? "s" : ""}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </>
                      }
                    </div>

                    {/* Strategy Selection */}
                    <div className="field-group">
                      <label className="field-group__label">
                        Sync Strategy
                      </label>
                      <div className="dhcp-bulk-sync-modal__strategy-list">
                        <label className="dhcp-bulk-sync-modal__strategy-item">
                          <input
                            type="radio"
                            name="strategy"
                            value="skip-existing"
                            checked={bulkSyncStrategy === "skip-existing"}
                            onChange={(e) =>
                              setBulkSyncStrategy(
                                e.target.value as DhcpBulkSyncStrategy,
                              )
                            }
                            className="dhcp-bulk-sync-modal__radio"
                            disabled={bulkSyncInProgress}
                          />
                          <div className="dhcp-bulk-sync-modal__strategy-content">
                            <div className="dhcp-bulk-sync-modal__strategy-name">
                              Skip Existing{" "}
                              <span className="dhcp-bulk-sync-modal__strategy-badge">
                                Recommended
                              </span>
                            </div>
                            <div className="dhcp-bulk-sync-modal__strategy-description">
                              Only sync scopes that don't already exist on the
                              target nodes. Existing scopes are left unchanged.
                            </div>
                          </div>
                        </label>

                        <label className="dhcp-bulk-sync-modal__strategy-item">
                          <input
                            type="radio"
                            name="strategy"
                            value="overwrite-all"
                            checked={bulkSyncStrategy === "overwrite-all"}
                            onChange={(e) =>
                              setBulkSyncStrategy(
                                e.target.value as DhcpBulkSyncStrategy,
                              )
                            }
                            className="dhcp-bulk-sync-modal__radio"
                            disabled={bulkSyncInProgress}
                          />
                          <div className="dhcp-bulk-sync-modal__strategy-content">
                            <div className="dhcp-bulk-sync-modal__strategy-name">
                              Mirror{" "}
                              <span className="dhcp-bulk-sync-modal__strategy-badge dhcp-bulk-sync-modal__strategy-badge--warning">
                                Replaces targets
                              </span>
                            </div>
                            <div className="dhcp-bulk-sync-modal__strategy-description">
                              Replace target scopes to match the source exactly
                              and delete scopes not present on the source.
                            </div>
                          </div>
                        </label>

                        <label className="dhcp-bulk-sync-modal__strategy-item">
                          <input
                            type="radio"
                            name="strategy"
                            value="merge-missing"
                            checked={bulkSyncStrategy === "merge-missing"}
                            onChange={(e) =>
                              setBulkSyncStrategy(
                                e.target.value as DhcpBulkSyncStrategy,
                              )
                            }
                            className="dhcp-bulk-sync-modal__radio"
                            disabled={bulkSyncInProgress}
                          />
                          <div className="dhcp-bulk-sync-modal__strategy-content">
                            <div className="dhcp-bulk-sync-modal__strategy-name">
                              Sync All
                            </div>
                            <div className="dhcp-bulk-sync-modal__strategy-description">
                              Add missing scopes and update existing scopes to
                              align with source. Preserves any extra scopes on
                              targets.
                            </div>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* Additional Options */}
                    <div className="field-group">
                      <label className="dhcp-bulk-sync-modal__option-item">
                        <input
                          type="checkbox"
                          checked={bulkSyncEnableOnTarget}
                          onChange={(e) =>
                            setBulkSyncEnableOnTarget(e.target.checked)
                          }
                          className="dhcp-bulk-sync-modal__checkbox"
                          disabled={bulkSyncInProgress}
                        />
                        <div className="dhcp-bulk-sync-modal__option-content">
                          <div className="dhcp-bulk-sync-modal__option-name">
                            Enable scopes on target nodes
                          </div>
                          <div className="dhcp-bulk-sync-modal__option-description">
                            Enable synced scopes immediately on target nodes
                            (regardless of source state)
                          </div>
                        </div>
                      </label>
                    </div>

                    {/* Sync Preview */}
                    {bulkSyncTargetNodeIds.length > 0 && (
                      <div className="dhcp-bulk-sync-inline__preview">
                        <div className="dhcp-bulk-sync-inline__preview-header">
                          <strong>Sync Preview</strong>
                          <span className="dhcp-bulk-sync-inline__preview-subtitle">
                            Scopes to be copied from{" "}
                            {nodes.find((n) => n.id === bulkSyncSourceNodeId)
                              ?.name || bulkSyncSourceNodeId}{" "}
                            → {bulkSyncTargetNodeIds.length} target node
                            {bulkSyncTargetNodeIds.length !== 1 ? "s" : ""}
                          </span>
                        </div>

                        {bulkSyncSourceScopesLoading ?
                          <div className="dhcp-bulk-sync-inline__preview-loading">
                            <span>Loading scopes...</span>
                          </div>
                        : bulkSyncSourceScopes.length === 0 ?
                          <div className="dhcp-bulk-sync-inline__preview-empty">
                            <span>⚠️ No scopes found on source node</span>
                            <p>
                              Select a different source node that has DHCP
                              scopes configured.
                            </p>
                          </div>
                        : <div className="dhcp-bulk-sync-inline__preview-list">
                            {bulkSyncSourceScopes.map((scope) => {
                              const { exists, nodeIds } =
                                getScopeExistsOnTargets(scope.name);
                              const isExpanded = bulkSyncExpandedScopes.has(
                                scope.name,
                              );

                              // Determine which targets will receive vs skip
                              const targetsToSync =
                                bulkSyncTargetNodeIds.filter(
                                  (id) => !nodeIds.includes(id),
                                );
                              const targetsToSkip =
                                bulkSyncTargetNodeIds.filter((id) =>
                                  nodeIds.includes(id),
                                );
                              const sourceKey = `${bulkSyncSourceNodeId}:${scope.name}`;
                              const sourceDetails =
                                bulkSyncSourceScopeDetails.get(sourceKey);
                              const targetDetailsForScope = targetsToSkip.map(
                                (id) =>
                                  bulkSyncTargetScopeDetails.get(
                                    `${id}:${scope.name}`,
                                  ),
                              );
                              const hasLoadedAllTargetDetails =
                                targetDetailsForScope.length > 0 &&
                                targetDetailsForScope.every(Boolean);
                              const hasDiffsForTargets =
                                (
                                  bulkSyncStrategy === "merge-missing" &&
                                  exists &&
                                  sourceDetails &&
                                  hasLoadedAllTargetDetails
                                ) ?
                                  targetDetailsForScope.some(
                                    (targetDetails) =>
                                      computeScopeDiff(
                                        sourceDetails,
                                        targetDetails as TechnitiumDhcpScope,
                                      ).length > 0,
                                  )
                                : null;

                              // Only skip-existing actually skips - merge-missing updates existing scopes
                              const willBeSkipped =
                                bulkSyncStrategy === "skip-existing" &&
                                targetsToSync.length === 0;
                              const willBeOverwritten =
                                bulkSyncStrategy === "overwrite-all" && exists;
                              const willBeUpdated =
                                bulkSyncStrategy === "merge-missing" &&
                                exists &&
                                hasDiffsForTargets !== false;
                              const willMatchExisting =
                                bulkSyncStrategy === "merge-missing" &&
                                exists &&
                                hasDiffsForTargets === false;

                              return (
                                <div
                                  key={scope.name}
                                  className={`dhcp-bulk-sync-inline__preview-item ${willBeSkipped ? "dhcp-bulk-sync-inline__preview-item--skipped" : ""}`}
                                >
                                  <button
                                    type="button"
                                    className="dhcp-bulk-sync-inline__preview-item-button"
                                    onClick={() =>
                                      handleBulkSyncToggleScopeExpanded(
                                        scope.name,
                                      )
                                    }
                                    disabled={bulkSyncInProgress}
                                  >
                                    <div className="dhcp-bulk-sync-inline__preview-icon">
                                      {willBeSkipped ? "⊘" : "→"}
                                    </div>
                                    <div className="dhcp-bulk-sync-inline__preview-content">
                                      <div className="dhcp-bulk-sync-inline__preview-name">
                                        {scope.name}
                                        {isExpanded ? " ▼" : " ▶"}
                                      </div>
                                      <div className="dhcp-bulk-sync-inline__preview-details">
                                        {scope.startingAddress} -{" "}
                                        {scope.endingAddress}
                                        {bulkSyncEnableOnTarget ?
                                          <span className="dhcp-bulk-sync-inline__preview-badge dhcp-bulk-sync-inline__preview-badge--enabled">
                                            Will Enable
                                          </span>
                                        : <span className="dhcp-bulk-sync-inline__preview-badge dhcp-bulk-sync-inline__preview-badge--disabled">
                                            Will be Disabled
                                          </span>
                                        }
                                        {bulkSyncStrategy === "skip-existing" &&
                                          targetsToSkip.length > 0 &&
                                          targetsToSync.length > 0 && (
                                            <span className="dhcp-bulk-sync-inline__preview-badge dhcp-bulk-sync-inline__preview-badge--partial">
                                              Partial Sync
                                            </span>
                                          )}
                                        {willBeSkipped && (
                                          <span className="dhcp-bulk-sync-inline__preview-badge dhcp-bulk-sync-inline__preview-badge--skipped">
                                            All Targets Skipped
                                          </span>
                                        )}
                                        {willBeOverwritten && (
                                          <span className="dhcp-bulk-sync-inline__preview-badge dhcp-bulk-sync-inline__preview-badge--warning">
                                            Will Overwrite
                                          </span>
                                        )}
                                        {willBeUpdated && (
                                          <span className="dhcp-bulk-sync-inline__preview-badge dhcp-bulk-sync-inline__preview-badge--update">
                                            Will Update
                                          </span>
                                        )}
                                        {willMatchExisting && (
                                          <span className="dhcp-bulk-sync-inline__preview-badge dhcp-bulk-sync-inline__preview-badge--update">
                                            Matches Target
                                          </span>
                                        )}
                                      </div>
                                      {bulkSyncStrategy === "skip-existing" &&
                                        targetsToSkip.length > 0 && (
                                          <div className="dhcp-bulk-sync-inline__preview-note">
                                            {targetsToSync.length > 0 ?
                                              <>
                                                <div>
                                                  ✓ Will be added to:{" "}
                                                  {targetsToSync
                                                    .map(
                                                      (id) =>
                                                        nodes.find(
                                                          (n) => n.id === id,
                                                        )?.name || id,
                                                    )
                                                    .join(", ")}
                                                </div>
                                                <div>
                                                  ⊘ Already exists on:{" "}
                                                  {targetsToSkip
                                                    .map(
                                                      (id) =>
                                                        nodes.find(
                                                          (n) => n.id === id,
                                                        )?.name || id,
                                                    )
                                                    .join(", ")}
                                                </div>
                                              </>
                                            : <>
                                                Already exists on all targets:{" "}
                                                {targetsToSkip
                                                  .map(
                                                    (id) =>
                                                      nodes.find(
                                                        (n) => n.id === id,
                                                      )?.name || id,
                                                  )
                                                  .join(", ")}
                                              </>
                                            }
                                          </div>
                                        )}
                                      {bulkSyncStrategy === "merge-missing" && (
                                        <div className="dhcp-bulk-sync-inline__preview-note">
                                          {(
                                            targetsToSync.length > 0 &&
                                            targetsToSkip.length > 0
                                          ) ?
                                            <>
                                              <div>
                                                + Will be added to:{" "}
                                                {targetsToSync
                                                  .map(
                                                    (id) =>
                                                      nodes.find(
                                                        (n) => n.id === id,
                                                      )?.name || id,
                                                  )
                                                  .join(", ")}
                                              </div>
                                              <div>
                                                ↻ Will be updated on:{" "}
                                                {targetsToSkip
                                                  .map(
                                                    (id) =>
                                                      nodes.find(
                                                        (n) => n.id === id,
                                                      )?.name || id,
                                                  )
                                                  .join(", ")}
                                              </div>
                                            </>
                                          : targetsToSkip.length > 0 ?
                                            <>
                                              ↻ Will be updated on:{" "}
                                              {targetsToSkip
                                                .map(
                                                  (id) =>
                                                    nodes.find(
                                                      (n) => n.id === id,
                                                    )?.name || id,
                                                )
                                                .join(", ")}
                                            </>
                                          : <>
                                              + Will be added to:{" "}
                                              {targetsToSync
                                                .map(
                                                  (id) =>
                                                    nodes.find(
                                                      (n) => n.id === id,
                                                    )?.name || id,
                                                )
                                                .join(", ")}
                                            </>
                                          }
                                        </div>
                                      )}
                                      {bulkSyncStrategy === "overwrite-all" &&
                                        nodeIds.length > 0 && (
                                          <div className="dhcp-bulk-sync-inline__preview-note">
                                            Will overwrite existing scope on:{" "}
                                            {nodeIds
                                              .map(
                                                (id) =>
                                                  nodes.find((n) => n.id === id)
                                                    ?.name || id,
                                              )
                                              .join(", ")}
                                          </div>
                                        )}
                                    </div>
                                  </button>

                                  {isExpanded && (
                                    <div className="dhcp-bulk-sync-inline__preview-expanded">
                                      {/* Loading state */}
                                      {bulkSyncScopeDetailsLoading.has(
                                        scope.name,
                                      ) && (
                                        <div className="dhcp-bulk-sync-inline__preview-expanded-loading">
                                          <span className="spinner">⏳</span>{" "}
                                          Loading scope details...
                                        </div>
                                      )}

                                      {/* Source scope details */}
                                      {!bulkSyncScopeDetailsLoading.has(
                                        scope.name,
                                      ) &&
                                        (() => {
                                          const sourceKey = `${bulkSyncSourceNodeId}:${scope.name}`;
                                          const sourceDetails =
                                            bulkSyncSourceScopeDetails.get(
                                              sourceKey,
                                            );

                                          return (
                                            <>
                                              <div className="dhcp-bulk-sync-inline__preview-expanded-section">
                                                <strong>
                                                  Source Configuration (
                                                  {
                                                    nodes.find(
                                                      (n) =>
                                                        n.id ===
                                                        bulkSyncSourceNodeId,
                                                    )?.name
                                                  }
                                                  ):
                                                </strong>
                                                <div className="dhcp-bulk-sync-inline__preview-expanded-grid">
                                                  <div>
                                                    <span className="label">
                                                      IP Range:
                                                    </span>{" "}
                                                    {scope.startingAddress} -{" "}
                                                    {scope.endingAddress}
                                                  </div>
                                                  <div>
                                                    <span className="label">
                                                      Subnet Mask:
                                                    </span>{" "}
                                                    {scope.subnetMask}
                                                  </div>
                                                  {sourceDetails?.dnsServers &&
                                                    sourceDetails.dnsServers
                                                      .length > 0 && (
                                                      <div>
                                                        <span className="label">
                                                          DNS Servers:
                                                        </span>{" "}
                                                        {sourceDetails.dnsServers.join(
                                                          ", ",
                                                        )}
                                                      </div>
                                                    )}
                                                  {sourceDetails?.domainSearchList &&
                                                    sourceDetails
                                                      .domainSearchList.length >
                                                      0 && (
                                                      <div>
                                                        <span className="label">
                                                          Domain Search:
                                                        </span>{" "}
                                                        {sourceDetails.domainSearchList.join(
                                                          ", ",
                                                        )}
                                                      </div>
                                                    )}
                                                </div>
                                              </div>

                                              {/* Per-target comparison */}
                                              {targetsToSkip.length > 0 &&
                                                (bulkSyncStrategy ===
                                                  "merge-missing" ||
                                                  bulkSyncStrategy ===
                                                    "overwrite-all") && (
                                                  <div className="dhcp-bulk-sync-inline__preview-expanded-section">
                                                    <strong>
                                                      Changes per Target:
                                                    </strong>
                                                    {targetsToSkip.map(
                                                      (targetNodeId) => {
                                                        const targetNode =
                                                          nodes.find(
                                                            (n) =>
                                                              n.id ===
                                                              targetNodeId,
                                                          );
                                                        const targetKey = `${targetNodeId}:${scope.name}`;
                                                        const targetDetails =
                                                          bulkSyncTargetScopeDetails.get(
                                                            targetKey,
                                                          );
                                                        const diffs =
                                                          computeScopeDiff(
                                                            sourceDetails,
                                                            targetDetails,
                                                          );

                                                        return (
                                                          <div
                                                            key={targetNodeId}
                                                            className="dhcp-bulk-sync-inline__preview-target-diff"
                                                          >
                                                            <div className="dhcp-bulk-sync-inline__preview-target-header">
                                                              {targetNode?.name ||
                                                                targetNodeId}
                                                              :
                                                            </div>
                                                            {!targetDetails ?
                                                              <div className="dhcp-bulk-sync-inline__preview-diff-loading">
                                                                Loading target
                                                                details...
                                                              </div>
                                                            : (
                                                              diffs.length === 0
                                                            ) ?
                                                              <div className="dhcp-bulk-sync-inline__preview-diff-none">
                                                                ✓ No changes
                                                                needed
                                                                (configurations
                                                                match)
                                                              </div>
                                                            : <ul className="dhcp-bulk-sync-inline__preview-diff-list">
                                                                {diffs.map(
                                                                  (
                                                                    diff,
                                                                    idx,
                                                                  ) => (
                                                                    <li
                                                                      key={idx}
                                                                      className={`dhcp-bulk-sync-inline__preview-diff-item dhcp-bulk-sync-inline__preview-diff-item--${diff.type}`}
                                                                    >
                                                                      {diff.type ===
                                                                        "modified" && (
                                                                        <>
                                                                          <span className="diff-icon">
                                                                            ✏️
                                                                          </span>
                                                                          <span className="diff-label">
                                                                            {
                                                                              diff.label
                                                                            }
                                                                            :
                                                                          </span>
                                                                          <span className="diff-value diff-old">
                                                                            {
                                                                              diff.targetValue
                                                                            }
                                                                          </span>
                                                                          <span className="diff-arrow">
                                                                            →
                                                                          </span>
                                                                          <span className="diff-value diff-new">
                                                                            {
                                                                              diff.sourceValue
                                                                            }
                                                                          </span>
                                                                        </>
                                                                      )}
                                                                      {diff.type ===
                                                                        "added" && (
                                                                        <>
                                                                          <span className="diff-icon">
                                                                            ➕
                                                                          </span>
                                                                          <span className="diff-label">
                                                                            {
                                                                              diff.label
                                                                            }
                                                                            :
                                                                          </span>
                                                                          <span className="diff-value diff-new">
                                                                            {
                                                                              diff.sourceValue
                                                                            }
                                                                          </span>
                                                                        </>
                                                                      )}
                                                                      {diff.type ===
                                                                        "removed" && (
                                                                        <>
                                                                          <span className="diff-icon">
                                                                            ➖
                                                                          </span>
                                                                          <span className="diff-label">
                                                                            {
                                                                              diff.label
                                                                            }
                                                                            :
                                                                          </span>
                                                                          <span className="diff-value diff-old">
                                                                            {
                                                                              diff.targetValue
                                                                            }
                                                                          </span>
                                                                          <span className="diff-note">
                                                                            (will
                                                                            be
                                                                            cleared)
                                                                          </span>
                                                                        </>
                                                                      )}
                                                                    </li>
                                                                  ),
                                                                )}
                                                              </ul>
                                                            }
                                                          </div>
                                                        );
                                                      },
                                                    )}
                                                  </div>
                                                )}

                                              {/* New scope targets */}
                                              {targetsToSync.length > 0 && (
                                                <div className="dhcp-bulk-sync-inline__preview-expanded-section">
                                                  <strong>
                                                    New Scope Targets:
                                                  </strong>
                                                  <div className="dhcp-bulk-sync-inline__preview-expanded-note">
                                                    <span className="success">
                                                      + Will be created on:{" "}
                                                      {targetsToSync
                                                        .map(
                                                          (id) =>
                                                            nodes.find(
                                                              (n) =>
                                                                n.id === id,
                                                            )?.name || id,
                                                        )
                                                        .join(", ")}
                                                    </span>
                                                  </div>
                                                </div>
                                              )}

                                              {/* Target State */}
                                              <div className="dhcp-bulk-sync-inline__preview-expanded-section">
                                                <strong>Target State:</strong>
                                                <div className="dhcp-bulk-sync-inline__preview-expanded-note">
                                                  {bulkSyncEnableOnTarget ?
                                                    <span className="success">
                                                      ✓ Scope will be{" "}
                                                      <strong>enabled</strong>{" "}
                                                      on target nodes
                                                      <div
                                                        style={{
                                                          fontSize: "0.85em",
                                                          marginTop: "0.25rem",
                                                          fontWeight: "normal",
                                                        }}
                                                      >
                                                        ("Enable scopes on
                                                        target nodes" checkbox
                                                        is selected)
                                                      </div>
                                                    </span>
                                                  : <span className="muted">
                                                      ⚠ Scope will be{" "}
                                                      <strong>disabled</strong>{" "}
                                                      on target nodes
                                                      <div
                                                        style={{
                                                          fontSize: "0.85em",
                                                          marginTop: "0.25rem",
                                                          fontWeight: "normal",
                                                        }}
                                                      >
                                                        (Safe default - check
                                                        "Enable scopes on target
                                                        nodes" to enable)
                                                      </div>
                                                    </span>
                                                  }
                                                </div>
                                              </div>
                                            </>
                                          );
                                        })()}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            <div className="dhcp-bulk-sync-inline__preview-summary">
                              {(() => {
                                if (bulkSyncStrategy === "merge-missing") {
                                  //  Sync All: all scopes will be synced (add new + update existing)
                                  const willAdd = bulkSyncSourceScopes.filter(
                                    (scope) => {
                                      const { exists } =
                                        getScopeExistsOnTargets(scope.name);
                                      return !exists;
                                    },
                                  ).length;
                                  const willUpdate =
                                    bulkSyncSourceScopes.length - willAdd;

                                  return (
                                    <>
                                      <strong>
                                        {bulkSyncSourceScopes.length}
                                      </strong>{" "}
                                      scope
                                      {bulkSyncSourceScopes.length !== 1 ?
                                        "s"
                                      : ""}{" "}
                                      will be synced to{" "}
                                      <strong>
                                        {bulkSyncTargetNodeIds.length}
                                      </strong>{" "}
                                      target node
                                      {bulkSyncTargetNodeIds.length !== 1 ?
                                        "s"
                                      : ""}
                                      {willUpdate > 0 && willAdd > 0 && (
                                        <span className="sync-note">
                                          {" "}
                                          ({willAdd} new, {willUpdate} updated)
                                        </span>
                                      )}
                                      {willUpdate > 0 && willAdd === 0 && (
                                        <span className="sync-note">
                                          {" "}
                                          ({willUpdate} will be updated)
                                        </span>
                                      )}
                                      {willAdd > 0 && willUpdate === 0 && (
                                        <span className="sync-note">
                                          {" "}
                                          ({willAdd} will be added)
                                        </span>
                                      )}
                                    </>
                                  );
                                } else {
                                  // skip-existing or overwrite-all
                                  const willSync = bulkSyncSourceScopes.filter(
                                    (scope) => {
                                      const { exists } =
                                        getScopeExistsOnTargets(scope.name);
                                      return (
                                        bulkSyncStrategy === "overwrite-all" ||
                                        !exists
                                      );
                                    },
                                  ).length;
                                  const willSkip =
                                    bulkSyncSourceScopes.length - willSync;

                                  return (
                                    <>
                                      <strong>{willSync}</strong> scope
                                      {willSync !== 1 ? "s" : ""} will be copied
                                      to{" "}
                                      <strong>
                                        {bulkSyncTargetNodeIds.length}
                                      </strong>{" "}
                                      target node
                                      {bulkSyncTargetNodeIds.length !== 1 ?
                                        "s"
                                      : ""}
                                      {willSkip > 0 && (
                                        <span className="skip-note">
                                          {" "}
                                          ({willSkip} will be skipped - already
                                          exist on target)
                                        </span>
                                      )}
                                    </>
                                  );
                                }
                              })()}
                            </div>
                          </div>
                        }
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="dhcp-bulk-sync-inline__actions">
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={handleBulkSyncStart}
                        disabled={
                          !bulkSyncCanStart || bulkSyncSourceScopes.length === 0
                        }
                        title={
                          !bulkSyncCanStart ? "Select at least one target node"
                          : bulkSyncSourceScopes.length === 0 ?
                            "Source node has no scopes to sync"
                          : "Start bulk sync operation"
                        }
                      >
                        {bulkSyncInProgress ? "Syncing..." : "Start Sync"}
                      </button>
                    </div>

                    {bulkSyncInProgress && (
                      <div className="dhcp-bulk-sync-inline__status">
                        <div className="dhcp-bulk-sync-inline__status-spinner">
                          ⏳
                        </div>
                        <div>
                          <p>
                            <strong>Sync in progress...</strong>
                          </p>
                          <p
                            style={{
                              fontSize: "0.9rem",
                              color: "var(--color-text-secondary)",
                            }}
                          >
                            Copying scopes from{" "}
                            {
                              nodes.find((n) => n.id === bulkSyncSourceNodeId)
                                ?.name
                            }{" "}
                            to {bulkSyncTargetNodeIds.length} target node
                            {bulkSyncTargetNodeIds.length !== 1 ? "s" : ""}.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                }
              </div>
            </div>
          </section>
        )}

        <DhcpSnapshotDrawer
          isOpen={showSnapshotDrawer}
          nodeId={selectedNodeId}
          nodeName={selectedNode?.name || selectedNode?.id}
          nodeScopeCount={scopeCountByNode.get(selectedNodeId)}
          onClose={() => setShowSnapshotDrawer(false)}
          listSnapshots={listDhcpSnapshots}
          createSnapshot={createDhcpSnapshot}
          restoreSnapshot={restoreDhcpSnapshot}
          setSnapshotPinned={setDhcpSnapshotPinned}
          getSnapshotDetail={getDhcpSnapshot}
          deleteSnapshot={deleteDhcpSnapshot}
          updateSnapshotNote={updateDhcpSnapshotNote}
          onRestoreSuccess={handleSnapshotRestoreSuccess}
        />

        {/* Bulk Sync Modal */}
        <DhcpBulkSyncModal
          isOpen={showBulkSyncModal}
          availableNodes={nodes.map((node) => ({
            id: node.id,
            name: node.name,
          }))}
          onConfirm={handleBulkSyncConfirm}
          onCancel={handleBulkSyncCancel}
        />

        {/* Bulk Sync Results Modal */}
        <DhcpBulkSyncResultsModal
          isOpen={showBulkSyncResults}
          result={bulkSyncResult}
          onClose={handleBulkSyncResultsClose}
          onRetry={handleBulkSyncRetry}
        />

        {/* Confirmation Modal */}
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          onConfirm={confirmModal.onConfirm}
          onCancel={closeConfirmModal}
          title={confirmModal.title}
          message={confirmModal.message}
          variant={confirmModal.variant}
          confirmLabel={confirmModal.confirmLabel}
        />
      </section>
    </>
  );
}

export default DhcpPage;
