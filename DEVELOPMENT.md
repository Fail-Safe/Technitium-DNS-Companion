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

## Local Development

Run directly on your machine:

### Prerequisites

- Node.js 22+ (or use nvm with `.nvmrc`)
- npm or pnpm

### Installation

```bash
# Install dependencies for all workspaces
npm install

# Common scripts
npm run lint        # runs lint in each workspace
```

### Backend Development

```bash
cd apps/backend
npm install
npm run start:dev  # Runs on http://localhost:3000
```

### Frontend Development

```bash
cd apps/frontend
npm install
npm run dev  # Runs on http://localhost:5173
```

## Production Docker Build

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

- Use frontend HMR and the backend watch mode for a fast local iteration cycle
- Backend logs show API requests and Technitium DNS API interactions
- Frontend HMR updates most changes without full page reload
- Check `docs/` for implementation patterns and design decisions
- Install the provided git hooks (below) so pushes only happen after tests succeed

## Git Hooks

Repository-managed git hooks live under `.githooks`. The root `npm install` runs the `prepare` script, which configures this path automatically. To configure it manually:

```bash
git config core.hooksPath .githooks
```

The pre-commit hook prevents accidental commits directly to `main`, and the pre-push hook executes `npm test` in both `apps/backend` and `apps/frontend`. If either test suite fails, the push is aborted. Only bypass a hook with `--no-verify` when genuinely necessary.
