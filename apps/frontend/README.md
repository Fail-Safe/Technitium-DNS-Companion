# Technitium-DNS-Companion Frontend

React 18 + TypeScript + Vite SPA for managing multiple Technitium DNS servers.

## Development

```bash
# Install dependencies
npm install

# Start dev server (with backend proxy)
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint

# Format code
npm run format
```

## Testing

### Unit Tests (Vitest)
```bash
# Run all unit tests
npm test -- --run

# Watch mode (default)
npm test

# Interactive UI
npm test:ui

# Coverage report
npm test:coverage
```

**Test Coverage**: 397 unit tests covering:
- API integration (37 tests)
- React Hook lifecycle (14 tests) 🆕
- Form validation (69 tests)
- Toast notifications (45 tests)
- Component rendering (32 tests)
- E2E integration mocks (35 tests)
- Mobile responsiveness (34 tests)
- Advanced Blocking (17 tests)
- DHCP cloning (28 tests)
- Query log aggregation (30 tests)
- Log filtering (16 tests)
- Log selection (18 tests)
- Performance optimization (22 tests)

### E2E Tests (Playwright)
```bash
# Run E2E tests (requires running backend + frontend)
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui
```

**Note**: E2E tests require both backend and frontend to be running.

## Building

```bash
# Production build
npm run build

# Preview production build
npm run preview
```

## Architecture

- **State Management**: React Context API (`TechnitiumContext`)
- **Routing**: React Router v6
- **Styling**: TailwindCSS with dark mode support
- **API Communication**: REST (proxied to backend in dev)

## Key Features

- 📱 Mobile-first responsive design
- 🌙 Dark mode support
- 🔄 Real-time node synchronization
- 📊 Combined multi-node query logs
- 🛡️ Advanced Blocking management
- 🌐 DNS zone comparison
- 🖥️ DHCP scope management

---

## Original Vite Template Info

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
