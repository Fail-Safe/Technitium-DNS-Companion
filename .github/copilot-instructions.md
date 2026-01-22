# Technitium-DNS-Companion

## Summary

Technitium-DNS-Companion is a tool for keeping 2+ Technitium DNS servers in sync. It is designed to be a simple and easy to use, responsive web application that can be used to sync multiple Technitium DNS servers.

## Inquiries/Verbosity

High verbosity is appreciated when suggesting changes or configurations.

Please ask questions of me. I would rather you be more verbose than to make assumptions and changes without understanding my intentions and consulting me first.

## Performance Optimization

**Performance Features:** Backend optimizations including caching, deduplication, and throttling.

See `docs/performance/BACKEND_PERFORMANCE_QUICK_START.md` for implementation details.

## Important Notes

- NEVER put private admin tokens or sensitive information in public repositories or share them publicly.
- NEVER commit real admin tokens or sensitive information to version control.

## Technitium DNS

Project page: https://github.com/TechnitiumSoftware/DnsServer/tree/master
HTTP API documentation: https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md
Advanced Blocking app config: https://github.com/TechnitiumSoftware/DnsServer/blob/master/Apps/AdvancedBlockingApp/dnsApp.config
Docker environment variables: https://github.com/TechnitiumSoftware/DnsServer/blob/master/DockerEnvironmentVariables.md

## Example Environment

This project is designed to work with multiple Technitium DNS servers in various configurations:

- **Supported Versions**: Technitium DNS v13.6.0+
- **Deployment**: Docker or standalone installations
- **Clustering**: Full support for Technitium DNS cluster configurations
  - Automatically detects Primary/Secondary node roles
  - Primary nodes allow write operations
  - Secondary nodes are read-only replicas
- **Network**: Works with static IPs, DHCP, VPN (Tailscale/WireGuard), or public IPs
- **SSL/TLS**: Supports both Let's Encrypt and self-signed certificates
- **Authentication**: Uses Technitium DNS admin tokens for API access

## Technitium-DNS-Companion Cluster Support

**Implementation Status**: ✅ Active (November 8, 2025)

**Backend**:

- `/api/nodes` endpoint returns `isPrimary: true/false` for each node
- Primary node automatically detected by parsing `clusterNodes` array from Technitium DNS API
- Cluster state includes: `type` (Primary/Secondary/Standalone), `domain`, `health`

**Frontend**:

- Helper hooks available: `usePrimaryNode()`, `useIsClusterEnabled()`, `useClusterNodes()`
- Write pages (DNS Filtering, DHCP, Zones Management) auto-select Primary node
- `<ClusterInfoBanner>` component displays restriction notice on write pages
- Read-only views (Dashboard, Logs, Sync) can still view all nodes

**Key Files**:

- `apps/backend/src/technitium/technitium.service.ts` - Primary detection logic
- `apps/frontend/src/hooks/usePrimaryNode.ts` - Helper hooks
- `apps/frontend/src/components/common/ClusterInfoBanner.tsx` - Info banner component
- `docs/features/clustering/CLUSTER_PRIMARY_WRITE_RESTRICTION.md` - Complete implementation guide

## Tools and Technologies

- Frontend: React or Vue.js, but I'm open to other suggestions
- Backend: Node.js with Express, but I'm open to other suggestions
- Technitium DNS API for interacting with Technitium DNS servers

## Production Deployment

**Deployment Options**:

- **Docker Compose** (Recommended): Use `docker-compose.yml` for production deployment
- **Frontend**: React + Vite SPA served by backend or nginx
- **Backend**: NestJS REST API with HTTPS support
- **Configuration**: Environment variables for node credentials (see `.env.example`)
  - Interactive UI access: Technitium-backed session auth (v1.4+: always enabled)
  - Background jobs: `TECHNITIUM_BACKGROUND_TOKEN` (least-privilege)
  - Legacy/migration only: `TECHNITIUM_CLUSTER_TOKEN` (deprecated v1.3, removed v1.4)
  - Legacy only (Technitium DNS < v14): per-node `TECHNITIUM_<NODE>_TOKEN`
  - Frontend uses `VITE_API_URL` to connect to backend API

## Project Structure

This is a **monorepo** with the following structure:

```
technitium-dns-companion/
├── apps/
│   ├── backend/          # NestJS REST API server
│   │   ├── src/
│   │   │   ├── technitium/   # Technitium DNS service & controllers
│   │   │   └── main.ts
│   │   └── package.json
│   └── frontend/         # React + Vite SPA
│       ├── src/
│       │   ├── components/
│       │   ├── pages/
│       │   ├── context/
│       │   └── types/
│       └── package.json
├── docs/                 # All project documentation
└── configs/              # Sample configuration files
```

**Tech Stack**:

- **Backend**: NestJS (TypeScript), Axios for HTTP requests
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS
- **State Management**: React Context API
- **Communication**: REST API (backend serves frontend in production)

## Project Documentation

**IMPORTANT**: Comprehensive documentation is organized in the `docs/` folder.

- **Start here**: Read `docs/README.md` for complete documentation structure and navigation
- **Architecture**: See `docs/architecture.md` for system design overview
- **Features**: Feature documentation in `docs/features/`
- **Zone Comparison**: All zone comparison logic documented in `docs/zone-comparison/`
- **UI Guidelines**: Frontend documentation in `docs/ui/`
- **Performance**: Optimization details in `docs/performance/`

**Before implementing features**: Check relevant documentation to understand existing patterns and decisions.

**Key Documents**:

- 🏗️ `docs/architecture.md` - System design
- 🔍 `docs/zone-comparison/ZONE_TYPE_MATCHING_LOGIC.md` - Zone comparison logic
- 🎨 `docs/ui/UI_QUICK_REFERENCE.md` - UI component guide
- ⚡ `docs/performance/BACKEND_PERFORMANCE_QUICK_START.md` - Performance optimizations

## Development Workflow

### Running Locally

```bash
# Backend (port 3000)
cd apps/backend
npm install
npm run start:dev

# Frontend (port 5173)
cd apps/frontend
npm install
npm run dev
```

### Development Options

- Local development (backend on `localhost:3000`, frontend on `localhost:5173`)
- Remote development with hot-reload (see `scripts/remote-dev.sh.example`)
- Docker development environment with `docker-compose.dev-hotreload.yml`

**Backend API Base**: `http://localhost:3000/api`

**Key API Endpoints**:

- `/api/nodes` - List configured nodes
- `/api/nodes/:nodeId/status` - Node status
- `/api/logs/combined` - Combined query logs
- `/api/zones/combined` - Combined zone comparison
- `/api/dhcp/:nodeId/scopes` - DHCP scopes

**Configuration**: Node credentials are configured via environment variables or config file (see backend README).

### Deployment

#### Publishing to GitHub

Always update ./CHANGELOG.md and version in `./package.json` before publishing.

The ./CHANGELOG.md follows Keep a Changelog format: https://keepachangelog.com/en/1.1.0/

Guiding Principles

    Changelogs are for humans, not machines.
    There should be an entry for every single version.
    The same types of changes should be grouped.
    Versions and sections should be linkable.
    The latest version comes first.
    The release date of each version is displayed.
    Mention whether you follow Semantic Versioning.

Types of changes

    Added for new features.
    Changed for changes in existing functionality.
    Deprecated for soon-to-be removed features.
    Removed for now removed features.
    Fixed for any bug fixes.
    Security in case of vulnerabilities.

Adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

````bash

## Testing & Verification

**Backend Tests**:

```bash
cd apps/backend
npm run test          # Unit tests
npm run test:e2e      # E2E tests
npm run test:benchmark # Performance benchmarks
npm run build         # Verify TypeScript compilation
````

**Performance Benchmarks**:

```bash
# From project root
./scripts/run-baseline-benchmarks.sh  # Runs all benchmarks with env validation
```

**Frontend Build**:

```bash
cd apps/frontend
npm run build         # Production build
npm run preview       # Preview production build
```

**Manual Testing Checklist**:

- [ ] Zone comparison shows correct status badges
- [ ] Primary+Secondary zones show "in-sync" (not false "different")
- [ ] Query logs display from both nodes
- [ ] DHCP scope cloning works cross-node
- [ ] Mobile responsive layout works (< 768px width)
- [ ] Toast notifications appear for errors/success

## Terminology & Conventions

**Node References**:

- **Primary Node** = Primary cluster node - typically the "source of truth"
- **Secondary Node** = Secondary cluster node - typically syncs from Primary
- **Node** = A Technitium DNS server instance
- **nodeId** = Identifier in code (e.g., "node1", "node2")

**Zone Types** (Important for comparison logic):

- **Primary Zone** = Authoritative, can be edited, sends notifications
- **Secondary Zone** = Read-only replica, receives zone transfers
- **Primary Forwarder** = Primary conditional forwarder with Zone Transfer/Notify options
- **Secondary Forwarder** = Secondary conditional forwarder (no Zone Transfer/Notify options)

**Comparison Status**:

- `in-sync` = Configurations match across nodes
- `different` = Configurations differ (needs attention)
- `missing` = Zone exists on some nodes but not others
- `unknown` = Unable to determine status (error occurred)

**Important**: Primary Zones vs Secondary Zones should NOT be compared (different roles, expected to differ). See `docs/zone-comparison/ZONE_TYPE_MATCHING_LOGIC.md`.

## Common Patterns & Gotchas

**Backend Patterns**:

- All Technitium DNS API calls go through `TechnitiumService`
- Use `unwrapApiResponse()` to extract data from Technitium's response envelope
- Node credentials primarily come from Technitium-backed user sessions (session auth); background work uses `TECHNITIUM_BACKGROUND_TOKEN`
- Axios errors are normalized to NestJS `HttpException` types

**Frontend Patterns**:

- Use `TechnitiumContext` for API calls and node state
- Use `ToastContext` for user notifications
- Zone status badges: green (in-sync), red (different), yellow (missing), gray (unknown)
- Mobile-first responsive design (touch-friendly controls)

**Important Gotchas**:

1. **Zone Type Matching**: Don't compare zones with different types (Primary vs Secondary)
2. **Secondary Forwarders**: Lack Zone Transfer/Notify options (expected behavior)
3. **Internal Zones**: Filter out built-in zones (0.in-addr.arpa, etc.) from comparison
4. **Array Comparison**: Sort and normalize arrays before comparing (order shouldn't matter)
5. **Technitium DNS API**: Requires token parameter on most endpoints
6. **Timeout**: Backend requests have 30s timeout for VPN/remote development

## Non-negotiables

- Must be mobile-friendly and responsive. Users should be able to manage their Technitium DNS servers from their phones.
- Must support multiple Technitium DNS servers.
- Must be able to show domain queries and statuses per Technitium DNS server and in aggregate (if possible, as an option)
- Must be able to choose to which Advanced Blocking groups a domain is added when blacklisting a domain.
- Must be able to modify existing allowlist/blocklist entries and their associated group(s)

## Nice-to-haves

- Would be ideal if a blocked domain could be whitelisted easily with a single click from the query log view.
- Would be ideal if a domain could be blacklisted easily with a single click from the query log view.
- Would be ideal if I could see query statistics (e.g., number of queries, number of blocked queries, top queried domains) for each Technitium DNS server and in aggregate (if possible, as an option).
- Would be ideal if allowlist/blocklist entries could be bulk edited, mostly for adding/removing group(s).

## Phases

### Phase 1: Basic Functionality

- [x] Create a web application using a responsive framework (e.g., React, Vue.js).
- [ ] Implement login and authentication for Technitium DNS servers.
- [x] Implement a dashboard to display the status of connected Technitium DNS servers.
- [x] Implement functionality to connect multiple Technitium DNS servers.
- [x] Implement synchronization of basic settings (e.g., DNS records, DHCP settings) across multiple Technitium DNS servers (DHCP sync implemented; DNS & DHCP settings aggregation in progress).
- [ ] Implement conflict resolution for settings.
- [x] Implement logging and error handling (basic error handling, toasts and backend status pages implemented).

### Phase 2: Advanced Blocking Functionality

Management the Advanced Blocking app on multiple Technitium DNS nodes: https://github.com/TechnitiumSoftware/DnsServer/tree/master/Apps/AdvancedBlockingApp

- [ ] Implement management of Advanced Blocking domains, lists, clients, etc. in the web application.
- [ ] Implement synchronization of Advanced Blocking settings across multiple Technitium DNS servers.
- [ ] Implement conflict resolution for Advanced Blocking settings.

## Working with Technitium DNS Apps

You can get/set configs for apps via:

### Get App Config

Retrieve the DNS application config from the `dnsApp.config` file in the application folder.

URL:\
`http://localhost:5380/api/apps/config/get?token=x&name=app-name`

OBSOLETE PATH:\
`/api/apps/getConfig`

PERMISSIONS:\
Apps: View

WHERE:

- `token`: The session token generated by the `login` or the `createToken` call.
- `name`: The name of the app to retrieve the config.

RESPONSE:

```
{
	"response": {
		"config": "config data or `null`"
	},
	"status": "ok"
}
```

### Set App Config

Saves the provided DNS application config into the `dnsApp.config` file in the application folder.

URL:\
`http://localhost:5380/api/apps/config/set?token=x&name=app-name`

OBSOLETE PATH:\
`/api/apps/setConfig`

PERMISSIONS:\
Apps: Modify

WHERE:

- `token`: The session token generated by the `login` or the `createToken` call.
- `name`: The name of the app to retrieve the config.

REQUEST: This is a POST request call where the content type of the request must be `application/x-www-form-urlencoded` and the content must be as shown below:

```
config=query-string-encoded-config-data
```

RESPONSE:

```
{
	"response": {},
	"status": "ok"
}
```
