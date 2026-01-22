import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { TechnitiumService } from "../technitium/technitium.service";
import { AuthRequestContext } from "./auth-request-context";
import { AuthService } from "./auth.service";
import type { AuthLoginRequestDto, AuthMeResponseDto } from "./auth.types";
import { Public } from "./public.decorator";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly technitiumService: TechnitiumService,
  ) {}

  @Public()
  @Get("me")
  me(@Req() req?: Request): AuthMeResponseDto {
    const session = AuthRequestContext.getSession();

    const sessionAuthEnabled = true;
    const httpsEnabled = process.env.HTTPS_ENABLED === "true";
    const trustProxyEnabled = process.env.TRUST_PROXY === "true";

    const forwardedProtoHeader = req?.headers?.["x-forwarded-proto"];
    const forwardedProto =
      typeof forwardedProtoHeader === "string"
        ? forwardedProtoHeader
        : Array.isArray(forwardedProtoHeader)
          ? forwardedProtoHeader[0]
          : undefined;

    const transport = req
      ? {
          requestSecure: req.secure === true,
          httpsEnabled,
          trustProxyEnabled,
          forwardedProto,
        }
      : undefined;

    const backgroundPtrToken =
      this.technitiumService.getBackgroundPtrTokenValidationSummary();

    const configuredNodeIds = this.technitiumService.getConfiguredNodeIds();

    if (!session) {
      return {
        sessionAuthEnabled,
        authenticated: false,
        configuredNodeIds,
        ...(transport ? { transport } : {}),
        backgroundPtrToken,
      };
    }

    return {
      sessionAuthEnabled,
      authenticated: true,
      user: session.user,
      nodeIds: Object.keys(session.tokensByNodeId),
      configuredNodeIds,
      ...(transport ? { transport } : {}),
      backgroundPtrToken,
    };
  }

  @Public()
  @Post("login")
  async login(
    @Body() body: AuthLoginRequestDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!req.secure) {
      throw new ForbiddenException(
        "Session authentication requires HTTPS (direct HTTPS or a TLS-terminating reverse proxy with TRUST_PROXY=true).",
      );
    }

    const { session, response } = await this.authService.login(body);

    res.cookie(
      this.authService.cookieName(),
      session.id,
      this.authService.cookieOptions(req.secure),
    );

    return response;
  }

  @Post("logout")
  async logout(
    @Req() _req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = AuthRequestContext.getSession();
    await this.authService.logout(session);

    res.clearCookie(this.authService.cookieName(), { path: "/" });

    return { ok: true };
  }
}
