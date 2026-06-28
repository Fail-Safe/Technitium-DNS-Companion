import {
  faArrowsRotate,
  faCheckCircle,
  faCircleInfo,
  faChevronDown,
  faChevronUp,
  faMagnifyingGlass,
  faPlay,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTechnitiumState } from "../context/useTechnitiumState";
import { useToast } from "../context/useToast";
import type {
  DhcpDnsSyncApplyResponse,
  DhcpDnsSyncDefaults,
  DhcpDnsSyncPlannedRecord,
  DhcpDnsSyncPreviewRequest,
  DhcpDnsSyncPreviewResponse,
  TechnitiumDhcpScopeSummary,
} from "../types/dhcp";

const FALLBACK_DEFAULTS: DhcpDnsSyncDefaults = {
  includeReverse: true,
  ttl: 900,
  staleGraceSeconds: 86400,
};

export function DhcpDnsSyncPage() {
  const {
    nodes,
    loadDhcpScopes,
    loadDhcpDnsSyncDefaults,
    previewDhcpDnsSync,
    applyDhcpDnsSync,
  } = useTechnitiumState();
  const { pushToast } = useToast();

  const [sourceNodeId, setSourceNodeId] = useState("");
  const [scopes, setScopes] = useState<TechnitiumDhcpScopeSummary[]>([]);
  const [selectedScopeNames, setSelectedScopeNames] = useState<Set<string>>(
    () => new Set(),
  );
  const [forwardZoneName, setForwardZoneName] = useState("");
  const [includeReverse, setIncludeReverse] = useState(
    FALLBACK_DEFAULTS.includeReverse,
  );
  const [ttl, setTtl] = useState(FALLBACK_DEFAULTS.ttl);
  const [staleGraceSeconds, setStaleGraceSeconds] = useState(
    FALLBACK_DEFAULTS.staleGraceSeconds,
  );
  const [loadingScopes, setLoadingScopes] = useState(false);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DhcpDnsSyncPreviewResponse | null>(
    null,
  );
  const [applyResult, setApplyResult] =
    useState<DhcpDnsSyncApplyResponse | null>(null);
  const [showApplyDetails, setShowApplyDetails] = useState(false);
  const previewSectionRef = useRef<HTMLElement | null>(null);

  const primaryNode = nodes.find((node) => node.isPrimary) ?? nodes[0];

  useEffect(() => {
    if (!sourceNodeId && nodes.length > 0) {
      setSourceNodeId(nodes[0].id);
    }
  }, [nodes, sourceNodeId]);

  useEffect(() => {
    let active = true;
    void loadDhcpDnsSyncDefaults()
      .then((defaults) => {
        if (!active) return;
        setIncludeReverse(defaults.includeReverse);
        setTtl(defaults.ttl);
        setStaleGraceSeconds(defaults.staleGraceSeconds);
      })
      .catch((defaultsError) => {
        const message =
          defaultsError instanceof Error
            ? defaultsError.message
            : "Failed to load DHCP DNS sync defaults.";
        pushToast({ tone: "info", message });
      });

    return () => {
      active = false;
    };
  }, [loadDhcpDnsSyncDefaults, pushToast]);

  useEffect(() => {
    if (!sourceNodeId) {
      setScopes([]);
      setSelectedScopeNames(new Set());
      return;
    }

    let active = true;
    setLoadingScopes(true);
    setError(null);
    void loadDhcpScopes(sourceNodeId)
      .then((envelope) => {
        if (!active) return;
        const nextScopes = [...(envelope.data.scopes ?? [])].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        setScopes(nextScopes);
        setSelectedScopeNames((previous) => {
          const valid = new Set(nextScopes.map((scope) => scope.name));
          return new Set([...previous].filter((name) => valid.has(name)));
        });
      })
      .catch((scopeError) => {
        if (!active) return;
        const message =
          scopeError instanceof Error
            ? scopeError.message
            : "Failed to load DHCP scopes.";
        setError(message);
      })
      .finally(() => {
        if (active) setLoadingScopes(false);
      });

    return () => {
      active = false;
    };
  }, [loadDhcpScopes, sourceNodeId]);

  const request = useMemo<DhcpDnsSyncPreviewRequest>(
    () => ({
      sourceScopes: [...selectedScopeNames].map((scopeName) => ({
        nodeId: sourceNodeId,
        scopeName,
      })),
      forwardZoneName: forwardZoneName.trim() || undefined,
      includeReverse,
      ttl,
      staleGraceSeconds,
    }),
    [
      forwardZoneName,
      includeReverse,
      selectedScopeNames,
      sourceNodeId,
      staleGraceSeconds,
      ttl,
    ],
  );

  const selectedScopesCount = selectedScopeNames.size;
  const hasHardPreviewIssues =
    (preview?.scopeIssues ?? []).some((issue) => issue.severity === "error") ??
    false;
  const actionableCount = preview
    ? preview.summary.createRecords +
      preview.summary.updateRecords +
      preview.summary.deleteRecords
    : 0;
  const skippedAfterApplyCount = preview
    ? preview.summary.conflicts +
      preview.summary.missingZones +
      preview.summary.skipped
    : 0;

  const runPreview = useCallback(async () => {
    setBusy("preview");
    setError(null);
    setApplyResult(null);
    try {
      const result = await previewDhcpDnsSync(request);
      setPreview(result);
      setShowApplyDetails(false);
      pushToast({
        tone: result.summary.errors > 0 ? "info" : "success",
        message: `DHCP DNS preview: ${actionSummary(result)}.`,
      });
    } catch (previewError) {
      const message =
        previewError instanceof Error
          ? previewError.message
          : "Failed to preview DHCP DNS sync.";
      setError(message);
      pushToast({ tone: "error", message });
    } finally {
      setBusy(null);
    }
  }, [previewDhcpDnsSync, pushToast, request]);

  const runApply = useCallback(async () => {
    setBusy("apply");
    setError(null);
    try {
      const result = await applyDhcpDnsSync(request);
      setApplyResult(result);
      setShowApplyDetails(false);
      const refreshedPreview = await previewDhcpDnsSync(request);
      setPreview(refreshedPreview);
      window.requestAnimationFrame(() => {
        previewSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      pushToast({
        tone: result.summary.errors > 0 ? "info" : "success",
        message: `DHCP DNS apply: ${result.actions.filter((a) => a.ok).length} action(s) completed. Preview refreshed.`,
      });
    } catch (applyError) {
      const message =
        applyError instanceof Error
          ? applyError.message
          : "Failed to apply DHCP DNS sync.";
      setError(message);
      pushToast({ tone: "error", message });
    } finally {
      setBusy(null);
    }
  }, [applyDhcpDnsSync, previewDhcpDnsSync, pushToast, request]);

  const toggleScope = (scopeName: string) => {
    setPreview(null);
    setApplyResult(null);
    setSelectedScopeNames((previous) => {
      const next = new Set(previous);
      if (next.has(scopeName)) {
        next.delete(scopeName);
      } else {
        next.add(scopeName);
      }
      return next;
    });
  };

  const clearPreviewState = () => {
    setPreview(null);
    setApplyResult(null);
    setShowApplyDetails(false);
  };

  return (
    <main className="dhcp-dns-sync-page">
      <div className="dhcp-dns-sync-page__header">
        <div>
          <h1>DHCP DNS Sync</h1>
          <p>
            Source DHCP leases from a selected node and reconcile DNS records on{" "}
            {primaryNode?.name ?? primaryNode?.id ?? "the primary node"}.
          </p>
        </div>
      </div>

      <section className="dhcp-dns-sync-grid">
        <div className="dhcp-dns-sync-card">
          <div className="dhcp-dns-sync-card__header">
            <h2>Source</h2>
            {loadingScopes && (
              <span className="dhcp-dns-sync-status">
                <FontAwesomeIcon icon={faArrowsRotate} className="fa-spin" />
                Loading
              </span>
            )}
          </div>

          <label className="dhcp-dns-sync-field">
            <span>DHCP node</span>
            <select
              value={sourceNodeId}
              onChange={(event) => {
                setSourceNodeId(event.target.value);
                clearPreviewState();
              }}
            >
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name || node.id}
                </option>
              ))}
            </select>
          </label>

          <div className="dhcp-dns-sync-scope-list">
            {scopes.map((scope) => (
              <label key={scope.name} className="dhcp-dns-sync-scope-row">
                <input
                  type="checkbox"
                  checked={selectedScopeNames.has(scope.name)}
                  onChange={() => toggleScope(scope.name)}
                />
                <span>
                  <strong>{scope.name}</strong>
                  <small>
                    {scope.startingAddress} - {scope.endingAddress}
                  </small>
                </span>
              </label>
            ))}
            {!loadingScopes && scopes.length === 0 && (
              <div className="dhcp-dns-sync-empty">No scopes found.</div>
            )}
          </div>
        </div>

        <div className="dhcp-dns-sync-card">
          <div className="dhcp-dns-sync-card__header">
            <h2>DNS Plan</h2>
          </div>

          <label className="dhcp-dns-sync-field">
            <span className="dhcp-dns-sync-label-row">
              Forward zone override
              <button
                type="button"
                className="dhcp-dns-sync-help"
                title="Leave blank to use each DHCP scope's domainName. Set this only when selected scopes should all write forward records into the same DNS zone. PTR zone selection is not affected."
                aria-label="Forward zone override help"
              >
                <FontAwesomeIcon icon={faCircleInfo} />
              </button>
            </span>
            <input
              value={forwardZoneName}
              onChange={(event) => {
                setForwardZoneName(event.target.value);
                clearPreviewState();
              }}
              placeholder="Use each scope's domainName"
            />
          </label>

          <div className="dhcp-dns-sync-options">
            <label>
              <input
                type="checkbox"
                checked={includeReverse}
                onChange={(event) => {
                  setIncludeReverse(event.target.checked);
                  clearPreviewState();
                }}
              />
              <span>PTR records</span>
            </label>
            <label>
              <span>TTL</span>
              <input
                type="number"
                min={1}
                value={ttl}
                onChange={(event) => {
                  setTtl(Number(event.target.value));
                  clearPreviewState();
                }}
              />
            </label>
            <label>
              <span>Stale grace</span>
              <input
                type="number"
                min={0}
                value={staleGraceSeconds}
                onChange={(event) => {
                  setStaleGraceSeconds(Number(event.target.value));
                  clearPreviewState();
                }}
              />
            </label>
          </div>

          <div className="dhcp-dns-sync-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void runPreview()}
              disabled={busy !== null || selectedScopesCount === 0}
            >
              <FontAwesomeIcon
                icon={busy === "preview" ? faArrowsRotate : faMagnifyingGlass}
                className={busy === "preview" ? "fa-spin" : ""}
              />
              Preview
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void runApply()}
              disabled={
                busy !== null ||
                selectedScopesCount === 0 ||
                !preview ||
                hasHardPreviewIssues ||
                actionableCount === 0
              }
            >
              <FontAwesomeIcon
                icon={busy === "apply" ? faArrowsRotate : faPlay}
                className={busy === "apply" ? "fa-spin" : ""}
              />
              {preview ? `Apply ${actionableCount} change${actionableCount === 1 ? "" : "s"}` : "Apply"}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="dhcp-dns-sync-alert dhcp-dns-sync-alert--error">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <span>{error}</span>
        </div>
      )}

      {preview && (
        <section
          className="dhcp-dns-sync-card dhcp-dns-sync-results"
          ref={previewSectionRef}
        >
          <div className="dhcp-dns-sync-card__header">
            <h2>Preview</h2>
            <span className="dhcp-dns-sync-status">
              Target: {preview.targetNodeId}
            </span>
          </div>

          <SummaryBar summary={preview.summary} />

          {applyResult && (
            <ApplyResultNotice
              result={applyResult}
              showDetails={showApplyDetails}
              onToggleDetails={() =>
                setShowApplyDetails((current) => !current)
              }
            />
          )}

          <PreviewNotice
            actionableCount={actionableCount}
            skippedAfterApplyCount={skippedAfterApplyCount}
            hasHardPreviewIssues={hasHardPreviewIssues}
          />

          {preview.scopeIssues.length > 0 && (
            <div className="dhcp-dns-sync-issues">
              {preview.scopeIssues.map((issue) => (
                <div
                  key={`${issue.sourceNodeId}-${issue.scopeName}-${issue.message}`}
                  className={`dhcp-dns-sync-issue dhcp-dns-sync-issue--${issue.severity}`}
                >
                  <FontAwesomeIcon
                    icon={
                      issue.severity === "error"
                        ? faTriangleExclamation
                        : faCheckCircle
                    }
                  />
                  <span>
                    <strong>
                      {issue.sourceNodeId}/{issue.scopeName}:
                    </strong>{" "}
                    {issue.message}
                  </span>
                </div>
              ))}
            </div>
          )}

          <RecordsTable records={preview.plannedRecords} />
        </section>
      )}
    </main>
  );
}

function ApplyResultNotice({
  result,
  showDetails,
  onToggleDetails,
}: {
  result: DhcpDnsSyncApplyResponse;
  showDetails: boolean;
  onToggleDetails: () => void;
}) {
  const okCount = result.actions.filter((action) => action.ok).length;
  const failedCount = result.actions.length - okCount;
  const changedCount = result.actions.filter(
    (action) =>
      action.ok &&
      (action.status === "create-record" ||
        action.status === "update-record" ||
        action.status === "delete-record"),
  ).length;

  return (
    <div
      className={`dhcp-dns-sync-apply-summary ${failedCount > 0 ? "dhcp-dns-sync-apply-summary--failed" : ""}`}
    >
      <div className="dhcp-dns-sync-apply-summary__main">
        <FontAwesomeIcon
          icon={failedCount > 0 ? faTriangleExclamation : faCheckCircle}
        />
        <span>
          Apply completed: {changedCount}{" "}
          {changedCount === 1 ? "change" : "changes"} applied, {okCount} ok,{" "}
          {failedCount} failed. Preview refreshed.
        </span>
      </div>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={onToggleDetails}
      >
        <FontAwesomeIcon icon={showDetails ? faChevronUp : faChevronDown} />
        {showDetails ? "Hide details" : "Show details"}
      </button>
      {showDetails && (
        <div className="dhcp-dns-sync-apply-summary__details">
          <RecordsTable records={result.actions} />
        </div>
      )}
    </div>
  );
}

function PreviewNotice({
  actionableCount,
  skippedAfterApplyCount,
  hasHardPreviewIssues,
}: {
  actionableCount: number;
  skippedAfterApplyCount: number;
  hasHardPreviewIssues: boolean;
}) {
  if (hasHardPreviewIssues) {
    return (
      <div className="dhcp-dns-sync-notice dhcp-dns-sync-notice--blocked">
        <FontAwesomeIcon icon={faTriangleExclamation} />
        <span>
          Apply is blocked until the scope errors below are fixed. No DNS
          records will be changed from this preview.
        </span>
      </div>
    );
  }

  if (actionableCount === 0) {
    return (
      <div className="dhcp-dns-sync-notice">
        <FontAwesomeIcon icon={faCircleInfo} />
        <span>No DNS changes are currently actionable.</span>
      </div>
    );
  }

  return (
    <div className="dhcp-dns-sync-notice">
      <FontAwesomeIcon icon={faCircleInfo} />
      <span>
        Apply will make {actionableCount} DNS{" "}
        {actionableCount === 1 ? "change" : "changes"}
        {skippedAfterApplyCount > 0
          ? ` and skip ${skippedAfterApplyCount} non-actionable ${skippedAfterApplyCount === 1 ? "record" : "records"}.`
          : "."}
      </span>
    </div>
  );
}

function SummaryBar({
  summary,
}: {
  summary: DhcpDnsSyncPreviewResponse["summary"];
}) {
  const items = [
    ["Create", summary.createRecords],
    ["Update", summary.updateRecords],
    ["Delete", summary.deleteRecords],
    ["Correct", summary.alreadyCorrect],
    ["Conflicts", summary.conflicts],
    ["Missing Zones", summary.missingZones],
    ["Errors", summary.errors],
  ];

  return (
    <div className="dhcp-dns-sync-summary">
      {items.map(([label, value]) => (
        <div key={label} className="dhcp-dns-sync-summary__item">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function RecordsTable({
  records,
}: {
  records: Array<
    Pick<
      DhcpDnsSyncPlannedRecord,
      | "kind"
      | "status"
      | "zoneName"
      | "recordName"
      | "recordType"
      | "currentValue"
      | "desiredValue"
      | "message"
    > & { ok?: boolean }
  >;
}) {
  if (records.length === 0) {
    return <div className="dhcp-dns-sync-empty">No records.</div>;
  }

  const sortedRecords = [...records].sort((a, b) => {
    const statusDelta =
      recordStatusPriority(a.status) - recordStatusPriority(b.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }

    return `${a.kind}|${a.recordType}|${formatOwner(a.recordName, a.zoneName)}`.localeCompare(
      `${b.kind}|${b.recordType}|${formatOwner(b.recordName, b.zoneName)}`,
    );
  });

  return (
    <div className="dhcp-dns-sync-table-wrap">
      <table className="dhcp-dns-sync-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Type</th>
            <th>Owner</th>
            <th>Current</th>
            <th>Desired</th>
          </tr>
        </thead>
        <tbody>
          {sortedRecords.map((record, index) => (
            <tr
              key={`${record.kind}-${record.zoneName}-${record.recordName}-${record.recordType}-${index}`}
              className={`dhcp-dns-sync-row dhcp-dns-sync-row--${record.status}`}
            >
              <td>
                <span
                  className={`dhcp-dns-sync-pill dhcp-dns-sync-pill--${record.status}`}
                >
                  {record.ok === false ? "failed" : record.status}
                </span>
                {record.message && <small>{record.message}</small>}
              </td>
              <td>
                {record.kind} {record.recordType}
              </td>
              <td>
                <code>
                  {formatOwner(record.recordName, record.zoneName)}
                </code>
              </td>
              <td>{record.currentValue ?? "—"}</td>
              <td>{record.desiredValue ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function recordStatusPriority(status: DhcpDnsSyncPlannedRecord["status"]) {
  const priorities: Record<DhcpDnsSyncPlannedRecord["status"], number> = {
    conflict: 0,
    "missing-zone": 1,
    "create-record": 2,
    "update-record": 3,
    "delete-record": 4,
    skipped: 5,
    "already-correct": 6,
  };

  return priorities[status];
}

function formatOwner(recordName: string, zoneName: string) {
  if (!recordName || recordName === "@") {
    return zoneName;
  }

  if (recordName.endsWith(".") || recordName.endsWith(`.${zoneName}`)) {
    return recordName;
  }

  return `${recordName}.${zoneName}`;
}

function actionSummary(result: DhcpDnsSyncPreviewResponse): string {
  const { summary } = result;
  return `${summary.createRecords} create, ${summary.updateRecords} update, ${summary.deleteRecords} delete, ${summary.conflicts} conflict(s)`;
}

export default DhcpDnsSyncPage;
