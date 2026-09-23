import {
  INTERNAL_DEFAULT_GROUP_ID,
  loadTechnitiumNodeConfigs,
} from "./technitium-config";

describe("Technitium node group configuration", () => {
  const logger = { warn: jest.fn() };

  beforeEach(() => logger.warn.mockClear());

  it("preserves implicit single-cluster behavior in the internal default group", () => {
    const nodes = loadTechnitiumNodeConfigs(
      {
        TECHNITIUM_NODES: "node-a,node-b",
        TECHNITIUM_NODEA_BASE_URL: "https://node-a.example.test",
        TECHNITIUM_NODEB_BASE_URL: "https://node-b.example.test",
      },
      logger,
    );
    expect(nodes.map((node) => node.groupId)).toEqual([
      INTERNAL_DEFAULT_GROUP_ID,
      INTERNAL_DEFAULT_GROUP_ID,
    ]);
  });

  it("accepts explicit lowercase group slugs", () => {
    const nodes = loadTechnitiumNodeConfigs(
      {
        TECHNITIUM_NODES: "node-a,node-b",
        TECHNITIUM_NODEA_BASE_URL: "https://node-a.example.test",
        TECHNITIUM_NODEA_GROUP: "site-a",
        TECHNITIUM_NODEB_BASE_URL: "https://node-b.example.test",
        TECHNITIUM_NODEB_GROUP: "site.b_2",
      },
      logger,
    );
    expect(nodes.map((node) => node.groupId)).toEqual(["site-a", "site.b_2"]);
  });

  it("rejects mixed explicit and implicit grouping", () => {
    expect(() =>
      loadTechnitiumNodeConfigs(
        {
          TECHNITIUM_NODES: "node-a,node-b",
          TECHNITIUM_NODEA_BASE_URL: "https://node-a.example.test",
          TECHNITIUM_NODEA_GROUP: "site-a",
          TECHNITIUM_NODEB_BASE_URL: "https://node-b.example.test",
        },
        logger,
      ),
    ).toThrow(/grouping is mixed/);
  });

  it.each(["Site-A", "-site", "__default__", "", "a".repeat(64)])(
    "rejects malformed or reserved group ID %p",
    (groupId) => {
      expect(() =>
        loadTechnitiumNodeConfigs(
          {
            TECHNITIUM_NODES: "node-a",
            TECHNITIUM_NODEA_BASE_URL: "https://node-a.example.test",
            TECHNITIUM_NODEA_GROUP: groupId,
          },
          logger,
        ),
      ).toThrow(/group IDs must be lowercase slugs/);
    },
  );
});
