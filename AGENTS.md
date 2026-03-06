# AGENTS.md — Technitium DNS Companion

Guidance for agentic coding assistants (Claude Code, Copilot, Cursor, etc.) working in this repository.

---

## Project Overview

Technitium DNS Companion is a monorepo web application for managing and synchronising multiple Technitium DNS servers. It exposes a NestJS REST API (backend) consumed by a React + Vite SPA (frontend).

```
technitium-dns-companion/
├── apps/
│   ├── backend/    # NestJS (TypeScript) — port 3000
│   └── frontend/   # React 18 + Vite (TypeScript) — port 5173 in dev
├── docs/           # Architecture & feature documentation
└── configs/        # Sample configuration files
```

---

## Build, Lint & Test Commands

### Root (runs all workspaces)

```bash
npm install          # Install all workspace dependencies
npm run lint         # ESLint across both workspaces
npm run build        # Build both workspaces
npm run test         # Run all tests across both workspaces
```

### Backend (`apps/backend`)

```bash
npm run start:dev        # Dev server with hot-reload (localhost:3000)
npm run build            # Compile TypeScript via NestJS CLI
npm run lint             # ESLint + Prettier (auto-fixes)
npm run test             # Jest unit tests (offline; no real Technitium calls)
npm run test:watch       # Jest in watch mode
npm run test:cov         # Jest with coverage report
npm run test:e2e         # Jest E2E suite (test/jest-e2e.json)
npm run test:benchmark   # Opt-in benchmarks (requires real nodes)
```

**Run a single backend test file:**
```bash
# From apps/backend
npx jest src/technitium/technitium.service.spec.ts --detectOpenHandles
```

**Run a single test by name:**
```bash
npx jest --testNamePattern="serializes the required DHCP scope fields" --detectOpenHandles
```

> By default, Jest skips live Technitium API calls. Set `ALLOW_TECHNITIUM_HTTP_IN_TESTS=true`
> only when you intentionally want to hit real nodes.

### Frontend (`apps/frontend`)

```bash
npm run dev              # Vite dev server (localhost:5173)
npm run build            # TypeScript check + Vite production build
npm run typecheck        # tsc --noEmit only
npm run lint             # ESLint
npm run test             # Vitest unit tests (single run)
npm run test:ui          # Vitest with browser UI
npm run test:coverage    # Vitest with v8 coverage
npm run test:e2e         # Playwright E2E
npm run test:e2e:ui      # Playwright with interactive UI
npm run preview          # Preview production build
```

**Run a single frontend test file:**
```bash
# From apps/frontend
npx vitest run src/test/array-comparison.test.ts
```

**Run a single test by name:**
```bash
npx vitest run --reporter=verbose -t "sorts and normalises arrays"
```

---

## Git Hooks

```bash
git config core.hooksPath scripts/git-hooks
```

The `pre-push` hook runs `npm test` in both workspaces. Only bypass with genuine cause.

---

## Code Style Guidelines

### Language & Tooling

- **TypeScript** everywhere (strict mode). No `any` unless genuinely unavoidable; prefer unknown + narrowing.
- **Prettier** (via `eslint-plugin-prettier`) enforces formatting. Do not manually reformat — let the linter fix it.
- **ESLint** config: `apps/backend/eslint.config.mjs` and `apps/frontend/eslint.config.js`.
  - Typed linting (`recommendedTypeChecked`) is enabled for `src/**` in both workspaces.
  - Some `@typescript-eslint` rules are intentionally relaxed for gradual adoption — do not re-enable them without discussion.

### Imports

- Use named imports; avoid default imports from internal modules.
- Group imports: external packages first, then internal paths. Do not mix.
- Backend uses CommonJS module resolution (`sourceType: "commonjs"`); do not use `.js` extensions on relative imports.
- Frontend uses ESM (`"type": "module"`); use bare specifiers for packages.

### Naming Conventions

| Construct | Convention | Example |
|---|---|---|
| Files (backend) | kebab-case | `technitium.service.ts` |
| Files (frontend) | PascalCase for components, kebab-case for hooks/utils | `ClusterInfoBanner.tsx`, `usePrimaryNode.ts` |
| Classes / Interfaces | PascalCase | `TechnitiumService`, `TechnitiumNodeConfig` |
| Interface names | Prefixed with `Technitium` for domain types | `TechnitiumZoneSummary` |
| Variables / functions | camelCase | `buildDhcpScopeFormData` |
| React hooks | `use` prefix | `usePrimaryNode`, `useToast` |
| Constants | UPPER_SNAKE_CASE for injection tokens | `TECHNITIUM_NODES_TOKEN` |
| Enum-like string unions | PascalCase values | `"Primary" \| "Secondary" \| "Standalone"` |

### TypeScript Types

- Define shared domain types in dedicated `*.types.ts` files (e.g., `technitium.types.ts`, `advanced-blocking.types.ts`).
- Prefer `interface` over `type` for object shapes; use `type` for unions/intersections.
- Use `import type` for type-only imports.
- Do not use enums; prefer `string` literal union types instead.

### Backend Patterns (NestJS)

- All Technitium DNS API calls must go through `TechnitiumService`.
- Use `unwrapApiResponse()` to extract data from Technitium's `{ response, status }` envelope.
- Axios errors must be normalised to NestJS `HttpException` types (`UnauthorizedException`, `NotFoundException`, etc.).
- Use NestJS `Logger` (not `console.log`) for all log output.
- Node credentials primarily come from Technitium-backed user sessions; background tasks use `TECHNITIUM_BACKGROUND_TOKEN`.
- Inject dependencies via NestJS DI — do not instantiate services manually in production code.
- Controllers are thin; business logic lives in services.

### Frontend Patterns (React)

- Use `TechnitiumContext` for all API calls and node state — do not `fetch` directly in components.
- Use `ToastContext` / `useToast` for all user-facing notifications (errors, success).
- State management: React Context API only — no Redux or Zustand.
- Components live under `src/components/`; pages under `src/pages/`; hooks under `src/hooks/`.
- Custom hooks that accept dependency arrays must be listed in `additionalHooks` in the ESLint config so `react-hooks/exhaustive-deps` catches them.
- The local ESLint rule `no-field-group-in-grid` is enforced — do not nest `FieldGroup` inside grid containers.
- Mobile-first, responsive design is a non-negotiable. All new UI must work at < 768 px width.

### Error Handling

- Backend: catch Axios errors and rethrow as NestJS `HttpException` subclasses with descriptive messages.
- Frontend: display errors via `ToastContext`; never silently swallow errors.
- Do not log sensitive data (tokens, credentials) at any log level.

### Zone Comparison Logic

- Never compare zones of different types (Primary vs Secondary) — they are expected to differ.
- Filter internal built-in zones (`0.in-addr.arpa`, etc.) from all comparison results.
- Sort and normalise arrays before comparing (order must not matter).
- Secondary Forwarder zones intentionally lack Zone Transfer/Notify options — do not treat absence as a diff.

---

## Security

- **Never** commit real admin tokens, passwords, or sensitive environment variables.
- **Never** put private admin tokens in public repositories or log output.
- **Never** commit docker-compose.dev.yml, docker-compose.local-build.yml, or docker-compose.prod.test.yml.
- Use `.env.example` as the reference for environment variable shapes; copy to `.env` locally.

---

## Documentation & Release

- All feature/architecture docs live under `docs/`. Read relevant docs before implementing a feature.
- Key references:
  - `docs/architecture.md` — system design
  - `docs/zone-comparison/ZONE_TYPE_MATCHING_LOGIC.md` — zone comparison rules
  - `docs/ui/UI_QUICK_REFERENCE.md` — UI component guide
  - `docs/performance/BACKEND_PERFORMANCE_QUICK_START.md` — caching/throttling patterns
- Before publishing: update `CHANGELOG.md` (Keep a Changelog format) and bump the version in the root `package.json`.
- Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
