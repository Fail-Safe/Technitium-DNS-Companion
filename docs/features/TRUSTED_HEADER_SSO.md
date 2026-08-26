# Trusted-header SSO

Trusted-header SSO lets an authenticating reverse proxy sign users into
Technitium DNS Companion without sending passwords to Companion. It is disabled
by default and is an additive authentication option intended for a minor
release.

The security boundary has three parts:

1. the request is HTTPS as observed by Companion;
2. the immediate socket peer is in an optional configured proxy CIDR; and
3. the proxy supplies exactly one valid identity header and a matching secret.

An identity header or `X-Forwarded-Proto` alone is never sufficient. The proxy
must remove client-supplied assertion headers and inject replacements only after
successful authentication.

## Authorization model

Every SSO identity maps exactly to one Technitium username and one cluster-wide
API token. Technitium replicates users, permissions, and API tokens created on
the Primary to every node in its cluster. Companion validates the same token
against every configured node with
`/api/user/session/get` and requires the returned owner to equal the configured
username before creating a session. Unreachable nodes may produce the existing
degraded partial session; an invalid token or owner mismatch fails the complete
login.

Companion retains at most eight active trusted-SSO sessions for one mapped
identity. Creating a ninth evicts that identity's oldest SSO session without
affecting password sessions or another identity. This supports normal
multi-device use while bounding server-side session state.

Trusted SSO therefore expects all configured Companion nodes to belong to the
same Technitium cluster. Independent clusters or standalone nodes require
separate Companion deployments for this authentication mode.

Shared-account mode and fallback for unmapped identities are intentionally not
supported. Both would make multiple people operate as one Technitium principal,
collapsing per-user RBAC and audit attribution.

## Configuration

```dotenv
TRUSTED_SSO_ENABLED=true
TRUSTED_SSO_IDENTITY_HEADER=X-Forwarded-User
TRUSTED_SSO_PROXY_SECRET_HEADER=X-Trusted-Proxy-Secret
TRUSTED_SSO_PROXY_SECRET_FILE=/run/secrets/companion_sso_proxy_secret
TRUSTED_SSO_PROXY_CIDRS=172.20.0.0/16,2001:db8:1234::/64
TRUSTED_SSO_TOKEN_MAP_FILE=/data/trusted-sso-token-map.json
TRUSTED_SSO_LOGOUT_URL=https://idp.example.com/application/o/companion/end-session/
TRUST_PROXY=true
TRUST_PROXY_HOPS=1
```

`TRUSTED_SSO_PROXY_SECRET` may be set directly, but the `_FILE` form is
recommended. The value must be at least 32 characters. Generate it with a
cryptographically secure secret manager or random-byte generator and never put
it in source control.

`TRUSTED_SSO_PROXY_CIDRS` accepts comma-separated IPv4 and IPv6 CIDRs and checks
the immediate socket peer, not `X-Forwarded-For`. When CIDRs are present,
password login is available only to direct clients outside them. When CIDRs are
omitted, every request is expected to arrive through the authenticating proxy
and password login is disabled while SSO is enabled.

`TRUSTED_SSO_LOGOUT_URL` is optional and must be an HTTPS URL or a relative path
beginning with a single slash. With a URL, logout clears the local session and
redirects to the identity provider. Without one, logout clears the local
session, pauses automatic SSO login in the browser tab, and displays **Continue
with SSO**.

The application validates all enabled SSO configuration once during startup.
Invalid headers, CIDRs, secrets, URLs, or token-map schemas stop the backend
instead of silently weakening authentication.

## Token map

Create a separate Technitium user for each person on the cluster Primary, grant
only the permissions that person needs, and create one API token owned by that
user on the Primary through **Administration → Sessions → Create Token** or
`/api/admin/sessions/createToken`. Save the returned token immediately.
Technitium synchronizes the user, permissions, and API token to its Secondary
nodes. Store the mapping in a root-readable file mounted read-only into the
container:

```json
{
  "version": 1,
  "identities": {
    "alice@example.com": {
      "username": "alice",
      "token": "cluster-token-created-for-alice"
    },
    "bob@example.com": {
      "username": "bob",
      "token": "cluster-token-created-for-bob"
    }
  }
}
```

Identity matching is exact and case-sensitive. Companion expands the replicated
cluster token into its server-side per-node session state only for nodes that
successfully validate it. Tokens never enter the browser or API response.

Technitium documents that API tokens created on the cluster Primary are
synchronized to every node, while ordinary interactive login sessions remain
node-local. See [Understanding Clustering And How To Configure It](https://blog.technitium.com/2025/11/understanding-clustering-and-how-to.html).

### Rotation

1. Create a replacement token under the same Technitium principal on the
   cluster Primary and allow it to synchronize to the Secondary nodes.
2. Write a complete version-1 map to a new file, set restrictive file
   permissions, and atomically replace the mounted map.
3. Restart Companion so it loads and validates the new configuration.
4. Sign in through SSO and verify the expected username and node access.
5. Revoke the old tokens in Technitium.

Restarting clears all in-memory Companion sessions, so no session continues to
hold an old mapped token after the cutover. Rotate the proxy secret separately
as a coordinated proxy-and-Companion change; the current configuration accepts
one secret at a time.

## Test without an OIDC provider

Companion consumes authenticated proxy assertions and does not implement the
OIDC exchange itself. The repository includes a test-only Compose overlay that
uses nginx Basic Auth to exercise the same identity-header contract without an
IdP.

Prepare local test credentials and a short-lived self-signed certificate:

```bash
./scripts/setup-trusted-sso-test.sh
```

The script prompts for the asserted identity, its Technitium username, the
cluster-wide API token, and a temporary Basic Auth password. Secret material is
written with restrictive permissions beneath the ignored `.sso-test/`
directory and is never printed.

Build, validate, and start the isolated production-test stack:

```bash
docker build -t technitium-dns-companion:prodtest -f Dockerfile .
docker compose \
  -f docker-compose.prod.test.yml \
  -f docker-compose.sso-test.yml \
  config --quiet
docker compose \
  -f docker-compose.prod.test.yml \
  -f docker-compose.sso-test.yml \
  up -d
```

The authenticated proxy listens on port `5443` by default. The browser will
require explicit trust for the generated certificate and then prompt for the
temporary Basic Auth credentials. The direct Companion HTTP port is bound only
to `127.0.0.1:5300` for negative assertion-spoofing checks from the Docker host.

Verify that an identity header without the proxy secret cannot establish a
session:

```bash
curl -i \
  -H 'X-Forwarded-Proto: https' \
  -H 'X-Forwarded-User: your-test-identity' \
  http://127.0.0.1:5300/api/auth/me
```

The response must remain unauthenticated and must not create a session cookie.
To stop the harness without deleting `.dev-data` or `.sso-test`:

```bash
docker compose \
  -f docker-compose.prod.test.yml \
  -f docker-compose.sso-test.yml \
  down --remove-orphans
```

Basic Auth is only a stand-in for local validation. Do not deploy this overlay
as the production identity provider.

## Reverse-proxy requirements

All examples use placeholders. Keep the proxy secret in the proxy's secret
store or deployment templating, not in a committed configuration file. Restrict
network access to Companion so untrusted clients cannot bypass the proxy. Set
`TRUSTED_SSO_PROXY_CIDRS` to the actual proxy network whenever a separate direct
break-glass route is required.

### nginx

This example uses `auth_request`. The authentication endpoint must return the
verified identity in `X-Auth-Request-User` only on success.

```nginx
location = /_auth {
    internal;
    proxy_pass http://forward-auth/verify;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header X-Original-URI $request_uri;
    proxy_set_header X-Forwarded-User "";
    proxy_set_header X-Trusted-Proxy-Secret "";
}

location / {
    auth_request /_auth;
    auth_request_set $sso_user $upstream_http_x_auth_request_user;

    proxy_set_header X-Forwarded-User $sso_user;
    proxy_set_header X-Trusted-Proxy-Secret "__READ_FROM_PROXY_SECRET_STORE__";
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $host;
    proxy_pass http://technitium-dns-companion:3000;
}
```

An empty `proxy_set_header` value prevents the original field from being
forwarded, while setting a value replaces it. Do not derive `$sso_user` from a
client request header.

### Caddy

`request_header` removes incoming assertion fields before `forward_auth`.
`copy_headers` then copies the identity from the successful authentication
response. `header_up` overwrites the secret sent to Companion.

```caddyfile
companion.example.com {
    request_header -X-Forwarded-User
    request_header -X-Trusted-Proxy-Secret

    forward_auth forward-auth:4181 {
        uri /verify
        copy_headers X-Forwarded-User
    }

    reverse_proxy technitium-dns-companion:3000 {
        header_up X-Trusted-Proxy-Secret {$TRUSTED_SSO_PROXY_SECRET}
    }
}
```

The authentication service must emit `X-Forwarded-User` only after it has
authenticated the request.

### Traefik

Apply middleware in the shown order: remove client assertions, authenticate and
copy the verified identity, then inject the Companion secret.

```yaml
http:
  middlewares:
    strip-client-assertions:
      headers:
        customRequestHeaders:
          X-Forwarded-User: ""
          X-Trusted-Proxy-Secret: ""

    companion-forward-auth:
      forwardAuth:
        address: http://forward-auth:4181/verify
        authResponseHeaders:
          - X-Forwarded-User

    inject-companion-secret:
      headers:
        customRequestHeaders:
          X-Trusted-Proxy-Secret: "__READ_FROM_PROXY_SECRET_STORE__"

  routers:
    companion:
      rule: Host(`companion.example.com`)
      service: companion
      middlewares:
        - strip-client-assertions
        - companion-forward-auth
        - inject-companion-secret

  services:
    companion:
      loadBalancer:
        servers:
          - url: http://technitium-dns-companion:3000
```

Traefik's `authResponseHeaders` replaces a conflicting forwarded request header.
The explicit stripping middleware also prevents the untrusted values from being
sent to the authentication service.

## Runtime behavior

- `/api/auth/me` reports whether SSO is enabled, available for the current
  request, and whether direct password login is allowed.
- `/api/auth/sso/login` is the only endpoint that creates an SSO session. It
  validates mapped tokens through `TechnitiumService`, single-flights concurrent
  validation for one identity, and applies a five-second cooldown after failure.
- Every later API request must carry the same valid assertion. Missing,
  malformed, or changed assertions delete the local SSO session and clear its
  cookie before protected work runs.
- Password sessions keep their existing upstream Technitium token revocation on
  logout. SSO logout removes only the local session because the mapped tokens
  are managed and rotated by the operator.
