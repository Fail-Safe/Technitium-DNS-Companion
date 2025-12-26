# Release Notes

## 1.2 (Draft)

- **Optional session authentication**: The UI can require users to sign in with their Technitium DNS credentials (TOTP/2FA supported). This is opt-in via `AUTH_SESSION_ENABLED=true`.
- **Planned v1.3+ direction**: Session auth is expected to become the default (and eventually required) in a follow-up release.
- **Safer background token model**: Background PTR lookups run using `TECHNITIUM_BACKGROUND_TOKEN` (validated for least privilege).
- **Guided migration from cluster token**: When session auth is enabled and `TECHNITIUM_CLUSTER_TOKEN` is still configured, the UI provides a guided migration flow to create a dedicated read-only user/token.
- **Remote dev ergonomics**: `./scripts/remote-dev.sh recreate` force-recreates the dev container so `.env` changes take effect.
- **Details**: [Optional session auth + token migration guide](./release-notes-v1.2-session-auth-migration.md)

## 1.1.1

- **Built-in Blocking wildcards preserved**: Backend now reads Technitium export output directly, so wildcard entries (e.g., `*.zeronet.org`) display and round-trip correctly in the Companion UI. Added regression test to guard this behavior.
- **Cache directory fallback**: Backend falls back to project `./tmp/domain-lists-cache` then OS temp before `/data` to avoid ENOENT in dev/tests while keeping Docker `/data` as the persistent default.
- **PWA install prompt typing**: Frontend typings now register `beforeinstallprompt` on `WindowEventMap`, eliminating build-time type errors for PWA prompts.
- **Test stability**: Domain list cache init no longer leaves pending timers; e2e tests set a writable cache dir and global `/api` prefix.

If you’re upgrading, no config changes are required. For Docker, continue mounting `/data` to persist caches.
