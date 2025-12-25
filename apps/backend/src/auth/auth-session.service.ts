import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { AuthSession } from "./auth.types";

@Injectable()
export class AuthSessionService {
  private readonly sessions = new Map<string, AuthSession>();

  create(user: string, tokensByNodeId: Record<string, string>): AuthSession {
    const id = randomUUID();
    const now = Date.now();
    const session: AuthSession = {
      id,
      user,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: now,
      tokensByNodeId,
    };

    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string): AuthSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    session.lastSeenAt = Date.now();
    return session;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
