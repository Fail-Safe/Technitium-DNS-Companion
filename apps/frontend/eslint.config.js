import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import noFieldGroupRule from "./eslint-rules/no-field-group-in-grid-clean.js";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
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
