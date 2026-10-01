import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import os from "os";
import { join } from "path";
import type { Response as SupertestResponse } from "supertest";
import request from "supertest";
import { App } from "supertest/types";

import { AdvancedBlockingPauseStateService } from "../src/technitium/advanced-blocking-pause-state.service";
import { DnsFilteringSnapshotService } from "../src/technitium/dns-filtering-snapshot.service";
import { TechnitiumService } from "../src/technitium/technitium.service";
import { AppModule } from "./../src/app.module";
import {
  createE2eSessionCookie,
  enableSecureProxyForE2e,
  withE2eAuth,
} from "./e2e-auth";

describe("Advanced Blocking save/get round-trip (e2e)", () => {
  let app: INestApplication<App>;
  let sessionCookie: string;
  let storedConfigByNode: Map<string, string | null>;

  const getBlockingAnswerTtl = (res: SupertestResponse): unknown => {
    const body = res.body as unknown;
    if (typeof body !== "object" || body === null) return undefined;
    const config = (body as Record<string, unknown>)["config"];
    if (typeof config !== "object" || config === null) return undefined;
    return (config as Record<string, unknown>)["blockingAnswerTtl"];
  };

  beforeEach(async () => {
    process.env.CACHE_DIR =
      process.env.CACHE_DIR || join(os.tmpdir(), "tdc-cache-test");

    // Successful edits start from an installed app's readable configuration.
    storedConfigByNode = new Map([
      [
        "node1",
        JSON.stringify({
          enableBlocking: true,
          blockingAnswerTtl: 60,
          localEndPointGroupMap: {},
          networkGroupMap: {},
          groups: [],
        }),
      ],
    ]);

    type ExecuteActionRequest = {
      url?: unknown;
      method?: unknown;
      body?: unknown;
    };
    const toExecuteActionRequest = (value: unknown): ExecuteActionRequest => {
      if (typeof value === "object" && value !== null) {
        return value as ExecuteActionRequest;
      }
      return {};
    };

    const technitiumService = {
      listNodes: jest.fn().mockResolvedValue([
        {
          id: "node1",
          baseUrl: "http://example.invalid",
          name: "node1",
          isPrimary: true,
          cluster: { type: "Standalone", health: "healthy" },
        },
      ]),
      resolveClusterWriteTargets: jest.fn().mockResolvedValue({
        perCandidate: new Map([
          [
            "node1",
            {
              writeTarget: "node1",
              flushNodes: ["node1"],
            },
          ],
        ]),
      }),
      executeAction: jest
        .fn()
        .mockImplementation((_nodeId: string, action: unknown) => {
          const req = toExecuteActionRequest(action);
          const url = typeof req.url === "string" ? req.url : "";
          const method = typeof req.method === "string" ? req.method : "";

          if (url === "/api/apps/config/get" && method === "GET") {
            const config = storedConfigByNode.get(_nodeId) ?? null;
            return { status: "ok", response: { config } };
          }

          if (url === "/api/apps/config/set" && method === "POST") {
            const body = typeof req.body === "string" ? req.body : "";
            const params = new URLSearchParams(body);
            const config = params.get("config");
            storedConfigByNode.set(_nodeId, config);
            return { status: "ok", response: {} };
          }

          throw new Error(
            `Unexpected TechnitiumService.executeAction call: ${method || "?"} ${url || "?"}`,
          );
        }),
    } as unknown as TechnitiumService;

    const dnsFilteringSnapshotService = {
      saveSnapshot: jest.fn().mockResolvedValue({}),
    } as unknown as DnsFilteringSnapshotService;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TechnitiumService)
      .useValue(technitiumService)
      .overrideProvider(DnsFilteringSnapshotService)
      .useValue(dnsFilteringSnapshotService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    enableSecureProxyForE2e(app);
    await app.init();
    sessionCookie = createE2eSessionCookie(app, { node1: "test-token" });
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    "Cluster topology is unavailable, so a current Primary could not be validated.",
    "The standalone node is not admitted for configuration writes.",
  ])("reports schedule admission failure as HTTP 503: %s", async (reason) => {
    const tech = app.get(TechnitiumService);
    jest
      .mocked(tech.resolveClusterWriteTargets)
      .mockImplementation((_ids, _summaries, options) =>
        Promise.resolve({
          perCandidate: new Map([
            [
              "node1",
              options?.authMode === "schedule"
                ? { flushNodes: [], reason }
                : { writeTarget: "node1", flushNodes: ["node1"] },
            ],
          ]),
          writeTargets: options?.authMode === "schedule" ? [] : ["node1"],
        }),
      );
    const original = storedConfigByNode.get("node1");

    await withE2eAuth(
      request(app.getHttpServer()).post("/api/advanced-blocking/pause"),
      sessionCookie,
    )
      .send({ minutes: 5 })
      .expect(503)
      .expect((res: SupertestResponse) => {
        expect(res.body).toMatchObject({
          statusCode: 503,
          message: expect.stringContaining(reason),
        });
        expect(res.body).toMatchObject({
          message: expect.stringContaining("TECHNITIUM_SCHEDULE_TOKEN"),
        });
        expect(res.body).toMatchObject({
          message: expect.stringContaining("Apps: Modify"),
        });
      });

    expect(
      jest
        .mocked(tech.executeAction)
        .mock.calls.filter(
          ([, action]) => action.url === "/api/apps/config/set",
        ),
    ).toHaveLength(0);
    expect(storedConfigByNode.get("node1")).toBe(original);
    expect(app.get(AdvancedBlockingPauseStateService).list()).toEqual([]);
  });

  it.each([null, ""])(
    "refuses to save when the remote config is %p without writing",
    async (remoteConfig) => {
      storedConfigByNode.set("node1", remoteConfig);

      await withE2eAuth(
        request(app.getHttpServer()).post("/api/nodes/node1/advanced-blocking"),
        sessionCookie,
      )
        .send({
          config: {
            enableBlocking: true,
            blockingAnswerTtl: 123,
            localEndPointGroupMap: {},
            networkGroupMap: {},
            groups: [],
          },
        })
        .expect((res: SupertestResponse) => {
          expect(res.status).toBeGreaterThanOrEqual(400);
        });

      const executeAction = jest.mocked(
        app.get(TechnitiumService).executeAction,
      );
      expect(
        executeAction.mock.calls.filter(
          ([, action]) => action.url === "/api/apps/config/set",
        ),
      ).toHaveLength(0);
      expect(storedConfigByNode.get("node1")).toBe(remoteConfig);
    },
  );

  it("preserves blockingAnswerTtl across save -> fetch", async () => {
    const config = {
      enableBlocking: true,
      blockingAnswerTtl: 123,
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
    };

    await withE2eAuth(
      request(app.getHttpServer()).post("/api/nodes/node1/advanced-blocking"),
      sessionCookie,
    )
      .send({ config, snapshotNote: "test" })
      .expect(201)
      .expect((res: SupertestResponse) => {
        expect(getBlockingAnswerTtl(res)).toBe(123);
      });

    await withE2eAuth(
      request(app.getHttpServer()).get("/api/nodes/node1/advanced-blocking"),
      sessionCookie,
    )
      .expect(200)
      .expect((res: SupertestResponse) => {
        expect(getBlockingAnswerTtl(res)).toBe(123);
      });
  });

  it("normalizes blockingAnswerTtl when provided as a numeric string", async () => {
    const config = {
      enableBlocking: true,
      blockingAnswerTtl: "456",
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
    };

    await withE2eAuth(
      request(app.getHttpServer()).post("/api/nodes/node1/advanced-blocking"),
      sessionCookie,
    )
      .send({ config, snapshotNote: "test" })
      .expect(201)
      .expect((res: SupertestResponse) => {
        expect(getBlockingAnswerTtl(res)).toBe(456);
      });

    await withE2eAuth(
      request(app.getHttpServer()).get("/api/nodes/node1/advanced-blocking"),
      sessionCookie,
    )
      .expect(200)
      .expect((res: SupertestResponse) => {
        expect(getBlockingAnswerTtl(res)).toBe(456);
      });
  });
});
