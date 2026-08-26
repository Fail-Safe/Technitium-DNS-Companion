import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "./../src/app.module";
import { join } from "path";
import os from "os";

describe("AppController (e2e)", () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    process.env.CACHE_DIR =
      process.env.CACHE_DIR || join(os.tmpdir(), "tdc-cache-test");

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it("/health (GET)", () => {
    return request(app.getHttpServer())
      .get("/api/health")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          status: "ok",
        });
        expect(typeof (res.body as { timestamp?: unknown }).timestamp).toBe(
          "string",
        );
        expect(typeof (res.body as { uptime?: unknown }).uptime).toBe(
          "number",
        );
      });
  });

  it("does not establish a session from forwarded proto and identity headers alone", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .get("/api/auth/me")
      .set("X-Forwarded-Proto", "https")
      .set("X-Forwarded-User", "alice@example.test")
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({ authenticated: false });
        expect(res.headers["set-cookie"]).toBeUndefined();
      });

  });
});
