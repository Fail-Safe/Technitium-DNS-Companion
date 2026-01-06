````markdown
# Split Horizon → PTR Sync

**Status**: ✅ Implemented
**Date**: January 6, 2026

---

## Overview

This feature generates and maintains **PTR (reverse DNS) records** from **SplitHorizon.SimpleAddress** APP records stored in a **forward zone**.

It is designed for environments where you:

- Maintain forward hostnames in a normal forward zone (e.g., `example.com`)
- Use the **Split Horizon** Technitium app to map client subnets → address lists
- Want reverse lookups (`PTR`) to resolve to the same hostname used in the APP record

The UX is **Preview → Apply**:

- **Preview** computes the desired PTR zones/records, detects conflicts, and shows planned actions.
- **Apply** executes the plan (create zones, create/update PTR records, and safe deletions).

---

## Prerequisites

- Technitium DNS server must have the **Split Horizon** app installed.
  - App reference: https://github.com/TechnitiumSoftware/DnsServer/tree/master/Apps/SplitHorizonApp
- In cluster mode, writes must be performed on the **Primary** node.
  - Companion automatically targets the Primary node for this workflow.

If the Split Horizon app is not detected, Companion hides the Split Horizon UI tab and the backend endpoints return `splitHorizonInstalled: false`.

---

## Where It Lives (UI)

- **DNS Zones** page → **Split Horizon** tab → **SplitHorizon → PTR Sync** section

The UI provides:

- **Forward zone name** input with suggestions (zones that contain SplitHorizon.SimpleAddress APP records)
- **Preview** / **Apply** actions
- Options:
  - “Show unchanged items” (after Preview)
  - “Skip unresolved conflicts”
  - “Advanced: adopt existing PTR records” (opt-in)

---

## What Gets Synced

### Source record type

The backend scans the selected forward zone for APP records representing:

- Class path: `SplitHorizon.SimpleAddress`

### Hostname source

The **hostname target** for the PTR record is derived from the APP record hostname (i.e., the record’s name in the forward zone).

### IP address source

The APP record data contains a mapping of **client subnet** → **list of IPs** (IPv4 and/or IPv6). For each IP address present, a corresponding PTR record is computed.

Example APP record data (from the SplitHorizonApp docs):

```json
{
  "192.168.0.0/16": ["192.168.45.225", "2600:1700:994:d430::225"],
  "2600:1700:994:d430::/60": ["192.168.45.225", "2600:1700:994:d430::225"],
  "100.64.64.0/24": ["100.64.64.225", "fd7a:115c:a1e0:10::225"],
  "fd7a:115c:a1e0:10::/64": ["100.64.64.225", "fd7a:115c:a1e0:10::225"]
}
```

---

## Reverse Zone Defaults

When mapping an IP to a reverse zone, Companion uses sensible defaults:

- **IPv4**: /24 reverse zones
- **IPv6**: /64 reverse zones

This means, for example:

- `192.168.45.225` → reverse zone `45.168.192.in-addr.arpa` (PTR name `225`)
- `fd7a:115c:a1e0:10::225` → reverse zone `…ip6.arpa` (computed for a /64)

---

## Safe Deletes (Important)

Companion supports deleting PTR records when the Split Horizon mapping changes, but it does so safely.

### Default behavior: managed-only deletion

By default, Companion will **only delete PTR records that it can prove it manages**, by tagging those records with a comment marker.

Marker prefix:

- `TDC split-horizon ptr`

Marker contains:

- `sourceZone=<forwardZoneName>`
- `ip=<ipAddress>`

This ensures:

- PTR records created/owned by users or other tooling are not deleted accidentally.

### Persisted “managed reverse zones” state

To reliably find stale PTRs over time (even if the current APP records no longer mention a reverse zone), Companion persists a best-effort state file keyed by:

- `{nodeId, source forward zone name}` → `managedReverseZones[]`

Directory selection (first writable wins):

- `CACHE_DIR` (if set)
- `./tmp/split-horizon-ptr-state`
- OS temp dir (`tdc-split-horizon-ptr-state`)
- `/data/split-horizon-ptr-state` (Docker-friendly default)

If state persistence is unavailable, deletions may be incomplete (but still remain managed-only).

---

## Advanced: “Adopt existing PTR records”

This option is **off by default**.

When enabled, Companion may **tag existing PTR records** as “managed” if they already match the desired PTR content.

Why this exists:

- Some environments already have PTR records created manually.
- Adoption allows Companion to manage those records going forward.

Important safety note:

- Once a PTR record is adopted (tagged as managed), it becomes eligible for managed-only deletions in future runs if it is later removed from the Split Horizon mapping.

---

## Conflict Handling

Preview can mark records as `conflict` when it cannot safely decide what to do.

Current conflict policy options:

- **Skip unresolved conflicts** (UI default): Apply proceeds and skips conflicts.
- **Fail on conflicts**: Apply aborts if unresolved conflicts remain.

Some conflicts (like multiple possible source hostnames for the same IP) can be resolved in the UI by selecting the desired hostname.

---

## Backend API

These are Companion backend endpoints (typically under the `/api` prefix):

### `GET /api/split-horizon/ptr/source-zones`

Returns:

- Whether Split Horizon is installed
- A list of forward-zone candidates that contain SplitHorizon.SimpleAddress records (with counts)

Optional query:

- `forceRefresh=true` to bypass the short in-memory cache

### `POST /api/split-horizon/ptr/preview`

Request body:

```ts
{
  zoneName: string;
  adoptExistingPtrRecords?: boolean;
  ipv4ZonePrefixLength?: number;
  ipv6ZonePrefixLength?: number;
}
```

Response includes:

- planned reverse zones (create/no-op)
- planned PTR records (create/update/delete/no-op/conflict)
- `splitHorizonInstalled` and warnings

### `POST /api/split-horizon/ptr/apply`

Request body:

```ts
{
  zoneName: string;
  adoptExistingPtrRecords?: boolean;
  conflictPolicy?: "skip" | "fail";
  catalogZoneName?: string;
  sourceHostnameResolutions?: Array<{ ip: string; hostname: string }>;
  dryRun?: boolean;
  ipv4ZonePrefixLength?: number;
  ipv6ZonePrefixLength?: number;
}
```

Response includes:

- `actions[]` and an `summary` (created/updated/deleted/etc)

---

## Practical Example

1. In the Zones page, open the **Split Horizon** tab.
2. Enter a forward zone name (e.g. `example.com`).
3. Click **Preview**.
4. Review planned changes:
   - Reverse zones to create (if missing)
   - PTR records to create/update
   - PTR records to delete (managed-only)
   - Conflicts
5. If conflicts exist and you want to proceed anyway, keep “Skip unresolved conflicts” enabled.
6. Click **Apply**.

---

## Notes & Limitations

- This feature intentionally prioritizes safety over aggressiveness:
  - Deletions are managed-only unless a record has been adopted.
- Phase 1 is intentionally manual (**Preview → Apply**) to avoid excessive load.
- Phase 2 may add optional scheduled/automated syncs.
````
