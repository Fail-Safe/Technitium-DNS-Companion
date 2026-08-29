import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import type { Request } from "express";
import { parseTree } from "jsonc-parser";
import type { Node as JsonNode, ParseError } from "jsonc-parser";
import { TECHNITIUM_NODES_TOKEN } from "../technitium/technitium.constants";
import { TechnitiumService } from "../technitium/technitium.service";
import type { TechnitiumNodeConfig } from "../technitium/technitium.types";
import { getEnvOrFile } from "../utils/env-file";
import { AuthRequestContext } from "./auth-request-context";
import { AuthSessionService } from "./auth-session.service";
import type {
  AuthNodeSessionState,
  AuthSession,
  TrustedSsoRequestClassification,
  TrustedSsoStatus,
} from "./auth.types";

const DEFAULT_IDENTITY_HEADER = "x-forwarded-user";
const DEFAULT_SECRET_HEADER = "x-trusted-proxy-secret";
const FAILURE_COOLDOWN_MS = 5_000;
const MAX_SESSIONS_PER_IDENTITY = 8;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,254}$/;

interface TrustedSsoIdentityMapping {
  username: string;
  token: string;
}

interface TrustedSsoConfig {
  enabled: boolean;
  identityHeader: string;
  secretHeader: string;
  secretDigest?: Buffer;
  proxyCidrs: ParsedCidr[];
  identities: Map<string, TrustedSsoIdentityMapping>;
  logoutUrl?: string;
}

interface ParsedCidr {
  family: 4 | 6;
  network: bigint;
  prefix: number;
}

interface TrustedSsoValidation {
  mapping: TrustedSsoIdentityMapping;
  nodeAuthStatesByNodeId: Record<string, AuthNodeSessionState>;
  authenticatedNodeIds: string[];
}

export interface TrustedSsoLoginResult {
  session: AuthSession;
  response: {
    authenticated: true;
    nodes: Array<{
      nodeId: string;
      success: boolean;
      authState: AuthNodeSessionState["status"];
      error?: string;
    }>;
  };
}

@Injectable()
export class TrustedSsoService {
  private readonly logger = new Logger(TrustedSsoService.name);
  private readonly config: TrustedSsoConfig;
  private readonly validationFlights = new Map<
    string,
    Promise<TrustedSsoValidation>
  >();
  private readonly failureCooldowns = new Map<string, number>();

  constructor(
    @Inject(TECHNITIUM_NODES_TOKEN)
    private readonly nodeConfigs: TechnitiumNodeConfig[],
    private readonly technitiumService: TechnitiumService,
    private readonly sessionService: AuthSessionService,
  ) {
    this.config = this.loadConfig();
    if (this.config.enabled) {
      this.logger.log(
        `Trusted SSO enabled with ${this.config.identities.size} exact identity mapping(s).`,
      );
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  classify(req: Request): TrustedSsoRequestClassification {
    if (!this.config.enabled) {
      return { kind: "disabled" };
    }

    if (!this.isImmediatePeerTrusted(req)) {
      return { kind: "direct" };
    }

    if (!req.secure) {
      return { kind: "invalid", error: "invalid-proxy-assertion" };
    }

    const identity = this.readSingleHeader(req, this.config.identityHeader);
    const suppliedSecret = this.readSingleHeader(req, this.config.secretHeader);
    if (
      !identity ||
      !IDENTITY_PATTERN.test(identity) ||
      !suppliedSecret ||
      !this.secretMatches(suppliedSecret)
    ) {
      return { kind: "invalid", error: "invalid-proxy-assertion" };
    }

    return { kind: "valid", identity };
  }

  getStatus(req?: Request): TrustedSsoStatus {
    if (!this.config.enabled) {
      return {
        enabled: false,
        available: false,
        manualLoginAllowed: true,
      };
    }

    const classification =
      AuthRequestContext.getTrustedSsoRequest() ??
      (req ? this.classify(req) : { kind: "invalid" as const });
    const manualLoginAllowed = req ? this.isManualLoginAllowed(req) : false;
    const base = {
      enabled: true,
      manualLoginAllowed,
      ...(this.config.logoutUrl ? { logoutUrl: this.config.logoutUrl } : {}),
    };

    if (classification.kind === "valid") {
      if (!this.config.identities.has(classification.identity)) {
        return {
          ...base,
          available: false,
          error: "identity-not-authorized",
        };
      }
      return { ...base, available: true };
    }

    if (classification.kind === "invalid") {
      return {
        ...base,
        available: false,
        error: "invalid-proxy-assertion",
      };
    }

    return { ...base, available: false };
  }

  assertPasswordLoginAllowed(req: Request): void {
    if (!this.isManualLoginAllowed(req)) {
      throw new ForbiddenException(
        "Password login is disabled for requests through the trusted SSO proxy.",
      );
    }
  }

  async loginForRequest(req: Request): Promise<TrustedSsoLoginResult> {
    const classification =
      AuthRequestContext.getTrustedSsoRequest() ?? this.classify(req);
    if (classification.kind !== "valid") {
      throw new UnauthorizedException("Invalid trusted proxy assertion");
    }

    const mapping = this.config.identities.get(classification.identity);
    if (!mapping) {
      throw new ForbiddenException("SSO identity is not authorized");
    }

    const cooldownUntil = this.failureCooldowns.get(classification.identity);
    if (cooldownUntil && cooldownUntil > Date.now()) {
      throw new HttpException(
        "SSO token validation is temporarily rate limited after a failure",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let validationPromise = this.validationFlights.get(classification.identity);
    if (!validationPromise) {
      validationPromise = this.validateMapping(mapping);
      this.validationFlights.set(classification.identity, validationPromise);
      void validationPromise
        .then(() => this.failureCooldowns.delete(classification.identity))
        .catch(() =>
          this.failureCooldowns.set(
            classification.identity,
            Date.now() + FAILURE_COOLDOWN_MS,
          ),
        )
        .finally(() => {
          if (
            this.validationFlights.get(classification.identity) ===
            validationPromise
          ) {
            this.validationFlights.delete(classification.identity);
          }
        });
    }

    const validation = await validationPromise;
    const tokensByNodeId = Object.fromEntries(
      validation.authenticatedNodeIds.map((nodeId) => [
        nodeId,
        validation.mapping.token,
      ]),
    );
    const session = this.sessionService.create(
      classification.identity,
      tokensByNodeId,
      validation.nodeAuthStatesByNodeId,
      {
        authSource: "trusted-sso",
        technitiumUser: validation.mapping.username,
        maxSessionsForUser: MAX_SESSIONS_PER_IDENTITY,
      },
    );

    return {
      session,
      response: {
        authenticated: true,
        nodes: this.nodeConfigs.map((node) => {
          const state = validation.nodeAuthStatesByNodeId[node.id];
          return {
            nodeId: node.id,
            success: state.status === "authenticated",
            authState: state.status,
            ...(state.error ? { error: state.error } : {}),
          };
        }),
      },
    };
  }

  private async validateMapping(
    mapping: TrustedSsoIdentityMapping,
  ): Promise<TrustedSsoValidation> {
    const results = await Promise.all(
      this.nodeConfigs.map(async (node) => {
        try {
          const tokenOwner =
            await this.technitiumService.validateExplicitSessionToken(
              node.id,
              mapping.token,
            );
          if (tokenOwner.username !== mapping.username) {
            return {
              nodeId: node.id,
              state: {
                status: "failed" as const,
                error: "Mapped token owner does not match configured username",
              },
            };
          }
          return {
            nodeId: node.id,
            state: { status: "authenticated" as const },
          };
        } catch (error) {
          const unreachable =
            error instanceof HttpException &&
            [
              HttpStatus.SERVICE_UNAVAILABLE,
              HttpStatus.GATEWAY_TIMEOUT,
            ].includes(error.getStatus());
          return {
            nodeId: node.id,
            state: {
              status: unreachable
                ? ("unreachable" as const)
                : ("failed" as const),
              error: unreachable
                ? "Technitium node is unreachable"
                : "Mapped token validation failed",
            },
          };
        }
      }),
    );

    const nodeAuthStatesByNodeId = Object.fromEntries(
      results.map(({ nodeId, state }) => [nodeId, state]),
    );
    const failed = results.filter(({ state }) => state.status === "failed");
    if (failed.length > 0) {
      throw new UnauthorizedException({
        message: "Trusted SSO token validation failed",
        nodes: failed.map(({ nodeId, state }) => ({
          nodeId,
          success: false,
          authState: state.status,
          error: state.error,
        })),
      });
    }

    const authenticatedNodeIds = results
      .filter(({ state }) => state.status === "authenticated")
      .map(({ nodeId }) => nodeId);
    if (authenticatedNodeIds.length === 0) {
      throw new ServiceUnavailableException(
        "No configured Technitium node is currently reachable",
      );
    }

    return { mapping, nodeAuthStatesByNodeId, authenticatedNodeIds };
  }

  private isManualLoginAllowed(req: Request): boolean {
    if (!this.config.enabled) {
      return true;
    }
    return (
      this.config.proxyCidrs.length > 0 && !this.isImmediatePeerTrusted(req)
    );
  }

  private isImmediatePeerTrusted(req: Request): boolean {
    if (this.config.proxyCidrs.length === 0) {
      return true;
    }
    const remoteAddress = req.socket?.remoteAddress;
    if (!remoteAddress) {
      return false;
    }
    return this.config.proxyCidrs.some((cidr) =>
      addressInCidr(remoteAddress, cidr),
    );
  }

  private readSingleHeader(req: Request, name: string): string | undefined {
    const rawHeaders = req.rawHeaders;
    if (Array.isArray(rawHeaders) && rawHeaders.length > 0) {
      const values: string[] = [];
      for (let index = 0; index < rawHeaders.length; index += 2) {
        if (rawHeaders[index]?.toLowerCase() === name) {
          values.push(rawHeaders[index + 1] ?? "");
        }
      }
      return values.length === 1 ? values[0] : undefined;
    }

    const value = req.headers[name];
    return typeof value === "string" ? value : undefined;
  }

  private secretMatches(suppliedSecret: string): boolean {
    if (!this.config.secretDigest) {
      return false;
    }
    const suppliedDigest = createHash("sha256")
      .update(suppliedSecret, "utf8")
      .digest();
    return timingSafeEqual(this.config.secretDigest, suppliedDigest);
  }

  private loadConfig(): TrustedSsoConfig {
    const enabled = readBoolean("TRUSTED_SSO_ENABLED", false);
    if (!enabled) {
      return {
        enabled,
        identityHeader: DEFAULT_IDENTITY_HEADER,
        secretHeader: DEFAULT_SECRET_HEADER,
        proxyCidrs: [],
        identities: new Map(),
      };
    }

    const identityHeader = readHeaderName(
      "TRUSTED_SSO_IDENTITY_HEADER",
      DEFAULT_IDENTITY_HEADER,
    );
    const secretHeader = readHeaderName(
      "TRUSTED_SSO_PROXY_SECRET_HEADER",
      DEFAULT_SECRET_HEADER,
    );
    if (identityHeader === secretHeader) {
      throw new Error(
        "TRUSTED_SSO_IDENTITY_HEADER and TRUSTED_SSO_PROXY_SECRET_HEADER must differ.",
      );
    }

    const secret = getEnvOrFile("TRUSTED_SSO_PROXY_SECRET");
    if (!secret || secret.length < 32) {
      throw new Error(
        "TRUSTED_SSO_PROXY_SECRET must contain at least 32 characters (directly or via TRUSTED_SSO_PROXY_SECRET_FILE).",
      );
    }

    const mapPath = process.env.TRUSTED_SSO_TOKEN_MAP_FILE?.trim();
    if (!mapPath) {
      throw new Error(
        "TRUSTED_SSO_TOKEN_MAP_FILE is required when trusted SSO is enabled.",
      );
    }

    const proxyCidrs = (process.env.TRUSTED_SSO_PROXY_CIDRS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map(parseCidr);
    const logoutUrl = parseLogoutUrl(process.env.TRUSTED_SSO_LOGOUT_URL);

    return {
      enabled,
      identityHeader,
      secretHeader,
      secretDigest: createHash("sha256").update(secret, "utf8").digest(),
      proxyCidrs,
      identities: this.loadTokenMap(mapPath),
      ...(logoutUrl ? { logoutUrl } : {}),
    };
  }

  private loadTokenMap(path: string): Map<string, TrustedSsoIdentityMapping> {
    let parsed: unknown;
    try {
      const source = readFileSync(path, "utf8");
      assertStrictJson(source);
      parsed = JSON.parse(source) as unknown;
    } catch {
      throw new Error(
        "TRUSTED_SSO_TOKEN_MAP_FILE must reference a readable, valid JSON file.",
      );
    }

    const root = requireObject(parsed, "token map");
    assertExactKeys(root, ["version", "identities"], "token map");
    if (root.version !== 1) {
      throw new Error("Trusted SSO token map version must be 1.");
    }
    const identities = requireObject(root.identities, "token map identities");
    if (Object.keys(identities).length === 0) {
      throw new Error(
        "Trusted SSO token map must contain at least one identity.",
      );
    }

    if (this.nodeConfigs.length === 0) {
      throw new Error(
        "Trusted SSO requires at least one configured Technitium node.",
      );
    }

    const mappings = new Map<string, TrustedSsoIdentityMapping>();
    for (const [identity, value] of Object.entries(identities)) {
      if (!IDENTITY_PATTERN.test(identity)) {
        throw new Error(
          `Trusted SSO token map contains a malformed identity key.`,
        );
      }
      const entry = requireObject(value, `identity mapping for ${identity}`);
      assertExactKeys(
        entry,
        ["username", "token"],
        `identity mapping for ${identity}`,
      );
      if (
        typeof entry.username !== "string" ||
        !IDENTITY_PATTERN.test(entry.username)
      ) {
        throw new Error(`Trusted SSO mapping has an invalid username.`);
      }
      if (typeof entry.token !== "string" || entry.token.length === 0) {
        throw new Error(
          "Trusted SSO mapping contains an empty or invalid cluster API token.",
        );
      }
      mappings.set(identity, {
        username: entry.username,
        token: entry.token,
      });
    }
    return mappings;
  }
}

function assertStrictJson(source: string): void {
  const errors: ParseError[] = [];
  const root = parseTree(source, errors, {
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (!root || errors.length > 0) {
    throw new Error("Invalid JSON");
  }

  const walk = (node: JsonNode): void => {
    if (node.type === "object") {
      const keys = new Set<string>();
      for (const property of node.children ?? []) {
        const key = property.children?.[0]?.value as unknown;
        if (typeof key !== "string" || keys.has(key)) {
          throw new Error("Duplicate JSON object key");
        }
        keys.add(key);
      }
    }
    for (const child of node.children ?? []) {
      walk(child);
    }
  };
  walk(root);
}

function readBoolean(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return defaultValue;
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be either "true" or "false".`);
}

function readHeaderName(name: string, defaultValue: string): string {
  const value = (process.env[name] ?? defaultValue).trim().toLowerCase();
  if (!value || !HEADER_NAME_PATTERN.test(value)) {
    throw new Error(`${name} must be a valid HTTP header name.`);
  }
  return value;
}

function parseLogoutUrl(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  ) {
    return value;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === ""
    ) {
      return url.toString();
    }
  } catch {
    // The shared error below deliberately excludes the configured value.
  }
  throw new Error(
    "TRUSTED_SSO_LOGOUT_URL must be an HTTPS URL or a relative path beginning with one slash.",
  );
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Trusted SSO ${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  object: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  const unexpected = Object.keys(object).filter(
    (key) => !allowed.includes(key),
  );
  const missing = allowed.filter((key) => !(key in object));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `Trusted SSO ${label} has an invalid schema (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}).`,
    );
  }
}

function parseCidr(value: string): ParsedCidr {
  const slash = value.indexOf("/");
  const address = slash === -1 ? value : value.slice(0, slash);
  const family = isIP(stripZone(address));
  if (family !== 4 && family !== 6) {
    throw new Error("TRUSTED_SSO_PROXY_CIDRS contains an invalid IP address.");
  }
  const maxPrefix = family === 4 ? 32 : 128;
  const prefixText = slash === -1 ? String(maxPrefix) : value.slice(slash + 1);
  if (!/^\d+$/.test(prefixText)) {
    throw new Error(
      "TRUSTED_SSO_PROXY_CIDRS contains an invalid prefix length.",
    );
  }
  const prefix = Number.parseInt(prefixText, 10);
  if (prefix < 0 || prefix > maxPrefix) {
    throw new Error(
      "TRUSTED_SSO_PROXY_CIDRS contains an invalid prefix length.",
    );
  }
  const numeric = parseIp(address, family);
  const hostBits = BigInt(maxPrefix - prefix);
  return {
    family,
    prefix,
    network: hostBits === 0n ? numeric : (numeric >> hostBits) << hostBits,
  };
}

function addressInCidr(address: string, cidr: ParsedCidr): boolean {
  const normalized = stripZone(address);
  let family = isIP(normalized);
  let candidate = normalized;
  if (family === 6 && /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(normalized)) {
    candidate = normalized.slice("::ffff:".length);
    family = 4;
  }
  if (family !== cidr.family) return false;
  const maxPrefix = family === 4 ? 32 : 128;
  const hostBits = BigInt(maxPrefix - cidr.prefix);
  const numeric = parseIp(candidate, family);
  const network = hostBits === 0n ? numeric : (numeric >> hostBits) << hostBits;
  return network === cidr.network;
}

function stripZone(address: string): string {
  const zoneIndex = address.indexOf("%");
  return zoneIndex === -1 ? address : address.slice(0, zoneIndex);
}

function parseIp(address: string, family: 4 | 6): bigint {
  if (family === 4) {
    return address
      .split(".")
      .map(Number)
      .reduce((result, part) => (result << 8n) | BigInt(part), 0n);
  }

  let normalized = stripZone(address).toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized
      .slice(lastColon + 1)
      .split(".")
      .map(Number);
    normalized = `${normalized.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const [leftText, rightText] = normalized.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  const omitted = 8 - left.length - right.length;
  const parts = normalized.includes("::")
    ? [...left, ...Array.from({ length: omitted }, () => "0"), ...right]
    : left;
  return parts.reduce(
    (result, part) => (result << 16n) | BigInt(Number.parseInt(part, 16)),
    0n,
  );
}
