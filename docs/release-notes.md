# Release Notes

## 1.4.0

- **Authentication model finalized**:
  - Interactive UI now runs with session-based auth as the supported path.
  - Legacy no-login interactive mode has been removed.
  - `TECHNITIUM_CLUSTER_TOKEN` and migration UX/API are removed; use `TECHNITIUM_BACKGROUND_TOKEN` for background work.

- **Health checks improved for production operations**:
  - `GET /api/health` is optimized for Docker/liveness checks.
  - `GET /api/health/detailed` provides authenticated diagnostics for deeper monitoring.

- **Rule Optimizer UX safety and clarity pass**:
  - Preview/apply flow now uses explicit in-app confirmation.
  - Redundancy-aware actions identify already-covered domains and offer **Remove redundant regex** semantics.
  - Post-apply verification messaging and badges are clearer for rollback confidence.

- **Frontend consistency + snapshot UX cleanup**:
  - Snapshot drawer patterns were unified to reduce UI drift across configuration surfaces.
  - App shell/theme/context wiring was cleaned up for more predictable behavior.

- **Query Logs blocked-domain insight improvements**:
  - Improved “Likely blocked by” tooltip behavior, including caching/debounce and clearer UX.

### Upgrade notes

- If you still rely on `TECHNITIUM_CLUSTER_TOKEN`, migrate to `TECHNITIUM_BACKGROUND_TOKEN` before or during this upgrade.
- Verify your deployment is configured for session-auth expectations (HTTPS/TLS path as documented).
- For Docker health checks, point probes to `/api/health`.

### Tonight release sanity pass

1. Confirm `CHANGELOG.md` includes `## [1.4.0] - 2026-02-14` on the tagged commit.
2. Confirm environment docs/examples no longer imply `TECHNITIUM_CLUSTER_TOKEN` usage.
3. Run backend build/tests and frontend build smoke checks.
4. Tag from the intended release commit and push `v1.4.0`.

## 1.3.1

- **Query Logs: paginated page size setting**: Rows-per-page is now configurable in “Table settings” (25/50/100/200) and defaults to **25** for new installs.
- **Query Logs: paging stability**:
  - Clicking **Prev/Next/jump-to-page** now automatically pauses auto-refresh so the page you’re inspecting doesn’t reshuffle while you read it.
  - Paging no longer “jumps to the top” (keeps the table visible during reloads).
- **Query Logs: performance + clarity**:
  - Stored (SQLite) endpoints use a short-TTL response cache to reduce repeated recomputation during frequent polling.
  - UI shows subtle “Source” pills (Live Nodes vs Stored SQLite) and can display a DB cache hit-rate indicator when available.

No config changes are required to upgrade. Optional tuning is available via `QUERY_LOG_SQLITE_RESPONSE_CACHE_TTL_MS` and `QUERY_LOG_SQLITE_RESPONSE_CACHE_MAX_ENTRIES`.

## 1.2 (Draft)

- **Session authentication**: Users sign in with their Technitium DNS credentials (TOTP/2FA supported). (v1.4+: required for interactive UI).
- **Planned v1.3+ direction**: Session auth was expected to become the default (and eventually required) in a follow-up release.
- **Safer background token model**: Background PTR lookups run using `TECHNITIUM_BACKGROUND_TOKEN` (validated for least privilege).
- **Guided migration from cluster token**: This existed in earlier versions, but `TECHNITIUM_CLUSTER_TOKEN` and the guided migration flow are removed in v1.4.
- **Remote dev ergonomics**: `./scripts/remote-dev.sh recreate` force-recreates the dev container so `.env` changes take effect.
- **Details**: [Optional session auth + token migration guide](./release-notes-v1.2-session-auth-migration.md)

## 1.1.1

- **Built-in Blocking wildcards preserved**: Backend now reads Technitium export output directly, so wildcard entries (e.g., `*.zeronet.org`) display and round-trip correctly in the Companion UI. Added regression test to guard this behavior.
- **Cache directory fallback**: Backend falls back to project `./tmp/domain-lists-cache` then OS temp before `/data` to avoid ENOENT in dev/tests while keeping Docker `/data` as the persistent default.
- **PWA install prompt typing**: Frontend typings now register `beforeinstallprompt` on `WindowEventMap`, eliminating build-time type errors for PWA prompts.
- **Test stability**: Domain list cache init no longer leaves pending timers; e2e tests set a writable cache dir and global `/api` prefix.

If you’re upgrading, no config changes are required. For Docker, continue mounting `/data` to persist caches.
