import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";

import { AdvancedBlockingPauseService } from "../src/technitium/advanced-blocking-pause.service";
import { AdvancedBlockingService } from "../src/technitium/advanced-blocking.service";
import { AppModule } from "../src/app.module";
import {
  createE2eSessionCookie,
  enableSecureProxyForE2e,
  withE2eAuth,
} from "./e2e-auth";

describe("Advanced Blocking pause routes (e2e)", () => {
  let app: INestApplication<App>;
  let sessionCookie: string;

  beforeEach(async () => {
    const advancedBlockingService = {
      getSnapshot: jest.fn().mockResolvedValue({ route: "node" }),
      getGroupRuleOptimizationSuggestions: jest
        .fn()
        .mockResolvedValue({ route: "optimizer" }),
    } as unknown as AdvancedBlockingService;
    const pauseService = {
      getStatus: jest.fn().mockReturnValue({ route: "pause-status" }),
      pause: jest.fn().mockResolvedValue({ route: "pause" }),
      resumeNow: jest.fn().mockResolvedValue({ route: "resume" }),
    } as unknown as AdvancedBlockingPauseService;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AdvancedBlockingService)
      .useValue(advancedBlockingService)
      .overrideProvider(AdvancedBlockingPauseService)
      .useValue(pauseService)
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

  it("routes pause paths ahead of the generic Advanced Blocking node route", async () => {
    await withE2eAuth(
      request(app.getHttpServer()).get("/api/advanced-blocking/pause"),
      sessionCookie,
    )
      .expect(200)
      .expect({ route: "pause-status" });

    await withE2eAuth(
      request(app.getHttpServer()).post("/api/advanced-blocking/pause"),
      sessionCookie,
    )
      .send({ minutes: 15 })
      .expect(201)
      .expect({ route: "pause" });

    await withE2eAuth(
      request(app.getHttpServer()).post("/api/advanced-blocking/pause/resume"),
      sessionCookie,
    )
      .expect(201)
      .expect({ route: "resume" });

    await withE2eAuth(
      request(app.getHttpServer()).get("/api/advanced-blocking/node1"),
      sessionCookie,
    )
      .expect(200)
      .expect({ route: "node" });

    await withE2eAuth(
      request(app.getHttpServer()).get(
        "/api/advanced-blocking/node1/rule-optimizations/groups/default/suggestions",
      ),
      sessionCookie,
    )
      .expect(200)
      .expect({ route: "optimizer" });
  });
});