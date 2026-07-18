# Technitium DNS Version Compatibility

This document records the API compatibility baseline used by Technitium DNS
Companion. It is an implementation audit, not a substitute for the upstream
Technitium DNS upgrade guide.

## Supported baseline

- Technitium DNS v15.3+ is the forward-looking supported baseline; operators
  should run the latest available v15 release for upstream security fixes.
- Technitium DNS v14 and earlier are deprecated. Companion 1.x keeps them
  functional on a best-effort basis, but no new v14-specific features or
  integration-test infrastructure will be added.
- Companion 2.0 will require Technitium DNS v15.3 or later. Removal is planned
  no earlier than late October 2026, providing at least a 60–90 day migration
  window from the deprecation announcement.
- Companion keeps the legacy token query parameter alongside the Bearer header
  during the 1.x deprecation period so existing v14 deployments continue to
  work.

The Overview page identifies connected pre-v15 nodes and shows an upgrade
warning. The warning is advisory in Companion 1.x and does not disable reads or
writes.

## v14-to-v15 API audit

| Area | Upstream change | Companion handling |
| --- | --- | --- |
| Authenticated API calls | v15 prefers `Authorization: Bearer <token>`; token parameters remain backward compatible | Sends both the Bearer header and legacy query token |
| Login and session APIs | `/api/user/login` and `/api/user/session/get` remain available | Uses login for interactive sessions and session/get for validation and cluster discovery |
| Status API | `/api/status` was added in v15.3 | Uses `/api/status`, falling back to `/api/user/session/get` only on HTTP 404 |
| DNS settings | v15.2 renamed `reverseProxyNetworkACL` to `dnsReverseProxyNetworkACL` and added `webServiceReverseProxyAddresses` | These fields are not currently read or written by Companion, so no translation is needed |
| Zone listing | v15 added optional zone name/type filters | Existing `/api/zones/list` requests remain valid without those optional filters |
| Internal zones | v15.3 replaced default internal zones with locally served DNS zones | Comparison continues to honor the API's `internal` marker; removed upstream defaults require no special migration |
| Clustering | v15 contains breaking cluster protocol changes | Companion's cluster discovery fields remain compatible; operators must upgrade every node in a Technitium cluster together |

## Regression coverage

Backend contract tests verify that:

- authenticated requests contain both v14-compatible query authentication and
  the v15 Bearer header;
- token validation uses the same dual-auth request shape;
- node health falls back to the v14 session endpoint when `/api/status` returns
  HTTP 404;
- other status failures are not hidden by the compatibility fallback.

These are mocked API-contract tests. The planned live integration matrix will
target the v15.3 minimum and latest v15 release rather than expanding v14 test
infrastructure during its deprecation period.

## Removal plan for Companion 2.0

Companion 2.0 will remove the v14 compatibility paths:

- duplicate query-token authentication on requests that use a Bearer token;
- the `/api/status` HTTP 404 fallback to `/api/user/session/get`;
- documentation and examples that present pre-v15 deployments as supported.

Before that removal, Companion 1.x will retain the existing compatibility
tests and provide an actionable warning without blocking operators.

## Upgrade notes

When upgrading Technitium DNS from v14 to v15:

1. Upgrade all members of a Technitium cluster in the same maintenance window.
2. Sign in to Companion again after the upgrade so every node receives a fresh
   session token.
3. Check Companion's detailed health response and node overview for each node.
4. Exercise one read-only comparison before applying configuration changes.

Upstream references:

- [Technitium DNS API documentation](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md)
- [Technitium DNS changelog](https://github.com/TechnitiumSoftware/DnsServer/blob/master/CHANGELOG.md)
