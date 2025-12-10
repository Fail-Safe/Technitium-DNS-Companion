# Technitium DNS Companion - Docker Guide

Production is the default choice for most users. Development containers are only needed when you want hot-reload while contributing.

## Production (recommended)

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

- Place certs in `certs/`:
  ```
  certs/
  ├── fullchain.pem
  └── privkey.pem
  ```
- In `.env`, set:
  ```bash
  HTTPS_ENABLED=true
  HTTPS_PORT=3443
  HTTPS_CERT_PATH=/app/certs/fullchain.pem
  HTTPS_KEY_PATH=/app/certs/privkey.pem
  # HTTPS_CA_PATH=/app/certs/chain.pem  # optional
  ```
- In `docker-compose.yml`, uncomment the certs volume:
  ```yaml
  volumes:
    - ./certs:/app/certs:ro
  ```
- Restart: `docker compose down && docker compose up -d --build`

4. **Operations**

- Logs: `docker compose logs -f`
- Restart: `docker compose restart`
- Upgrade to latest code: `git pull && docker compose up -d --build`

## Development (hot-reload, contributors)

Uses `docker-compose.dev.yml`, host networking, and volume mounts for live code edits. This is heavier and meant for contributors, not production.

1. **Prepare environment**

- Copy `.env.example` to `.env` and set your node URLs/tokens.
- Ensure `CORS_ORIGIN` includes your dev frontend (defaults to `http://localhost:5173,https://localhost:5174`).
- Set HTTPS vars if you want HTTPS locally.

2. **Run dev stack**

```bash
# From repository root
docker compose -f docker-compose.dev.yml up --build
```

- Backend (watch mode): https://localhost:3443 (host network)
- Frontend (Vite dev server): https://localhost:5174

3. **Notes**

- Source code is bind-mounted read-only; changes take effect immediately via HMR (frontend) and NestJS watch (backend).
- `node_modules` live in named volumes and are auto-populated by `docker-entrypoint-dev.sh`.
- If you change `package.json`, rebuild: `docker compose -f docker-compose.dev.yml up --build`.
- HTTPS in dev: mount certs to `/app/certs` (adjust the example path in `docker-compose.dev.yml`) and set `HTTPS_ENABLED=true` and cert paths.

## Troubleshooting

- Container will not start: `docker compose logs` then `docker compose config` to validate env vars.
- Cannot reach nodes: exec into the container and curl the node URLs with your token to verify connectivity.
- Frontend not updating (dev): rebuild or clear named volumes if dependencies changed.
