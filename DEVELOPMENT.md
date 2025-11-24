# Development Guide

This guide covers setting up a development environment for Technitium DNS Companion.

## Documentation

- **📘 [DOCKER.md](./DOCKER.md)** - Docker deployment guide
- **💻 [DEVELOPMENT.md](./DEVELOPMENT.md)** - Development setup and guidelines
- **🏗️ [docs/architecture.md](./docs/architecture.md)** - System design and architecture
- **🔍 [docs/zone-comparison/](./docs/zone-comparison/)** - Zone comparison logic documentation
- **🎨 [docs/ui/](./docs/ui/)** - UI component guidelines
- **📝 [docs/README.md](./docs/README.md)** - Complete documentation index

## Development Options

You have **three options** for development:

### Option 1: Docker with Hot-Reload (Recommended) 🔥

Best for rapid development with instant feedback:

```bash
# Start development environment
./scripts/dev-docker.sh start

# Access:
# - Frontend (HMR): http://localhost:5173
# - Backend API:    http://localhost:3000/api
```

**Benefits:**
- ✅ Changes reflected instantly (no rebuild)
- ✅ Consistent environment across machines
- ✅ No local Node.js installation needed
- ✅ Both frontend and backend hot-reload

See [DOCKER.md](./DOCKER.md#development-mode-hot-reload-) for full details.

### Option 1b: Remote Development on EQ12

Run Docker on EQ12 while editing locally:

```bash
# Terminal 1: Start remote container on EQ12
./scripts/remote-dev.sh start

# Terminal 2: Watch and sync local changes
./scripts/remote-dev.sh watch

# Edit files locally, they sync to EQ12 and hot-reload
# Access at http://eq12.home-dns.com:5173
```

**Benefits:**
- ✅ Production-like environment (EQ12 Linux)
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
npm run format      # runs Prettier in each workspace
npm run format:repo # formats the entire repo with Prettier
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

# Frontend tests
cd apps/frontend
npm run test          # Vitest unit tests
npm run test:e2e      # Playwright E2E tests
```

## Code Style

This project uses ESLint and Prettier to maintain code quality:

```bash
npm run lint        # Check for linting issues
npm run format      # Format code with Prettier
npm run format:repo # Format entire repository
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
