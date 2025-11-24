# Remote Development on REMOTE-SERVER

This guide explains how to run the hot-reload development environment on your REMOTE-SERVER server while editing files locally on your Mac.

## Overview

**Workflow:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    Your Mac (Local)                              │
│                                                                   │
│  ┌──────────────┐         ┌──────────────┐                      │
│  │  VS Code     │         │  Terminal    │                      │
│  │  Edit files  │────────▶│  Watch/Sync  │                      │
│  │  locally     │         │  (rsync)     │                      │
│  └──────────────┘         └──────┬───────┘                      │
│                                   │                              │
└───────────────────────────────────┼──────────────────────────────┘
                                    │ SSH + rsync
                                    │ File changes
                                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    REMOTE-SERVER (Remote Server)                          │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  Docker Container (technitium-dns-companion-dev)              │       │
│  │                                                       │       │
│  │  ┌─────────────┐          ┌──────────────┐          │       │
│  │  │  Backend    │          │  Frontend    │          │       │
│  │  │  (NestJS)   │          │  (Vite)      │          │       │
│  │  │  Hot-reload │          │  HMR         │          │       │
│  │  └─────────────┘          └──────────────┘          │       │
│  │                                                       │       │
│  │  Files: /opt/technitium-dns-companion/                        │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Access via browser
                                    ▼
                          http://remote-server.example.com:5173
```

## Quick Start

### 1. Start Remote Development Environment

```bash
./scripts/remote-dev.sh start
```

This will:
- Sync your project files to REMOTE-SERVER
- Build and start the Docker container on REMOTE-SERVER
- Show you the access URLs

### 2. Start Auto-Sync (In a new terminal)

```bash
./scripts/remote-dev.sh watch
```

This watches your local files and auto-syncs changes to REMOTE-SERVER.

### 3. Edit Files Locally

Open VS Code and edit files in:
- `apps/backend/src/` - Backend changes
- `apps/frontend/src/` - Frontend changes

Changes will:
1. Be detected by `fswatch` on your Mac
2. Sync to REMOTE-SERVER via `rsync`
3. Trigger hot-reload in the Docker container
4. Update in your browser automatically

### 4. Access the Application

- **Frontend**: http://remote-server.example.com:5173 (or https://remote-server.example.com:5174)
- **Backend**: http://remote-server.example.com:3000/api

## Commands

```bash
# Start remote dev environment
./scripts/remote-dev.sh start

# Watch for changes and auto-sync (run in separate terminal)
./scripts/remote-dev.sh watch

# View remote logs
./scripts/remote-dev.sh logs

# Manually sync files
./scripts/remote-dev.sh sync

# Restart remote container
./scripts/remote-dev.sh restart

# Stop remote dev environment
./scripts/remote-dev.sh stop

# Shell into remote container
./scripts/remote-dev.sh shell

# Check status
./scripts/remote-dev.sh status

# SSH port forwarding (access via localhost)
./scripts/remote-dev.sh forward
```

## Typical Workflow

### Daily Development Session

**Terminal 1:**
```bash
# Start remote environment
./scripts/remote-dev.sh start

# Start watching for changes
./scripts/remote-dev.sh watch
# Leave this running
```

**Terminal 2 (optional):**
```bash
# View logs
./scripts/remote-dev.sh logs
```

**VS Code:**
- Edit files as normal
- Changes auto-sync and hot-reload
- View in browser at http://remote-server.example.com:5173

**End of session:**
```bash
# Stop watching (Ctrl+C in watch terminal)
# Stop remote environment
./scripts/remote-dev.sh stop
```

## Access Methods

### Direct Access (Default)

Access services directly via REMOTE-SERVER's hostname:

- Frontend: http://remote-server.example.com:5173
- Backend: http://remote-server.example.com:3000/api

**Pros:**
- No SSH tunnel needed
- Multiple people can access
- Real network conditions

**Cons:**
- Requires network access to REMOTE-SERVER
- Firewall rules must allow ports

### SSH Port Forwarding (Alternative)

Access services via `localhost` through SSH tunnel:

```bash
./scripts/remote-dev.sh forward
# Access at http://localhost:5173
```

**Pros:**
- Works from anywhere with SSH access
- No firewall rule changes needed
- More secure

**Cons:**
- Single user only
- Requires keeping SSH connection open

## File Sync Details

### What Gets Synced

✅ **Synced:**
- `apps/backend/src/` - Backend source
- `apps/frontend/src/` - Frontend source
- `apps/backend/test/` - Backend tests
- Config files (tsconfig.json, vite.config.ts, etc.)
- Environment files (.env.example)

❌ **Not Synced (Excluded):**
- `node_modules/` - Installed on remote
- `dist/`, `build/` - Built on remote
- `.git/` - Not needed in container
- `coverage/`, `playwright-report/` - Test artifacts
- `.env.local`, `.env.*.local` - Local secrets
- `certs/` - SSL certificates (configure on REMOTE-SERVER directly)

### Sync Triggers

The `watch` command syncs when changes are detected in:
- `apps/backend/src/**/*`
- `apps/frontend/src/**/*`
- `apps/backend/tsconfig.json`
- `apps/frontend/vite.config.ts`

**Latency:** ~0.5 seconds after file save

## Performance

### Sync Speed

| Change Type | Sync Time | Hot-Reload Time | Total |
|-------------|-----------|-----------------|-------|
| Single file edit | ~0.5s | ~1-3s | ~1.5-3.5s |
| Multiple files | ~1-2s | ~1-3s | ~2-5s |
| Config change | ~0.5s | ~3-5s | ~3.5-5.5s |

### Network Requirements

- **SSH access** to REMOTE-SERVER
- **Bandwidth**: Minimal (only changed files sync)
- **Latency**: Works well even with 50-100ms ping

## Troubleshooting

### Watch Not Detecting Changes

**Problem:** Files change but don't sync

**Solutions:**
```bash
# Check if fswatch is installed
which fswatch

# Install if missing
brew install fswatch

# Check if watch is running
ps aux | grep fswatch

# Restart watch
# Ctrl+C in watch terminal, then:
./scripts/remote-dev.sh watch
```

### Container Not Hot-Reloading

**Problem:** Files sync but container doesn't reload

**Solutions:**
```bash
# Check container logs
./scripts/remote-dev.sh logs

# Restart container
./scripts/remote-dev.sh restart

# Check if files actually synced
./scripts/remote-dev.sh shell
ls -la apps/backend/src/
# Verify your changes are there
```

### SSH Connection Issues

**Problem:** Can't connect to REMOTE-SERVER

**Solutions:**
```bash
# Test SSH connection
ssh remote-server echo "Connected!"

# Check SSH config
cat ~/.ssh/config | grep -A 5 remote-server

# Add to ~/.ssh/config if missing:
Host remote-server
    HostName 192.168.1.7
    User root
    IdentityFile ~/.ssh/id_rsa
```

### Slow Sync Performance

**Problem:** Sync takes too long

**Solutions:**
```bash
# Check what's being synced
rsync -avz --dry-run --exclude 'node_modules' \
  /Users/mark/git/technitium-dns-companion/ \
  root@remote-server:/opt/technitium-dns-companion/

# If too many files, check exclusions in script
# Make sure node_modules, dist, etc. are excluded
```

### Port Already in Use

**Problem:** Ports 5173, 3000, etc. already in use on REMOTE-SERVER

**Solutions:**
```bash
# Check what's using the ports
ssh remote-server "lsof -i :5173"
ssh remote-server "lsof -i :3000"

# Stop conflicting services
ssh remote-server "docker ps"
ssh remote-server "docker stop <container_id>"

# Or stop the old deployment
ssh remote-server "cd /opt/technitium-dns-companion && docker compose down"
```

## Comparison: Remote vs Local Development

| Aspect | Local Dev | Remote Dev on REMOTE-SERVER |
|--------|-----------|-------------------|
| **Setup** | Simple | Requires SSH + rsync |
| **Performance** | Native | ~0.5-1s sync delay |
| **Network Access** | localhost only | Real REMOTE-SERVER access |
| **Technitium DNS Access** | VPN/SSH tunnel needed | Direct access (same network) |
| **Multi-device** | One machine | Edit anywhere, runs on REMOTE-SERVER |
| **Resource Usage** | Local RAM/CPU | REMOTE-SERVER resources |
| **Environment** | Mac ARM64 | Linux x86_64 (production-like) |

## Best Practices

### Do's ✅

- Keep watch running in a dedicated terminal
- Use direct access (remote-server.example.com) when on same network
- Check logs regularly: `./scripts/remote-dev.sh logs`
- Commit often - rsync only syncs saved files
- Use `.env` on REMOTE-SERVER for real credentials (not `.env.local`)

### Don'ts ❌

- Don't edit files directly on REMOTE-SERVER (will be overwritten)
- Don't run `npm install` on REMOTE-SERVER manually (container handles it)
- Don't sync large files (add to exclusions if needed)
- Don't forget to stop services when done: `./scripts/remote-dev.sh stop`

## Advanced Usage

### Custom Remote Host

```bash
# Use different server
REMOTE_HOST=primary-node ./scripts/remote-dev.sh start

# Different path
REMOTE_PATH=/srv/technitium-dns-companion ./scripts/remote-dev.sh start
```

### Manual Sync Only

```bash
# Start container
./scripts/remote-dev.sh start

# Sync manually when needed (no watch)
./scripts/remote-dev.sh sync

# Useful for slower connections or less frequent changes
```

### Development with HTTPS

Configure SSL on REMOTE-SERVER:

```bash
# SSH to REMOTE-SERVER
ssh remote-server

# Update .env
cd /opt/technitium-dns-companion
vi .env
# Add:
# HTTPS_ENABLED=true
# HTTPS_CERT_PATH=/app/certs/fullchain.pem
# HTTPS_KEY_PATH=/app/certs/privkey.pem

# Update docker-compose.dev-hotreload.yml
# Uncomment SSL volume mount

# Restart
exit
./scripts/remote-dev.sh restart
```

## Migration from Old Workflow

### Old Workflow (sync-to-remote-server.sh)

```bash
./scripts/sync-to-remote-server.sh --watch
# Synced to REMOTE-SERVER, then manually SSH'd and ran npm commands
```

### New Workflow (remote-dev.sh)

```bash
# Terminal 1: Start and watch
./scripts/remote-dev.sh start
./scripts/remote-dev.sh watch

# Terminal 2 (optional): View logs
./scripts/remote-dev.sh logs

# Browser: http://remote-server.example.com:5173
```

**Key Differences:**
- Docker runs on REMOTE-SERVER (more production-like)
- Hot-reload works automatically (no manual restarts)
- Both frontend and backend run together
- Access via proper URLs (not localhost tunnels)

## See Also

- [DOCKER.md](../DOCKER.md) - Full Docker documentation
- [DEVELOPMENT_WORKFLOW.md](./DEVELOPMENT_WORKFLOW.md) - Local development workflow
- [HTTPS_DEVELOPMENT.md](./HTTPS_DEVELOPMENT.md) - HTTPS setup for development
