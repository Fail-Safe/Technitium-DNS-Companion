import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import noFieldGroupRule from "./eslint-rules/no-field-group-in-grid-clean.js";

export default defineConfig([
  globalIgnores(["dist"]),

  /**
   * Typed linting (type-aware rules) for the actual app source only.
   *
   * Why:
   * - Type-aware linting requires files to be included in the TSConfig project.
   * - In this repo, `tsconfig.json` is a "references" root and has no `include`,
   *   so ESLint must point at the *actual* app TSConfig (`tsconfig.app.json`).
   * - Restricting typed linting to `src/**` avoids breaking on configs/e2e/scripts.
   *
   * IMPORTANT:
   * - `recommendedTypeChecked` is intentionally more strict than what the repo
   *   historically enforced. To avoid failing builds immediately, we start by
   *   disabling the strictest type-aware rules and can re-enable them gradually.
   */
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      // These are intentionally excluded from `tsconfig.app.json`, so they must not be
      // type-checked by ESLint unless we create a dedicated test TSConfig later.
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "src/test/**",
      "src/**/*.bench.ts",
    ],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      reactHooks.configs["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        // Avoid monorepo ambiguity with multiple tsconfig roots.
        tsconfigRootDir: import.meta.dirname,
        // IMPORTANT: this must be the TSConfig that actually includes `src/**`.
        project: ["./tsconfig.app.json"],
      },
    },
    plugins: {
      "local-rules": { rules: { "no-field-group-in-grid": noFieldGroupRule } },
    },
    rules: {
      "local-rules/no-field-group-in-grid": "error",
      "react-hooks/exhaustive-deps": [
        "error",
        {
          // Catch custom hooks that accept dependency arrays
          additionalHooks:
            "(useAsyncEffect|useDebouncedEffect|usePullToRefresh)",
        },
      ],

      // Gradual-adoption: keep typed linting enabled, but don't hard-fail the repo
      // on day 1. Re-enable these one-by-one as you clean up the codebase.
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",

      // These are valuable but often noisy initially; enable later if desired.
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
    },
  },

  /**
   * Non-typed linting for all other TS/TSX files (configs, e2e, scripts, etc.).
   * This avoids "file must be included in the TSConfig project" parser errors.
   */
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["src/**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        // Anchor TS parsing for non-typechecked files to the frontend directory.
        // This avoids monorepo ambiguity errors like:
        // "No tsconfigRootDir was set, and multiple candidate TSConfigRootDirs are present".
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "local-rules": { rules: { "no-field-group-in-grid": noFieldGroupRule } },
    },
    rules: {
      "local-rules/no-field-group-in-grid": "error",
      "react-hooks/exhaustive-deps": [
        "error",
        {
          // Catch custom hooks that accept dependency arrays
          additionalHooks:
            "(useAsyncEffect|useDebouncedEffect|usePullToRefresh)",
        },
      ],
    },
  },
]);
