import { UnauthorizedException } from "@nestjs/common";
import axios from "axios";
import { AuthSessionService } from "./auth-session.service";
import { AuthService } from "./auth.service";
import type { TechnitiumNodeConfig } from "../technitium/technitium.types";

type AxiosMock = { get: jest.Mock; isAxiosError: (err: unknown) => boolean };

jest.mock("axios", () => {
  const mock: AxiosMock = {
    get: jest.fn(),
    isAxiosError: (err: unknown) =>
      Boolean(err) &&
      typeof err === "object" &&
      ("response" in (err as object) || "isAxiosError" in (err as object)),
  };

  return { __esModule: true, default: mock };
});

describe("AuthService.login", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  function createService(nodes: Array<{ id: string; baseUrl: string }>) {
    const sessionService = new AuthSessionService();

    const nodeConfigs: TechnitiumNodeConfig[] = nodes.map((node) => ({
      id: node.id,
      name: node.id,
      baseUrl: node.baseUrl,
      token: "",
      queryLoggerAppName: undefined,
      queryLoggerClassPath: undefined,
    }));

    const service = new AuthService(nodeConfigs, sessionService);
    const axiosMock = axios as unknown as AxiosMock;
    return { service, sessionService, axiosMock };
  }

  it("throws when username/password missing", async () => {
    const { service } = createService([{ id: "nodeA", baseUrl: "https://n1" }]);

    await expect(
      service.login({ username: "", password: "" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("stores only tokens that pass /api/user/session/get verification", async () => {
    const { service, axiosMock } = createService([
      { id: "nodeA", baseUrl: "https://n1" },
      { id: "nodeB", baseUrl: "https://n2" },
    ]);

    axiosMock.get.mockImplementation((url: string) => {
      if (url === "https://n1/api/user/login") {
        return Promise.resolve({ data: { status: "ok", token: "t1" } });
      }
      if (url === "https://n1/api/user/session/get") {
        return Promise.resolve({ data: { status: "ok" } });
      }

      if (url === "https://n2/api/user/login") {
        return Promise.resolve({ data: { status: "ok", token: "t2" } });
      }
      if (url === "https://n2/api/user/session/get") {
        return Promise.resolve({
          data: { status: "error", errorMessage: "invalid token" },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const { session, response } = await service.login({
      username: "alice",
      password: "pw",
    });

    expect(session.user).toBe("alice");
    expect(session.tokensByNodeId).toEqual({ nodeA: "t1" });

    expect(response.authenticated).toBe(true);

    const nodeA = response.nodes.find((n) => n.nodeId === "nodeA");
    const nodeB = response.nodes.find((n) => n.nodeId === "nodeB");

    expect(nodeA).toMatchObject({
      nodeId: "nodeA",
      success: true,
      status: "ok",
      token: "t1",
    });

    expect(nodeB).toMatchObject({
      nodeId: "nodeB",
      success: false,
      authState: "failed",
      status: "ok",
      error: "invalid token",
    });

    expect(axiosMock.get).toHaveBeenCalledWith(
      "https://n1/api/user/session/get",
      expect.objectContaining({
        params: { token: "t1" },
        headers: { Authorization: "Bearer t1" },
      }),
    );
  });

  it("keeps login usable when one configured node is unreachable", async () => {
    const { service, axiosMock } = createService([
      { id: "nodeA", baseUrl: "https://n1" },
      { id: "nodeB", baseUrl: "https://n2" },
    ]);

    axiosMock.get.mockImplementation((url: string) => {
      if (url === "https://n1/api/user/login") {
        const err = Object.assign(new Error("connect ECONNREFUSED"), {
          isAxiosError: true,
          code: "ECONNREFUSED",
          request: {},
        });
        return Promise.reject(err);
      }

      if (url === "https://n2/api/user/login") {
        return Promise.resolve({ data: { status: "ok", token: "t2" } });
      }
      if (url === "https://n2/api/user/session/get") {
        return Promise.resolve({ data: { status: "ok" } });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const { session, response } = await service.login({
      username: "alice",
      password: "pw",
    });

    expect(session.tokensByNodeId).toEqual({ nodeB: "t2" });
    expect(session.nodeAuthStatesByNodeId).toEqual({
      nodeA: {
        status: "unreachable",
        error: "connect ECONNREFUSED",
      },
      nodeB: { status: "authenticated" },
    });

    expect(response.nodes.find((n) => n.nodeId === "nodeA")).toMatchObject({
      success: false,
      authState: "unreachable",
    });
    expect(response.authenticated).toBe(true);
  });

  it("rejects login when no node yields a verified token", async () => {
    const { service, axiosMock } = createService([
      { id: "nodeA", baseUrl: "https://n1" },
    ]);

    axiosMock.get.mockImplementation((url: string) => {
      if (url === "https://n1/api/user/login") {
        return Promise.resolve({ data: { status: "ok", token: "t1" } });
      }
      if (url === "https://n1/api/user/session/get") {
        return Promise.resolve({
          data: { status: "error", errorMessage: "invalid token" },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      service.login({ username: "alice", password: "pw" }),
    ).rejects.toMatchObject({
      response: {
        message: "Unable to authenticate to any configured Technitium node",
        nodes: [
          {
            nodeId: "nodeA",
            success: false,
            authState: "failed",
            status: "ok",
            error: "invalid token",
          },
        ],
      },
    });
  });

  it("captures redirect diagnostics when Technitium baseUrl redirects", async () => {
    const { service, axiosMock } = createService([
      { id: "nodeA", baseUrl: "https://n1" },
    ]);

    axiosMock.get.mockImplementation((url: string) => {
      if (url === "https://n1/api/user/login") {
        const err = Object.assign(new Error("Redirect"), {
          response: { status: 302, headers: { location: "https://n1/login" } },
        });
        return Promise.reject(err);
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      service.login({ username: "alice", password: "pw" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("revokes password tokens but only deletes local trusted-SSO sessions", async () => {
    const { service, sessionService, axiosMock } = createService([
      { id: "nodeA", baseUrl: "https://n1" },
    ]);
    axiosMock.get.mockResolvedValue({ data: { status: "ok" } });

    const passwordSession = sessionService.create("alice", {
      nodeA: "password-token",
    });
    await service.logout(passwordSession);
    expect(axiosMock.get).toHaveBeenCalledWith(
      "https://n1/api/user/logout",
      expect.objectContaining({ params: { token: "password-token" } }),
    );

    axiosMock.get.mockClear();
    const ssoSession = sessionService.create(
      "alice@example.test",
      { nodeA: "operator-token" },
      undefined,
      { authSource: "trusted-sso", technitiumUser: "alice" },
    );
    await service.logout(ssoSession);
    expect(axiosMock.get).not.toHaveBeenCalled();
    expect(sessionService.get(ssoSession.id)).toBeUndefined();
    sessionService.onModuleDestroy();
  });
});
