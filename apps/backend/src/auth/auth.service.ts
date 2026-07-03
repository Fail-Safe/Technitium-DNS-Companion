import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import axios from "axios";
import * as https from "https";
import { TECHNITIUM_NODES_TOKEN } from "../technitium/technitium.constants";
import type { TechnitiumNodeConfig } from "../technitium/technitium.types";
import { AuthSessionService } from "./auth-session.service";
import { AUTH_SESSION_COOKIE_NAME } from "./auth.constants";
import type {
  AuthLoginRequestDto,
  AuthLoginResponseDto,
  AuthNodeSessionState,
  AuthNodeLoginResult,
  AuthNodeLoginFailureResult,
  AuthSession,
} from "./auth.types";

type AuthNodeFailureStatus = Exclude<
  AuthNodeSessionState["status"],
  "authenticated"
>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private readonly httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
  });

  private isNodeUnreachableError(error: unknown): boolean {
    if (axios.isAxiosError(error) && !error.response) {
      return true;
    }

    if (!error || typeof error !== "object") {
      return false;
    }

    const code = (error as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      [
        "ECONNABORTED",
        "ECONNREFUSED",
        "ECONNRESET",
        "ENETUNREACH",
        "EHOSTUNREACH",
        "ENOTFOUND",
        "ETIMEDOUT",
      ].includes(code)
    ) {
      return true;
    }

    const message =
      error instanceof Error ? error.message.toLowerCase() : undefined;
    return Boolean(
      message &&
      (message.includes("timeout") ||
        message.includes("network error") ||
        message.includes("connect econnrefused") ||
        message.includes("getaddrinfo") ||
        message.includes("host unreachable")),
    );
  }

  private classifyFailure(error: unknown): AuthNodeFailureStatus {
    return this.isNodeUnreachableError(error) ? "unreachable" : "failed";
  }

  private buildFailureResults(
    results: AuthNodeLoginResult[],
  ): AuthNodeLoginFailureResult[] {
    return results.map(({ nodeId, success, authState, status, error }) => ({
      nodeId,
      success: false,
      authState,
      status,
      error,
      ...(success ? { error: "Unexpected successful login result." } : {}),
    }));
  }

  private async verifyTokenForNode(args: {
    nodeId: string;
    baseUrl: string;
    token: string;
  }): Promise<
    | { ok: true }
    | { ok: false; error: string; authState: AuthNodeFailureStatus }
  > {
    try {
      const res = await axios.get(`${args.baseUrl}/api/user/session/get`, {
        params: { token: args.token },
        timeout: 15_000,
        maxRedirects: 0,
        httpsAgent: this.httpsAgent,
      });

      const status =
        res?.data && typeof res.data === "object"
          ? (res.data as Record<string, unknown>).status
          : undefined;

      if (status === "ok") {
        return { ok: true };
      }

      const errorMessage =
        res?.data && typeof res.data === "object"
          ? ((res.data as Record<string, unknown>).errorMessage as string) ||
            ((res.data as Record<string, unknown>).innerErrorMessage as string)
          : undefined;

      return {
        ok: false,
        error: errorMessage || "Token was rejected by node",
        authState: "failed",
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (typeof status === "number" && status >= 300 && status < 400) {
          const location =
            typeof error.response?.headers?.location === "string"
              ? error.response.headers.location
              : "(missing Location header)";
          return {
            ok: false,
            authState: "failed",
            error: `Request was redirected (HTTP ${status}) to ${location}. Check baseUrl for node "${args.nodeId}".`,
          };
        }

        if (typeof status === "number") {
          return {
            ok: false,
            authState: "failed",
            error: `Token validation failed (HTTP ${status}).`,
          };
        }
      }

      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        ok: false,
        authState: this.classifyFailure(error),
        error: message,
      };
    }
  }

  constructor(
    @Inject(TECHNITIUM_NODES_TOKEN)
    private readonly nodeConfigs: TechnitiumNodeConfig[],
    private readonly sessionService: AuthSessionService,
  ) {}

  cookieName(): string {
    return AUTH_SESSION_COOKIE_NAME;
  }

  cookieOptions(secure: boolean): {
    httpOnly: boolean;
    sameSite: "lax";
    secure: boolean;
    path: string;
    maxAge: number;
  } {
    return {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    };
  }

  private extractToken(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") {
      return undefined;
    }

    const data = payload as Record<string, unknown>;
    if (typeof data.token === "string" && data.token.length > 0) {
      return data.token;
    }

    const response = data.response;
    if (response && typeof response === "object") {
      const responseObj = response as Record<string, unknown>;
      if (
        typeof responseObj.token === "string" &&
        responseObj.token.length > 0
      ) {
        return responseObj.token;
      }
    }

    return undefined;
  }

  async login(
    dto: AuthLoginRequestDto,
  ): Promise<{ session: AuthSession; response: AuthLoginResponseDto }> {
    const username = (dto.username ?? "").trim();
    const password = dto.password ?? "";
    const totp = (dto.totp ?? "").trim();

    if (!username || !password) {
      throw new UnauthorizedException("Missing username/password");
    }

    const results: AuthNodeLoginResult[] = [];
    const tokensByNodeId: Record<string, string> = {};
    const nodeAuthStatesByNodeId: Record<string, AuthNodeSessionState> = {};

    for (const node of this.nodeConfigs) {
      const baseUrl = node.baseUrl;
      try {
        const res = await axios.get(`${baseUrl}/api/user/login`, {
          params: { user: username, pass: password, ...(totp ? { totp } : {}) },
          timeout: 30_000,
          maxRedirects: 0,
          httpsAgent: this.httpsAgent,
        });

        const status =
          res?.data && typeof res.data === "object"
            ? (res.data as Record<string, unknown>).status
            : undefined;

        const token = this.extractToken(res.data);

        if (status === "ok" && token) {
          const verified = await this.verifyTokenForNode({
            nodeId: node.id,
            baseUrl,
            token,
          });

          if (verified.ok) {
            tokensByNodeId[node.id] = token;
            nodeAuthStatesByNodeId[node.id] = { status: "authenticated" };
            results.push({
              nodeId: node.id,
              baseUrl,
              success: true,
              authState: "authenticated",
              token,
              status: "ok",
            });
            continue;
          }

          this.logger.warn(
            `Technitium token validation failed for node ${node.id} (${baseUrl}): ${verified.error}`,
          );

          results.push({
            nodeId: node.id,
            baseUrl,
            success: false,
            authState: verified.authState,
            status: "ok",
            error: verified.error,
          });
          nodeAuthStatesByNodeId[node.id] = {
            status: verified.authState,
            error: verified.error,
          };
          continue;
        }

        const errorMessage =
          res?.data && typeof res.data === "object"
            ? ((res.data as Record<string, unknown>).errorMessage as string) ||
              ((res.data as Record<string, unknown>)
                .innerErrorMessage as string)
            : undefined;

        results.push({
          nodeId: node.id,
          baseUrl,
          success: false,
          authState: "failed",
          status: typeof status === "string" ? status : undefined,
          error: errorMessage || "Login failed",
        });
        nodeAuthStatesByNodeId[node.id] = {
          status: "failed",
          error: errorMessage || "Login failed",
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        const authState = this.classifyFailure(error);
        this.logger.warn(
          `Login failed for node ${node.id} (${baseUrl}): ${message}`,
        );
        results.push({
          nodeId: node.id,
          baseUrl,
          success: false,
          authState,
          error: message,
        });
        nodeAuthStatesByNodeId[node.id] = {
          status: authState,
          error: message,
        };
      }
    }

    const successCount = Object.keys(tokensByNodeId).length;
    if (successCount === 0) {
      throw new UnauthorizedException({
        message: "Unable to authenticate to any configured Technitium node",
        nodes: this.buildFailureResults(results),
      });
    }

    const session = this.sessionService.create(
      username,
      tokensByNodeId,
      nodeAuthStatesByNodeId,
    );

    return { session, response: { authenticated: true, nodes: results } };
  }

  async logout(session: AuthSession | undefined): Promise<void> {
    if (!session) {
      return;
    }

    // Best-effort logout at Technitium nodes (invalidates the tokens)
    for (const node of this.nodeConfigs) {
      const token = session.tokensByNodeId[node.id];
      if (!token) {
        continue;
      }

      try {
        await axios.get(`${node.baseUrl}/api/user/logout`, {
          params: { token },
          timeout: 15_000,
          httpsAgent: this.httpsAgent,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        this.logger.debug(
          `Logout failed for node ${node.id} (ignored): ${message}`,
        );
      }
    }

    this.sessionService.delete(session.id);
  }
}
