import { describe, expect, it } from "vitest";
import {
  resolveAdvancedBlockingWriteNodeId,
  selectAdvancedBlockingWriteSnapshots,
} from "../utils/advanced-blocking-routing";

describe("Advanced Blocking write routing", () => {
  it("routes a secondary query to the primary node", () => {
    const nodes = [
      { id: "eq10", isPrimary: true },
      { id: "eq14", isPrimary: false },
    ];

    expect(resolveAdvancedBlockingWriteNodeId(nodes, "eq14")).toBe("eq10");
  });

  it("keeps the source node as the target outside a cluster", () => {
    expect(
      resolveAdvancedBlockingWriteNodeId(
        [{ id: "dns-a" }, { id: "dns-b" }],
        "dns-b",
      ),
    ).toBe("dns-b");
  });

  it("limits bulk writes to the primary in a cluster", () => {
    const snapshots = [{ nodeId: "eq10" }, { nodeId: "eq14" }];

    expect(
      selectAdvancedBlockingWriteSnapshots(
        [
          { id: "eq10", isPrimary: true },
          { id: "eq14", isPrimary: false },
        ],
        snapshots,
      ),
    ).toEqual([{ nodeId: "eq10" }]);
  });

  it("keeps all bulk targets for standalone nodes", () => {
    const snapshots = [{ nodeId: "dns-a" }, { nodeId: "dns-b" }];

    expect(
      selectAdvancedBlockingWriteSnapshots(
        [{ id: "dns-a" }, { id: "dns-b" }],
        snapshots,
      ),
    ).toEqual(snapshots);
  });
});
