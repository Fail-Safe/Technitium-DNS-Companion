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
      Boolean(err) && typeof err === "object" && "response" in (err as object),
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
    const { service } = createService([{ id: "eq14", baseUrl: "https://n1" }]);

    await expect(
      service.login({ username: "", password: "" }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("stores only tokens that pass /api/user/session/get verification", async () => {
    const { service, axiosMock } = createService([
      { id: "eq14", baseUrl: "https://n1" },
      { id: "eq12", baseUrl: "https://n2" },
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
    expect(session.tokensByNodeId).toEqual({ eq14: "t1" });

    expect(response.authenticated).toBe(true);

    const eq14 = response.nodes.find((n) => n.nodeId === "eq14");
    const eq12 = response.nodes.find((n) => n.nodeId === "eq12");

    expect(eq14).toMatchObject({
      nodeId: "eq14",
      success: true,
      status: "ok",
      token: "t1",
    });

    expect(eq12).toMatchObject({
      nodeId: "eq12",
      success: false,
      status: "ok",
      error: "invalid token",
    });
  });

  it("rejects login when no node yields a verified token", async () => {
    const { service, axiosMock } = createService([
      { id: "eq14", baseUrl: "https://n1" },
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
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("captures redirect diagnostics when Technitium baseUrl redirects", async () => {
    const { service, axiosMock } = createService([
      { id: "eq14", baseUrl: "https://n1" },
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
});
