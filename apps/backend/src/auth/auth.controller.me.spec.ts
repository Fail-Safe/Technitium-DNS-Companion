import { Test } from "@nestjs/testing";
import { TechnitiumService } from "../technitium/technitium.service";
import { AuthRequestContext } from "./auth-request-context";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import type { AuthSession } from "./auth.types";

describe("AuthController /auth/me", () => {
  beforeEach(() => {
    jest.resetAllMocks();
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
      getConfiguredNodeIds: jest.fn().mockReturnValue(["nodeA", "nodeB"]),
      getBackgroundPtrTokenValidationSummary:
        getBackgroundPtrTokenValidationSummaryMock,
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

  it("returns unauthenticated response including backgroundPtrToken", async () => {
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
      sessionAuthEnabled: true,
      authenticated: false,
      configuredNodeIds: ["nodeA", "nodeB"],
      backgroundPtrToken,
    });

    expect(getBackgroundPtrTokenValidationSummaryMock).toHaveBeenCalledTimes(1);
  });

  it("returns authenticated response with user and nodeIds", async () => {
    const { controller } = await createController();

    const session: AuthSession = {
      id: "s1",
      createdAt: new Date().toISOString(),
      lastSeenAt: Date.now(),
      user: "alice",
      tokensByNodeId: { nodeA: "t1", nodeB: "t2" },
    };

    const res = withContext(session, () => controller.me());

    expect(res.authenticated).toBe(true);
    expect(res.sessionAuthEnabled).toBe(true);
    expect(res.user).toBe("alice");
    expect(res.nodeIds?.sort()).toEqual(["nodeA", "nodeB"]);
    expect(res.configuredNodeIds?.sort()).toEqual(["nodeA", "nodeB"]);
    expect(res.backgroundPtrToken).toBeDefined();
  });
});
