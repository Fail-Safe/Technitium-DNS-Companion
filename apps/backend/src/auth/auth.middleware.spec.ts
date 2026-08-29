import type { Request, Response } from "express";
import { AuthRequestContext } from "./auth-request-context";
import { AuthSessionService } from "./auth-session.service";
import { AUTH_SESSION_COOKIE_NAME } from "./auth.constants";
import { AuthRequestContextMiddleware } from "./auth.middleware";
import { TrustedSsoService } from "./trusted-sso.service";

describe("AuthRequestContextMiddleware trusted SSO binding", () => {
  let sessions: AuthSessionService;

  beforeEach(() => {
    sessions = new AuthSessionService();
  });

  afterEach(() => sessions.onModuleDestroy());

  function runWithClassification(
    classification: ReturnType<TrustedSsoService["classify"]>,
    sessionId: string,
  ) {
    const trustedSso = {
      classify: jest.fn().mockReturnValue(classification),
    } as unknown as TrustedSsoService;
    const middleware = new AuthRequestContextMiddleware(sessions, trustedSso);
    const req = {
      cookies: { [AUTH_SESSION_COOKIE_NAME]: sessionId },
    } as unknown as Request;
    const clearCookie = jest.fn();
    const res = { clearCookie } as unknown as Response;
    let contextSession = "not-run" as unknown;

    middleware.use(req, res, () => {
      contextSession = AuthRequestContext.getSession();
    });
    return { clearCookie, contextSession };
  }

  it("keeps a trusted SSO session only for the same valid assertion", () => {
    const session = sessions.create(
      "alice@example.test",
      { nodeA: "token" },
      undefined,
      { authSource: "trusted-sso", technitiumUser: "alice" },
    );
    const result = runWithClassification(
      { kind: "valid", identity: "alice@example.test" },
      session.id,
    );
    expect(result.contextSession).toBe(session);
    expect(result.clearCookie).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing assertion",
      { kind: "invalid", error: "invalid-proxy-assertion" },
    ],
    ["direct request", { kind: "direct" }],
    ["identity switch", { kind: "valid", identity: "bob@example.test" }],
  ] as const)(
    "clears the cookie and local session on %s",
    (_label, classification) => {
      const session = sessions.create(
        "alice@example.test",
        { nodeA: "token" },
        undefined,
        { authSource: "trusted-sso", technitiumUser: "alice" },
      );
      const result = runWithClassification(classification, session.id);
      expect(result.contextSession).toBeUndefined();
      expect(sessions.get(session.id)).toBeUndefined();
      expect(result.clearCookie).toHaveBeenCalledWith(
        AUTH_SESSION_COOKIE_NAME,
        {
          path: "/",
        },
      );
    },
  );

  it("does not bind password sessions to an SSO assertion", () => {
    const session = sessions.create("alice", { nodeA: "token" });
    const result = runWithClassification(
      { kind: "invalid", error: "invalid-proxy-assertion" },
      session.id,
    );
    expect(result.contextSession).toBe(session);
    expect(result.clearCookie).not.toHaveBeenCalled();
  });
});
