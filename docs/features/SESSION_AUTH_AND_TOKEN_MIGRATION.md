# Session Auth (v1.4+) and Background Token Guide

This document explains session-based authentication and the transition away from using a long-lived cluster admin token for day-to-day UI access.

## Why this exists

Historically, Technitium DNS Companion could run entirely using environment-provided Technitium DNS tokens. That works, but it means:

- The Companion backend effectively has a long-lived, high-privilege credential available at rest.
- Any user who can reach the Companion UI implicitly gets the power of that token (unless you add external auth).

**Session auth mode** changes this:

- Users authenticate with their Technitium DNS username/password (TOTP-based 2FA supported).
- The Companion stores Technitium DNS session tokens server-side and sends only an HttpOnly Companion cookie to the browser.
- Background-only tasks can use a dedicated, least-privileged token.

## Modes at a glance

### 1) Legacy env-token mode (legacy/migration only)

- Configure Technitium DNS access via env tokens.
  - Per-node `TECHNITIUM_<NODE>_TOKEN` (legacy-only for Technitium DNS < v14)

This preserves the pre-v1.2 behavior.

Important: starting in **v1.4**, the Companion UI requires Technitium login/RBAC (session auth). Legacy env-token mode is intended only for legacy/migration tasks and older deployments.

### 2) Session auth mode (login page)

- Run the Companion UI/API over HTTPS (recommended/expected).
- Users log into the Companion using their Technitium DNS credentials.
- The backend uses per-user Technitium DNS session tokens for interactive operations.

Note: Session auth requires the backend to reliably detect HTTPS.

Choose one:

- Direct HTTPS in the backend: set `HTTPS_ENABLED=true` and configure cert paths.
- TLS-terminating reverse proxy: set `TRUST_PROXY=true` so the backend trusts `X-Forwarded-Proto`.

## Token roles

### `TECHNITIUM_BACKGROUND_TOKEN`

Used only for backend background work (example: background PTR lookups). It should belong to a dedicated Technitium DNS user with minimal permissions.

The backend validates this token and disables background PTR work if the token is unsafe.

## Set up `TECHNITIUM_BACKGROUND_TOKEN` (manual)

In v1.4+, `TECHNITIUM_CLUSTER_TOKEN` is removed and there is no guided “migration banner” flow.

If you want background features (example: background PTR hostname resolution), create and set a dedicated least-privilege token:

1. In the Technitium DNS admin UI:
   - Go to `Administration` → `Sessions` → `Create Token`.
   - Create a dedicated low-privilege user if you don't already have one.
   - Generate a token for that user with read-only permissions appropriate for background tasks.

2. Set the token in your env file:
   - `TECHNITIUM_BACKGROUND_TOKEN=...`

3. Apply the env change by recreating the container (Compose reads the env file at container create time):
   - Docker Compose: `docker compose up -d --force-recreate`
   - Docker run: stop/remove the old container, then run again with the updated env file.

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

7. Validate:
   - The login page appears.
   - You can log in (including 2FA).
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
- Legacy env-token mode is intentionally less strict and is intended only for legacy/migration use cases.

## Recommended deployment model (practical guidance)

If you want **Technitium to remain the single source of truth for auth + permissions**, the recommended setup is:

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

v1.2 introduced session auth as an opt-in.

As of v1.4, session auth is required for interactive UI access.
