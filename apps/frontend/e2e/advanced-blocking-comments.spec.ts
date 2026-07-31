import { expect, test } from "@playwright/test";

const metrics = {
  groupCount: 1,
  blockedDomainCount: 1,
  allowedDomainCount: 0,
  blockListUrlCount: 0,
  allowListUrlCount: 0,
  adblockListUrlCount: 0,
  allowedRegexCount: 0,
  blockedRegexCount: 0,
  regexAllowListUrlCount: 0,
  regexBlockListUrlCount: 0,
  localEndpointMappingCount: 0,
  networkMappingCount: 0,
  scheduledNodeCount: 0,
};

const config = {
  localEndPointGroupMap: {},
  networkGroupMap: {},
  groups: [
    {
      name: "default",
      blockingAddresses: [],
      allowed: [],
      blocked: ["ads.example"],
      allowListUrls: [],
      blockListUrls: [],
      allowedRegex: [],
      blockedRegex: [],
      regexAllowListUrls: [],
      regexBlockListUrls: [],
      adblockListUrls: [],
    },
  ],
};

test("comment edits wait for Save Changes and Reset discards them", async ({
  page,
}) => {
  const writes: Array<Record<string, unknown>> = [];
  let revision = "revision-1";
  let commentText = "saved rationale";

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const respond = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", json: body });

    if (method === "GET" && path === "/api/auth/me") {
      return respond({
        sessionAuthEnabled: false,
        authenticated: true,
        nodeIds: ["node1"],
        configuredNodeIds: ["node1"],
        clusterTokenConfigured: false,
        transport: { requestSecure: false },
      });
    }
    if (method === "GET" && path === "/api/nodes") {
      return respond([
        {
          id: "node1",
          name: "Node 1",
          baseUrl: "https://node1.example.test",
          clusterState: {
            initialized: false,
            type: "Standalone",
            health: "Self",
          },
          isPrimary: false,
        },
      ]);
    }
    if (method === "GET" && path === "/api/nodes/node1/apps") {
      return respond({
        nodeId: "node1",
        apps: [{ name: "Advanced Blocking" }],
        hasAdvancedBlocking: true,
        fetchedAt: new Date().toISOString(),
      });
    }
    if (
      method === "GET" &&
      path === "/api/built-in-blocking/status"
    ) {
      return respond({
        fetchedAt: new Date().toISOString(),
        hasConflict: false,
        nodesWithAdvancedBlocking: ["node1"],
        nodesWithBuiltInBlocking: [],
        nodes: [
          {
            nodeId: "node1",
            nodeName: "Node 1",
            builtInEnabled: false,
            advancedBlockingInstalled: true,
            advancedBlockingEnabled: true,
            hasConflict: false,
          },
        ],
      });
    }
    if (method === "GET" && path === "/api/nodes/advanced-blocking") {
      return respond({
        fetchedAt: new Date().toISOString(),
        aggregate: metrics,
        nodes: [
          {
            nodeId: "node1",
            baseUrl: "https://node1.example.test",
            fetchedAt: new Date().toISOString(),
            metrics,
            config,
            configRevision: revision,
          },
        ],
      });
    }
    if (
      method === "GET" &&
      path === "/api/nodes/node1/advanced-blocking/raw"
    ) {
      return respond({
        nodeId: "node1",
        rawConfig: `{
  "groups": [{
    "name": "default",
    "blocked": [
      // ${commentText}
      "ads.example"
    ]
  }]
}`,
        configRevision: revision,
        domainComments: [
          {
            id: `comment-${revision}`,
            groupName: "default",
            field: "blocked",
            value: "ads.example",
            occurrence: 0,
            placement: "leading",
            style: "line",
            text: commentText,
            raw: `// ${commentText}`,
          },
        ],
        snapshot: {
          nodeId: "node1",
          baseUrl: "https://node1.example.test",
          fetchedAt: new Date().toISOString(),
          metrics,
          config,
          configRevision: revision,
        },
      });
    }
    if (
      method === "POST" &&
      path === "/api/nodes/node1/advanced-blocking"
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push(body);
      const mutations = body.commentMutations as Array<{
        action: string;
        text?: string;
      }>;
      commentText = mutations[0]?.text ?? commentText;
      revision = "revision-2";
      return respond({
        nodeId: "node1",
        baseUrl: "https://node1.example.test",
        fetchedAt: new Date().toISOString(),
        metrics,
        config: body.config,
        configRevision: revision,
      });
    }
    if (method === "GET" && path === "/api/domain-groups/status") {
      return respond({ enabled: false, ready: false });
    }
    if (method === "GET" && path === "/api/nodes/node1/overview") {
      return respond({
        nodeId: "node1",
        version: "mock",
        uptime: 1,
        totalZones: 0,
        totalQueries: 0,
        totalBlockedQueries: 0,
        totalApps: 1,
        hasAdvancedBlocking: true,
        fetchedAt: new Date().toISOString(),
      });
    }

    return respond({});
  });

  await page.goto("/configuration");
  const domainRow = page.getByRole("row").filter({ hasText: "ads.example" });
  await expect(domainRow).toBeVisible();

  await domainRow.getByTitle("View 1 comment").click();
  const commentDialog = page.getByRole("dialog", {
    name: "Domain comments",
  });
  await commentDialog.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Edit comment for default").fill("discarded edit");
  await page.getByRole("button", { name: "Stage edit" }).click();

  expect(writes).toHaveLength(0);
  await expect(page.getByText("Pending result")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("You have unsaved changes (1)")).toBeVisible();

  await page.getByRole("button", { name: "Reset" }).click();
  expect(writes).toHaveLength(0);
  await domainRow.getByTitle("View 1 comment").click();
  await expect(page.getByText("// saved rationale")).toBeVisible();
  await expect(page.getByText("Pending result")).toHaveCount(0);

  await commentDialog
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("Edit comment for default").fill("persisted edit");
  await page.getByRole("button", { name: "Stage edit" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Save Changes" }).click();

  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    configRevision: "revision-1",
    configNodeId: "node1",
    commentMutations: [
      {
        action: "edit",
        text: "persisted edit",
      },
    ],
  });
  await expect(page.getByText("You have unsaved changes (1)")).toHaveCount(0);

  await domainRow.getByTitle("View 1 comment").click();
  await expect(page.getByText("// persisted edit")).toBeVisible();
});
