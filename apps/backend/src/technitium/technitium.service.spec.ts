import { UnauthorizedException } from "@nestjs/common";
import axios from "axios";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { AuthRequestContext } from "../auth/auth-request-context";
import { DhcpSnapshotService } from "./dhcp-snapshot.service";
import { TechnitiumService } from "./technitium.service";
import { TechnitiumDhcpScope, TechnitiumNodeConfig } from "./technitium.types";

describe("TechnitiumService buildDhcpScopeFormData", () => {
  let service: TechnitiumService;

  beforeAll(() => {
    process.env.NODE_ENV = "test";
  });

  beforeEach(() => {
    service = new TechnitiumService([], new DhcpSnapshotService());
  });

  afterEach(() => {
    // Clean up timers to avoid Jest "open handle" warnings
    service.onModuleDestroy();
  });

  it("serializes the required DHCP scope fields without optional values", () => {
    const scope: TechnitiumDhcpScope = {
      name: "OfficeScope",
      startingAddress: "192.168.100.10",
      endingAddress: "192.168.100.250",
      subnetMask: "255.255.255.0",
    };

    const formData: URLSearchParams = (
      service as unknown as {
        buildDhcpScopeFormData: (scope: TechnitiumDhcpScope) => URLSearchParams;
      }
    ).buildDhcpScopeFormData(scope);

    expect(formData.get("name")).toBe("OfficeScope");
    expect(formData.get("startingAddress")).toBe("192.168.100.10");
    expect(formData.get("endingAddress")).toBe("192.168.100.250");
    expect(formData.get("subnetMask")).toBe("255.255.255.0");

    expect(formData.has("leaseTimeDays")).toBe(false);
    expect(formData.has("dnsServers")).toBe(false);
    expect(formData.has("reservedLeases")).toBe(false);
  });

  it("serializes optional collections and nullable values using the API format", () => {
    const scope: TechnitiumDhcpScope = {
      name: "LabScope",
      startingAddress: "10.0.0.10",
      endingAddress: "10.0.0.200",
      subnetMask: "255.255.255.0",
      domainName: "lab.local",
      domainSearchList: [],
      dnsUpdates: true,
      dnsServers: ["1.1.1.1", "1.0.0.1"],
      winsServers: [],
      ntpServers: ["10.0.0.2"],
      ntpServerDomainNames: ["time.lab.local"],
      staticRoutes: [
        {
          destination: "172.16.0.0",
          subnetMask: "255.240.0.0",
          router: "10.0.0.1",
        },
      ],
      vendorInfo: [{ identifier: "vendor", information: "payload" }],
      capwapAcIpAddresses: ["192.168.50.2"],
      tftpServerAddresses: [],
      genericOptions: [{ code: 60, value: "PXEClient" }],
      exclusions: [
        { startingAddress: "10.0.0.50", endingAddress: "10.0.0.60" },
      ],
      reservedLeases: [
        {
          hostName: "printer",
          hardwareAddress: "AA-BB-CC-11-22-33",
          address: "10.0.0.80",
          comments: "front desk",
        },
      ],
      allowOnlyReservedLeases: false,
      blockLocallyAdministeredMacAddresses: true,
      ignoreClientIdentifierOption: false,
      serverAddress: null,
      serverHostName: null,
      bootFileName: null,
      routerAddress: null,
      useThisDnsServer: false,
    };

    const formData: URLSearchParams = (
      service as unknown as {
        buildDhcpScopeFormData: (scope: TechnitiumDhcpScope) => URLSearchParams;
      }
    ).buildDhcpScopeFormData(scope);

    expect(formData.get("domainName")).toBe("lab.local");
    expect(formData.get("domainSearchList")).toBe("");
    expect(formData.get("dnsUpdates")).toBe("true");
    expect(formData.get("dnsServers")).toBe("1.1.1.1,1.0.0.1");
    expect(formData.get("winsServers")).toBe("");
    expect(formData.get("ntpServers")).toBe("10.0.0.2");
    expect(formData.get("ntpServerDomainNames")).toBe("time.lab.local");
    expect(formData.get("staticRoutes")).toBe(
      "172.16.0.0|255.240.0.0|10.0.0.1",
    );
    expect(formData.get("vendorInfo")).toBe("vendor|payload");
    expect(formData.get("capwapAcIpAddresses")).toBe("192.168.50.2");
    expect(formData.get("tftpServerAddresses")).toBe("");
    expect(formData.get("genericOptions")).toBe("60|PXEClient");
    expect(formData.get("exclusions")).toBe("10.0.0.50|10.0.0.60");
    expect(formData.get("reservedLeases")).toBe(
      "printer|AA-BB-CC-11-22-33|10.0.0.80|front desk",
    );
    expect(formData.get("allowOnlyReservedLeases")).toBe("false");
    expect(formData.get("blockLocallyAdministeredMacAddresses")).toBe("true");
    expect(formData.get("ignoreClientIdentifierOption")).toBe("false");
    expect(formData.get("serverAddress")).toBe("");
    expect(formData.get("serverHostName")).toBe("");
    expect(formData.get("bootFileName")).toBe("");
    expect(formData.get("routerAddress")).toBe("");
    expect(formData.get("useThisDnsServer")).toBe("false");
  });

  describe("compareDhcpScopes", () => {
    const getComparer = (svc: TechnitiumService) =>
      (
        svc as unknown as {
          compareDhcpScopes: (
            source: TechnitiumDhcpScope,
            target: TechnitiumDhcpScope,
          ) => { equal: boolean; differences: string[] };
        }
      ).compareDhcpScopes;

    it("treats scopes as equal when values match after normalization", () => {
      const compare = getComparer(service);

      const source: TechnitiumDhcpScope = {
        name: "Office",
        startingAddress: "192.168.10.10",
        endingAddress: "192.168.10.200",
        subnetMask: "255.255.255.0",
        dnsServers: ["1.1.1.1", "8.8.8.8"],
        staticRoutes: [
          {
            destination: "10.0.0.0",
            subnetMask: "255.0.0.0",
            router: "192.168.10.1",
          },
          {
            destination: "172.16.0.0",
            subnetMask: "255.240.0.0",
            router: "192.168.10.1",
          },
        ],
        exclusions: [
          { startingAddress: "192.168.10.50", endingAddress: "192.168.10.60" },
        ],
        reservedLeases: [
          {
            hostName: "printer",
            hardwareAddress: "AA-BB-CC-11-22-33",
            address: "192.168.10.80",
            comments: "front desk",
          },
        ],
        genericOptions: [{ code: 60, value: "PXEClient" }],
      };

      const target: TechnitiumDhcpScope = {
        name: "Office",
        startingAddress: "192.168.10.10",
        endingAddress: "192.168.10.200",
        subnetMask: "255.255.255.0",
        dnsServers: ["8.8.8.8", "1.1.1.1"],
        staticRoutes: [
          {
            destination: "172.16.0.0",
            subnetMask: "255.240.0.0",
            router: "192.168.10.1",
          },
          {
            destination: "10.0.0.0",
            subnetMask: "255.0.0.0",
            router: "192.168.10.1",
          },
        ],
        exclusions: [
          { startingAddress: "192.168.10.50", endingAddress: "192.168.10.60" },
        ],
        reservedLeases: [
          {
            hostName: "printer",
            hardwareAddress: "aa-bb-cc-11-22-33",
            address: "192.168.10.80",
            comments: "front desk",
          },
        ],
        genericOptions: [{ code: 60, value: "PXEClient" }],
      };

      const result = compare(source, target);

      expect(result.equal).toBe(true);
      expect(result.differences).toHaveLength(0);
    });

    it("reports differences when the scope pool changes", () => {
      const compare = getComparer(service);

      const source: TechnitiumDhcpScope = {
        name: "Office",
        startingAddress: "192.168.10.10",
        endingAddress: "192.168.10.200",
        subnetMask: "255.255.255.0",
      };

      const target: TechnitiumDhcpScope = {
        name: "Office",
        startingAddress: "192.168.10.10",
        endingAddress: "192.168.10.200",
        subnetMask: "255.255.254.0", // Different mask should produce a diff
      };

      const result = compare(source, target);

      expect(result.equal).toBe(false);
      expect(result.differences).toContain(
        "Pool: 192.168.10.10-192.168.10.200-255.255.255.0 → 192.168.10.10-192.168.10.200-255.255.254.0",
      );
    });

    it("reports differences when domain search list changes", () => {
      const compare = getComparer(service);

      const source: TechnitiumDhcpScope = {
        name: "Office",
        startingAddress: "192.168.10.10",
        endingAddress: "192.168.10.200",
        subnetMask: "255.255.255.0",
        domainSearchList: ["home.arpa", "example.local"],
      };

      const target: TechnitiumDhcpScope = {
        name: "Office",
        startingAddress: "192.168.10.10",
        endingAddress: "192.168.10.200",
        subnetMask: "255.255.255.0",
        domainSearchList: ["home.arpa"],
      };

      const result = compare(source, target);

      expect(result.equal).toBe(false);
      expect(result.differences).toContain(
        'Domain search list: ["example.local","home.arpa"] → ["home.arpa"]',
      );
    });
  });

  describe("bulkSyncDhcpScopes (skip-existing)", () => {
    const makeScopeEnvelope = (
      nodeId: string,
      scopes: TechnitiumDhcpScope[],
    ) => ({ nodeId, fetchedAt: "now", data: { scopes } });

    it("reports differences when target scope has a different pool and does not sync", async () => {
      const svc = new TechnitiumService(
        [
          { id: "src", baseUrl: "http://src", token: "t" },
          { id: "tgt", baseUrl: "http://tgt", token: "t" },
        ],
        new DhcpSnapshotService(),
      );

      jest
        .spyOn(svc, "listDhcpScopes")
        .mockResolvedValueOnce(
          makeScopeEnvelope("src", [
            {
              name: "Parents",
              startingAddress: "192.168.66.100",
              endingAddress: "192.168.66.250",
              subnetMask: "255.255.255.0",
            },
          ]),
        )
        .mockResolvedValueOnce(
          makeScopeEnvelope("tgt", [
            {
              name: "Parents",
              startingAddress: "192.168.33.100",
              endingAddress: "192.168.33.250",
              subnetMask: "255.255.255.0",
            },
          ]),
        );

      const cloneSpy = jest
        .spyOn(svc, "cloneDhcpScope")
        .mockResolvedValue({
          sourceNodeId: "src",
          targetNodeId: "tgt",
          sourceScopeName: "Parents",
          targetScopeName: "Parents",
          enabledOnTarget: false,
        });

      const result = await svc.bulkSyncDhcpScopes({
        sourceNodeId: "src",
        targetNodeIds: ["tgt"],
        strategy: "skip-existing",
        scopeNames: ["Parents"],
        enableOnTarget: false,
      });

      expect(cloneSpy).not.toHaveBeenCalled();

      expect(result.totalSynced).toBe(0);
      expect(result.totalSkipped).toBe(1);
      expect(result.totalFailed).toBe(0);

      const node = result.nodeResults[0];
      expect(node.status).toBe("success");
      expect(node.scopeResults[0].status).toBe("skipped");
      expect(node.scopeResults[0].reason).toContain("differs");
      expect(node.scopeResults[0].differences?.join("\n")).toContain("Pool");
    });
  });

  describe("bulkSyncDhcpScopes (merge-missing)", () => {
    const makeScopeEnvelope = (
      nodeId: string,
      scopes: TechnitiumDhcpScope[],
    ) => ({ nodeId, fetchedAt: "now", data: { scopes } });

    it("updates target when domain search list differs", async () => {
      const svc = new TechnitiumService(
        [
          { id: "src", baseUrl: "http://src", token: "t" },
          { id: "tgt", baseUrl: "http://tgt", token: "t" },
        ],
        new DhcpSnapshotService(),
      );

      jest
        .spyOn(svc, "listDhcpScopes")
        .mockResolvedValueOnce(
          makeScopeEnvelope("src", [
            {
              name: "Default",
              startingAddress: "192.168.45.100",
              endingAddress: "192.168.45.250",
              subnetMask: "255.255.255.0",
              domainSearchList: [
                "example.internal",
                "home.arpa",
                "example.test",
              ],
            },
          ]),
        )
        .mockResolvedValueOnce(
          makeScopeEnvelope("tgt", [
            {
              name: "Default",
              startingAddress: "192.168.45.100",
              endingAddress: "192.168.45.250",
              subnetMask: "255.255.255.0",
              domainSearchList: ["home.arpa", "example.test"],
            },
          ]),
        );

      const cloneSpy = jest
        .spyOn(svc, "cloneDhcpScope")
        .mockResolvedValue({
          sourceNodeId: "src",
          targetNodeId: "tgt",
          sourceScopeName: "Default",
          targetScopeName: "Default",
          enabledOnTarget: false,
        });

      const result = await svc.bulkSyncDhcpScopes({
        sourceNodeId: "src",
        targetNodeIds: ["tgt"],
        strategy: "merge-missing",
        scopeNames: ["Default"],
        enableOnTarget: false,
      });

      expect(cloneSpy).toHaveBeenCalledTimes(1);
      expect(result.totalSynced).toBe(1);
      expect(result.totalSkipped).toBe(0);
      expect(result.totalFailed).toBe(0);

      const node = result.nodeResults[0];
      expect(node.status).toBe("success");
      expect(node.scopeResults[0].status).toBe("synced");
    });
  });

  describe("DHCP snapshots", () => {
    const makeScope = (name: string): TechnitiumDhcpScope => ({
      name,
      startingAddress: "10.0.0.10",
      endingAddress: "10.0.0.200",
      subnetMask: "255.255.255.0",
    });

    const makeNodeConfig = () => ({
      id: "node1",
      baseUrl: "http://node1",
      token: "t",
    });

    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dhcp-snap-test-"));
      process.env.DHCP_SNAPSHOT_DIR = tmpDir;
    });

    afterEach(async () => {
      delete process.env.DHCP_SNAPSHOT_DIR;
      delete process.env.DHCP_SNAPSHOT_RETENTION;
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("keeps pinned snapshots beyond retention limit and prunes oldest unpinned", async () => {
      process.env.DHCP_SNAPSHOT_RETENTION = "2";
      const svc = new DhcpSnapshotService();

      const baseEntry = (name: string) => [
        { scope: makeScope(name), enabled: false },
      ];

      const first = await svc.saveSnapshot("node1", baseEntry("one"));
      await svc.setPinned("node1", first.id, true);
      const second = await svc.saveSnapshot("node1", baseEntry("two"));
      const third = await svc.saveSnapshot("node1", baseEntry("three"));
      const fourth = await svc.saveSnapshot("node1", baseEntry("four"));

      const snapshots = await svc.listSnapshots("node1");
      const ids = snapshots.map((s) => s.id);

      expect(ids).toEqual(
        expect.arrayContaining([first.id, third.id, fourth.id]),
      );
      expect(ids).not.toContain(second.id); // pruned oldest unpinned
    });

    it("restores a snapshot with deleteExtraScopes defaulting to true and requires confirm flag", async () => {
      const nodeConfig = makeNodeConfig();
      const snapshotSvc = new DhcpSnapshotService();
      const svc = new TechnitiumService([nodeConfig], snapshotSvc);

      const initialScopes: Record<
        string,
        { scope: TechnitiumDhcpScope; enabled: boolean }
      > = {
        alpha: { scope: makeScope("alpha"), enabled: true },
        beta: { scope: makeScope("beta"), enabled: false },
      };

      const currentScopes = new Map<
        string,
        { scope: TechnitiumDhcpScope; enabled: boolean }
      >([
        ["alpha", { scope: { ...initialScopes.alpha.scope }, enabled: true }],
        ["beta", { scope: { ...initialScopes.beta.scope }, enabled: false }],
      ]);

      const requestSpy = jest
        .spyOn(svc, "request")
        .mockImplementation(
          (
            node: Parameters<TechnitiumService["request"]>[0],
            config: Parameters<TechnitiumService["request"]>[1],
          ) => {
            const resolveNameParam = (): string => {
              const params: unknown = config.params;
              if (params instanceof URLSearchParams) {
                return params.get("name") ?? "";
              }

              if (params && typeof params === "object" && "name" in params) {
                const value = (params as Record<string, unknown>).name;
                return typeof value === "string" ? value : "";
              }

              return "";
            };

            switch (config.url) {
              case "/api/dhcp/scopes/list": {
                return Promise.resolve({
                  status: "ok",
                  response: {
                    scopes: Array.from(currentScopes.entries()).map(
                      ([name, value]) => ({ name, enabled: value.enabled }),
                    ),
                  },
                });
              }
              case "/api/dhcp/scopes/get": {
                const name = resolveNameParam();
                const entry = currentScopes.get(name);
                return Promise.resolve({
                  status: "ok",
                  response: entry?.scope,
                });
              }
              case "/api/dhcp/scopes/set": {
                const rawData =
                  typeof config.data === "string" ? config.data : "";
                const params = new URLSearchParams(rawData);
                const name = params.get("name") ?? "";
                const snapshotEntry = initialScopes[name];
                currentScopes.set(name, {
                  scope: snapshotEntry?.scope ?? makeScope(name),
                  enabled: snapshotEntry?.enabled ?? false,
                });
                return Promise.resolve({ status: "ok", response: {} });
              }
              case "/api/dhcp/scopes/enable": {
                const name = resolveNameParam();
                const existing = currentScopes.get(name) ?? {
                  scope: makeScope(name),
                  enabled: false,
                };
                currentScopes.set(name, { ...existing, enabled: true });
                return Promise.resolve({ status: "ok", response: {} });
              }
              case "/api/dhcp/scopes/disable": {
                const name = resolveNameParam();
                const existing = currentScopes.get(name) ?? {
                  scope: makeScope(name),
                  enabled: false,
                };
                currentScopes.set(name, { ...existing, enabled: false });
                return Promise.resolve({ status: "ok", response: {} });
              }
              case "/api/dhcp/scopes/delete": {
                const name = resolveNameParam();
                currentScopes.delete(name);
                return Promise.resolve({ status: "ok", response: {} });
              }
              default:
                return Promise.reject(
                  new Error(
                    `Unexpected request to ${String(config.url)} for node ${node.id}`,
                  ),
                );
            }
          },
        );

      const snapshotMeta = await svc.createDhcpSnapshot(nodeConfig.id);

      currentScopes.clear();
      currentScopes.set("alpha", { scope: makeScope("alpha"), enabled: false });
      currentScopes.set("orphan", {
        scope: makeScope("orphan"),
        enabled: true,
      });

      await expect(
        svc.restoreDhcpSnapshot(nodeConfig.id, snapshotMeta.id),
      ).rejects.toThrow("confirmation");

      const result = await svc.restoreDhcpSnapshot(
        nodeConfig.id,
        snapshotMeta.id,
        { confirm: true },
      );

      expect(result.deleted).toBe(1); // orphan deleted
      expect(result.restored).toBe(2);

      const finalScopes = Array.from(currentScopes.keys());
      expect(finalScopes).toEqual(expect.arrayContaining(["alpha", "beta"]));
      expect(finalScopes).not.toContain("orphan");

      expect(currentScopes.get("alpha")?.enabled).toBe(true);
      expect(currentScopes.get("beta")?.enabled).toBe(false);

      expect(requestSpy).toHaveBeenCalled();
    });
  });
});

describe("TechnitiumService request (session auth)", () => {
  let service: TechnitiumService;

  beforeEach(() => {
    service = new TechnitiumService([], new DhcpSnapshotService());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    service.onModuleDestroy();
  });

  it("drops the per-node session token when Technitium returns an invalid-token envelope", async () => {
    const session = {
      id: "test-session",
      createdAt: new Date().toISOString(),
      lastSeenAt: Date.now(),
      user: "admin",
      tokensByNodeId: { node1: "token-1" },
    };

    jest
      .spyOn(axios, "request")
      .mockResolvedValue({ data: { status: "invalid-token" } } as never);

    const node = {
      id: "node1",
      name: "Node 1",
      baseUrl: "https://example.invalid",
      token: "fallback-token",
    } satisfies TechnitiumNodeConfig;

    await AuthRequestContext.run({ session }, async () => {
      await expect(
        service.request(node, { method: "GET", url: "/api/apps/list" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    expect(session.tokensByNodeId.node1).toBeUndefined();
  });
});
