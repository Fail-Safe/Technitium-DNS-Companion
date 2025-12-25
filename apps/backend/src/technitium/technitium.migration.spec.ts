import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import axios from "axios";
import { DhcpSnapshotService } from "./dhcp-snapshot.service";
import { TECHNITIUM_NODES_TOKEN } from "./technitium.constants";
import { TechnitiumService } from "./technitium.service";
import type { TechnitiumNodeConfig } from "./technitium.types";

jest.mock("axios", () => {
  const request = jest.fn();
  const isAxiosError = jest.fn();
  return { __esModule: true, default: { request, isAxiosError }, isAxiosError };
});

type AxiosRequest = { baseURL?: string; url?: string; params?: any };

const axiosRequestMock = (axios as unknown as { request: jest.Mock }).request;

describe("TechnitiumService migration", () => {
  const node1: TechnitiumNodeConfig = {
    id: "n1",
    name: "Node1",
    baseUrl: "https://node1.example:53443",
    token: "",
    queryLoggerAppName: undefined,
    queryLoggerClassPath: undefined,
  };

  const node2: TechnitiumNodeConfig = {
    id: "n2",
    name: "Node2",
    baseUrl: "https://node2.example:53443",
    token: "",
    queryLoggerAppName: undefined,
    queryLoggerClassPath: undefined,
  };

  beforeEach(() => {
    jest.resetAllMocks();

    // Keep background-token validation out of these tests.
    delete process.env.TECHNITIUM_BACKGROUND_TOKEN;

    // In Jest, NODE_ENV is usually "test"; ensure background timers are disabled.
    process.env.NODE_ENV = "test";

    // Make sure session-auth flag doesn't accidentally change behavior.
    process.env.AUTH_SESSION_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.TECHNITIUM_CLUSTER_TOKEN;
  });

  async function createService(nodes: TechnitiumNodeConfig[]) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TechnitiumService,
        { provide: TECHNITIUM_NODES_TOKEN, useValue: nodes },
        { provide: DhcpSnapshotService, useValue: {} },
      ],
    }).compile();

    return moduleRef.get(TechnitiumService);
  }

  it("throws when TECHNITIUM_CLUSTER_TOKEN is missing", async () => {
    const service = await createService([node1]);

    await expect(
      service.migrateClusterTokenToBackgroundToken(),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws when there are no configured nodes", async () => {
    process.env.TECHNITIUM_CLUSTER_TOKEN = "cluster-token";

    const service = await createService([]);

    await expect(
      service.migrateClusterTokenToBackgroundToken(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("creates a dedicated user and returns a least-privilege token", async () => {
    process.env.TECHNITIUM_CLUSTER_TOKEN = "cluster-token";

    axiosRequestMock.mockImplementation(async (config: AxiosRequest) => {
      if (
        config.url === "/api/user/session/get" &&
        config.baseURL === node1.baseUrl
      ) {
        return {
          data: {
            status: "ok",
            info: {
              clusterInitialized: true,
              clusterNodes: [
                { type: "Primary", url: `${node2.baseUrl}/` },
                { type: "Secondary", url: `${node1.baseUrl}/` },
              ],
            },
          },
        };
      }

      if (config.url === "/api/admin/users/create") {
        return {
          data: { status: "ok", response: { username: config.params?.user } },
        };
      }

      if (config.url === "/api/admin/users/set") {
        return {
          data: { status: "ok", response: { username: config.params?.user } },
        };
      }

      if (config.url === "/api/admin/sessions/createToken") {
        return {
          data: {
            status: "ok",
            response: {
              username: config.params?.user,
              tokenName: config.params?.tokenName,
              token: "new-background-token",
            },
          },
        };
      }

      if (
        config.url === "/api/user/session/get" &&
        config.baseURL === node2.baseUrl
      ) {
        return {
          data: {
            status: "ok",
            username: "companion-readonly",
            info: {
              permissions: {
                DnsClient: {
                  canView: true,
                  canModify: false,
                  canDelete: false,
                },
              },
            },
          },
        };
      }

      throw new Error(
        `Unexpected request: ${String(config.baseURL)} ${String(config.url)}`,
      );
    });

    const service = await createService([node1, node2]);
    const result = await service.migrateClusterTokenToBackgroundToken();

    expect(result.token).toBe("new-background-token");
    expect(result.username).toBe("companion-readonly");
    expect(result.tokenName).toBe("Technitium-DNS-Companion Background");
  });

  it("retries when the initial username already exists", async () => {
    process.env.TECHNITIUM_CLUSTER_TOKEN = "cluster-token";

    let userCreateCount = 0;

    axiosRequestMock.mockImplementation(async (config: AxiosRequest) => {
      if (
        config.url === "/api/user/session/get" &&
        config.params?.token === "cluster-token"
      ) {
        return { data: { status: "ok", info: { clusterInitialized: false } } };
      }

      if (config.url === "/api/admin/users/create") {
        userCreateCount++;

        if (userCreateCount === 1) {
          // trigger the retry logic
          return {
            data: { status: "error", errorMessage: "User already exists" },
          };
        }

        return {
          data: { status: "ok", response: { username: config.params?.user } },
        };
      }

      if (config.url === "/api/admin/users/set") {
        return { data: { status: "ok", response: {} } };
      }

      if (config.url === "/api/admin/sessions/createToken") {
        return {
          data: {
            status: "ok",
            response: {
              username: config.params?.user,
              tokenName: config.params?.tokenName,
              token: "new-background-token",
            },
          },
        };
      }

      if (
        config.url === "/api/user/session/get" &&
        config.params?.token !== "cluster-token"
      ) {
        return {
          data: {
            status: "ok",
            username: "companion-readonly",
            info: { permissions: { DnsClient: { canView: true } } },
          },
        };
      }

      throw new Error(
        `Unexpected request: ${String(config.baseURL)} ${String(config.url)}`,
      );
    });

    const service = await createService([node1]);
    const result = await service.migrateClusterTokenToBackgroundToken();

    expect(userCreateCount).toBe(2);
    expect(result.username.startsWith("companion-readonly")).toBe(true);
    expect(result.token).toBe("new-background-token");
  });

  it("fails if the generated token is too privileged", async () => {
    process.env.TECHNITIUM_CLUSTER_TOKEN = "cluster-token";

    axiosRequestMock.mockImplementation(async (config: AxiosRequest) => {
      if (config.url === "/api/user/session/get") {
        return { data: { status: "ok", info: { clusterInitialized: false } } };
      }

      if (config.url === "/api/admin/users/create") {
        return {
          data: { status: "ok", response: { username: config.params?.user } },
        };
      }

      if (config.url === "/api/admin/users/set") {
        return { data: { status: "ok", response: {} } };
      }

      if (config.url === "/api/admin/sessions/createToken") {
        return {
          data: {
            status: "ok",
            response: {
              username: config.params?.user,
              tokenName: config.params?.tokenName,
              token: "new-background-token",
            },
          },
        };
      }

      if (
        config.url === "/api/user/session/get" &&
        config.params?.token === "new-background-token"
      ) {
        return {
          data: {
            status: "ok",
            username: "companion-readonly",
            info: {
              permissions: {
                DnsClient: { canView: true },
                Administration: { canView: true },
              },
            },
          },
        };
      }

      throw new Error(
        `Unexpected request: ${String(config.baseURL)} ${String(config.url)}`,
      );
    });

    const service = await createService([node1]);

    await expect(
      service.migrateClusterTokenToBackgroundToken(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("continues if memberOfGroups enforcement fails, relying on validation", async () => {
    process.env.TECHNITIUM_CLUSTER_TOKEN = "cluster-token";

    axiosRequestMock.mockImplementation(async (config: AxiosRequest) => {
      if (
        config.url === "/api/user/session/get" &&
        config.params?.token === "cluster-token"
      ) {
        return { data: { status: "ok", info: { clusterInitialized: false } } };
      }

      if (config.url === "/api/admin/users/create") {
        return {
          data: { status: "ok", response: { username: config.params?.user } },
        };
      }

      if (config.url === "/api/admin/users/set") {
        return { data: { status: "error", errorMessage: "Not supported" } };
      }

      if (config.url === "/api/admin/sessions/createToken") {
        return {
          data: {
            status: "ok",
            response: {
              username: config.params?.user,
              tokenName: config.params?.tokenName,
              token: "new-background-token",
            },
          },
        };
      }

      if (
        config.url === "/api/user/session/get" &&
        config.params?.token !== "cluster-token"
      ) {
        return {
          data: {
            status: "ok",
            username: "companion-readonly",
            info: { permissions: { DnsClient: { canView: true } } },
          },
        };
      }

      throw new Error(
        `Unexpected request: ${String(config.baseURL)} ${String(config.url)}`,
      );
    });

    const service = await createService([node1]);
    const result = await service.migrateClusterTokenToBackgroundToken();

    expect(result.token).toBe("new-background-token");
    expect(result.username).toBe("companion-readonly");
  });
});
