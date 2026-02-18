import { faClockRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfigSnapshotDrawer } from "../components/configuration/ConfigSnapshotDrawer";
import { apiFetch } from "../config";
import { useTechnitiumState } from "../context/useTechnitiumState";
import { useToast } from "../context/useToast";
import { useIsClusterEnabled, usePrimaryNode } from "../hooks/usePrimaryNode";

type TargetList = "allowedRegex" | "blockedRegex";

type SuggestionKind =
  | "SAFE_TO_ZONE_DOMAIN_ENTRY"
  | "LIKELY_TO_ZONE_DOMAIN_ENTRY_EXPANDS_SCOPE"
  | "MANUAL_REVIEW_ZONE_CANDIDATE"
  | "PERF_WARNING";

type SuggestionConfidence = "safe" | "likely" | "warning";
type SuggestionTab = "all" | SuggestionConfidence;
type RuleTypeTab = "both" | "allow" | "block";

type Suggestion = {
  id: string;
  nodeId: string;
  groupName: string;
  targetList: TargetList;
  kind: SuggestionKind;
  title: string;
  summary: string;
  regexPattern: string;
  proposedDomainEntry?: string;
  scopeExpansionRisk: boolean;
  details: string[];
  perfScore?: number;
  confidence: SuggestionConfidence;
};

type RegexEntryCardModel = {
  key: string;
  primarySuggestionId: string;
  representativeGroupName: string;
  targetList: TargetList;
  kind: SuggestionKind;
  title: string;
  summary: string;
  regexPattern: string;
  proposedDomainEntry?: string;
  scopeExpansionRisk: boolean;
  details: string[];
  perfScore?: number;
  confidence: SuggestionConfidence;
  groupNames: string[];
};

type SuggestionsResponse = {
  fetchedAt: string;
  nodeId: string;
  groupName: string;
  suggestions: Suggestion[];
};

type ValidationResponse = {
  enabled: boolean;
  windowHours: number;
  limit: number;
  distinctDomainsAnalyzed: number;
  proposedDomainEntry: string;
  additionalMatchedDomainsCount: number;
  additionalMatchedDomainsExamples: Array<{ domain: string; count: number }>;
  note: string;
};

type ApplyResponse = {
  snapshotTaken?: {
    id: string;
    createdAt: string;
    method: "rule-optimizer";
    note?: string;
  };
  updated: unknown;
  applied: {
    groupName: string;
    targetList: TargetList;
    removedRegexPattern: string;
    addedDomainEntry: string;
  };
};

type RedundancySummary = {
  selectedCount: number;
  coveredCount: number;
  allCovered: boolean;
  exampleCoveringEntry?: string;
};

type PendingApply = {
  card: RegexEntryCardModel;
  selectedGroups: string[];
  redundancy?: RedundancySummary;
};

type ApplyVerification = {
  cardKey: string;
  selectedCount: number;
  appliedCount: number;
  failedGroups: string[];
  snapshotId?: string;
};

function encodePathParam(value: string): string {
  // Node IDs are typically safe, but group names can contain spaces.
  return encodeURIComponent(value);
}

function classNames(
  ...parts: Array<string | null | undefined | false>
): string {
  return parts.filter(Boolean).join(" ");
}

function selectedGroupsLabel(count: number): string {
  return `selected group${count === 1 ? "" : "s"}`;
}

function normalizeDomainEntry(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

function findCoveringDomainEntry(
  proposedDomainEntry: string,
  existingEntries: string[],
): string | undefined {
  const proposed = normalizeDomainEntry(proposedDomainEntry);
  if (!proposed) return undefined;

  let bestMatch: string | undefined;

  for (const rawEntry of existingEntries) {
    const entry = normalizeDomainEntry(rawEntry);
    if (!entry) continue;

    const isMatch = proposed === entry || proposed.endsWith(`.${entry}`);
    if (!isMatch) continue;

    if (!bestMatch || entry.length < bestMatch.length) {
      bestMatch = entry;
    }
  }

  return bestMatch;
}
const confidenceRank = (c: SuggestionConfidence): number =>
  c === "safe" ? 0
  : c === "likely" ? 1
  : 2;

const PERF_SCORE_MIN = 0;
const PERF_SCORE_MAX = 18;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const getPerfToneColor = (score: number): string => {
  const normalized =
    (clamp(score, PERF_SCORE_MIN, PERF_SCORE_MAX) - PERF_SCORE_MIN) /
    (PERF_SCORE_MAX - PERF_SCORE_MIN);

  if (normalized <= 0.5) {
    const warningPercent = Math.round((normalized / 0.5) * 100);
    const successPercent = 100 - warningPercent;
    return `color-mix(in srgb, var(--color-success) ${successPercent}%, var(--color-warning) ${warningPercent}%)`;
  }

  const dangerPercent = Math.round(((normalized - 0.5) / 0.5) * 100);
  const warningPercent = 100 - dangerPercent;
  return `color-mix(in srgb, var(--color-warning) ${warningPercent}%, var(--color-danger) ${dangerPercent}%)`;
};

const getPerfBadgeStyle = (score: number): React.CSSProperties => {
  const tempColor = getPerfToneColor(score);

  return {
    border: `1px solid ${tempColor}`,
    background: `color-mix(in srgb, ${tempColor} 18%, var(--color-bg-secondary) 82%)`,
    color: tempColor,
  };
};

const canAutoApplyCard = (card: RegexEntryCardModel): boolean =>
  card.kind !== "MANUAL_REVIEW_ZONE_CANDIDATE" &&
  card.kind !== "PERF_WARNING" &&
  Boolean(card.proposedDomainEntry);

const sortSuggestions = (a: Suggestion, b: Suggestion): number => {
  const ra = confidenceRank(a.confidence);
  const rb = confidenceRank(b.confidence);
  if (ra !== rb) return ra - rb;

  const pa = a.perfScore ?? 0;
  const pb = b.perfScore ?? 0;
  if (pa !== pb) return pb - pa;

  if (a.targetList !== b.targetList) {
    return a.targetList.localeCompare(b.targetList);
  }

  return a.regexPattern.localeCompare(b.regexPattern);
};

const toRegexEntryCards = (
  suggestions: Suggestion[],
): RegexEntryCardModel[] => {
  const byKey = new Map<string, RegexEntryCardModel>();

  for (const suggestion of suggestions) {
    const key = `${suggestion.targetList}::${suggestion.regexPattern}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        key,
        primarySuggestionId: suggestion.id,
        representativeGroupName: suggestion.groupName,
        targetList: suggestion.targetList,
        kind: suggestion.kind,
        title: suggestion.title,
        summary: suggestion.summary,
        regexPattern: suggestion.regexPattern,
        proposedDomainEntry: suggestion.proposedDomainEntry,
        scopeExpansionRisk: suggestion.scopeExpansionRisk,
        details: suggestion.details,
        perfScore: suggestion.perfScore,
        confidence: suggestion.confidence,
        groupNames: [suggestion.groupName],
      });
      continue;
    }

    if (!existing.groupNames.includes(suggestion.groupName)) {
      existing.groupNames = [...existing.groupNames, suggestion.groupName].sort(
        (a, b) => a.localeCompare(b),
      );
    }

    const suggestionConfidence = confidenceRank(suggestion.confidence);
    const existingConfidence = confidenceRank(existing.confidence);
    const suggestionPerf = suggestion.perfScore ?? 0;
    const existingPerf = existing.perfScore ?? 0;
    const shouldPromote =
      suggestionConfidence < existingConfidence ||
      (suggestionConfidence === existingConfidence &&
        suggestionPerf > existingPerf);

    if (shouldPromote) {
      existing.primarySuggestionId = suggestion.id;
      existing.representativeGroupName = suggestion.groupName;
      existing.kind = suggestion.kind;
      existing.title = suggestion.title;
      existing.summary = suggestion.summary;
      existing.proposedDomainEntry = suggestion.proposedDomainEntry;
      existing.scopeExpansionRisk = suggestion.scopeExpansionRisk;
      existing.details = suggestion.details;
      existing.perfScore = suggestion.perfScore;
      existing.confidence = suggestion.confidence;
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const ra = confidenceRank(a.confidence);
    const rb = confidenceRank(b.confidence);
    if (ra !== rb) return ra - rb;

    const pa = a.perfScore ?? 0;
    const pb = b.perfScore ?? 0;
    if (pa !== pb) return pb - pa;

    if (a.targetList !== b.targetList) {
      return a.targetList.localeCompare(b.targetList);
    }

    return a.regexPattern.localeCompare(b.regexPattern);
  });
};

function Badge({
  variant,
  children,
}: {
  variant: "safe" | "likely" | "warning" | "info" | "muted";
  children: string;
}) {
  const base = "badge";
  const styles =
    variant === "safe" ? "badge--success"
    : variant === "likely" ? "badge--warning"
    : variant === "warning" ? "badge--error"
    : variant === "muted" ? "badge--muted"
    : "badge--info";

  return (
    <span
      className={classNames(base, styles)}
      style={{ marginRight: "0.5rem", marginBottom: "0.25rem" }}
    >
      {children}
    </span>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="app-card">
      <div className="mb-4">
        <h2 className="app-card__title">{title}</h2>
        {subtitle ?
          <p className="app-card__subtitle">{subtitle}</p>
        : null}
      </div>
      {children}
    </section>
  );
}

function RegexEntryCard({
  card,
  selectedGroups,
  redundancy,
  onToggleGroup,
  onValidate,
  validating,
}: {
  card: RegexEntryCardModel;
  selectedGroups: string[];
  redundancy?: RedundancySummary;
  onToggleGroup: (cardKey: string, groupName: string) => void;
  onValidate: (card: RegexEntryCardModel) => void;
  validating: boolean;
}) {
  const confidenceLabel =
    card.confidence === "safe" ? "Safe"
    : card.confidence === "likely" ? "Likely"
    : "Warning";

  const confidenceVariant =
    card.confidence === "safe" ? "safe"
    : card.confidence === "likely" ? "likely"
    : "warning";

  const isBlockRegex = card.targetList === "blockedRegex";

  const kindLabel =
    card.kind === "SAFE_TO_ZONE_DOMAIN_ENTRY" ? "Replace regex → domain"
    : card.kind === "LIKELY_TO_ZONE_DOMAIN_ENTRY_EXPANDS_SCOPE" ?
      "Replace regex → domain (expands scope)"
    : card.kind === "MANUAL_REVIEW_ZONE_CANDIDATE" ? "Manual review candidate"
    : "Perf warning";

  const conversionLabel =
    isBlockRegex ?
      "⛔ BLOCK REGEX → BLOCK DOMAIN"
    : "✅ ALLOW REGEX → ALLOW DOMAIN";

  const conversionVariant: "safe" | "warning" =
    isBlockRegex ? "warning" : "safe";

  const cardAccentClass =
    isBlockRegex ?
      "border-l-4 border-l-red-500 dark:border-l-red-400"
    : "border-l-4 border-l-green-500 dark:border-l-green-400";
  const cardBackground =
    isBlockRegex ?
      "linear-gradient(180deg, var(--color-danger-bg) 0%, var(--color-bg-secondary) 26%, var(--color-bg-secondary) 100%)"
    : "linear-gradient(180deg, var(--color-success-bg) 0%, var(--color-bg-secondary) 26%, var(--color-bg-secondary) 100%)";
  const toneAccent =
    isBlockRegex ? "var(--color-danger)" : "var(--color-success)";
  const perfBadgeStyle =
    typeof card.perfScore === "number" ?
      getPerfBadgeStyle(card.perfScore)
    : undefined;
  const detailPanelStyle: React.CSSProperties = {
    background: "var(--color-bg-tertiary)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.75rem",
    padding: "0.875rem 1rem",
  };

  const hasSelectedGroups = selectedGroups.length > 0;
  const canAutoApply = canAutoApplyCard(card);
  const isRedundantCleanup = Boolean(redundancy?.allCovered);

  return (
    <article
      className={classNames(
        "app-card relative overflow-hidden border-2 border-gray-200 dark:border-gray-700 shadow-sm",
        cardAccentClass,
      )}
      style={{ background: cardBackground }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-1"
        style={{ background: toneAccent }}
      />

      <div className="relative z-10 flex flex-col gap-2 md:flex-row md:items-start md:justify-between border-b border-gray-200 dark:border-gray-700 pb-3 mb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-1">
            <Badge variant={confidenceVariant}>{confidenceLabel}</Badge>
            <Badge variant={conversionVariant}>{conversionLabel}</Badge>
            <Badge variant="muted">{kindLabel}</Badge>
          </div>

          <h3 className="app-card__subheading">{card.title}</h3>

          <p className="app-card__text">{card.summary}</p>
        </div>

        <div className="rule-optimizer-card__preview-actions flex flex-col gap-2">
          <button
            type="button"
            className={classNames(
              "button secondary",
              validating ? "opacity-60 cursor-not-allowed" : "",
            )}
            onClick={() => onValidate(card)}
            disabled={
              validating || !card.proposedDomainEntry || !hasSelectedGroups
            }
            title={
              !hasSelectedGroups ?
                "Select at least one group on this regex entry"
              : card.proposedDomainEntry ?
                "Preview impact using stored query logs (SQLite), if enabled"
              : "No proposed domain entry for this suggestion"
            }
          >
            {validating ? "Previewing..." : "Preview impact"}
          </button>

          {canAutoApply ?
            <span className="rule-optimizer-card__preview-note text-xs text-gray-500 dark:text-gray-400">
              {isRedundantCleanup ?
                <>
                  <strong>Remove redundant regex</strong> is available from{" "}
                  <strong>Preview impact</strong>.
                </>
              : <>
                  Apply change is available from <strong>Preview impact</strong>
                  .
                </>
              }
            </span>
          : null}
        </div>
      </div>

      <div className="relative z-10 mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div style={detailPanelStyle}>
          <div className="app-card__label">Regex pattern</div>
          <div className="app-card__code">{card.regexPattern}</div>
        </div>

        <div style={detailPanelStyle}>
          <div className="app-card__label">Proposed inline domain entry</div>
          <div className="app-card__code">
            {card.proposedDomainEntry ?? "—"}
          </div>
          {card.scopeExpansionRisk ?
            <div className="app-callout app-callout--warning">
              <strong>Note:</strong> Advanced Blocking inline domains are zone
              rules (match subdomains). This change may expand scope.
            </div>
          : null}
          {redundancy && redundancy.coveredCount > 0 ?
            <div className="app-callout app-callout--warning mt-3">
              <strong>Coverage notice:</strong>{" "}
              {redundancy.allCovered ?
                `Proposed domain is already covered by existing ${card.targetList === "allowedRegex" ? "allow" : "block"} domain entry${redundancy.exampleCoveringEntry ? ` "${redundancy.exampleCoveringEntry}"` : ""} in all selected groups. This is a redundant-regex cleanup.`
              : `Proposed domain is already covered in ${redundancy.coveredCount}/${redundancy.selectedCount} ${selectedGroupsLabel(redundancy.selectedCount)}${redundancy.exampleCoveringEntry ? ` (for example "${redundancy.exampleCoveringEntry}")` : ""}.`
              }
            </div>
          : null}
        </div>
      </div>

      <div className="relative z-10 mt-3" style={detailPanelStyle}>
        <div className="app-card__label">Affected groups</div>
        <div className="rule-optimizer-group-pills">
          {card.groupNames.map((groupName) => {
            const checked = selectedGroups.includes(groupName);
            return (
              <label
                key={`${card.key}-${groupName}`}
                className={classNames(
                  "rule-optimizer-group-pill",
                  checked && "rule-optimizer-group-pill--selected",
                )}
              >
                <input
                  className="rule-optimizer-group-pill__checkbox"
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleGroup(card.key, groupName)}
                />
                <span className="rule-optimizer-group-pill__label">
                  {groupName}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {card.details?.length ?
        <details className="relative z-10 mt-3">
          <summary className="cursor-pointer text-sm text-gray-700 dark:text-gray-200">
            Details
          </summary>
          <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1">
            {card.details.map((d, idx) => (
              <li key={idx}>{d}</li>
            ))}
          </ul>
        </details>
      : null}

      {typeof card.perfScore === "number" ?
        <div className="relative z-10 mt-3">
          <span
            className="badge"
            style={{
              ...perfBadgeStyle,
              marginRight: "0.5rem",
              marginBottom: "0.25rem",
            }}
            title={`Perf impact ${card.perfScore} (0 = least impact, 18 = most impact)`}
          >
            Performance impact:{" "}
            <span className="font-mono">{card.perfScore}</span> / 18
          </span>
        </div>
      : null}
    </article>
  );
}

function ValidationPanel({ result }: { result: ValidationResponse }) {
  return (
    <div className="app-card">
      <div>
        <h3 className="app-card__subheading">Impact preview report</h3>
        <p className="app-card__text">{result.note}</p>
      </div>

      <div className="rule-optimizer-impact-metrics">
        <div className="rule-optimizer-impact-metric">
          <div className="rule-optimizer-impact-metric__label">Window</div>
          <div className="rule-optimizer-impact-metric__value">
            Last <span className="app-code-inline">{result.windowHours}</span>{" "}
            hours
          </div>
        </div>

        <div className="rule-optimizer-impact-metric">
          <div className="rule-optimizer-impact-metric__label">
            Domains analyzed
          </div>
          <div className="rule-optimizer-impact-metric__value">
            <span className="app-code-inline">
              {result.distinctDomainsAnalyzed}
            </span>
          </div>
        </div>

        <div className="rule-optimizer-impact-metric">
          <div className="rule-optimizer-impact-metric__label">
            Additional subdomains matched
          </div>
          <div className="rule-optimizer-impact-metric__value">
            <span className="app-code-inline">
              {result.additionalMatchedDomainsCount}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="app-card__label">Proposed domain entry</div>
        <div className="app-card__code">{result.proposedDomainEntry}</div>
      </div>

      {!result.enabled ?
        <div className="app-callout app-callout--warning mt-4">
          Impact preview safety checks are unavailable because stored query logs
          (SQLite) are not enabled/ready. You can still apply this suggestion,
          but enable SQLite query log storage to get full preview capability.
        </div>
      : null}

      {result.enabled ?
        <div className="mt-4">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Examples (top{" "}
            {Math.min(50, result.additionalMatchedDomainsExamples.length)})
          </div>
          {result.additionalMatchedDomainsExamples.length === 0 ?
            <p className="app-card__text">
              No additional subdomains found in the analyzed window.
            </p>
          : <div className="app-table">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col">Domain</th>
                    <th scope="col" className="text-right">
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.additionalMatchedDomainsExamples.map((row) => (
                    <tr key={row.domain} className="">
                      <td className="app-table__code-cell">{row.domain}</td>
                      <td className="text-right">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        </div>
      : null}
    </div>
  );
}

export default function AdvancedBlockingRuleOptimizerPage() {
  const {
    nodes,
    blockingStatus,
    listConfigSnapshots,
    createConfigSnapshot,
    restoreConfigSnapshot,
    setConfigSnapshotPinned,
    getConfigSnapshot,
    deleteConfigSnapshot,
    updateConfigSnapshotNote,
  } = useTechnitiumState();
  const { pushToast } = useToast();

  const [nodeId, setNodeId] = useState<string>("");
  const [ruleOptimizerHistoryOpen, setRuleOptimizerHistoryOpen] =
    useState(false);

  const [loadingGroups, setLoadingGroups] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [groupInlineDomains, setGroupInlineDomains] = useState<
    Record<string, { allowed: string[]; blocked: string[] }>
  >({});
  const [groupFilter, setGroupFilter] = useState<string>("all");

  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionTab, setSuggestionTab] = useState<SuggestionTab>("all");
  const [ruleTypeTab, setRuleTypeTab] = useState<RuleTypeTab>("both");
  const [selectedGroupsByCard, setSelectedGroupsByCard] = useState<
    Record<string, string[]>
  >({});

  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validationCard, setValidationCard] =
    useState<RegexEntryCardModel | null>(null);
  const [validatingCardKey, setValidatingCardKey] = useState<string | null>(
    null,
  );

  const [applyingCardKey, setApplyingCardKey] = useState<string | null>(null);
  const [pendingApply, setPendingApply] = useState<PendingApply | null>(null);
  const [applyVerification, setApplyVerification] =
    useState<ApplyVerification | null>(null);

  const closeImpactModal = useCallback(() => {
    setValidation(null);
    setValidationCard(null);
  }, []);

  const closeApplyConfirmModal = useCallback(() => {
    setPendingApply(null);
    setApplyVerification(null);
  }, []);

  const hasOpenModal = Boolean(validation) || Boolean(pendingApply);

  useEffect(() => {
    if (!hasOpenModal) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pendingApply) {
          closeApplyConfirmModal();
          return;
        }

        if (validation) {
          closeImpactModal();
        }
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [
    closeApplyConfirmModal,
    closeImpactModal,
    hasOpenModal,
    pendingApply,
    validation,
  ]);

  const validationCardSelectedGroups = useMemo(() => {
    if (!validationCard) return [] as string[];
    return (
      selectedGroupsByCard[validationCard.key] ?? validationCard.groupNames
    ).filter((groupName) => validationCard.groupNames.includes(groupName));
  }, [validationCard, selectedGroupsByCard]);

  const allNodes = useMemo(() => nodes ?? [], [nodes]);
  const primaryNode = usePrimaryNode(allNodes);
  const isClusterEnabled = useIsClusterEnabled(allNodes);
  const lockToPrimary = isClusterEnabled && Boolean(primaryNode?.id);

  const nodeOptions = useMemo(() => {
    return allNodes.map(
      (n: { id: string; name?: string; isPrimary?: boolean }) => ({
        id: n.id,
        name: n.name ?? n.id,
        isPrimary: n.isPrimary,
      }),
    );
  }, [allNodes]);

  const effectiveNodeId =
    lockToPrimary ?
      (primaryNode?.id ?? "")
    : nodeId || nodeOptions[0]?.id || "";

  const selectedNodeName = useMemo(() => {
    if (!effectiveNodeId) return undefined;
    const node = allNodes.find((n) => n.id === effectiveNodeId);
    return node?.name;
  }, [allNodes, effectiveNodeId]);

  const advancedBlockingInstalledByNodeId = useMemo(() => {
    const map = new Map<string, boolean>();
    blockingStatus?.nodes?.forEach((nodeStatus) => {
      map.set(nodeStatus.nodeId, nodeStatus.advancedBlockingInstalled);
    });
    return map;
  }, [blockingStatus]);

  const isEffectiveNodeAdvancedBlockingCapable = useMemo(() => {
    const installedFromStatus =
      advancedBlockingInstalledByNodeId.get(effectiveNodeId);
    if (installedFromStatus !== undefined) {
      return installedFromStatus;
    }

    const node = allNodes.find((n) => n.id === effectiveNodeId);
    return node?.hasAdvancedBlocking === true;
  }, [advancedBlockingInstalledByNodeId, allNodes, effectiveNodeId]);

  const canOpenRuleOptimizerHistory =
    Boolean(effectiveNodeId) && isEffectiveNodeAdvancedBlockingCapable;

  const ruleOptimizerHistoryPullTitle =
    !effectiveNodeId ? "Select a node"
    : !isEffectiveNodeAdvancedBlockingCapable ?
      "Advanced Blocking app not installed on this node"
    : "";

  const handleOpenRuleOptimizerHistory = useCallback(() => {
    if (canOpenRuleOptimizerHistory) {
      setRuleOptimizerHistoryOpen(true);
      return;
    }

    const message =
      ruleOptimizerHistoryPullTitle ||
      "Select a node to view DNS Rule Optimizer history.";
    pushToast({ message, tone: "info", timeout: 5000 });
  }, [canOpenRuleOptimizerHistory, ruleOptimizerHistoryPullTitle, pushToast]);

  const loadSuggestionsForGroups = useCallback(
    async (
      currentNodeId: string,
      groupNames: string[],
    ): Promise<Suggestion[]> => {
      if (!currentNodeId || groupNames.length === 0) {
        return [];
      }

      const payloads = await Promise.all(
        groupNames.map(async (groupName) => {
          const response = await apiFetch(
            `/advanced-blocking/${encodePathParam(
              currentNodeId,
            )}/rule-optimizations/groups/${encodePathParam(groupName)}/suggestions`,
          );

          if (!response.ok) {
            throw new Error(
              `Failed to load suggestions for group "${groupName}" (${response.status})`,
            );
          }

          return (await response.json()) as SuggestionsResponse;
        }),
      );

      const merged = payloads.flatMap((payload) => payload?.suggestions ?? []);
      return [...merged].sort(sortSuggestions);
    },
    [],
  );

  // Load groups from Advanced Blocking snapshot
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!effectiveNodeId) return;
      setLoadingGroups(true);
      setGroupsError(null);
      setGroups([]);
      setGroupFilter("all");
      setSelectedGroupsByCard({});

      try {
        const response = await apiFetch(
          `/advanced-blocking/${encodePathParam(effectiveNodeId)}`,
        );
        if (!response.ok) {
          throw new Error(
            `Failed to load Advanced Blocking config (${response.status})`,
          );
        }

        const res = (await response.json()) as {
          config?: {
            groups?: Array<{
              name?: string;
              allowed?: string[];
              blocked?: string[];
            }>;
          };
          error?: string;
        };

        const names =
          res?.config?.groups
            ?.map((g) => (g.name ?? "").trim())
            .filter((n) => n.length > 0) ?? [];

        const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));

        const domainMap: Record<
          string,
          { allowed: string[]; blocked: string[] }
        > = {};

        for (const group of res?.config?.groups ?? []) {
          const groupName = (group?.name ?? "").trim();
          if (!groupName) continue;

          const allowed =
            Array.isArray(group.allowed) ?
              group.allowed
                .map((entry) => normalizeDomainEntry(String(entry ?? "")))
                .filter((entry) => entry.length > 0)
            : [];
          const blocked =
            Array.isArray(group.blocked) ?
              group.blocked
                .map((entry) => normalizeDomainEntry(String(entry ?? "")))
                .filter((entry) => entry.length > 0)
            : [];

          domainMap[groupName] = { allowed, blocked };
        }

        if (cancelled) return;

        setGroups(unique);
        setGroupInlineDomains(domainMap);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setGroupsError(msg);
        setGroupInlineDomains({});
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [effectiveNodeId]);

  // Load suggestions when node/groups change
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!effectiveNodeId) return;
      setLoadingSuggestions(true);
      setSuggestionsError(null);
      setSuggestions([]);
      closeImpactModal();
      closeApplyConfirmModal();

      try {
        const res = await loadSuggestionsForGroups(effectiveNodeId, groups);

        if (cancelled) return;
        setSuggestions(res);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setSuggestionsError(msg);
      } finally {
        if (!cancelled) setLoadingSuggestions(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    effectiveNodeId,
    groups,
    loadSuggestionsForGroups,
    closeImpactModal,
    closeApplyConfirmModal,
  ]);

  const cards = useMemo(() => toRegexEntryCards(suggestions), [suggestions]);

  useEffect(() => {
    setSelectedGroupsByCard((previous) => {
      const next: Record<string, string[]> = {};
      let changed = false;

      for (const card of cards) {
        const existing = previous[card.key] ?? [];
        const filtered = existing.filter((groupName) =>
          card.groupNames.includes(groupName),
        );
        const selected =
          filtered.length > 0 ?
            filtered
          : [...card.groupNames].sort((a, b) => a.localeCompare(b));
        next[card.key] = selected;

        if (
          existing.length !== selected.length ||
          existing.some((value, index) => value !== selected[index])
        ) {
          changed = true;
        }
      }

      if (Object.keys(previous).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : previous;
    });
  }, [cards]);

  const filteredCards = useMemo(() => {
    if (groupFilter === "all") return cards;
    return cards.filter((card) => card.groupNames.includes(groupFilter));
  }, [cards, groupFilter]);

  const typeFilteredCards = useMemo(() => {
    if (ruleTypeTab === "both") return filteredCards;
    return filteredCards.filter((card) =>
      ruleTypeTab === "allow" ?
        card.targetList === "allowedRegex"
      : card.targetList === "blockedRegex",
    );
  }, [filteredCards, ruleTypeTab]);

  const visibleCards = useMemo(() => {
    if (suggestionTab === "all") return typeFilteredCards;
    return typeFilteredCards.filter(
      (card) => card.confidence === suggestionTab,
    );
  }, [typeFilteredCards, suggestionTab]);

  const tabCounts = useMemo(() => {
    const safe = typeFilteredCards.filter(
      (card) => card.confidence === "safe",
    ).length;
    const likely = typeFilteredCards.filter(
      (card) => card.confidence === "likely",
    ).length;
    const warning = typeFilteredCards.filter(
      (card) => card.confidence === "warning",
    ).length;
    return { all: typeFilteredCards.length, safe, likely, warning };
  }, [typeFilteredCards]);

  const ruleTypeCounts = useMemo(() => {
    const allow = filteredCards.filter(
      (card) => card.targetList === "allowedRegex",
    ).length;
    const block = filteredCards.filter(
      (card) => card.targetList === "blockedRegex",
    ).length;
    return { both: filteredCards.length, allow, block };
  }, [filteredCards]);

  const getCardRedundancySummary = useCallback(
    (
      card: RegexEntryCardModel,
      selectedGroups: string[],
    ): RedundancySummary => {
      const proposed = card.proposedDomainEntry;
      if (!proposed || selectedGroups.length === 0) {
        return {
          selectedCount: selectedGroups.length,
          coveredCount: 0,
          allCovered: false,
        };
      }

      const listKey =
        card.targetList === "allowedRegex" ? "allowed" : "blocked";

      let coveredCount = 0;
      let exampleCoveringEntry: string | undefined;

      for (const groupName of selectedGroups) {
        const entries = groupInlineDomains[groupName]?.[listKey] ?? [];
        const coveringEntry = findCoveringDomainEntry(proposed, entries);
        if (!coveringEntry) continue;

        coveredCount += 1;
        if (!exampleCoveringEntry) {
          exampleCoveringEntry = coveringEntry;
        }
      }

      return {
        selectedCount: selectedGroups.length,
        coveredCount,
        allCovered:
          selectedGroups.length > 0 && coveredCount === selectedGroups.length,
        exampleCoveringEntry,
      };
    },
    [groupInlineDomains],
  );

  const groupTabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: cards.length };
    for (const groupName of groups) {
      counts[groupName] = cards.filter((card) =>
        card.groupNames.includes(groupName),
      ).length;
    }
    return counts;
  }, [cards, groups]);

  const redundancyByCard = useMemo(() => {
    const byCard: Record<string, RedundancySummary> = {};

    for (const card of cards) {
      const selected = (
        selectedGroupsByCard[card.key] ?? card.groupNames
      ).filter((groupName) => card.groupNames.includes(groupName));
      byCard[card.key] = getCardRedundancySummary(card, selected);
    }

    return byCard;
  }, [cards, getCardRedundancySummary, selectedGroupsByCard]);

  const toggleCardGroup = useCallback((cardKey: string, groupName: string) => {
    setSelectedGroupsByCard((previous) => {
      const current = new Set(previous[cardKey] ?? []);
      if (current.has(groupName)) {
        current.delete(groupName);
      } else {
        current.add(groupName);
      }

      return {
        ...previous,
        [cardKey]: [...current].sort((a, b) => a.localeCompare(b)),
      };
    });
  }, []);

  const handleValidate = async (card: RegexEntryCardModel) => {
    if (!effectiveNodeId) return;
    if (!card.proposedDomainEntry) return;

    const selectedGroups = selectedGroupsByCard[card.key] ?? card.groupNames;
    const requestGroup = selectedGroups[0] ?? card.representativeGroupName;

    if (!requestGroup) {
      pushToast({
        tone: "info",
        message:
          "Select at least one group on the regex entry before validating.",
      });
      return;
    }

    setValidatingCardKey(card.key);
    closeImpactModal();

    try {
      const windowHours = 24;
      const limit = 10_000;

      const response = await apiFetch(
        `/advanced-blocking/${encodePathParam(
          effectiveNodeId,
        )}/rule-optimizations/groups/${encodePathParam(
          requestGroup,
        )}/validate?windowHours=${windowHours}&limit=${limit}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suggestionId: card.primarySuggestionId,
            targetList: card.targetList,
            regexPattern: card.regexPattern,
            proposedDomainEntry: card.proposedDomainEntry,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Validation failed (${response.status})`);
      }

      const res = (await response.json()) as ValidationResponse;

      setValidation(res);
      setValidationCard(card);

      if (!res.enabled) {
        pushToast({
          tone: "info",
          message:
            "Impact preview is unavailable because stored query logs (SQLite) are not enabled/ready.",
        });
      } else {
        pushToast({
          tone: "success",
          message: "Impact preview completed. Opened in modal.",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ tone: "error", message: `Impact preview failed: ${msg}` });
    } finally {
      setValidatingCardKey(null);
    }
  };

  const openApplyConfirmModal = useCallback(
    (card: RegexEntryCardModel) => {
      if (!effectiveNodeId) return;
      if (!card.proposedDomainEntry) return;

      const selectedGroups = (
        selectedGroupsByCard[card.key] ?? card.groupNames
      ).filter((groupName) => card.groupNames.includes(groupName));

      if (selectedGroups.length === 0) {
        pushToast({
          tone: "info",
          message:
            "Select at least one group on the regex entry before applying.",
        });
        return;
      }

      const redundancy = getCardRedundancySummary(card, selectedGroups);

      setApplyVerification(null);
      setPendingApply({ card, selectedGroups, redundancy });
    },
    [
      effectiveNodeId,
      getCardRedundancySummary,
      pushToast,
      selectedGroupsByCard,
    ],
  );

  const executeApply = useCallback(
    async (
      card: RegexEntryCardModel,
      selectedGroups: string[],
      redundancy?: RedundancySummary,
    ): Promise<ApplyVerification | null> => {
      if (!effectiveNodeId) return null;
      if (!card.proposedDomainEntry) return null;

      setApplyingCardKey(card.key);

      try {
        let appliedCount = 0;
        let snapshotId: string | undefined;
        const failedGroups: string[] = [];

        for (let index = 0; index < selectedGroups.length; index += 1) {
          const groupName = selectedGroups[index];
          const response = await apiFetch(
            `/advanced-blocking/${encodePathParam(
              effectiveNodeId,
            )}/rule-optimizations/groups/${encodePathParam(groupName)}/apply`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                suggestionId: card.primarySuggestionId,
                targetList: card.targetList,
                regexPattern: card.regexPattern,
                proposedDomainEntry: card.proposedDomainEntry,
                takeSnapshot: index === 0,
                snapshotNote: `Rule optimizer: ${card.targetList} "${card.regexPattern}" → "${card.proposedDomainEntry}" (${selectedGroups.length} ${selectedGroupsLabel(selectedGroups.length)})`,
              }),
            },
          );

          if (!response.ok) {
            failedGroups.push(`${groupName} (${response.status})`);
            continue;
          }

          const res = (await response.json()) as ApplyResponse;
          if (!snapshotId && res.snapshotTaken?.id) {
            snapshotId = res.snapshotTaken.id;
          }
          appliedCount += 1;
        }

        if (appliedCount === 0) {
          throw new Error("No selected groups were updated.");
        }

        const isRedundantCleanup = Boolean(redundancy?.allCovered);

        pushToast({
          tone: failedGroups.length > 0 ? "info" : "success",
          message:
            isRedundantCleanup ?
              snapshotId ?
                `Removed redundant regex in ${appliedCount}/${selectedGroups.length} ${selectedGroupsLabel(selectedGroups.length)}. Snapshot created: ${snapshotId}`
              : `Removed redundant regex in ${appliedCount}/${selectedGroups.length} ${selectedGroupsLabel(selectedGroups.length)}.`
            : snapshotId ?
              `Applied to ${appliedCount}/${selectedGroups.length} ${selectedGroupsLabel(selectedGroups.length)}. Snapshot created: ${snapshotId}`
            : `Applied to ${appliedCount}/${selectedGroups.length} ${selectedGroupsLabel(selectedGroups.length)}.`,
        });

        if (failedGroups.length > 0) {
          pushToast({
            tone: "error",
            message: `Failed groups: ${failedGroups.slice(0, 5).join(", ")}${failedGroups.length > 5 ? "…" : ""}`,
          });
        }

        setLoadingSuggestions(true);
        setSuggestionsError(null);
        closeImpactModal();

        const refreshed = await loadSuggestionsForGroups(
          effectiveNodeId,
          groups,
        );
        setSuggestions(refreshed);

        return {
          cardKey: card.key,
          selectedCount: selectedGroups.length,
          appliedCount,
          failedGroups,
          snapshotId,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        pushToast({ tone: "error", message: `Apply failed: ${msg}` });
        return null;
      } finally {
        setApplyingCardKey(null);
        setLoadingSuggestions(false);
      }
    },
    [
      closeImpactModal,
      effectiveNodeId,
      groups,
      loadSuggestionsForGroups,
      pushToast,
    ],
  );

  const handleConfirmApplyFromModal = useCallback(() => {
    if (!pendingApply) return;
    const { card, selectedGroups, redundancy } = pendingApply;
    void executeApply(card, selectedGroups, redundancy).then((verification) => {
      if (!verification) return;
      setApplyVerification(verification);
    });
  }, [executeApply, pendingApply]);

  const handleApplyFromImpactModal = useCallback(() => {
    if (!validationCard) return;
    openApplyConfirmModal(validationCard);
  }, [validationCard, openApplyConfirmModal]);

  const showModalApplyAction = Boolean(validationCard);
  const isApplyingPending = Boolean(
    pendingApply && applyingCardKey === pendingApply.card.key,
  );
  const hasVerificationResult = Boolean(
    pendingApply &&
    applyVerification &&
    applyVerification.cardKey === pendingApply.card.key,
  );
  const canApplyFromModal =
    validationCard ?
      canAutoApplyCard(validationCard) &&
      validationCardSelectedGroups.length > 0 &&
      applyingCardKey !== validationCard.key
    : false;

  const validationCardRedundancy = useMemo(() => {
    if (!validationCard) return undefined;
    return getCardRedundancySummary(
      validationCard,
      validationCardSelectedGroups,
    );
  }, [getCardRedundancySummary, validationCard, validationCardSelectedGroups]);

  const isValidationCardRedundantCleanup = Boolean(
    validationCardRedundancy?.allCovered,
  );

  return (
    <>
      <button
        type="button"
        className="drawer-pull"
        aria-label="Open DNS Rule Optimizer history"
        aria-disabled={!canOpenRuleOptimizerHistory}
        onClick={handleOpenRuleOptimizerHistory}
        title={ruleOptimizerHistoryPullTitle}
      >
        <FontAwesomeIcon
          icon={faClockRotateLeft}
          style={{ marginBottom: "0.5rem" }}
        />
        DNS Rule Optimizer History
      </button>

      <section className="automation rule-optimizer-page">
        <header className="automation__header">
          <h1>DNS Rule Optimizer</h1>
          <p>
            Review group-level regex entries and get suggestions to simplify
            rules and reduce overhead. This tool focuses on{" "}
            <strong>inline</strong> Advanced Blocking group entries only.
          </p>
        </header>

        <Panel
          title="Scope"
          subtitle={
            lockToPrimary ?
              "Cluster mode detected. Using Primary node for analysis and apply actions."
            : "Pick a node. Suggestions are aggregated across all Advanced Blocking groups."
          }
        >
          <div className="automation__content">
            <article className="automation__card">
              {lockToPrimary ?
                <div>
                  <div className="app-card__label">Primary node</div>
                  <div className="app-card__code">
                    {primaryNode?.name ??
                      primaryNode?.id ??
                      "Primary not found"}
                  </div>
                  <p>
                    Cluster mode is enabled. Rule Optimizer changes are
                    restricted to the Primary node by design.
                  </p>
                </div>
              : <>
                  <label>
                    <strong>Node</strong>
                    <select
                      value={effectiveNodeId}
                      onChange={(e) => setNodeId(e.target.value)}
                      disabled={nodeOptions.length === 0}
                    >
                      {nodeOptions.length === 0 ?
                        <option value="">No nodes configured</option>
                      : nodeOptions.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name} {n.isPrimary ? "(Primary)" : ""}
                          </option>
                        ))
                      }
                    </select>
                  </label>
                  <p>
                    Rule changes should be applied to the Primary node in a
                    Technitium cluster.
                  </p>
                </>
              }
            </article>

            <article className="automation__card">
              <div>
                {/* <strong>Group filter</strong> */}
                <div
                  className="mt-2 flex flex-wrap gap-2"
                  role="tablist"
                  aria-label="Group filter"
                >
                  {loadingGroups ?
                    <button type="button" className="button secondary" disabled>
                      Loading groups...
                    </button>
                  : groups.length === 0 ?
                    <button type="button" className="button secondary" disabled>
                      No groups found
                    </button>
                  : <>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={groupFilter === "all"}
                        className={
                          groupFilter === "all" ? "button primary" : (
                            "button secondary"
                          )
                        }
                        onClick={() => setGroupFilter("all")}
                      >
                        All Groups ({groupTabCounts.all ?? 0})
                      </button>
                      {groups.map((groupName) => (
                        <button
                          key={groupName}
                          type="button"
                          role="tab"
                          aria-selected={groupFilter === groupName}
                          className={
                            groupFilter === groupName ? "button primary" : (
                              "button secondary"
                            )
                          }
                          onClick={() => setGroupFilter(groupName)}
                        >
                          {groupName} ({groupTabCounts[groupName] ?? 0})
                        </button>
                      ))}
                    </>
                  }
                </div>
              </div>

              {groupsError ?
                <p className="app-error" role="alert">
                  Failed to load groups: {groupsError}
                </p>
              : null}
            </article>
          </div>
        </Panel>

        <div className="app-card mb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="app-card__label mb-2">Suggestion type</div>
              <div
                className="flex flex-wrap gap-2"
                role="tablist"
                aria-label="Suggestion type"
              >
                {(
                  [
                    ["all", "All"],
                    ["safe", "SAFE"],
                    ["likely", "LIKELY"],
                    ["warning", "WARNING"],
                  ] as Array<[SuggestionTab, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={suggestionTab === value}
                    className={
                      suggestionTab === value ? "button primary" : (
                        "button secondary"
                      )
                    }
                    onClick={() => setSuggestionTab(value)}
                  >
                    {label} ({tabCounts[value]})
                  </button>
                ))}
              </div>
            </div>

            <div className="shrink-0 self-start">
              <div className="app-card__label mb-2">Rule type</div>
              <div
                className="flex flex-wrap gap-2 justify-end"
                role="tablist"
                aria-label="Rule type"
              >
                {(
                  [
                    ["both", "BOTH"],
                    ["allow", "ALLOW"],
                    ["block", "BLOCK"],
                  ] as Array<[RuleTypeTab, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={ruleTypeTab === value}
                    className={
                      ruleTypeTab === value ? "button primary" : (
                        "button secondary"
                      )
                    }
                    onClick={() => setRuleTypeTab(value)}
                  >
                    {label} ({ruleTypeCounts[value]})
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <Panel
          title="Suggestions"
          subtitle="SAFE suggestions should preserve intent (conservative classifier). LIKELY suggestions may expand scope because Advanced Blocking domain entries are zone rules."
        >
          {loadingSuggestions ?
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Loading suggestions...
            </div>
          : suggestionsError ?
            <div className="text-sm text-red-600 dark:text-red-300">
              Failed to load suggestions: {suggestionsError}
            </div>
          : visibleCards.length === 0 ?
            <div className="text-sm text-gray-700 dark:text-gray-300">
              No suggestions found for the current group/type filters.
            </div>
          : <div style={{ display: "grid", gap: "1.5rem" }}>
              {visibleCards.map((card) => (
                <RegexEntryCard
                  key={card.key}
                  card={card}
                  redundancy={redundancyByCard[card.key]}
                  selectedGroups={
                    selectedGroupsByCard[card.key] ?? card.groupNames
                  }
                  onToggleGroup={toggleCardGroup}
                  onValidate={handleValidate}
                  validating={validatingCardKey === card.key}
                />
              ))}
            </div>
          }
        </Panel>

        <Panel
          title="How this works"
          subtitle="This page is designed for safe, incremental cleanup."
        >
          <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-2">
            <li>
              Regex rules in Advanced Blocking are evaluated by scanning regex
              patterns and running <span className="font-mono">IsMatch</span>{" "}
              until a match is found. This can add per-query overhead.
            </li>
            <li>
              Inline domain entries in Advanced Blocking are zone rules (suffix
              walk). Adding <span className="font-mono">example.com</span>{" "}
              matches <span className="font-mono">example.com</span> and{" "}
              <span className="font-mono">a.example.com</span>.
            </li>
            <li>
              For changes that might expand scope, use{" "}
              <span className="font-medium">Preview impact</span> to see how
              many additional recent subdomains would be affected (requires
              stored query logs).
            </li>
            <li>
              Applying a change creates a DNS Rule Optimizer snapshot first, so
              you can restore prior state from DNS Rule Optimizer History if
              needed.
            </li>
          </ul>
        </Panel>
      </section>

      {validation ?
        <div
          className="rule-optimizer-impact-modal__overlay"
          onClick={closeImpactModal}
        >
          <div
            className="rule-optimizer-impact-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rule-optimizer-impact-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="rule-optimizer-impact-modal__header">
              <div>
                <h2
                  id="rule-optimizer-impact-title"
                  className="rule-optimizer-impact-modal__title"
                >
                  Impact Preview
                </h2>
                <p className="rule-optimizer-impact-modal__subtitle">
                  Preview uses stored query logs when enabled.
                </p>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={closeImpactModal}
              >
                Close
              </button>
            </div>

            <ValidationPanel result={validation} />

            {validationCard ?
              <div className="rule-optimizer-impact-modal__groups">
                <div className="app-card__label">Affected Groups</div>
                <div className="rule-optimizer-group-pills">
                  {validationCard.groupNames.map((groupName) => {
                    const checked =
                      validationCardSelectedGroups.includes(groupName);

                    return (
                      <label
                        key={`impact-modal-${validationCard.key}-${groupName}`}
                        className={classNames(
                          "rule-optimizer-group-pill",
                          checked && "rule-optimizer-group-pill--selected",
                        )}
                      >
                        <input
                          className="rule-optimizer-group-pill__checkbox"
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            toggleCardGroup(validationCard.key, groupName)
                          }
                        />
                        <span className="rule-optimizer-group-pill__label">
                          {groupName}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            : null}

            {showModalApplyAction ?
              <div className="rule-optimizer-impact-modal__actions">
                <button
                  type="button"
                  className={classNames(
                    "button primary",
                    validationCard && applyingCardKey === validationCard.key ?
                      "opacity-60 cursor-not-allowed"
                    : "",
                  )}
                  onClick={handleApplyFromImpactModal}
                  disabled={!canApplyFromModal}
                  title={
                    validationCard && !canAutoApplyCard(validationCard) ?
                      "This suggestion is preview-only and cannot be auto-applied"
                    : !validationCardSelectedGroups.length ?
                      "Select at least one group before applying"
                    : isValidationCardRedundantCleanup ?
                      "Remove redundant regex (effective coverage already exists; snapshot created first)"
                    : "Apply change (creates an Advanced Blocking snapshot first)"

                  }
                >
                  {validationCard && applyingCardKey === validationCard.key ?
                    isValidationCardRedundantCleanup ?
                      "Removing..."
                    : "Applying change..."
                  : isValidationCardRedundantCleanup ?
                    "Remove redundant regex"
                  : "Apply change"}
                </button>

                {validationCard && !canAutoApplyCard(validationCard) ?
                  <p className="rule-optimizer-impact-modal__apply-note">
                    This suggestion is preview-only and cannot be auto-applied.
                  </p>
                : null}
              </div>
            : null}
          </div>
        </div>
      : null}

      {pendingApply ?
        <div
          className="rule-optimizer-confirm-modal__overlay"
          onClick={closeApplyConfirmModal}
        >
          <div
            className="rule-optimizer-confirm-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rule-optimizer-confirm-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="rule-optimizer-confirm-title"
              className="rule-optimizer-confirm-modal__title"
            >
              {hasVerificationResult ?
                pendingApply.redundancy?.allCovered ?
                  "Redundant regex removed"
                : "Change applied successfully"
              : pendingApply.redundancy?.allCovered ?
                `Remove redundant regex in ${pendingApply.selectedGroups.length} ${selectedGroupsLabel(pendingApply.selectedGroups.length)}?`
              : `Apply this change to ${pendingApply.selectedGroups.length} ${selectedGroupsLabel(pendingApply.selectedGroups.length)}?`
              }
            </h2>

            <p className="rule-optimizer-confirm-modal__text">
              {hasVerificationResult ?
                pendingApply.redundancy?.allCovered ?
                  `Removed the redundant regex. Effective coverage for "${pendingApply.card.proposedDomainEntry}" was already present in the selected groups.`
                : `Removed the regex and added "${pendingApply.card.proposedDomainEntry}" as an inline domain entry in the selected groups.`

              : pendingApply.redundancy?.allCovered ?
                `"${pendingApply.card.proposedDomainEntry}" is already covered by an existing ${pendingApply.card.targetList === "allowedRegex" ? "allow" : "block"} domain entry${pendingApply.redundancy.exampleCoveringEntry ? ` (for example "${pendingApply.redundancy.exampleCoveringEntry}")` : ""} in the selected groups. This action removes only the redundant regex.`
              : `This will remove the regex and add "${pendingApply.card.proposedDomainEntry}" as an inline domain entry in each selected group.`
              }
            </p>

            {(
              pendingApply.card.kind ===
                "LIKELY_TO_ZONE_DOMAIN_ENTRY_EXPANDS_SCOPE" &&
              !hasVerificationResult
            ) ?
              <p className="rule-optimizer-confirm-modal__warning">
                Important: inline domains in Advanced Blocking are zone rules
                (match subdomains). This may expand scope.
              </p>
            : null}

            <p className="rule-optimizer-confirm-modal__text">
              {hasVerificationResult ?
                "A snapshot was created for rollback."
              : "A snapshot will be created first for rollback."}
            </p>

            {hasVerificationResult && applyVerification ?
              <div className="rule-optimizer-confirm-modal__result">
                <div className="rule-optimizer-confirm-modal__result-badges">
                  <Badge
                    variant={
                      applyVerification.failedGroups.length > 0 ?
                        "likely"
                      : "safe"
                    }
                  >
                    {`Updated ${applyVerification.appliedCount}/${applyVerification.selectedCount}`}
                  </Badge>
                  <Badge variant="info">Regex removed</Badge>
                  <Badge variant="info">
                    {pendingApply.redundancy?.allCovered ?
                      "Coverage already present"
                    : "Domain added"}
                  </Badge>
                  {applyVerification.snapshotId ?
                    <Badge variant="muted">Snapshot created</Badge>
                  : null}
                </div>

                {applyVerification.failedGroups.length > 0 ?
                  <p className="rule-optimizer-confirm-modal__result-note">
                    Some groups failed:{" "}
                    {applyVerification.failedGroups.slice(0, 4).join(", ")}
                    {applyVerification.failedGroups.length > 4 ? "…" : ""}
                  </p>
                : <p className="rule-optimizer-confirm-modal__result-note">
                    Verification complete for selected groups.
                  </p>
                }
              </div>
            : null}

            <div className="rule-optimizer-confirm-modal__actions">
              {hasVerificationResult ?
                <button
                  type="button"
                  className="button primary"
                  onClick={closeApplyConfirmModal}
                >
                  Close
                </button>
              : <>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={closeApplyConfirmModal}
                    disabled={isApplyingPending}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    onClick={handleConfirmApplyFromModal}
                    disabled={isApplyingPending}
                  >
                    {isApplyingPending ?
                      pendingApply.redundancy?.allCovered ?
                        "Removing..."
                      : "Applying change..."
                    : pendingApply.redundancy?.allCovered ?
                      "Remove redundant regex"
                    : "Apply change"}
                  </button>
                </>
              }
            </div>
          </div>
        </div>
      : null}

      <ConfigSnapshotDrawer
        isOpen={ruleOptimizerHistoryOpen}
        nodeId={effectiveNodeId}
        nodeName={selectedNodeName}
        method="rule-optimizer"
        onClose={() => setRuleOptimizerHistoryOpen(false)}
        listSnapshots={listConfigSnapshots}
        createSnapshot={createConfigSnapshot}
        restoreSnapshot={restoreConfigSnapshot}
        setSnapshotPinned={setConfigSnapshotPinned}
        getSnapshotDetail={getConfigSnapshot}
        deleteSnapshot={deleteConfigSnapshot}
        updateSnapshotNote={updateConfigSnapshotNote}
        onRestoreSuccess={async () => {
          if (!effectiveNodeId) return;

          setLoadingGroups(true);
          setLoadingSuggestions(true);
          setGroupsError(null);
          setSuggestionsError(null);
          closeImpactModal();
          closeApplyConfirmModal();

          try {
            const response = await apiFetch(
              `/advanced-blocking/${encodePathParam(effectiveNodeId)}`,
            );

            if (!response.ok) {
              throw new Error(
                `Failed to load Advanced Blocking config (${response.status})`,
              );
            }

            const res = (await response.json()) as {
              config?: {
                groups?: Array<{
                  name?: string;
                  allowed?: string[];
                  blocked?: string[];
                }>;
              };
            };

            const names =
              res?.config?.groups
                ?.map((g) => (g.name ?? "").trim())
                .filter((n) => n.length > 0) ?? [];

            const unique = [...new Set(names)].sort((a, b) =>
              a.localeCompare(b),
            );

            const domainMap: Record<
              string,
              { allowed: string[]; blocked: string[] }
            > = {};

            for (const group of res?.config?.groups ?? []) {
              const groupName = (group?.name ?? "").trim();
              if (!groupName) continue;

              const allowed =
                Array.isArray(group.allowed) ?
                  group.allowed
                    .map((entry) => normalizeDomainEntry(String(entry ?? "")))
                    .filter((entry) => entry.length > 0)
                : [];
              const blocked =
                Array.isArray(group.blocked) ?
                  group.blocked
                    .map((entry) => normalizeDomainEntry(String(entry ?? "")))
                    .filter((entry) => entry.length > 0)
                : [];

              domainMap[groupName] = { allowed, blocked };
            }

            setGroups(unique);
            setGroupInlineDomains(domainMap);

            const refreshed = await loadSuggestionsForGroups(
              effectiveNodeId,
              unique,
            );
            setSuggestions(refreshed);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            setGroupsError(msg);
            setSuggestionsError(msg);
            setGroupInlineDomains({});
          } finally {
            setLoadingGroups(false);
            setLoadingSuggestions(false);
          }
        }}
      />
    </>
  );
}
