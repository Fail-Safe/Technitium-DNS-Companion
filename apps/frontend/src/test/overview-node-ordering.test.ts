import { describe, expect, it } from "vitest";
import type { TechnitiumNode } from "../context/TechnitiumContext";
import { sortOverviewNodes } from "../utils/overviewNodeOrdering";

function node(overrides: Partial<TechnitiumNode>): TechnitiumNode {
  return {
    id: overrides.id ?? "node",
    name: overrides.name ?? overrides.id ?? "Node",
    baseUrl: "https://node.example.com",
    status: "online",
    lastSync: "2026-06-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("sortOverviewNodes", () => {
  it("keeps the primary node at the top of the overview list", () => {
    const ordered = sortOverviewNodes([
      node({ id: "secondary-b", name: "Secondary B", isPrimary: false }),
      node({ id: "secondary-a", name: "Secondary A", isPrimary: false }),
      node({ id: "primary", name: "Primary", isPrimary: true }),
    ]);

    expect(ordered.map((item) => item.id)).toEqual([
      "primary",
      "secondary-a",
      "secondary-b",
    ]);
  });
});
