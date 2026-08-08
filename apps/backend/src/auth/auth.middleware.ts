import type { NestMiddleware } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthRequestContext } from "./auth-request-context";
import { AuthSessionService } from "./auth-session.service";
import { AuthService } from "./auth.service";
import { AUTH_SESSION_COOKIE_NAME } from "./auth.constants";
import type { AuthSession } from "./auth.types";

@Injectable()
export class AuthRequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly sessionService: AuthSessionService,
    private readonly authService: AuthService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const cookiesValue: unknown = (req as unknown as { cookies?: unknown })
      .cookies;
    const sessionId =
      typeof cookiesValue === "object" && cookiesValue !== null
        ? (cookiesValue as Record<string, unknown>)[AUTH_SESSION_COOKIE_NAME]
        : undefined;

    const resolvedSessionId =
      typeof sessionId === "string" ? sessionId : undefined;
    let session: AuthSession | undefined = resolvedSessionId
      ? this.sessionService.get(resolvedSessionId)
      : undefined;

    // Trusted-header (reverse-proxy SSO) auto-login: when there's no valid
    // session cookie but the forward-auth proxy injected an identity header,
    // establish the session transparently and set the cookie so subsequent
    // requests reuse it. Absent the header, we fall through with no session
    // and the normal Technitium login form serves as the break-glass path.
    if (
      !session &&
      req.secure &&
      this.authService.trustedHeaderAuthEnabled()
    ) {
      const headerUser = this.authService.extractTrustedUser(req.headers);
      if (headerUser) {
        const minted = await this.authService.loginViaTrustedHeader(headerUser);
        if (minted) {
          session = minted.session;
          res.cookie(
            this.authService.cookieName(),
            session.id,
            this.authService.cookieOptions(true),
          );
        }
      }
    }

    AuthRequestContext.run({ session }, () => next());
  }
}
