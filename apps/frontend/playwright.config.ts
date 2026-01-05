import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E Test Configuration
 * Tests real user workflows in actual browsers
 */

export default defineConfig({
  testDir: "./e2e",
  // Legacy specs currently rely on outdated selectors and missing `data-testid`s.
  // Keep them in-repo for future modernization, but exclude from the default E2E run.
  testIgnore: [
    "**/configuration.spec.ts",
    "**/dhcp.spec.ts",
    "**/query-logs.spec.ts",
    "**/zones.spec.ts",
    "**/mobile.spec.ts",
  ],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: { baseURL: "http://localhost:5173", trace: "on-first-retry" },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },

    { name: "firefox", use: { ...devices["Desktop Firefox"] } },

    { name: "webkit", use: { ...devices["Desktop Safari"] } },

    /* Test against mobile viewports. */
    { name: "Mobile Chrome", use: { ...devices["Pixel 5"] } },
    { name: "Mobile Safari", use: { ...devices["iPhone 12"] } },
  ],

  webServer: {
    // Starts a deterministic local mock backend (port 3000) and Vite.
    // This avoids relying on a real Technitium instance or remote backend.
    command: "node e2e/mock-backend/start-e2e.mjs",
    url: "http://localhost:5173",
    // Deterministic by default: always start the mock backend + Vite.
    // Set `E2E_USE_EXISTING_SERVER=true` to attach Playwright to an already running app.
    reuseExistingServer: process.env.E2E_USE_EXISTING_SERVER === "true",
  },
});
