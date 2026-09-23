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

  it("routes a secondary only to the primary in its group", () => {
    const nodes = [
      { id: "site-a-primary", groupId: "site-a", isPrimary: true },
      { id: "site-a-secondary", groupId: "site-a", isPrimary: false },
      { id: "site-b-primary", groupId: "site-b", isPrimary: true },
      { id: "site-b-secondary", groupId: "site-b", isPrimary: false },
    ];

    expect(
      resolveAdvancedBlockingWriteNodeId(nodes, "site-b-secondary"),
    ).toBe("site-b-primary");
  });

  it("keeps an unknown source instead of guessing a group", () => {
    expect(
      resolveAdvancedBlockingWriteNodeId(
        [{ id: "site-a-primary", groupId: "site-a", isPrimary: true }],
        "unknown-node",
      ),
    ).toBe("unknown-node");
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

  it("keeps one primary target per group for bulk writes", () => {
    const snapshots = [
      { nodeId: "site-a-primary" },
      { nodeId: "site-a-secondary" },
      { nodeId: "site-b-primary" },
      { nodeId: "site-b-secondary" },
      { nodeId: "standalone" },
    ];

    expect(
      selectAdvancedBlockingWriteSnapshots(
        [
          { id: "site-a-primary", groupId: "site-a", isPrimary: true },
          { id: "site-a-secondary", groupId: "site-a", isPrimary: false },
          { id: "site-b-primary", groupId: "site-b", isPrimary: true },
          { id: "site-b-secondary", groupId: "site-b", isPrimary: false },
          { id: "standalone", groupId: "standalone" },
        ],
        snapshots,
      ),
    ).toEqual([
      { nodeId: "site-a-primary" },
      { nodeId: "site-b-primary" },
      { nodeId: "standalone" },
    ]);
  });
});
