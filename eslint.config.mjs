import { defineConfig } from "eslint/config";

import backendConfig from "./apps/backend/eslint.config.mjs";
import frontendConfig from "./apps/frontend/eslint.config.js";

export default defineConfig([
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",

      // Ignore tooling/config files at the repo root and in packages.
      // These tend to be outside TS projects and cause editor noise when linted from repo root.
      //
      // IMPORTANT:
      // We intentionally AVOID a broad ignore like "**/*.config.*" because it would also ignore
      // `apps/frontend/playwright.config.ts`, which we want linted (non-typechecked) by the
      // frontend ESLint config.
      "**/{eslint,prettier,stylelint}.config.{js,cjs,mjs,ts}",
      "**/vite.config.{js,ts,mjs,cjs}",
      "**/postcss.config.{js,cjs,mjs,ts}",
      "**/tailwind.config.{js,cjs,mjs,ts}",
      "**/app.config.{js,cjs,mjs,ts}",
      "**/scripts/**",

      // Ignore tests/benchmarks for repo-root linting. Each app can opt-in separately.
      "**/e2e/**",
      "**/src/test/**",
      "**/*.test.{ts,tsx,js,jsx}",
      "**/*.spec.{ts,tsx,js,jsx}",
      "**/*.bench.{ts,tsx,js,jsx}",

      // Ignore internal ESLint rule implementation files from repo-root linting.
      // These are tooling code and are typically outside the TS "project service" scope.
      "**/eslint-rules/**",
    ],
  },

  // Delegate to per-app configs so editors running ESLint from the repo root
  // don't accidentally apply the wrong TypeScript project / tsconfigRootDir.
  ...backendConfig,
  ...frontendConfig,
]);
