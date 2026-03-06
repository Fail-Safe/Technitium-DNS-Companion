import {
  faCheck,
  faExclamationTriangle,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useMemo, useState } from "react";
import type { TechnitiumNode } from "../../context/TechnitiumContext";
import type {
  AdvancedBlockingConfig,
  AdvancedBlockingGroupSettingsDiff,
  AdvancedBlockingOverview,
  AdvancedBlockingSnapshot,
} from "../../types/advancedBlocking";
import {
  compareStringArrays,
  compareUrlArrays,
} from "../../utils/arrayComparison";
import { areSimilar } from "../../utils/levenshtein";

interface ConfigurationSyncViewProps {
  advancedBlocking?: AdvancedBlockingOverview;
  onSync: (
    sourceNodeId: string,
    targetNodeId: string,
    config: AdvancedBlockingConfig,
  ) => Promise<void>;
  disabled?: boolean;
  nodes?: TechnitiumNode[];
}

type SyncStatus = "in-sync" | "different" | "only-source" | "only-target";

interface DomainDiff {
  added: string[];
  removed: string[];
  modified: Array<{ oldValue: string; newValue: string }>;
}

interface GroupDiff {
  name: string;
  status: SyncStatus;
  settingsDifferences?: AdvancedBlockingGroupSettingsDiff[];
  sourceStats?: {
    blocked: number;
    allowed: number;
    blockedRegex: number;
    allowedRegex: number;
    blockListUrls: number;
    allowListUrls: number;
    regexBlockListUrls: number;
    regexAllowListUrls: number;
    adblockListUrls: number;
  };
  targetStats?: {
    blocked: number;
    allowed: number;
    blockedRegex: number;
    allowedRegex: number;
    blockListUrls: number;
    allowListUrls: number;
    regexBlockListUrls: number;
    regexAllowListUrls: number;
    adblockListUrls: number;
  };
  detailedDiff?: {
    blocked: DomainDiff;
    allowed: DomainDiff;
    blockedRegex: DomainDiff;
    allowedRegex: DomainDiff;
    blockListUrls: DomainDiff;
    allowListUrls: DomainDiff;
    regexBlockListUrls: DomainDiff;
    regexAllowListUrls: DomainDiff;
    adblockListUrls: DomainDiff;
  };
}

interface SyncPreview {
  direction: "source-to-target" | "target-to-source";
  totalAdditions: number;
  totalRemovals: number;
  affectedGroups: string[];
  groupsToBeDeleted: string[];
  configChanges?: {
    localMappingsAdded: number;
    localMappingsRemoved: number;
    localMappingsChanged: number;
    networkMappingsAdded: number;
    networkMappingsRemoved: number;
    networkMappingsChanged: number;
  };
}

interface NodeConfigDiff {
  hasDifferences: boolean;
  globalSettings: {
    different: Array<{ field: string; sourceValue: unknown; targetValue: unknown }>;
  };
  localMappings: {
    added: Array<{ key: string; value: string }>;
    removed: Array<{ key: string; value: string }>;
    changed: Array<{ key: string; sourceValue: string; targetValue: string }>;
  };
  networkMappings: {
    added: Array<{ key: string; value: string }>;
    removed: Array<{ key: string; value: string }>;
    changed: Array<{ key: string; sourceValue: string; targetValue: string }>;
  };
}

interface SecondaryPair {
  secondaryNode: AdvancedBlockingSnapshot;
  groupDiffs: GroupDiff[];
  configDiff: NodeConfigDiff;
  syncSummary: {
    inSync: number;
    different: number;
    onlySource: number;
    onlyTarget: number;
    hasAnyDiff: boolean;
  };
  hasApp: boolean;
}

function computeGroupDiffs(
  sourceConfig: AdvancedBlockingConfig,
  targetConfig: AdvancedBlockingConfig,
): GroupDiff[] {
  const sourceGroups = sourceConfig.groups;
  const targetGroups = targetConfig.groups;
  const allGroupNames = new Set([
    ...sourceGroups.map((g) => g.name),
    ...targetGroups.map((g) => g.name),
  ]);

  const calculateDomainDiff = (
    source: string[],
    target: string[],
  ): DomainDiff => {
    const sourceSet = new Set(source);
    const targetSet = new Set(target);
    const purelyAdded: string[] = [];
    const purelyRemoved: string[] = [];
    const modified: Array<{ oldValue: string; newValue: string }> = [];
    const matchedTargetIndices = new Set<number>();

    for (const sourceItem of source) {
      if (targetSet.has(sourceItem)) continue;
      let foundSimilar = false;
      for (let i = 0; i < target.length; i++) {
        if (matchedTargetIndices.has(i)) continue;
        const targetItem = target[i];
        if (sourceSet.has(targetItem)) continue;
        if (areSimilar(sourceItem, targetItem)) {
          modified.push({ oldValue: targetItem, newValue: sourceItem });
          matchedTargetIndices.add(i);
          foundSimilar = true;
          break;
        }
      }
      if (!foundSimilar) purelyAdded.push(sourceItem);
    }
    for (let i = 0; i < target.length; i++) {
      const targetItem = target[i];
      if (!sourceSet.has(targetItem) && !matchedTargetIndices.has(i)) {
        purelyRemoved.push(targetItem);
      }
    }
    return { added: purelyAdded, removed: purelyRemoved, modified };
  };

  const extractUrls = (entries: (string | { url: string })[]): string[] =>
    entries.map((e) => (typeof e === "string" ? e : e.url));

  const compareSettingValues = (val1: unknown, val2: unknown): boolean => {
    if (Array.isArray(val1) && Array.isArray(val2)) {
      if (val1.length !== val2.length) return false;
      const sorted1 = [...val1].sort();
      const sorted2 = [...val2].sort();
      return sorted1.every((v, i) => v === sorted2[i]);
    }
    return val1 === val2;
  };

  const diffs: GroupDiff[] = [];

  for (const groupName of allGroupNames) {
    const sourceGroup = sourceGroups.find((g) => g.name === groupName);
    const targetGroup = targetGroups.find((g) => g.name === groupName);

    if (!sourceGroup && targetGroup) {
      diffs.push({
        name: groupName,
        status: "only-target",
        targetStats: {
          blocked: targetGroup.blocked.length,
          allowed: targetGroup.allowed.length,
          blockedRegex: targetGroup.blockedRegex.length,
          allowedRegex: targetGroup.allowedRegex.length,
          blockListUrls: targetGroup.blockListUrls.length,
          allowListUrls: targetGroup.allowListUrls.length,
          regexBlockListUrls: targetGroup.regexBlockListUrls.length,
          regexAllowListUrls: targetGroup.regexAllowListUrls.length,
          adblockListUrls: targetGroup.adblockListUrls.length,
        },
      });
    } else if (sourceGroup && !targetGroup) {
      diffs.push({
        name: groupName,
        status: "only-source",
        sourceStats: {
          blocked: sourceGroup.blocked.length,
          allowed: sourceGroup.allowed.length,
          blockedRegex: sourceGroup.blockedRegex.length,
          allowedRegex: sourceGroup.allowedRegex.length,
          blockListUrls: sourceGroup.blockListUrls.length,
          allowListUrls: sourceGroup.allowListUrls.length,
          regexBlockListUrls: sourceGroup.regexBlockListUrls.length,
          regexAllowListUrls: sourceGroup.regexAllowListUrls.length,
          adblockListUrls: sourceGroup.adblockListUrls.length,
        },
      });
    } else if (sourceGroup && targetGroup) {
      const isDifferent =
        !compareStringArrays(sourceGroup.blocked, targetGroup.blocked) ||
        !compareStringArrays(sourceGroup.allowed, targetGroup.allowed) ||
        !compareStringArrays(
          sourceGroup.blockedRegex,
          targetGroup.blockedRegex,
        ) ||
        !compareStringArrays(
          sourceGroup.allowedRegex,
          targetGroup.allowedRegex,
        ) ||
        !compareUrlArrays(sourceGroup.blockListUrls, targetGroup.blockListUrls) ||
        !compareUrlArrays(sourceGroup.allowListUrls, targetGroup.allowListUrls) ||
        !compareUrlArrays(
          sourceGroup.regexBlockListUrls,
          targetGroup.regexBlockListUrls,
        ) ||
        !compareUrlArrays(
          sourceGroup.regexAllowListUrls,
          targetGroup.regexAllowListUrls,
        ) ||
        !compareStringArrays(
          sourceGroup.adblockListUrls,
          targetGroup.adblockListUrls,
        );

      const sourceStats = {
        blocked: sourceGroup.blocked.length,
        allowed: sourceGroup.allowed.length,
        blockedRegex: sourceGroup.blockedRegex.length,
        allowedRegex: sourceGroup.allowedRegex.length,
        blockListUrls: sourceGroup.blockListUrls.length,
        allowListUrls: sourceGroup.allowListUrls.length,
        regexBlockListUrls: sourceGroup.regexBlockListUrls.length,
        regexAllowListUrls: sourceGroup.regexAllowListUrls.length,
        adblockListUrls: sourceGroup.adblockListUrls.length,
      };
      const targetStats = {
        blocked: targetGroup.blocked.length,
        allowed: targetGroup.allowed.length,
        blockedRegex: targetGroup.blockedRegex.length,
        allowedRegex: targetGroup.allowedRegex.length,
        blockListUrls: targetGroup.blockListUrls.length,
        allowListUrls: targetGroup.allowListUrls.length,
        regexBlockListUrls: targetGroup.regexBlockListUrls.length,
        regexAllowListUrls: targetGroup.regexAllowListUrls.length,
        adblockListUrls: targetGroup.adblockListUrls.length,
      };

      const settingsDifferences: AdvancedBlockingGroupSettingsDiff[] = [];
      if (
        !compareSettingValues(
          sourceGroup.enableBlocking,
          targetGroup.enableBlocking,
        )
      ) {
        settingsDifferences.push({
          field: "enableBlocking",
          sourceValue: sourceGroup.enableBlocking,
          targetValue: targetGroup.enableBlocking,
        });
      }
      if (
        !compareSettingValues(
          sourceGroup.blockAsNxDomain,
          targetGroup.blockAsNxDomain,
        )
      ) {
        settingsDifferences.push({
          field: "blockAsNxDomain",
          sourceValue: sourceGroup.blockAsNxDomain,
          targetValue: targetGroup.blockAsNxDomain,
        });
      }
      if (
        !compareSettingValues(
          sourceGroup.allowTxtBlockingReport,
          targetGroup.allowTxtBlockingReport,
        )
      ) {
        settingsDifferences.push({
          field: "allowTxtBlockingReport",
          sourceValue: sourceGroup.allowTxtBlockingReport,
          targetValue: targetGroup.allowTxtBlockingReport,
        });
      }
      if (
        !compareSettingValues(
          sourceGroup.blockingAddresses,
          targetGroup.blockingAddresses,
        )
      ) {
        settingsDifferences.push({
          field: "blockingAddresses",
          sourceValue: sourceGroup.blockingAddresses,
          targetValue: targetGroup.blockingAddresses,
        });
      }

      const hasSettingsDifferences = settingsDifferences.length > 0;
      let detailedDiff: GroupDiff["detailedDiff"];
      if (isDifferent || hasSettingsDifferences) {
        detailedDiff = {
          blocked: calculateDomainDiff(sourceGroup.blocked, targetGroup.blocked),
          allowed: calculateDomainDiff(sourceGroup.allowed, targetGroup.allowed),
          blockedRegex: calculateDomainDiff(
            sourceGroup.blockedRegex,
            targetGroup.blockedRegex,
          ),
          allowedRegex: calculateDomainDiff(
            sourceGroup.allowedRegex,
            targetGroup.allowedRegex,
          ),
          blockListUrls: calculateDomainDiff(
            extractUrls(sourceGroup.blockListUrls),
            extractUrls(targetGroup.blockListUrls),
          ),
          allowListUrls: calculateDomainDiff(
            extractUrls(sourceGroup.allowListUrls),
            extractUrls(targetGroup.allowListUrls),
          ),
          regexBlockListUrls: calculateDomainDiff(
            extractUrls(sourceGroup.regexBlockListUrls),
            extractUrls(targetGroup.regexBlockListUrls),
          ),
          regexAllowListUrls: calculateDomainDiff(
            extractUrls(sourceGroup.regexAllowListUrls),
            extractUrls(targetGroup.regexAllowListUrls),
          ),
          adblockListUrls: calculateDomainDiff(
            sourceGroup.adblockListUrls,
            targetGroup.adblockListUrls,
          ),
        };
      }

      diffs.push({
        name: groupName,
        status: isDifferent || hasSettingsDifferences ? "different" : "in-sync",
        sourceStats,
        targetStats,
        detailedDiff,
        settingsDifferences: hasSettingsDifferences
          ? settingsDifferences
          : undefined,
      });
    }
  }

  const statusOrder: Record<SyncStatus, number> = {
    different: 0,
    "only-source": 1,
    "only-target": 2,
    "in-sync": 3,
  };
  return diffs.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
}

function computeConfigDifferences(
  sourceConfig: AdvancedBlockingConfig,
  targetConfig: AdvancedBlockingConfig,
): NodeConfigDiff {
  const globalDifferent: Array<{
    field: string;
    sourceValue: unknown;
    targetValue: unknown;
  }> = [];

  if (sourceConfig.enableBlocking !== targetConfig.enableBlocking) {
    globalDifferent.push({
      field: "enableBlocking",
      sourceValue: sourceConfig.enableBlocking,
      targetValue: targetConfig.enableBlocking,
    });
  }
  if (sourceConfig.blockingAnswerTtl !== targetConfig.blockingAnswerTtl) {
    globalDifferent.push({
      field: "blockingAnswerTtl",
      sourceValue: sourceConfig.blockingAnswerTtl,
      targetValue: targetConfig.blockingAnswerTtl,
    });
  }
  if (
    sourceConfig.blockListUrlUpdateIntervalHours !==
    targetConfig.blockListUrlUpdateIntervalHours
  ) {
    globalDifferent.push({
      field: "blockListUrlUpdateIntervalHours",
      sourceValue: sourceConfig.blockListUrlUpdateIntervalHours,
      targetValue: targetConfig.blockListUrlUpdateIntervalHours,
    });
  }
  if (
    sourceConfig.blockListUrlUpdateIntervalMinutes !==
    targetConfig.blockListUrlUpdateIntervalMinutes
  ) {
    globalDifferent.push({
      field: "blockListUrlUpdateIntervalMinutes",
      sourceValue: sourceConfig.blockListUrlUpdateIntervalMinutes,
      targetValue: targetConfig.blockListUrlUpdateIntervalMinutes,
    });
  }

  const sourceLocalMappings = sourceConfig.localEndPointGroupMap || {};
  const targetLocalMappings = targetConfig.localEndPointGroupMap || {};
  const allLocalKeys = new Set([
    ...Object.keys(sourceLocalMappings),
    ...Object.keys(targetLocalMappings),
  ]);
  const localAdded: Array<{ key: string; value: string }> = [];
  const localRemoved: Array<{ key: string; value: string }> = [];
  const localChanged: Array<{
    key: string;
    sourceValue: string;
    targetValue: string;
  }> = [];
  for (const key of allLocalKeys) {
    const sv = sourceLocalMappings[key];
    const tv = targetLocalMappings[key];
    if (sv && !tv) localAdded.push({ key, value: sv });
    else if (!sv && tv) localRemoved.push({ key, value: tv });
    else if (sv && tv && sv !== tv)
      localChanged.push({ key, sourceValue: sv, targetValue: tv });
  }

  const sourceNetworkMappings = sourceConfig.networkGroupMap || {};
  const targetNetworkMappings = targetConfig.networkGroupMap || {};
  const allNetworkKeys = new Set([
    ...Object.keys(sourceNetworkMappings),
    ...Object.keys(targetNetworkMappings),
  ]);
  const networkAdded: Array<{ key: string; value: string }> = [];
  const networkRemoved: Array<{ key: string; value: string }> = [];
  const networkChanged: Array<{
    key: string;
    sourceValue: string;
    targetValue: string;
  }> = [];
  for (const key of allNetworkKeys) {
    const sv = sourceNetworkMappings[key];
    const tv = targetNetworkMappings[key];
    if (sv && !tv) networkAdded.push({ key, value: sv });
    else if (!sv && tv) networkRemoved.push({ key, value: tv });
    else if (sv && tv && sv !== tv)
      networkChanged.push({ key, sourceValue: sv, targetValue: tv });
  }

  const hasDifferences =
    globalDifferent.length > 0 ||
    localAdded.length > 0 ||
    localRemoved.length > 0 ||
    localChanged.length > 0 ||
    networkAdded.length > 0 ||
    networkRemoved.length > 0 ||
    networkChanged.length > 0;

  return {
    hasDifferences,
    globalSettings: { different: globalDifferent },
    localMappings: {
      added: localAdded,
      removed: localRemoved,
      changed: localChanged,
    },
    networkMappings: {
      added: networkAdded,
      removed: networkRemoved,
      changed: networkChanged,
    },
  };
}

function computeSyncPreview(
  groupDiffs: GroupDiff[],
  configDiff: NodeConfigDiff,
  direction: "source-to-target" | "target-to-source",
): SyncPreview {
  let totalAdditions = 0;
  let totalRemovals = 0;
  const affectedGroups: string[] = [];
  const groupsToBeDeleted: string[] = [];
  let configChanges: SyncPreview["configChanges"] | undefined;

  if (configDiff.hasDifferences) {
    if (direction === "source-to-target") {
      configChanges = {
        localMappingsAdded: configDiff.localMappings.added.length,
        localMappingsRemoved: configDiff.localMappings.removed.length,
        localMappingsChanged: configDiff.localMappings.changed.length,
        networkMappingsAdded: configDiff.networkMappings.added.length,
        networkMappingsRemoved: configDiff.networkMappings.removed.length,
        networkMappingsChanged: configDiff.networkMappings.changed.length,
      };
    } else {
      configChanges = {
        localMappingsAdded: configDiff.localMappings.removed.length,
        localMappingsRemoved: configDiff.localMappings.added.length,
        localMappingsChanged: configDiff.localMappings.changed.length,
        networkMappingsAdded: configDiff.networkMappings.removed.length,
        networkMappingsRemoved: configDiff.networkMappings.added.length,
        networkMappingsChanged: configDiff.networkMappings.changed.length,
      };
    }
  }

  groupDiffs.forEach((diff) => {
    if (diff.status === "in-sync") return;

    if (diff.detailedDiff) {
      const addedInSource =
        diff.detailedDiff.blocked.added.length +
        diff.detailedDiff.allowed.added.length +
        diff.detailedDiff.blockedRegex.added.length +
        diff.detailedDiff.allowedRegex.added.length +
        diff.detailedDiff.blockListUrls.added.length +
        diff.detailedDiff.allowListUrls.added.length +
        diff.detailedDiff.regexBlockListUrls.added.length +
        diff.detailedDiff.regexAllowListUrls.added.length +
        diff.detailedDiff.adblockListUrls.added.length;

      const removedFromSource =
        diff.detailedDiff.blocked.removed.length +
        diff.detailedDiff.allowed.removed.length +
        diff.detailedDiff.blockedRegex.removed.length +
        diff.detailedDiff.allowedRegex.removed.length +
        diff.detailedDiff.blockListUrls.removed.length +
        diff.detailedDiff.allowListUrls.removed.length +
        diff.detailedDiff.regexBlockListUrls.removed.length +
        diff.detailedDiff.regexAllowListUrls.removed.length +
        diff.detailedDiff.adblockListUrls.removed.length;

      if (direction === "source-to-target") {
        totalAdditions += addedInSource;
        totalRemovals += removedFromSource;
      } else {
        totalAdditions += removedFromSource;
        totalRemovals += addedInSource;
      }
      if (addedInSource > 0 || removedFromSource > 0) {
        affectedGroups.push(diff.name);
      }
    }

    if (direction === "source-to-target") {
      if (diff.status === "only-source") {
        const stats = diff.sourceStats!;
        totalAdditions +=
          stats.blocked +
          stats.allowed +
          stats.blockedRegex +
          stats.allowedRegex +
          stats.blockListUrls +
          stats.allowListUrls +
          stats.regexBlockListUrls +
          stats.regexAllowListUrls +
          stats.adblockListUrls;
        affectedGroups.push(diff.name);
      } else if (diff.status === "only-target") {
        const stats = diff.targetStats!;
        totalRemovals +=
          stats.blocked +
          stats.allowed +
          stats.blockedRegex +
          stats.allowedRegex +
          stats.blockListUrls +
          stats.allowListUrls +
          stats.regexBlockListUrls +
          stats.regexAllowListUrls +
          stats.adblockListUrls;
        affectedGroups.push(diff.name);
        groupsToBeDeleted.push(diff.name);
      }
    } else {
      if (diff.status === "only-target") {
        const stats = diff.targetStats!;
        totalAdditions +=
          stats.blocked +
          stats.allowed +
          stats.blockedRegex +
          stats.allowedRegex +
          stats.blockListUrls +
          stats.allowListUrls +
          stats.regexBlockListUrls +
          stats.regexAllowListUrls +
          stats.adblockListUrls;
        affectedGroups.push(diff.name);
      } else if (diff.status === "only-source") {
        const stats = diff.sourceStats!;
        totalRemovals +=
          stats.blocked +
          stats.allowed +
          stats.blockedRegex +
          stats.allowedRegex +
          stats.blockListUrls +
          stats.allowListUrls +
          stats.regexBlockListUrls +
          stats.regexAllowListUrls +
          stats.adblockListUrls;
        affectedGroups.push(diff.name);
        groupsToBeDeleted.push(diff.name);
      }
    }
  });

  return {
    direction,
    totalAdditions,
    totalRemovals,
    affectedGroups,
    groupsToBeDeleted,
    configChanges,
  };
}

export function ConfigurationSyncView({
  advancedBlocking,
  onSync,
  disabled = false,
  nodes = [],
}: ConfigurationSyncViewProps) {
  const [primaryNodeId, setPrimaryNodeId] = useState<string>("");
  const [secondaryNodeIds, setSecondaryNodeIds] = useState<Set<string>>(
    new Set(),
  );
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [success, setSuccess] = useState<string | undefined>();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [syncPreview, setSyncPreview] = useState<SyncPreview | undefined>();
  const [viewMode, setViewMode] = useState<"1-to-1" | "primary-secondaries">(
    "1-to-1",
  );

  // Legacy 1:1 state (kept for backward compatibility)
  const [sourceNodeId, setSourceNodeId] = useState<string>("");
  const [targetNodeId, setTargetNodeId] = useState<string>("");

  const availableNodes = useMemo(
    () => advancedBlocking?.nodes ?? [],
    [advancedBlocking?.nodes],
  );

  // Helper to add status indicator to node display names
  const getNodeDisplayName = useCallback(
    (nodeId: string, baseName: string): string => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return baseName;

      const hasApp = node.hasAdvancedBlocking;
      const indicator =
        hasApp === true ? "✓"
        : hasApp === false ? "⚠"
        : "";
      return indicator ? `${indicator} ${baseName}` : baseName;
    },
    [nodes],
  );

  // Auto-select nodes when data loads
  useMemo(() => {
    if (availableNodes.length >= 2) {
      // For 1:1 mode
      if (!sourceNodeId && !targetNodeId) {
        setSourceNodeId(availableNodes[0].nodeId);
        setTargetNodeId(availableNodes[1].nodeId);
      }
      // For primary-secondaries mode
      if (!primaryNodeId && secondaryNodeIds.size === 0) {
        setPrimaryNodeId(availableNodes[0].nodeId);
        // Auto-select other nodes as secondaries
        const otherNodes = availableNodes.slice(1).map((n) => n.nodeId);
        setSecondaryNodeIds(new Set(otherNodes));
      }
    }
  }, [
    availableNodes,
    sourceNodeId,
    targetNodeId,
    primaryNodeId,
    secondaryNodeIds.size,
  ]);

  // Toggle secondary node selection
  const toggleSecondaryNode = useCallback((nodeId: string) => {
    setSecondaryNodeIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  }, []);

  const sourceNode = availableNodes.find(
    (n) =>
      n.nodeId ===
      (viewMode === "primary-secondaries" ? primaryNodeId : sourceNodeId),
  );
  const targetNode =
    viewMode === "primary-secondaries"
      ? undefined
      : availableNodes.find((n) => n.nodeId === targetNodeId);

  // Check if source and target nodes have Advanced Blocking installed
  const sourceHasApp =
    nodes.find((n) => n.id === sourceNodeId)?.hasAdvancedBlocking ?? true;
  const targetHasApp =
    nodes.find((n) => n.id === targetNodeId)?.hasAdvancedBlocking ?? true;
  const canSync = sourceHasApp && targetHasApp;

  // Calculate diff between source and target configurations
  const groupDiffs = useMemo<GroupDiff[]>(() => {
    if (!sourceNode?.config || !targetNode?.config || !canSync) return [];
    return computeGroupDiffs(sourceNode.config, targetNode.config);
  }, [sourceNode, targetNode, canSync]);

  // Calculate config-level differences (client mappings, global settings)
  const configDifferences = useMemo<NodeConfigDiff>(() => {
    if (!sourceNode?.config || !targetNode?.config || !canSync) {
      return {
        hasDifferences: false,
        globalSettings: { different: [] },
        localMappings: { added: [], removed: [], changed: [] },
        networkMappings: { added: [], removed: [], changed: [] },
      };
    }
    return computeConfigDifferences(sourceNode.config, targetNode.config);
  }, [sourceNode, targetNode, canSync]);

  const syncSummary = useMemo(() => {
    const inSync = groupDiffs.filter((d) => d.status === "in-sync").length;
    const different = groupDiffs.filter((d) => d.status === "different").length;
    const onlySource = groupDiffs.filter(
      (d) => d.status === "only-source",
    ).length;
    const onlyTarget = groupDiffs.filter(
      (d) => d.status === "only-target",
    ).length;

    // Include config-level differences in the total count
    const configDiffsCount = configDifferences.hasDifferences ? 1 : 0;

    return {
      inSync,
      different,
      onlySource,
      onlyTarget,
      total: groupDiffs.length,
      configDiffsCount,
      totalWithConfig: groupDiffs.length + configDiffsCount,
    };
  }, [groupDiffs, configDifferences]);

  // Calculate sync preview for confirmation
  const calculateSyncPreview = useCallback(
    (direction: "source-to-target" | "target-to-source"): SyncPreview =>
      computeSyncPreview(groupDiffs, configDifferences, direction),
    [groupDiffs, configDifferences],
  );

  const handleSyncSourceToTarget = useCallback(async () => {
    if (!sourceNode?.config || !targetNodeId) {
      return;
    }

    const preview = calculateSyncPreview("source-to-target");

    // Show confirmation if there are removals, groups will be deleted, OR config differences exist
    if (
      preview.totalRemovals > 0 ||
      preview.groupsToBeDeleted.length > 0 ||
      configDifferences.hasDifferences
    ) {
      setSyncPreview(preview);
      return;
    }

    // No removals or deletions - proceed directly

    setError(undefined);
    setSuccess(undefined);
    setSyncing(true);

    try {
      await onSync(sourceNodeId, targetNodeId, sourceNode.config);
      setSuccess(`Successfully synced ${sourceNodeId} → ${targetNodeId}`);
    } catch (err) {
      setError((err as Error).message || "Failed to sync configuration");
    } finally {
      setSyncing(false);
    }
  }, [
    sourceNode,
    sourceNodeId,
    targetNodeId,
    onSync,
    calculateSyncPreview,
    configDifferences.hasDifferences,
  ]);

  const handleSyncTargetToSource = useCallback(async () => {
    if (!targetNode?.config || !sourceNodeId) {
      return;
    }

    const preview = calculateSyncPreview("target-to-source");

    // Show confirmation if there are removals, groups will be deleted, OR config differences exist
    if (
      preview.totalRemovals > 0 ||
      preview.groupsToBeDeleted.length > 0 ||
      configDifferences.hasDifferences
    ) {
      setSyncPreview(preview);
      return;
    }

    // No removals or deletions - proceed directly
    setError(undefined);
    setSuccess(undefined);
    setSyncing(true);

    try {
      await onSync(targetNodeId, sourceNodeId, targetNode.config);
      setSuccess(`Successfully synced ${targetNodeId} → ${sourceNodeId}`);
    } catch (err) {
      setError((err as Error).message || "Failed to sync configuration");
    } finally {
      setSyncing(false);
    }
  }, [
    targetNode,
    targetNodeId,
    sourceNodeId,
    onSync,
    calculateSyncPreview,
    configDifferences.hasDifferences,
  ]);

  const confirmSync = useCallback(async () => {
    if (!syncPreview) return;

    setError(undefined);
    setSuccess(undefined);
    setSyncing(true);
    setSyncPreview(undefined);

    try {
      if (syncPreview.direction === "source-to-target" && sourceNode?.config) {
        await onSync(sourceNodeId, targetNodeId, sourceNode.config);
        setSuccess(`Successfully synced ${sourceNodeId} → ${targetNodeId}`);
      } else if (
        syncPreview.direction === "target-to-source" &&
        targetNode?.config
      ) {
        await onSync(targetNodeId, sourceNodeId, targetNode.config);
        setSuccess(`Successfully synced ${targetNodeId} → ${sourceNodeId}`);
      }
    } catch (err) {
      setError((err as Error).message || "Failed to sync configuration");
    } finally {
      setSyncing(false);
    }
  }, [syncPreview, sourceNode, targetNode, sourceNodeId, targetNodeId, onSync]);

  const cancelSync = useCallback(() => {
    setSyncPreview(undefined);
  }, []);

  const toggleGroupExpanded = useCallback((groupName: string) => {
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupName)) {
        newSet.delete(groupName);
      } else {
        newSet.add(groupName);
      }
      return newSet;
    });
  }, []);

  const swapNodes = useCallback(() => {
    const temp = sourceNodeId;
    setSourceNodeId(targetNodeId);
    setTargetNodeId(temp);
  }, [sourceNodeId, targetNodeId]);

  // P+S mode state
  const [expandedSecondaries, setExpandedSecondaries] = useState<Set<string>>(
    new Set(),
  );
  const [psSyncPending, setPsSyncPending] = useState<
    | { type: "single"; secondaryId: string; preview: SyncPreview }
    | { type: "all"; secondaryIds: string[]; preview: SyncPreview }
    | undefined
  >();

  const toggleSecondaryExpanded = useCallback((nodeId: string) => {
    setExpandedSecondaries((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  // Per-secondary diff computation for P+S mode
  const secondaryPairs = useMemo<SecondaryPair[]>(() => {
    if (viewMode !== "primary-secondaries" || !sourceNode?.config) return [];
    const primaryConfig = sourceNode.config;
    return availableNodes
      .filter((n) => secondaryNodeIds.has(n.nodeId))
      .map((secondaryNode) => {
        const hasApp =
          nodes.find((n) => n.id === secondaryNode.nodeId)
            ?.hasAdvancedBlocking ?? true;
        if (!secondaryNode.config) {
          return {
            secondaryNode,
            groupDiffs: [],
            configDiff: {
              hasDifferences: false,
              globalSettings: { different: [] },
              localMappings: { added: [], removed: [], changed: [] },
              networkMappings: { added: [], removed: [], changed: [] },
            },
            syncSummary: {
              inSync: 0,
              different: 0,
              onlySource: 0,
              onlyTarget: 0,
              hasAnyDiff: false,
            },
            hasApp,
          };
        }
        const gdiffs = computeGroupDiffs(primaryConfig, secondaryNode.config);
        const cdiff = computeConfigDifferences(
          primaryConfig,
          secondaryNode.config,
        );
        return {
          secondaryNode,
          groupDiffs: gdiffs,
          configDiff: cdiff,
          syncSummary: {
            inSync: gdiffs.filter((d) => d.status === "in-sync").length,
            different: gdiffs.filter((d) => d.status === "different").length,
            onlySource: gdiffs.filter((d) => d.status === "only-source").length,
            onlyTarget: gdiffs.filter((d) => d.status === "only-target").length,
            hasAnyDiff:
              cdiff.hasDifferences ||
              gdiffs.some((d) => d.status !== "in-sync"),
          },
          hasApp,
        };
      });
  }, [viewMode, sourceNode, availableNodes, secondaryNodeIds, nodes]);

  const handleSyncPrimaryToSecondary = useCallback(
    async (secondaryId: string) => {
      if (!sourceNode?.config) return;
      const pair = secondaryPairs.find(
        (p) => p.secondaryNode.nodeId === secondaryId,
      );
      if (!pair) return;
      const preview = computeSyncPreview(
        pair.groupDiffs,
        pair.configDiff,
        "source-to-target",
      );
      if (
        preview.totalRemovals > 0 ||
        preview.groupsToBeDeleted.length > 0 ||
        pair.configDiff.hasDifferences
      ) {
        setPsSyncPending({ type: "single", secondaryId, preview });
        return;
      }
      setError(undefined);
      setSuccess(undefined);
      setSyncing(true);
      try {
        await onSync(primaryNodeId, secondaryId, sourceNode.config);
        setSuccess(`Successfully synced ${primaryNodeId} → ${secondaryId}`);
      } catch (err) {
        setError((err as Error).message || "Failed to sync configuration");
      } finally {
        setSyncing(false);
      }
    },
    [sourceNode, secondaryPairs, primaryNodeId, onSync],
  );

  const handleSyncAllSecondaries = useCallback(async () => {
    if (!sourceNode?.config) return;
    const outOfSync = secondaryPairs.filter(
      (p) => p.syncSummary.hasAnyDiff && p.hasApp,
    );
    if (outOfSync.length === 0) return;

    let totalAdditions = 0;
    let totalRemovals = 0;
    const affectedGroups: string[] = [];
    const groupsToBeDeleted: string[] = [];
    let needsConfirm = false;

    for (const pair of outOfSync) {
      const preview = computeSyncPreview(
        pair.groupDiffs,
        pair.configDiff,
        "source-to-target",
      );
      totalAdditions += preview.totalAdditions;
      totalRemovals += preview.totalRemovals;
      affectedGroups.push(
        ...preview.affectedGroups.map(
          (g) => `${pair.secondaryNode.nodeId}: ${g}`,
        ),
      );
      groupsToBeDeleted.push(
        ...preview.groupsToBeDeleted.map(
          (g) => `${pair.secondaryNode.nodeId}: ${g}`,
        ),
      );
      if (
        preview.totalRemovals > 0 ||
        preview.groupsToBeDeleted.length > 0 ||
        pair.configDiff.hasDifferences
      )
        needsConfirm = true;
    }

    const aggregatedPreview: SyncPreview = {
      direction: "source-to-target",
      totalAdditions,
      totalRemovals,
      affectedGroups,
      groupsToBeDeleted,
    };

    if (needsConfirm) {
      setPsSyncPending({
        type: "all",
        secondaryIds: outOfSync.map((p) => p.secondaryNode.nodeId),
        preview: aggregatedPreview,
      });
      return;
    }

    setError(undefined);
    setSuccess(undefined);
    setSyncing(true);
    try {
      for (const pair of outOfSync) {
        await onSync(
          primaryNodeId,
          pair.secondaryNode.nodeId,
          sourceNode.config,
        );
      }
      setSuccess(
        `Successfully synced ${primaryNodeId} → ${outOfSync.length} secondar${outOfSync.length === 1 ? "y" : "ies"}`,
      );
    } catch (err) {
      setError((err as Error).message || "Failed to sync configuration");
    } finally {
      setSyncing(false);
    }
  }, [sourceNode, secondaryPairs, primaryNodeId, onSync]);

  const confirmPsSync = useCallback(async () => {
    if (!psSyncPending || !sourceNode?.config) return;
    setError(undefined);
    setSuccess(undefined);
    setSyncing(true);
    setPsSyncPending(undefined);
    try {
      if (psSyncPending.type === "single") {
        await onSync(
          primaryNodeId,
          psSyncPending.secondaryId,
          sourceNode.config,
        );
        setSuccess(
          `Successfully synced ${primaryNodeId} → ${psSyncPending.secondaryId}`,
        );
      } else {
        for (const secondaryId of psSyncPending.secondaryIds) {
          await onSync(primaryNodeId, secondaryId, sourceNode.config);
        }
        setSuccess(
          `Successfully synced ${primaryNodeId} → ${psSyncPending.secondaryIds.length} secondar${psSyncPending.secondaryIds.length === 1 ? "y" : "ies"}`,
        );
      }
    } catch (err) {
      setError((err as Error).message || "Failed to sync configuration");
    } finally {
      setSyncing(false);
    }
  }, [psSyncPending, sourceNode, primaryNodeId, onSync]);

  const cancelPsSync = useCallback(() => {
    setPsSyncPending(undefined);
  }, []);

  if (availableNodes.length < 2) {
    return (
      <section className="sync-view">
        <header className="sync-view__header">
          <h2>Configuration Sync</h2>
          <p className="sync-view__description">
            At least 2 nodes are required to compare and sync configurations.
          </p>
        </header>
      </section>
    );
  }

  return (
    <section className="sync-view">
      <header className="sync-view__header">
        <h2>Configuration Sync</h2>
        <p className="sync-view__description">
          Compare Advanced Blocking configurations between nodes and sync
          changes with one click.
        </p>
      </header>
      {/* View Mode Toggle */}
      <div className="sync-view__mode-toggle">
        <button
          type="button"
          className={`sync-view__mode-button ${viewMode === "1-to-1" ? "sync-view__mode-button--active" : ""}`}
          onClick={() => setViewMode("1-to-1")}
          disabled={disabled || syncing}
        >
          1:1 Comparison
        </button>
        <button
          type="button"
          className={`sync-view__mode-button ${viewMode === "primary-secondaries" ? "sync-view__mode-button--active" : ""}`}
          onClick={() => setViewMode("primary-secondaries")}
          disabled={disabled || syncing}
        >
          Primary + Secondaries
        </button>
      </div>
      {/* Node Selector - 1:1 Mode */}
      {viewMode === "1-to-1" && (
        <div className="sync-view__node-selector">
          <div className="sync-view__node-select-group">
            <label htmlFor="sync-source-node">Source Node:</label>
            <select
              id="sync-source-node"
              value={sourceNodeId}
              onChange={(e) => setSourceNodeId(e.target.value)}
              disabled={disabled || syncing}
              className="sync-view__select"
            >
              {availableNodes.map((node) => {
                const displayName = getNodeDisplayName(
                  node.nodeId,
                  node.nodeId,
                );
                return (
                  <option
                    key={node.nodeId}
                    value={node.nodeId}
                    disabled={node.nodeId === targetNodeId}
                  >
                    {displayName} ({node.config?.groups.length ?? 0} groups)
                  </option>
                );
              })}
            </select>
          </div>

          <button
            type="button"
            onClick={swapNodes}
            className="sync-view__swap-button"
            title="Swap source and target"
            disabled={disabled || syncing}
          >
            ⇄
          </button>

          <div className="sync-view__node-select-group">
            <label htmlFor="sync-target-node">Target Node:</label>
            <select
              id="sync-target-node"
              value={targetNodeId}
              onChange={(e) => setTargetNodeId(e.target.value)}
              disabled={disabled || syncing}
              className="sync-view__select"
            >
              {availableNodes.map((node) => {
                const displayName = getNodeDisplayName(
                  node.nodeId,
                  node.nodeId,
                );
                return (
                  <option
                    key={node.nodeId}
                    value={node.nodeId}
                    disabled={node.nodeId === sourceNodeId}
                  >
                    {displayName} ({node.config?.groups.length ?? 0} groups)
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      )}
      {/* Node Selector - Primary + Secondaries Mode */}
      {viewMode === "primary-secondaries" && (
        <div className="sync-view__primary-secondaries">
          <div className="sync-view__primary-selector">
            <label htmlFor="sync-primary-node">Primary Node (Source):</label>
            <select
              id="sync-primary-node"
              value={primaryNodeId}
              onChange={(e) => setPrimaryNodeId(e.target.value)}
              disabled={disabled || syncing}
              className="sync-view__select"
            >
              {availableNodes.map((node) => {
                const displayName = getNodeDisplayName(
                  node.nodeId,
                  node.nodeId,
                );
                return (
                  <option key={node.nodeId} value={node.nodeId}>
                    {displayName} ({node.config?.groups.length ?? 0} groups)
                  </option>
                );
              })}
            </select>
          </div>

          <div className="sync-view__secondaries-selector">
            <label>Secondary Nodes (Targets):</label>
            <div className="sync-view__secondaries-list">
              {availableNodes
                .filter((node) => node.nodeId !== primaryNodeId)
                .map((node) => {
                  const displayName = getNodeDisplayName(
                    node.nodeId,
                    node.nodeId,
                  );
                  const isSelected = secondaryNodeIds.has(node.nodeId);
                  return (
                    <label
                      key={node.nodeId}
                      className="sync-view__secondary-item"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSecondaryNode(node.nodeId)}
                        disabled={disabled || syncing}
                      />
                      <span>
                        {displayName} ({node.config?.groups.length ?? 0} groups)
                      </span>
                    </label>
                  );
                })}
            </div>
            {secondaryNodeIds.size === 0 && (
              <p className="sync-view__secondaries-hint">
                Select at least one secondary node to compare.
              </p>
            )}
          </div>
        </div>
      )}
      {/* Primary + Secondaries Content */}
      {viewMode === "primary-secondaries" && sourceNode && (
        <div className="sync-view__ps-content">
          {secondaryPairs.some((p) => p.syncSummary.hasAnyDiff && p.hasApp) && (
            <div className="sync-view__actions">
              <button
                type="button"
                onClick={handleSyncAllSecondaries}
                className="button button--primary sync-view__sync-button"
                disabled={disabled || syncing}
              >
                {syncing ?
                  "Syncing..."
                : `Sync ${primaryNodeId} → All Secondaries`}
              </button>
            </div>
          )}
          {secondaryPairs.length === 0 ?
            <p className="sync-view__secondaries-hint">
              Select at least one secondary node to compare.
            </p>
          : secondaryPairs.map((pair) => {
              const {
                secondaryNode,
                groupDiffs: pairGroupDiffs,
                configDiff,
                syncSummary,
                hasApp,
              } = pair;
              const secondaryId = secondaryNode.nodeId;
              const isExpanded = expandedSecondaries.has(secondaryId);

              return (
                <div key={secondaryId} className="sync-view__ps-secondary">
                  <div
                    className="sync-view__ps-secondary-header"
                    onClick={() => toggleSecondaryExpanded(secondaryId)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      toggleSecondaryExpanded(secondaryId)
                    }
                  >
                    <div className="sync-view__ps-secondary-title">
                      <span
                        className={`sync-view__status-icon sync-view__status-icon--${syncSummary.hasAnyDiff ? "different" : "in-sync"}`}
                      >
                        {syncSummary.hasAnyDiff ?
                          <FontAwesomeIcon icon={faExclamationTriangle} />
                        : <FontAwesomeIcon icon={faCheck} />}
                      </span>
                      {getNodeDisplayName(secondaryId, secondaryId)}
                    </div>
                    <div className="sync-view__ps-secondary-meta">
                      {syncSummary.different > 0 && (
                        <span className="sync-view__status-badge sync-view__status-badge--different">
                          {syncSummary.different} different
                        </span>
                      )}
                      {syncSummary.onlySource > 0 && (
                        <span className="sync-view__status-badge sync-view__status-badge--only-source">
                          {syncSummary.onlySource} only on primary
                        </span>
                      )}
                      {syncSummary.onlyTarget > 0 && (
                        <span className="sync-view__status-badge sync-view__status-badge--only-target">
                          {syncSummary.onlyTarget} only on secondary
                        </span>
                      )}
                      {!syncSummary.hasAnyDiff && (
                        <span className="sync-view__status-badge sync-view__status-badge--in-sync">
                          In Sync
                        </span>
                      )}
                      {syncSummary.hasAnyDiff && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSyncPrimaryToSecondary(secondaryId);
                          }}
                          className="button button--primary sync-view__ps-sync-button"
                          disabled={disabled || syncing || !hasApp}
                          title={
                            !hasApp ?
                              "Advanced Blocking app not installed on this node"
                            : undefined
                          }
                        >
                          {syncing ? "Syncing..." : "Sync →"}
                        </button>
                      )}
                      <span className="sync-view__expand-icon">
                        {isExpanded ? "▼" : "▶"}
                      </span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="sync-view__ps-secondary-content">
                      <div className="sync-view__summary">
                        <div className="sync-view__summary-stat">
                          <span className="sync-view__summary-icon sync-view__summary-icon--in-sync">
                            ✓
                          </span>
                          <span className="sync-view__summary-count">
                            {syncSummary.inSync}
                          </span>
                          <span className="sync-view__summary-label">
                            In Sync
                          </span>
                        </div>
                        <div className="sync-view__summary-stat">
                          <span className="sync-view__summary-icon sync-view__summary-icon--different">
                            ⚠
                          </span>
                          <span className="sync-view__summary-count">
                            {syncSummary.different +
                              (configDiff.hasDifferences ? 1 : 0)}
                          </span>
                          <span className="sync-view__summary-label">
                            Different
                          </span>
                        </div>
                        <div className="sync-view__summary-stat">
                          <span className="sync-view__summary-icon sync-view__summary-icon--only-source">
                            →
                          </span>
                          <span className="sync-view__summary-count">
                            {syncSummary.onlySource}
                          </span>
                          <span className="sync-view__summary-label">
                            Only on {primaryNodeId}
                          </span>
                        </div>
                        <div className="sync-view__summary-stat">
                          <span className="sync-view__summary-icon sync-view__summary-icon--only-target">
                            ←
                          </span>
                          <span className="sync-view__summary-count">
                            {syncSummary.onlyTarget}
                          </span>
                          <span className="sync-view__summary-label">
                            Only on {secondaryId}
                          </span>
                        </div>
                      </div>
                      <div className="sync-view__diffs">
                        {pairGroupDiffs.map((diff) => {
                          const groupKey = `${secondaryId}:${diff.name}`;
                          const isGroupExpanded = expandedGroups.has(groupKey);
                          const hasDetailedDiff =
                            diff.detailedDiff && diff.status === "different";
                          return (
                            <div
                              key={diff.name}
                              className={`sync-view__diff sync-view__diff--${diff.status}`}
                            >
                              <div
                                className={`sync-view__diff-header ${hasDetailedDiff ? "sync-view__diff-header--clickable" : ""}`}
                                onClick={() =>
                                  hasDetailedDiff &&
                                  toggleGroupExpanded(groupKey)
                                }
                                role={hasDetailedDiff ? "button" : undefined}
                                tabIndex={hasDetailedDiff ? 0 : undefined}
                              >
                                <h3 className="sync-view__diff-title">
                                  <span
                                    className={`sync-view__status-icon sync-view__status-icon--${diff.status}`}
                                  >
                                    {diff.status === "in-sync" && (
                                      <FontAwesomeIcon icon={faCheck} />
                                    )}
                                    {diff.status === "different" && (
                                      <FontAwesomeIcon
                                        icon={faExclamationTriangle}
                                      />
                                    )}
                                    {diff.status === "only-source" && "→"}
                                    {diff.status === "only-target" && "←"}
                                  </span>
                                  {diff.name}
                                </h3>
                                <div className="sync-view__diff-header-right">
                                  <span
                                    className={`sync-view__status-badge sync-view__status-badge--${diff.status}`}
                                  >
                                    {diff.status === "in-sync" && "In Sync"}
                                    {diff.status === "different" && "Different"}
                                    {diff.status === "only-source" &&
                                      `Only on ${primaryNodeId}`}
                                    {diff.status === "only-target" &&
                                      `Only on ${secondaryId}`}
                                  </span>
                                  {diff.settingsDifferences &&
                                    diff.settingsDifferences.length > 0 && (
                                      <span className="sync-view__change-count-badge">
                                        {diff.settingsDifferences.length}{" "}
                                        setting
                                        {diff.settingsDifferences.length !== 1 ?
                                          "s"
                                        : ""}
                                      </span>
                                    )}
                                  {hasDetailedDiff && (
                                    <span className="sync-view__expand-icon">
                                      {isGroupExpanded ? "▼" : "▶"}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {diff.sourceStats && diff.targetStats && (
                                <div className="sync-view__diff-details">
                                  {(() => {
                                    const statFields: Array<{
                                      key: keyof NonNullable<
                                        typeof diff.sourceStats
                                      >;
                                      label: string;
                                    }> = [
                                      { key: "blocked", label: "blocked" },
                                      { key: "allowed", label: "allowed" },
                                      {
                                        key: "blockedRegex",
                                        label: "regex blocked",
                                      },
                                      {
                                        key: "allowedRegex",
                                        label: "regex allowed",
                                      },
                                      {
                                        key: "blockListUrls",
                                        label: "block URLs",
                                      },
                                      {
                                        key: "allowListUrls",
                                        label: "allow URLs",
                                      },
                                      {
                                        key: "regexBlockListUrls",
                                        label: "regex block URLs",
                                      },
                                      {
                                        key: "regexAllowListUrls",
                                        label: "regex allow URLs",
                                      },
                                      {
                                        key: "adblockListUrls",
                                        label: "adblock URLs",
                                      },
                                    ];
                                    const ss = diff.sourceStats!;
                                    const ts = diff.targetStats!;
                                    return (
                                      <>
                                        <div className="sync-view__diff-node">
                                          <strong>{primaryNodeId}:</strong>
                                          <div className="sync-view__stat-badges">
                                            {statFields.map(
                                              ({ key, label }) => {
                                                const count = ss[key];
                                                if (count === 0) return null;
                                                return (
                                                  <span
                                                    key={key}
                                                    className={`sync-view__stat-badge ${ss[key] === ts[key] ? "sync-view__stat-badge--match" : "sync-view__stat-badge--diff"}`}
                                                  >
                                                    {count} {label}
                                                  </span>
                                                );
                                              },
                                            )}
                                            {statFields.every(
                                              ({ key }) => ss[key] === 0,
                                            ) && (
                                              <span className="sync-view__diff-empty">
                                                empty
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="sync-view__diff-node">
                                          <strong>{secondaryId}:</strong>
                                          <div className="sync-view__stat-badges">
                                            {statFields.map(
                                              ({ key, label }) => {
                                                const count = ts[key];
                                                if (count === 0) return null;
                                                return (
                                                  <span
                                                    key={key}
                                                    className={`sync-view__stat-badge ${ss[key] === ts[key] ? "sync-view__stat-badge--match" : "sync-view__stat-badge--diff"}`}
                                                  >
                                                    {count} {label}
                                                  </span>
                                                );
                                              },
                                            )}
                                            {statFields.every(
                                              ({ key }) => ts[key] === 0,
                                            ) && (
                                              <span className="sync-view__diff-empty">
                                                empty
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              )}
                              {diff.sourceStats && !diff.targetStats && (
                                <div className="sync-view__diff-details">
                                  <div className="sync-view__diff-node">
                                    <strong>{primaryNodeId}:</strong>
                                    <div className="sync-view__stat-badges">
                                      <span className="sync-view__stat-badge sync-view__stat-badge--only">
                                        Only on {primaryNodeId}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {!diff.sourceStats && diff.targetStats && (
                                <div className="sync-view__diff-details">
                                  <div className="sync-view__diff-node">
                                    <strong>{secondaryId}:</strong>
                                    <div className="sync-view__stat-badges">
                                      <span className="sync-view__stat-badge sync-view__stat-badge--only">
                                        Only on {secondaryId}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {hasDetailedDiff &&
                                isGroupExpanded &&
                                diff.detailedDiff && (
                                  <div className="sync-view__detailed-diff">
                                    {Object.entries(diff.detailedDiff).map(
                                      ([category, domainDiff]) => {
                                        const hasChanges =
                                          domainDiff.added.length > 0 ||
                                          domainDiff.removed.length > 0 ||
                                          domainDiff.modified.length > 0;
                                        if (!hasChanges) return null;
                                        const categoryLabel =
                                          category === "blocked" ?
                                            "Blocked Domains"
                                          : category === "allowed" ?
                                            "Allowed Domains"
                                          : category === "blockedRegex" ?
                                            "Blocked Regex"
                                          : category === "allowedRegex" ?
                                            "Allowed Regex"
                                          : category === "blockListUrls" ?
                                            "Block List URLs"
                                          : category === "allowListUrls" ?
                                            "Allow List URLs"
                                          : category ===
                                              "regexBlockListUrls" ?
                                            "Regex Block List URLs"
                                          : category ===
                                              "regexAllowListUrls" ?
                                            "Regex Allow List URLs"
                                          : category === "adblockListUrls" ?
                                            "AdBlock List URLs"
                                          : category;
                                        return (
                                          <div
                                            key={category}
                                            className="sync-view__diff-category"
                                          >
                                            <h4 className="sync-view__diff-category-title">
                                              {categoryLabel}
                                            </h4>
                                            {domainDiff.added.length > 0 && (
                                              <div className="sync-view__diff-changes">
                                                <h5 className="sync-view__diff-changes-title sync-view__diff-changes-title--added">
                                                  + Will be added to{" "}
                                                  {secondaryId} (
                                                  {domainDiff.added.length})
                                                </h5>
                                                <ul className="sync-view__diff-list">
                                                  {domainDiff.added.map(
                                                    (d) => (
                                                      <li
                                                        key={d}
                                                        className="sync-view__diff-item sync-view__diff-item--added"
                                                      >
                                                        {d}
                                                      </li>
                                                    ),
                                                  )}
                                                </ul>
                                              </div>
                                            )}
                                            {domainDiff.removed.length > 0 && (
                                              <div className="sync-view__diff-changes">
                                                <h5 className="sync-view__diff-changes-title sync_view__diff-changes-title--removed">
                                                  - Will be removed from{" "}
                                                  {secondaryId} (
                                                  {domainDiff.removed.length})
                                                </h5>
                                                <ul className="sync-view__diff-list">
                                                  {domainDiff.removed.map(
                                                    (d) => (
                                                      <li
                                                        key={d}
                                                        className="sync-view__diff-item sync-view__diff-item--removed"
                                                      >
                                                        {d}
                                                      </li>
                                                    ),
                                                  )}
                                                </ul>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      },
                                    )}
                                  </div>
                                )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
      {/* Warning if nodes don't have Advanced Blocking */}
      {viewMode === "1-to-1" && (!sourceHasApp || !targetHasApp) && (
        <div className="sync-view__warning">
          <span className="sync-view__warning-icon">⚠️</span>
          <div className="sync-view__warning-content">
            <strong>Advanced Blocking App Required</strong>
            <p>
              {!sourceHasApp && !targetHasApp ?
                "Both nodes are missing the Advanced Blocking app."
              : !sourceHasApp ?
                `Source node (${sourceNodeId}) is missing the Advanced Blocking app.`
              : `Target node (${targetNodeId}) is missing the Advanced Blocking app.`
              }{" "}
              Sync operations are disabled until the app is installed on all
              nodes.
            </p>
          </div>
        </div>
      )}
      {/* Status Messages */}
      {error && (
        <div className="sync-view__error">
          <span className="status status--error">{error}</span>
        </div>
      )}
      {success && (
        <div className="sync-view__success">
          <span className="status status--success">{success}</span>
        </div>
      )}
      {/* Sync Summary (1:1 mode only) */}
      {viewMode === "1-to-1" && sourceNode && targetNode && (
        <>
          <div className="sync-view__summary">
            <div className="sync-view__summary-stat">
              <span className="sync-view__summary-icon sync-view__summary-icon--in-sync">
                ✓
              </span>
              <span className="sync-view__summary-count">
                {syncSummary.inSync}
              </span>
              <span className="sync-view__summary-label">In Sync</span>
            </div>
            <div className="sync-view__summary-stat">
              <span className="sync-view__summary-icon sync-view__summary-icon--different">
                ⚠
              </span>
              <span className="sync-view__summary-count">
                {syncSummary.different + syncSummary.configDiffsCount}
              </span>
              <span className="sync-view__summary-label">Different</span>
            </div>
            <div className="sync-view__summary-stat">
              <span className="sync-view__summary-icon sync-view__summary-icon--only-source">
                →
              </span>
              <span className="sync-view__summary-count">
                {syncSummary.onlySource}
              </span>
              <span className="sync-view__summary-label">
                Only on {sourceNodeId}
              </span>
            </div>
            <div className="sync-view__summary-stat">
              <span className="sync-view__summary-icon sync-view__summary-icon--only-target">
                ←
              </span>
              <span className="sync-view__summary-count">
                {syncSummary.onlyTarget}
              </span>
              <span className="sync-view__summary-label">
                Only on {targetNodeId}
              </span>
            </div>
          </div>

          {/* Sync Actions */}
          {(syncSummary.different > 0 ||
            syncSummary.onlySource > 0 ||
            syncSummary.onlyTarget > 0 ||
            configDifferences.hasDifferences) && (
            <div className="sync-view__actions">
              <button
                type="button"
                onClick={handleSyncSourceToTarget}
                className="button button--primary sync-view__sync-button"
                disabled={disabled || syncing || !canSync}
              >
                {syncing ?
                  "Syncing..."
                : `Sync ${sourceNodeId} → ${targetNodeId}`}
              </button>
              <button
                type="button"
                onClick={handleSyncTargetToSource}
                className="button button--secondary sync-view__sync-button"
                disabled={disabled || syncing || !canSync}
              >
                {syncing ?
                  "Syncing..."
                : `Sync ${targetNodeId} → ${sourceNodeId}`}
              </button>
            </div>
          )}

          {/* Group Diffs and Config-level Differences */}
          <div className="sync-view__diffs">
            {/* Config-level Differences (Client Mappings, Global Settings) */}
            {configDifferences.hasDifferences && (
              <div className="sync-view__diff sync-view__diff--different">
                <div className="sync-view__diff-header sync-view__diff-header--clickable">
                  <h3 className="sync-view__diff-title">
                    <span className="sync-view__status-icon sync-view__status-icon--different">
                      ⚠
                    </span>
                    Configuration Settings
                  </h3>
                  <div className="sync-view__diff-header-right">
                    <span className="sync-view__status-badge sync-view__status-badge--different">
                      Different
                    </span>
                  </div>
                </div>
                <div className="sync-view__diff-content">
                  <div className="sync-view__detailed-diff">
                    {/* Global Settings */}
                    {configDifferences.globalSettings.different.length > 0 && (
                      <div className="sync-view__diff-category">
                        <h4 className="sync-view__diff-category-title">
                          Global Settings
                        </h4>
                        <div className="sync-view__diff-changes">
                          <h5 className="sync-view__diff-changes-title sync-view__diff-changes-title--changed">
                            ≠ Different (
                            {configDifferences.globalSettings.different.length})
                          </h5>
                          <ul className="sync-view__diff-list">
                            {configDifferences.globalSettings.different.map(
                              (item) => (
                                <li
                                  key={item.field}
                                  className="sync-view__diff-item sync-view__diff-item--changed"
                                >
                                  <strong>
                                    {item.field === "enableBlocking" ?
                                      "Enable Blocking"
                                    : item.field === "blockingAnswerTtl" ?
                                      "Blocking Answer TTL"
                                    : "Update Interval"}
                                    :
                                  </strong>{" "}
                                  <span className="sync-view__diff-value sync-view__diff-value--source">
                                    {String(item.sourceValue ?? "not set")}
                                  </span>
                                  {" → "}
                                  <span className="sync-view__diff-value sync-view__diff-value--target">
                                    {String(item.targetValue ?? "not set")}
                                  </span>
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      </div>
                    )}

                    {/* Local Endpoint Mappings (Client Mappings) */}
                    {(configDifferences.localMappings.added.length > 0 ||
                      configDifferences.localMappings.removed.length > 0 ||
                      configDifferences.localMappings.changed.length > 0) && (
                      <div className="sync-view__diff-category">
                        <h4 className="sync-view__diff-category-title">
                          Client Mappings (Local Endpoints)
                        </h4>
                        {configDifferences.localMappings.added.length > 0 && (
                          <div className="sync-view__diff-changes">
                            <h5 className="sync-view__diff-changes-title sync-view__diff-changes-title--added">
                              + Added in {sourceNodeId} (
                              {configDifferences.localMappings.added.length})
                            </h5>
                            <ul className="sync-view__diff-list">
                              {configDifferences.localMappings.added.map(
                                (item) => (
                                  <li
                                    key={item.key}
                                    className="sync-view__diff-item sync-view__diff-item--added"
                                  >
                                    <strong>{item.key}</strong> → {item.value}
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        )}
                        {configDifferences.localMappings.removed.length > 0 && (
                          <div className="sync-view__diff-changes">
                            <h5 className="sync-view__diff-changes-title sync-view__diff-changes-title--removed">
                              - Removed from {sourceNodeId} (
                              {configDifferences.localMappings.removed.length})
                            </h5>
                            <ul className="sync-view__diff-list">
                              {configDifferences.localMappings.removed.map(
                                (item) => (
                                  <li
                                    key={item.key}
                                    className="sync-view__diff-item sync-view__diff-item--removed"
                                  >
                                    <strong>{item.key}</strong> → {item.value}
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        )}
                        {configDifferences.localMappings.changed.length > 0 && (
                          <div className="sync-view__diff-changes">
                            <h5 className="sync-view__diff-changes-title sync-view__diff-changes-title--changed">
                              ✎ Changed in {sourceNodeId} (
                              {configDifferences.localMappings.changed.length})
                            </h5>
                            <ul className="sync-view__diff-list">
                              {configDifferences.localMappings.changed.map(
                                (item) => (
                                  <li
                                    key={item.key}
                                    className="sync-view__diff-item sync-view__diff-item--changed"
                                  >
                                    <strong>{item.key}</strong>:{" "}
                                    <span className="sync-view__diff-old-value">
                                      {item.targetValue}
                                    </span>{" "}
                                    →{" "}
                                    <span className="sync-view__diff-new-value">
                                      {item.sourceValue}
                                    </span>
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Network Mappings */}
                    {(configDifferences.networkMappings.added.length > 0 ||
                      configDifferences.networkMappings.removed.length > 0 ||
                      configDifferences.networkMappings.changed.length > 0) && (
                      <div className="sync-view__diff-category">
                        <h4 className="sync-view__diff-category-title">
                          Network Mappings (CIDR Blocks)
                        </h4>
                        {configDifferences.networkMappings.added.length > 0 && (
                          <div className="sync-view__diff-changes">
                            <h5 className="sync-view__diff-changes-title sync-view__diff-changes-title--added">
                              + Added in {sourceNodeId} (
                              {configDifferences.networkMappings.added.length})
                            </h5>
                            <ul className="sync-view__diff-list">
                              {configDifferences.networkMappings.added.map(
                                (item) => (
                                  <li
                                    key={item.key}
                                    className="sync-view__diff-item sync-view__diff-item--added"
                                  >
                                    <strong>{item.key}</strong> → {item.value}
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        )}
                        {configDifferences.networkMappings.removed.length >
                          0 && (
                          <div className="sync-view__diff-changes">
                            <h5 className="sync-view__diff-changes-title sync-view__diff-changes-title--removed">
                              - Removed from {sourceNodeId} (
                              {configDifferences.networkMappings.removed.length}
                              )
                            </h5>
                            <ul className="sync-view__diff-list">
                              {configDifferences.networkMappings.removed.map(
                                (item) => (
                                  <li
                                    key={item.key}
                                    className="sync-view__diff-item sync-view__diff-item--removed"
                                  >
                                    <strong>{item.key}</strong> → {item.value}
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        )}
                        {configDifferences.networkMappings.changed.length >
                          0 && (
                          <div className="sync-view__diff-changes">
                            <h5 className="sync-view__diff-changes-title sync-view__diff-changes-title--changed">
                              ✎ Changed in {sourceNodeId} (
                              {configDifferences.networkMappings.changed.length}
                              )
                            </h5>
                            <ul className="sync-view__diff-list">
                              {configDifferences.networkMappings.changed.map(
                                (item) => (
                                  <li
                                    key={item.key}
                                    className="sync-view__diff-item sync-view__diff-item--changed"
                                  >
                                    <strong>{item.key}</strong>:{" "}
                                    <span className="sync-view__diff-old-value">
                                      {item.targetValue}
                                    </span>{" "}
                                    →{" "}
                                    <span className="sync-view__diff-new-value">
                                      {item.sourceValue}
                                    </span>
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Group Diffs */}
            {groupDiffs.map((diff) => {
              const isExpanded = expandedGroups.has(diff.name);
              const hasDetailedDiff =
                diff.detailedDiff && diff.status === "different";

              return (
                <div
                  key={diff.name}
                  className={`sync-view__diff sync-view__diff--${diff.status}`}
                >
                  <div
                    className={`sync-view__diff-header ${hasDetailedDiff ? "sync-view__diff-header--clickable" : ""}`}
                    onClick={() =>
                      hasDetailedDiff && toggleGroupExpanded(diff.name)
                    }
                    role={hasDetailedDiff ? "button" : undefined}
                    tabIndex={hasDetailedDiff ? 0 : undefined}
                  >
                    <h3 className="sync-view__diff-title">
                      <span
                        className={`sync-view__status-icon sync-view__status-icon--${diff.status}`}
                      >
                        {diff.status === "in-sync" && (
                          <FontAwesomeIcon icon={faCheck} />
                        )}
                        {diff.status === "different" && (
                          <FontAwesomeIcon icon={faExclamationTriangle} />
                        )}
                        {diff.status === "only-source" && "→"}
                        {diff.status === "only-target" && "←"}
                      </span>
                      {diff.name}
                    </h3>
                    <div className="sync-view__diff-header-right">
                      <span
                        className={`sync-view__status-badge sync-view__status-badge--${diff.status}`}
                      >
                        {diff.status === "in-sync" && "In Sync"}
                        {diff.status === "different" && "Different"}
                        {diff.status === "only-source" &&
                          `Only on ${sourceNodeId}`}
                        {diff.status === "only-target" &&
                          `Only on ${targetNodeId}`}
                      </span>
                      {diff.settingsDifferences &&
                        diff.settingsDifferences.length > 0 && (
                          <span className="sync-view__change-count-badge">
                            {diff.settingsDifferences.length} setting
                            {diff.settingsDifferences.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      {hasDetailedDiff && (
                        <span className="sync-view__expand-icon">
                          {isExpanded ? "▼" : "▶"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="sync-view__diff-details">
                    {diff.sourceStats &&
                      diff.targetStats &&
                      (() => {
                        const sourceStats = diff.sourceStats;
                        const targetStats = diff.targetStats;

                        const statFields: Array<{
                          key: keyof typeof sourceStats;
                          label: string;
                        }> = [
                          { key: "blocked", label: "blocked" },
                          { key: "allowed", label: "allowed" },
                          { key: "blockedRegex", label: "regex blocked" },
                          { key: "allowedRegex", label: "regex allowed" },
                          { key: "blockListUrls", label: "block URLs" },
                          { key: "allowListUrls", label: "allow URLs" },
                          {
                            key: "regexBlockListUrls",
                            label: "regex block URLs",
                          },
                          {
                            key: "regexAllowListUrls",
                            label: "regex allow URLs",
                          },
                          { key: "adblockListUrls", label: "adblock URLs" },
                        ];

                        return (
                          <>
                            <div className="sync-view__diff-node">
                              <strong>{sourceNodeId}:</strong>
                              <div className="sync-view__stat-badges">
                                {statFields.map(({ key, label }) => {
                                  const count = sourceStats[key];
                                  if (count === 0) return null;
                                  const matches =
                                    sourceStats[key] === targetStats[key];
                                  return (
                                    <span
                                      key={key}
                                      className={`sync-view__stat-badge ${matches ? "sync-view__stat-badge--match" : "sync-view__stat-badge--diff"}`}
                                    >
                                      {count} {label}
                                    </span>
                                  );
                                })}
                                {statFields.every(
                                  ({ key }) => sourceStats[key] === 0,
                                ) && (
                                  <span className="sync-view__diff-empty">
                                    empty
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="sync-view__diff-node">
                              <strong>{targetNodeId}:</strong>
                              <div className="sync-view__stat-badges">
                                {statFields.map(({ key, label }) => {
                                  const count = targetStats[key];
                                  if (count === 0) return null;
                                  const matches =
                                    sourceStats[key] === targetStats[key];
                                  return (
                                    <span
                                      key={key}
                                      className={`sync-view__stat-badge ${matches ? "sync-view__stat-badge--match" : "sync-view__stat-badge--diff"}`}
                                    >
                                      {count} {label}
                                    </span>
                                  );
                                })}
                                {statFields.every(
                                  ({ key }) => targetStats[key] === 0,
                                ) && (
                                  <span className="sync-view__diff-empty">
                                    empty
                                  </span>
                                )}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    {diff.sourceStats && !diff.targetStats && (
                      <div className="sync-view__diff-node">
                        <strong>{sourceNodeId}:</strong>
                        <div className="sync-view__stat-badges">
                          <span className="sync-view__stat-badge sync-view__stat-badge--only">
                            Only on {sourceNodeId}
                          </span>
                        </div>
                      </div>
                    )}
                    {!diff.sourceStats && diff.targetStats && (
                      <div className="sync-view__diff-node">
                        <strong>{targetNodeId}:</strong>
                        <div className="sync-view__stat-badges">
                          <span className="sync-view__stat-badge sync-view__stat-badge--only">
                            Only on {targetNodeId}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Expandable Detailed Diff */}
                  {hasDetailedDiff && isExpanded && diff.detailedDiff && (
                    <div className="sync-view__detailed-diff">
                      {/* Settings Differences */}
                      {diff.settingsDifferences &&
                        diff.settingsDifferences.length > 0 && (
                          <div className="sync-view__settings-diff">
                            <h4 className="sync-view__diff-category-title">
                              Settings Differences
                            </h4>
                            <div className="sync-view__diff-changes">
                              <div className="sync-view__settings-comparison">
                                <div className="sync-view__settings-node">
                                  <h5 className="sync-view__settings-node-title">
                                    {sourceNodeId}:
                                  </h5>
                                  <div className="sync-view__settings-list">
                                    {diff.settingsDifferences.map(
                                      (settingDiff, idx) => (
                                        <div
                                          key={idx}
                                          className="sync-view__setting-row"
                                        >
                                          <span className="sync-view__setting-label">
                                            {(
                                              settingDiff.field ===
                                              "enableBlocking"
                                            ) ?
                                              "Enable Blocking"
                                            : (
                                              settingDiff.field ===
                                              "blockAsNxDomain"
                                            ) ?
                                              "Respond with NXDOMAIN"
                                            : (
                                              settingDiff.field ===
                                              "allowTxtBlockingReport"
                                            ) ?
                                              "Allow TXT Blocking Report"
                                            : (
                                              settingDiff.field ===
                                              "blockingAddresses"
                                            ) ?
                                              "Blocking Addresses"
                                            : settingDiff.field}
                                          </span>
                                          <span className="sync-view__setting-value sync-view__setting-value--source">
                                            {(
                                              Array.isArray(
                                                settingDiff.sourceValue,
                                              )
                                            ) ?
                                              (
                                                settingDiff.sourceValue.length >
                                                0
                                              ) ?
                                                `[${settingDiff.sourceValue.join(", ")}]`
                                              : "[]"
                                            : String(settingDiff.sourceValue)}
                                          </span>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </div>
                                <div className="sync-view__settings-node">
                                  <h5 className="sync-view__settings-node-title">
                                    {targetNodeId}:
                                  </h5>
                                  <div className="sync-view__settings-list">
                                    {diff.settingsDifferences.map(
                                      (settingDiff, idx) => (
                                        <div
                                          key={idx}
                                          className="sync-view__setting-row"
                                        >
                                          <span className="sync-view__setting-label">
                                            {(
                                              settingDiff.field ===
                                              "enableBlocking"
                                            ) ?
                                              "Enable Blocking"
                                            : (
                                              settingDiff.field ===
                                              "blockAsNxDomain"
                                            ) ?
                                              "Respond with NXDOMAIN"
                                            : (
                                              settingDiff.field ===
                                              "allowTxtBlockingReport"
                                            ) ?
                                              "Allow TXT Blocking Report"
                                            : (
                                              settingDiff.field ===
                                              "blockingAddresses"
                                            ) ?
                                              "Blocking Addresses"
                                            : settingDiff.field}
                                          </span>
                                          <span className="sync-view__setting-value sync-view__setting-value--target">
                                            {(
                                              Array.isArray(
                                                settingDiff.targetValue,
                                              )
                                            ) ?
                                              (
                                                settingDiff.targetValue.length >
                                                0
                                              ) ?
                                                `[${settingDiff.targetValue.join(", ")}]`
                                              : "[]"
                                            : String(settingDiff.targetValue)}
                                          </span>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                      {Object.entries(diff.detailedDiff).map(
                        ([category, domainDiff]) => {
                          const hasChanges =
                            domainDiff.added.length > 0 ||
                            domainDiff.removed.length > 0 ||
                            domainDiff.modified.length > 0;
                          if (!hasChanges) return null;

                          const categoryLabel =
                            category === "blocked" ? "Blocked Domains"
                            : category === "allowed" ? "Allowed Domains"
                            : category === "blockedRegex" ? "Blocked Regex"
                            : category === "allowedRegex" ? "Allowed Regex"
                            : category === "blockListUrls" ? "Block List URLs"
                            : category === "allowListUrls" ? "Allow List URLs"
                            : category === "regexBlockListUrls" ?
                              "Regex Block List URLs"
                            : category === "regexAllowListUrls" ?
                              "Regex Allow List URLs"
                            : category === "adblockListUrls" ?
                              "AdBlock List URLs"
                            : category;

                          return (
                            <div
                              key={category}
                              className="sync-view__diff-category"
                            >
                              <h4 className="sync-view__diff-category-title">
                                {categoryLabel}
                              </h4>
                              {domainDiff.added.length > 0 && (
                                <div className="sync-view__diff-changes">
                                  <h5 className="sync-view__diff-changes-title sync-view__diff-changes-title--added">
                                    + Will be added to {targetNodeId} (
                                    {domainDiff.added.length})
                                  </h5>
                                  <ul className="sync-view__diff-list">
                                    {domainDiff.added.map((domain) => (
                                      <li
                                        key={domain}
                                        className="sync-view__diff-item sync-view__diff-item--added"
                                      >
                                        {/* <span className="sync-view__diff-prefix">
                                                                                +++
                                                                            </span> */}
                                        {domain}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {domainDiff.modified.length > 0 && (
                                <div className="sync-view__diff-changes">
                                  <h5 className="sync-view__diff-changes-title sync-view__diff-changes-title--modified">
                                    ~ Will be modified on {targetNodeId} (
                                    {domainDiff.modified.length})
                                  </h5>
                                  <ul className="sync-view__diff-list">
                                    {domainDiff.modified.map((change, idx) => (
                                      <li
                                        key={`${change.oldValue}-${idx}`}
                                        className="sync-view__diff-item sync-view__diff-item--modified"
                                      >
                                        <div className="sync-view__diff-modification">
                                          <div className="sync-view__diff-old-value">
                                            {change.oldValue}
                                          </div>
                                          <div className="sync-view__diff-arrow">
                                            →
                                          </div>
                                          <div className="sync-view__diff-new-value">
                                            {change.newValue}
                                          </div>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {domainDiff.removed.length > 0 && (
                                <div className="sync-view__diff-changes">
                                  <h5 className="sync-view__diff-changes-title sync_view__diff-changes-title--removed">
                                    - Will be removed from {targetNodeId} (
                                    {domainDiff.removed.length})
                                  </h5>
                                  <ul className="sync-view__diff-list">
                                    {domainDiff.removed.map((domain) => (
                                      <li
                                        key={domain}
                                        className="sync-view__diff-item sync-view__diff-item--removed"
                                      >
                                        {/* <span className="sync-view__diff-prefix">
                                                                                ---
                                                                            </span> */}
                                        {domain}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {/* Confirmation Modal */}
      {syncPreview && (
        <div className="sync-view__dialog-overlay" onClick={cancelSync}>
          <div
            className="sync-view__dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="sync-view__dialog-title">⚠️ Confirm Sync</h3>
            <div className="sync-view__dialog-content">
              <p className="sync-view__dialog-message">
                This sync will make <strong>{syncPreview.totalRemovals}</strong>{" "}
                removal
                {syncPreview.totalRemovals !== 1 ? "s" : ""} and{" "}
                <strong>{syncPreview.totalAdditions}</strong> addition
                {syncPreview.totalAdditions !== 1 ? "s" : ""} to groups.
              </p>
              <p className="sync-view__dialog-message">
                <strong>Direction:</strong>{" "}
                {syncPreview.direction === "source-to-target" ?
                  `${sourceNodeId} → ${targetNodeId}`
                : `${targetNodeId} → ${sourceNodeId}`}
              </p>

              {/* Configuration Changes */}
              {syncPreview.configChanges && (
                <div className="sync-view__dialog-warning">
                  <p className="sync-view__dialog-label">
                    <strong>⚙️ Configuration Changes:</strong>
                  </p>
                  {(syncPreview.configChanges.localMappingsAdded > 0 ||
                    syncPreview.configChanges.localMappingsRemoved > 0 ||
                    syncPreview.configChanges.localMappingsChanged > 0) && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                        Client Mappings:
                      </p>
                      <ul
                        style={{ margin: "0.25rem 0", paddingLeft: "1.5rem" }}
                      >
                        {syncPreview.configChanges.localMappingsAdded > 0 && (
                          <li>
                            <strong>
                              {syncPreview.configChanges.localMappingsAdded}
                            </strong>{" "}
                            added
                          </li>
                        )}
                        {syncPreview.configChanges.localMappingsRemoved > 0 && (
                          <li>
                            <strong>
                              {syncPreview.configChanges.localMappingsRemoved}
                            </strong>{" "}
                            removed
                          </li>
                        )}
                        {syncPreview.configChanges.localMappingsChanged > 0 && (
                          <li>
                            <strong>
                              {syncPreview.configChanges.localMappingsChanged}
                            </strong>{" "}
                            changed
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                  {(syncPreview.configChanges.networkMappingsAdded > 0 ||
                    syncPreview.configChanges.networkMappingsRemoved > 0 ||
                    syncPreview.configChanges.networkMappingsChanged > 0) && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
                        Network Mappings:
                      </p>
                      <ul
                        style={{ margin: "0.25rem 0", paddingLeft: "1.5rem" }}
                      >
                        {syncPreview.configChanges.networkMappingsAdded > 0 && (
                          <li>
                            <strong>
                              {syncPreview.configChanges.networkMappingsAdded}
                            </strong>{" "}
                            added
                          </li>
                        )}
                        {syncPreview.configChanges.networkMappingsRemoved >
                          0 && (
                          <li>
                            <strong>
                              {syncPreview.configChanges.networkMappingsRemoved}
                            </strong>{" "}
                            removed
                          </li>
                        )}
                        {syncPreview.configChanges.networkMappingsChanged >
                          0 && (
                          <li>
                            <strong>
                              {syncPreview.configChanges.networkMappingsChanged}
                            </strong>{" "}
                            changed
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Groups to be Deleted Warning */}
              {syncPreview.groupsToBeDeleted.length > 0 && (
                <div className="sync-view__dialog-danger">
                  <p className="sync-view__dialog-danger-title">
                    🗑️{" "}
                    <strong>
                      Groups to be Deleted (
                      {syncPreview.groupsToBeDeleted.length}):
                    </strong>
                  </p>
                  <p className="sync-view__dialog-danger-message">
                    The following groups exist only on the target node and will
                    be <strong>permanently deleted</strong>:
                  </p>
                  <ul className="sync-view__dialog-danger-list">
                    {syncPreview.groupsToBeDeleted.map((groupName) => (
                      <li key={groupName}>
                        <strong>{groupName}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="sync-view__dialog-affected">
                <p className="sync-view__dialog-label">
                  <strong>
                    All Affected Groups ({syncPreview.affectedGroups.length}):
                  </strong>
                </p>
                <ul className="sync-view__dialog-group-list">
                  {syncPreview.affectedGroups.map((groupName) => {
                    const willBeDeleted =
                      syncPreview.groupsToBeDeleted.includes(groupName);
                    return (
                      <li
                        key={groupName}
                        className={
                          willBeDeleted ? "sync-view__dialog-group--danger" : ""
                        }
                      >
                        {willBeDeleted && (
                          <>
                            <FontAwesomeIcon icon={faTrash} />{" "}
                          </>
                        )}
                        {groupName}
                      </li>
                    );
                  })}
                </ul>
              </div>
              <p className="sync-view__dialog-warning">
                ⚠️ This action cannot be undone. Are you sure you want to
                continue?
              </p>
            </div>
            <div className="sync-view__dialog-actions">
              <button
                type="button"
                onClick={cancelSync}
                className="button button--secondary"
                disabled={syncing}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSync}
                className="button button--danger"
                disabled={syncing}
              >
                {syncing ? "Syncing..." : "Confirm Sync"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* P+S Confirmation Modal */}
      {psSyncPending && (
        <div className="sync-view__dialog-overlay" onClick={cancelPsSync}>
          <div
            className="sync-view__dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="sync-view__dialog-title">⚠️ Confirm Sync</h3>
            <div className="sync-view__dialog-content">
              <p className="sync-view__dialog-message">
                This sync will make{" "}
                <strong>{psSyncPending.preview.totalRemovals}</strong> removal
                {psSyncPending.preview.totalRemovals !== 1 ? "s" : ""} and{" "}
                <strong>{psSyncPending.preview.totalAdditions}</strong> addition
                {psSyncPending.preview.totalAdditions !== 1 ? "s" : ""}.
              </p>
              <p className="sync-view__dialog-message">
                <strong>Direction:</strong>{" "}
                {psSyncPending.type === "single" ?
                  `${primaryNodeId} → ${psSyncPending.secondaryId}`
                : `${primaryNodeId} → ${psSyncPending.secondaryIds.length} secondar${psSyncPending.secondaryIds.length === 1 ? "y" : "ies"}`}
              </p>
              {psSyncPending.preview.groupsToBeDeleted.length > 0 && (
                <div className="sync-view__dialog-danger">
                  <p className="sync-view__dialog-danger-title">
                    🗑️{" "}
                    <strong>
                      Groups to be Deleted (
                      {psSyncPending.preview.groupsToBeDeleted.length}):
                    </strong>
                  </p>
                  <p className="sync-view__dialog-danger-message">
                    The following groups exist only on the secondary node(s) and
                    will be <strong>permanently deleted</strong>:
                  </p>
                  <ul className="sync-view__dialog-danger-list">
                    {psSyncPending.preview.groupsToBeDeleted.map((g) => (
                      <li key={g}>
                        <strong>{g}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="sync-view__dialog-warning">
                ⚠️ This action cannot be undone. Are you sure you want to
                continue?
              </p>
            </div>
            <div className="sync-view__dialog-actions">
              <button
                type="button"
                onClick={cancelPsSync}
                className="button button--secondary"
                disabled={syncing}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmPsSync}
                className="button button--danger"
                disabled={syncing}
              >
                {syncing ? "Syncing..." : "Confirm Sync"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
