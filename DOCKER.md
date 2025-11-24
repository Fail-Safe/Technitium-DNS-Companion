# Technitium DNS Companion - Docker Deployment

This guide covers deploying Technitium DNS Companion with Docker, including both **production deployment** (single optimized container) and **development mode** (hot-reload for rapid development).

## Choose Your Deployment Mode

- **Production Deployment** → Use `docker-compose.yml` for optimized single container
- **Development with Hot-Reload** → Use `docker-compose.dev-hotreload.yml` for instant code changes

---

## Development Mode (Hot-Reload) 🔥

Perfect for active development! Changes to your code are reflected **instantly** without rebuilding.

### Quick Start - Development

```bash
# Start development environment
./scripts/dev-docker.sh start

# Access:
# - Frontend (HMR): http://localhost:5173
# - Backend API:    http://localhost:3000/api
```

### How It Works

The development setup uses **volume mounts** to sync your local code into the container:

- **Backend**: NestJS runs in watch mode, auto-restarts on changes
- **Frontend**: Vite HMR (Hot Module Replacement) for instant updates
- **No rebuilds needed**: Edit code locally, see changes immediately

### Development Commands

```bash
./scripts/dev-docker.sh start      # Start dev environment
./scripts/dev-docker.sh logs       # View logs (all)
./scripts/dev-docker.sh logs-be    # Backend logs only
./scripts/dev-docker.sh logs-fe    # Frontend logs only
./scripts/dev-docker.sh shell      # Open shell in container
./scripts/dev-docker.sh stop       # Stop dev environment
./scripts/dev-docker.sh restart    # Restart services
./scripts/dev-docker.sh clean      # Remove volumes (fresh start)
./scripts/dev-docker.sh status     # Show container status
```

### What Gets Hot-Reloaded?

✅ **Backend (`apps/backend/src/`)** - NestJS watch mode
✅ **Frontend (`apps/frontend/src/`)** - Vite HMR
✅ **Config files** - TypeScript configs, Vite config
❌ **node_modules** - Preserved in named volumes (faster)
❌ **package.json changes** - Requires rebuild

### When to Use Development Mode

- Active feature development
- Testing changes rapidly
- Debugging issues
- Learning the codebase
- Working on UI/UX

### HTTPS in Development Mode (Optional)

To enable HTTPS during development:

1. **Prepare SSL Certificates**

   Place certificates in a `certs` directory:
   ```bash
   mkdir certs
   # Copy your certificates here
   certs/
   ├── fullchain.pem
   └── privkey.pem
   ```

2. **Update .env**

   ```bash
   HTTPS_ENABLED=true
   HTTPS_PORT=3443
   HTTPS_CERT_PATH=/app/certs/fullchain.pem
   HTTPS_KEY_PATH=/app/certs/privkey.pem
   CORS_ORIGIN=http://localhost:5173,https://localhost:5174
   ```

3. **Update docker-compose.dev-hotreload.yml**

   Uncomment the SSL certificates volume mount:
   ```yaml
   volumes:
     # SSL Certificates - uncomment and update path
     - ./certs:/app/certs:ro
     # Or for Let's Encrypt:
     # - /etc/letsencrypt/live/your-domain:/app/certs:ro
   ```

4. **Restart Development Environment**

   ```bash
   ./scripts/dev-docker.sh restart
   ```

5. **Access via HTTPS**

   - Frontend: https://localhost:5174 (Vite HTTPS dev server)
   - Backend: https://localhost:3443/api

**Note:** Vite will automatically use HTTPS if the backend is configured with HTTPS. Both HTTP and HTTPS will be available simultaneously.

---

## Production Deployment 🚀

Optimized single container with built static assets. Best for production use.

### Development vs Production Comparison

| Feature | Development Mode | Production Mode |
|---------|-----------------|-----------------|
| **Build Time** | ~2 minutes | ~3 minutes (full build) |
| **Startup Time** | ~30 seconds | ~5 seconds |
| **Code Changes** | ✅ Instant hot-reload | ❌ Requires rebuild |
| **Image Size** | ~500MB (with devDeps) | ~150MB (optimized) |
| **Memory Usage** | ~512MB | ~256MB |
| **Ports** | 3000 (API) + 5173 (frontend) | 3000 only |
| **Best For** | Active development | Production deployment |
| **TypeScript** | Compiled on-the-fly | Pre-compiled |
| **Source Maps** | ✅ Full debugging | ❌ Production build |

## Quick Start - Production

### 1. Create Environment File

Copy the example environment file and configure your Technitium DNS nodes:

```bash
cp .env.example .env
```

Edit `.env` and configure your nodes:

```bash
# Define your nodes
TECHNITIUM_NODES=node1,node2

# Cluster token (for clustered nodes - recommended)
TECHNITIUM_CLUSTER_TOKEN=your-shared-cluster-token

# Configure Node 1 (Primary)
TECHNITIUM_NODE1_NAME="DNS Primary"
TECHNITIUM_NODE1_BASE_URL=https://dns-primary.example.com:53443

# Configure Node 2 (Secondary)
TECHNITIUM_NODE2_NAME="DNS Secondary"
TECHNITIUM_NODE2_BASE_URL=https://dns-secondary.example.com:53443

# Alternative: Per-node tokens (if not using cluster token)
# TECHNITIUM_NODE1_TOKEN=your_node1_admin_token
# TECHNITIUM_NODE2_TOKEN=your_node2_admin_token
```

### 2. Build and Run

```bash
# Build the container
docker compose build

# Start the application
docker compose up -d

# View logs
docker compose logs -f
```

### 3. Access the Application

- **HTTP**: http://localhost:3000
- **HTTPS**: https://localhost:3443 (if HTTPS is enabled)

The frontend is automatically served from the backend on the same port.

## HTTPS Configuration (Optional)

To enable HTTPS:

1. **Prepare SSL Certificates**

   Place your SSL certificates in a `certs` directory:
   ```
   certs/
   ├── fullchain.pem   # Full certificate chain
   ├── privkey.pem     # Private key
   └── chain.pem       # CA chain (optional)
   ```

2. **Update .env**

   ```bash
   HTTPS_ENABLED=true
   HTTPS_PORT=3443
   HTTPS_CERT_PATH=/app/certs/fullchain.pem
   HTTPS_KEY_PATH=/app/certs/privkey.pem
   HTTPS_CA_PATH=/app/certs/chain.pem  # Optional
   ```

3. **Update docker-compose.yml**

   Uncomment the certificates volume mount:
   ```yaml
   volumes:
     - ./certs:/app/certs:ro
   ```

4. **Restart**

   ```bash
   docker compose down
   docker compose up -d
   ```

## Configuration Options

### Node Configuration

Each node requires:
- `TECHNITIUM_<ID>_NAME` - Display name
- `TECHNITIUM_<ID>_BASE_URL` - Full URL to Technitium DNS server
- `TECHNITIUM_<ID>_TOKEN` - Admin API token (recommended)

Or use basic auth:
- `TECHNITIUM_<ID>_USERNAME` - Admin username
- `TECHNITIUM_<ID>_PASSWORD` - Admin password

### Port Configuration

Default ports:
- HTTP: `3000`
- HTTPS: `3443`

To change ports, update both `.env` and `docker-compose.yml`:

```yaml
# docker-compose.yml
ports:
  - "8080:3000"  # Map host port 8080 to container port 3000
```

## Production Deployment Example

Here's a typical production deployment setup:

### 1. Create `.env` File

```bash
cd /opt/technitium-dns-companion
cat > .env << 'EOF'
NODE_ENV=production
PORT=3000
HTTPS_ENABLED=true
HTTPS_PORT=3443
HTTPS_CERT_PATH=/app/certs/fullchain.pem
HTTPS_KEY_PATH=/app/certs/privkey.pem

TECHNITIUM_NODES=node1,node2
TECHNITIUM_CLUSTER_TOKEN=your_shared_cluster_token

TECHNITIUM_NODE1_NAME="DNS Primary"
TECHNITIUM_NODE1_BASE_URL=https://dns-primary.example.com:53443

TECHNITIUM_NODE2_NAME="DNS Secondary"
TECHNITIUM_NODE2_BASE_URL=https://dns-secondary.example.com:53443
EOF
```

### 2. Mount SSL Certificates

Update `docker-compose.yml`:

```yaml
volumes:
  - /etc/letsencrypt/live/example.com:/app/certs:ro
```

### 3. Update Ports (if needed)

If you want to use the same ports as your current setup:

```yaml
ports:
  - "5174:3443"  # HTTPS on 5174
```

And in `.env`:
```bash
HTTPS_PORT=3443  # Internal container port stays 3443
```

### 4. Deploy

```bash
cd /opt/technitium-dns-companion
docker compose build
docker compose up -d
```

Access at: **https://example.com:5174**

## Management Commands

```bash
# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down

# Rebuild after code changes
docker compose build --no-cache
docker compose up -d

# View container status
docker compose ps

# Shell into container
docker compose exec technitium-dns-companion sh
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs

# Verify environment variables
docker compose config
```

### Can't connect to Technitium DNS nodes

```bash
# Test from within container
docker compose exec technitium-dns-companion sh
wget -O- https://dns-primary.example.com:53443/api/status?token=your_token
```

### Frontend not loading

```bash
# Verify frontend was built and copied
docker compose exec technitium-dns-companion ls -la /app/frontend/dist
```

## Resource Usage

The container uses minimal resources:
- **Memory**: ~256MB typical, 512MB limit
- **CPU**: Minimal (bursts during sync operations)
- **Disk**: ~100MB image size

## Updating

To update to a new version:

```bash
# Pull latest code
cd /opt/technitium-dns-companion
git pull

# Rebuild and restart
docker compose build --no-cache
docker compose up -d
```

## Benefits of Single Container

✅ **Simpler deployment** - One container instead of two
✅ **Lower resource usage** - Shared Node.js runtime
✅ **No CORS issues** - Frontend and API on same origin
✅ **Easier networking** - No inter-container communication
✅ **Single port** - Only expose one port (HTTP or HTTPS)
✅ **Faster startup** - Less container orchestration overhead

## Architecture

```
┌─────────────────────────────────────┐
│   Docker Container (node:22-alpine) │
│                                     │
│  ┌──────────────────────────────┐   │
│  │  NestJS Backend (Port 3000)  │   │
│  │  - API routes: /api/*        │   │
│  │  - Serves frontend: /*       │   │
│  │  - Static assets: /assets/*  │   │
│  └──────────────────────────────┘   │
│                                     │
│  Frontend (Built Static Files)      │
│  - Served by NestJS                 │
│  - No separate web server needed    │
└─────────────────────────────────────┘
```

## Migration from Two-Container Setup

If you were using the previous two-container setup:

1. **Stop old containers**
   ```bash
   docker compose -f docker-compose.dev.yml down
   ```

2. **Follow Quick Start above**

3. **Update any port references**
   - Old: Frontend on 5174, Backend on 3443
   - New: Everything on 3443 (or your chosen port)

Your environment variables remain the same!
