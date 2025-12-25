import { ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TechnitiumService } from "../technitium/technitium.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

describe("AuthController background-token migration", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  async function createController(migrateImpl?: jest.Mock) {
    const authServiceMock: Partial<AuthService> = {};

    const migrateClusterTokenToBackgroundTokenMock = migrateImpl ?? jest.fn();

    const technitiumServiceMock: Partial<TechnitiumService> = {
      migrateClusterTokenToBackgroundToken:
        migrateClusterTokenToBackgroundTokenMock,
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
      migrateClusterTokenToBackgroundTokenMock,
    };
  }

  it("rejects migration when session auth is disabled", async () => {
    process.env.AUTH_SESSION_ENABLED = "false";

    const migrateMock = jest.fn();
    const { controller } = await createController(migrateMock);

    await expect(controller.migrateBackgroundToken()).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(migrateMock).not.toHaveBeenCalled();
  });

  it("delegates migration when session auth is enabled", async () => {
    process.env.AUTH_SESSION_ENABLED = "true";

    const migrateMock = jest
      .fn()
      .mockResolvedValue({ username: "u", tokenName: "t", token: "tok" });

    const { controller, migrateClusterTokenToBackgroundTokenMock } =
      await createController(migrateMock);

    const res = await controller.migrateBackgroundToken();

    expect(res).toEqual({ username: "u", tokenName: "t", token: "tok" });
    expect(migrateClusterTokenToBackgroundTokenMock).toHaveBeenCalledTimes(1);
  });
});
