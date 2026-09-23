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
import { isIP } from "node:net";
import type { Request } from "express";
import { TECHNITIUM_NODES_TOKEN } from "../technitium/technitium.constants";
import {
  configuredGroupIds,
  hasImplicitNodeGrouping,
  INTERNAL_DEFAULT_GROUP_ID,
  nodeGroupId,
} from "../technitium/technitium-config";
import { TechnitiumService } from "../technitium/technitium.service";
import type {
  TechnitiumCredentialProbe,
  TechnitiumNodeConfig,
} from "../technitium/technitium.types";
import { getEnvOrFile } from "../utils/env-file";
import { AuthRequestContext } from "./auth-request-context";
import { AuthSessionService } from "./auth-session.service";
import {
  assertExactKeys,
  isValidIdentity,
  parseGroupCredential,
  readStrictJsonFile,
  requireObject,
} from "./credential-map";
import {
  buildGroupCredentialEnvelope,
  emptyAdmissions,
  notAuthorizedGroupStatus,
  singularVerifiedUsername,
} from "./group-credentials";
import type { GroupCredential } from "./group-credentials";
import type {
  GroupCredentialStatus,
  GroupCredentialStatusEnvelope,
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
interface TrustedSsoIdentityMapping {
  groups: Map<string, GroupCredential>;
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
  groupCredentials: GroupCredentialStatusEnvelope;
  verifiedUsernamesByGroup: Record<string, string>;
  topologyDomainsByGroup: Record<string, string>;
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
      !isValidIdentity(identity) ||
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
    const tokensByNodeId: Record<string, string> = {};
    const pendingTokensByNodeId: Record<string, string> = {};
    const credentialUsernamesByGroup: Record<string, string> = {};
    for (const group of validation.groupCredentials.groups) {
      const credential = validation.mapping.groups.get(group.groupId);
      if (!credential) continue;
      credentialUsernamesByGroup[group.groupId] = credential.username;
      for (const nodeId of group.admittedNodeIds.interactive) {
        tokensByNodeId[nodeId] = credential.token;
      }
      if (group.state === "degraded" || group.state === "unreachable") {
        for (const nodeId of group.unreachableNodeIds) {
          pendingTokensByNodeId[nodeId] = credential.token;
        }
      }
    }
    const technitiumUser = singularVerifiedUsername(
      validation.verifiedUsernamesByGroup,
    );
    const session = this.sessionService.create(
      classification.identity,
      tokensByNodeId,
      validation.nodeAuthStatesByNodeId,
      {
        authSource: "trusted-sso",
        technitiumUser,
        verifiedUsernamesByGroup: validation.verifiedUsernamesByGroup,
        groupCredentials: validation.groupCredentials,
        pendingTokensByNodeId,
        credentialUsernamesByGroup,
        topologyDomainsByGroup: validation.topologyDomainsByGroup,
        maxSessionsForUser: MAX_SESSIONS_PER_IDENTITY,
      },
    );

    return {
      session,
      response: {
        authenticated: true,
        nodes: this.nodeConfigs.map((node) => {
          const state = validation.nodeAuthStatesByNodeId[node.id] ?? {
            status: "failed" as const,
            error: "SSO identity is not authorized for this node group",
          };
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
    const statuses: GroupCredentialStatus[] = [];
    const nodeAuthStatesByNodeId: Record<string, AuthNodeSessionState> = {};
    const verifiedUsernamesByGroup: Record<string, string> = {};
    const topologyDomainsByGroup: Record<string, string> = {};

    for (const groupId of configuredGroupIds(this.nodeConfigs)) {
      const credential = mapping.groups.get(groupId);
      if (!credential) {
        statuses.push(notAuthorizedGroupStatus(groupId));
        continue;
      }
      const groupNodes = this.nodeConfigs.filter(
        (node) => nodeGroupId(node) === groupId,
      );
      const status = await this.validateGroupCredential(
        groupId,
        groupNodes,
        credential,
        nodeAuthStatesByNodeId,
        topologyDomainsByGroup,
      );
      statuses.push(status);
      if (status.verifiedUsername) {
        verifiedUsernamesByGroup[groupId] = status.verifiedUsername;
      }
    }

    const groupCredentials = buildGroupCredentialEnvelope(statuses);
    if (!groupCredentials.anyReady) {
      if (statuses.some((status) => status.state === "failed")) {
        throw new UnauthorizedException({
          message: "Trusted SSO token validation failed",
          groups: statuses.map(({ groupId, state, reason }) => ({
            groupId,
            state,
            reason,
          })),
        });
      }
      throw new ServiceUnavailableException(
        "No authorized Technitium group has usable validated nodes",
      );
    }
    return {
      mapping,
      nodeAuthStatesByNodeId,
      groupCredentials,
      verifiedUsernamesByGroup,
      topologyDomainsByGroup,
    };
  }

  private async validateGroupCredential(
    groupId: string,
    nodes: TechnitiumNodeConfig[],
    credential: GroupCredential,
    nodeStates: Record<string, AuthNodeSessionState>,
    topologyDomainsByGroup: Record<string, string>,
  ): Promise<GroupCredentialStatus> {
    const results = await Promise.all(
      nodes.map(async (node) => {
        try {
          const probe =
            await this.technitiumService.validateExplicitSessionToken(
              node.id,
              credential.token,
            );
          if (probe.username !== credential.username) {
            throw new UnauthorizedException("Mapped token owner mismatch");
          }
          return { node, probe };
        } catch (error) {
          const unreachable =
            error instanceof HttpException &&
            [
              HttpStatus.SERVICE_UNAVAILABLE,
              HttpStatus.GATEWAY_TIMEOUT,
            ].includes(error.getStatus());
          const state: AuthNodeSessionState = {
            status: unreachable ? "unreachable" : "failed",
            error: unreachable
              ? "Technitium node is unreachable"
              : "Mapped token validation failed",
          };
          nodeStates[node.id] = state;
          return { node, state };
        }
      }),
    );
    const successful = results.filter(
      (
        result,
      ): result is {
        node: TechnitiumNodeConfig;
        probe: TechnitiumCredentialProbe;
      } => "probe" in result,
    );
    const unreachableNodeIds = results.flatMap((result) =>
      result.state?.status === "unreachable" ? [result.node.id] : [],
    );
    const failedNodeIds = results.flatMap((result) =>
      result.state?.status === "failed" ? [result.node.id] : [],
    );

    const topologyFailure = this.getTopologyFailure(nodes, successful);
    if (topologyFailure || failedNodeIds.length > 0) {
      for (const { node } of successful) {
        nodeStates[node.id] = {
          status: "failed",
          error: topologyFailure ?? "Group credential validation failed",
        };
      }
      return {
        groupId,
        state: "failed",
        authenticatedNodeIds: [],
        unreachableNodeIds,
        failedNodeIds: [
          ...new Set([
            ...failedNodeIds,
            ...successful.map(({ node }) => node.id),
          ]),
        ],
        admittedNodeIds: emptyAdmissions(),
        capabilities: {
          ptrRead: false,
          dhcpRead: false,
          primaryConfigWrite: false,
          cacheFlush: false,
        },
        reason:
          topologyFailure ?? "Mapped token validation failed for this group.",
      };
    }

    const topologyDomain = successful.find(
      ({ probe }) => probe.clusterInitialized && probe.clusterDomain,
    )?.probe.clusterDomain;
    if (topologyDomain) topologyDomainsByGroup[groupId] = topologyDomain;

    const admitted = emptyAdmissions();
    for (const { node, probe } of successful) {
      nodeStates[node.id] = { status: "authenticated" };
      admitted.interactive.push(node.id);
      if (probe.permissions?.["DnsClient"]?.canView === true) {
        admitted.ptrRead.push(node.id);
      }
      if (probe.permissions?.["DhcpServer"]?.canView === true) {
        admitted.dhcpRead.push(node.id);
      }
      const role = this.getConfiguredNodeRole(node, probe);
      if (
        probe.permissions?.["Apps"]?.canModify === true &&
        (role === "Primary" || !probe.clusterInitialized)
      ) {
        admitted.primaryConfigWrite.push(node.id);
      }
      if (probe.permissions?.["Cache"]?.canDelete === true) {
        admitted.cacheFlush.push(node.id);
      }
    }
    const state: GroupCredentialStatus["state"] =
      successful.length === 0
        ? "unreachable"
        : unreachableNodeIds.length > 0
          ? "degraded"
          : "ready";
    return {
      groupId,
      state,
      verifiedUsername: successful.length > 0 ? credential.username : undefined,
      authenticatedNodeIds: successful.map(({ node }) => node.id),
      unreachableNodeIds,
      failedNodeIds: [],
      admittedNodeIds: admitted,
      capabilities: {
        ptrRead: admitted.ptrRead.length > 0,
        dhcpRead: admitted.dhcpRead.length > 0,
        primaryConfigWrite: admitted.primaryConfigWrite.length > 0,
        cacheFlush: admitted.cacheFlush.length > 0,
      },
      ...(state === "unreachable"
        ? { reason: "Every configured node in this group is unreachable." }
        : {}),
    };
  }

  private getTopologyFailure(
    nodes: TechnitiumNodeConfig[],
    successful: Array<{
      node: TechnitiumNodeConfig;
      probe: TechnitiumCredentialProbe;
    }>,
  ): string | undefined {
    if (hasImplicitNodeGrouping(this.nodeConfigs)) return undefined;
    const domains = new Set(
      successful
        .filter(({ probe }) => probe.clusterInitialized)
        .map(({ probe }) => probe.clusterDomain ?? ""),
    );
    if (domains.size > 1) {
      return "Configured group members reported different cluster topology.";
    }
    if (
      nodes.length > 1 &&
      successful.some(({ probe }) => !probe.clusterInitialized)
    ) {
      return "A multi-node group contains a node that is not in the declared cluster.";
    }
    if (
      successful.some(
        ({ node, probe }) =>
          probe.clusterInitialized && !this.getConfiguredNodeRole(node, probe),
      )
    ) {
      return "A configured node could not be matched to its declared group topology.";
    }
    return undefined;
  }

  private getConfiguredNodeRole(
    node: TechnitiumNodeConfig,
    probe: TechnitiumCredentialProbe,
  ): "Primary" | "Secondary" | undefined {
    if (!probe.clusterInitialized) return undefined;
    const origin = safeOrigin(node.baseUrl);
    return (probe.clusterNodes ?? []).find((member) => {
      if (
        probe.dnsServerDomain &&
        member.name?.toLowerCase() === probe.dnsServerDomain.toLowerCase()
      )
        return true;
      if (member.name === node.id || member.name?.startsWith(`${node.id}.`))
        return true;
      return origin !== undefined && safeOrigin(member.url) === origin;
    })?.type;
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
    const root = requireObject(
      readStrictJsonFile(path, "TRUSTED_SSO_TOKEN_MAP_FILE"),
      "Trusted SSO token map",
    );
    assertExactKeys(root, ["version", "identities"], "token map");
    if (root.version !== 1 && root.version !== 2) {
      throw new Error("Trusted SSO token map version must be 1 or 2.");
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
      if (!isValidIdentity(identity)) {
        throw new Error(
          `Trusted SSO token map contains a malformed identity key.`,
        );
      }
      if (root.version === 1) {
        if (!hasImplicitNodeGrouping(this.nodeConfigs)) {
          throw new Error(
            "Trusted SSO token map version 1 is valid only with implicit single-group node configuration.",
          );
        }
        mappings.set(identity, {
          groups: new Map([
            [
              INTERNAL_DEFAULT_GROUP_ID,
              parseGroupCredential(value, "Trusted SSO identity mapping"),
            ],
          ]),
        });
        continue;
      }

      const entry = requireObject(value, "Trusted SSO identity mapping");
      assertExactKeys(entry, ["groups"], "Trusted SSO identity mapping");
      const rawGroups = requireObject(
        entry.groups,
        "Trusted SSO identity groups",
      );
      if (Object.keys(rawGroups).length === 0) {
        throw new Error(
          "Trusted SSO identities must authorize at least one group.",
        );
      }
      const knownGroups = new Set(configuredGroupIds(this.nodeConfigs));
      const groups = new Map<string, GroupCredential>();
      for (const [groupId, groupValue] of Object.entries(rawGroups)) {
        if (!knownGroups.has(groupId)) {
          throw new Error("Trusted SSO token map contains an unknown group.");
        }
        groups.set(
          groupId,
          parseGroupCredential(groupValue, "Trusted SSO group mapping"),
        );
      }
      mappings.set(identity, { groups });
    }
    return mappings;
  }
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

function safeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return undefined;
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
