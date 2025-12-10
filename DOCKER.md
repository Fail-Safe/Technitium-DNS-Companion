# Technitium DNS Companion - Getting Started Guide

Getting started is quick and easy with Docker (or an equivalent container runtime). Just a few environment variables are needed to connect to your Technitium DNS nodes.

## Getting Started

Runs the optimized single container that serves both the API and built frontend.

1. **Prepare environment**

- Copy `.env.example` to `.env` and set your nodes.
- Minimum variables:
  - `TECHNITIUM_NODES=node1,node2`
  - Either `TECHNITIUM_CLUSTER_TOKEN` (recommended for clustered v14+) **or** per-node tokens `TECHNITIUM_<NODE>_TOKEN`.
  - `TECHNITIUM_<NODE>_BASE_URL` for each node.
- Optional: set `TZ`, `CORS_ORIGINS`, and HTTPS variables.

2. **Start the stack**

```bash
# From repository root
docker compose up -d --build
```

- HTTP: http://localhost:3000
- HTTPS (if enabled): https://localhost:3443

3. **Enable HTTPS (optional but recommended)**

Place certs in `certs/`:

```
certs/
├── fullchain.pem
└── privkey.pem
```

In `.env`, set:

```bash
HTTPS_ENABLED=true
HTTPS_PORT=3443
HTTPS_CERT_PATH=/app/certs/fullchain.pem
HTTPS_KEY_PATH=/app/certs/privkey.pem
# HTTPS_CA_PATH=/app/certs/chain.pem  # optional
```

In `docker-compose.yml`, uncomment the certs volume:

```yaml
volumes:
  - ./certs:/app/certs:ro
```

Restart:

```bash
docker compose down && docker compose up -d --build
```

4. **Operations**

- Logs: `docker compose logs -f`
- Restart: `docker compose restart`
- Upgrade to latest code: `git pull && docker compose up -d --build`

## Troubleshooting

- Container will not start: `docker compose logs` then `docker compose config` to validate env vars.
- Cannot connect to Technitium DNS nodes: Check URLs and tokens in `.env`.

Need contributor/dev container instructions? See `DEVELOPMENT.md` or `docker-compose.dev.yml`.
