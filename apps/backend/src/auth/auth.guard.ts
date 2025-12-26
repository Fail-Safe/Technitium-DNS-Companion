import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthRequestContext } from "./auth-request-context";
import { AUTH_PUBLIC_KEY } from "./auth.constants";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      AUTH_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const enabled = process.env.AUTH_SESSION_ENABLED === "true";
    if (!enabled) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.secure) {
      throw new ForbiddenException(
        "Session authentication requires HTTPS (direct HTTPS or a TLS-terminating reverse proxy with TRUST_PROXY=true).",
      );
    }

    const session = AuthRequestContext.getSession();
    if (!session) {
      throw new UnauthorizedException("Authentication required");
    }

    return true;
  }
}
