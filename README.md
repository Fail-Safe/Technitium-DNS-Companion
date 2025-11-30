# Technitium DNS Companion

A multi-node companion tool for aiding in day-to-day management of Technitium DNS servers. Currently offers additional functionality for:
- DNS Query Logs (DNS Logs)
- Advanced Blocking App upkeep (DNS Filtering)
- DNS Zone Insight (DNS Zones)
- DHCP Scopes

One primary goal of this project is to provide a more mobile-friendly interface for managing day-to-day DNS functions, enabling administrators to perform common tasks (like domain blocking/unblocking) from smartphones and tablets with ease.

This project is **not affiliated with Technitium** but is built to complement Technitium DNS server deployments and not to replace functionality.

## Use Cases

- 📱 **Mobile Management** - Block/unblock domains from your phone
- 🔍 **Multi-Node Visibility** - See query logs from all DNS servers in one place
- ⚖️ **Configuration Comparison** - Visualize consistency across DNS nodes
- 🛡️ **Advanced Blocking** - Easy management of domain lists
- 📊 **DHCP Overview** - Compare and sync DHCP scopes across nodes

## Requirements

- **Docker, OrbStack, or Podman (or similar)** (recommended for easiest deployment)
- **OR Node.js 22+** (for running directly without Docker)
- Access to one or more Technitium DNS servers (v13.6 or v14.0+)
- Admin API token(s) from your Technitium DNS server(s)

## Quick Start with Docker (or similar) [Recommended]

The easiest way to deploy Technitium DNS Companion is using Docker:

```bash
# 1. Get a copy of the example environment file
curl -sL https://raw.githubusercontent.com/Fail-Safe/Technitium-DNS-Companion/main/.env.example -o technitium.env
# Or wget:
# wget -q https://raw.githubusercontent.com/Fail-Safe/Technitium-DNS-Companion/main/.env.example -O technitium.env
# Or PowerShell:
# Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Fail-Safe/Technitium-DNS-Companion/main/.env.example" -OutFile "technitium.env"

# 2. Edit technitium.env with your Technitium DNS server details
# Edit the `TECHNITIUM_NODES`, `TECHNITIUM_*_BASE_URL`, and `TECHNITIUM_*_TOKEN` values depending on your environment.

# 3. Run the Docker container with your environment settings file
docker run --rm -p 3000:3000 -p 3443:3443 \
  --env-file technitium.env \
  -v technitium-dns-companion-data:/data \
  ghcr.io/fail-safe/technitium-dns-companion:latest

# 4. Access the web interface
#  HTTP:  http://localhost:3000
#  HTTPS: https://localhost:3443 (if HTTPS_ENABLED=true in .env)
```

**📘 See [DOCKER.md](./DOCKER.md) for complete Docker deployment instructions**, including HTTPS setup, production deployment, and troubleshooting.

## Configuration

Technitium-DNS-Companion supports both **v13.6 (standalone)** and **v14.0+ (clustering)** configurations.

#### Technitium DNS v14.0+ with Clustering (Recommended)

When clustering is enabled in Technitium DNS v14.0+, all nodes share the same admin token:

```bash
# All nodes use the SAME token (synced by Technitium DNS Primary node)
TECHNITIUM_NODES=primary,secondary1,secondary2

TECHNITIUM_PRIMARY_BASE_URL=https://primary.home.arpa:53443
TECHNITIUM_PRIMARY_TOKEN=shared-cluster-token

TECHNITIUM_SECONDARY1_BASE_URL=https://secondary1.home.arpa:53443
TECHNITIUM_SECONDARY1_TOKEN=shared-cluster-token  # Same token!

TECHNITIUM_SECONDARY2_BASE_URL=https://secondary2.home.arpa:53443
TECHNITIUM_SECONDARY2_TOKEN=shared-cluster-token  # Same token!
```

**📄 Example config:** See [`configs/.env.example.v14`](./configs/.env.example.v14)

**Cluster Features:**
- ✅ Automatic cluster detection
- ✅ Primary/Secondary role awareness
- ✅ Write operations restricted to Primary node
- ✅ Automatic cluster role change detection (every 30 seconds)
- ✅ Sync tab hidden (not needed with native clustering)

#### Technitium DNS v13.6 (Standalone Nodes)

For v13.6 or nodes without clustering, each node has a unique admin token:

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

**📄 Example config:** See [`configs/.env.example.v13`](./configs/.env.example.v13)

**Standalone Features:**
- ✅ All nodes shown as "Standalone"
- ✅ No write restrictions (all nodes can be modified)
- ✅ Sync tab available for manual synchronization
- ✅ Zone comparison helps identify differences

**Production**: See [DOCKER.md](./DOCKER.md) for complete Docker deployment configuration.

## Features

### Core Functionality

- ✅ **Multi-Node Management** - Monitor and manage multiple servers from one interface
- ✅ **Query Logs** - View combined query logs from all configured nodes
- ✅ **Advanced Blocking** - Manage domain allow/block lists (requires Advanced Blocking App)

### Analysis & Comparison

- ✅ **Zone Comparison** - Compare DNS zones across nodes and identify differences
- ✅ **DHCP Management** - View and clone DHCP scopes across nodes
- ✅ **Auto-Detection** - Automatically detects which apps are installed on each node

### User Experience

- ✅ **Responsive UI** - Mobile-friendly interface built with React and TailwindCSS
- ✅ **Cluster Support** - Automatic detection and support for Technitium DNS v14+ clustering
- ✅ **Touch-Optimized** - Designed for easy use on smartphones and tablets

## License

MIT License - see LICENSE file for details
