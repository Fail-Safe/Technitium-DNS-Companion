# Technitium DNS Version Compatibility

This document records the API compatibility baseline used by Technitium DNS
Companion. It is an implementation audit, not a substitute for the upstream
Technitium DNS upgrade guide.

## Supported baseline

- Technitium DNS v14 remains the minimum supported clustered deployment.
- Technitium DNS v15.3+ uses the current status endpoint and Bearer-token API
  convention.
- Companion keeps the legacy token query parameter alongside the Bearer header
  so the same request path remains compatible with v14.

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

These are mocked API-contract tests. Running the integration suite against real
v14 and v15 containers is still an open roadmap item.

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
