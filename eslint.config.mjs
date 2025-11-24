import { defineConfig } from 'eslint/config';

export default defineConfig([
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/coverage/**'
        ],
    },
]);
