import {
  faBolt,
  faCheck,
  faChevronDown,
  faChevronUp,
  faCircleInfo,
  faCopy,
  faExclamationTriangle,
  faPlay,
  faPlus,
  faRotate,
  faToggleOff,
  faToggleOn,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppInput, AppTextarea } from "../components/common/AppInput";
import { ConfirmModal } from "../components/common/ConfirmModal";
import { apiFetch, apiFetchStatus } from "../config";
import { useTechnitiumState } from "../context/useTechnitiumState";
import { useToast } from "../context/useToast";
import type { DomainGroup } from "../types/domainGroups";
import type {
  DnsSchedule,
  DnsScheduleAction,
  DnsScheduleDraft,
  DnsScheduleEvaluatorStatus,
  DnsScheduleStateEntry,
  DnsScheduleTokenStatus,
  DnsSchedulesStorageStatus,
  LogAlertsSmtpStatus,
  RunDnsScheduleEvaluatorResponse,
} from "../types/dnsSchedules";

// ── Constants ───────────────────────────────────────────────────────────────

const DAYS_OF_WEEK = [
  { label: "Sun", value: 0 },
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
];

const BROWSER_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

const DEFAULT_DRAFT: DnsScheduleDraft = {
  name: "",
  enabled: true,
  targetType: "advanced-blocking",
  advancedBlockingGroupNames: [],
  action: "block",
  domainEntries: [],
  domainGroupNames: [],
  flushCacheOnChange: false,
  notifyEmails: [],
  notifyDebounceSeconds: 300,
  notifyMessage: undefined,
  notifyMessageOnly: undefined,
  daysOfWeek: [],
  startTime: "22:00",
  endTime: "06:00",
  timezone: BROWSER_TIMEZONE,
  nodeIds: [],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const readApiErrorMessage = async (
  response: Response,
  fallback: string,
): Promise<string> => {
  try {
    const payload = (await response.json()) as
      | { message?: string; error?: string; errors?: string[] }
      | string;
    if (typeof payload === "string" && payload.trim()) return payload;
    if (payload && typeof payload === "object") {
      if (typeof payload.message === "string" && payload.message.trim()) {
        if (Array.isArray(payload.errors) && payload.errors.length > 0) {
          return `${payload.message}: ${payload.errors.join(", ")}`;
        }
        return payload.message;
      }
      if (typeof payload.error === "string" && payload.error.trim()) {
        return payload.error;
      }
    }
  } catch {
    // ignore
  }
  return fallback;
};

function formatLocalDateTime(iso: string | undefined | null): string {
  if (!iso) return "Never";
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDaysOfWeek(days: number[]): string {
  if (days.length === 0) return "Every day";
  if (days.length === 7) return "Every day";
  const sorted = [...days].sort((a, b) => a - b);
  const labels = sorted.map(
    (d) => DAYS_OF_WEEK.find((dow) => dow.value === d)?.label ?? String(d),
  );
  return labels.join(", ");
}

function formatTimeWindow(startTime: string, endTime: string): string {
  const isOvernight = startTime > endTime;
  return `${startTime} – ${endTime}${isOvernight ? " (+1 day)" : ""}`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function TokenStatusCard({
  tokenStatus,
  storageStatus,
  onRevalidate,
  revalidating,
}: {
  tokenStatus: DnsScheduleTokenStatus | null;
  storageStatus: DnsSchedulesStorageStatus | null;
  onRevalidate?: () => void;
  revalidating?: boolean;
}) {
  // Don't render until token status has loaded and validation has completed.
  // valid === null means the backend fetch returned but validation is still
  // in-flight; showing the banner at that point is a false positive.
  if (tokenStatus === null || (tokenStatus.configured && tokenStatus.valid === null)) {
    return null;
  }

  const tokenOk = tokenStatus.valid === true && tokenStatus.hasAppsModify === true;
  // Treat null storageStatus as still-loading (not broken).
  const storageOk = storageStatus === null || storageStatus.ready === true;

  if (tokenOk && storageOk) return null;

  return (
    <div className="log-alerts__status-cards">
      {!storageOk && storageStatus && (
        <div className="log-alerts__status-card log-alerts__status-card--warn">
          <div className="log-alerts__status-card-icon">
            <FontAwesomeIcon icon={faExclamationTriangle} />
          </div>
          <div className="log-alerts__status-card-body">
            <strong>Storage unavailable</strong>
            <p>
              {storageStatus.enabled
                ? "The companion SQLite database is not ready. Check container logs."
                : "DNS Schedules storage is disabled (DNS_SCHEDULES_ENABLED=false)."}
            </p>
          </div>
        </div>
      )}
      {!tokenOk && (
        <div className="log-alerts__status-card log-alerts__status-card--warn">
          <div className="log-alerts__status-card-icon">
            <FontAwesomeIcon icon={faExclamationTriangle} />
          </div>
          <div className="log-alerts__status-card-body">
            <strong>
              {tokenStatus?.configured
                ? tokenStatus.hasAppsModify === false
                  ? "Schedule token lacks Apps: Modify permission"
                  : "Schedule token is invalid"
                : "TECHNITIUM_SCHEDULE_TOKEN not configured"}
            </strong>
            <p>
              {tokenStatus?.reason ??
                "The schedule evaluator requires a dedicated Technitium API token with Apps: Modify permission to update Advanced Blocking config on a schedule."}
            </p>
            <p className="log-alerts__status-card-hint">
              <strong>Step 1 — Create a dedicated user:</strong>{" "}
              In Technitium DNS, go to <strong>Administration → Users</strong>{" "}
              tab. Click <strong>Add User</strong>, enter a username (e.g.,{" "}
              <code>companion-scheduler</code>) and a strong password, then
              click <strong>Add</strong>.
            </p>
            <p className="log-alerts__status-card-hint">
              <strong>Step 2 — Grant Apps: Modify permission:</strong>{" "}
              Open the <strong>Permissions</strong> tab. Find the{" "}
              <strong>Apps</strong> section and click its <strong>⋮</strong>{" "}
              menu → <strong>Edit Permissions</strong>. In the User Permissions
              box, select <code>companion-scheduler</code> from the{" "}
              <strong>Add User</strong> dropdown — View and Modify will be
              pre-checked. Leave Delete unchecked and click <strong>Save</strong>.
            </p>
            <p className="log-alerts__status-card-hint">
              <strong>Step 3 — Create an API token:</strong>{" "}
              Open the <strong>Sessions</strong> tab, click{" "}
              <strong>Create Token</strong>, select{" "}
              <code>companion-scheduler</code>, and name the token{" "}
              <code>TECHNITIUM_SCHEDULE_TOKEN</code>. After clicking{" "}
              <strong>Create</strong>, copy the token immediately — it will
              not be shown again.
            </p>
            <p className="log-alerts__status-card-hint">
              <strong>Step 4 — Add it to your environment:</strong>{" "}
              Add <code>TECHNITIUM_SCHEDULE_TOKEN=&lt;your-token&gt;</code> to
              your <code>.env</code> file, then restart the container.
            </p>
            {onRevalidate && tokenStatus?.configured && (
              <p className="log-alerts__status-card-hint">
                <strong>Already configured?</strong> If you recently updated
                permissions or replaced the token, click{" "}
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={onRevalidate}
                  disabled={revalidating}
                >
                  {revalidating ? "Re-validating…" : "Re-validate token"}
                </button>{" "}
                to refresh the validation result without restarting the server.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Clock arc preview ────────────────────────────────────────────────────────

const CLOCK_SNAP_MIN = 5; // drag snaps to 5-minute intervals

function TimeWindowArc({
  startTime,
  endTime,
  onStartChange,
  onEndChange,
}: {
  startTime: string;
  endTime: string;
  onStartChange?: (t: string) => void;
  onEndChange?: (t: string) => void;
}) {
  const S = 160, CX = 80, CY = 80;
  const OR = 66, IR = 50;
  const LR = 34;

  const interactive = !!(onStartChange || onEndChange);

  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef<"start" | "end" | null>(null);
  const [hovered, setHovered] = useState<"start" | "end" | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Always-fresh move handler — avoids stale closures in the mounted effect
  const handleMoveRef = useRef<(cx: number, cy: number) => void>(() => {});
  handleMoveRef.current = (clientX: number, clientY: number) => {
    const which = draggingRef.current;
    if (!which) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * S;
    const svgY = ((clientY - rect.top) / rect.height) * S;
    const dx = svgX - CX, dy = svgY - CY;
    const rawAngle = Math.atan2(dy, dx);
    const minuteAngle = rawAngle + Math.PI / 2;
    const normalized =
      ((minuteAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const rawMin = (normalized / (2 * Math.PI)) * 1440;
    const snapped = Math.round(rawMin / CLOCK_SNAP_MIN) * CLOCK_SNAP_MIN % 1440;
    const h = Math.floor(snapped / 60) % 24;
    const m = snapped % 60;
    const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (which === "start") onStartChange?.(time);
    else onEndChange?.(time);
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) =>
      handleMoveRef.current(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) {
        e.preventDefault();
        handleMoveRef.current(t.clientX, t.clientY);
      }
    };
    const onEnd = () => {
      if (draggingRef.current) {
        draggingRef.current = null;
        setIsDragging(false);
        setHovered(null);
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, []); // mount/unmount only — handleMoveRef stays current via ref pattern

  const startDot = (e: React.MouseEvent | React.TouchEvent, which: "start" | "end") => {
    e.preventDefault();
    if (!interactive) return;
    draggingRef.current = which;
    setIsDragging(true);
  };

  const toMin = (t: string): number => {
    const [h = 0, m = 0] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const toAngle = (min: number) => -Math.PI / 2 + (min / 1440) * 2 * Math.PI;
  const polar = (r: number, a: number): [number, number] => [
    CX + r * Math.cos(a),
    CY + r * Math.sin(a),
  ];
  const r1 = (n: number) => Math.round(n * 10) / 10;

  const startMin = toMin(startTime);
  const endMin = toMin(endTime);
  const isOvernight = startMin > endMin;
  const activeMin = isOvernight ? 1440 - startMin + endMin : endMin - startMin;
  const dh = Math.floor(activeMin / 60);
  const dm = activeMin % 60;
  const durationLabel = dm === 0 ? `${dh}h` : `${dh}h ${dm}m`;
  const largeArc = activeMin > 720 ? 1 : 0;

  const sa = toAngle(startMin), ea = toAngle(endMin);
  const [sox, soy] = polar(OR, sa);
  const [eox, eoy] = polar(OR, ea);
  const [six, siy] = polar(IR, sa);
  const [eix, eiy] = polar(IR, ea);

  const arcPath = [
    `M${r1(sox)} ${r1(soy)}`,
    `A${OR} ${OR} 0 ${largeArc} 1 ${r1(eox)} ${r1(eoy)}`,
    `L${r1(eix)} ${r1(eiy)}`,
    `A${IR} ${IR} 0 ${largeArc} 0 ${r1(six)} ${r1(siy)}`,
    "Z",
  ].join(" ");

  const cardinals = [
    { h: 0, label: "0" },
    { h: 6, label: "6" },
    { h: 12, label: "12" },
    { h: 18, label: "18" },
  ] as const;

  const dotR = (which: "start" | "end") =>
    hovered === which || (isDragging && draggingRef.current === which) ? 6 : 4;

  const dotCursor = (which: "start" | "end"): React.CSSProperties =>
    interactive
      ? { cursor: isDragging && draggingRef.current === which ? "grabbing" : "grab" }
      : {};

  return (
    <div
      className="dns-schedules__clock-arc"
      style={interactive ? { userSelect: "none" } : undefined}
    >
      <svg
        ref={svgRef}
        width={S}
        height={S}
        viewBox={`0 0 ${S} ${S}`}
        style={isDragging ? { cursor: "grabbing" } : undefined}
        aria-label={`Time window: ${startTime}–${endTime}, ${durationLabel}`}
        role="img"
      >
        {/* Track ring */}
        <circle
          cx={CX} cy={CY} r={(OR + IR) / 2}
          fill="none"
          stroke="var(--color-bg-tertiary)"
          strokeWidth={OR - IR}
        />

        {/* Active window arc */}
        <path
          d={arcPath}
          fill="var(--color-primary)" fillOpacity="0.2"
          stroke="var(--color-primary)" strokeWidth="1.5" strokeOpacity="0.7"
        />

        {/* Hour ticks (painted over arc as dividers) */}
        {Array.from({ length: 24 }, (_, h) => {
          const a = toAngle(h * 60);
          const isMajor = h % 6 === 0;
          const [ix, iy] = polar(isMajor ? IR : IR + 5, a);
          const [ox, oy] = polar(OR, a);
          return (
            <line key={h} x1={ix} y1={iy} x2={ox} y2={oy}
              stroke="var(--color-bg-secondary)"
              strokeWidth={isMajor ? 1.5 : 0.75}
            />
          );
        })}

        {/* Cardinal labels */}
        {cardinals.map(({ h, label }) => {
          const [lx, ly] = polar(LR, toAngle(h * 60));
          return (
            <text key={h} x={lx} y={ly}
              textAnchor="middle" dominantBaseline="middle"
              fontSize="9" fill="var(--color-text-tertiary)"
            >
              {label}
            </text>
          );
        })}

        {/* Duration in center */}
        <text x={CX} y={isOvernight ? CY - 7 : CY}
          textAnchor="middle" dominantBaseline="middle"
          fontSize="13" fontWeight="600" fill="var(--color-text-primary)"
        >
          {durationLabel}
        </text>
        {isOvernight && (
          <text x={CX} y={CY + 8}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="8" fill="var(--color-text-tertiary)"
          >
            overnight
          </text>
        )}

        {/* Start dot — draggable */}
        <circle
          cx={sox} cy={soy} r={dotR("start")}
          fill="var(--color-primary)"
          style={dotCursor("start")}
          onMouseDown={(e) => startDot(e, "start")}
          onTouchStart={(e) => startDot(e, "start")}
          onMouseEnter={() => { if (!isDragging) setHovered("start"); }}
          onMouseLeave={() => { if (!isDragging) setHovered(null); }}
        />

        {/* End dot — draggable */}
        <circle
          cx={eox} cy={eoy} r={dotR("end")}
          fill="var(--color-primary)" fillOpacity="0.5"
          style={dotCursor("end")}
          onMouseDown={(e) => startDot(e, "end")}
          onTouchStart={(e) => startDot(e, "end")}
          onMouseEnter={() => { if (!isDragging) setHovered("end"); }}
          onMouseLeave={() => { if (!isDragging) setHovered(null); }}
        />
      </svg>
    </div>
  );
}

interface ScheduleFormProps {
  draft: DnsScheduleDraft;
  onChange: (draft: DnsScheduleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  submitting: boolean;
  isNew: boolean;
  availableNodeIds: string[];
  availableAbGroups: string[];
  availableDomainGroups: DomainGroup[];
  smtpStatus?: LogAlertsSmtpStatus | null;
  knownEmails?: string[];
  tokenStatus?: DnsScheduleTokenStatus | null;
}

function ScheduleForm({
  draft,
  onChange,
  onSave,
  onCancel,
  submitting,
  isNew,
  availableNodeIds,
  availableAbGroups,
  availableDomainGroups,
  smtpStatus,
  knownEmails,
  tokenStatus,
}: ScheduleFormProps) {
  const domainEntriesText = draft.domainEntries.join("\n");
  const [emailText, setEmailText] = useState(() => draft.notifyEmails.join("\n"));

  const handleDomainEntriesChange = (text: string) => {
    const entries = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    onChange({ ...draft, domainEntries: entries });
  };

  const handleDayToggle = (day: number) => {
    const next = draft.daysOfWeek.includes(day)
      ? draft.daysOfWeek.filter((d) => d !== day)
      : [...draft.daysOfWeek, day];
    onChange({ ...draft, daysOfWeek: next });
  };

  const handleNodeToggle = (nodeId: string) => {
    const next = draft.nodeIds.includes(nodeId)
      ? draft.nodeIds.filter((id) => id !== nodeId)
      : [...draft.nodeIds, nodeId];
    onChange({ ...draft, nodeIds: next });
  };

  return (
    <div className="log-alerts__rule-form">
      <div className="log-alerts__form-grid">
        {/* Name */}
        <div className="log-alerts__form-field">
          <label className="log-alerts__form-label">Schedule name</label>
          <AppInput
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="e.g. Kids bedtime block"
            disabled={submitting}
          />
        </div>

        {/* Enabled */}
        <div className="log-alerts__form-field">
          <label className="log-alerts__form-label">Enabled</label>
          <button
            type="button"
            className={`log-alerts__toggle-btn ${draft.enabled ? "log-alerts__toggle-btn--on" : "log-alerts__toggle-btn--off"}`}
            onClick={() => onChange({ ...draft, enabled: !draft.enabled })}
            disabled={submitting}
          >
            <FontAwesomeIcon
              icon={draft.enabled ? faToggleOn : faToggleOff}
            />
            <span>{draft.enabled ? "Enabled" : "Disabled"}</span>
          </button>
        </div>

        {/* Blocking target */}
        <div className="log-alerts__form-field log-alerts__form-field--wide">
          <label className="log-alerts__form-label">Blocking target</label>
          <div className="log-alerts__radio-group">
            <label className="log-alerts__radio-label">
              <input
                type="radio"
                name="schedule-target-type"
                value="advanced-blocking"
                checked={draft.targetType !== "built-in"}
                disabled={submitting}
                onChange={() =>
                  onChange({ ...draft, targetType: "advanced-blocking" })
                }
              />
              Advanced Blocking group
            </label>
            <label className="log-alerts__radio-label">
              <input
                type="radio"
                name="schedule-target-type"
                value="built-in"
                checked={draft.targetType === "built-in"}
                disabled={submitting}
                onChange={() =>
                  onChange({
                    ...draft,
                    targetType: "built-in",
                    advancedBlockingGroupNames: [],
                    notifyEmails: [],
                  })
                }
              />
              Built-in blocking (all clients)
            </label>
          </div>
        </div>

        {/* AB Group — only for advanced-blocking mode */}
        {draft.targetType !== "built-in" && (
        <div className="log-alerts__form-field log-alerts__form-field--wide">
          <label className="log-alerts__form-label">
            Advanced Blocking group
            {availableAbGroups.length === 0 && (
              <span className="log-alerts__form-hint">
                {" "}(case-sensitive, must match exactly)
              </span>
            )}
          </label>
          {availableAbGroups.length > 0 ? (
            <div className="logs-page__ab-group-pills">
              {availableAbGroups.map((name) => {
                const selected = draft.advancedBlockingGroupNames.includes(name);
                return (
                  <label
                    key={name}
                    className={`logs-page__ab-group-pill${selected ? " logs-page__ab-group-pill--selected" : ""}`}
                  >
                    <input
                      className="logs-page__ab-group-pill__checkbox"
                      type="checkbox"
                      checked={selected}
                      disabled={submitting}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...draft.advancedBlockingGroupNames, name]
                          : draft.advancedBlockingGroupNames.filter((g) => g !== name);
                        onChange({ ...draft, advancedBlockingGroupNames: next });
                      }}
                    />
                    <span className="logs-page__ab-group-pill__label">
                      {name}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <AppInput
              value={draft.advancedBlockingGroupNames.join(", ")}
              onChange={(e) =>
                onChange({
                  ...draft,
                  advancedBlockingGroupNames: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter((v) => v.length > 0),
                })
              }
              placeholder="e.g. Kids, Parents"
              disabled={submitting}
            />
          )}
        </div>
        )}

        {/* Action */}
        <div className="log-alerts__form-field">
          <label className="log-alerts__form-label">Action during window</label>
          <div className="log-alerts__radio-group">
            {(["block", "allow"] as DnsScheduleAction[]).map((action) => (
              <label key={action} className="log-alerts__radio-label">
                <input
                  type="radio"
                  name="schedule-action"
                  value={action}
                  checked={draft.action === action}
                  onChange={() => onChange({ ...draft, action })}
                  disabled={submitting}
                />
                <span>
                  {action === "block" ? "Block (add to blocked list)" : "Allow (add to allowed list)"}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Domain Groups */}
        {availableDomainGroups.length > 0 && (
          <div className="log-alerts__form-field log-alerts__form-field--wide">
            <label className="log-alerts__form-label">
              Domain Groups{" "}
              <span className="log-alerts__form-hint">
                (entries resolved fresh at each evaluation run)
              </span>
            </label>
            <div className="logs-page__ab-group-pills">
              {availableDomainGroups.map((dg) => {
                const selected = draft.domainGroupNames.includes(dg.name);
                return (
                  <label
                    key={dg.id}
                    className={`logs-page__ab-group-pill${selected ? " logs-page__ab-group-pill--selected" : ""}`}
                  >
                    <input
                      className="logs-page__ab-group-pill__checkbox"
                      type="checkbox"
                      checked={selected}
                      disabled={submitting}
                      onChange={() => {
                        const next = selected
                          ? draft.domainGroupNames.filter((n) => n !== dg.name)
                          : [...draft.domainGroupNames, dg.name];
                        onChange({ ...draft, domainGroupNames: next });
                      }}
                    />
                    <span className="logs-page__ab-group-pill__label">
                      {dg.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Domain entries */}
        <div className="log-alerts__form-field log-alerts__form-field--wide">
          <label className="log-alerts__form-label">
            Domain entries{" "}
            <span className="log-alerts__form-hint">(one per line)</span>
          </label>
          <AppTextarea
            value={domainEntriesText}
            onChange={(e) => handleDomainEntriesChange(e.target.value)}
            placeholder={"social.example.com\ngaming.example.com"}
            rows={4}
            disabled={submitting}
            className="log-alerts__domain-textarea"
          />
        </div>

        {/* Days of week */}
        <div className="log-alerts__form-field log-alerts__form-field--wide">
          <label className="log-alerts__form-label">
            Days of week{" "}
            <span className="log-alerts__form-hint">(empty = every day)</span>
          </label>
          <div className="dns-schedules__dow-grid">
            {DAYS_OF_WEEK.map((dow) => (
              <label key={dow.value} className="dns-schedules__dow-label">
                <input
                  type="checkbox"
                  checked={draft.daysOfWeek.includes(dow.value)}
                  onChange={() => handleDayToggle(dow.value)}
                  disabled={submitting}
                />
                <span>{dow.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Time window */}
        <div className="log-alerts__form-field">
          <label className="log-alerts__form-label">Start time (24h)</label>
          <AppInput
            type="time"
            value={draft.startTime}
            onChange={(e) => onChange({ ...draft, startTime: e.target.value })}
            disabled={submitting}
          />
        </div>

        <div className="log-alerts__form-field">
          <label className="log-alerts__form-label">
            End time (24h){" "}
            <span className="log-alerts__form-hint">
              {draft.startTime > draft.endTime ? "(overnight — spans midnight)" : ""}
            </span>
          </label>
          <AppInput
            type="time"
            value={draft.endTime}
            onChange={(e) => onChange({ ...draft, endTime: e.target.value })}
            disabled={submitting}
          />
        </div>

        {/* Time window arc preview — dots are draggable */}
        <div className="log-alerts__form-field log-alerts__form-field--wide">
          <TimeWindowArc
            startTime={draft.startTime}
            endTime={draft.endTime}
            onStartChange={
              submitting
                ? undefined
                : (t) => onChange({ ...draft, startTime: t })
            }
            onEndChange={
              submitting
                ? undefined
                : (t) => onChange({ ...draft, endTime: t })
            }
          />
        </div>

        {/* Timezone */}
        <div className="log-alerts__form-field">
          <label className="log-alerts__form-label">Timezone</label>
          {BROWSER_TIMEZONE === "UTC" ? (
            <span className="log-alerts__form-hint">UTC</span>
          ) : (
            <div className="log-alerts__radio-group">
              {(["UTC", BROWSER_TIMEZONE] as const).map((tz) => (
                <label key={tz} className="log-alerts__radio-label">
                  <input
                    type="radio"
                    name="schedule-timezone"
                    value={tz}
                    checked={draft.timezone === tz}
                    onChange={() => onChange({ ...draft, timezone: tz })}
                    disabled={submitting}
                  />
                  <span>{tz}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Cache flush */}
        <div className="log-alerts__form-field log-alerts__form-field--wide">
          <label className="log-alerts__form-label">DNS cache flush</label>
          <label className="log-alerts__radio-label">
            <input
              type="checkbox"
              checked={draft.flushCacheOnChange}
              onChange={(e) =>
                onChange({ ...draft, flushCacheOnChange: e.target.checked })
              }
              disabled={submitting}
            />
            <span>Flush DNS cache when schedule activates or deactivates</span>
          </label>
          {draft.flushCacheOnChange && tokenStatus?.hasCacheModify !== true && (
            <p className="log-alerts__form-hint">
              Requires <strong>Cache: Modify</strong> permission on the
              companion-scheduler user (Administration → Permissions → Cache →
              Edit Permissions). Flush is best-effort — schedule evaluation
              succeeds even if the flush fails.
            </p>
          )}
          {draft.flushCacheOnChange && tokenStatus?.hasCacheModify === false && (
            <p className="log-alerts__form-hint log-alerts__form-hint--warn">
              The companion-scheduler token does not have Cache: Modify
              permission. Cache flush will be skipped.
            </p>
          )}
        </div>

        {/* Email notifications — not available in built-in mode */}
        {draft.targetType !== "built-in" && <div className="log-alerts__form-field log-alerts__form-field--wide">
          <label className="log-alerts__form-label">
            Email notifications{" "}
            <span className="log-alerts__form-hint">
              (alerted when blocked domains are queried — one address per line or comma-separated)
            </span>
          </label>
          <AppTextarea
            value={emailText}
            onChange={(e) => setEmailText(e.target.value)}
            onBlur={() => {
              const emails = emailText
                .split(/[\n,]/)
                .map((l) => l.trim())
                .filter((l) => l.length > 0);
              setEmailText(emails.join("\n"));
              onChange({ ...draft, notifyEmails: emails });
            }}
            placeholder={"admin@example.com\nparent@example.com"}
            rows={3}
            disabled={submitting}
            className="log-alerts__domain-textarea"
          />
          {(() => {
            const suggestions = (knownEmails ?? []).filter(
              (e) => !draft.notifyEmails.includes(e),
            );
            return suggestions.length > 0 ? (
              <div className="dns-schedules__email-suggestions">
                <span className="log-alerts__form-hint">Previously used:</span>
                {suggestions.map((email) => (
                  <button
                    key={email}
                    type="button"
                    className="dns-schedules__email-chip"
                    onClick={() => {
                      const newEmails = [...draft.notifyEmails, email];
                      setEmailText(newEmails.join("\n"));
                      onChange({ ...draft, notifyEmails: newEmails });
                    }}
                    disabled={submitting}
                  >
                    + {email}
                  </button>
                ))}
              </div>
            ) : null;
          })()}
          {draft.notifyEmails.length > 0 && smtpStatus && !smtpStatus.configured && (
            <p className="log-alerts__form-hint" style={{ color: "var(--color-warn)" }}>
              SMTP is not configured — emails will not be delivered. Add{" "}
              <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, etc. to your{" "}
              <code>.env</code> to enable email delivery.
            </p>
          )}
        </div>}

        {/* Debounce (only when emails are set and not built-in mode) */}
        {draft.targetType !== "built-in" && draft.notifyEmails.length > 0 && (
          <div className="log-alerts__form-field">
            <label className="log-alerts__form-label">
              Alert debounce{" "}
              <span className="log-alerts__form-hint">(minutes)</span>
            </label>
            <AppInput
              type="number"
              min="0"
              max="1440"
              value={String(Math.round(draft.notifyDebounceSeconds / 60))}
              onChange={(e) => {
                const mins = Math.max(
                  0,
                  Math.round(Number(e.target.value) || 0),
                );
                onChange({ ...draft, notifyDebounceSeconds: mins * 60 });
              }}
              disabled={submitting}
            />
            <p className="log-alerts__form-hint">
              Minimum time between repeat emails for this schedule&apos;s alert
              rule.
            </p>
          </div>
        )}

        {/* Custom email message (only when emails are set and not built-in mode) */}
        {draft.targetType !== "built-in" && draft.notifyEmails.length > 0 && (
          <div className="log-alerts__form-field log-alerts__form-field--wide">
            <label className="log-alerts__form-label">
              Email message{" "}
              <span className="log-alerts__form-hint">(optional)</span>
            </label>
            <AppTextarea
              value={draft.notifyMessage ?? ""}
              onChange={(e) =>
                onChange({
                  ...draft,
                  notifyMessage: e.target.value || undefined,
                  notifyMessageOnly: e.target.value ? draft.notifyMessageOnly : false,
                })
              }
              placeholder="Optional note to include at the top of alert emails, e.g. 'Bedtime rule — kids should be offline.'"
              rows={3}
              disabled={submitting}
            />
          </div>
        )}

        {/* Message-only mode (only when a custom message is set) */}
        {draft.targetType !== "built-in" && draft.notifyEmails.length > 0 && !!draft.notifyMessage && (
          <div className="log-alerts__form-field">
            <label className="dns-schedules__dow-label">
              <input
                type="checkbox"
                checked={!!draft.notifyMessageOnly}
                onChange={(e) =>
                  onChange({ ...draft, notifyMessageOnly: e.target.checked })
                }
                disabled={submitting}
              />
              <span>
                Send custom message only{" "}
                <span className="log-alerts__form-hint">
                  (replaces technical details — better for non-technical recipients)
                </span>
              </span>
            </label>
          </div>
        )}

        {/* Target nodes */}
        {availableNodeIds.length > 1 && (
          <div className="log-alerts__form-field log-alerts__form-field--wide">
            <label className="log-alerts__form-label">
              Target nodes{" "}
              <span className="log-alerts__form-hint">
                (empty = all nodes)
              </span>
            </label>
            <div className="dns-schedules__dow-grid">
              {availableNodeIds.map((nodeId) => (
                <label key={nodeId} className="dns-schedules__dow-label">
                  <input
                    type="checkbox"
                    checked={draft.nodeIds.includes(nodeId)}
                    onChange={() => handleNodeToggle(nodeId)}
                    disabled={submitting}
                  />
                  <span>{nodeId}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="log-alerts__form-actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onSave}
          disabled={submitting}
        >
          {submitting ? "Saving..." : isNew ? "Create Schedule" : "Save Changes"}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function AutomationPage() {
  const {
    nodes,
    advancedBlocking,
    blockingStatus,
    loadingAdvancedBlocking,
    reloadAdvancedBlocking,
  } = useTechnitiumState();
  const { pushToast } = useToast();

  // Only standalone nodes are individually targetable. In a native cluster,
  // writes go through the primary only — secondary nodes are not valid targets.
  const availableNodeIds = nodes
    .filter((n) => !n.clusterState?.type || n.clusterState.type === "Standalone")
    .map((n) => n.id);

  // ── AB group picker ──────────────────────────────────────────────────────

  const isAdvancedBlockingActive =
    blockingStatus?.nodes?.some(
      (n) => n.advancedBlockingInstalled === true && n.advancedBlockingEnabled === true,
    ) ?? false;

  const ensureAdvancedBlockingLoaded = useCallback(async () => {
    if (loadingAdvancedBlocking || advancedBlocking) return;
    await reloadAdvancedBlocking();
  }, [advancedBlocking, loadingAdvancedBlocking, reloadAdvancedBlocking]);

  const [availableAbGroups, setAvailableAbGroups] = useState<string[]>([]);

  useEffect(() => {
    if (!isAdvancedBlockingActive) {
      setAvailableAbGroups([]);
      return;
    }
    void ensureAdvancedBlockingLoaded();
    const names = [
      ...new Set(
        (advancedBlocking?.nodes ?? [])
          .flatMap((n) => n.config?.groups ?? [])
          .map((g) => g.name)
          .filter(Boolean),
      ),
    ].sort();
    setAvailableAbGroups(names);
  }, [isAdvancedBlockingActive, advancedBlocking, ensureAdvancedBlockingLoaded]);

  // Domain Groups (for schedule form)
  const [availableDomainGroups, setAvailableDomainGroups] = useState<DomainGroup[]>([]);

  // SMTP status (for notification hint in form)
  const [smtpStatus, setSmtpStatus] = useState<LogAlertsSmtpStatus | null>(null);

  // Loading / data state
  const [tokenStatus, setTokenStatus] =
    useState<DnsScheduleTokenStatus | null>(null);
  const [storageStatus, setStorageStatus] =
    useState<DnsSchedulesStorageStatus | null>(null);
  const [evaluatorStatus, setEvaluatorStatus] =
    useState<DnsScheduleEvaluatorStatus | null>(null);
  const [schedules, setSchedules] = useState<DnsSchedule[]>([]);
  const knownEmails = Array.from(
    new Set(schedules.flatMap((s) => s.notifyEmails)),
  ).sort();
  const [appliedState, setAppliedState] = useState<DnsScheduleStateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [editingScheduleId, setEditingScheduleId] = useState<
    string | "new" | null
  >(null);
  const [formDraft, setFormDraft] = useState<DnsScheduleDraft>(DEFAULT_DRAFT);
  const [submitting, setSubmitting] = useState(false);

  // Action state
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [deleteConfirmSchedule, setDeleteConfirmSchedule] = useState<DnsSchedule | null>(null);
  const [evaluatorToggling, setEvaluatorToggling] = useState(false);
  const [evaluatorRunning, setEvaluatorRunning] = useState(false);
  const [lastRunResult, setLastRunResult] =
    useState<RunDnsScheduleEvaluatorResponse | null>(null);
  const [showRunResult, setShowRunResult] = useState(false);

  // Expanded schedule cards
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const mountedRef = useRef(true);

  // ── Data loaders ─────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tokenRes, storageRes, evalRes, schedulesRes, stateRes, dgRes, smtpRes] =
        await Promise.all([
          apiFetchStatus("/nodes/dns-schedules/token/status"),
          apiFetchStatus("/nodes/dns-schedules/storage/status"),
          apiFetchStatus("/nodes/dns-schedules/evaluator/status"),
          apiFetch("/nodes/dns-schedules/rules"),
          apiFetchStatus("/nodes/dns-schedules/state"),
          apiFetch("/domain-groups"),
          apiFetchStatus("/nodes/log-alerts/smtp/status"),
        ]);

      if (!mountedRef.current) return;

      if (tokenRes.ok)
        setTokenStatus((await tokenRes.json()) as DnsScheduleTokenStatus);
      if (storageRes.ok)
        setStorageStatus((await storageRes.json()) as DnsSchedulesStorageStatus);
      if (evalRes.ok)
        setEvaluatorStatus(
          (await evalRes.json()) as DnsScheduleEvaluatorStatus,
        );
      if (schedulesRes.ok)
        setSchedules((await schedulesRes.json()) as DnsSchedule[]);
      if (stateRes.ok)
        setAppliedState((await stateRes.json()) as DnsScheduleStateEntry[]);
      if (dgRes.ok)
        setAvailableDomainGroups((await dgRes.json()) as DomainGroup[]);
      if (smtpRes.ok)
        setSmtpStatus((await smtpRes.json()) as LogAlertsSmtpStatus);
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : "Failed to load schedules.";
      setError(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Merge mount-tracking and initial load into one effect so that
  // React StrictMode's cleanup→remount cycle resets mountedRef.current = true
  // before loadAll() is called again, preventing infinite loading state.
  useEffect(() => {
    mountedRef.current = true;
    void loadAll();
    return () => {
      mountedRef.current = false;
    };
  }, [loadAll]);

  const [revalidatingToken, setRevalidatingToken] = useState(false);

  const handleRevalidateToken = useCallback(async () => {
    setRevalidatingToken(true);
    try {
      await apiFetch("/nodes/dns-schedules/token/revalidate", { method: "POST" });
      // Poll until validation completes (valid transitions away from null)
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const res = await apiFetchStatus("/nodes/dns-schedules/token/status");
        if (!res.ok || !mountedRef.current) break;
        const status = (await res.json()) as DnsScheduleTokenStatus;
        if (mountedRef.current) setTokenStatus(status);
        if (status.valid !== null) break;
      }
    } catch {
      // ignore — stale UI is acceptable
    } finally {
      if (mountedRef.current) setRevalidatingToken(false);
    }
  }, []);

  const refreshEvaluatorStatus = useCallback(async () => {
    try {
      const res = await apiFetchStatus("/nodes/dns-schedules/evaluator/status");
      if (res.ok && mountedRef.current) {
        setEvaluatorStatus((await res.json()) as DnsScheduleEvaluatorStatus);
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshAppliedState = useCallback(async () => {
    try {
      const res = await apiFetchStatus("/nodes/dns-schedules/state");
      if (res.ok && mountedRef.current) {
        setAppliedState((await res.json()) as DnsScheduleStateEntry[]);
      }
    } catch {
      // ignore
    }
  }, []);

  // ── Form handlers ─────────────────────────────────────────────────────────

  const handleNewSchedule = () => {
    setFormDraft({ ...DEFAULT_DRAFT });
    setEditingScheduleId("new");
  };

  const handleEditSchedule = (schedule: DnsSchedule) => {
    setFormDraft({
      name: schedule.name,
      enabled: schedule.enabled,
      targetType: schedule.targetType ?? "advanced-blocking",
      advancedBlockingGroupNames: schedule.advancedBlockingGroupNames ?? [],
      action: schedule.action,
      domainEntries: schedule.domainEntries,
      domainGroupNames: schedule.domainGroupNames ?? [],
      flushCacheOnChange: schedule.flushCacheOnChange ?? false,
      notifyEmails: schedule.notifyEmails ?? [],
      notifyDebounceSeconds: schedule.notifyDebounceSeconds ?? 300,
      notifyMessage: schedule.notifyMessage,
      notifyMessageOnly: schedule.notifyMessageOnly,
      daysOfWeek: schedule.daysOfWeek,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      timezone: schedule.timezone,
      nodeIds: schedule.nodeIds,
    });
    setEditingScheduleId(schedule.id);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(schedule.id);
      return next;
    });
  };

  const handleCancelForm = () => {
    setEditingScheduleId(null);
  };

  const handleSaveSchedule = async () => {
    if (!formDraft.name.trim()) {
      pushToast({ message: "Schedule name is required.", tone: "info", timeout: 4000 });
      return;
    }
    if (
      formDraft.targetType !== "built-in" &&
      formDraft.advancedBlockingGroupNames.length === 0
    ) {
      pushToast({
        message: "At least one Advanced Blocking group is required.",
        tone: "info",
        timeout: 4000,
      });
      return;
    }
    if (formDraft.domainEntries.length === 0 && formDraft.domainGroupNames.length === 0) {
      pushToast({
        message: "At least one domain entry or Domain Group is required.",
        tone: "info",
        timeout: 4000,
      });
      return;
    }
    if (formDraft.startTime === formDraft.endTime) {
      pushToast({
        message: "Start time and end time cannot be the same.",
        tone: "info",
        timeout: 4000,
      });
      return;
    }

    setSubmitting(true);
    try {
      const isNew = editingScheduleId === "new";
      const url = isNew
        ? "/nodes/dns-schedules/rules"
        : `/nodes/dns-schedules/rules/${editingScheduleId}`;
      const method = isNew ? "POST" : "PATCH";

      const res = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formDraft),
      });

      if (!res.ok) {
        const msg = await readApiErrorMessage(
          res,
          `Failed to ${isNew ? "create" : "update"} schedule (${res.status}).`,
        );
        throw new Error(msg);
      }

      const saved = (await res.json()) as DnsSchedule;
      if (isNew) {
        setSchedules((prev) => [saved, ...prev]);
      } else {
        setSchedules((prev) =>
          prev.map((s) => (s.id === saved.id ? saved : s)),
        );
      }

      setEditingScheduleId(null);
      pushToast({
        message: `Schedule "${saved.name}" ${isNew ? "created" : "updated"}.`,
        tone: "success",
        timeout: 3000,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed.";
      pushToast({ message: msg, tone: "error", timeout: 6000 });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Toggle enabled ────────────────────────────────────────────────────────

  const handleToggleEnabled = async (schedule: DnsSchedule) => {
    setTogglingId(schedule.id);
    try {
      const res = await apiFetch(
        `/nodes/dns-schedules/rules/${schedule.id}/enabled`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !schedule.enabled }),
        },
      );
      if (!res.ok) {
        const msg = await readApiErrorMessage(res, "Failed to toggle schedule.");
        throw new Error(msg);
      }
      const updated = (await res.json()) as DnsSchedule;
      setSchedules((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      pushToast({
        message: `"${updated.name}" ${updated.enabled ? "enabled" : "disabled"}.`,
        tone: "success",
        timeout: 2500,
      });
    } catch (e) {
      pushToast({
        message: e instanceof Error ? e.message : "Toggle failed.",
        tone: "error",
        timeout: 4000,
      });
    } finally {
      setTogglingId(null);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDeleteSchedule = (schedule: DnsSchedule) => {
    setDeleteConfirmSchedule(schedule);
  };

  const executeDeleteSchedule = async () => {
    const schedule = deleteConfirmSchedule;
    if (!schedule) return;
    setDeleteConfirmSchedule(null);
    setDeletingId(schedule.id);
    try {
      const res = await apiFetch(`/nodes/dns-schedules/rules/${schedule.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const msg = await readApiErrorMessage(res, "Delete failed.");
        throw new Error(msg);
      }
      setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
      setAppliedState((prev) =>
        prev.filter((e) => e.scheduleId !== schedule.id),
      );
      if (editingScheduleId === schedule.id) {
        setEditingScheduleId(null);
      }
      pushToast({
        message: `Schedule "${schedule.name}" deleted.`,
        tone: "success",
        timeout: 3000,
      });
    } catch (e) {
      pushToast({
        message: e instanceof Error ? e.message : "Delete failed.",
        tone: "error",
        timeout: 4000,
      });
    } finally {
      setDeletingId(null);
    }
  };

  // ── Clone ──────────────────────────────────────────────────────────────────

  const handleCloneSchedule = async (schedule: DnsSchedule) => {
    setCloningId(schedule.id);
    try {
      const draft: DnsScheduleDraft = {
        name: `Copy of ${schedule.name}`,
        enabled: false,
        targetType: schedule.targetType,
        advancedBlockingGroupNames: [...schedule.advancedBlockingGroupNames],
        action: schedule.action,
        domainEntries: [...schedule.domainEntries],
        domainGroupNames: [...(schedule.domainGroupNames ?? [])],
        daysOfWeek: [...schedule.daysOfWeek],
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        timezone: schedule.timezone,
        nodeIds: [...schedule.nodeIds],
        flushCacheOnChange: schedule.flushCacheOnChange,
        notifyEmails: [...(schedule.notifyEmails ?? [])],
        notifyDebounceSeconds: schedule.notifyDebounceSeconds,
        notifyMessage: schedule.notifyMessage,
        notifyMessageOnly: schedule.notifyMessageOnly,
      };
      const res = await apiFetch("/nodes/dns-schedules/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const msg = await readApiErrorMessage(res, "Clone failed.");
        throw new Error(msg);
      }
      const cloned = (await res.json()) as DnsSchedule;
      setSchedules((prev) => [cloned, ...prev]);
      handleEditSchedule(cloned);
      pushToast({
        message: `Cloned as "${cloned.name}". Rename and save to keep changes.`,
        tone: "success",
        timeout: 4000,
      });
    } catch (e) {
      pushToast({
        message: e instanceof Error ? e.message : "Clone failed.",
        tone: "error",
        timeout: 4000,
      });
    } finally {
      setCloningId(null);
    }
  };

  // ── Evaluator controls ────────────────────────────────────────────────────

  const handleToggleEvaluator = async () => {
    if (!evaluatorStatus) return;
    setEvaluatorToggling(true);
    try {
      const res = await apiFetch("/nodes/dns-schedules/evaluator/enabled", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !evaluatorStatus.enabled }),
      });
      if (!res.ok) {
        const msg = await readApiErrorMessage(res, "Failed to toggle evaluator.");
        throw new Error(msg);
      }
      const updated = (await res.json()) as DnsScheduleEvaluatorStatus;
      setEvaluatorStatus(updated);
    } catch (e) {
      pushToast({
        message: e instanceof Error ? e.message : "Toggle failed.",
        tone: "error",
        timeout: 4000,
      });
    } finally {
      setEvaluatorToggling(false);
    }
  };

  const handleRunEvaluator = async (dryRun: boolean) => {
    setEvaluatorRunning(true);
    setShowRunResult(false);
    try {
      const res = await apiFetch("/nodes/dns-schedules/evaluator/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun }),
      });
      if (!res.ok) {
        const msg = await readApiErrorMessage(res, "Evaluator run failed.");
        throw new Error(msg);
      }
      const result = (await res.json()) as RunDnsScheduleEvaluatorResponse;
      setLastRunResult(result);
      setShowRunResult(true);
      pushToast({
        message: dryRun
          ? `Dry run complete: ${result.evaluatedSchedules} schedule(s) evaluated.`
          : `Evaluator ran: ${result.applied} applied, ${result.removed} removed.`,
        tone: "success",
        timeout: 4000,
      });
      await Promise.all([refreshEvaluatorStatus(), refreshAppliedState()]);
    } catch (e) {
      pushToast({
        message: e instanceof Error ? e.message : "Run failed.",
        tone: "error",
        timeout: 5000,
      });
    } finally {
      setEvaluatorRunning(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const appliedScheduleIds = new Set(appliedState.map((e) => e.scheduleId));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="log-alerts">
      <header className="log-alerts__header">
        <div className="log-alerts__header-title">
          <h1>
            <FontAwesomeIcon icon={faBolt} className="log-alerts__header-icon" />
            DNS Schedules
          </h1>
          <p className="log-alerts__header-desc">
            Time-based rules that automatically add or remove Advanced Blocking
            entries on a schedule — great for parental controls, quiet hours, or
            network policy windows.
          </p>
        </div>
        <div className="log-alerts__header-actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => void loadAll()}
            disabled={loading}
            title="Refresh"
          >
            <FontAwesomeIcon
              icon={faRotate}
              className={loading ? "fa-spin" : ""}
            />
            Refresh
          </button>
          {editingScheduleId === null && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={handleNewSchedule}
            >
              <FontAwesomeIcon icon={faPlus} />
              New Schedule
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="log-alerts__error-banner">
          <FontAwesomeIcon icon={faExclamationTriangle} /> {error}
        </div>
      )}

      <TokenStatusCard
        tokenStatus={tokenStatus}
        storageStatus={storageStatus}
        onRevalidate={() => void handleRevalidateToken()}
        revalidating={revalidatingToken}
      />

      {/* Evaluator panel */}
      <div className="log-alerts__evaluator-card">
        <div className="log-alerts__evaluator-header">
          <h2 className="log-alerts__evaluator-title">Schedule Evaluator</h2>
          <div className="log-alerts__evaluator-controls">
            <button
              type="button"
              className={`log-alerts__toggle-btn ${(evaluatorStatus?.enabled ?? false) ? "log-alerts__toggle-btn--on" : "log-alerts__toggle-btn--off"}`}
              onClick={() => void handleToggleEvaluator()}
              disabled={evaluatorToggling || !evaluatorStatus}
              title={evaluatorStatus?.enabled ? "Disable evaluator" : "Enable evaluator"}
            >
              <FontAwesomeIcon
                icon={evaluatorStatus?.enabled ? faToggleOn : faToggleOff}
              />
              <span>{evaluatorStatus?.enabled ? "Enabled" : "Disabled"}</span>
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => void handleRunEvaluator(true)}
              disabled={evaluatorRunning || !evaluatorStatus}
              title="Dry run — checks which schedules would change without making any changes"
            >
              <FontAwesomeIcon icon={evaluatorRunning ? faRotate : faPlay} className={evaluatorRunning ? "fa-spin" : ""} />
              Dry Run
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void handleRunEvaluator(false)}
              disabled={evaluatorRunning || !evaluatorStatus}
              title="Run evaluator now — applies/removes entries as needed"
            >
              <FontAwesomeIcon icon={evaluatorRunning ? faRotate : faBolt} className={evaluatorRunning ? "fa-spin" : ""} />
              Run Now
            </button>
          </div>
        </div>

        {evaluatorStatus && (
          <div className="log-alerts__evaluator-meta">
            <span>
              Interval:{" "}
              <strong>{Math.round(evaluatorStatus.intervalMs / 1000)}s</strong>
            </span>
            <span>
              Token:{" "}
              <strong>
                {evaluatorStatus.tokenReady ? (
                  <span className="log-alerts__ok">
                    <FontAwesomeIcon icon={faCheck} /> Ready
                  </span>
                ) : (
                  <span className="log-alerts__warn">Not ready</span>
                )}
              </strong>
            </span>
            <span>
              Last run:{" "}
              <strong>{formatLocalDateTime(evaluatorStatus.lastRunAt)}</strong>
            </span>
            {evaluatorStatus.lastRunError && (
              <span className="log-alerts__warn">
                Error: {evaluatorStatus.lastRunError}
              </span>
            )}
          </div>
        )}

        {showRunResult && lastRunResult && (
          <div className="dns-schedules__run-result">
            <div className="dns-schedules__run-result-summary">
              {lastRunResult.dryRun && <span className="dns-schedules__dry-run-badge">Dry Run</span>}
              <span>{lastRunResult.evaluatedSchedules} schedule(s) evaluated</span>
              <span>{lastRunResult.applied} applied</span>
              <span>{lastRunResult.removed} removed</span>
              <span>{lastRunResult.skipped} skipped</span>
              {lastRunResult.errored > 0 && (
                <span className="log-alerts__warn">{lastRunResult.errored} error(s)</span>
              )}
            </div>
            {lastRunResult.results.filter((r) => r.action !== "skipped").length > 0 && (
              <table className="dns-schedules__run-table">
                <thead>
                  <tr>
                    <th>Schedule</th>
                    <th>Node</th>
                    <th>Action</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {lastRunResult.results
                    .filter((r) => r.action !== "skipped")
                    .map((r, i) => (
                      <tr key={i} className={r.action === "error" ? "dns-schedules__run-row--error" : ""}>
                        <td>{r.scheduleName}</td>
                        <td>{r.nodeId}</td>
                        <td>
                          <span className={`dns-schedules__action-badge dns-schedules__action-badge--${r.action}`}>
                            {r.action}
                          </span>
                        </td>
                        <td>{r.error ?? r.reason ?? ""}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={() => setShowRunResult(false)}
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* New schedule form */}
      {editingScheduleId === "new" && (
        <div className="log-alerts__rule-card log-alerts__rule-card--new">
          <h3 className="log-alerts__rule-card-title">New Schedule</h3>
          <ScheduleForm
            draft={formDraft}
            onChange={setFormDraft}
            onSave={() => void handleSaveSchedule()}
            onCancel={handleCancelForm}
            submitting={submitting}
            isNew={true}
            availableNodeIds={availableNodeIds}
            availableAbGroups={availableAbGroups}
            availableDomainGroups={availableDomainGroups}
            smtpStatus={smtpStatus}
            knownEmails={knownEmails}
            tokenStatus={tokenStatus}
          />
        </div>
      )}

      {/* Schedules list */}
      <div className="log-alerts__rules-section">
        <div className="log-alerts__rules-header">
          <h2 className="log-alerts__rules-title">
            Schedules ({schedules.length})
          </h2>
        </div>

        {loading && (
          <div className="log-alerts__loading">Loading schedules...</div>
        )}

        {!loading && schedules.length === 0 && editingScheduleId !== "new" && (
          <div className="log-alerts__empty">
            <FontAwesomeIcon icon={faCircleInfo} />
            <p>No schedules configured yet. Create one to get started.</p>
          </div>
        )}

        {schedules.map((schedule) => {
          const isExpanded = expandedIds.has(schedule.id);
          const isEditing = editingScheduleId === schedule.id;
          const isApplied = appliedScheduleIds.has(schedule.id);
          const appliedNodes = appliedState
            .filter((e) => e.scheduleId === schedule.id)
            .map((e) => e.nodeId);

          return (
            <div
              key={schedule.id}
              className={`log-alerts__rule-card ${isApplied ? "dns-schedules__rule-card--active" : ""}`}
            >
              <div className="log-alerts__rule-card-header">
                <div className="log-alerts__rule-card-info">
                  <span className="log-alerts__rule-name">{schedule.name}</span>
                  {isApplied && (
                    <span className="dns-schedules__active-badge" title={`Applied on: ${appliedNodes.join(", ")}`}>
                      <FontAwesomeIcon icon={faBolt} /> Active
                    </span>
                  )}
                  <span className="log-alerts__rule-meta">
                    {schedule.targetType === "built-in"
                      ? "Built-in"
                      : (schedule.advancedBlockingGroupNames ?? []).join(", ") || "—"}{" "}
                    &middot;{" "}
                    {schedule.action === "block" ? "Block" : "Allow"} &middot;{" "}
                    {formatDaysOfWeek(schedule.daysOfWeek)} &middot;{" "}
                    {formatTimeWindow(schedule.startTime, schedule.endTime)} &middot;{" "}
                    {schedule.timezone} &middot;{" "}
                    {schedule.domainEntries.length} entr
                    {schedule.domainEntries.length === 1 ? "y" : "ies"}
                    {(schedule.domainGroupNames?.length ?? 0) > 0
                      ? ` · ${schedule.domainGroupNames.length} group${schedule.domainGroupNames.length === 1 ? "" : "s"}`
                      : ""}
                    {(schedule.notifyEmails?.length ?? 0) > 0
                      ? ` · ${schedule.notifyEmails.length} email${schedule.notifyEmails.length === 1 ? "" : "s"}`
                      : ""}
                    {schedule.nodeIds.length > 0
                      ? ` · nodes: ${schedule.nodeIds.join(", ")}`
                      : ""}
                  </span>
                </div>

                <div className="log-alerts__rule-card-actions">
                  <button
                    type="button"
                    className={`log-alerts__toggle-btn log-alerts__toggle-btn--sm ${schedule.enabled ? "log-alerts__toggle-btn--on" : "log-alerts__toggle-btn--off"}`}
                    onClick={() => void handleToggleEnabled(schedule)}
                    disabled={togglingId === schedule.id}
                    title={schedule.enabled ? "Disable schedule" : "Enable schedule"}
                  >
                    <FontAwesomeIcon
                      icon={
                        togglingId === schedule.id
                          ? faRotate
                          : schedule.enabled
                            ? faToggleOn
                            : faToggleOff
                      }
                      className={togglingId === schedule.id ? "fa-spin" : ""}
                    />{" "}
                    <span className="dns-schedules__toggle-label">
                      {togglingId === schedule.id
                        ? ""
                        : schedule.enabled
                          ? "Enabled"
                          : "Disabled"}
                    </span>
                  </button>

                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      if (isEditing) {
                        handleCancelForm();
                      } else {
                        handleEditSchedule(schedule);
                      }
                    }}
                  >
                    {isEditing ? "Cancel" : "Edit"}
                  </button>

                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void handleCloneSchedule(schedule)}
                    disabled={cloningId === schedule.id}
                    title="Clone schedule"
                  >
                    <FontAwesomeIcon
                      icon={cloningId === schedule.id ? faRotate : faCopy}
                      className={cloningId === schedule.id ? "fa-spin" : ""}
                    />
                  </button>

                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => void handleDeleteSchedule(schedule)}
                    disabled={deletingId === schedule.id}
                    title="Delete schedule"
                  >
                    <FontAwesomeIcon
                      icon={deletingId === schedule.id ? faRotate : faTrash}
                      className={deletingId === schedule.id ? "fa-spin" : ""}
                    />
                  </button>

                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      setExpandedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(schedule.id)) {
                          next.delete(schedule.id);
                        } else {
                          next.add(schedule.id);
                        }
                        return next;
                      });
                    }}
                    title={isExpanded ? "Collapse" : "Expand"}
                  >
                    <FontAwesomeIcon
                      icon={isExpanded ? faChevronUp : faChevronDown}
                    />
                  </button>
                </div>
              </div>

              {isExpanded && !isEditing && (
                <div className="dns-schedules__rule-detail">
                  <div className="dns-schedules__detail-grid">
                    <div>
                      {schedule.targetType === "built-in" ? (
                        <><strong>Target:</strong> Built-in blocking (all clients)</>
                      ) : (
                        <><strong>Group{(schedule.advancedBlockingGroupNames?.length ?? 0) > 1 ? "s" : ""}:</strong> {(schedule.advancedBlockingGroupNames ?? []).join(", ") || "—"}</>
                      )}
                    </div>
                    <div>
                      <strong>Action:</strong>{" "}
                      {schedule.action === "block" ? "Block" : "Allow"}
                    </div>
                    <div>
                      <strong>Days:</strong> {formatDaysOfWeek(schedule.daysOfWeek)}
                    </div>
                    <div>
                      <strong>Window:</strong>{" "}
                      {formatTimeWindow(schedule.startTime, schedule.endTime)}
                    </div>
                    <div>
                      <strong>Timezone:</strong> {schedule.timezone}
                    </div>
                    <div>
                      <strong>Nodes:</strong>{" "}
                      {schedule.nodeIds.length > 0
                        ? schedule.nodeIds.join(", ")
                        : "All nodes"}
                    </div>
                    <div>
                      <strong>Cache flush:</strong>{" "}
                      {schedule.flushCacheOnChange ? "On change" : "Disabled"}
                    </div>
                    <div>
                      <strong>Notifications:</strong>{" "}
                      {(schedule.notifyEmails?.length ?? 0) > 0 ? (
                        <>
                          {schedule.notifyEmails.join(", ")}{" "}
                          <span className="log-alerts__rule-meta">
                            (debounce:{" "}
                            {Math.round(schedule.notifyDebounceSeconds / 60)} min)
                          </span>
                        </>
                      ) : (
                        <span className="log-alerts__rule-meta">None</span>
                      )}
                    </div>
                    {schedule.notifyMessage && (
                      <div>
                        <strong>Email message:</strong>{" "}
                        <span className="log-alerts__rule-meta">{schedule.notifyMessage}</span>
                        <span className="log-alerts__rule-meta">
                          {schedule.notifyMessageOnly
                            ? " (message only)"
                            : " (with technical details)"}
                        </span>
                      </div>
                    )}
                  </div>
                  {(schedule.domainGroupNames?.length ?? 0) > 0 && (
                    <div className="dns-schedules__entries-list">
                      <strong>Domain Groups ({schedule.domainGroupNames.length}):</strong>
                      <ul>
                        {schedule.domainGroupNames.map((name) => (
                          <li key={name}>
                            <code>{name}</code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="dns-schedules__entries-list">
                    <strong>Domain entries ({schedule.domainEntries.length}):</strong>
                    <ul>
                      {schedule.domainEntries.map((entry) => (
                        <li key={entry}>
                          <code>{entry}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {isApplied && (
                    <div className="dns-schedules__applied-nodes">
                      <FontAwesomeIcon icon={faBolt} />
                      <strong>Currently active on:</strong>{" "}
                      {appliedNodes.join(", ")}
                    </div>
                  )}
                </div>
              )}

              {isEditing && (
                <ScheduleForm
                  draft={formDraft}
                  onChange={setFormDraft}
                  onSave={() => void handleSaveSchedule()}
                  onCancel={handleCancelForm}
                  submitting={submitting}
                  isNew={false}
                  availableNodeIds={availableNodeIds}
                  availableAbGroups={availableAbGroups}
                  availableDomainGroups={availableDomainGroups}
                  smtpStatus={smtpStatus}
                  knownEmails={knownEmails}
                  tokenStatus={tokenStatus}
                />
              )}
            </div>
          );
        })}
      </div>

      <ConfirmModal
        isOpen={deleteConfirmSchedule !== null}
        title="Delete schedule"
        message={`Delete "${deleteConfirmSchedule?.name}"? This will not immediately remove applied entries from Advanced Blocking — wait for the evaluator to deactivate them, or remove them manually.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void executeDeleteSchedule()}
        onCancel={() => setDeleteConfirmSchedule(null)}
      />
    </section>
  );
}

export default AutomationPage;
