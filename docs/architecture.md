# Technitium DNS Companion Architecture

## What This App Does

A mobile-friendly web interface for managing multiple Technitium DNS servers. View logs, compare zones, manage DHCP scopes, and configure Advanced Blocking settings across all your nodes from one place.

## Project Layout

- **`apps/backend`** - NestJS REST API that proxies Technitium DNS API calls with caching
- **`apps/frontend`** - React + Vite SPA with mobile-responsive UI
- **`configs/`** - Example environment configurations for Technitium DNS v13 and v14

## Backend (NestJS)

### What It Actually Does

- Proxies requests to multiple Technitium DNS nodes (no state storage)
- Caches query logs for 30 seconds to improve performance
- Aggregates data from multiple nodes (combined logs, zone comparison, DHCP scopes)
- Loads node credentials from environment variables at startup

### Modules

- **`AppModule`** - Root module, registers cache and Technitium module
- **`TechnitiumModule`** - Wraps Technitium DNS API client, handles all proxy logic

### Key Endpoints

```
GET  /api/nodes                          - List configured nodes with cluster info
GET  /api/nodes/:nodeId/status           - Node status and version
GET  /api/nodes/:nodeId/cluster/state    - Cluster membership details
GET  /api/nodes/:nodeId/overview         - Dashboard stats
GET  /api/logs/combined                  - Merged query logs from all nodes (cached)
GET  /api/zones/combined                 - Zone comparison across nodes
GET  /api/advanced-blocking/combined     - Advanced Blocking settings comparison
GET  /api/dhcp/:nodeId/scopes            - DHCP scope list
POST /api/dhcp/:nodeId/scopes/clone      - Clone scope to another node
```

## Frontend (React + Vite)

### Pages

- **Overview** - Dashboard with node health, top queries, recent blocks
- **DNS Filtering** - Advanced Blocking groups, allowlist/blocklist management
- **DHCP** - Scope viewer with cross-node cloning
- **Zones Management** - Zone comparison with sync detection
- **Logs** - Combined query logs with filtering and search
- **DNS Lookup** - Query testing against nodes

### Tech Stack

- React 18 + TypeScript
- TailwindCSS for styling
- React Router for navigation
- Context API for state (no Redux)
- Mobile-first responsive design

## Configuration

All settings via environment variables:

```bash
# Required - Node list
TECHNITIUM_NODES=node1,node2

# Required - Base URL per node
TECHNITIUM_NODE1_BASE_URL=http://192.168.1.10:5380
TECHNITIUM_NODE2_BASE_URL=http://192.168.1.11:5380

# Preferred (interactive UI): Session auth
# - Enable session auth so users log in with their Technitium credentials.
# - In this mode, per-node env tokens are OPTIONAL for interactive UI usage.
# - Background timers (e.g., PTR warming, SQLite ingester) use TECHNITIUM_BACKGROUND_TOKEN.
# AUTH_SESSION_ENABLED=true
# TECHNITIUM_BACKGROUND_TOKEN=your-readonly-token

# Legacy (env-token mode): legacy/migration only
# - Starting in v1.4, the UI requires Technitium login/RBAC (session auth).
# - Per-node tokens are legacy-only for Technitium DNS < v14 deployments.
# TECHNITIUM_NODE1_TOKEN=your-token
# TECHNITIUM_NODE2_TOKEN=your-token

# Deprecated as of v1.3.0 - Cluster token (removed in v1.4)
# TECHNITIUM_CLUSTER_TOKEN=your-shared-cluster-token

# Optional
HTTPS_ENABLED=true
HTTPS_PORT=3443
CACHE_DIR=/data/domain-lists-cache
```

See `.env.example` for complete reference.

**Cache directory fallback:** If `CACHE_DIR` is not set, the backend now tries (in order) a project-local `./tmp/domain-lists-cache`, then the OS temp dir (`$TMPDIR/tdc-domain-lists-cache`), and finally `/data/domain-lists-cache` (for Docker). This prevents ENOENT issues in tests/dev while keeping the Docker path as the persistent default when mounted.
