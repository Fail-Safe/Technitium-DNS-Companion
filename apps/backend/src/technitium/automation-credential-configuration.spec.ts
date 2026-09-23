import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";
import type { GroupCredentialStatus } from "../auth/auth.types";
import { DhcpSnapshotService } from "./dhcp-snapshot.service";
import { TechnitiumService } from "./technitium.service";
import type { TechnitiumNodeConfig } from "./technitium.types";

describe("TechnitiumService automation credential configuration", () => {
  const originalEnv = { ...process.env };
  let directory: string;
  const nodes: TechnitiumNodeConfig[] = [
    {
      id: "node-a",
      baseUrl: "https://node-a.example.test",
      token: "",
      groupId: "site-a",
    },
    {
      id: "node-b",
      baseUrl: "https://node-b.example.test",
      token: "",
      groupId: "site-b",
    },
  ];

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "test" };
    delete process.env.TECHNITIUM_BACKGROUND_TOKEN;
    delete process.env.TECHNITIUM_BACKGROUND_TOKEN_FILE;
    delete process.env.TECHNITIUM_BACKGROUND_TOKEN_MAP_FILE;
    delete process.env.TECHNITIUM_SCHEDULE_TOKEN;
    delete process.env.TECHNITIUM_SCHEDULE_TOKEN_FILE;
    delete process.env.TECHNITIUM_SCHEDULE_TOKEN_MAP_FILE;
    directory = mkdtempSync(join(tmpdir(), "automation-credential-spec-"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
    rmSync(directory, { recursive: true, force: true });
  });

  const readyGroup = (
    groupId: string,
    nodeId: string,
  ): GroupCredentialStatus => ({
    groupId,
    state: "ready",
    verifiedUsername: `automation-${groupId}`,
    authenticatedNodeIds: [nodeId],
    unreachableNodeIds: [],
    failedNodeIds: [],
    admittedNodeIds: {
      interactive: [nodeId],
      ptrRead: [nodeId],
      dhcpRead: [],
      primaryConfigWrite: [nodeId],
      cacheFlush: [],
    },
    capabilities: {
      ptrRead: true,
      dhcpRead: false,
      primaryConfigWrite: true,
      cacheFlush: false,
    },
  });

  it("disables a scalar role in explicit grouped mode without stopping startup", () => {
    process.env.TECHNITIUM_BACKGROUND_TOKEN = "sensitive-background-token";
    const service = new TechnitiumService(nodes, new DhcpSnapshotService());

    const status = service.getBackgroundPtrTokenValidationSummary();
    expect(status).toMatchObject({
      configured: true,
      validated: true,
      okForPtr: false,
      groups: {
        anyReady: false,
        allReady: false,
        groups: [
          { groupId: "site-a", state: "failed" },
          { groupId: "site-b", state: "failed" },
        ],
      },
    });
    expect(JSON.stringify(status)).not.toContain("sensitive-background-token");
    service.onModuleDestroy();
  });

  it("sanitizes scalar-plus-map and malformed-map failures", () => {
    const path = join(directory, "schedule-map.json");
    writeFileSync(path, '{"token":"do-not-expose-map-content"}');
    process.env.TECHNITIUM_SCHEDULE_TOKEN = "do-not-expose-scalar";
    process.env.TECHNITIUM_SCHEDULE_TOKEN_MAP_FILE = path;
    const conflicting = new TechnitiumService(nodes, new DhcpSnapshotService());
    const conflictStatus = conflicting.getScheduleTokenStatus();
    expect(conflictStatus.valid).toBe(false);
    expect(conflictStatus.groups?.groups).toHaveLength(2);
    expect(JSON.stringify(conflictStatus)).not.toContain("do-not-expose");
    expect(JSON.stringify(conflictStatus)).not.toContain(directory);
    conflicting.onModuleDestroy();

    delete process.env.TECHNITIUM_SCHEDULE_TOKEN;
    const malformed = new TechnitiumService(nodes, new DhcpSnapshotService());
    const malformedStatus = malformed.getScheduleTokenStatus();
    expect(malformedStatus.valid).toBe(false);
    expect(malformedStatus.groups?.groups).toHaveLength(2);
    expect(JSON.stringify(malformedStatus)).not.toContain(
      "do-not-expose-map-content",
    );
    expect(JSON.stringify(malformedStatus)).not.toContain(directory);
    malformed.onModuleDestroy();
  });

  it("revalidates an unreachable automation node before readmitting it", async () => {
    const service = new TechnitiumService(nodes, new DhcpSnapshotService());
    const siteA = readyGroup("site-a", "node-a");
    siteA.state = "unreachable";
    siteA.authenticatedNodeIds = [];
    siteA.unreachableNodeIds = ["node-a"];
    siteA.admittedNodeIds = {
      interactive: [],
      ptrRead: [],
      dhcpRead: [],
      primaryConfigWrite: [],
      cacheFlush: [],
    };
    siteA.capabilities = {
      ptrRead: false,
      dhcpRead: false,
      primaryConfigWrite: false,
      cacheFlush: false,
    };
    const internal = service as unknown as {
      backgroundCredentials: unknown;
      backgroundGroupCredentials: {
        anyReady: boolean;
        allReady: boolean;
        groups: GroupCredentialStatus[];
      };
      backgroundTokenValidation: unknown;
      validateExplicitSessionToken: jest.Mock;
      assertAutomationNodeAdmitted: (
        authMode: "background",
        node: TechnitiumNodeConfig,
        role: "ptrRead",
      ) => Promise<void>;
    };
    internal.backgroundCredentials = {
      configured: true,
      source: "map",
      credentialsByGroup: new Map([
        ["site-a", { username: "automation-site-a", token: "token-a" }],
      ]),
    };
    internal.backgroundGroupCredentials = {
      anyReady: false,
      allReady: false,
      groups: [siteA, readyGroup("site-b", "node-b")],
    };
    internal.backgroundTokenValidation = {
      validated: true,
      okForPtr: true,
    };
    internal.validateExplicitSessionToken = jest.fn(() =>
      Promise.resolve({
        username: "automation-site-a",
        permissions: { DnsClient: { canView: true } },
        clusterInitialized: false,
        clusterNodes: [],
      }),
    );

    await internal.assertAutomationNodeAdmitted(
      "background",
      nodes[0],
      "ptrRead",
    );

    expect(internal.validateExplicitSessionToken).toHaveBeenCalledWith(
      "node-a",
      "token-a",
    );
    expect(siteA.state).toBe("ready");
    expect(siteA.admittedNodeIds.ptrRead).toEqual(["node-a"]);
    service.onModuleDestroy();
  });

  it("matches an automation node by its self-reported cluster DNS name", () => {
    const service = new TechnitiumService(nodes, new DhcpSnapshotService());
    const role = (
      service as unknown as {
        getCredentialProbeNodeRole: (
          node: TechnitiumNodeConfig,
          probe: {
            clusterInitialized: boolean;
            dnsServerDomain?: string;
            clusterNodes: Array<{
              name?: string;
              url?: string;
              type?: "Primary" | "Secondary";
            }>;
          },
        ) => "Primary" | "Secondary" | undefined;
      }
    ).getCredentialProbeNodeRole(nodes[0], {
      clusterInitialized: true,
      dnsServerDomain: "A-PRIMARY.SITE-A.TEST",
      clusterNodes: [
        {
          name: "a-primary.site-a.test",
          url: "https://a-primary.site-a.test:53443/",
          type: "Primary",
        },
      ],
    });

    expect(role).toBe("Primary");
    service.onModuleDestroy();
  });

  it("invalidates only the automation group rejected with HTTP 403", async () => {
    const service = new TechnitiumService(nodes, new DhcpSnapshotService());
    const siteA = readyGroup("site-a", "node-a");
    const siteB = readyGroup("site-b", "node-b");
    const internal = service as unknown as {
      scheduleCredentials: unknown;
      scheduleGroupCredentials: {
        anyReady: boolean;
        allReady: boolean;
        groups: GroupCredentialStatus[];
      };
      scheduleTokenValidation: unknown;
    };
    internal.scheduleCredentials = {
      configured: true,
      source: "map",
      credentialsByGroup: new Map([
        ["site-a", { username: "automation-site-a", token: "token-a" }],
        ["site-b", { username: "automation-site-b", token: "token-b" }],
      ]),
    };
    internal.scheduleGroupCredentials = {
      anyReady: true,
      allReady: true,
      groups: [siteA, siteB],
    };
    internal.scheduleTokenValidation = {
      validated: true,
      valid: true,
      hasAppsModify: true,
      hasCacheDelete: false,
    };
    jest.spyOn(axios, "request").mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, statusText: "Forbidden", data: {} },
    });

    await expect(
      service.request(
        nodes[0],
        { method: "GET", url: "/api/apps/config/get" },
        { authMode: "schedule" },
      ),
    ).rejects.toMatchObject({ status: 403 });

    expect(siteA.state).toBe("failed");
    expect(siteA.admittedNodeIds.primaryConfigWrite).toEqual([]);
    expect(siteB.state).toBe("ready");
    expect(service.getScheduleTokenStatus()).toMatchObject({
      valid: true,
      groups: {
        anyReady: true,
        allReady: false,
        groups: [
          { groupId: "site-a", state: "failed" },
          { groupId: "site-b", state: "ready" },
        ],
      },
    });
    service.onModuleDestroy();
  });
});
