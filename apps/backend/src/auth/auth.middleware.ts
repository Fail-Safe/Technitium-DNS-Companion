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
    const cookies = (req as Request & { cookies?: Record<string, string> })
      .cookies;

    const sessionId = cookies?.[AUTH_SESSION_COOKIE_NAME];
    const session = sessionId ? this.sessionService.get(sessionId) : undefined;

    AuthRequestContext.run({ session }, () => next());
  }
}
