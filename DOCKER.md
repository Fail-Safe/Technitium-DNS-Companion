# Technitium DNS Companion - Getting Started Guide

Getting started is quick and easy with Docker (or an equivalent container runtime). Just a few environment variables are needed to connect to your Technitium DNS nodes.

## Getting Started (2-minute path)

### Option A: One-command quickstart (recommended)

You don't need to clone the repo. Download the script and run it from the host where you want to run the container:

- macOS/Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Fail-Safe/Technitium-DNS-Companion/main/scripts/docker-quickstart.sh -o docker-quickstart.sh
chmod +x docker-quickstart.sh
./docker-quickstart.sh
```

- Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/Fail-Safe/Technitium-DNS-Companion/main/scripts/docker-quickstart.ps1 -OutFile docker-quickstart.ps1
powershell -ExecutionPolicy Bypass -File .\docker-quickstart.ps1
```

- What the script does:
  - Verifies Docker is running
  - Downloads `.env.example` into `technitium.env` if missing
  - Pulls the selected image first (so `:latest` stays current)
  - Shows the exact `docker run` command and can run it for you
  - Prompts to confirm HTTP/HTTPS ports before running (must be different; it will re-prompt if you choose the same port)

- If `technitium.env` didn’t exist, the script will create it and exit so you can edit it.
- After editing `technitium.env`, rerun the script and press Enter to launch (any other key cancels).

### Option B: Manual `docker run` (no clone required)

Runs the single container that serves both the API and built frontend. Use this if you prefer to type the command yourself.

1. Prepare environment:

- Download `.env.example` (or copy it from a clone) and save as `technitium.env`.
- Minimum variables:
  - `TECHNITIUM_NODES=node1,node2`
  - `TECHNITIUM_<NODE>_BASE_URL` for each node.
  - Required for interactive UI access (v1.4+): Technitium login/RBAC (session auth).
  - Recommended for background features in session-auth mode: `TECHNITIUM_BACKGROUND_TOKEN` (least-privilege, read-only).
  - Legacy only (Technitium DNS < v14 / migration): env-token mode using `TECHNITIUM_<NODE>_TOKEN`.
- Optional: set `TZ`, `CORS_ORIGINS`, and HTTPS variables.

2. Run the container:

```bash
docker run --rm -p 3000:3000 -p 3443:3443 \
  --env-file technitium.env \
  -v technitium-dns-companion-data:/data \
  ghcr.io/fail-safe/technitium-dns-companion:latest
```

Notes on persistence (`/data` volume):

- `-v technitium-dns-companion-data:/data` is recommended. It is used for caches and optional on-disk features.
- If you enable the optional SQLite rolling query-log store, set `QUERY_LOG_SQLITE_PATH` to a path under `/data` so stored logs survive container restarts.
- DNS Filtering History snapshots can also be stored under `/data` (see `.env.example` / `DNS_FILTERING_SNAPSHOT_DIR`).

Optional: Enable SQLite rolling query logs storage (accuracy for “Last 24h” presets)

- In `technitium.env`:

```bash
QUERY_LOG_SQLITE_ENABLED=true
QUERY_LOG_SQLITE_PATH=/data/query-logs.sqlite
QUERY_LOG_SQLITE_RETENTION_HOURS=24
QUERY_LOG_SQLITE_POLL_INTERVAL_MS=10000
QUERY_LOG_SQLITE_OVERLAP_SECONDS=60
QUERY_LOG_SQLITE_MAX_ENTRIES_PER_POLL=20000
```

- With session auth (v1.4+: always enabled for interactive UI), ingestion runs as a background task and requires `TECHNITIUM_BACKGROUND_TOKEN` (least-privilege token that can read query logs). Without it, the DB may exist but will not stay up to date.

- HTTP: http://localhost:3000
- HTTPS (if enabled): https://localhost:3443

3. Enable HTTPS (optional but recommended):

- Place certs locally:

```
certs/
├── fullchain.pem
└── privkey.pem
```

- In `technitium.env`, set:

```bash
HTTPS_ENABLED=true
HTTPS_PORT=3443
HTTPS_CERT_PATH=/app/certs/fullchain.pem
HTTPS_KEY_PATH=/app/certs/privkey.pem
# HTTPS_CA_PATH=/app/certs/chain.pem  # (optional) Specify if you have a separate CA file
```

- Mount certs when running:

```bash
docker run --rm -p 3000:3000 -p 3443:3443 \
  --env-file technitium.env \
  -v technitium-dns-companion-data:/data \
  -v $(pwd)/certs:/app/certs:ro \
  ghcr.io/fail-safe/technitium-dns-companion:latest
```

- For Windows PowerShell, use `${PWD}\certs` for the host path.

4. Operations:

- Logs: `docker logs -f <container-id>` (if run without `--rm`, add `--name tdc` then `docker logs -f tdc`)
- Restart (named container): `docker restart tdc`
- Upgrade image: `docker pull ghcr.io/fail-safe/technitium-dns-companion:latest`

### Option C: `docker compose` (from a repo clone)

Use this if you’ve cloned the repo and prefer compose for repeatability or dev overrides.

1. Copy `.env.example` to `.env` and set your variables.

2. Start:

```bash
docker compose up -d --build
```

3. HTTPS: place certs in `certs/` and set the HTTPS vars in `.env`, then ensure the certs volume is mounted in `docker-compose.yml`.

4. Operations:

- Logs: `docker compose logs -f`
- Restart: `docker compose restart`
- Upgrade: `git pull && docker compose up -d --build`

## Troubleshooting

- Container will not start: `docker compose logs` then `docker compose config` to validate env vars.
- Port bind error ("port is already allocated"): pick different host ports (e.g., `-p 1234:3000 -p 1235:3443`) or stop the other container/service using that port.
- Cannot connect to Technitium DNS nodes: Check URLs and tokens in `.env`.

### Health checks

The container health check probes `http://127.0.0.1:<PORT>/api/health` or
`https://127.0.0.1:<HTTPS_PORT>/api/health` from inside the container.

- If `HTTPS_ENABLED=true`, the HTTPS probe is attempted first, then HTTP as fallback.
- If `HTTPS_ENABLED=false`, the HTTP probe is attempted first, then HTTPS as fallback.
- Compose uses a Node-based probe (no `wget/curl` dependency required).

Quick verification:

```bash
docker compose ps
docker inspect --format='{{json .State.Health}}' technitium-dns-companion | jq
```

### Post-upgrade permissions check (v1.4+)

Recent images run as a non-root user (`node`, uid/gid `1000`). If older bind mounts or volumes contain root-owned files, startup or background tasks may fail with permission errors such as:

- `EACCES: permission denied, open /app/certs/...` (HTTPS certs not readable)
- `attempt to write a readonly database` (SQLite query logs DB not writable)

Quick check inside the container:

```bash
docker exec -it <container> sh -lc 'id; ls -ld /app/certs /app/config; ls -l /app/certs 2>/dev/null || true; ls -l /app/config 2>/dev/null || true'
```

Recommended permissions:

- Certificate directories should be traversable/readable (commonly `755`)
- Certificate/key files should be readable by the container user (commonly `644`)
- SQLite DB path and related files (`.sqlite`, `-wal`, `-shm`) should be writable by uid `1000`

Example remediation (adjust to your host paths/volume contents):

```bash
# Certs (host or volume content)
chmod 755 /path/to/certs /path/to/certs/certs
chmod 644 /path/to/certs/certs/*

# App state volume (from container as root, then restart)
docker exec -u 0 <container> sh -lc 'chown -R node:node /app/config'
docker restart <container>
```

Temporary workaround only: run the container as root while fixing file ownership, then switch back to non-root.

## Docker Secrets / File-based Secrets

For production deployments, you can use Docker secrets or file-based secrets instead of
passing sensitive values directly as environment variables. The application supports the
common `_FILE` suffix pattern.

### Supported Variables

| Environment Variable                  | File Variant                           |
|---------------------------------------|----------------------------------------|
| `TECHNITIUM_BACKGROUND_TOKEN`         | `TECHNITIUM_BACKGROUND_TOKEN_FILE`     |
| `TECHNITIUM_<NODE>_TOKEN`             | `TECHNITIUM_<NODE>_TOKEN_FILE`         |

When the `_FILE` variant is set, the application reads the secret from that file path.
The `_FILE` variant takes precedence if both are set.

### Docker Swarm Example

1. Create the secrets:

```bash
echo "your-background-token" | docker secret create technitium_background_token -
```

2. Reference in your stack file:

```yaml
version: "3.8"

services:
  technitium-dns-companion:
    image: ghcr.io/fail-safe/technitium-dns-companion:latest
    environment:
      TECHNITIUM_NODES: "node1,node2"
      TECHNITIUM_NODE1_BASE_URL: "http://dns1.example.com:5380"
      TECHNITIUM_NODE2_BASE_URL: "http://dns2.example.com:5380"
      # Use _FILE variants for secrets
      TECHNITIUM_BACKGROUND_TOKEN_FILE: /run/secrets/technitium_background_token
    secrets:
      - technitium_background_token
    ports:
      - "3000:3000"
    volumes:
      - companion-data:/data

secrets:
  technitium_background_token:
    external: true

volumes:
  companion-data:
```

### Kubernetes Example

1. Create the secret:

```bash
kubectl create secret generic technitium-tokens \
  --from-literal=background-token='your-background-token'
```

2. Mount in your deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: technitium-dns-companion
spec:
  template:
    spec:
      containers:
        - name: companion
          image: ghcr.io/fail-safe/technitium-dns-companion:latest
          env:
            - name: TECHNITIUM_NODES
              value: "node1,node2"
            - name: TECHNITIUM_BACKGROUND_TOKEN_FILE
              value: /secrets/background-token
          volumeMounts:
            - name: secrets
              mountPath: /secrets
              readOnly: true
      volumes:
        - name: secrets
          secret:
            secretName: technitium-tokens
```

### Per-Node Tokens

For legacy deployments with per-node tokens:

```bash
# Create secrets for each node
echo "node1-token" | docker secret create technitium_node1_token -
echo "node2-token" | docker secret create technitium_node2_token -
```

```yaml
environment:
  TECHNITIUM_NODE1_TOKEN_FILE: /run/secrets/technitium_node1_token
  TECHNITIUM_NODE2_TOKEN_FILE: /run/secrets/technitium_node2_token
secrets:
  - technitium_node1_token
  - technitium_node2_token
```

Need contributor/dev container instructions? See `DEVELOPMENT.md` or `docker-compose.dev.yml`.
