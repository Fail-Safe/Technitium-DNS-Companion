import { describe, expect, it } from "vitest";
import { shouldBypassApiRuntimeCache } from "../../pwa-cache-policy";

describe("PWA API cache policy", () => {
  it.each([
    "/api/nodes/logs/combined",
    "/api/nodes/logs/combined/stored",
    "/api/nodes/node-a/logs",
    "/api/nodes/node-a/logs/stored",
    "/api/domain-lists/node-a/all-domains",
    "/api/domain-lists/node-a/check",
  ])("bypasses Workbox for abortable endpoint %s", (pathname) => {
    expect(shouldBypassApiRuntimeCache(pathname)).toBe(true);
  });

  it.each([
    "/api/nodes/logs/storage",
    "/api/nodes",
    "/api/nodes/node-a/apps",
    "/api/health",
  ])("retains normal runtime-cache routing for %s", (pathname) => {
    expect(shouldBypassApiRuntimeCache(pathname)).toBe(false);
  });
});
