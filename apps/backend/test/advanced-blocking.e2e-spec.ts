import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import os from "os";
import { join } from "path";
import type { Response as SupertestResponse } from "supertest";
import request from "supertest";
import { App } from "supertest/types";

import { DnsFilteringSnapshotService } from "../src/technitium/dns-filtering-snapshot.service";
import { TechnitiumService } from "../src/technitium/technitium.service";
import { AppModule } from "./../src/app.module";

describe("Advanced Blocking save/get round-trip (e2e)", () => {
  let app: INestApplication<App>;

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

    const storedConfigByNode = new Map<string, string | null>();

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
      listNodes: jest
        .fn()
        .mockResolvedValue([
          {
            id: "node1",
            baseUrl: "http://example.invalid",
            name: "node1",
            isPrimary: true,
            cluster: { type: "Standalone", health: "healthy" },
          },
        ]),
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
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("preserves blockingAnswerTtl across save -> fetch", async () => {
    const config = {
      enableBlocking: true,
      blockingAnswerTtl: 123,
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
    };

    await request(app.getHttpServer())
      .post("/api/nodes/node1/advanced-blocking")
      .send({ config, snapshotNote: "test" })
      .expect(201)
      .expect((res: SupertestResponse) => {
        expect(getBlockingAnswerTtl(res)).toBe(123);
      });

    await request(app.getHttpServer())
      .get("/api/nodes/node1/advanced-blocking")
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

    await request(app.getHttpServer())
      .post("/api/nodes/node1/advanced-blocking")
      .send({ config, snapshotNote: "test" })
      .expect(201)
      .expect((res: SupertestResponse) => {
        expect(getBlockingAnswerTtl(res)).toBe(456);
      });

    await request(app.getHttpServer())
      .get("/api/nodes/node1/advanced-blocking")
      .expect(200)
      .expect((res: SupertestResponse) => {
        expect(getBlockingAnswerTtl(res)).toBe(456);
      });
  });
});
