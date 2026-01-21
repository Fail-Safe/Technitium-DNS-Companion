<!--
	Keep a Changelog: https://keepachangelog.com/en/1.1.0/
	Semantic Versioning: https://semver.org/spec/v2.0.0.html
-->

# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Health Check API: Enhanced health check endpoint with basic (`/api/health`) and detailed (`/api/health?detailed=true`) modes
  - Basic mode: Fast health check suitable for Docker container health checks
  - Detailed mode: Comprehensive health information including node connectivity status and cluster information
  - Public endpoint (no authentication required) for monitoring systems and load balancers
  - See [docs/features/HEALTH_CHECK_API.md](docs/features/HEALTH_CHECK_API.md) for complete documentation
- Query Logs: domain tooltip enrichment for blocked entries (“Likely blocked by”), using a best-effort per-node domain-list check with debounce (~300ms) + caching, Top 3 results with Show more/less, mobile-friendly fetch-on-open, de-duplicated matches, improved wrapping for long URLs/regex, and documented XSS mitigations around tooltip HTML rendering.

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

- Optional session-based authentication behind `AUTH_SESSION_ENABLED=true`, using HttpOnly cookies and server-side session storage.
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
- When `AUTH_SESSION_ENABLED=true`, the backend requires HTTPS and supports TLS-terminating reverse proxies via `TRUST_PROXY=true`.

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

[Unreleased]: https://github.com/Fail-Safe/Technitium-DNS-Companion/compare/v1.3.1...HEAD
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
