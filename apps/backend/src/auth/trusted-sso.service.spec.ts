import {
  HttpStatus,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Request } from "express";
import { TechnitiumService } from "../technitium/technitium.service";
import type { TechnitiumNodeConfig } from "../technitium/technitium.types";
import { AuthSessionService } from "./auth-session.service";
import { TrustedSsoService } from "./trusted-sso.service";

const ORIGINAL_ENV = { ...process.env };
const TEST_DIR = join(tmpdir(), `trusted-sso-${process.pid}`);
const SECRET = "a-secure-test-secret-with-at-least-32-characters";

describe("TrustedSsoService", () => {
  const sessionServices: AuthSessionService[] = [];
  let fileIndex = 0;

  beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.TRUSTED_SSO_ENABLED;
    delete process.env.TRUSTED_SSO_IDENTITY_HEADER;
    delete process.env.TRUSTED_SSO_PROXY_SECRET_HEADER;
    delete process.env.TRUSTED_SSO_PROXY_SECRET;
    delete process.env.TRUSTED_SSO_PROXY_SECRET_FILE;
    delete process.env.TRUSTED_SSO_PROXY_CIDRS;
    delete process.env.TRUSTED_SSO_TOKEN_MAP_FILE;
    delete process.env.TRUSTED_SSO_LOGOUT_URL;
  });

  afterEach(() => {
    for (const service of sessionServices.splice(0)) {
      service.onModuleDestroy();
    }
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  const nodes: TechnitiumNodeConfig[] = [
    {
      id: "nodeA",
      name: "nodeA",
      baseUrl: "https://node-a.example.test",
      token: "",
      queryLoggerAppName: undefined,
      queryLoggerClassPath: undefined,
    },
    {
      id: "nodeB",
      name: "nodeB",
      baseUrl: "https://node-b.example.test",
      token: "",
      queryLoggerAppName: undefined,
      queryLoggerClassPath: undefined,
    },
  ];

  function writeMap(value?: unknown): string {
    const path = join(TEST_DIR, `map-${fileIndex++}.json`);
    writeFileSync(
      path,
      JSON.stringify(
        value ?? {
          version: 1,
          identities: {
            "alice@example.test": {
              username: "alice",
              token: "cluster-token",
            },
          },
        },
      ),
    );
    return path;
  }

  function enable(overrides?: Record<string, string>): void {
    Object.assign(process.env, {
      TRUSTED_SSO_ENABLED: "true",
      TRUSTED_SSO_PROXY_SECRET: SECRET,
      TRUSTED_SSO_TOKEN_MAP_FILE: writeMap(),
      ...overrides,
    });
  }

  function createService(
    validate = jest
      .fn()
      .mockResolvedValueOnce({ username: "alice" })
      .mockResolvedValueOnce({ username: "alice" }),
  ) {
    const sessions = new AuthSessionService();
    sessionServices.push(sessions);
    const technitium = {
      validateExplicitSessionToken: validate,
    } as unknown as TechnitiumService;
    return {
      service: new TrustedSsoService(nodes, technitium, sessions),
      sessions,
      validate,
    };
  }

  function makeRequest(args?: {
    identity?: string;
    secret?: string;
    peer?: string;
    secure?: boolean;
    duplicateIdentity?: boolean;
  }): Request {
    const rawHeaders: string[] = [];
    if (args?.identity !== undefined) {
      rawHeaders.push("X-Forwarded-User", args.identity);
      if (args.duplicateIdentity) {
        rawHeaders.push("X-Forwarded-User", args.identity);
      }
    }
    if (args?.secret !== undefined) {
      rawHeaders.push("X-Trusted-Proxy-Secret", args.secret);
    }
    return {
      secure: args?.secure ?? true,
      rawHeaders,
      headers: {},
      socket: { remoteAddress: args?.peer ?? "127.0.0.1" },
    } as unknown as Request;
  }

  it("leaves disabled deployments unchanged without requiring SSO files", () => {
    process.env.TRUSTED_SSO_IDENTITY_HEADER = "not a header";
    process.env.TRUSTED_SSO_PROXY_SECRET = "too-short";
    const { service } = createService();
    expect(service.classify(makeRequest())).toEqual({ kind: "disabled" });
    expect(service.getStatus(makeRequest())).toEqual({
      enabled: false,
      available: false,
      manualLoginAllowed: true,
    });
  });

  it.each([
    ["short secret", { TRUSTED_SSO_PROXY_SECRET: "too-short" }],
    ["missing token map", { TRUSTED_SSO_TOKEN_MAP_FILE: "" }],
    ["invalid boolean", { TRUSTED_SSO_ENABLED: "yes" }],
    ["invalid CIDR", { TRUSTED_SSO_PROXY_CIDRS: "10.0.0.0/99" }],
    [
      "insecure logout URL",
      { TRUSTED_SSO_LOGOUT_URL: "http://idp.test/logout" },
    ],
  ])("rejects %s at startup", (_label, overrides) => {
    enable(overrides);
    expect(() => createService()).toThrow();
  });

  it("requires one cluster token and rejects legacy per-node mappings", () => {
    enable({
      TRUSTED_SSO_TOKEN_MAP_FILE: writeMap({
        version: 1,
        identities: {
          "alice@example.test": {
            username: "alice",
            tokensByNodeId: { nodeA: "token-a", unknown: "token-x" },
          },
        },
      }),
    });
    expect(() => createService()).toThrow(/invalid schema/);

    enable({
      TRUSTED_SSO_TOKEN_MAP_FILE: writeMap({
        version: 1,
        identities: {
          "alice@example.test": { username: "alice", token: "" },
        },
      }),
    });
    expect(() => createService()).toThrow(/invalid cluster API token/);
  });

  it("rejects duplicate JSON keys in the strict token map", () => {
    const path = join(TEST_DIR, `map-${fileIndex++}.json`);
    writeFileSync(
      path,
      '{"version":1,"version":1,"identities":{"alice@example.test":{"username":"alice","token":"cluster-token"}}}',
    );
    enable({ TRUSTED_SSO_TOKEN_MAP_FILE: path });
    expect(() => createService()).toThrow(/valid JSON/);
  });

  it("accepts the proxy secret from _FILE without exposing it in errors", () => {
    const secretFile = join(TEST_DIR, "proxy-secret");
    writeFileSync(secretFile, SECRET);
    enable({
      TRUSTED_SSO_PROXY_SECRET: "",
      TRUSTED_SSO_PROXY_SECRET_FILE: secretFile,
    });
    const { service } = createService();
    expect(
      service.classify(
        makeRequest({ identity: "alice@example.test", secret: SECRET }),
      ),
    ).toEqual({ kind: "valid", identity: "alice@example.test" });

    process.env.TRUSTED_SSO_LOGOUT_URL = SECRET;
    let message = "";
    try {
      createService();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(SECRET);
  });

  it("validates TLS, CIDRs, one identity header, and the proxy secret", () => {
    enable({ TRUSTED_SSO_PROXY_CIDRS: "10.20.0.0/16,2001:db8::/32" });
    const { service } = createService();
    const valid = {
      identity: "alice@example.test",
      secret: SECRET,
      peer: "10.20.4.8",
    };

    expect(service.classify(makeRequest(valid))).toEqual({
      kind: "valid",
      identity: "alice@example.test",
    });
    expect(
      service.classify(makeRequest({ ...valid, peer: "::ffff:10.20.4.8" })),
    ).toEqual({ kind: "valid", identity: "alice@example.test" });
    expect(
      service.classify(makeRequest({ ...valid, peer: "2001:db8::42" })),
    ).toEqual({ kind: "valid", identity: "alice@example.test" });
    expect(
      service.classify(makeRequest({ ...valid, peer: "192.0.2.10" })),
    ).toEqual({ kind: "direct" });
    expect(
      service.classify(makeRequest({ ...valid, secret: `${SECRET}-wrong` })),
    ).toMatchObject({ kind: "invalid" });
    expect(
      service.classify(makeRequest({ ...valid, secure: false })),
    ).toMatchObject({ kind: "invalid" });
    expect(
      service.classify(makeRequest({ ...valid, duplicateIdentity: true })),
    ).toMatchObject({ kind: "invalid" });
    expect(
      service.classify(makeRequest({ ...valid, identity: " alice " })),
    ).toMatchObject({ kind: "invalid" });
  });

  it("matches identities exactly and reports unmapped identities without fallback", () => {
    enable();
    const { service } = createService();
    const req = makeRequest({ identity: "Alice@example.test", secret: SECRET });
    expect(service.getStatus(req)).toMatchObject({
      enabled: true,
      available: false,
      manualLoginAllowed: false,
      error: "identity-not-authorized",
    });
  });

  it("returns a validated HTTPS or relative logout URL in SSO status", () => {
    enable({ TRUSTED_SSO_LOGOUT_URL: "/auth/sign-out" });
    const { service } = createService();
    expect(
      service.getStatus(
        makeRequest({ identity: "alice@example.test", secret: SECRET }),
      ),
    ).toMatchObject({
      available: true,
      logoutUrl: "/auth/sign-out",
    });
  });

  it("allows break-glass password login only outside configured proxy CIDRs", () => {
    enable({ TRUSTED_SSO_PROXY_CIDRS: "10.20.0.0/16" });
    const { service } = createService();
    expect(() =>
      service.assertPasswordLoginAllowed(makeRequest({ peer: "10.20.1.2" })),
    ).toThrow();
    expect(() =>
      service.assertPasswordLoginAllowed(makeRequest({ peer: "192.0.2.4" })),
    ).not.toThrow();
  });

  it("creates an attributed SSO session only after every reachable token owner matches", async () => {
    enable();
    const { service, validate } = createService();
    const result = await service.loginForRequest(
      makeRequest({ identity: "alice@example.test", secret: SECRET }),
    );
    expect(result.session).toMatchObject({
      user: "alice@example.test",
      authSource: "trusted-sso",
      technitiumUser: "alice",
      tokensByNodeId: { nodeA: "cluster-token", nodeB: "cluster-token" },
    });
    expect(result.response.nodes).toEqual([
      { nodeId: "nodeA", success: true, authState: "authenticated" },
      { nodeId: "nodeB", success: true, authState: "authenticated" },
    ]);
    expect(validate).toHaveBeenNthCalledWith(1, "nodeA", "cluster-token");
    expect(validate).toHaveBeenNthCalledWith(2, "nodeB", "cluster-token");
    expect(JSON.stringify(result.response)).not.toContain("cluster-token");
  });

  it("permits a partial session only when the other node is unreachable", async () => {
    enable();
    const validate = jest
      .fn()
      .mockResolvedValueOnce({ username: "alice" })
      .mockRejectedValueOnce(new ServiceUnavailableException("offline"));
    const { service } = createService(validate);
    const result = await service.loginForRequest(
      makeRequest({ identity: "alice@example.test", secret: SECRET }),
    );
    expect(result.session.tokensByNodeId).toEqual({
      nodeA: "cluster-token",
    });
    expect(result.session.nodeAuthStatesByNodeId?.nodeB.status).toBe(
      "unreachable",
    );
    expect(result.session.pendingTokensByNodeId).toEqual({
      nodeB: "cluster-token",
    });
    expect(result.session.credentialUsernamesByGroup).toEqual({
      __default__: "alice",
    });
  });

  it("fails the whole login on invalid tokens or owner mismatch", async () => {
    enable();
    const validate = jest
      .fn()
      .mockResolvedValueOnce({ username: "alice" })
      .mockResolvedValueOnce({ username: "mallory" });
    const { service, sessions } = createService(validate);
    await expect(
      service.loginForRequest(
        makeRequest({ identity: "alice@example.test", secret: SECRET }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.count()).toBe(0);
  });

  it("single-flights validation per identity and bounds distinct local sessions", async () => {
    enable();
    const validate = jest.fn().mockResolvedValue({ username: "alice" });
    const { service, sessions } = createService(validate);
    const req = makeRequest({ identity: "alice@example.test", secret: SECRET });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.loginForRequest(req)),
    );
    expect(validate).toHaveBeenCalledTimes(2);
    expect(new Set(results.map((result) => result.session.id)).size).toBe(10);
    expect(sessions.count()).toBe(8);
    expect(sessions.get(results[0].session.id)).toBeUndefined();
    expect(sessions.get(results[1].session.id)).toBeUndefined();
    expect(sessions.get(results[9].session.id)).toBe(results[9].session);
  });

  it("applies a five-second cooldown after validation failure", async () => {
    enable();
    const validate = jest.fn().mockRejectedValue(new Error("invalid"));
    const { service } = createService(validate);
    const req = makeRequest({ identity: "alice@example.test", secret: SECRET });
    await expect(service.loginForRequest(req)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.loginForRequest(req)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("authorizes a v2 identity for a subset of explicit groups", async () => {
    const mapPath = writeMap({
      version: 2,
      identities: {
        "alice@example.test": {
          groups: {
            "site-a": { username: "alice-a", token: "site-a-token" },
          },
        },
      },
    });
    enable({ TRUSTED_SSO_TOKEN_MAP_FILE: mapPath });
    const explicitNodes: TechnitiumNodeConfig[] = [
      { ...nodes[0], groupId: "site-a" },
      { ...nodes[1], groupId: "site-b" },
    ];
    const validate = jest.fn().mockResolvedValue({
      username: "alice-a",
      permissions: {
        DnsClient: { canView: true },
        DhcpServer: { canView: true },
      },
      clusterInitialized: false,
      clusterNodes: [],
    });
    const sessions = new AuthSessionService();
    sessionServices.push(sessions);
    const service = new TrustedSsoService(
      explicitNodes,
      {
        validateExplicitSessionToken: validate,
      } as unknown as TechnitiumService,
      sessions,
    );

    const result = await service.loginForRequest(
      makeRequest({ identity: "alice@example.test", secret: SECRET }),
    );
    expect(result.session.tokensByNodeId).toEqual({ nodeA: "site-a-token" });
    expect(result.session.verifiedUsernamesByGroup).toEqual({
      "site-a": "alice-a",
    });
    expect(result.session.groupCredentials).toMatchObject({
      anyReady: true,
      allReady: true,
      groups: [
        { groupId: "site-a", state: "ready" },
        { groupId: "site-b", state: "not-authorized" },
      ],
    });
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith("nodeA", "site-a-token");
  });

  it("rejects unknown v2 groups and duplicate JSON keys at startup", () => {
    enable({
      TRUSTED_SSO_TOKEN_MAP_FILE: writeMap({
        version: 2,
        identities: {
          "alice@example.test": {
            groups: {
              unknown: { username: "alice", token: "token" },
            },
          },
        },
      }),
    });
    const explicitNodes: TechnitiumNodeConfig[] = [
      { ...nodes[0], groupId: "site-a" },
    ];
    expect(
      () =>
        new TrustedSsoService(
          explicitNodes,
          {} as TechnitiumService,
          new AuthSessionService(),
        ),
    ).toThrow(/unknown group/);

    const duplicatePath = join(TEST_DIR, `map-${fileIndex++}.json`);
    writeFileSync(
      duplicatePath,
      '{"version":2,"identities":{"alice@example.test":{"groups":{"site-a":{"username":"alice","token":"one"},"site-a":{"username":"alice","token":"two"}}}}}',
    );
    process.env.TRUSTED_SSO_TOKEN_MAP_FILE = duplicatePath;
    expect(
      () =>
        new TrustedSsoService(
          explicitNodes,
          {} as TechnitiumService,
          new AuthSessionService(),
        ),
    ).toThrow(/readable, valid JSON/);
  });
});
