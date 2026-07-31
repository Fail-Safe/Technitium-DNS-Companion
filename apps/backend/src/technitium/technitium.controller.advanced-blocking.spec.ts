import { TechnitiumController } from "./technitium.controller";
import type { AdvancedBlockingService } from "./advanced-blocking.service";
import type { DnsFilteringSnapshotService } from "./dns-filtering-snapshot.service";
import type { QueryLogSqliteService } from "./query-log-sqlite.service";
import type { TechnitiumService } from "./technitium.service";

describe("TechnitiumController Advanced Blocking writes", () => {
  it("routes a secondary request to the primary with the primary raw revision", async () => {
    const resolveClusterWriteTargets = jest.fn().mockResolvedValue({
      perCandidate: new Map([
        [
          "secondary",
          {
            writeTarget: "primary",
            flushNodes: ["primary", "secondary"],
          },
        ],
      ]),
    });
    const setConfig = jest.fn().mockResolvedValue({
      nodeId: "primary",
      baseUrl: "https://primary.example.test",
      fetchedAt: "2026-07-30T00:00:00.000Z",
      metrics: {},
    });
    const saveSnapshot = jest.fn().mockResolvedValue({});
    const controller = new TechnitiumController(
      {
        resolveClusterWriteTargets,
        executeAction: jest.fn(),
      } as unknown as TechnitiumService,
      {} as QueryLogSqliteService,
      { setConfig } as unknown as AdvancedBlockingService,
      { saveSnapshot } as unknown as DnsFilteringSnapshotService,
    );
    const config = {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
    };
    const commentMutations = [
      {
        action: "add" as const,
        groupName: "default",
        field: "blocked" as const,
        value: "ads.example",
        occurrence: 0,
        text: "cluster rationale",
        style: "line" as const,
      },
    ];

    await controller.updateAdvancedBlocking("secondary", {
      config,
      configNodeId: "primary",
      configRevision: "primary-revision",
      commentMutations,
    });

    expect(resolveClusterWriteTargets).toHaveBeenCalledWith(["secondary"]);
    expect(saveSnapshot).toHaveBeenCalledWith(
      "primary",
      "advanced-blocking",
      "automatic",
      "Automatic snapshot before Advanced Blocking config save",
    );
    expect(setConfig).toHaveBeenCalledWith(
      "primary",
      config,
      "primary-revision",
      commentMutations,
    );
  });
});
