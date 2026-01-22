# v1.2: Optional Session Authentication + Safer Token Story

This release introduces an **optional session-auth mode** for Technitium DNS Companion. It lets you require users to sign in with their Technitium DNS credentials (including TOTP-based 2FA) instead of relying on a long-lived admin token for interactive UI access.

## Why this matters

- Reduces the risk of a long-lived high-privilege token sitting in the Companion environment.
- Keeps Technitium DNS tokens **server-side only** (browser uses an HttpOnly Companion cookie).
- Preserves Technitium DNS RBAC: the Companion uses each user’s Technitium DNS session for interactive actions.

## What changes for existing installs

Nothing changes unless you opt in.

### Legacy mode (default)

If you do not enable session auth, the app behaves as it always has.

### Session auth mode (opt-in)

Enable session auth.

When enabled:

- The UI shows a login page.
- Users log in with Technitium DNS username/password (2FA supported).

## Roadmap / deprecation note

Session auth is **opt-in** in v1.2.

As of v1.4, session auth is required for interactive UI access.

The intention is to make session auth the default (and eventually required) in a follow-up release (v1.3+), so the Companion UI no longer relies on long-lived env tokens for interactive access.

If you strongly prefer the legacy no-login behavior, you can stay pinned to v1.2, but new features and fixes will target v1.3+.

## Migration: `TECHNITIUM_CLUSTER_TOKEN` → `TECHNITIUM_BACKGROUND_TOKEN`

If you currently use `TECHNITIUM_CLUSTER_TOKEN` and you enable session auth, the UI will show a migration banner.

That migration:

- Creates a dedicated read-only Technitium DNS user (name may be suffixed if it already exists).
- Generates a one-time token for background-only work.
- Guides you to set `TECHNITIUM_BACKGROUND_TOKEN` and remove `TECHNITIUM_CLUSTER_TOKEN`.

After updating `.env`, you must **recreate** the container so the new env vars apply.

- Remote dev: `./scripts/remote-dev.sh recreate`
- Docker Compose: `docker compose up -d --force-recreate`
- Docker run (named container): remove + run again with updated env file:

```bash
docker rm -f technitium-dns-companion 2>/dev/null || true; docker run -d --name technitium-dns-companion --restart unless-stopped -p 3000:3000 -p 3443:3443 --env-file technitium.env -v technitium-dns-companion-data:/data ghcr.io/fail-safe/technitium-dns-companion:latest
```

## Quick validation

```bash
curl -s https://your-host:5174/api/auth/me
```

Look for:

- `sessionAuthEnabled: true`
- `backgroundPtrToken.validated: true`
- `backgroundPtrToken.okForPtr: true`

## More details

- Full guide: [docs/features/SESSION_AUTH_AND_TOKEN_MIGRATION.md](docs/features/SESSION_AUTH_AND_TOKEN_MIGRATION.md)
