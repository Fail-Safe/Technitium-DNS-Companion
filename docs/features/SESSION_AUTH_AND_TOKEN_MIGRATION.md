# Session Auth (v1.2+) and Token Migration Guide

This document explains session-based authentication and the transition away from using a long-lived cluster admin token for day-to-day UI access.

## Why this exists

Historically, Technitium DNS Companion could run entirely using environment-provided Technitium DNS tokens (e.g. a shared cluster token). That works, but it means:

- The Companion backend effectively has a long-lived, high-privilege credential available at rest.
- Any user who can reach the Companion UI implicitly gets the power of that token (unless you add external auth).

**Session auth mode** changes this:

- Users authenticate with their Technitium DNS username/password (TOTP-based 2FA supported).
- The Companion stores Technitium DNS session tokens server-side and sends only an HttpOnly Companion cookie to the browser.
- Background-only tasks can use a dedicated, least-privileged token.

## Modes at a glance

### 1) Legacy env-token mode (legacy/migration only)

- Do **not** set `AUTH_SESSION_ENABLED=true`.
- Configure Technitium DNS access via env tokens.
  - `TECHNITIUM_CLUSTER_TOKEN` (deprecated in v1.3, removed in v1.4)
  - Per-node `TECHNITIUM_<NODE>_TOKEN` (legacy-only for Technitium DNS < v14)

This preserves the pre-v1.2 behavior.

Roadmap note: starting in **v1.4**, the Companion UI requires Technitium login/RBAC (session auth). Legacy env-token mode is intended only for legacy/migration.

### 2) Session auth mode (login page)

- Set `AUTH_SESSION_ENABLED=true`.
- Run the Companion UI/API over HTTPS (recommended/expected).
- Users log into the Companion using their Technitium DNS credentials.
- The backend uses per-user Technitium DNS session tokens for interactive operations.

Note: When `AUTH_SESSION_ENABLED=true`, the backend will refuse to start unless it can reliably detect HTTPS.

Choose one:

- Direct HTTPS in the backend: set `HTTPS_ENABLED=true` and configure cert paths.
- TLS-terminating reverse proxy: set `TRUST_PROXY=true` so the backend trusts `X-Forwarded-Proto`.

## Token roles

### `TECHNITIUM_BACKGROUND_TOKEN`

Used only for backend background work (example: background PTR lookups). It should belong to a dedicated Technitium DNS user with minimal permissions.

The backend validates this token and disables background PTR work if the token is unsafe.

### `TECHNITIUM_CLUSTER_TOKEN` (legacy / migration source)

In session auth mode, this is treated as a legacy “bootstrap” token to help create a dedicated background user/token. The UI will surface a migration banner when it detects this situation.

Deprecation note: `TECHNITIUM_CLUSTER_TOKEN` is deprecated in v1.3 and planned to be removed in v1.4.

## Migration: cluster token → background token

This is the recommended transition plan when you want to enable session auth but currently rely on `TECHNITIUM_CLUSTER_TOKEN`.

1. Start from a working legacy configuration (no session auth):
   - `TECHNITIUM_CLUSTER_TOKEN` is set
   - `AUTH_SESSION_ENABLED` is unset/false

2. Enable session auth:
   - Set `AUTH_SESSION_ENABLED=true`
   - Keep `TECHNITIUM_CLUSTER_TOKEN` temporarily

3. Log in via the Companion UI.

4. Use the migration banner action:
   - The backend creates a dedicated read-only user (name may be suffixed if it already exists).
   - The backend generates a one-time token for that user.
   - The UI displays the token once.

5. Set `TECHNITIUM_BACKGROUND_TOKEN` in your `technitium.env` file using the generated token.

6. Remove the legacy cluster token:
   - Comment out or remove `TECHNITIUM_CLUSTER_TOKEN`.

7. Apply the `technitium.env` change by recreating the container (Compose reads `technitium.env` at container create time):
   - Docker Compose (manual): `docker compose up -d --force-recreate`
   - Docker run (manual): stop/remove the old container, then run again with the updated env file:

One-liners:

```bash
# Docker Compose “recreate” (reload technitium.env)
docker compose up -d --force-recreate
```

```bash
# Docker run “recreate” (remove + run again)
docker rm -f technitium-dns-companion 2>/dev/null || true; docker run -d --name technitium-dns-companion --restart unless-stopped -p 3000:3000 -p 3443:3443 --env-file technitium.env -v technitium-dns-companion-data:/data ghcr.io/fail-safe/technitium-dns-companion:latest
```

```bash
# Remove existing container (equivalent of “force recreate”)
docker rm -f technitium-dns-companion 2>/dev/null || true

# Start a fresh container with the updated technitium.env
docker run -d \
  --name technitium-dns-companion \
  --restart unless-stopped \
  -p 3000:3000 -p 3443:3443 \
  --env-file technitium.env \
  -v technitium-dns-companion-data:/data \
  ghcr.io/fail-safe/technitium-dns-companion:latest

# If using HTTPS cert mounts, also add:
#  -v "$(pwd)/certs:/app/certs:ro"
```

8. Validate:
   - The login page appears.
   - You can log in (including 2FA).
   - The migration banner is gone.
   - Background token is validated as safe.

A quick sanity check endpoint:

```bash
curl -s https://your-host:3443/api/auth/me | jq
```

Look for:

- `sessionAuthEnabled: true`
- `backgroundPtrToken.validated: true`
- `backgroundPtrToken.okForPtr: true`

## Operational notes

- Keep `TECHNITIUM_BACKGROUND_TOKEN` private (it is still a credential).
- If you want to go back to legacy mode (for now), unset `AUTH_SESSION_ENABLED` and reconfigure env tokens.

## Recommended deployment model (practical guidance)

If you want **Technitium to remain the single source of truth for auth + permissions**, the recommended setup is:

- Enable **session auth**: `AUTH_SESSION_ENABLED=true`
- Run Companion over **HTTPS** (direct HTTPS or TLS-terminating reverse proxy + `TRUST_PROXY=true`)
- Use Technitium users/permissions to control what a person can do
- Configure a dedicated, **least-privileged** `TECHNITIUM_BACKGROUND_TOKEN` only for background-only work (currently: PTR hostname resolution)

This keeps “interactive power” tied to the Technitium account the user actually logged in with, while still allowing safe background tasks.

Legacy mode (env tokens only) is still useful for:

- Lab setups where the UI is private/air-gapped
- Temporary troubleshooting

But it is intentionally less strict: anyone who can reach the Companion UI implicitly inherits the privileges of whatever env token(s) you configured.

## Technitium permissions map (what to grant)

Companion does not implement its own roles. Instead, it relies on Technitium permissions and surfaces errors when an action is denied.

Permission names below are based on the permission sections returned by Technitium in `/api/user/session/get` (example keys: `DnsClient`, `Administration`) and the API endpoints Companion calls. Exact naming/availability may vary by Technitium version/config.

| Companion area / feature                                       | Technitium API endpoint(s) called by Companion                                                                                                                                             | Expected Technitium permission(s)                       | Notes                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Sign-in (session auth mode)                                    | `/api/user/login`, `/api/user/session/get`, `/api/user/logout`                                                                                                                             | Technitium user account must be allowed to sign in      | Companion stores node session tokens server-side and uses an HttpOnly cookie in the browser.                                  |
| Dashboard/Overview totals                                      | `/api/dashboard/stats/get`                                                                                                                                                                 | Dashboard: View (or equivalent)                         | Used for “last day” totals shown in node overview cards.                                                                      |
| Query Logs (read)                                              | `/api/logs/query`                                                                                                                                                                          | Logs: View (or equivalent)                              | Read-only, but can be high-volume.                                                                                            |
| DNS Lookup tools                                               | `/api/dnsClient/resolve`                                                                                                                                                                   | `DnsClient`: View                                       | This aligns with the background token validator, which requires `DnsClient: View` for PTR work.                               |
| DHCP (read)                                                    | `/api/dhcp/scopes/list`, `/api/dhcp/scopes/get`, `/api/dhcp/leases/list`                                                                                                                   | DHCP: View (or equivalent)                              | Exact permission section name depends on Technitium.                                                                          |
| DHCP (write / sync / clone)                                    | `/api/dhcp/scopes/set`, `/api/dhcp/scopes/delete`                                                                                                                                          | DHCP: Modify/Delete (or equivalent)                     | In cluster mode, writes should target the Primary node.                                                                       |
| Zones (read / compare)                                         | `/api/zones/list`, `/api/zones/options/get`                                                                                                                                                | Zones: View (or equivalent)                             | Comparison is read-only but touches many endpoints.                                                                           |
| Advanced Blocking App (read)                                   | `/api/apps/list`, `/api/apps/config/get`                                                                                                                                                   | Apps: View (or equivalent)                              | Depends on Technitium “Apps” permissions.                                                                                     |
| Advanced Blocking App (write)                                  | `/api/apps/config/set`                                                                                                                                                                     | Apps: Modify (or equivalent)                            | Writes should target the Primary node in cluster mode.                                                                        |
| Built-in allow/block lists (read)                              | `/api/settings/get`, `/api/allowed/list`, `/api/blocked/list`, `/api/allowed/export`, `/api/blocked/export`                                                                                | Settings: View + (Allow/Block list view permission)     | Technitium may gate allow/block list endpoints under Zones/DNS/Settings depending on version.                                 |
| Built-in allow/block lists (write)                             | `/api/settings/set`, `/api/settings/forceUpdateBlockLists`, `/api/settings/temporaryDisableBlocking`, `/api/allowed/add`, `/api/allowed/delete`, `/api/blocked/add`, `/api/blocked/delete` | Settings: Modify + (Allow/Block list modify permission) | If users see “permission denied,” the simplest fix is granting the smallest additional privilege needed for that page/action. |
| Background PTR hostname resolution                             | `/api/dnsClient/resolve` (PTR lookups)                                                                                                                                                     | `DnsClient`: View                                       | Companion explicitly rejects background tokens that are too privileged, and also rejects tokens lacking `DnsClient: View`.    |
| Cluster-token → background-token migration (session-auth mode) | `/api/admin/users/create`, `/api/admin/users/set`, `/api/admin/sessions/createToken`, `/api/user/session/get`                                                                              | Administration: Modify (and likely View)                | This is intentionally “admin-ish” and meant to be run once to create a dedicated background user/token.                       |

## Reverse proxy TLS termination (recommended)

If you terminate TLS in a reverse proxy (Caddy/Nginx/Traefik) and run the Companion backend on plain HTTP behind it, set:

- `AUTH_SESSION_ENABLED=true`
- `TRUST_PROXY=true`

This allows the backend to treat requests as HTTPS when the proxy sends `X-Forwarded-Proto: https`.

Important:

- Do not enable `TRUST_PROXY=true` if the backend is directly reachable by untrusted clients.
- Restrict backend access so only the reverse proxy can reach it (firewall / Docker network / security group).

### Caddy example

```caddy
companion.example.com {
   reverse_proxy 127.0.0.1:3000
}
```

### Nginx example

```nginx
server {
   listen 443 ssl;
   server_name companion.example.com;

   # ssl_certificate /etc/letsencrypt/live/companion.example.com/fullchain.pem;
   # ssl_certificate_key /etc/letsencrypt/live/companion.example.com/privkey.pem;

   location / {
      proxy_pass http://127.0.0.1:3000;

      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
   }
}
```

## Planned change (future release)

v1.2 introduces session auth as an opt-in via `AUTH_SESSION_ENABLED=true`.

The direction going forward is to make session auth the default (and eventually required) in a follow-up release. Until then, you can continue to run in legacy env-token mode by leaving `AUTH_SESSION_ENABLED` unset/false.
