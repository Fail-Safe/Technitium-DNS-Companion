import type { NestMiddleware } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthRequestContext } from "./auth-request-context";
import { AuthSessionService } from "./auth-session.service";
import { AUTH_SESSION_COOKIE_NAME } from "./auth.constants";

@Injectable()
export class AuthRequestContextMiddleware implements NestMiddleware {
  constructor(private readonly sessionService: AuthSessionService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const cookiesValue: unknown = (req as unknown as { cookies?: unknown })
      .cookies;
    const sessionId =
      typeof cookiesValue === "object" && cookiesValue !== null
        ? (cookiesValue as Record<string, unknown>)[AUTH_SESSION_COOKIE_NAME]
        : undefined;

    const resolvedSessionId =
      typeof sessionId === "string" ? sessionId : undefined;
    const session = resolvedSessionId
      ? this.sessionService.get(resolvedSessionId)
      : undefined;

    AuthRequestContext.run({ session }, () => next());
  }
}
