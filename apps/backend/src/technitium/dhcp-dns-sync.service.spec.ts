import { BadRequestException } from "@nestjs/common";
import { DhcpDnsSyncStateService } from "./dhcp-dns-sync-state.service";
import { DhcpDnsSyncService } from "./dhcp-dns-sync.service";
import { TechnitiumService } from "./technitium.service";
import type {
  TechnitiumDhcpLease,
  TechnitiumDhcpScope,
  TechnitiumNodeSummary,
  TechnitiumZoneRecord,
  TechnitiumZoneSummary,
} from "./technitium.types";

type TechnitiumServiceMock = jest.Mocked<
  Pick<
    TechnitiumService,
    | "listNodes"
    | "listZones"
    | "getDhcpScope"
    | "listDhcpLeases"
    | "getZoneRecords"
    | "createZoneSnapshot"
    | "executeAction"
  >
>;

type StateServiceMock = jest.Mocked<
  Pick<DhcpDnsSyncStateService, "listSeenLeases" | "markSeen" | "removeSeen">
>;

describe("DhcpDnsSyncService", () => {
  let technitiumService: TechnitiumServiceMock;
  let stateService: StateServiceMock;
  let service: DhcpDnsSyncService;

  beforeEach(() => {
    technitiumService = {
      listNodes: jest.fn(),
      listZones: jest.fn(),
      getDhcpScope: jest.fn(),
      listDhcpLeases: jest.fn(),
      getZoneRecords: jest.fn(),
      createZoneSnapshot: jest.fn(),
      executeAction: jest.fn(),
    };

    stateService = {
      listSeenLeases: jest.fn().mockReturnValue([]),
      markSeen: jest.fn(),
      removeSeen: jest.fn(),
    };

    service = new DhcpDnsSyncService(
      technitiumService as unknown as TechnitiumService,
      stateService as unknown as DhcpDnsSyncStateService,
    );

    technitiumService.listNodes.mockResolvedValue([
      {
        id: "primary-node",
        name: "Primary Node",
        isPrimary: true,
      } as TechnitiumNodeSummary,
      {
        id: "dhcp-node",
        name: "DHCP Node",
        isPrimary: false,
      } as TechnitiumNodeSummary,
    ]);
    technitiumService.listZones.mockResolvedValue({
      nodeId: "primary-node",
      fetchedAt: "2026-06-27T00:00:00.000Z",
      data: {
        zones: [
          { name: "example.test", type: "Primary" } as TechnitiumZoneSummary,
          {
            name: "2.0.192.in-addr.arpa",
            type: "Primary",
          } as TechnitiumZoneSummary,
        ],
      },
    });
    technitiumService.getZoneRecords.mockImplementation((_, zoneName) =>
      Promise.resolve({
        nodeId: "primary-node",
        fetchedAt: "2026-06-27T00:00:00.000Z",
        data: {
          zone: { name: zoneName } as TechnitiumZoneSummary,
          records: [],
        },
      }),
    );
    technitiumService.getDhcpScope.mockResolvedValue({
      nodeId: "dhcp-node",
      fetchedAt: "2026-06-27T00:00:00.000Z",
      data: dhcpScope({ dnsUpdates: false }),
    });
    technitiumService.listDhcpLeases.mockResolvedValue({
      nodeId: "dhcp-node",
      fetchedAt: "2026-06-27T00:00:00.000Z",
      data: { leases: [dhcpLease()] },
    });
    technitiumService.createZoneSnapshot.mockResolvedValue({
      id: "snapshot-1",
      nodeId: "primary-node",
      createdAt: "2026-06-27T00:00:00.000Z",
      zoneCount: 2,
      origin: "automatic",
    });
    technitiumService.executeAction.mockResolvedValue({});
  });

  it("reports a hard issue when a selected DHCP scope still has native DNS updates enabled", async () => {
    technitiumService.getDhcpScope.mockResolvedValue({
      nodeId: "dhcp-node",
      fetchedAt: "2026-06-27T00:00:00.000Z",
      data: dhcpScope({ dnsUpdates: true }),
    });

    const result = await service.preview({
      sourceScopes: [{ nodeId: "dhcp-node", scopeName: "Lab" }],
    });

    const issue = result.scopeIssues.find(
      (entry) =>
        entry.severity === "error" && entry.message.includes("dnsUpdates"),
    );
    expect(issue).toBeDefined();
    await expect(
      service.apply({
        sourceScopes: [{ nodeId: "dhcp-node", scopeName: "Lab" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("plans forward and reverse records for DHCP leases on selected scopes", async () => {
    const result = await service.preview({
      sourceScopes: [{ nodeId: "dhcp-node", scopeName: "Lab" }],
    });

    expect(result.targetNodeId).toBe("primary-node");
    expect(result.plannedRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "forward",
          status: "create-record",
          zoneName: "example.test",
          recordName: "dhcp-client",
          recordType: "A",
          desiredValue: "192.0.2.102",
        }),
        expect.objectContaining({
          kind: "reverse",
          status: "create-record",
          zoneName: "2.0.192.in-addr.arpa",
          recordName: "102",
          recordType: "PTR",
          desiredValue: "dhcp-client.example.test.",
        }),
      ]),
    );
  });

  it("ignores expired dynamic leases when building desired records", async () => {
    technitiumService.listDhcpLeases.mockResolvedValue({
      nodeId: "dhcp-node",
      fetchedAt: "2026-06-27T00:00:00.000Z",
      data: {
        leases: [dhcpLease({ leaseExpires: "2000-01-01T00:00:00.000Z" })],
      },
    });

    const result = await service.preview({
      sourceScopes: [{ nodeId: "dhcp-node", scopeName: "Lab" }],
    });

    expect(result.summary.createRecords).toBe(0);
    expect(result.plannedRecords).toEqual([]);
  });

  it("does not overwrite an existing unowned record with a different value", async () => {
    technitiumService.getZoneRecords.mockImplementation((_, zoneName) =>
      Promise.resolve({
        nodeId: "primary-node",
        fetchedAt: "2026-06-27T00:00:00.000Z",
        data: {
          zone: { name: zoneName } as TechnitiumZoneSummary,
          records:
            zoneName === "example.test"
              ? [
                  {
                    name: "dhcp-client.example.test",
                    type: "A",
                    rData: { ipAddress: "192.0.2.200" },
                  } as TechnitiumZoneRecord,
                ]
              : [],
        },
      }),
    );

    const result = await service.preview({
      sourceScopes: [{ nodeId: "dhcp-node", scopeName: "Lab" }],
    });

    expect(result.plannedRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "forward",
          status: "conflict",
          currentValue: "192.0.2.200",
          desiredValue: "192.0.2.102",
        }),
      ]),
    );
  });

  it("applies create actions and marks current leases as seen", async () => {
    const result = await service.apply({
      sourceScopes: [{ nodeId: "dhcp-node", scopeName: "Lab" }],
    });

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "create-record",
          recordType: "A",
          ok: true,
        }),
        expect.objectContaining({
          status: "create-record",
          recordType: "PTR",
          ok: true,
        }),
      ]),
    );
    expect(technitiumService.createZoneSnapshot).toHaveBeenCalledWith(
      "primary-node",
      expect.arrayContaining(["example.test", "2.0.192.in-addr.arpa"]),
      "automatic",
      "Automatic snapshot before DHCP DNS Sync apply",
    );
    const createAddressCall = technitiumService.executeAction.mock.calls.find(
      ([nodeId, payload]) =>
        nodeId === "primary-node" &&
        payload.url === "/api/zones/records/add" &&
        payload.params?.zone === "example.test" &&
        payload.params?.type === "A",
    );
    expect(createAddressCall?.[1].params).toMatchObject({
      domain: "dhcp-client.example.test",
      zone: "example.test",
      type: "A",
      ipAddress: "192.0.2.102",
    });
    expect(stateService.markSeen).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          sourceNodeId: "dhcp-node",
          scopeName: "Lab",
          ip: "192.0.2.102",
          hostname: "dhcp-client",
          forwardZoneName: "example.test",
        }),
      ],
      expect.any(String),
    );
  });
});

function dhcpScope(
  overrides?: Partial<TechnitiumDhcpScope>,
): TechnitiumDhcpScope {
  return {
    name: "Lab",
    startingAddress: "192.0.2.100",
    endingAddress: "192.0.2.200",
    subnetMask: "255.255.255.0",
    domainName: "example.test",
    dnsUpdates: false,
    ...overrides,
  };
}

function dhcpLease(
  overrides?: Partial<TechnitiumDhcpLease>,
): TechnitiumDhcpLease {
  return {
    scope: "Lab",
    type: "Dynamic",
    hardwareAddress: "02-00-00-00-00-95",
    address: "192.0.2.102",
    hostName: "dhcp-client",
    leaseObtained: "2026-06-27T00:15:56.000Z",
    leaseExpires: "2099-06-28T00:15:56.000Z",
    ...overrides,
  };
}
