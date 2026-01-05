import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBan,
  faCheck,
  faChevronUp,
  faCircle,
  faCode,
  faExclamationTriangle,
  faGripVertical,
  faInfoCircle,
  faList,
  faMinus,
  faPencil,
  faPlus,
  faSearch,
  faSquareCheck,
  faSquareMinus,
  faTrash,
  faUsers,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClusterInfoBanner } from "../components/common/ClusterInfoBanner.tsx";
import { ConfirmModal } from "../components/common/ConfirmModal";
import { PullToRefreshIndicator } from "../components/common/PullToRefreshIndicator";
import { AdvancedBlockingEditor } from "../components/configuration/AdvancedBlockingEditor.tsx";
import { AdvancedBlockingSetupGuide } from "../components/configuration/AdvancedBlockingSetupGuide.tsx";
import { BlockingConflictBanner } from "../components/configuration/BlockingConflictBanner.tsx";
import { BlockingMethodSelector } from "../components/configuration/BlockingMethodSelector.tsx";
import { BuiltInBlockingEditor } from "../components/configuration/BuiltInBlockingEditor.tsx";
import { ConfigurationSkeleton } from "../components/configuration/ConfigurationSkeleton.tsx";
import { ConfigurationSyncView } from "../components/configuration/ConfigurationSyncView.tsx";
import { ListSourceEditor } from "../components/configuration/ListSourceEditor.tsx";
import { NodeSelector } from "../components/configuration/NodeSelector.tsx";
import { apiFetch } from "../config";
import { useTechnitiumState } from "../context/TechnitiumContext";
import { useNavigationBlocker } from "../hooks/useNavigationBlocker";
import { useClusterNodes } from "../hooks/usePrimaryNode";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import type { AdvancedBlockingConfig } from "../types/advancedBlocking";
import {
  compareStringArrays,
  compareUrlArrays,
} from "../utils/arrayComparison";
import "./ConfigurationPage.css";

type TabMode =
  | "domain-management"
  | "group-management"
  | "list-management"
  | "sync";

interface DomainMatchApiEntry {
  groupName?: string;
  groups?: string[];
}

interface ManualDomainMatchDetail {
  type: "manual-blocked" | "manual-allowed";
  source: "manual";
  groupName: string;
}

type DomainEntrySortMode = "alpha" | "source";

export function ConfigurationPage() {
  const {
    nodes,
    advancedBlocking,
    loadingAdvancedBlocking,
    advancedBlockingError,
    builtInBlocking,
    loadingBuiltInBlocking,
    reloadAdvancedBlocking,
    reloadBuiltInBlocking,
    saveAdvancedBlockingConfig,
    blockingStatus,
    selectedBlockingMethod,
    reloadBlockingStatus,
    setSelectedBlockingMethod,
  } = useTechnitiumState();

  // Cluster information
  const { primary, isClusterEnabled } = useClusterNodes(nodes);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabMode>("domain-management");

  // Track unsaved changes per tab
  const [hasUnsavedGroupChanges, setHasUnsavedGroupChanges] = useState(false);
  const [hasUnsavedListSourcesChanges, setHasUnsavedListSourcesChanges] =
    useState(false);
  const [hasUnsavedDomainChanges, setHasUnsavedDomainChanges] = useState(false);

  // Combined unsaved changes check
  const hasAnyUnsavedChanges =
    hasUnsavedGroupChanges ||
    hasUnsavedListSourcesChanges ||
    hasUnsavedDomainChanges;

  // Track sync summary for badge display
  const [syncChangeCount, setSyncChangeCount] = useState(0);

  // Node selection for multi-group editor
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");

  const advancedNodes = useMemo(
    () => advancedBlocking?.nodes ?? [],
    [advancedBlocking],
  );
  const builtInNodes = useMemo(
    () => builtInBlocking?.nodes ?? [],
    [builtInBlocking],
  );
  const availableNodes = advancedNodes;
  const selectedNodeConfig = advancedNodes.find(
    (n) => n.nodeId === selectedNodeId,
  )?.config;
  const selectedBuiltInSnapshot = builtInNodes.find(
    (n) => n.nodeId === selectedNodeId,
  );
  const [builtInCountsOverride, setBuiltInCountsOverride] = useState<{
    allowed: number;
    blocked: number;
  } | null>(null);

  const handleBuiltInCountsChange = useCallback(
    (counts: { allowed: number; blocked: number }) => {
      setBuiltInCountsOverride(counts);
    },
    [],
  );

  // Domain Management tab: drag & drop state
  const [searchInput, setSearchInput] = useState("");
  const [searchedDomain, setSearchedDomain] = useState<string | null>(null);
  const [domainExists, setDomainExists] = useState(false);
  const [domainInGroups, setDomainInGroups] = useState<string[]>([]);
  const [domainMatchDetails, setDomainMatchDetails] = useState<
    Array<{
      type: string;
      source?: string;
      groupName?: string;
      groups?: string[];
      matchedDomain?: string;
      matchedPattern?: string;
    }>
  >([]); // Full match details including matchedDomain/matchedPattern
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [groups, setGroups] = useState<string[]>([]);
  const [activeDomainType, setActiveDomainType] = useState<
    "blocked" | "allowed" | "blockedRegex" | "allowedRegex"
  >("blocked");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Domain Management tab: Group entry sorting (display-only)
  const [domainEntrySortMode, setDomainEntrySortMode] =
    useState<DomainEntrySortMode>(() => {
      try {
        // Migrate from older key (dnsFilteringRegexSortMode) to the newer generic setting.
        const raw =
          localStorage.getItem("dnsFilteringDomainEntrySortMode") ??
          localStorage.getItem("dnsFilteringRegexSortMode");
        if (raw === "alpha" || raw === "source") return raw;
      } catch {
        // ignore
      }
      return "alpha";
    });

  useEffect(() => {
    try {
      localStorage.setItem(
        "dnsFilteringDomainEntrySortMode",
        domainEntrySortMode,
      );
      // Backwards-compatible write for older builds.
      localStorage.setItem("dnsFilteringRegexSortMode", domainEntrySortMode);
    } catch {
      // ignore
    }
  }, [domainEntrySortMode]);

  // Domain Management tab: Staged changes tracking
  const [testStagedConfig, setTestStagedConfig] =
    useState<AdvancedBlockingConfig | null>(null);
  const [testPendingChanges, setTestPendingChanges] = useState<
    Array<{
      type: "added" | "removed" | "modified";
      category: string;
      description: string;
    }>
  >([]);
  const [showTestChangesSummary, setShowTestChangesSummary] = useState(false);

  // Domain Management tab: Edit/Delete modals
  const [editingDomain, setEditingDomain] = useState<{
    domain: string;
    groups: string[];
  } | null>(null);
  const [editDomainInput, setEditDomainInput] = useState("");
  const [deletingDomain, setDeletingDomain] = useState<{
    domain: string;
    groups: string[];
  } | null>(null);

  // Domain Management tab: Custom layered icon
  const LayeredIcon: React.FC<{
    backgroundIcon: IconDefinition;
    foregroundIcon: IconDefinition;
    bgColor: string;
    fgColor: string;
    bgFontSize?: string;
    fgFontSize?: string;
  }> = ({
    backgroundIcon,
    foregroundIcon,
    bgColor,
    fgColor,
    bgFontSize,
    fgFontSize,
  }) => (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <FontAwesomeIcon
        icon={backgroundIcon}
        style={{ color: bgColor, fontSize: bgFontSize }}
      />
      <FontAwesomeIcon
        icon={foregroundIcon}
        style={{ position: "absolute", color: fgColor, fontSize: fgFontSize }}
      />
    </div>
  );

  // Dragging state - track what's being dragged
  const [draggedDomain, setDraggedDomain] = useState<string | null>(null);
  const [dragSourceGroup, setDragSourceGroup] = useState<string | null>(null);

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

  // Auto-select Primary node if clustering is enabled
  useEffect(() => {
    if (isClusterEnabled && primary && !selectedNodeId) {
      setSelectedNodeId(primary.id);
    }
  }, [isClusterEnabled, primary, selectedNodeId]);

  // Load blocking status on mount to detect conflicts
  useEffect(() => {
    reloadBlockingStatus();
  }, [reloadBlockingStatus]);

  // Pull-to-refresh functionality
  const handlePullToRefresh = useCallback(async () => {
    await Promise.all([reloadAdvancedBlocking(), reloadBlockingStatus()]);
  }, [reloadAdvancedBlocking, reloadBlockingStatus]);

  const pullToRefresh = usePullToRefresh({
    onRefresh: handlePullToRefresh,
    threshold: 80,
    disabled: false,
  });

  // Auto-switch away from Sync tab if clustering is enabled
  useEffect(() => {
    if (isClusterEnabled && activeTab === "sync") {
      setActiveTab("group-management");
    }
  }, [isClusterEnabled, activeTab]);

  // Auto-load Advanced Blocking data on mount
  useEffect(() => {
    reloadAdvancedBlocking();
  }, [reloadAdvancedBlocking]);

  // Load built-in blocking data whenever the method switches to built-in
  useEffect(() => {
    if (selectedBlockingMethod === "built-in") {
      reloadBuiltInBlocking();
    }
  }, [reloadBuiltInBlocking, selectedBlockingMethod]);

  // Reload data when switching to Sync tab to ensure current state
  useEffect(() => {
    if (activeTab === "sync") {
      reloadAdvancedBlocking();
    }
  }, [activeTab, reloadAdvancedBlocking]);

  // Update selectedNodeId when advancedBlocking data loads OR when nodes change
  useEffect(() => {
    if (!selectedNodeId) {
      // If clustering is enabled, prefer Primary node
      if (isClusterEnabled && primary) {
        setSelectedNodeId(primary.id);
      } else if (advancedBlocking?.nodes?.length) {
        const firstNodeWithConfig = advancedBlocking.nodes.find(
          (n) => n.config,
        );
        const nodeId =
          firstNodeWithConfig?.nodeId ??
          advancedBlocking.nodes[0]?.nodeId ??
          "";
        setSelectedNodeId(nodeId);
      } else if (nodes.length > 0) {
        // Fallback to nodes list for built-in blocking mode
        setSelectedNodeId(nodes[0].id);
      }
    }
  }, [advancedBlocking, nodes, selectedNodeId, isClusterEnabled, primary]);

  // Reset built-in count overrides when switching nodes
  useEffect(() => {
    setBuiltInCountsOverride(null);
  }, [selectedNodeId]);

  useEffect(() => {
    const nodesForMethod =
      selectedBlockingMethod === "built-in" ? builtInNodes : availableNodes;
    if (nodesForMethod.length === 0) {
      return;
    }

    if (nodesForMethod.some((node) => node.nodeId === selectedNodeId)) {
      return;
    }

    if (isClusterEnabled && primary) {
      const primaryNodeAvailable = nodesForMethod.some(
        (node) => node.nodeId === primary.id,
      );
      if (primaryNodeAvailable) {
        setSelectedNodeId(primary.id);
        return;
      }
    }

    setSelectedNodeId(nodesForMethod[0].nodeId);
  }, [
    availableNodes,
    builtInNodes,
    selectedBlockingMethod,
    selectedNodeId,
    isClusterEnabled,
    primary,
  ]);

  // Determine which nodes are missing Advanced Blocking app
  const missingNodes = nodes
    .filter((n) => !n.hasAdvancedBlocking)
    .map((n) => ({ id: n.id, name: n.name }));
  const allMissing = nodes.length > 0 && missingNodes.length === nodes.length;
  const someMissing =
    missingNodes.length > 0 && missingNodes.length < nodes.length;

  // Calculate sync summary for badge (runs regardless of active tab)
  useEffect(() => {
    if (!advancedBlocking?.nodes || advancedBlocking.nodes.length < 2) {
      setSyncChangeCount(0);
      return;
    }

    // Use first two nodes with valid configs for comparison
    const nodesWithConfig = advancedBlocking.nodes.filter((n) => n.config);
    if (nodesWithConfig.length < 2) {
      setSyncChangeCount(0);
      return;
    }

    const [node1, node2] = nodesWithConfig;
    const groups1 = node1.config!.groups;
    const groups2 = node2.config!.groups;

    // Get all unique group names
    const allGroupNames = new Set([
      ...groups1.map((g) => g.name),
      ...groups2.map((g) => g.name),
    ]);

    let differentCount = 0;
    let onlyNode1Count = 0;
    let onlyNode2Count = 0;

    for (const groupName of allGroupNames) {
      const group1 = groups1.find((g) => g.name === groupName);
      const group2 = groups2.find((g) => g.name === groupName);

      if (!group1 && group2) {
        onlyNode2Count++;
      } else if (group1 && !group2) {
        onlyNode1Count++;
      } else if (group1 && group2) {
        // Compare domain lists (content, not just length)
        const isDifferentContent =
          !compareStringArrays(group1.blocked, group2.blocked) ||
          !compareStringArrays(group1.allowed, group2.allowed) ||
          !compareStringArrays(group1.blockedRegex, group2.blockedRegex) ||
          !compareStringArrays(group1.allowedRegex, group2.allowedRegex) ||
          !compareUrlArrays(group1.blockListUrls, group2.blockListUrls) ||
          !compareUrlArrays(group1.allowListUrls, group2.allowListUrls) ||
          !compareUrlArrays(
            group1.regexBlockListUrls,
            group2.regexBlockListUrls,
          ) ||
          !compareUrlArrays(
            group1.regexAllowListUrls,
            group2.regexAllowListUrls,
          ) ||
          !compareStringArrays(group1.adblockListUrls, group2.adblockListUrls);

        // Check if settings are different
        const compareSettingValues = (
          val1: unknown,
          val2: unknown,
        ): boolean => {
          if (Array.isArray(val1) && Array.isArray(val2)) {
            if (val1.length !== val2.length) return false;
            const sorted1 = [...val1].sort();
            const sorted2 = [...val2].sort();
            return sorted1.every((v, i) => v === sorted2[i]);
          }
          return val1 === val2;
        };

        const isDifferentSettings =
          !compareSettingValues(group1.enableBlocking, group2.enableBlocking) ||
          !compareSettingValues(
            group1.blockAsNxDomain,
            group2.blockAsNxDomain,
          ) ||
          !compareSettingValues(
            group1.allowTxtBlockingReport,
            group2.allowTxtBlockingReport,
          ) ||
          !compareSettingValues(
            group1.blockingAddresses,
            group2.blockingAddresses,
          );

        if (isDifferentContent || isDifferentSettings) {
          differentCount++;
        }
      }
    }

    // Check config-level differences (client mappings)
    let configDiffsCount = 0;

    // Compare enableBlocking
    if (node1.config!.enableBlocking !== node2.config!.enableBlocking) {
      configDiffsCount++;
    }

    // Compare blockingAnswerTtl
    if (node1.config!.blockingAnswerTtl !== node2.config!.blockingAnswerTtl) {
      configDiffsCount++;
    }

    // Compare blockListUrlUpdateIntervalHours
    if (
      node1.config!.blockListUrlUpdateIntervalHours !==
      node2.config!.blockListUrlUpdateIntervalHours
    ) {
      configDiffsCount++;
    }

    // Compare blockListUrlUpdateIntervalMinutes
    if (
      node1.config!.blockListUrlUpdateIntervalMinutes !==
      node2.config!.blockListUrlUpdateIntervalMinutes
    ) {
      configDiffsCount++;
    }

    // Compare localEndPointGroupMap
    const localMappings1 = node1.config!.localEndPointGroupMap || {};
    const localMappings2 = node2.config!.localEndPointGroupMap || {};
    const localKeys1 = Object.keys(localMappings1).sort();
    const localKeys2 = Object.keys(localMappings2).sort();

    if (
      localKeys1.length !== localKeys2.length ||
      !localKeys1.every(
        (key, i) =>
          key === localKeys2[i] && localMappings1[key] === localMappings2[key],
      )
    ) {
      configDiffsCount++;
    }

    // Compare networkGroupMap
    const networkMappings1 = node1.config!.networkGroupMap || {};
    const networkMappings2 = node2.config!.networkGroupMap || {};
    const networkKeys1 = Object.keys(networkMappings1).sort();
    const networkKeys2 = Object.keys(networkMappings2).sort();

    if (
      networkKeys1.length !== networkKeys2.length ||
      !networkKeys1.every(
        (key, i) =>
          key === networkKeys2[i] &&
          networkMappings1[key] === networkMappings2[key],
      )
    ) {
      configDiffsCount++;
    }

    setSyncChangeCount(
      differentCount + onlyNode1Count + onlyNode2Count + configDiffsCount,
    );
  }, [advancedBlocking]);

  // Warn user before leaving page if there are unsaved changes
  useNavigationBlocker(
    hasAnyUnsavedChanges,
    "You have unsaved changes in DNS Filtering. Are you sure you want to leave? Your changes will be lost.",
  );

  const handleSaveAdvancedBlocking = useCallback(
    async (nodeId: string, config: AdvancedBlockingConfig) => {
      await saveAdvancedBlockingConfig(nodeId, config);
    },
    [saveAdvancedBlockingConfig],
  );

  const handleSaveMultiGroupConfig = useCallback(
    async (config: AdvancedBlockingConfig) => {
      await saveAdvancedBlockingConfig(selectedNodeId, config);
      await reloadAdvancedBlocking();
    },
    [selectedNodeId, saveAdvancedBlockingConfig, reloadAdvancedBlocking],
  );

  const handleSyncConfig = useCallback(
    async (
      _sourceNodeId: string,
      targetNodeId: string,
      config: AdvancedBlockingConfig,
    ) => {
      await saveAdvancedBlockingConfig(targetNodeId, config);
      await reloadAdvancedBlocking();
    },
    [saveAdvancedBlockingConfig, reloadAdvancedBlocking],
  );

  // Initialize testStagedConfig when selectedNodeConfig changes
  useEffect(() => {
    if (selectedNodeConfig && activeTab === "domain-management") {
      setTestStagedConfig(JSON.parse(JSON.stringify(selectedNodeConfig)));
      setHasUnsavedDomainChanges(false);
      setTestPendingChanges([]);
    }
  }, [selectedNodeConfig, selectedNodeId, activeTab]);

  // Handle tab switching with unsaved changes warning
  const handleTabChange = useCallback(
    (newTab: TabMode) => {
      // Check for unsaved changes in the current tab
      let hasUnsaved = false;
      let tabName = "";

      if (activeTab === "group-management" && hasUnsavedGroupChanges) {
        hasUnsaved = true;
        tabName = "Group Management";
      } else if (
        activeTab === "list-management" &&
        hasUnsavedListSourcesChanges
      ) {
        hasUnsaved = true;
        tabName = "List Management";
      } else if (activeTab === "domain-management" && hasUnsavedDomainChanges) {
        hasUnsaved = true;
        tabName = "Domain Management";
      }

      if (hasUnsaved) {
        setConfirmModal({
          isOpen: true,
          title: "Unsaved Changes",
          message: `You have unsaved changes in ${tabName}. Are you sure you want to switch tabs? Your changes will be lost.`,
          variant: "warning",
          confirmLabel: "Discard Changes",
          onConfirm: () => {
            closeConfirmModal();
            // Clear the appropriate unsaved flag
            if (activeTab === "group-management")
              setHasUnsavedGroupChanges(false);
            if (activeTab === "list-management")
              setHasUnsavedListSourcesChanges(false);
            if (activeTab === "domain-management")
              setHasUnsavedDomainChanges(false);
            setActiveTab(newTab);
          },
        });
        return;
      }
      setActiveTab(newTab);
    },
    [
      hasUnsavedGroupChanges,
      hasUnsavedListSourcesChanges,
      hasUnsavedDomainChanges,
      activeTab,
      closeConfirmModal,
    ],
  );

  // Handle node selection with unsaved changes warning
  const handleNodeSelect = useCallback(
    (nodeId: string) => {
      if (hasAnyUnsavedChanges) {
        setConfirmModal({
          isOpen: true,
          title: "Unsaved Changes",
          message: `You have unsaved changes on ${selectedNodeId}. Are you sure you want to switch to ${nodeId}? Your changes will be lost.`,
          variant: "warning",
          confirmLabel: "Discard Changes",
          onConfirm: () => {
            closeConfirmModal();
            // Clear all unsaved flags
            setHasUnsavedGroupChanges(false);
            setHasUnsavedListSourcesChanges(false);
            setHasUnsavedDomainChanges(false);
            setSelectedNodeId(nodeId);
          },
        });
        return;
      }
      setSelectedNodeId(nodeId);
    },
    [hasAnyUnsavedChanges, selectedNodeId, closeConfirmModal],
  );

  // TEST tab: helper functions
  const extractDomainFromInput = useCallback((input: string): string => {
    const urlPattern = /^https?:\/\/([^/]+)/i;
    const match = input.match(urlPattern);
    if (match) return match[1];
    return input;
  }, []);

  const handleCheckDomain = useCallback(
    async (domainOverride?: string) => {
      const rawInput = domainOverride ?? searchInput.trim();
      if (!rawInput || !selectedNodeId) return;
      const domain = extractDomainFromInput(rawInput);
      setChecking(true);
      try {
        const response = await apiFetch(
          `/domain-lists/${selectedNodeId}/check?domain=${encodeURIComponent(domain)}`,
        );
        if (!response.ok) throw new Error("Failed to check domain");
        const data = await response.json();
        setSearchedDomain(domain);
        setDomainExists(data.found);
        if (data.found && data.foundIn) {
          // Store full details for display
          setDomainMatchDetails(data.foundIn);
          // Extract group names from both groupName (manual) and groups (URL-based lists)
          const allGroups: string[] = [];
          data.foundIn.forEach((item: DomainMatchApiEntry) => {
            if (item.groupName) {
              allGroups.push(item.groupName);
            }
            if (item.groups && Array.isArray(item.groups)) {
              allGroups.push(...item.groups);
            }
          });
          const uniqueGroups = [...new Set(allGroups)] as string[];
          setDomainInGroups(uniqueGroups);
        } else {
          setDomainInGroups([]);
          setDomainMatchDetails([]);
        }
      } catch (err) {
        console.error("Error checking domain:", err);
        setSearchedDomain(domain);
        setDomainExists(false);
        setDomainInGroups([]);
        setDomainMatchDetails([]);
      } finally {
        setChecking(false);
      }
    },
    [searchInput, selectedNodeId, extractDomainFromInput],
  );

  const handleDomainClick = useCallback(
    (domain: string) => {
      setSearchInput(domain);
      void handleCheckDomain(domain);
    },
    [handleCheckDomain],
  );

  // Helper function to highlight matching text
  const highlightMatch = (text: string, search: string) => {
    if (!search.trim()) return <>{text}</>;

    const parts = text.split(
      new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
    );
    return (
      <>
        {parts.map((part, i) =>
          part.toLowerCase() === search.toLowerCase() ?
            <mark
              key={i}
              style={{
                backgroundColor: "var(--color-warning-bg)",
                padding: "0",
                fontWeight: 600,
              }}
            >
              {part}
            </mark>
          : part,
        )}
      </>
    );
  };

  const handleDragStart = (e: React.DragEvent, domain: string) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", domain);
    setIsDragging(true);
    setDraggedDomain(domain);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setDragOverGroup(null);
    setDraggedDomain(null);
    setDragSourceGroup(null);
  };

  const handleRemoveFromGroup = useCallback(
    (domain: string, groupName: string) => {
      if (!testStagedConfig) return;

      const updatedConfig = { ...testStagedConfig };
      const group = updatedConfig.groups.find((g) => g.name === groupName);
      if (!group) return;

      // Determine which array to modify based on active domain type
      const arrayKey =
        activeDomainType === "blocked" ? "blocked"
        : activeDomainType === "allowed" ? "allowed"
        : activeDomainType === "blockedRegex" ? "blockedRegex"
        : "allowedRegex";

      // Remove domain from the group
      const currentArray = group[arrayKey] || [];
      const updatedArray = currentArray.filter((d) => d !== domain);
      group[arrayKey] = updatedArray;

      setTestStagedConfig(updatedConfig);
      setHasUnsavedDomainChanges(true);

      // Track the change
      setTestPendingChanges((prev) => [
        ...prev,
        {
          type: "removed",
          category: activeDomainType,
          domain,
          groups: [groupName],
          description: `Removed "${domain}" from "${groupName}"`,
        },
      ]);
    },
    [testStagedConfig, activeDomainType],
  );

  const handleDragOver = (e: React.DragEvent, groupName: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragOverGroup(groupName);
  };

  const handleDragLeave = () => {
    setDragOverGroup(null);
  };

  const handleDrop = async (
    e: React.DragEvent,
    groupName: string | "ALL_GROUPS",
    dropTarget: "header" | "list" | "other" = "other",
  ) => {
    e.preventDefault();
    const domain = e.dataTransfer.getData("text/plain");
    setDragOverGroup(null);
    setIsDragging(false);

    if (!domain || !testStagedConfig) return;

    // UX: dropping onto the same group header (red X) removes the entry.
    // Keep list drops no-op for same-group drags to avoid accidental removals.
    if (
      groupName !== "ALL_GROUPS" &&
      dropTarget === "header" &&
      dragSourceGroup === groupName
    ) {
      handleRemoveFromGroup(domain, groupName);
      return;
    }

    // Clone the staged config
    const updatedConfig = JSON.parse(
      JSON.stringify(testStagedConfig),
    ) as AdvancedBlockingConfig;

    // Determine which groups to add to
    const targetGroups =
      groupName === "ALL_GROUPS" ?
        (updatedConfig.groups || []).map((g) => g.name)
      : [groupName];

    // Track which groups actually get the domain added (excludes groups that already have it)
    const groupsModified: string[] = [];

    // Add domain to each target group
    targetGroups.forEach((targetGroup) => {
      const group = updatedConfig.groups?.find((g) => g.name === targetGroup);
      if (!group) return;

      // Get the appropriate array based on activeDomainType
      let targetArray: string[];
      switch (activeDomainType) {
        case "blocked":
          targetArray = group.blocked = group.blocked || [];
          break;
        case "allowed":
          targetArray = group.allowed = group.allowed || [];
          break;
        case "blockedRegex":
          targetArray = group.blockedRegex = group.blockedRegex || [];
          break;
        case "allowedRegex":
          targetArray = group.allowedRegex = group.allowedRegex || [];
          break;
      }

      // Add domain if not already present
      if (!targetArray.includes(domain)) {
        targetArray.push(domain);
        targetArray.sort();
        groupsModified.push(targetGroup);
      }
    });

    // Only update if at least one group was modified
    if (groupsModified.length > 0) {
      // Update staged config
      setTestStagedConfig(updatedConfig);
      setHasUnsavedDomainChanges(true);

      // Track the change
      const changeDesc =
        groupName === "ALL_GROUPS" ?
          `Added "${domain}" to ${groupsModified.length} group(s): ${groupsModified.join(", ")} (${activeDomainType})`
        : `Added "${domain}" to "${groupName}" (${activeDomainType})`;
      setTestPendingChanges((prev) => [
        ...prev,
        { type: "added", category: activeDomainType, description: changeDesc },
      ]);
    }

    // Clear search if it was a new domain
    if (domain === searchedDomain && !domainExists) {
      setSearchInput("");
      setSearchedDomain(null);
    }

    setDraggedDomain(null);
  };

  // Load groups when selectedNodeConfig changes
  useEffect(() => {
    if (selectedNodeConfig?.groups) {
      setGroups(selectedNodeConfig.groups.map((g) => g.name));
    }
  }, [selectedNodeConfig]);

  // Refresh domain match details when staged config changes (for domain-management tab live updates after drag-and-drop)
  // Only update if we have a searched domain AND the config was modified (not from fresh search)
  useEffect(() => {
    if (
      activeTab === "domain-management" &&
      searchedDomain &&
      testStagedConfig &&
      domainMatchDetails.length > 0
    ) {
      // Re-check the domain against the updated staged config to reflect drag-and-drop changes
      const config = testStagedConfig;
      const groups = config.groups || [];
      const foundIn: ManualDomainMatchDetail[] = [];

      // Check manual-blocked and manual-allowed entries
      groups.forEach((group) => {
        if (group.blocked?.includes(searchedDomain)) {
          foundIn.push({
            type: "manual-blocked",
            source: "manual",
            groupName: group.name,
          });
        }
        if (group.allowed?.includes(searchedDomain)) {
          foundIn.push({
            type: "manual-allowed",
            source: "manual",
            groupName: group.name,
          });
        }
      });

      // Only update if we found changes (added/removed domain from groups)
      if (foundIn.length > 0) {
        setDomainMatchDetails(foundIn);
        const allGroups = [...new Set(foundIn.map((item) => item.groupName))];
        setDomainInGroups(allGroups);
      }
    }
  }, [testStagedConfig, activeTab, searchedDomain, domainMatchDetails]);

  // Get all unique domains across all groups for the active domain type
  const allDomainsForType = useMemo(() => {
    // Use testStagedConfig on domain-management tab to show staged changes, otherwise use selectedNodeConfig
    const config =
      activeTab === "domain-management" && testStagedConfig ?
        testStagedConfig
      : selectedNodeConfig;
    if (!config?.groups) return [];

    const domainSet = new Set<string>();
    config.groups.forEach((group) => {
      let domains: string[] = [];
      switch (activeDomainType) {
        case "blocked":
          domains = group.blocked || [];
          break;
        case "allowed":
          domains = group.allowed || [];
          break;
        case "blockedRegex":
          domains = group.blockedRegex || [];
          break;
        case "allowedRegex":
          domains = group.allowedRegex || [];
          break;
      }
      domains.forEach((d) => domainSet.add(d));
    });

    const values = Array.from(domainSet);
    if (domainEntrySortMode !== "alpha") return values;
    return values.sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [
    selectedNodeConfig,
    testStagedConfig,
    activeDomainType,
    activeTab,
    domainEntrySortMode,
  ]);

  // Filter domains based on search input
  const filteredDomains = useMemo(() => {
    if (!searchInput.trim()) return allDomainsForType;

    const search = searchInput.toLowerCase();
    return allDomainsForType.filter((domain) =>
      domain.toLowerCase().includes(search),
    );
  }, [allDomainsForType, searchInput]);

  // Get which groups contain a specific domain for the active type
  const getGroupsForDomain = useCallback(
    (domain: string): string[] => {
      // Use testStagedConfig on domain-management tab to show staged changes, otherwise use selectedNodeConfig
      const config =
        activeTab === "domain-management" && testStagedConfig ?
          testStagedConfig
        : selectedNodeConfig;
      if (!config?.groups) return [];

      const groupNames: string[] = [];
      config.groups.forEach((group) => {
        let domains: string[] = [];
        switch (activeDomainType) {
          case "blocked":
            domains = group.blocked || [];
            break;
          case "allowed":
            domains = group.allowed || [];
            break;
          case "blockedRegex":
            domains = group.blockedRegex || [];
            break;
          case "allowedRegex":
            domains = group.allowedRegex || [];
            break;
        }
        if (domains.includes(domain)) {
          groupNames.push(group.name);
        }
      });

      return groupNames;
    },
    [selectedNodeConfig, testStagedConfig, activeDomainType, activeTab],
  );

  // Helper to toggle group expansion
  const toggleGroupExpansion = useCallback((groupName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  }, []);

  // Helper to get domains for a group based on active type
  const getDomainsForGroupByType = useCallback(
    (groupName: string): string[] => {
      // Use testStagedConfig on domain-management tab to show staged changes, otherwise use selectedNodeConfig
      const config =
        activeTab === "domain-management" && testStagedConfig ?
          testStagedConfig
        : selectedNodeConfig;
      const group = config?.groups.find((g) => g.name === groupName);
      if (!group) return [];

      const sortForDisplay = (values: string[]): string[] => {
        // Important: do NOT mutate underlying config arrays.
        // This is display-only sorting for readability.
        if (domainEntrySortMode !== "alpha") return values;
        return [...values].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" }),
        );
      };

      switch (activeDomainType) {
        case "blocked":
          return sortForDisplay(group.blocked || []);
        case "allowed":
          return sortForDisplay(group.allowed || []);
        case "blockedRegex":
          return sortForDisplay(group.blockedRegex || []);
        case "allowedRegex":
          return sortForDisplay(group.allowedRegex || []);
      }
    },
    [
      selectedNodeConfig,
      testStagedConfig,
      activeDomainType,
      activeTab,
      domainEntrySortMode,
    ],
  );

  // Domain Management tab: Save changes
  const handleTestSave = useCallback(async () => {
    if (!testStagedConfig || !selectedNodeId) return;

    try {
      await saveAdvancedBlockingConfig(selectedNodeId, testStagedConfig);
      await reloadAdvancedBlocking();
      setHasUnsavedDomainChanges(false);
      setTestPendingChanges([]);
    } catch (err) {
      console.error("Error saving domain management changes:", err);
      alert("Failed to save changes");
    }
  }, [
    testStagedConfig,
    selectedNodeId,
    saveAdvancedBlockingConfig,
    reloadAdvancedBlocking,
  ]);

  // Domain Management tab: Reset changes
  const handleTestReset = useCallback(() => {
    if (selectedNodeConfig) {
      setTestStagedConfig(JSON.parse(JSON.stringify(selectedNodeConfig)));
      setHasUnsavedDomainChanges(false);
      setTestPendingChanges([]);
    }
  }, [selectedNodeConfig]);

  // Domain Management tab: Edit domain
  const handleEditDomain = useCallback(
    (domain: string) => {
      const groups = getGroupsForDomain(domain);
      setEditingDomain({ domain, groups });
      setEditDomainInput(domain);
    },
    [getGroupsForDomain],
  );

  // Domain Management tab: Confirm edit
  const handleConfirmEdit = useCallback(() => {
    if (!editingDomain || !testStagedConfig || !editDomainInput.trim()) return;

    const updatedConfig = JSON.parse(
      JSON.stringify(testStagedConfig),
    ) as AdvancedBlockingConfig;
    const oldDomain = editingDomain.domain;
    const newDomain = editDomainInput.trim();

    // Update domain in all groups that contained it
    editingDomain.groups.forEach((groupName) => {
      const group = updatedConfig.groups?.find((g) => g.name === groupName);
      if (!group) return;

      let targetArray: string[];
      switch (activeDomainType) {
        case "blocked":
          targetArray = group.blocked = group.blocked || [];
          break;
        case "allowed":
          targetArray = group.allowed = group.allowed || [];
          break;
        case "blockedRegex":
          targetArray = group.blockedRegex = group.blockedRegex || [];
          break;
        case "allowedRegex":
          targetArray = group.allowedRegex = group.allowedRegex || [];
          break;
      }

      const index = targetArray.indexOf(oldDomain);
      if (index !== -1) {
        targetArray[index] = newDomain;
        targetArray.sort();
      }
    });

    setTestStagedConfig(updatedConfig);
    setHasUnsavedDomainChanges(true);
    setTestPendingChanges((prev) => [
      ...prev,
      {
        type: "modified",
        category: activeDomainType,
        description: `Changed "${oldDomain}" to "${newDomain}" in ${editingDomain.groups.join(", ")}`,
      },
    ]);

    setEditingDomain(null);
    setEditDomainInput("");
  }, [editingDomain, testStagedConfig, editDomainInput, activeDomainType]);

  // Domain Management tab: Delete domain
  const handleDeleteDomain = useCallback(
    (domain: string) => {
      const groups = getGroupsForDomain(domain);
      setDeletingDomain({ domain, groups });
    },
    [getGroupsForDomain],
  );

  // Domain Management tab: Confirm delete
  const handleConfirmDelete = useCallback(() => {
    if (!deletingDomain || !testStagedConfig) return;

    const updatedConfig = JSON.parse(
      JSON.stringify(testStagedConfig),
    ) as AdvancedBlockingConfig;
    const domain = deletingDomain.domain;

    // Remove domain from all groups
    deletingDomain.groups.forEach((groupName) => {
      const group = updatedConfig.groups?.find((g) => g.name === groupName);
      if (!group) return;

      let targetArray: string[];
      switch (activeDomainType) {
        case "blocked":
          targetArray = group.blocked = group.blocked || [];
          break;
        case "allowed":
          targetArray = group.allowed = group.allowed || [];
          break;
        case "blockedRegex":
          targetArray = group.blockedRegex = group.blockedRegex || [];
          break;
        case "allowedRegex":
          targetArray = group.allowedRegex = group.allowedRegex || [];
          break;
      }

      const index = targetArray.indexOf(domain);
      if (index !== -1) {
        targetArray.splice(index, 1);
      }
    });

    setTestStagedConfig(updatedConfig);
    setHasUnsavedDomainChanges(true);
    setTestPendingChanges((prev) => [
      ...prev,
      {
        type: "removed",
        category: activeDomainType,
        description: `Removed "${domain}" from ${deletingDomain.groups.join(", ")}`,
      },
    ]);

    setDeletingDomain(null);
  }, [deletingDomain, testStagedConfig, activeDomainType]);

  return (
    <>
      <PullToRefreshIndicator
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
        isRefreshing={pullToRefresh.isRefreshing}
      />
      <section ref={pullToRefresh.containerRef} className="configuration">
        <header className="configuration__header">
          <div>
            <h1>DNS Filtering</h1>
            <p>
              Configure DNS filtering rules, groups, and sync policies across
              nodes.
            </p>
          </div>
          {/* Cluster Mode Badge - top right corner */}
          <ClusterInfoBanner
            primaryNodeName={primary?.name}
            show={isClusterEnabled}
          />
        </header>

        {/* Blocking Method Selector - choose between Built-in and Advanced Blocking */}
        <BlockingMethodSelector
          selectedMethod={selectedBlockingMethod}
          onMethodChange={setSelectedBlockingMethod}
          hasAdvancedBlocking={nodes.some((n) => n.hasAdvancedBlocking)}
          hasBuiltInBlocking={
            blockingStatus?.nodes?.some((n) => n.builtInEnabled) ?? false
          }
        />

        {/* Conflict Warning Banner - show when both methods are active */}
        <BlockingConflictBanner
          hasConflict={blockingStatus?.hasConflict ?? false}
          conflictWarning={blockingStatus?.conflictWarning}
          conflictingNodes={blockingStatus?.nodes?.filter((n) => n.hasConflict)}
          onDismiss={() => {
            /* Banner handles its own dismiss state */
          }}
          show={blockingStatus?.hasConflict ?? false}
        />

        {/* Show setup guide if Advanced Blocking app is missing (only when Advanced mode selected) */}
        {selectedBlockingMethod === "advanced" &&
          (allMissing || someMissing) && (
            <AdvancedBlockingSetupGuide
              missingNodes={missingNodes}
              showFullGuide={allMissing}
            />
          )}

        {/* Show skeleton while loading initial data OR when reloading */}
        {loadingAdvancedBlocking && selectedBlockingMethod === "advanced" ?
          <ConfigurationSkeleton />
        : selectedBlockingMethod === "built-in" ?
          /* Built-in Blocking Mode */
          <section className="configuration__editors">
            {/* Node Selector - shared component for built-in mode */}
            {builtInNodes.length > 0 && (
              <NodeSelector
                nodes={builtInNodes}
                blockingMethod="built-in"
                selectedNodeId={selectedNodeId}
                onSelectNode={handleNodeSelect}
                loading={loadingBuiltInBlocking}
                hasUnsavedChanges={false}
                primaryNodeId={primary?.id}
                isClusterEnabled={isClusterEnabled}
                overrideCounts={builtInCountsOverride ?? undefined}
              />
            )}
            <BuiltInBlockingEditor
              selectedNodeId={selectedNodeId || nodes[0]?.id || ""}
              snapshot={selectedBuiltInSnapshot}
              loading={loadingBuiltInBlocking}
              onRefresh={async () => {
                await reloadBuiltInBlocking();
                await reloadBlockingStatus();
              }}
              advancedBlockingActive={
                blockingStatus?.nodesWithAdvancedBlocking &&
                blockingStatus.nodesWithAdvancedBlocking.length > 0
              }
              onCountsChange={handleBuiltInCountsChange}
            />
          </section>
        : /* Advanced Blocking Mode */
          <section className="configuration__editors">
            {/* Global Node Selector - applies to all tabs except Sync */}
            {availableNodes.length > 0 && activeTab !== "sync" && (
              <NodeSelector
                nodes={availableNodes}
                blockingMethod="advanced"
                selectedNodeId={selectedNodeId}
                onSelectNode={handleNodeSelect}
                loading={loadingAdvancedBlocking}
                hasUnsavedChanges={hasAnyUnsavedChanges}
                primaryNodeId={primary?.id}
                isClusterEnabled={isClusterEnabled}
              />
            )}

            {/* Tab Switcher */}
            {availableNodes.length > 0 && (
              <div className="configuration__tab-switcher">
                <button
                  type="button"
                  className={`configuration__tab ${activeTab === "domain-management" ? "configuration__tab--active" : ""}`}
                  onClick={() => handleTabChange("domain-management")}
                >
                  <span>Domains</span>
                </button>
                <button
                  type="button"
                  className={`configuration__tab ${activeTab === "group-management" ? "configuration__tab--active" : ""}`}
                  onClick={() => handleTabChange("group-management")}
                >
                  <span>Groups</span>
                </button>
                <button
                  type="button"
                  className={`configuration__tab ${activeTab === "list-management" ? "configuration__tab--active" : ""}`}
                  onClick={() => handleTabChange("list-management")}
                >
                  <span>Lists</span>
                </button>
                {/* Hide Sync tab in cluster mode - Primary automatically syncs to Secondaries */}
                {!isClusterEnabled && (
                  <button
                    type="button"
                    className={`configuration__tab ${activeTab === "sync" ? "configuration__tab--active" : ""}`}
                    onClick={() => handleTabChange("sync")}
                  >
                    Sync
                    {syncChangeCount > 0 && (
                      <span className="configuration__tab-badge">
                        {syncChangeCount}
                      </span>
                    )}
                  </button>
                )}
              </div>
            )}

            {/* Group Management Tab */}
            {activeTab === "group-management" && (
              <section className="configuration-editor configuration-editor--stacked">
                <header className="configuration-editor__header advanced-blocking-summary__actions">
                  <div className="configuration-editor__title">
                    <h2>Group Management</h2>
                    <p>
                      Create and manage filtering groups. Configure global
                      settings, network mappings, and group-specific blocking
                      behavior.
                    </p>
                  </div>
                </header>
                <AdvancedBlockingEditor
                  overview={advancedBlocking}
                  loading={loadingAdvancedBlocking}
                  error={advancedBlockingError}
                  onSave={handleSaveAdvancedBlocking}
                  onDirtyChange={setHasUnsavedGroupChanges}
                  selectedNodeId={selectedNodeId}
                  onNodeChange={handleNodeSelect}
                />
              </section>
            )}

            {/* List Management Tab */}
            {activeTab === "list-management" && availableNodes.length > 0 && (
              <section className="configuration-editor configuration-editor--stacked">
                <header className="configuration-editor__header">
                  <div className="configuration-editor__title">
                    <h2>List Management</h2>
                    <p>
                      Manage blocklist URLs, allowlist URLs, and filter lists
                      across multiple groups.
                    </p>
                  </div>
                </header>
                <ListSourceEditor
                  config={selectedNodeConfig}
                  onSave={handleSaveMultiGroupConfig}
                  onDirtyChange={setHasUnsavedListSourcesChanges}
                  disabled={loadingAdvancedBlocking || !selectedNodeConfig}
                />
              </section>
            )}

            {/* Domain Management Tab */}
            {activeTab === "domain-management" && availableNodes.length > 0 && (
              <section className="configuration-editor configuration-editor--stacked">
                <header className="configuration-editor__header">
                  <div className="configuration-editor__title">
                    <h2>Domain Management</h2>
                    <p>
                      Search for domains or add new ones with drag & drop to
                      groups.
                    </p>
                  </div>
                </header>

                <div
                  style={{
                    padding: "15px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "1.5rem",
                  }}
                >
                  {/* Action Type Selector */}
                  <div className="domain-type-selector">
                    <label className="domain-type-selector__label">
                      Domain Action Type:
                    </label>
                    <button
                      type="button"
                      onClick={() => setActiveDomainType("blocked")}
                      className={`domain-type-button domain-type-button--blocked ${activeDomainType === "blocked" ? "domain-type-button--active" : ""}`}
                    >
                      <FontAwesomeIcon
                        icon={faSquareMinus}
                        style={{ fontSize: "1.25em" }}
                      />{" "}
                      Blocked
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDomainType("allowed")}
                      className={`domain-type-button domain-type-button--allowed ${activeDomainType === "allowed" ? "domain-type-button--active" : ""}`}
                    >
                      <FontAwesomeIcon
                        icon={faSquareCheck}
                        style={{ fontSize: "1.25em" }}
                      />{" "}
                      Allowed
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDomainType("blockedRegex")}
                      className={`domain-type-button domain-type-button--blocked-regex ${activeDomainType === "blockedRegex" ? "domain-type-button--active" : ""}`}
                    >
                      <LayeredIcon
                        backgroundIcon={faCode}
                        foregroundIcon={faBan}
                        bgColor="var(--color-text-secondary)"
                        fgColor={
                          activeDomainType === "blockedRegex" ?
                            "var(--color-danger)"
                          : "var(--color-text-secondary)"
                        }
                        bgFontSize="0.85em"
                        fgFontSize="1.5em"
                      />{" "}
                      Blocked Regex
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDomainType("allowedRegex")}
                      className={`domain-type-button domain-type-button--allowed-regex ${activeDomainType === "allowedRegex" ? "domain-type-button--active" : ""}`}
                    >
                      <FontAwesomeIcon
                        icon={faCode}
                        style={{ fontSize: "1.25em" }}
                      />{" "}
                      Allowed Regex
                    </button>
                  </div>

                  <div className="domain-management-grid">
                    {/* Left: Search and Domain List */}
                    <div className="domain-management-left">
                      {/* Unified Search or Add Domain */}
                      <div>
                        <label className="form-label">
                          <FontAwesomeIcon icon={faSearch} /> Search or Add
                          Domain
                        </label>
                        <div className="configuration-editor__list-form">
                          <input
                            type="text"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            onKeyDown={(e) =>
                              e.key === "Enter" && handleCheckDomain()
                            }
                            placeholder="Enter domain or URL to search or add..."
                          />
                          <button
                            type="button"
                            onClick={() => void handleCheckDomain()}
                            disabled={
                              !searchInput.trim() || !selectedNodeId || checking
                            }
                            className="button button--primary"
                          >
                            {checking ? "Checking..." : "Search"}
                          </button>
                        </div>
                      </div>

                      {/* Draggable Domain Preview */}
                      {searchedDomain && !domainExists && (
                        <div className="alert-box alert-box--info">
                          <p className="alert-box__title">
                            Domain not found. Drag to a group to add:
                          </p>
                          <div
                            draggable="true"
                            onDragStart={(e) => {
                              e.currentTarget.style.boxShadow = "none";
                              handleDragStart(e, searchedDomain);
                            }}
                            onDragEnd={handleDragEnd}
                            className={`domain-pill ${activeDomainType.includes("blocked") ? "domain-pill--blocked" : "domain-pill--allowed"} ${isDragging ? "domain-pill--dragging" : ""}`}
                          >
                            {searchedDomain}
                          </div>
                        </div>
                      )}

                      {/* Domain List Table */}
                      <div className="domain-list-card">
                        <div className="domain-list-card__header">
                          <span className="domain-list-card__title">
                            <FontAwesomeIcon icon={faList} /> Domains (
                            {filteredDomains.length}
                            {searchInput.trim() &&
                              `/${allDomainsForType.length}`}
                            )
                          </span>
                        </div>
                        <div className="domain-list-card__body">
                          {filteredDomains.length === 0 ?
                            <div
                              style={{
                                padding: "2rem",
                                textAlign: "center",
                                color: "var(--color-text-tertiary)",
                              }}
                            >
                              <p
                                style={{
                                  margin: 0,
                                  fontSize: "0.9rem",
                                  fontStyle: "italic",
                                }}
                              >
                                {searchInput.trim() ?
                                  "No matching domains found"
                                : "No domains in any group for this type"}
                              </p>
                            </div>
                          : <table className="domain-table">
                              <tbody>
                                {filteredDomains.map((domain) => {
                                  const domainGroups =
                                    getGroupsForDomain(domain);

                                  return (
                                    <tr
                                      key={domain}
                                      className="domain-table__row"
                                    >
                                      <td className="domain-table__cell">
                                        <div
                                          draggable="true"
                                          onClick={() =>
                                            handleDomainClick(domain)
                                          }
                                          onDragStart={(e) =>
                                            handleDragStart(e, domain)
                                          }
                                          onDragEnd={handleDragEnd}
                                          className={`domain-table__domain-pill ${activeDomainType.includes("blocked") ? "domain-table__domain-pill--blocked" : "domain-table__domain-pill--allowed"}`}
                                        >
                                          {highlightMatch(domain, searchInput)}
                                        </div>
                                      </td>
                                      <td
                                        style={{
                                          padding: "0.75rem 1rem",
                                          textAlign: "right",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {domainGroups.map((g) => (
                                          <span
                                            key={g}
                                            className="domain-table__badge"
                                          >
                                            {g}
                                          </span>
                                        ))}
                                      </td>
                                      <td className="domain-table__cell domain-table__cell--right">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleEditDomain(domain)
                                          }
                                          className="icon-button icon-button--edit"
                                          title="Edit domain"
                                        >
                                          <FontAwesomeIcon icon={faPencil} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleDeleteDomain(domain)
                                          }
                                          className="icon-button icon-button--delete"
                                          title="Delete domain from all groups"
                                        >
                                          <FontAwesomeIcon icon={faTrash} />
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          }
                        </div>
                      </div>

                      {/* Domain Found Results */}
                      {searchedDomain && domainExists && (
                        <>
                          {/* Compute effective groups after considering staged config */}
                          {(() => {
                            // Get groups where domain is blocked (from API)
                            const blockedInGroups = new Set(domainInGroups);

                            // Filter out groups where domain was manually allowed in staged config
                            if (testStagedConfig?.groups) {
                              testStagedConfig.groups.forEach((group) => {
                                if (group.allowed?.includes(searchedDomain)) {
                                  blockedInGroups.delete(group.name);
                                }
                              });
                            }

                            const effectiveBlockedGroups =
                              Array.from(blockedInGroups);
                            const isBlocked = effectiveBlockedGroups.length > 0;

                            return (
                              <div
                                className={`alert-box ${isBlocked ? "alert-box--danger" : "alert-box--success"}`}
                              >
                                <div
                                  className={`alert-box__title ${isBlocked ? "alert-box__title--danger" : "alert-box__title--success"}`}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.5rem",
                                  }}
                                >
                                  {isBlocked ?
                                    <div className="status-icon">
                                      <FontAwesomeIcon
                                        icon={faCircle}
                                        className="status-icon__bg"
                                        style={{ color: "var(--color-danger)" }}
                                      />
                                      <FontAwesomeIcon
                                        icon={faBan}
                                        className="status-icon__fg"
                                      />
                                    </div>
                                  : <div className="status-icon">
                                      <FontAwesomeIcon
                                        icon={faCircle}
                                        className="status-icon__bg"
                                        style={{
                                          color: "var(--color-success)",
                                        }}
                                      />
                                      <FontAwesomeIcon
                                        icon={faCheck}
                                        className="status-icon__fg"
                                      />
                                    </div>
                                  }
                                  {isBlocked ?
                                    "Domain blocked in:"
                                  : "Domain allowed in:"}
                                  {effectiveBlockedGroups.length > 0 ?
                                    effectiveBlockedGroups.map((g) => (
                                      <strong key={g} className="modal__code">
                                        {g}
                                      </strong>
                                    ))
                                  : <strong className="modal__code">
                                      All (allowed)
                                    </strong>
                                  }
                                </div>
                                {domainMatchDetails.length > 0 && isBlocked && (
                                  <div className="match-details match-details--danger">
                                    <p className="match-details__title">
                                      Match Details:
                                    </p>
                                    <ul className="match-details__list">
                                      {(() => {
                                        // Deduplicate match details by type + matchedDomain + matchedPattern + source
                                        const uniqueMatches = domainMatchDetails
                                          .filter(
                                            (m) => m.type !== "manual-allowed",
                                          )
                                          .reduce((acc, match) => {
                                            const key = `${match.type}|${match.matchedDomain || ""}|${match.matchedPattern || ""}|${match.source || ""}`;
                                            if (!acc.has(key)) {
                                              acc.set(key, match);
                                            }
                                            return acc;
                                          }, new Map());

                                        return Array.from(
                                          uniqueMatches.values(),
                                        ).map((match, idx) => (
                                          <li
                                            key={idx}
                                            style={{ marginBottom: "0.5rem" }}
                                          >
                                            <div
                                              style={{
                                                fontStyle: "italic",
                                                marginBottom: "0.25rem",
                                              }}
                                            >
                                              {match.type}
                                              {match.matchedDomain &&
                                                ` (matched: ${match.matchedDomain})`}
                                              {match.matchedPattern &&
                                                ` (pattern: ${match.matchedPattern})`}
                                            </div>
                                            {match.source && (
                                              <div
                                                style={{
                                                  fontSize: "0.75rem",
                                                  opacity: 0.8,
                                                  paddingLeft: "0.5rem",
                                                  borderLeft:
                                                    "2px solid currentColor",
                                                }}
                                              >
                                                Source: {match.source}
                                              </div>
                                            )}
                                          </li>
                                        ));
                                      })()}
                                    </ul>
                                  </div>
                                )}

                                {(() => {
                                  // Find groups where domain is manually allowed
                                  const manuallyAllowedGroups: string[] = [];
                                  if (testStagedConfig?.groups) {
                                    testStagedConfig.groups.forEach((group) => {
                                      if (
                                        group.allowed?.includes(searchedDomain)
                                      ) {
                                        manuallyAllowedGroups.push(group.name);
                                      }
                                    });
                                  }

                                  if (manuallyAllowedGroups.length > 0) {
                                    return (
                                      <div
                                        style={{
                                          marginTop: "0.75rem",
                                          fontSize: "0.8rem",
                                          color: "var(--color-success-text)",
                                        }}
                                      >
                                        <p
                                          style={{
                                            margin: "0 0 0.5rem 0",
                                            fontWeight: 600,
                                          }}
                                        >
                                          Manual Overrides:
                                        </p>
                                        <ul
                                          style={{
                                            margin: 0,
                                            paddingLeft: "1.5rem",
                                          }}
                                        >
                                          {manuallyAllowedGroups.map(
                                            (groupName, idx) => (
                                              <li
                                                key={idx}
                                                style={{
                                                  marginBottom: "0.25rem",
                                                }}
                                              >
                                                <div
                                                  style={{
                                                    fontStyle: "italic",
                                                  }}
                                                >
                                                  Allowed in{" "}
                                                  <strong>{groupName}</strong>{" "}
                                                  group
                                                </div>
                                              </li>
                                            ),
                                          )}
                                        </ul>
                                      </div>
                                    );
                                  }

                                  return null;
                                })()}

                                {isBlocked && (
                                  <div
                                    style={{
                                      marginTop: "1rem",
                                      paddingTop: "0.75rem",
                                      borderTop:
                                        "1px solid var(--color-border)",
                                    }}
                                  >
                                    <p
                                      style={{
                                        margin: "0 0 0.5rem 0",
                                        fontWeight: 600,
                                        fontSize: "0.8rem",
                                        color: "var(--color-text-primary)",
                                      }}
                                    >
                                      Quick{" "}
                                      {activeDomainType.includes("blocked") ?
                                        "Block"
                                      : "Allow"}
                                      :
                                    </p>
                                    <div
                                      draggable="true"
                                      onDragStart={(e) => {
                                        e.currentTarget.style.boxShadow =
                                          "none";
                                        e.dataTransfer.effectAllowed = "copy";
                                        e.dataTransfer.setData(
                                          "text/plain",
                                          searchedDomain,
                                        );
                                      }}
                                      style={{
                                        display: "inline-block",
                                        padding: "0.5rem 1rem",
                                        background:
                                          activeDomainType.includes("blocked") ?
                                            "var(--color-danger-bg)"
                                          : "var(--color-success-bg)",
                                        borderRadius: "0.5rem",
                                        color:
                                          activeDomainType.includes("blocked") ?
                                            "var(--color-danger)"
                                          : "var(--color-success)",
                                        border: `1px solid ${activeDomainType.includes("blocked") ? "var(--color-danger)" : "var(--color-success)"}`,
                                        fontWeight: 600,
                                        fontSize: "0.85rem",
                                        cursor: "grab",
                                        userSelect: "none",
                                        transition: "all 0.2s ease",
                                        transform: "translate(0, 0)",
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background =
                                          activeDomainType.includes("blocked") ?
                                            "var(--color-danger-light)"
                                          : "var(--color-success-light)";
                                        e.currentTarget.style.boxShadow =
                                          "0 4px 8px rgba(0, 0, 0, 0.15)";
                                        e.currentTarget.style.transform =
                                          "translate(0, -2px)";
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background =
                                          activeDomainType.includes("blocked") ?
                                            "var(--color-danger-bg)"
                                          : "var(--color-success-bg)";
                                        e.currentTarget.style.boxShadow =
                                          "none";
                                        e.currentTarget.style.transform =
                                          "translate(0, 0)";
                                      }}
                                    >
                                      <FontAwesomeIcon
                                        icon={faCheck}
                                        style={{ marginRight: "0.5rem" }}
                                      />
                                      {searchedDomain}
                                    </div>
                                    <p
                                      style={{
                                        margin: "0.5rem 0 0 0",
                                        fontSize: "0.75rem",
                                        color: "var(--color-text-secondary)",
                                      }}
                                    >
                                      Drag into groups to{" "}
                                      {activeDomainType.includes("blocked") ?
                                        "block"
                                      : "allow"}{" "}
                                      this domain
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </div>

                    {/* Right: Groups Drag & Drop */}
                    <div className="domain-management-right">
                      <label className="form-label form-label--flex">
                        <FontAwesomeIcon
                          icon={faGripVertical}
                          style={{ fontSize: "0.95em" }}
                        />
                        Groups - Drag & Drop
                      </label>
                      <div
                        style={{
                          marginTop: "-0.75rem",
                          marginBottom: "0.75rem",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          justifyContent: "flex-end",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.8rem",
                            color: "var(--color-text-secondary)",
                          }}
                        >
                          Entry sort:
                        </span>
                        <select
                          value={domainEntrySortMode}
                          onChange={(e) =>
                            setDomainEntrySortMode(
                              e.target.value as DomainEntrySortMode,
                            )
                          }
                          style={{
                            fontSize: "0.8rem",
                            padding: "0.25rem 0.5rem",
                            borderRadius: "0.5rem",
                            border: "1px solid var(--color-border)",
                            background: "var(--color-bg-secondary)",
                            color: "var(--color-text-primary)",
                          }}
                        >
                          <option value="alpha">Alpha-sort</option>
                          <option value="source">Source order</option>
                        </select>
                      </div>
                      <div
                        onDragOver={(e) => {
                          // Allow drop anywhere in this container
                          e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          // If dropped in the container but not on a specific group, remove from source group
                          if (
                            dragSourceGroup &&
                            draggedDomain &&
                            !dragOverGroup
                          ) {
                            handleRemoveFromGroup(
                              draggedDomain,
                              dragSourceGroup,
                            );
                          }
                        }}
                        className="drop-zone-container"
                      >
                        <p className="drop-zone-hint">
                          <FontAwesomeIcon
                            icon={faInfoCircle}
                            style={{ marginRight: "0.25rem" }}
                          />
                          Drag domains to groups to add them, or drag from
                          expanded groups to remove.
                        </p>

                        {/* All Groups Drop Zone */}
                        <div
                          onDragOver={(e) => handleDragOver(e, "ALL_GROUPS")}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => void handleDrop(e, "ALL_GROUPS")}
                          className={`all-groups-drop-zone ${dragOverGroup === "ALL_GROUPS" ? "all-groups-drop-zone--dragging-over" : ""}`}
                        >
                          <div className="all-groups-drop-zone__icon">
                            <FontAwesomeIcon
                              icon={
                                (
                                  dragOverGroup === "ALL_GROUPS" &&
                                  dragSourceGroup
                                ) ?
                                  faPlus
                                : faUsers
                              }
                              style={{
                                color:
                                  (
                                    dragOverGroup === "ALL_GROUPS" &&
                                    dragSourceGroup
                                  ) ?
                                    "var(--color-success)"
                                  : "inherit",
                              }}
                            />
                          </div>
                          <div
                            className={`all-groups-drop-zone__title ${dragOverGroup === "ALL_GROUPS" ? "all-groups-drop-zone__title--active" : ""}`}
                          >
                            All Groups
                          </div>
                          <div className="all-groups-drop-zone__hint">
                            {dragOverGroup === "ALL_GROUPS" && dragSourceGroup ?
                              "Add to missing groups"
                            : "Drop here to add to all groups"}
                          </div>
                        </div>

                        <div className="group-drop-zones">
                          {groups.map((groupName) => {
                            const isExpanded = expandedGroups.has(groupName);
                            const domains = getDomainsForGroupByType(groupName);
                            const domainCount = domains.length;

                            return (
                              <div key={groupName}>
                                <div
                                  onClick={() =>
                                    toggleGroupExpansion(groupName)
                                  }
                                  onDragOver={(e) =>
                                    handleDragOver(e, groupName)
                                  }
                                  onDragLeave={handleDragLeave}
                                  onDrop={(e) =>
                                    handleDrop(e, groupName, "header")
                                  }
                                  className={`group-drop-zone ${dragOverGroup === groupName ? "group-drop-zone--dragging-over" : ""}`}
                                >
                                  <div className="group-drop-zone__header">
                                    <div className="group-drop-zone__info">
                                      <span
                                        style={{
                                          fontWeight: 600,
                                          fontSize: "0.9rem",
                                          color:
                                            dragOverGroup === groupName ?
                                              "var(--color-primary)"
                                            : "var(--color-text-primary)",
                                        }}
                                      >
                                        {groupName}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: "0.9rem",
                                          fontWeight: 600,
                                          color: "var(--color-bg-secondary)",
                                          background: "var(--color-info)",
                                          padding: "2px 6px",
                                          borderRadius: "3px",
                                        }}
                                      >
                                        {domainCount}
                                      </span>
                                      <button
                                        type="button"
                                        style={{
                                          background: "none",
                                          border: "none",
                                          padding: "0",
                                          cursor: "pointer",
                                          color: "var(--color-text-secondary)",
                                          fontSize: "0.9rem",
                                          display: "flex",
                                          alignItems: "center",
                                          transition: "transform 0.5s",
                                          marginLeft: "auto",
                                          transform:
                                            isExpanded ? "rotate(-180deg)" : (
                                              "rotate(0deg)"
                                            ),
                                        }}
                                      >
                                        <FontAwesomeIcon icon={faChevronUp} />
                                      </button>
                                    </div>
                                    {dragOverGroup === groupName && (
                                      <span className="group-drop-zone__action-icon">
                                        {dragSourceGroup === groupName ?
                                          <FontAwesomeIcon
                                            icon={faXmark}
                                            className="group-drop-zone__action-icon--remove"
                                          />
                                        : <FontAwesomeIcon
                                            icon={faPlus}
                                            className="group-drop-zone__action-icon--add"
                                          />
                                        }
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Expanded Domain List */}
                                <div
                                  onDragOver={(e) =>
                                    handleDragOver(e, groupName)
                                  }
                                  onDragLeave={handleDragLeave}
                                  onDrop={(e) =>
                                    handleDrop(e, groupName, "list")
                                  }
                                  style={{
                                    marginLeft: "0.55rem",
                                    marginRight: "0.55rem",
                                    padding:
                                      isExpanded ? "0.75rem" : "0 0.75rem",
                                    background:
                                      dragOverGroup === groupName ?
                                        "var(--color-info-bg)"
                                      : "var(--color-bg-tertiary)",
                                    borderRadius: "0.5rem",
                                    borderTopLeftRadius: "0",
                                    borderTopRightRadius: "0",
                                    borderTop: "0",
                                    borderRight:
                                      dragOverGroup === groupName ?
                                        "1px dashed var(--color-primary)"
                                      : "1px solid var(--color-border-light)",
                                    borderBottom:
                                      dragOverGroup === groupName ?
                                        "1px dashed var(--color-primary)"
                                      : "1px solid var(--color-border-light)",
                                    borderLeft:
                                      dragOverGroup === groupName ?
                                        "1px dashed var(--color-primary)"
                                      : "1px solid var(--color-border-light)",
                                    maxHeight: isExpanded ? "200px" : "0",
                                    overflow: isExpanded ? "auto" : "hidden",
                                    transition:
                                      "max-height 0.3s ease, padding 0.3s ease, background 0.2s ease, opacity 0.2s ease",
                                    opacity: isExpanded ? 1 : 0,
                                    pointerEvents: isExpanded ? "auto" : "none",
                                  }}
                                >
                                  {domains.length === 0 ?
                                    <p
                                      style={{
                                        margin: 0,
                                        fontSize: "0.8rem",
                                        color: "var(--color-text-tertiary)",
                                        fontStyle: "italic",
                                        textAlign: "center",
                                      }}
                                    >
                                      No domains - drop here to add
                                    </p>
                                  : <ul
                                      style={{
                                        margin: 0,
                                        padding: 0,
                                        listStyle: "none",
                                      }}
                                    >
                                      {domains.map((domain) => (
                                        <li
                                          key={domain}
                                          draggable="true"
                                          onClick={() =>
                                            handleDomainClick(domain)
                                          }
                                          onDragStart={(e) => {
                                            e.currentTarget.style.boxShadow =
                                              "none";
                                            handleDragStart(e, domain);
                                            setDragSourceGroup(groupName);
                                          }}
                                          onDragEnd={() => {
                                            handleDragEnd();
                                            setDragSourceGroup(null);
                                          }}
                                          className={`group-domain-list__item ${activeDomainType.includes("blocked") ? "group-domain-list__item--blocked" : "group-domain-list__item--allowed"} ${isDragging && draggedDomain === domain ? "group-domain-list__item--dragging" : ""}`}
                                        >
                                          {domain}
                                        </li>
                                      ))}
                                    </ul>
                                  }
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Domain Management Tab Footer */}
            {activeTab === "domain-management" && testStagedConfig && (
              <footer className="multi-group-editor__footer">
                {hasUnsavedDomainChanges && (
                  <>
                    <button
                      type="button"
                      className="multi-group-editor__footer-hint multi-group-editor__footer-hint--clickable"
                      onClick={() =>
                        setShowTestChangesSummary(!showTestChangesSummary)
                      }
                      title="Click to see what will be saved"
                    >
                      You have unsaved changes ({testPendingChanges.length}){" "}
                      {showTestChangesSummary ? "▼" : "▲"}
                    </button>

                    {showTestChangesSummary &&
                      testPendingChanges.length > 0 && (
                        <div className="multi-group-editor__changes-summary">
                          <h4>Pending Changes:</h4>
                          <ul className="multi-group-editor__changes-list">
                            {testPendingChanges.map((change, idx) => (
                              <li
                                key={idx}
                                className={`change-item change-item--${change.type}`}
                              >
                                <span
                                  className="change-icon"
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: "1.5rem",
                                    height: "1.5rem",
                                  }}
                                >
                                  {change.type === "added" && (
                                    <FontAwesomeIcon
                                      icon={faPlus}
                                      style={{ color: "var(--color-success)" }}
                                    />
                                  )}
                                  {change.type === "removed" && (
                                    <FontAwesomeIcon
                                      icon={faMinus}
                                      style={{ color: "var(--color-danger)" }}
                                    />
                                  )}
                                  {change.type === "modified" && (
                                    <FontAwesomeIcon
                                      icon={faPencil}
                                      style={{ color: "var(--color-warning)" }}
                                    />
                                  )}
                                </span>
                                <span className="change-type">
                                  {change.category}
                                </span>
                                <span
                                  className="change-group"
                                  style={{
                                    flex: 1,
                                    minWidth: 0,
                                    wordBreak: "break-word",
                                  }}
                                >
                                  {change.description}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </>
                )}
                <div className="multi-group-editor__footer-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={handleTestReset}
                    disabled={!hasUnsavedDomainChanges}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void handleTestSave()}
                    disabled={!hasUnsavedDomainChanges || !testStagedConfig}
                  >
                    Save Changes
                  </button>
                </div>
              </footer>
            )}

            {/* Sync Tab */}
            {activeTab === "sync" && availableNodes.length > 0 && (
              <ConfigurationSyncView
                advancedBlocking={advancedBlocking}
                onSync={handleSyncConfig}
                disabled={loadingAdvancedBlocking}
                nodes={nodes}
              />
            )}
          </section>
        }
      </section>

      {/* Edit Domain Modal */}
      {editingDomain && (
        <div className="modal-overlay" onClick={() => setEditingDomain(null)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">Edit Domain</h3>
            <p className="modal__description">
              Domain is in {editingDomain.groups.length} group(s):{" "}
              <strong>{editingDomain.groups.join(", ")}</strong>
            </p>
            <input
              type="text"
              value={editDomainInput}
              onChange={(e) => setEditDomainInput(e.target.value)}
              placeholder="Enter new domain"
              className="modal__input"
            />
            <div className="modal__actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEditingDomain(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleConfirmEdit}
                disabled={!editDomainInput.trim()}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Domain Modal */}
      {deletingDomain && (
        <div className="modal-overlay" onClick={() => setDeletingDomain(null)}>
          <div className="modal-container" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title modal__title--danger">
              <FontAwesomeIcon
                icon={faExclamationTriangle}
                style={{ fontSize: "1.1em" }}
              />
              Delete Domain
            </h3>
            <p className="modal__description">
              Are you sure you want to delete{" "}
              <code className="modal__code">{deletingDomain.domain}</code> from{" "}
              <strong>{deletingDomain.groups.length} group(s)</strong>?
            </p>
            <p className="modal__subdescription">
              Groups: {deletingDomain.groups.join(", ")}
            </p>
            <div className="modal__actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setDeletingDomain(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary"
                onClick={handleConfirmDelete}
                style={{
                  background: "var(--color-danger)",
                  borderColor: "var(--color-danger)",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for unsaved changes */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onConfirm={confirmModal.onConfirm}
        onCancel={closeConfirmModal}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        confirmLabel={confirmModal.confirmLabel}
      />
    </>
  );
}

export default ConfigurationPage;
