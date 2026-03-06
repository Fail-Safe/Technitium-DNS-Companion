# Development Guide

This guide covers setting up a development environment for Technitium DNS Companion.

## Documentation

- **📘 [DOCKER.md](./DOCKER.md)** - Docker deployment guide
- **💻 [DEVELOPMENT.md](./DEVELOPMENT.md)** - Development setup and guidelines
- **🏷️ [docs/RELEASING.md](./docs/RELEASING.md)** - Release process and sanity checklist
- **🏗️ [docs/architecture.md](./docs/architecture.md)** - System design and architecture
- **🔍 [docs/zone-comparison/](./docs/zone-comparison/)** - Zone comparison logic documentation
- **🎨 [docs/ui/](./docs/ui/)** - UI component guidelines
- **📝 [docs/README.md](./docs/README.md)** - Complete documentation index

## Development Options

You have **three options** for development:

### Option 1: Remote Development (Docker with Hot-Reload) 🔥

Run Docker on a remote server while editing locally:

```bash
# One-time setup
cp ./scripts/remote-dev.sh.example ./scripts/remote-dev.sh
chmod +x ./scripts/remote-dev.sh

# Edit config defaults in scripts/remote-dev.sh (or set env vars):
#   REMOTE_HOST, REMOTE_USER, REMOTE_PATH, REMOTE_DOMAIN
```

```bash
# Terminal 1: Start remote container
./scripts/remote-dev.sh start

# Terminal 2: Watch and sync local changes
./scripts/remote-dev.sh watch

# Edit files locally, they sync to remote and hot-reload
# Access at http://<your-server>:5173
```

Useful commands:

```bash
./scripts/remote-dev.sh recreate   # Reload .env / compose-time env vars
./scripts/remote-dev.sh rebuild    # Full rebuild with fresh node_modules volumes
./scripts/remote-dev.sh prodtest   # Run production-mode container on remote host
```

**Benefits:**

- ✅ Production-like environment (Linux server)
- ✅ Direct access to Technitium DNS nodes (same network)
- ✅ Edit locally, run remotely
- ✅ Hot-reload works like local development

See [docs/REMOTE_DEVELOPMENT.md](./docs/REMOTE_DEVELOPMENT.md) for full guide.

### Option 2: Local Development (Traditional)

Run directly on your machine:

#### Prerequisites

- Node.js 22+ (or use nvm with `.nvmrc`)
- npm or pnpm

#### Installation

```bash
# Install dependencies for all workspaces
npm install

# Common scripts
npm run lint        # runs lint in each workspace
```

#### Backend Development

```bash
cd apps/backend
npm install
npm run start:dev  # Runs on http://localhost:3000
```

#### Frontend Development

```bash
cd apps/frontend
npm install
npm run dev  # Runs on http://localhost:5173
```

### Option 3: Production Docker Build

Test production builds locally:

```bash
docker compose build
docker compose up -d
# Access at http://localhost:3000
```

## Project Structure

- `apps/backend` – NestJS service that talks to the Technitium DNS API, performs sync operations, and serves APIs for the UI.
- `apps/frontend` – React (Vite) single page app for the management dashboard.
- `docs/` – Architecture notes, feature documentation, and implementation guides.
- `DOCKER.md` – Complete Docker deployment guide.
- `.env.example` – Comprehensive environment variable reference.

## Testing

```bash
# Backend tests
cd apps/backend
npm run test          # Unit tests
npm run test:e2e      # E2E tests
npm run test:cov      # Coverage report
npm run test:benchmark # Opt-in query log performance benchmarks (real Technitium nodes required)

# Frontend tests
cd apps/frontend
npm run test          # Vitest unit tests
npm run test:e2e      # Playwright E2E tests
```

Backend Jest/E2E runs automatically disable live Technitium DNS calls to keep tests offline. Set `ALLOW_TECHNITIUM_HTTP_IN_TESTS=true` before running a suite if you intentionally want to exercise real nodes (the `npm run test:benchmark` script sets this automatically).

## Code Style

This project uses ESLint and Prettier to maintain code quality:

```bash
npm run lint        # Check for linting issues
```

## Architecture Documentation

For detailed architecture and implementation details, see:

- **🏗️ [docs/architecture.md](./docs/architecture.md)** - System design and architecture
- **🔍 [docs/zone-comparison/](./docs/zone-comparison/)** - Zone comparison logic documentation
- **🎨 [docs/ui/](./docs/ui/)** - UI component guidelines
- **📝 [docs/README.md](./docs/README.md)** - Complete documentation index

## Contributing

When contributing, please:

1. Check the [docs/](./docs/) folder for architecture and implementation details
2. Follow the existing code style (enforced by ESLint and Prettier)
3. Add tests for new features
4. Update documentation as needed
5. Ensure all tests pass before submitting a PR

## Development Tips

- Use the Docker hot-reload setup for the fastest iteration cycle
- Backend logs show API requests and Technitium DNS API interactions
- Frontend HMR updates most changes without full page reload
- Check `docs/` for implementation patterns and design decisions
- Install the provided git hooks (below) so pushes only happen after tests succeed

### Recover from dev `node_modules` volume issues

If your dev container gets stuck restarting with npm `ENOTEMPTY` errors, run:

```bash
./scripts/reset-dev-node-modules.sh
```

This helper stops the dev stack, removes the three `node_modules` Docker volumes,
rebuilds the dev image, and recreates the dev container.

Optional flags/env:

- `--yes` skips the confirmation prompt.
- `FORCE_NO_CACHE=true ./scripts/reset-dev-node-modules.sh` forces a no-cache rebuild.

## Git Hooks

Repository-managed git hooks live under `scripts/git-hooks`. Point Git at this directory once per clone so the `pre-push` script runs automatically:

```bash
git config core.hooksPath scripts/git-hooks
```

The hook executes `npm test` in both `apps/backend` and `apps/frontend`. If either suite fails, the push is aborted so regressions never leave your machine. Only bypass the hook (e.g., `HUSKY=0 git push`) when absolutely necessary.
