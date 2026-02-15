// @ts-check
import eslint from "@eslint/js";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Ignore this config file (and other tooling/config files) so editors running ESLint
  // from the repo root don't try to type-check them via the backend project service.
  {
    ignores: [
      "eslint.config.mjs",

      // General config/tooling (not part of backend TS program)
      //
      // IMPORTANT: do NOT ignore all "**/*.config.*" here. When ESLint runs from the repo root,
      // that broad ignore would also ignore frontend configs like `apps/frontend/playwright.config.ts`,
      // which we want linted (non-typechecked) by the frontend ESLint config.
      "**/{eslint,prettier,stylelint}.config.{js,cjs,mjs,ts}",

      // Backend scripts/tools (if any)
      "scripts/**",
      "**/scripts/**",
    ],
  },

  // Typed linting ONLY for backend source code.
  // This avoids "multiple candidate TSConfigRootDirs" + project-service parsing errors
  // when an editor lints from repo root across multiple apps.
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      eslintPluginPrettierRecommended,
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: "commonjs",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
    },
  },
);
