# Technitium DNS Companion

A multi-node companion tool for aiding in day-to-day management of Technitium DNS servers. Currently offers additional functionality for:

- DNS Query Logs (DNS Logs)
- Advanced Blocking App upkeep (DNS Filtering)
- DNS Zone Insight (DNS Zones)
- DHCP Scopes

One primary goal of this project is to provide a more mobile-friendly interface for managing day-to-day DNS functions, enabling administrators to perform common tasks (like domain blocking/unblocking) from smartphones and tablets with ease.

This project is **not affiliated with Technitium** but is built to complement Technitium DNS server deployments and not to replace functionality.

## Authentication (as of v1.2.1)

As of **v1.2.1**, the preferred authentication mechanism is **Technitium DNS-backed session authentication**:

- Users sign in with their **Technitium DNS username/password** (and 2FA if enabled).
- The Companion stores Technitium session tokens **server-side** and the browser receives only an **HttpOnly session cookie**.
- This keeps interactive permissions aligned with the Technitium account the user actually logged in with.

Legacy “env-token mode” (configuring the Companion with long-lived admin API tokens) is still supported (for a limited time), but is no longer the recommended default, nor long-term approach for deployments.

Planned changes:

- **v1.3.x (direction)**: `TECHNITIUM_CLUSTER_TOKEN` is **deprecated**. Background jobs (e.g., PTR hostname warming, scheduled sync) are expected to require a dedicated `TECHNITIUM_BACKGROUND_TOKEN` (instead of using an admin token).
- **v1.4**:
  - Interactive UI access requires session auth (Technitium login/RBAC).
  - `TECHNITIUM_CLUSTER_TOKEN` support is planned to be **removed**.

Docs: [docs/features/SESSION_AUTH_AND_TOKEN_MIGRATION.md](docs/features/SESSION_AUTH_AND_TOKEN_MIGRATION.md)

## Use Cases

- **Mobile Management** - Block/unblock domains from your phone
- **Multi-Node Visibility** - See query logs from all DNS servers in one place
- **Configuration Comparison** - Visualize consistency across DNS nodes
- **Advanced Blocking** - Easy management of domain lists
- **DHCP Overview** - Compare and sync DHCP scopes across nodes

## Web-based User Interface

[Features Light & Dark Mode](https://fail-safe.github.io/Technitium-DNS-Companion/#screenshots)

## Requirements

- **Docker, OrbStack, or Podman (or similar)** (recommended for easiest deployment)
- **OR Node.js 22+** (for running directly without Docker)
- Access to one or more Technitium DNS servers (v13.6 or v14.0+)
- For **session auth (required for interactive UI in v1.4+)**: a Technitium user account to sign in with (run Companion over HTTPS)
- For **legacy env-token mode**: admin API token(s) from your Technitium DNS server(s)

## Quick Start with Docker (or similar) [Recommended]

The fastest path is the download-and-run script (no repo clone required). For full options and HTTPS details, see [DOCKER.md](DOCKER.md).

macOS/Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Fail-Safe/Technitium-DNS-Companion/main/scripts/docker-quickstart.sh -o docker-quickstart.sh
chmod +x docker-quickstart.sh
./docker-quickstart.sh
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/Fail-Safe/Technitium-DNS-Companion/main/scripts/docker-quickstart.ps1 -OutFile docker-quickstart.ps1
powershell -ExecutionPolicy Bypass -File .\docker-quickstart.ps1
```

What the script does:

- Verifies Docker is running
- Downloads .env.example into technitium.env if missing
- Shows (and can run) the docker run command
- Pulls the selected image first (so `:latest` stays current)

If `technitium.env` does not exist yet, the script will create it and exit so you can edit it. After updating `technitium.env`, rerun the script: it will confirm your desired HTTP/HTTPS ports, show the exact `docker run` command, and only executes it when you press Enter (any other key cancels).

Note: the script requires HTTP and HTTPS to use different host ports (it will re-prompt if you enter the same port for both).

For manual docker run or compose instructions, head to [DOCKER.md](DOCKER.md).

## Configuration

Technitium-DNS-Companion supports both **v13.6 (standalone)** and **v14.0+ (clustering)** configurations.

#### Technitium DNS v14.0+ with Clustering (Recommended)

When clustering is enabled in Technitium DNS v14.0+, the recommended setup is session auth for interactive UI access:

```bash
TECHNITIUM_NODES=primary,secondary1,secondary2

TECHNITIUM_PRIMARY_BASE_URL=https://primary.home.arpa:53443
TECHNITIUM_SECONDARY1_BASE_URL=https://secondary1.home.arpa:53443
TECHNITIUM_SECONDARY2_BASE_URL=https://secondary2.home.arpa:53443

# Background jobs (recommended): least-privilege token
# TECHNITIUM_BACKGROUND_TOKEN=your-low-privilege-token
```

**Example config:** See [`configs/.env.example.v14`](https://github.com/Fail-Safe/Technitium-DNS-Companion/blob/main/configs/.env.example.v14)

**Cluster Features:**

- Automatic cluster detection
- Primary/Secondary role awareness
- Write operations restricted to Primary node
- Automatic cluster role change detection (every 30 seconds)
- Sync tab hidden (not needed with native clustering)

#### Technitium DNS v13.6 (Standalone Nodes)

For v13.6 or nodes without clustering, per-node env tokens are legacy-only (Technitium DNS < v14):

```bash
# Each node has its OWN unique token
TECHNITIUM_NODES=node1,node2,node3

TECHNITIUM_NODE1_BASE_URL=https://dns1.yourdomain.com:5380
TECHNITIUM_NODE1_TOKEN=unique-token-for-node1

TECHNITIUM_NODE2_BASE_URL=https://dns2.yourdomain.com:5380
TECHNITIUM_NODE2_TOKEN=unique-token-for-node2

TECHNITIUM_NODE3_BASE_URL=https://dns3.yourdomain.com:5380
TECHNITIUM_NODE3_TOKEN=unique-token-for-node3
```

**Example config:** See [`configs/.env.example.v13`](https://github.com/Fail-Safe/Technitium-DNS-Companion/blob/main/configs/.env.example.v13)

**Standalone Features:**

- All nodes shown as "Standalone"
- No write restrictions (all nodes can be modified)
- Sync tab available for manual synchronization
- Zone comparison helps identify differences

**Production**: See [DOCKER.md](./DOCKER.md) for complete Docker deployment configuration.

### Optional storage features

These features write data to disk and are disabled unless explicitly enabled/configured. If you run in Docker, keep a `/data` volume mount so the data persists across container restarts.

- **SQLite rolling query log store (optional)**
  - Improves accuracy for time-window browsing (e.g., “Last 24h”) by continuously ingesting query logs into a local SQLite DB.
  - Key env vars: `QUERY_LOG_SQLITE_ENABLED`, `QUERY_LOG_SQLITE_PATH`, `QUERY_LOG_SQLITE_RETENTION_HOURS`.
  - Session-auth note: the ingester runs as a background task and may require `TECHNITIUM_BACKGROUND_TOKEN`.
  - Docs: [docs/features/query-logs/SQLITE_ROLLING_QUERY_LOG_STORE.md](docs/features/query-logs/SQLITE_ROLLING_QUERY_LOG_STORE.md)

- **DNS Filtering History snapshots (optional)**
  - Stores snapshot JSON files so Built-in Blocking / Advanced Blocking changes can be rolled back.
  - Key env vars: `DNS_FILTERING_SNAPSHOT_DIR`, `DNS_FILTERING_SNAPSHOT_RETENTION`.
  - See `.env.example` for defaults and persistence notes.

## Features

### Core Functionality

- **Multi-Node Management** - Monitor and manage multiple servers from one interface
- **Query Logs** - View combined query logs from all configured nodes (optional SQLite stored logs for accurate time-window browsing; see [docs/features/query-logs/SQLITE_ROLLING_QUERY_LOG_STORE.md](docs/features/query-logs/SQLITE_ROLLING_QUERY_LOG_STORE.md))
- **Advanced Blocking** - Manage domain allow/block lists (requires Advanced Blocking App), with optional DNS Filtering History (snapshots) for quick rollback

### Analysis & Comparison

- **Zone Comparison** - Compare DNS zones across nodes and identify differences
- **DHCP Management** - View and clone DHCP scopes across nodes
- **Auto-Detection** - Automatically detects which apps are installed on each node

### User Experience

- **Responsive UI** - Mobile-friendly interface built with React and TailwindCSS
- **Cluster Support** - Automatic detection and support for Technitium DNS v14+ clustering
- **Touch-Optimized** - Designed for easy use on smartphones and tablets

## License

MIT License - see LICENSE file for details
