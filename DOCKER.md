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
  - Shows the exact `docker run` command and can run it for you

- Edit `technitium.env` with your Technitium node URLs/tokens when prompted, then press Enter to launch.

### Option B: Manual `docker run` (no clone required)

Runs the single container that serves both the API and built frontend. Use this if you prefer to type the command yourself.

1. Prepare environment:

- Download `.env.example` (or copy it from a clone) and save as `technitium.env`.
- Minimum variables:
  - `TECHNITIUM_NODES=node1,node2`
  - Either `TECHNITIUM_CLUSTER_TOKEN` (recommended for clustered v14+) **or** per-node tokens `TECHNITIUM_<NODE>_TOKEN`.
  - `TECHNITIUM_<NODE>_BASE_URL` for each node.
- Optional: set `TZ`, `CORS_ORIGINS`, and HTTPS variables.

2. Run the container:

```bash
docker run --rm -p 3000:3000 -p 3443:3443 \
  --env-file technitium.env \
  -v technitium-dns-companion-data:/data \
  ghcr.io/fail-safe/technitium-dns-companion:latest
```

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
- Cannot connect to Technitium DNS nodes: Check URLs and tokens in `.env`.

Need contributor/dev container instructions? See `DEVELOPMENT.md` or `docker-compose.dev.yml`.
