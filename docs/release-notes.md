# Release Notes

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
