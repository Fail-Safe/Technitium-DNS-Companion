# SQLite Rolling Query Log Store (Optional)

## Why this exists

Technitium’s query log API is optimized for “recent” data and can be constrained by pagination / max entry limits. At higher query volumes, a UI preset like “Last 24h” may not reliably represent a full 24 hours if the backend can’t retrieve enough entries from the node(s) in one request.

This optional feature adds a small, local SQLite store in the Companion backend that continuously ingests query logs and maintains a rolling retention window (default: 24 hours). The Logs UI can then use this store for accurate time-window browsing.

## What it does (and doesn’t)

- **Paginated browsing (accuracy)**: When enabled, the backend serves “stored logs” endpoints backed by SQLite. This makes time-window presets like “Last 24h” reliable for browsing.
- **Tail mode (near-realtime)**: Tail mode continues to read directly from Technitium nodes so it stays as realtime as possible.
- **Opt-in**: Storage is disabled unless explicitly enabled via env vars.

## Backend endpoints

These endpoints are served by the backend under the existing `/api/nodes` controller:

- `GET /api/nodes/logs/storage`
  - Returns storage status:
    - `enabled: boolean` — whether storage is configured on this backend
    - `ready: boolean` — whether the SQLite DB is open and usable
    - `retentionHours: number`
    - `pollIntervalMs: number`

- `GET /api/nodes/logs/combined/stored`
  - Stored + paginated combined logs (across all nodes)

- `GET /api/nodes/:nodeId/logs/stored`
  - Stored + paginated logs for a single node

### Query parameters (stored endpoints)

The stored endpoints accept the same query filter shape used elsewhere in the Logs API:

- Pagination:
  - `pageNumber` (positive int)
  - `entriesPerPage` (positive int)
- Ordering:
  - `descendingOrder` (`true|false`)
- Filters:
  - `start` (ISO string)
  - `end` (ISO string)
  - `qname`
  - `clientIpAddress`
  - `protocol`
  - `responseType`
  - `statusFilter` (`blocked|allowed`)
  - `rcode`
  - `qtype`
  - `qclass`
- Other:
  - `deduplicateDomains` (`true|false`)
  - `disableCache` (`true|false`) — also emits no-cache headers

## How ingestion works

- The backend opens a SQLite DB (path configurable).
- On a timer (`QUERY_LOG_SQLITE_POLL_INTERVAL_MS`), it polls each configured node for recent query logs.
- It deduplicates inserts (so overlap polling is safe) and keeps only a rolling window (`QUERY_LOG_SQLITE_RETENTION_HOURS`).
- A small overlap (`QUERY_LOG_SQLITE_OVERLAP_SECONDS`) is used to reduce the risk of missing entries between polls.

## Authentication / tokens (important)

### Session auth (v1.4+: always enabled for interactive UI)

Background timers do **not** have an interactive user session token. The SQLite ingester therefore runs using **background auth mode**, which requires a configured background token:

- Set `TECHNITIUM_BACKGROUND_TOKEN` to a **least-privilege** Technitium token that can read query logs.
- Without `TECHNITIUM_BACKGROUND_TOKEN`, the SQLite DB can still open (status may show `ready: true`), but ingestion will fail with auth errors and the store will not stay up to date.

## Configuration (env vars)

All vars are optional unless noted.

- `QUERY_LOG_SQLITE_ENABLED`
  - Set to `true` to enable.
- `QUERY_LOG_SQLITE_PATH`
  - Path to the SQLite DB file.
  - Default: `/app/config/query-logs.sqlite`
- `QUERY_LOG_SQLITE_RETENTION_HOURS`
  - Rolling retention window.
  - Default: `24`
- `QUERY_LOG_SQLITE_POLL_INTERVAL_MS`
  - Polling interval.
  - Default: `10000` (10s)
- `QUERY_LOG_SQLITE_OVERLAP_SECONDS`
  - Overlap between poll windows (prevents gaps).
  - Default: `60`
- `QUERY_LOG_SQLITE_MAX_ENTRIES_PER_POLL`
  - Upper cap per node per poll.
  - Default: `20000`

## Docker / persistence notes

If you want stored logs to survive container restarts:

- Put `QUERY_LOG_SQLITE_PATH` on a mounted volume (or mount the parent directory).
- Example: mount `/data` and set `QUERY_LOG_SQLITE_PATH=/data/query-logs.sqlite`.

## Frontend behavior

- The Logs page loads `/api/nodes/logs/storage` to detect capability.
- If storage is **ready**, paginated mode uses the stored endpoints.
- If storage is **not** ready, hour-based presets like “Last Hour” / “Last 24h” are hidden (because they may be misleading without storage).
- Tail mode remains live and continues to call the non-stored endpoints.
