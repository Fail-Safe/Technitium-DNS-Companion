import { spawn } from "node:child_process";
import process from "node:process";

const mockPort = process.env.E2E_MOCK_BACKEND_PORT ?? "3000";

function spawnProcess(command, args, env) {
  const child = spawn(command, args, { stdio: "inherit", env, shell: false });

  child.on("exit", (code, signal) => {
    if (signal) return;
    // If either child exits unexpectedly, fail fast so Playwright doesn't hang.
    if (typeof code === "number" && code !== 0) {
      process.exitCode = code;
    }
  });

  return child;
}

const baseEnv = { ...process.env };

// Ensure the SPA uses the Vite proxy (`/api`) and points that proxy at our mock backend.
// - Empty `VITE_API_URL` ensures getApiBaseUrl() falls back to "/api".
// - `VITE_PROXY_TARGET` directs Vite's `/api` proxy to the mock backend.
const viteEnv = {
  ...baseEnv,
  VITE_API_URL: "",
  VITE_PROXY_TARGET: `http://localhost:${mockPort}`,
};

const backendEnv = { ...baseEnv, E2E_MOCK_BACKEND_PORT: mockPort };

const backend = spawnProcess(
  process.execPath,
  ["e2e/mock-backend/server.mjs"],
  backendEnv,
);
const vite = spawnProcess("npm", ["run", "dev"], viteEnv);

const shutdown = () => {
  if (!backend.killed) backend.kill("SIGTERM");
  if (!vite.killed) vite.kill("SIGTERM");
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// If either process exits, stop the other.
backend.on("exit", shutdown);
vite.on("exit", shutdown);
