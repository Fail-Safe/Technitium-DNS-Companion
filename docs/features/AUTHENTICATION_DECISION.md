# Authentication Decision (v1.2+)

This document captures the rationale and direction for authentication in Technitium DNS Companion.

For the practical, step-by-step transition guide, see:

- [SESSION_AUTH_AND_TOKEN_MIGRATION.md](./SESSION_AUTH_AND_TOKEN_MIGRATION.md)

## Background

Today, the backend can call Technitium DNS APIs by attaching a `token` query parameter to requests. In many deployments, that token is provided via environment variables (for example, a shared cluster token).

This works, but it creates two major risks:

1. The Companion backend is effectively unauthenticated unless protected externally.
2. Long-lived tokens behave like API keys: if leaked, they can remain usable indefinitely.

Technitium DNS provides two ways to obtain tokens:

- **Login session token** via `/api/user/login`: expires after the user’s session timeout (default 30 minutes) from the last API call.
- **Non-expiring API token** via `/api/user/createToken`: intended for automation scripts; behaves like an API key.

## Decision

Technitium DNS Companion supports an optional session-based authentication mode:

- Use **expiring login session tokens** (`/api/user/login`) by default.
- Store Technitium tokens **server-side only**, scoped to the Companion session (no tokens in browser storage).
- Authenticate access to Companion APIs using a **Companion session** (HttpOnly cookie).
- Treat `status: "invalid-token"` responses from Technitium as “session expired” and require re-authentication.

## Why expiring tokens are the default

Expiring login tokens are a better default for an interactive UI:

- **Reduced blast radius**: tokens naturally expire after inactivity.
- **No long-lived secret at rest**: tokens can live only in server memory tied to the Companion session.
- **Matches real usage**: active UI traffic typically keeps the session alive; re-login is primarily needed after long idle periods.

## Why non-expiring tokens are not the default

Technitium’s `/api/user/createToken` produces a non-expiring token intended for automation. That is useful, but as a default it has drawbacks:

- **High impact if leaked**: it’s effectively an API key that can remain valid until revoked.
- **Operational burden**: revocation and auditing become more important.
- **Permission hygiene required**: the safest use is a dedicated, least-privileged Technitium user.

Non-expiring tokens may be added later as an explicit opt-in (for example, for advanced “service mode” or unattended workflows).

## Backwards compatibility: env-token (“service”) mode

Existing deployments that rely on environment-provided tokens should continue to work.

Planned behavior:

- If the backend is configured with per-node tokens (or a shared cluster token), it can continue operating without interactive login.
- The new session-based auth flow should be able to coexist with env-token setups, with a clear deprecation plan for shared cluster tokens.

## Security notes

- Authentication flows MUST be used over HTTPS in any non-local deployment.
- Never log, persist, or expose Technitium tokens to the browser.
