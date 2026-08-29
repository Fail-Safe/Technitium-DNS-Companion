import type { NestMiddleware } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthRequestContext } from "./auth-request-context";
import { AuthSessionService } from "./auth-session.service";
import { AUTH_SESSION_COOKIE_NAME } from "./auth.constants";
import { TrustedSsoService } from "./trusted-sso.service";

@Injectable()
export class AuthRequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly sessionService: AuthSessionService,
    private readonly trustedSsoService: TrustedSsoService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const cookiesValue: unknown = (req as unknown as { cookies?: unknown })
      .cookies;
    const sessionId =
      typeof cookiesValue === "object" && cookiesValue !== null
        ? (cookiesValue as Record<string, unknown>)[AUTH_SESSION_COOKIE_NAME]
        : undefined;

    const resolvedSessionId =
      typeof sessionId === "string" ? sessionId : undefined;
    let session = resolvedSessionId
      ? this.sessionService.get(resolvedSessionId)
      : undefined;
    const trustedSsoRequest = this.trustedSsoService.classify(req);

    if (
      session?.authSource === "trusted-sso" &&
      (trustedSsoRequest.kind !== "valid" ||
        trustedSsoRequest.identity !== session.user)
    ) {
      this.sessionService.delete(session.id);
      session = undefined;
      res.clearCookie(AUTH_SESSION_COOKIE_NAME, { path: "/" });
    }

    AuthRequestContext.run({ session, trustedSsoRequest }, () => next());
  }
}
