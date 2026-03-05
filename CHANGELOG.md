<!--
	Keep a Changelog: https://keepachangelog.com/en/1.1.0/
	Semantic Versioning: https://semver.org/spec/v2.0.0.html
-->

# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

### Changed

- DNS Filtering and Rule Optimizer: improved Advanced Blocking capability detection by preferring `blockingStatus` node install state, with fallback to node app discovery.
- Docker Compose: replaced `wget`-based healthcheck probe with a Node.js HTTP/HTTPS probe (with protocol fallback) so checks work in minimal images without extra OS utilities.
- Persistence: consolidated Domain Groups and Log Alert Rules from two separate SQLite databases into a single `companion.sqlite` (controlled by `COMPANION_DB_PATH`, default `/app/config/companion.sqlite`). Query log cache remains its own file. Removes the `DOMAIN_GROUPS_SQLITE_PATH` and `LOG_ALERT_RULES_SQLITE_PATH` env vars (neither had shipped in a release).
- Docker Compose (production): `./data` is now bind-mounted to `/app/config` by default, so `companion.sqlite` and `query-logs.sqlite` survive `docker compose up --force-recreate` and image rebuilds without any extra setup.
- Log Alerts: `advanced_blocking_group_name` SQLite column renamed to `advanced_blocking_group_names`; a startup migration runs automatically via `PRAGMA table_info` so existing databases upgrade silently.
- Snapshot services (DHCP History, DNS Filtering History, Zone History): refactored to share a common `SnapshotFileStore` base class, standardizing directory resolution, retention pruning, and atomic writes across all three.

### Fixed

- DNS Filtering: fixed live search not applying filter results correctly, a save-on-change bug, a missing regex pattern guard, and improved rendering performance on large lists.
- DNS Filtering bootstrap resilience: node configuration fetch now retries transient failures, emits a load-failed UI event, and surfaces clearer user feedback via toast + inline banner.
- Domain Groups: fixed N+1 SQL queries in the materialization pending-pairs check and apply tracking bulk-load path.
- Domain Groups (UX): groups card header now uses flex-start layout so controls stay left-aligned in single-node (non-clustered) mode.
- Domain Groups (UX): fixed white-on-white text when hovering an already-selected Domain Group button.
- Rule Optimizer availability and nav gating now handle pre-auth / post-login capability hydration more reliably (reduces false negatives until full state is loaded).

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

[Unreleased]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.4.1...HEAD
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
