<!--
	Keep a Changelog: https://keepachangelog.com/en/1.1.0/
	Semantic Versioning: https://semver.org/spec/v2.0.0.html
-->

# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [1.6.1] - 2026-04-14

### Added

- DNS Schedules: eager `TECHNITIUM_SCHEDULE_TOKEN` validation at startup. The token is now probed against the configured nodes during boot (not just lazily on first UI request) so missing `Apps: Modify` permission, missing `Cache: Modify` permission, an invalid token, or a transient connectivity issue surfaces as a `WARN [TechnitiumService] TECHNITIUM_SCHEDULE_TOKEN …` line in the boot log instead of when the next schedule fires hours later.
- SQLite query-logs nightly maintenance: one-time `auto_vacuum=INCREMENTAL` migration on first boot (one full `VACUUM` to switch modes — fast on small DBs, may take 30s–2min on multi-GB DBs), then a daily timer at ~3:30 AM ± 10 min local time that runs `PRAGMA wal_checkpoint(TRUNCATE)` + `PRAGMA incremental_vacuum(1000)`. Without this, retention prunes never returned freed pages to the OS and the WAL could grow unbounded behind long-held read transactions. Gated by `QUERY_LOG_SQLITE_AUTO_VACUUM_MIGRATION` (default `true`) so operators with very large existing DBs can defer the migration. `companion.sqlite` gets a smaller treatment: `PRAGMA optimize` on graceful shutdown to keep query plans fresh.

### Changed

- Navbar: DNS Schedules now precedes DNS Rule Optimizer (frequency-of-use ordering — Schedules is daily-use, Rule Optimizer is occasional maintenance).
- Log Alert Rules page: schedule-linked rules now display the friendly schedule name (e.g. "Nighttime YouTube Block (Flo)") instead of the internal `__schedule:UUID__` link key. A "schedule-managed" badge appears next to the heading. Edit / Disable / Delete buttons are disabled for schedule-linked rules with a tooltip directing the user to edit the schedule on the Automation page (the evaluator overwrites manual edits on every tick anyway). Clone strips the link prefix and uses the schedule's friendly name as the source, producing a clean standalone rule.
- `[TechnitiumService]` cluster timing settings warning is no longer emitted on transient network failures. The previous WARN ("admin permissions may be required") was misleading whenever the underlying error was actually a network blip — network errors now route to DEBUG alongside other expected non-critical cases (400/401/403/404). Empty error messages are also coalesced to a fallback string so the log never renders as `…: . Using default polling intervals.`.

### Fixed

- **DNS Schedules: write Advanced Blocking config to the cluster Primary only.** Previously the evaluator iterated every node and called `setConfig` on each one, racing Technitium's own config replication. Writes to secondaries got reverted on the next sync round, the next evaluator tick saw entries missing and re-applied, and the cycle repeated every minute — visible as repeating `Re-applied schedule "…" — DG entries updated` log lines. Cache flush still hits all physical nodes since it's a per-node runtime operation, not replicated. New `TechnitiumService.resolveClusterWriteTargets()` returns `{writeTarget, flushNodes}` per candidate so multiple secondaries of the same cluster collapse to one Primary write per tick. `dns_schedule_state` now tracks Primaries; pre-existing per-secondary state rows are benign and age out on subsequent disable/cleanup.
- DNS Schedules: cluster topology probe inside the evaluator now uses the schedule token (`authMode: "schedule"`). Previously `listNodes()` always probed with session auth, but the evaluator timer runs outside any HTTP request context so `AuthRequestContext.getSession()` returned undefined and every node appeared `Standalone` — silently defeating the Primary-routing fix above. `listNodes()` now accepts an `authMode` option (default unchanged for HTTP callers).
- DNS Schedules: evaluator's remove path no longer silently succeeds when the cluster snapshot fetch fails. Previously, a transient `ECONNRESET` during a window-close tick would let `removeAdvancedBlockingScheduleFromNode` early-return, the caller would still call `markRemoved`, state would clear, and entries would be orphaned — staying live in Technitium while the schedule's tracking thought it had cleaned up. Now throws so the next tick retries until the node is reachable again.

### Testing

- 7 new unit tests for `TechnitiumService.resolveClusterWriteTargets` covering all topology permutations: standalone-only, single-cluster collapse, two independent clusters, mixed standalone + clustered, missing-Primary fallback with WARN, unknown-node passthrough.
- 6 new tests for `logScheduleTokenValidationOutcome` covering each WARN/LOG branch (full-permission success, missing Apps:Modify, missing Cache:Modify, transient network error with retry hint, invalid-token without retry hint, opt-out silence).
- 4 new tests for `getClusterSettings` error classification (network → DEBUG, 403 → DEBUG, 5xx → WARN, empty-message fallback string).
- 5 new tests for `QueryLogSqliteService` SQLite maintenance (NONE→INCREMENTAL migration, no-op when already INCREMENTAL, env opt-out, page reclamation via `runMaintenance`, no-op when DB is closed).
- 3 new tests for `DnsSchedulesEvaluatorService` snapshot-error symmetry (apply throws when snapshot has error, remove throws when snapshot has error, remove proceeds normally on healthy snapshot).

## [1.6.0] - 2026-03-29

### Added

- DNS Schedules: time-window-based blocking/allow rules with day-of-week selection (any subset of Sun–Sat, or every day), start/end time, and full IANA timezone support (evaluates windows in the schedule's configured timezone, not the server clock). Schedules are bidirectional — entries are added when the window opens and cleanly removed when it closes, leaving manually-managed entries untouched.
- DNS Schedules: support for multiple Advanced Blocking groups per schedule (previously limited to one group).
- DNS Schedules: Domain Group integration — bind Domain Groups as the domain source for a schedule instead of (or in addition to) manually listed entries.
- DNS Schedules: optional cache flush on window activate and deactivate, ensuring DNS resolvers pick up changes immediately without waiting for TTL expiry.
- DNS Schedules: email notifications when blocked domains are queried during an active window — configurable recipients, per-schedule debounce interval, and an optional custom message prepended to alert emails. Set `notifyMessageOnly` to send only the custom message body (no technical details).
- DNS Schedules: Clone button on each schedule card — creates a disabled "Copy of {name}" draft pre-filled with the source schedule's settings, then opens it for editing.
- DNS Schedules: schedule token status now reports `hasCacheModify` permission so the UI can surface a clear error when the token lacks cache-flush capability.

### Changed

- DNS Schedule alert emails now use a human-readable subject line (`DNS Schedule alert: {schedule name}`) instead of the internal rule name (`__schedule:uuid__`).
- Delete schedule confirmation now uses the app's `ConfirmModal` (danger variant with animated slide-in and mobile bottom-sheet) instead of a browser `window.confirm` dialog.
- Background token security banner is no longer shown when the validation failure was caused by a transient connectivity error, preventing false-positive "token too privileged" warnings during temporary network hiccups.
- Mobile CSS improvements for the Automation page: form grids collapse to a single column at 640px, the run-result table scrolls horizontally instead of overflowing, the enable/disable toggle label is hidden at 480px, and the timezone row stacks vertically at 480px.

### Fixed

- DNS Schedules: disabling a schedule that is currently active now immediately removes its Applied Blocking entries from all nodes instead of leaving them until the next evaluator tick. The linked alert rule window is also closed synchronously.
- DNS Schedules: evaluator now performs a cleanup pass each tick to remove applied entries belonging to disabled or deleted schedules. Covers retroactive cases where the controller-level deactivation fix was deployed after a schedule had already been left in an applied state.
- DNS Schedules: switched from per-domain cache flush to full node cache flush on schedule apply/remove, ensuring subdomain entries (e.g. `www.example.com`) are also evicted when a parent domain changes.
- DNS Schedules: re-applies domain entries on every evaluator tick when a schedule window is active, so domains added to a bound Domain Group during an active window take effect immediately without requiring the window to close and reopen.
- DNS Schedules: alert rule domain patterns now match only the schedule's configured domains (manual entries plus resolved Domain Group entries) instead of the entire Advanced Blocking group. Patterns are also re-synced automatically whenever Domain Group entries are added, updated, or removed.
- DNS Schedules: alert email subject lines now correctly show the schedule's display name after the schedule is updated. Previously, rules created before display name support was added showed the internal `__schedule:UUID__` name; affected schedules self-heal on the next evaluator tick.
- Domain Management: "Apply to DNS" button now appears in the Domains tab footer when Domain Group bindings are pending, allowing bindings to be applied without switching to the Domain Groups tab.
- Domain Groups: fixed a render inconsistency after renaming a group where the right panel briefly showed the new name while the group list and binding chips still displayed the old name. Both fetches now run in parallel so the UI updates atomically.
- Log Queries: fixed app discovery incorrectly filtering on `isQueryLogger` (write-only sink) instead of `isQueryLogs` (required for log querying). Apps like Log Exporter that only implement the write interface were incorrectly selected, causing `class path not found` errors from Technitium when attempting to query logs.
- DNS Schedules: fixed a silent `RENAME COLUMN` migration failure on existing databases — a prior `replace_all` edit accidentally made the migration a self-rename no-op (`advanced_blocking_group_name → advanced_blocking_group_name`), causing all queries using the plural column name to fail at runtime with "no such column". The migration now correctly renames `advanced_blocking_group_name` to `advanced_blocking_group_names`.
- Security: updated `nodemailer` to 8.0.4 and `yaml` to 2.8.3; added npm overrides forcing `handlebars@4.7.9`, `path-to-regexp@8.4.0`, and `serialize-javascript@7.0.5` to resolve Dependabot advisories.

### Testing

- DNS Schedules unit tests: 119 tests across three suites — evaluator service (24: window logic, overnight windows, day-of-week gating, IANA timezones, apply/remove, cache flush, notification debounce), service CRUD (48: schema migration, all fields including `notifyMessage`), and controller `parseDraft` (47: validation and parsing for every field).
- Automation page E2E: 10 Playwright tests (Firefox) covering schedule create, edit, clone, delete via `ConfirmModal`, enable/disable toggle, evaluator manual run, and email notification field visibility.

## [1.5.2] - 2026-03-10

### Fixed

- DNS Logs: fixed app discovery selecting write-only log exporter apps (implementing `IDnsQueryLogger`) instead of queryable log apps (implementing `IDnsQueryLogs`). Apps like Log Exporter that only write logs will no longer be selected as the query source, preventing the `'LogExporter.App' class path was not found` error from Technitium. Error messaging now clearly directs users to install the "Query Logs (Sqlite)" app.

## [1.5.1] - 2026-03-06

### Fixed

- Log Alerts: fixed boot crash (`no such table: log_alert_settings`) on fresh installations where `LogAlertsEvaluatorService.onModuleInit` queries evaluator settings before `LogAlertsRulesService.onModuleInit` has created the schema. Schema is now initialized lazily on first use via an idempotent `ensureSchema()` guard.

## [1.5.0] - 2026-03-06

### Added

- Query Logs: added a client-side Domain Exclusion List (`Exclude Domains`) with wildcard support (`*`), persisted to localStorage for per-browser noise reduction.
- Domain Groups: added global SQLite-backed Domain Group CRUD (enabled by default; disable with `DOMAIN_GROUPS_ENABLED=false`) with optional group descriptions, per-entry notes, bindings to Advanced Blocking groups, materialization preview, apply/dry-run endpoints with conflict blocking and cluster primary-write guard (override via `allowSecondaryWrites=true`), and unified export/import with configurable `domainsMode` and `domainGroupsMode` merge strategies.
- Domain Groups: apply operation uses a three-pass tracking model that records what each Domain Group last wrote per (Advanced Blocking group, action) pair, enabling zero-data-loss first-apply semantics — manually-added entries are never overwritten, and DG-managed entries are cleaned up automatically when bindings are removed.
- Domain Groups (UX): drag Domain Group pills onto Advanced Blocking groups to bind them; active bindings are shown as chip summaries within each group's expanded view.
- Domain Groups (UX): small layer icon on domain chips that are present via a Domain Group; count badge tooltip shows DG-managed vs manual domain breakdown per group.
- Domain Groups (UX): informational toast when attempting to drag-remove a DG-managed domain (entries managed by Domain Groups must be removed from the Domain Group itself).
- Domain Groups (UX): informational toast when dropping a domain onto a group that already contains it.
- Log Alerts Rules (MVP): added SQLite-backed rule storage and CRUD/enable-toggle endpoints, plus Logs page rule management UI (create/list/delete/enable-disable) alongside existing SMTP test workflow.
- Log Alerts Evaluator (MVP): added rule-evaluation status/manual-run endpoints and backend evaluator logic to scan recent stored logs, apply selector/pattern/debounce checks, and send SMTP rule alert summaries.
- Configuration Sync: Primary + Secondaries mode now fully operational — select a primary node and diff/sync its Advanced Blocking config to each secondary independently or all at once.

### Changed

- DNS Filtering and Rule Optimizer: improved Advanced Blocking capability detection by preferring `blockingStatus` node install state, with fallback to node app discovery.
- Docker Compose: replaced `wget`-based healthcheck probe with a Node.js HTTP/HTTPS probe (with protocol fallback) so checks work in minimal images without extra OS utilities.
- Persistence: consolidated Domain Groups and Log Alert Rules from two separate SQLite databases into a single `companion.sqlite` (controlled by `COMPANION_DB_PATH`, default `/app/config/companion.sqlite`). Query log cache remains its own file. Removes the `DOMAIN_GROUPS_SQLITE_PATH` and `LOG_ALERT_RULES_SQLITE_PATH` env vars (neither had shipped in a release).
- Docker Compose (production): `./data` is now bind-mounted to `/app/config` by default, so `companion.sqlite` and `query-logs.sqlite` survive `docker compose up --force-recreate` and image rebuilds without any extra setup.
- Log Alerts: `advanced_blocking_group_name` SQLite column renamed to `advanced_blocking_group_names`; a startup migration runs automatically via `PRAGMA table_info` so existing databases upgrade silently.
- Snapshot services (DHCP History, DNS Filtering History, Zone History): refactored to share a common `SnapshotFileStore` base class, standardizing directory resolution, retention pruning, and atomic writes across all three.
- Configuration Sync: sync helper functions (`computeGroupDiffs`, `computeConfigDifferences`, `computeSyncPreview`) extracted to module scope to support per-secondary diffs in P+S mode without duplicating logic.
- Toast notifications: position adjusted from `1.5rem` to `2rem` from the top-right edge for a more comfortable placement.
- Domain Groups (UX): added a `--pending-sibling` modifier style for binding chips whose partner binding in the same (group, action) pair has a pending change.

### Fixed

- DNS Filtering: fixed live search not applying filter results correctly, a save-on-change bug, a missing regex pattern guard, and improved rendering performance on large lists.
- DNS Filtering bootstrap resilience: node configuration fetch now retries transient failures, emits a load-failed UI event, and surfaces clearer user feedback via toast + inline banner.
- Domain Groups: fixed N+1 SQL queries in the materialization pending-pairs check and apply tracking bulk-load path.
- Domain Groups (UX): groups card header now uses flex-start layout so controls stay left-aligned in single-node (non-clustered) mode.
- Domain Groups (UX): fixed white-on-white text when hovering an already-selected Domain Group button.
- Rule Optimizer availability and nav gating now handle pre-auth / post-login capability hydration more reliably (reduces false negatives until full state is loaded).
- Configuration Sync: Primary + Secondaries mode no longer shows a blank UI — `targetNode` was always resolving to `undefined` in P+S mode, causing all diff/sync gates to fail silently.
- Configuration Sync: sync completion now shows a success toast; previously the post-sync `reloadAdvancedBlocking()` re-render could swallow in-component success state before it rendered.

### Docs

- Added `AGENTS.md` with project structure, development conventions, and build/test commands for agentic coding assistants and contributors.
- Docker guide now documents healthcheck probe behavior and quick verification commands.
- Query Logs filtering docs now include the Domain Exclusion List behavior (UI-only, wildcard matching, local persistence).

## [1.4.1] - 2026-02-18

### Fixed

- Login path stability: fixed a `Maximum update depth exceeded` render loop in `TechnitiumProvider` app-capability checks by deduplicating in-flight node app requests and avoiding no-op node state rewrites.

## [1.4.0] - 2026-02-14

### Added

- Health Check API enhancements and documentation:
  - Basic endpoint for container/liveness checks (`/api/health`)
  - Detailed endpoint for authenticated diagnostics (`/api/health/detailed`)
- Rule Optimizer UX hardening for safer incremental cleanup:
  - In-app apply confirmation flow (no browser confirm)
  - Redundant-regex cleanup mode with explicit messaging
  - Consistent pre/post-apply verification language and badges
- Query Logs blocked-domain insight improvements with tooltip enrichment and safer rendering guidance.

### Changed

- Authentication model finalized for v1.4:
  - Session-auth is now the interactive UI path
  - Legacy no-login interactive mode removed
- Frontend architecture and UX consistency improvements:
  - Unified snapshot drawer scaffolding and naming
  - App shell/theme context wiring cleanup
- Docker and build pipeline refinements for more reliable local and CI workflows.

### Removed

- `TECHNITIUM_CLUSTER_TOKEN` support removed.
- Cluster-token migration UI/API flow removed in favor of background-token model.

### Security

- Session-auth path enforces secure deployment expectations (HTTPS/self-signed support in backend runtime path).
- Background token model remains least-privilege focused; cluster-token path is fully retired.

### Docs

- Updated auth/session migration, health check API, and release notes documentation for the v1.4 model.

## [1.3.1] - 2026-01-10

### Added

- Query Logs: Paginated rows-per-page setting in “Table settings” (25/50/100/200), defaulting to 25.
- Query Logs: subtle “Source” pills to show whether results are Live (Nodes) or Stored (SQLite), plus an optional DB cache hit-rate pill when available.
- Query Logs (Stored/SQLite): response cache stats surfaced via the storage status endpoint (hits/misses/evictions/expired/size).

### Changed

- Query Logs: improved header stickiness by using a scroll-container approach (more reliable in Firefox).
- Frontend: header now measures itself and sets `--app-header-height` for consistent sticky offsets.

### Fixed

- Query Logs: paginated requests no longer force backend cache bypass; stored (SQLite) views can now benefit from short-TTL response caching.
- Query Logs: paging (Prev/Next/jump) pauses auto-refresh so the inspected page doesn’t reshuffle while you’re reading it.
- Query Logs: prevent “jump to top” when paging by keeping the current table visible during subsequent loads.

## [1.3.0] - 2026-01-09

### Added

- Query Logs: custom right-click context menu to copy the value under the cursor (Shift+right-click preserves the native browser context menu).
- Query Logs: optional SQLite rolling query log store for accurate time-window browsing (e.g., “Last 24h”), including new stored-log endpoints and a storage status endpoint.
- Query Logs: support `statusFilter=blocked|allowed` filtering.
- Configuration: DNS Filtering History (snapshots) for both Built-in Blocking and Advanced Blocking (create/list/view/pin/note/restore/delete), including best-effort automatic snapshot creation before Advanced Blocking saves.
- DHCP: “Preserve Offer Delay Time” option for scope clone and bulk sync.
- Split Horizon PTR: PTR record management with safe deletions, adoption of existing records, sync workflow, and history/zone snapshots.

### Changed

- Query Logs: live refresh pauses while the custom context menu is open and when an End Date/Time is set; results are ignored while the menu is open to prevent row-jumps under the cursor.
- Query Logs: date presets are disabled with tooltips when stored logs are unavailable.
- Query Logs: improved paging stability, including “click page indicator to jump to page”.
- Authentication: improved session-expiration handling and redirect/toast consistency.
- Configuration: improved domain entry sort + drag behavior.
- Frontend: added `useAuth`, `useToast`, and `useTechnitiumState` hooks and stabilized Context instances to avoid Vite HMR Provider/Consumer mismatches.

### Fixed

- PWA: reduced stale shell/cache pitfalls.

### Docs

- Query Logs: documented the optional SQLite rolling query log store and cross-linked it from server-side filtering docs.
- Docs: formatting/section-header consistency updates.

### Testing

- Advanced Blocking: added unit tests for config serialization/normalization and added backend e2e coverage for save/get round-trip (including numeric-string normalization).
- Frontend: added tests for `apiFetch` network/unauthorized event behavior.
- E2E: made Playwright mock backend deterministic.

## [1.2.5] - 2025-12-28

### Added

- DNS Lookup (All Domains): added a Text-mode “Exact Match” panel so you can confirm whether a domain exists in any list even when it’s not visible on the current page.
- DNS Lookup (All Domains): added a Regex preview panel (match count + sample matches) with a Hide/Show toggle persisted to localStorage.

### Changed

- Domain Lists (All Domains): improved paging stability and added optional deterministic ordering via `sort=domain`.
- Docker Compose: clarified default image usage vs optional local build configuration.

### Fixed

- Reduced backend CPU/memory spikes on “All Domains” by building list `sources` only for the requested page slice.

## [1.2.4] - 2025-12-27

### Added

- DHCP Bulk Sync results now include structured per-scope configuration `differences`, rendered as a readable list in the results modal.
- DHCP Bulk Sync “Sync Preview” now reports Ping Before Offer changes (including timeout and retries) per target node.
- Added unauthenticated `/api/health` endpoint for Docker health checks (compatible with session-auth mode).
- Zones: per-zone records search that matches Name + Type + Data.
- Zones: record data display mode selector (Auto/Raw/Pretty/Parsed) persisted to localStorage.

### Changed

- DHCP bulk sync comparisons now cover the full DHCP scope configuration (including Ping Before Offer fields), preventing false “matches target” scenarios.
- DHCP Bulk Sync preview state now refreshes after a sync completes so the UI does not keep showing stale pre-sync diffs.
- Docs: expanded session-auth guidance and documented v1.3/v1.4 planned variable deprecations in `.env.example`, `docker-compose.yml`, and `README.md`.
- Docker dev/prod health checks now use `/api/health` instead of auth-protected endpoints.
- Zones: improved cluster-aware rendering (avoid repeating per-node cards in cluster mode).
- Zones: enhanced node accent styling (20 deterministic accents) and applied accents consistently within node details.
- Zones: improved record data Auto formatting for nested JSON strings and PTR-style single key/value payloads.
- Zones: capped zone card grid to a maximum of 3 columns on wide screens for better record readability.

### Fixed

- DHCP Scopes page now renders correctly on small screens (tab switcher overflow) and the DHCP Scope History pull button no longer gets hidden behind the sticky footer.
- Fixed false Docker “unhealthy” status when session auth is enabled (healthcheck no longer hits `/api/nodes`).

## [1.2.3] - 2025-12-26

### Fixed

- Fixed Docker images boot-looping due to missing runtime dependencies in npm workspaces (hoisted deps like `@nestjs/common` were not present in the final image). (#26)

### Changed

- CI: generate Docker metadata tags for PR and branch builds to avoid “no tags generated” warnings during PR builds.

## [1.2.2] - 2025-12-26

### Fixed

- Reduced excessive DNS lookups during Query Logs auto-refresh by reusing keep-alive HTTPS agents for Technitium API calls and caching cluster hostname resolution results (#23). (Thanks to @durandguru for the report!)

## [1.2.1] - 2025-12-25

### Added

- Optional session-based authentication (now required in v1.4+) using HttpOnly cookies and server-side session storage.
- Dedicated `TECHNITIUM_BACKGROUND_TOKEN` support so background PTR/hostname work can run safely in session-auth mode.
- Guided migration from `TECHNITIUM_CLUSTER_TOKEN` → `TECHNITIUM_BACKGROUND_TOKEN`, including token creation + validation.
- Backend Jest tests and frontend Vitest/RTL tests covering the new auth + migration flows.
- Support for Technitium AdvancedBlockingApp v10+ refresh interval minutes via `blockListUrlUpdateIntervalMinutes`.
- UI inputs for list source refresh interval in hours + mins.

### Changed

- Auth UX only requires the login page when session auth is enabled.

### Fixed

- Reduced/no-op behavior for background PTR warming when it cannot run (e.g., no request/session context), preventing noisy failures.
- Request-context middleware registration to avoid intermittent auth/session issues across routes.
- List source refresh interval no longer appears stuck due to a cached reload after saving.
- Minutes input UX: allows clearing the default `0` while typing (prevents "0" from snapping back mid-edit).
- Added frontend regression test for the minutes input editing behavior.

### Security

- Token capability validation for `TECHNITIUM_BACKGROUND_TOKEN` (must be least-privilege); unsafe/unverifiable tokens disable background PTR warming and surface warnings.
- Implemented a session-token-first approach using Technitium `/api/user/login` expiring tokens (no long-lived admin API tokens by default), while preserving backwards-compatible env-token “service mode”.
- When using session auth, the backend requires HTTPS and supports TLS-terminating reverse proxies via `TRUST_PROXY=true`.

## [1.1.6] - 2025-12-13

### Added

- Automatic snapshot creation before bulk sync kicks off, ensuring every affected node has a rollback point without any manual prep.
- Zero-scope onboarding flow that surfaces a guided form for creating the very first DHCP scope on a node without leaving the Scopes tab.
- Guided bulk sync modal entry point inside the zero-scope panel so empty nodes can clone a working configuration with one click.
- DHCP Scope History drawer that lists snapshots, exposes pin/restore/delete/note actions, and surfaces success toasts after restores.
- Drawer-pull button plus supporting layout styles so the history drawer is reachable from mobile and desktop alike.
- About modal now performs a cached (12-hour) GitHub release check and highlights when a newer version of Technitium DNS Companion is available.

### Changed

- “Launch guided bulk sync” now preserves the active Scopes tab and automatically re-focuses it after closing the dialog to keep users oriented.
- Guided bulk sync modal now uses a dedicated overlay + dialog layout, ensuring it renders centered above the page with consistent spacing on desktop and mobile.
- Inline bulk sync workflow preloads scope details for diff previews, adds loading/empty states, and clarifies node/strategy messaging so administrators can trust the preview before syncing.
- Confirm modal buttons and global button styles were refreshed (ghost variant, consistent spacing) to match the latest UI system and improve accessibility.
- Snapshot drawer controls now share the same visual language as the rest of the UI, making pinning, note editing, and restore confirmation dialogs feel native.

### Fixed

- Guided bulk sync dialog no longer appears inline at the bottom of the page; the overlay fully covers the viewport and traps focus like a proper modal.
- Snapshot drawer interactions now emit success messaging after restores so operators know when scopes have been rolled back.

## [1.1.5] - 2025-12-11

### Added

- Bulk DHCP sync workflow that copies scopes across nodes, complete with diff previews, backend safeguards, and updated documentation (#16).
- Expanded UI visual guide with before/after comparisons to document the refreshed design language.

### Changed

- Frontend test stack now includes `@testing-library/user-event`, making interaction-heavy tests far easier to author.

## [1.1.4] - 2025-12-10

### Added

- OCI-compatible Docker image annotations (org.opencontainers labels) so deployed containers report version metadata automatically.

## [1.1.3] - 2025-12-10

### Added

- MkDocs-powered documentation site (with image lightbox support and example environment files) for easier onboarding (#14).
- Built-in blocking enhancements, wildcard-aware zone sorting, and major DHCP page refactors that pave the way for future automation (#11/#12/#13).

### Changed

- Docker quickstart docs were rewritten for clarity, including refreshed screenshots and streamlined copy/paste helpers.

## [1.0.6] - 2025-12-04

### Added

- Reusable `ConfirmModal` component that replaces browser dialogs and standardizes destructive-action prompts across the app.

### Fixed

- Cluster settings retrieval now logs actionable errors, and DHCP domain search lists correctly mark modifications.

## [1.0.5] - 2025-12-02

### Fixed

- Cluster node auto-detection now resolves DNS names even when nodes are referenced by IP-based `baseUrl` values, preventing mismatched writes.

## [1.0.4] - 2025-12-02

### Added

- End-to-end Docker build hardening: BuildKit cache mounts, GHCR workflow, rollup/esbuild platform fixes, and version tagging inside published images.
- First wave of UI polish including About modal, DNS Lookup rename, and mobile-friendly tweaks spanning DHCP + configuration pages (#3-#6).
- Built-in blocking management UI plus supporting backend hooks for advanced filtering (#7).

### Fixed

- Sample configs, README quickstart commands, and Docker docs were cleaned up for public consumption.

## [1.0.0] - 2025-11-24

- Initial public release of Technitium DNS Companion with responsive React frontend, NestJS backend, and multi-node Technitium DNS management.

[Unreleased]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.5.1...HEAD
[1.5.1]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.2.5...v1.3.0
[1.2.5]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.2.4...v1.2.5
[1.2.4]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.1.6...v1.2.1
[1.1.6]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.1.5...v1.1.6
[1.1.5]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.0.6...v1.1.3
[1.0.6]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.0.0...v1.0.4
[1.0.0]: https://github.com/Fail-Safe/Technitium-DNS-Companion/releases/tag/v1.0.0
