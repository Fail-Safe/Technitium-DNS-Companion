import { AdvancedBlockingService } from "./advanced-blocking.service";
import {
  calculateAdvancedBlockingConfigRevision,
  parseAdvancedBlockingJsonc,
} from "./advanced-blocking-jsonc";
import type {
  AdvancedBlockingConfig,
  AdvancedBlockingGroup,
} from "./advanced-blocking.types";
import type { TechnitiumService } from "./technitium.service";

describe("AdvancedBlockingService.serializeConfig", () => {
  const createService = () => {
    const technitiumService = {} as unknown as TechnitiumService;
    return new AdvancedBlockingService(technitiumService);
  };

  const callSerialize = (
    service: AdvancedBlockingService,
    config: AdvancedBlockingConfig,
  ) => {
    type PrivateApi = {
      serializeConfig: (cfg: AdvancedBlockingConfig) => Record<string, unknown>;
    };
    const api = service as unknown as Partial<PrivateApi>;
    if (typeof api.serializeConfig !== "function") {
      throw new Error("serializeConfig is not available on service");
    }

    return api.serializeConfig(config);
  };

  it("includes blockingAnswerTtl when defined", () => {
    const service = createService();

    const payload = callSerialize(service, {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
      blockingAnswerTtl: 60,
    });

    expect(payload["blockingAnswerTtl"]).toBe(60);
  });

  it("coerces blockingAnswerTtl from a numeric string", () => {
    const service = createService();

    const config: AdvancedBlockingConfig & Record<string, unknown> = {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
    };
    // Simulate a client accidentally sending a string.
    config["blockingAnswerTtl"] = "60";

    const payload = callSerialize(service, config);

    expect(payload["blockingAnswerTtl"]).toBe(60);
  });

  it("preserves blockingAnswerTtl=0 (valid value)", () => {
    const service = createService();

    const payload = callSerialize(service, {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
      blockingAnswerTtl: 0,
    });

    expect(payload["blockingAnswerTtl"]).toBe(0);
  });

  it("omits blockingAnswerTtl when undefined", () => {
    const service = createService();

    const payload = callSerialize(service, {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
    });

    expect(
      Object.prototype.hasOwnProperty.call(payload, "blockingAnswerTtl"),
    ).toBe(false);
  });
});

describe("AdvancedBlockingService JSONC integration", () => {
  const createGroup = (
    overrides: Partial<AdvancedBlockingGroup> = {},
  ): AdvancedBlockingGroup => ({
    name: "default",
    blockingAddresses: [],
    allowed: [],
    blocked: [],
    allowListUrls: [],
    blockListUrls: [],
    allowedRegex: [],
    blockedRegex: [],
    regexAllowListUrls: [],
    regexBlockListUrls: [],
    adblockListUrls: [],
    ...overrides,
  });

  const createHarness = (initialRaw: string) => {
    let storedRaw = initialRaw;
    const executeAction = jest.fn(
      (
        _nodeId: string,
        request: { method: string; url: string; body?: string },
      ) => {
        if (
          request.method === "GET" &&
          request.url === "/api/apps/config/get"
        ) {
          return Promise.resolve({
            status: "ok",
            response: { config: storedRaw },
          });
        }
        if (
          request.method === "POST" &&
          request.url === "/api/apps/config/set"
        ) {
          const body = new URLSearchParams(request.body);
          storedRaw = body.get("config") ?? "";
          return Promise.resolve({ status: "ok" });
        }
        throw new Error(`Unexpected request: ${request.method} ${request.url}`);
      },
    );
    const listNodes = jest.fn(() =>
      Promise.resolve([
        {
          id: "node-a",
          name: "Node A",
          baseUrl: "https://node-a.example.test",
        },
      ]),
    );
    const technitiumService = {
      executeAction,
      listNodes,
    } as unknown as TechnitiumService;
    const service = new AdvancedBlockingService(technitiumService);

    return {
      service,
      executeAction,
      getStoredRaw: () => storedRaw,
    };
  };

  const rawConfig = `{
  // globally disabled during migration
  "enableBlocking": false,
  "futureRootSetting": "retain",
  "localEndPointGroupMap": {},
  "networkGroupMap": {},
  "groups": [{
    "name": "default",
    "blockingAddresses": [],
    "allowed": [],
    "blocked": [
      // business-required exception
      "old.example"
    ],
    "allowListUrls": [],
    "blockListUrls": [],
    "allowedRegex": [],
    "blockedRegex": [],
    "regexAllowListUrls": [],
    "regexBlockListUrls": [],
    "adblockListUrls": []
  }]
}`;

  it("loads commented Technitium configs and returns an exact revision", async () => {
    const { service } = createHarness(rawConfig);

    const snapshot = await service.getSnapshot("node-a");

    expect(snapshot.error).toBeUndefined();
    expect(snapshot.config?.enableBlocking).toBe(false);
    expect(snapshot.config?.groups[0].blocked).toEqual(["old.example"]);
    expect(snapshot.configRevision).toBe(
      calculateAdvancedBlockingConfigRevision(rawConfig),
    );
  });

  it("functionally saves a leaf change while preserving comments and unknown fields", async () => {
    const { service, getStoredRaw } = createHarness(rawConfig);
    const snapshot = await service.getSnapshot("node-a");
    const desired: AdvancedBlockingConfig = {
      ...snapshot.config!,
      enableBlocking: true,
      groups: [
        {
          ...snapshot.config!.groups[0],
          allowed: ["new.example"],
        },
      ],
    };

    await service.setConfig("node-a", desired, snapshot.configRevision);

    const saved = getStoredRaw();
    expect(saved).toContain("// globally disabled during migration");
    expect(saved).toContain("// business-required exception");
    expect(saved).toContain('"futureRootSetting": "retain"');
    expect(saved).toContain('"enableBlocking": true');
    expect(parseAdvancedBlockingJsonc(saved)).toMatchObject({
      groups: [{ allowed: ["new.example"], blocked: ["old.example"] }],
    });
  });

  it("writes staged config and comment changes atomically in one request", async () => {
    const { service, executeAction, getStoredRaw } = createHarness(rawConfig);
    const snapshot = await service.getSnapshot("node-a");
    const desired: AdvancedBlockingConfig = {
      ...snapshot.config!,
      groups: [
        {
          ...snapshot.config!.groups[0],
          blocked: ["old.example", "new.example"],
        },
      ],
    };

    await service.setConfig("node-a", desired, snapshot.configRevision, [
      {
        action: "add",
        groupName: "default",
        field: "blocked",
        value: "new.example",
        occurrence: 0,
        text: "new staged rationale",
        style: "line",
      },
    ]);

    expect(getStoredRaw()).toContain("// business-required exception");
    expect(getStoredRaw()).toContain("// new staged rationale");
    expect(
      executeAction.mock.calls.filter(
        ([, request]) => request.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("does not write any config when a staged comment mutation is invalid", async () => {
    const { service, executeAction, getStoredRaw } = createHarness(rawConfig);
    const snapshot = await service.getSnapshot("node-a");

    await expect(
      service.setConfig("node-a", snapshot.config!, snapshot.configRevision, [
        {
          action: "edit",
          commentId: "missing-comment",
          text: "cannot be applied",
        },
      ]),
    ).rejects.toThrow(/changed after it was staged/);

    expect(getStoredRaw()).toBe(rawConfig);
    expect(
      executeAction.mock.calls.filter(
        ([, request]) => request.method === "POST",
      ),
    ).toHaveLength(0);
  });

  it("rejects a stale revision before posting a config", async () => {
    const { service, executeAction, getStoredRaw } = createHarness(rawConfig);

    await expect(
      service.setConfig(
        "node-a",
        {
          enableBlocking: true,
          localEndPointGroupMap: {},
          networkGroupMap: {},
          groups: [createGroup({ blocked: ["old.example"] })],
        },
        "stale-revision",
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(getStoredRaw()).toBe(rawConfig);
    expect(
      executeAction.mock.calls.filter(
        ([, request]) => request.method === "POST",
      ),
    ).toHaveLength(0);
  });

  it("returns raw JSONC with domain comment metadata", async () => {
    const { service } = createHarness(rawConfig);

    const raw = await service.getRawConfig("node-a");

    expect(raw.rawConfig).toBe(rawConfig);
    expect(raw.configRevision).toBe(
      calculateAdvancedBlockingConfigRevision(rawConfig),
    );
    expect(raw.domainComments).toEqual([
      expect.objectContaining({
        groupName: "default",
        field: "blocked",
        value: "old.example",
        text: "business-required exception",
      }),
    ]);
  });

  it("functionally edits a domain comment through the raw Technitium config", async () => {
    const { service, getStoredRaw } = createHarness(rawConfig);
    const current = await service.getRawConfig("node-a");
    const comment = current.domainComments[0];

    const updated = await service.mutateDomainComment("node-a", {
      action: "edit",
      configRevision: current.configRevision,
      commentId: comment.id,
      text: "updated business rationale",
    });

    expect(getStoredRaw()).toContain("// updated business rationale");
    expect(getStoredRaw()).toContain("// globally disabled during migration");
    expect(updated.domainComments[0].text).toBe("updated business rationale");
  });

  it("saves exact raw JSONC and rejects malformed documents", async () => {
    const { service, getStoredRaw } = createHarness(rawConfig);
    const current = await service.getRawConfig("node-a");
    const editedRaw = rawConfig.replace(
      "// globally disabled during migration",
      "/* changed deliberately in the raw editor */",
    );

    await service.setRawConfig("node-a", editedRaw, current.configRevision);
    expect(getStoredRaw()).toBe(editedRaw);

    await expect(
      service.setRawConfig(
        "node-a",
        '{"groups": [}',
        calculateAdvancedBlockingConfigRevision(editedRaw),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(getStoredRaw()).toBe(editedRaw);
  });
});
