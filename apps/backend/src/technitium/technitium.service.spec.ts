import { TechnitiumService } from "./technitium.service";
import { TechnitiumDhcpScope } from "./technitium.types";

describe("TechnitiumService buildDhcpScopeFormData", () => {
  let service: TechnitiumService;

  beforeEach(() => {
    service = new TechnitiumService([]);
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
      const svc = new TechnitiumService([
        { id: "src", baseUrl: "http://src", token: "t" },
        { id: "tgt", baseUrl: "http://tgt", token: "t" },
      ]);

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

      const cloneSpy = jest.spyOn(svc, "cloneDhcpScope").mockResolvedValue({
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
      expect(node.scopeResults[0].reason).toContain("Pool");
    });
  });

  describe("bulkSyncDhcpScopes (merge-missing)", () => {
    const makeScopeEnvelope = (
      nodeId: string,
      scopes: TechnitiumDhcpScope[],
    ) => ({ nodeId, fetchedAt: "now", data: { scopes } });

    it("updates target when domain search list differs", async () => {
      const svc = new TechnitiumService([
        { id: "src", baseUrl: "http://src", token: "t" },
        { id: "tgt", baseUrl: "http://tgt", token: "t" },
      ]);

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

      const cloneSpy = jest.spyOn(svc, "cloneDhcpScope").mockResolvedValue({
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
});
