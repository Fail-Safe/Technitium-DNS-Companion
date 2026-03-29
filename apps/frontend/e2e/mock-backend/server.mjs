import http from "node:http";
import { URL } from "node:url";

const port = Number.parseInt(
  process.env.E2E_MOCK_BACKEND_PORT ?? process.env.PORT ?? "3000",
  10,
);

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function notFound(res, path) {
  json(res, 404, { message: `Mock backend: not found (${path})` });
}

function nowIso() {
  return new Date().toISOString();
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

// In-memory schedule store — reset on each server start (one server per test run).
let schedules = [];
let nextScheduleId = 1;

/**
 * Minimal deterministic fixtures used by the SPA during initial load.
 * Keep these intentionally small and stable.
 */
const nodes = [
  {
    id: "node1",
    name: "node1",
    baseUrl: "http://node1.local",
    clusterState: { initialized: false, type: "Standalone", health: "Self" },
    isPrimary: false,
  },
  {
    id: "node2",
    name: "node2",
    baseUrl: "http://node2.local",
    clusterState: { initialized: false, type: "Standalone", health: "Self" },
    isPrimary: false,
  },
];

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    return json(res, 400, { message: "Bad request" });
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // --- Auth ---
  // Non-session (legacy env-token) mode: authenticated=true so RequireAuth
  // does not redirect to /login, matching real behavior when sessionAuthEnabled=false.
  if (method === "GET" && path === "/api/auth/me") {
    return json(res, 200, {
      sessionAuthEnabled: false,
      authenticated: true,
      user: undefined,
      nodeIds: nodes.map((n) => n.id),
      configuredNodeIds: nodes.map((n) => n.id),
      clusterTokenConfigured: false,
      transport: { requestSecure: false },
    });
  }

  if (method === "POST" && path === "/api/auth/login") {
    return json(res, 400, { message: "Mock backend: login disabled for E2E" });
  }

  if (method === "POST" && path === "/api/auth/logout") {
    return json(res, 200, {});
  }

  // --- Nodes inventory ---
  if (method === "GET" && path === "/api/nodes") {
    return json(res, 200, nodes);
  }

  const nodeAppsMatch = path.match(/^\/api\/nodes\/([^/]+)\/apps$/);
  if (method === "GET" && nodeAppsMatch) {
    const nodeId = decodeURIComponent(nodeAppsMatch[1]);
    const exists = nodes.some((n) => n.id === nodeId);
    if (!exists) return notFound(res, path);

    return json(res, 200, {
      nodeId,
      apps: [],
      hasAdvancedBlocking: false,
      fetchedAt: nowIso(),
    });
  }

  const nodeOverviewMatch = path.match(/^\/api\/nodes\/([^/]+)\/overview$/);
  if (method === "GET" && nodeOverviewMatch) {
    const nodeId = decodeURIComponent(nodeOverviewMatch[1]);
    const exists = nodes.some((n) => n.id === nodeId);
    if (!exists) return notFound(res, path);

    return json(res, 200, {
      nodeId,
      version: "mock",
      uptime: 12345,
      totalZones: 0,
      totalQueries: 0,
      totalBlockedQueries: 0,
      totalApps: 0,
      hasAdvancedBlocking: false,
      fetchedAt: nowIso(),
    });
  }

  // --- Convenience placeholders (return empty but valid envelopes) ---
  // These help when navigating around during E2E without needing a full mock implementation.
  if (method === "GET" && path === "/api/nodes/logs/combined") {
    return json(res, 200, { nodes: [], logs: [], fetchedAt: nowIso() });
  }

  if (method === "GET" && path === "/api/nodes/zones/combined") {
    return json(res, 200, { nodes: [], zones: [], fetchedAt: nowIso() });
  }

  if (method === "GET" && path === "/api/nodes/zones/records") {
    return json(res, 200, {
      nodes: [],
      zone: url.searchParams.get("zone") ?? "",
      records: [],
      fetchedAt: nowIso(),
    });
  }

  // --- DNS Schedules ---

  if (method === "GET" && path === "/api/nodes/dns-schedules/token/status") {
    return json(res, 200, {
      configured: true,
      valid: true,
      username: "e2e-scheduler",
      hasAppsModify: true,
    });
  }

  if (method === "GET" && path === "/api/nodes/dns-schedules/storage/status") {
    return json(res, 200, { enabled: true, ready: true, dbPath: "/data/companion.sqlite" });
  }

  if (method === "GET" && path === "/api/nodes/dns-schedules/evaluator/status") {
    return json(res, 200, {
      enabled: true,
      running: false,
      intervalMs: 60000,
      tokenReady: true,
    });
  }

  if (method === "PATCH" && path === "/api/nodes/dns-schedules/evaluator/enabled") {
    return json(res, 200, { enabled: true, running: false, intervalMs: 60000, tokenReady: true });
  }

  if (method === "POST" && path === "/api/nodes/dns-schedules/evaluator/run") {
    return json(res, 200, {
      dryRun: false,
      triggeredAt: nowIso(),
      evaluatedSchedules: 0,
      results: [],
      applied: 0,
      removed: 0,
      skipped: 0,
      errored: 0,
    });
  }

  if (method === "GET" && path === "/api/nodes/dns-schedules/rules") {
    return json(res, 200, schedules);
  }

  if (method === "POST" && path === "/api/nodes/dns-schedules/rules") {
    const body = await readBody(req);
    const schedule = {
      id: `schedule-${nextScheduleId++}`,
      name: body.name ?? "Unnamed",
      enabled: body.enabled !== false,
      advancedBlockingGroupName: body.advancedBlockingGroupName ?? "",
      action: body.action ?? "block",
      domainEntries: body.domainEntries ?? [],
      domainGroupNames: body.domainGroupNames ?? [],
      daysOfWeek: body.daysOfWeek ?? [],
      startTime: body.startTime ?? "22:00",
      endTime: body.endTime ?? "06:00",
      timezone: body.timezone ?? "UTC",
      nodeIds: body.nodeIds ?? [],
      flushCacheOnChange: body.flushCacheOnChange ?? false,
      notifyEmails: body.notifyEmails ?? [],
      notifyDebounceSeconds: body.notifyDebounceSeconds ?? 300,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    schedules.push(schedule);
    return json(res, 201, schedule);
  }

  const scheduleEnabledMatch = path.match(
    /^\/api\/nodes\/dns-schedules\/rules\/([^/]+)\/enabled$/,
  );
  if (method === "PATCH" && scheduleEnabledMatch) {
    const id = decodeURIComponent(scheduleEnabledMatch[1]);
    const body = await readBody(req);
    const idx = schedules.findIndex((s) => s.id === id);
    if (idx === -1) return notFound(res, path);
    schedules[idx] = { ...schedules[idx], enabled: body.enabled ?? true, updatedAt: nowIso() };
    return json(res, 200, schedules[idx]);
  }

  const scheduleByIdMatch = path.match(/^\/api\/nodes\/dns-schedules\/rules\/([^/]+)$/);
  if (method === "DELETE" && scheduleByIdMatch) {
    const id = decodeURIComponent(scheduleByIdMatch[1]);
    schedules = schedules.filter((s) => s.id !== id);
    return json(res, 200, { deleted: true, scheduleId: id });
  }
  if (method === "PATCH" && scheduleByIdMatch) {
    const id = decodeURIComponent(scheduleByIdMatch[1]);
    const body = await readBody(req);
    const idx = schedules.findIndex((s) => s.id === id);
    if (idx === -1) return notFound(res, path);
    schedules[idx] = { ...schedules[idx], ...body, id, updatedAt: nowIso() };
    return json(res, 200, schedules[idx]);
  }

  if (method === "GET" && path === "/api/nodes/dns-schedules/state") {
    return json(res, 200, []);
  }

  // --- Domain Groups (stub — Automation page fetches this on load) ---

  if (method === "GET" && path === "/api/domain-groups") {
    return json(res, 200, []);
  }

  // --- Log Alerts SMTP status (stub — Automation page fetches this on load) ---

  if (method === "GET" && path === "/api/log-alerts/smtp/status") {
    return json(res, 200, { configured: false, ready: false, secure: false });
  }

  return notFound(res, path);
});

server.listen(port, () => {
  console.log(`[e2e-mock-backend] listening on http://localhost:${port}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
