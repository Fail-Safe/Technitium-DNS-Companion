import { Test } from "@nestjs/testing";
import { TechnitiumService } from "../technitium/technitium.service";
import { AuthRequestContext } from "./auth-request-context";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import type { AuthSession } from "./auth.types";

describe("AuthController /auth/me", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.TECHNITIUM_CLUSTER_TOKEN;
    process.env.AUTH_SESSION_ENABLED = "false";
  });

  async function createController(getBackgroundSummaryImpl?: jest.Mock) {
    const authServiceMock: Partial<AuthService> = {};

    const getBackgroundPtrTokenValidationSummaryMock =
      getBackgroundSummaryImpl ??
      jest.fn().mockReturnValue({
        configured: false,
        sessionAuthEnabled: true,
        validated: false,
      });

    const technitiumServiceMock: Partial<TechnitiumService> = {
      getConfiguredNodeIds: jest.fn().mockReturnValue(["eq14", "eq12"]),
      getBackgroundPtrTokenValidationSummary:
        getBackgroundPtrTokenValidationSummaryMock,
      getClusterTokenFallbackNodeIds: jest.fn().mockReturnValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authServiceMock },
        { provide: TechnitiumService, useValue: technitiumServiceMock },
      ],
    }).compile();

    return {
      controller: moduleRef.get(AuthController),
      technitiumServiceMock: technitiumServiceMock as TechnitiumService,
      getBackgroundPtrTokenValidationSummaryMock,
    };
  }

  function withContext<T>(session: AuthSession | undefined, fn: () => T): T {
    return AuthRequestContext.run({ session }, fn);
  }

  it("returns unauthenticated response, still including clusterTokenConfigured and backgroundPtrToken", async () => {
    process.env.TECHNITIUM_CLUSTER_TOKEN = "cluster-token";

    const backgroundPtrToken = {
      configured: true,
      sessionAuthEnabled: true,
      validated: true,
      okForPtr: false,
      reason: "too privileged",
      tooPrivilegedSections: ["Administration"],
    };

    const getBackgroundSummaryMock = jest
      .fn()
      .mockReturnValue(backgroundPtrToken);
    const { controller, getBackgroundPtrTokenValidationSummaryMock } =
      await createController(getBackgroundSummaryMock);

    const res = withContext(undefined, () => controller.me());

    expect(res).toEqual({
      sessionAuthEnabled: false,
      authenticated: false,
      configuredNodeIds: ["eq14", "eq12"],
      clusterTokenConfigured: true,
      clusterTokenUsage: { usedForNodeIds: [] },
      backgroundPtrToken,
    });

    expect(getBackgroundPtrTokenValidationSummaryMock).toHaveBeenCalledTimes(1);
  });

  it("returns authenticated response with user and nodeIds, and clusterTokenConfigured=false", async () => {
    const { controller } = await createController();

    const session: AuthSession = {
      id: "s1",
      createdAt: new Date().toISOString(),
      lastSeenAt: Date.now(),
      user: "alice",
      tokensByNodeId: { eq14: "t1", eq12: "t2" },
    };

    const res = withContext(session, () => controller.me());

    expect(res.authenticated).toBe(true);
    expect(res.sessionAuthEnabled).toBe(false);
    expect(res.user).toBe("alice");
    expect(res.nodeIds?.sort()).toEqual(["eq12", "eq14"]);
    expect(res.configuredNodeIds?.sort()).toEqual(["eq12", "eq14"]);
    expect(res.clusterTokenConfigured).toBe(false);
    expect(res.backgroundPtrToken).toBeDefined();
  });

  it("reports clusterTokenConfigured=true when TECHNITIUM_CLUSTER_TOKEN is set", async () => {
    process.env.TECHNITIUM_CLUSTER_TOKEN = "cluster-token";

    const { controller } = await createController();

    const session: AuthSession = {
      id: "s1",
      createdAt: new Date().toISOString(),
      lastSeenAt: Date.now(),
      user: "alice",
      tokensByNodeId: { eq14: "t1" },
    };

    const res = withContext(session, () => controller.me());

    expect(res.clusterTokenConfigured).toBe(true);
    expect(res.configuredNodeIds?.sort()).toEqual(["eq12", "eq14"]);
  });
});
