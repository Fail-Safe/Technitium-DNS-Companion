import { type INestApplication } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type App } from "supertest/types";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { enableSecureProxyForE2e } from "./e2e-auth";

const runCompatibilityTests = process.env.RUN_TECHNITIUM_V15_TESTS === "true";
const describeCompatibility = runCompatibilityTests ? describe : describe.skip;

describeCompatibility("Technitium DNS v15 compatibility", () => {
  let app: INestApplication<App>;
  let sessionCookie: string;
  let tempDir: string | undefined;

  const baseUrl = process.env.TECHNITIUM_TEST_BASE_URL;
  const expectedVersion = process.env.TECHNITIUM_TEST_EXPECTED_VERSION;
  const username = process.env.TECHNITIUM_TEST_USERNAME;
  const password = process.env.TECHNITIUM_TEST_PASSWORD;

  beforeAll(async () => {
    if (!baseUrl || !expectedVersion || !username || !password) {
      throw new Error(
        "TECHNITIUM_TEST_BASE_URL, TECHNITIUM_TEST_EXPECTED_VERSION, " +
          "TECHNITIUM_TEST_USERNAME, and TECHNITIUM_TEST_PASSWORD are required.",
      );
    }

    process.env.ALLOW_TECHNITIUM_HTTP_IN_TESTS = "true";
    process.env.TRUST_PROXY = "true";
    tempDir = mkdtempSync(join(tmpdir(), "tdc-v15-compatibility-"));
    process.env.COMPANION_DB_PATH = join(tempDir, "companion.sqlite");
    process.env.TECHNITIUM_NODES = "compatibility";
    process.env.TECHNITIUM_COMPATIBILITY_NAME = "Compatibility Node";
    process.env.TECHNITIUM_COMPATIBILITY_BASE_URL = baseUrl;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    enableSecureProxyForE2e(app);
    await app.init();

    const loginResponse = await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("X-Forwarded-Proto", "https")
      .send({ username, password })
      .expect(201);

    const cookies = loginResponse.headers["set-cookie"] as string[] | undefined;
    const cookie = cookies?.[0]?.split(";", 1)[0];
    if (!cookie) {
      throw new Error("Companion login did not return a session cookie.");
    }
    sessionCookie = cookie;
  });

  afterAll(async () => {
    await app?.close();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function authenticatedGet(path: string) {
    return request(app.getHttpServer())
      .get(path)
      .set("X-Forwarded-Proto", "https")
      .set("Cookie", sessionCookie);
  }

  it("establishes a Companion session with the Technitium login token", async () => {
    const response = await authenticatedGet("/api/auth/me").expect(200);

    expect(response.body).toMatchObject({
      authenticated: true,
      nodeIds: ["compatibility"],
    });
  });

  it("reads the v15 status endpoint", async () => {
    const response = await authenticatedGet(
      "/api/nodes/compatibility/status",
    ).expect(200);

    expect(response.body.nodeId).toBe("compatibility");
    expect(response.body.data.status).toBe("ok");
  });

  it("reads settings-backed version data through the node overview", async () => {
    const response = await authenticatedGet(
      "/api/nodes/compatibility/overview",
    ).expect(200);

    expect(response.body.version).toBe(expectedVersion?.replace(/\.0$/, ""));
  });

  it("lists authoritative zones", async () => {
    const response = await authenticatedGet(
      "/api/nodes/compatibility/zones",
    ).expect(200);

    expect(response.body.nodeId).toBe("compatibility");
    expect(response.body.data.zones).toEqual(expect.any(Array));
  });

  it("discovers an unclustered v15 node as standalone", async () => {
    const response = await authenticatedGet(
      "/api/nodes/compatibility/cluster/state",
    ).expect(200);

    expect(response.body).toMatchObject({
      initialized: false,
      type: "Standalone",
    });
    expect(response.body.health).not.toBe("Unreachable");
  });
});
