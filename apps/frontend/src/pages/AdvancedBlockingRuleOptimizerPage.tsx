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

function encodePathParam(value: string): string {
  // Node IDs are typically safe, but group names can contain spaces.
  return encodeURIComponent(value);
}

function classNames(
  ...parts: Array<string | null | undefined | false>
): string {
  return parts.filter(Boolean).join(" ");
}

function Badge({
  variant,
  children,
}: {
  variant: "safe" | "likely" | "warning" | "info";
  children: string;
}) {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border";
  const styles =
    variant === "safe" ?
      "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-200 dark:border-green-800"
    : variant === "likely" ?
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800"
    : variant === "warning" ?
      "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800"
    : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800";

  return <span className={classNames(base, styles)}>{children}</span>;
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

function SuggestionCard({
  suggestion,
  onValidate,
  onApply,
  validating,
  applying,
}: {
  suggestion: Suggestion;
  onValidate: (s: Suggestion) => void;
  onApply: (s: Suggestion) => void;
  validating: boolean;
  applying: boolean;
}) {
  const confidenceLabel =
    suggestion.confidence === "safe" ? "Safe"
    : suggestion.confidence === "likely" ? "Likely"
    : "Warning";

  const confidenceVariant =
    suggestion.confidence === "safe" ? "safe"
    : suggestion.confidence === "likely" ? "likely"
    : "warning";

  const kindLabel =
    suggestion.kind === "SAFE_TO_ZONE_DOMAIN_ENTRY" ? "Replace regex → domain"
    : suggestion.kind === "LIKELY_TO_ZONE_DOMAIN_ENTRY_EXPANDS_SCOPE" ?
      "Replace regex → domain (expands scope)"
    : suggestion.kind === "MANUAL_REVIEW_ZONE_CANDIDATE" ?
      "Manual review candidate"
    : "Perf warning";

  const targetLabel =
    suggestion.targetList === "blockedRegex" ?
      "Blocked regex"
    : "Allowed regex";

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={confidenceVariant}>{confidenceLabel}</Badge>
            <Badge variant="info">{targetLabel}</Badge>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {kindLabel}
            </span>
          </div>

          <h3 className="app-card__subheading">{suggestion.title}</h3>

          <p className="app-card__text">{suggestion.summary}</p>
        </div>

        <div className="flex flex-col gap-2 md:items-end md:min-w-[220px]">
          <button
            type="button"
            className={classNames(
              "button secondary",
              validating ? "opacity-60 cursor-not-allowed" : "",
            )}
            onClick={() => onValidate(suggestion)}
            disabled={validating || !suggestion.proposedDomainEntry}
            title={
              suggestion.proposedDomainEntry ?
                "Validate using stored query logs (SQLite), if enabled"
              : "No proposed domain entry for this suggestion"
            }
          >
            {validating ? "Validating..." : "Validate"}
          </button>

          <button
            type="button"
            className={classNames(
              "button primary",
              applying ? "opacity-60 cursor-not-allowed" : "",
            )}
            onClick={() => onApply(suggestion)}
            disabled={
              applying ||
              suggestion.kind === "MANUAL_REVIEW_ZONE_CANDIDATE" ||
              suggestion.kind === "PERF_WARNING" ||
              !suggestion.proposedDomainEntry
            }
            title={
              suggestion.kind === "MANUAL_REVIEW_ZONE_CANDIDATE" ?
                "Manual-review candidates cannot be auto-applied"
              : suggestion.kind === "PERF_WARNING" ?
                "Perf warnings are advisory and cannot be auto-applied"
              : suggestion.proposedDomainEntry ?
                "Apply change (creates an Advanced Blocking snapshot first)"
              : "No proposed domain entry for this suggestion"
            }
          >
            {applying ? "Applying..." : "Apply"}
          </button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="app-card app-card--muted">
          <div className="app-card__label">Regex pattern</div>
          <div className="app-card__code">{suggestion.regexPattern}</div>
        </div>

        <div className="app-card app-card--muted">
          <div className="app-card__label">Proposed inline domain entry</div>
          <div className="app-card__code">
            {suggestion.proposedDomainEntry ?? "—"}
          </div>
          {suggestion.scopeExpansionRisk ?
            <div className="app-callout app-callout--warning">
              <strong>Note:</strong> Advanced Blocking inline domains are zone
              rules (match subdomains). This change may expand scope.
            </div>
          : null}
        </div>
      </div>

      {suggestion.details?.length ?
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-gray-700 dark:text-gray-200">
            Details
          </summary>
          <ul className="mt-2 list-disc pl-5 text-sm text-gray-700 dark:text-gray-300 space-y-1">
            {suggestion.details.map((d, idx) => (
              <li key={idx}>{d}</li>
            ))}
          </ul>
        </details>
      : null}

      {typeof suggestion.perfScore === "number" ?
        <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Perf score: <span className="font-mono">{suggestion.perfScore}</span>
        </div>
      : null}
    </div>
  );
}

function ValidationPanel({
  result,
  onClose,
}: {
  result: ValidationResponse;
  onClose: () => void;
}) {
  return (
    <div className="app-card">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="app-card__subheading">Validation report</h3>
          <p className="app-card__text">{result.note}</p>
        </div>
        <button type="button" className="button secondary" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="app-card app-card--muted">
          <div className="app-card__label">Window</div>
          <div className="app-card__text">
            Last <span className="app-code-inline">{result.windowHours}</span>{" "}
            hours
          </div>
        </div>

        <div className="app-card app-card--muted">
          <div className="app-card__label">Domains analyzed</div>
          <div className="app-card__text">
            <span className="app-code-inline">
              {result.distinctDomainsAnalyzed}
            </span>
          </div>
        </div>

        <div className="app-card app-card--muted">
          <div className="app-card__label">Additional subdomains matched</div>
          <div className="app-card__text">
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
  const [selectedGroup, setSelectedGroup] = useState<string>("");

  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validatingSuggestionId, setValidatingSuggestionId] = useState<
    string | null
  >(null);

  const [applyingSuggestionId, setApplyingSuggestionId] = useState<
    string | null
  >(null);

  const allNodes = nodes ?? [];
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

  const isEffectiveNodeAdvancedBlockingCapable = useMemo(() => {
    const node = allNodes.find((n) => n.id === effectiveNodeId);
    return Boolean(node?.hasAdvancedBlocking);
  }, [allNodes, effectiveNodeId]);

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

  // Load groups from Advanced Blocking snapshot
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!effectiveNodeId) return;
      setLoadingGroups(true);
      setGroupsError(null);
      setGroups([]);

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
          config?: { groups?: Array<{ name?: string }> };
          error?: string;
        };

        const names =
          res?.config?.groups
            ?.map((g) => (g.name ?? "").trim())
            .filter((n) => n.length > 0) ?? [];

        const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));

        if (cancelled) return;

        setGroups(unique);
        if (!selectedGroup && unique.length > 0) {
          setSelectedGroup(unique[0]);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setGroupsError(msg);
      } finally {
        if (!cancelled) setLoadingGroups(false);
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveNodeId]);

  // Load suggestions when node/group changes
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!effectiveNodeId || !selectedGroup) return;
      setLoadingSuggestions(true);
      setSuggestionsError(null);
      setSuggestions([]);
      setValidation(null);

      try {
        const response = await apiFetch(
          `/advanced-blocking/${encodePathParam(
            effectiveNodeId,
          )}/rule-optimizations/groups/${encodePathParam(
            selectedGroup,
          )}/suggestions`,
        );
        if (!response.ok) {
          throw new Error(`Failed to load suggestions (${response.status})`);
        }

        const res = (await response.json()) as SuggestionsResponse;

        if (cancelled) return;

        const list = res?.suggestions ?? [];
        // Sort: Safe first, then Likely, then Warning, then by perfScore desc.
        const rank = (c: SuggestionConfidence) =>
          c === "safe" ? 0
          : c === "likely" ? 1
          : 2;

        const sorted = [...list].sort((a, b) => {
          const ra = rank(a.confidence);
          const rb = rank(b.confidence);
          if (ra !== rb) return ra - rb;

          const pa = a.perfScore ?? 0;
          const pb = b.perfScore ?? 0;
          if (pa !== pb) return pb - pa;

          return a.regexPattern.localeCompare(b.regexPattern);
        });

        setSuggestions(sorted);
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
  }, [effectiveNodeId, selectedGroup]);

  const handleValidate = async (s: Suggestion) => {
    if (!effectiveNodeId || !selectedGroup) return;
    if (!s.proposedDomainEntry) return;

    setValidatingSuggestionId(s.id);
    setValidation(null);

    try {
      const windowHours = 24;
      const limit = 10_000;

      const response = await apiFetch(
        `/advanced-blocking/${encodePathParam(
          effectiveNodeId,
        )}/rule-optimizations/groups/${encodePathParam(
          selectedGroup,
        )}/validate?windowHours=${windowHours}&limit=${limit}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suggestionId: s.id,
            targetList: s.targetList,
            regexPattern: s.regexPattern,
            proposedDomainEntry: s.proposedDomainEntry,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Validation failed (${response.status})`);
      }

      const res = (await response.json()) as ValidationResponse;

      setValidation(res);

      if (!res.enabled) {
        pushToast({
          tone: "info",
          message:
            "Validation is unavailable because stored query logs (SQLite) are not enabled/ready.",
        });
      } else {
        pushToast({ tone: "success", message: "Validation completed." });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ tone: "error", message: `Validation failed: ${msg}` });
    } finally {
      setValidatingSuggestionId(null);
    }
  };

  const handleApply = async (s: Suggestion) => {
    if (!effectiveNodeId || !selectedGroup) return;
    if (!s.proposedDomainEntry) return;

    const confirmMessage =
      s.kind === "LIKELY_TO_ZONE_DOMAIN_ENTRY_EXPANDS_SCOPE" ?
        `Apply this change?\n\nThis will remove the regex and add "${s.proposedDomainEntry}" as an inline domain entry.\n\nImportant: inline domains in Advanced Blocking are zone rules (match subdomains). This may expand scope. A snapshot will be created first for rollback.`
      : `Apply this change?\n\nThis will remove the regex and add "${s.proposedDomainEntry}" as an inline domain entry.\n\nA snapshot will be created first for rollback.`;

    const ok = window.confirm(confirmMessage);
    if (!ok) return;

    setApplyingSuggestionId(s.id);

    try {
      const response = await apiFetch(
        `/advanced-blocking/${encodePathParam(
          effectiveNodeId,
        )}/rule-optimizations/groups/${encodePathParam(selectedGroup)}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suggestionId: s.id,
            targetList: s.targetList,
            regexPattern: s.regexPattern,
            proposedDomainEntry: s.proposedDomainEntry,
            takeSnapshot: true,
            snapshotNote: `Rule optimizer: ${s.targetList} "${s.regexPattern}" → "${s.proposedDomainEntry}"`,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Apply failed (${response.status})`);
      }

      const res = (await response.json()) as ApplyResponse;

      pushToast({
        tone: "success",
        message:
          res.snapshotTaken?.id ?
            `Applied. Snapshot created: ${res.snapshotTaken.id}`
          : "Applied.",
      });

      // Refresh suggestions after apply
      setLoadingSuggestions(true);
      setSuggestionsError(null);
      setValidation(null);

      const refreshedResponse = await apiFetch(
        `/advanced-blocking/${encodePathParam(
          effectiveNodeId,
        )}/rule-optimizations/groups/${encodePathParam(
          selectedGroup,
        )}/suggestions`,
      );

      if (!refreshedResponse.ok) {
        throw new Error(
          `Failed to refresh suggestions (${refreshedResponse.status})`,
        );
      }

      const refreshed = (await refreshedResponse.json()) as SuggestionsResponse;

      const list = refreshed?.suggestions ?? [];
      const rank = (c: SuggestionConfidence) =>
        c === "safe" ? 0
        : c === "likely" ? 1
        : 2;

      const sorted = [...list].sort((a, b) => {
        const ra = rank(a.confidence);
        const rb = rank(b.confidence);
        if (ra !== rb) return ra - rb;

        const pa = a.perfScore ?? 0;
        const pb = b.perfScore ?? 0;
        if (pa !== pb) return pb - pa;

        return a.regexPattern.localeCompare(b.regexPattern);
      });

      setSuggestions(sorted);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushToast({ tone: "error", message: `Apply failed: ${msg}` });
    } finally {
      setApplyingSuggestionId(null);
      setLoadingSuggestions(false);
    }
  };

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

      <section className="automation">
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
            : "Pick a node and an Advanced Blocking group to analyze."
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
              <label>
                <strong>Group</strong>
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  disabled={loadingGroups || groups.length === 0}
                >
                  {loadingGroups ?
                    <option value="">Loading groups...</option>
                  : groups.length === 0 ?
                    <option value="">No groups found</option>
                  : groups.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))
                  }
                </select>
              </label>

              {groupsError ?
                <p className="app-error" role="alert">
                  Failed to load groups: {groupsError}
                </p>
              : null}
            </article>
          </div>
        </Panel>

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
          : suggestions.length === 0 ?
            <div className="text-sm text-gray-700 dark:text-gray-300">
              No suggestions found for this group.
            </div>
          : <div className="space-y-3">
              {suggestions.map((s) => (
                <SuggestionCard
                  key={s.id}
                  suggestion={s}
                  onValidate={handleValidate}
                  onApply={handleApply}
                  validating={validatingSuggestionId === s.id}
                  applying={applyingSuggestionId === s.id}
                />
              ))}
            </div>
          }
        </Panel>

        {validation ?
          <Panel
            title="Validation"
            subtitle="Validation uses stored query logs when enabled."
          >
            <ValidationPanel
              result={validation}
              onClose={() => setValidation(null)}
            />
          </Panel>
        : null}

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
              <span className="font-medium">Validate</span> to see how many
              additional recent subdomains would be affected (requires stored
              query logs).
            </li>
            <li>
              Applying a change creates a DNS Rule Optimizer snapshot first, so
              you can restore prior state from DNS Rule Optimizer History if
              needed.
            </li>
          </ul>
        </Panel>
      </section>

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
          setGroupsError(null);

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
              config?: { groups?: Array<{ name?: string }> };
            };

            const names =
              res?.config?.groups
                ?.map((g) => (g.name ?? "").trim())
                .filter((n) => n.length > 0) ?? [];

            const unique = [...new Set(names)].sort((a, b) =>
              a.localeCompare(b),
            );

            setGroups(unique);

            const nextGroup =
              unique.includes(selectedGroup) ? selectedGroup : (
                (unique[0] ?? "")
              );
            setSelectedGroup(nextGroup);

            if (!nextGroup) {
              setSuggestions([]);
              setValidation(null);
              return;
            }

            setLoadingSuggestions(true);
            setSuggestionsError(null);
            setValidation(null);

            const suggestionsResponse = await apiFetch(
              `/advanced-blocking/${encodePathParam(
                effectiveNodeId,
              )}/rule-optimizations/groups/${encodePathParam(
                nextGroup,
              )}/suggestions`,
            );

            if (!suggestionsResponse.ok) {
              throw new Error(
                `Failed to load suggestions (${suggestionsResponse.status})`,
              );
            }

            const suggestionsPayload =
              (await suggestionsResponse.json()) as SuggestionsResponse;

            const rank = (c: SuggestionConfidence) =>
              c === "safe" ? 0
              : c === "likely" ? 1
              : 2;

            const sorted = [...(suggestionsPayload?.suggestions ?? [])].sort(
              (a, b) => {
                const ra = rank(a.confidence);
                const rb = rank(b.confidence);
                if (ra !== rb) return ra - rb;

                const pa = a.perfScore ?? 0;
                const pb = b.perfScore ?? 0;
                if (pa !== pb) return pb - pa;

                return a.regexPattern.localeCompare(b.regexPattern);
              },
            );

            setSuggestions(sorted);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            setGroupsError(msg);
            setSuggestionsError(msg);
          } finally {
            setLoadingGroups(false);
            setLoadingSuggestions(false);
          }
        }}
      />
    </>
  );
}
