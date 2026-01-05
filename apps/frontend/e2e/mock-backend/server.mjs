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

const server = http.createServer((req, res) => {
  if (!req.url) {
    return json(res, 400, { message: "Bad request" });
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // --- Auth ---
  // For deterministic E2E we run in non-session mode so the app does not force /login.
  if (method === "GET" && path === "/api/auth/me") {
    return json(res, 200, {
      sessionAuthEnabled: false,
      authenticated: false,
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

  return notFound(res, path);
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[e2e-mock-backend] listening on http://localhost:${port}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
