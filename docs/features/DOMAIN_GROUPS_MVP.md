# Domain Groups (MVP)

## Overview

Domain Groups add a reusable DNS-domain object model similar to firewall address groups:

- A Domain Group has a `name` and optional `description`.
- A Domain Group contains `1..N` entries.
- Each entry has:
  - `matchType`: `exact` or `regex`
  - `value`: domain or regex pattern
  - optional `note` (why it exists)
- A Domain Group can be bound to one or more Advanced Blocking groups with an `action`:
  - `allow`
  - `block`

This metadata is global across nodes and designed as Companion-side source of truth.

## Storage

Domain Groups are stored in SQLite (not JSON/YAML) for:

- relational integrity
- conflict detection queries
- future drift/audit capabilities
- efficient search/filtering by name, entry, and notes

Environment variable:

```bash
# Optional kill switch (default is enabled):
DOMAIN_GROUPS_ENABLED=false
DOMAIN_GROUPS_SQLITE_PATH=/data/domain-groups.sqlite
```

Default path if unset: `/data/domain-groups.sqlite`.

Notes:

- Domain Groups are enabled by default.
- Set `DOMAIN_GROUPS_ENABLED=false` to disable the feature.
- This SQLite DB is separate from the optional Query Logs SQLite store.

## API Endpoints

All endpoints are under `/api/domain-groups`.

### Groups

- `GET /api/domain-groups`
- `GET /api/domain-groups/:groupId`
- `POST /api/domain-groups`
- `PATCH /api/domain-groups/:groupId`
- `DELETE /api/domain-groups/:groupId`

Create/update payload:

```json
{
  "name": "YouTube",
  "description": "Domains related to YouTube services and clients"
}
```

### Entries

- `POST /api/domain-groups/:groupId/entries`
- `PATCH /api/domain-groups/:groupId/entries/:entryId`
- `DELETE /api/domain-groups/:groupId/entries/:entryId`

Entry payload:

```json
{
  "matchType": "exact",
  "value": "youtube.com",
  "note": "Needed for smart TV sign-in workflow"
}
```

Regex entry example:

```json
{
  "matchType": "regex",
  "value": ".*googlevideo\\.com$",
  "note": "Video stream domains"
}
```

### Bindings (Domain Group -> Advanced Blocking Group)

- `POST /api/domain-groups/:groupId/bindings`
- `DELETE /api/domain-groups/:groupId/bindings/:bindingId`

Binding payload:

```json
{ "advancedBlockingGroupName": "Kids Devices", "action": "block" }
```

### Materialization Preview

- `GET /api/domain-groups/materialization/preview`

### Materialization Apply

- `POST /api/domain-groups/materialization/apply`

Payload:

```json
{ "nodeIds": ["node1", "node2"], "dryRun": false }
```

Behavior:

- If `nodeIds` is omitted:
  - cluster mode defaults to Primary node(s) only
  - non-cluster mode defaults to all configured nodes
- If same-specificity conflicts exist, apply is blocked and returns a conflict error.
- `dryRun=true` computes per-node changes without writing node configs.
- Secondary node writes are blocked in cluster mode (Primary-only writes).

Returns:

- `groups`: compiled arrays per Advanced Blocking group:
  - `allowed`
  - `blocked`
  - `allowedRegex`
  - `blockedRegex`
- `conflicts`: same-specificity allow/block collisions requiring manual resolution.

## Conflict Policy (Current)

Agreed UX policy:

- Exact vs regex precedence: **exact wins**.
- Same-specificity allow/block collision: **validation error** (no silent winner).

MVP currently detects same-specificity collisions in materialization preview.

## Notes on Scope

This MVP ships persistence + API + conflict preview.

Future phases can add:

- UI management screens
- apply/sync into node configs
- drift detection and guided reconciliation
- conflict-resolution workflow in UI
