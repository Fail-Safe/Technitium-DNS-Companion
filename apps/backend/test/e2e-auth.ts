import type { INestApplication } from "@nestjs/common";

import { AUTH_SESSION_COOKIE_NAME } from "../src/auth/auth.constants";
import { AuthSessionService } from "../src/auth/auth-session.service";

export function enableSecureProxyForE2e(app: INestApplication): void {
  const expressApp = app.getHttpAdapter().getInstance() as {
    set?: (name: string, value: unknown) => void;
  };
  expressApp.set?.("trust proxy", 1);
}

export function createE2eSessionCookie(
  app: INestApplication,
  tokensByNodeId: Record<string, string> = {},
): string {
  const sessionService = app.get(AuthSessionService);
  const session = sessionService.create("e2e", tokensByNodeId);
  return `${AUTH_SESSION_COOKIE_NAME}=${session.id}`;
}

export function withE2eAuth<T extends { set(field: string, value: string): T }>(
  request: T,
  sessionCookie: string,
): T {
  return request
    .set("X-Forwarded-Proto", "https")
    .set("Cookie", sessionCookie);
}
