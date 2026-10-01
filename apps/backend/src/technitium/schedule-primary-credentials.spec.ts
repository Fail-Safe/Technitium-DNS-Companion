import { Logger } from "@nestjs/common";
import { DatabaseSync } from "node:sqlite";
import axios, { type AxiosRequestConfig } from "axios";
import { AuthRequestContext } from "../auth/auth-request-context";
import type { AuthSession } from "../auth/auth.types";
import { AdvancedBlockingPauseStateService } from "./advanced-blocking-pause-state.service";
import { AdvancedBlockingPauseService } from "./advanced-blocking-pause.service";
import { AdvancedBlockingService } from "./advanced-blocking.service";
import { DhcpSnapshotService } from "./dhcp-snapshot.service";
import { TechnitiumService } from "./technitium.service";

describe("schedule credentials with node-local cluster tokens", () => {
  const originalEnv = { ...process.env };
  const scheduleToken = "test-primary-only-schedule-secret";
  const sessionToken = "test-interactive-session-secret";
  let tech: TechnitiumService;
  let advanced: AdvancedBlockingService;
  let pause: AdvancedBlockingPauseService;
  let state: AdvancedBlockingPauseStateService;
  let db: DatabaseSync;
  let primary: string | undefined;
  let secondaryState: "invalid" | "unreachable" | "valid";
  let rejectPrimary: boolean;
  let appsModify: boolean;
  let raw: string;
  let writes: Array<{ node: string; token: string }>;
  let logs: unknown[][];
  const session: AuthSession = {
    id: "session",
    createdAt: "",
    lastSeenAt: 0,
    user: "operator",
    authSource: "password",
    tokensByNodeId: { dns1: sessionToken, dns2: sessionToken },
  };
  const inSession = <T>(fn: () => T) => AuthRequestContext.run({ session }, fn);
  const nodes = ["dns1", "dns2"].map((id) => ({
    id,
    groupId: "__default__",
    baseUrl: "https://" + id + ".invalid",
    token: "",
  }));

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "test",
      TECHNITIUM_SCHEDULE_TOKEN: scheduleToken,
    };
    delete process.env.TECHNITIUM_SCHEDULE_TOKEN_FILE;
    delete process.env.TECHNITIUM_SCHEDULE_TOKEN_MAP_FILE;
    delete process.env.TECHNITIUM_BACKGROUND_TOKEN;
    delete process.env.TECHNITIUM_BACKGROUND_TOKEN_FILE;
    delete process.env.TECHNITIUM_BACKGROUND_TOKEN_MAP_FILE;
    primary = "dns1";
    secondaryState = "invalid";
    rejectPrimary = false;
    appsModify = true;
    raw =
      '{"enableBlocking":true,"groups":[],"localEndPointGroupMap":{},"networkGroupMap":{}}';
    writes = [];
    logs = [];
    for (const method of ["log", "warn", "error", "debug"] as const) {
      jest
        .spyOn(Logger.prototype, method)
        .mockImplementation((...args: unknown[]) => {
          logs.push(args);
        });
    }
    jest
      .spyOn(axios, "request")
      .mockImplementation((config: AxiosRequestConfig) => {
        const node = new URL(config.baseURL!).hostname.split(".")[0];
        const params = config.params as Record<string, string>;
        const token = params.token;
        if (token === scheduleToken) {
          if (
            (node === "dns1" && rejectPrimary) ||
            (node === "dns2" && secondaryState === "invalid")
          )
            return Promise.resolve({ data: { status: "invalid-token" } });
          if (node === "dns2" && secondaryState === "unreachable")
            return Promise.reject(
              Object.assign(new Error("unreachable"), {
                isAxiosError: true,
                code: "ECONNREFUSED",
              }),
            );
        } else if (token !== sessionToken) {
          return Promise.resolve({ data: { status: "invalid-token" } });
        }
        if (config.url === "/api/user/session/get") {
          return Promise.resolve({
            data: {
              status: "ok",
              username: token === scheduleToken ? "companion" : "operator",
              info: {
                clusterInitialized: true,
                clusterDomain: "cluster.test",
                dnsServerDomain: node + ".cluster.test",
                permissions: {
                  Apps: {
                    canView: true,
                    canModify: token === sessionToken || appsModify,
                  },
                  Cache: { canDelete: true },
                },
                clusterNodes: nodes.map((n) => ({
                  name: n.id + ".cluster.test",
                  url: n.baseUrl,
                  type: n.id === primary ? "Primary" : "Secondary",
                  state: "Connected",
                })),
              },
            },
          });
        }
        if (config.url === "/api/apps/config/get")
          return Promise.resolve({
            data: { status: "ok", response: { config: raw } },
          });
        if (config.url === "/api/apps/config/set") {
          writes.push({ node, token });
          raw = new URLSearchParams(config.data as string).get("config")!;
          return Promise.resolve({ data: { status: "ok" } });
        }
        throw new Error("Unexpected transport path");
      });
    // Run actual validation lazily after each scenario configures its transport.
    jest
      .spyOn(
        TechnitiumService.prototype as unknown as {
          scheduleEagerScheduleTokenValidation: () => void;
        },
        "scheduleEagerScheduleTokenValidation",
      )
      .mockImplementation(() => undefined);
    tech = new TechnitiumService(nodes, new DhcpSnapshotService());
    db = new DatabaseSync(":memory:");
    state = new AdvancedBlockingPauseStateService({ db } as never);
    state.onModuleInit();
    advanced = new AdvancedBlockingService(tech, undefined, undefined, state);
    pause = new AdvancedBlockingPauseService(
      state,
      advanced,
      {
        runNow: () => Promise.resolve({ errored: 0, pendingRecoveryCount: 0 }),
      } as never,
      tech,
    );
  });

  afterEach(() => {
    expect(JSON.stringify(logs).includes(scheduleToken)).toBe(false);
    expect(JSON.stringify(logs).includes(sessionToken)).toBe(false);
    tech.onModuleDestroy();
    db.close();
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it.each(["invalid", "unreachable"] as const)(
    "admits the confirmed Primary when the Secondary is %s and pauses with only the schedule token",
    async (secondary) => {
      secondaryState = secondary;
      const result = await inSession(() => pause.pause(5));
      expect(result.paused).toBe(true);
      expect(writes).toEqual([{ node: "dns1", token: scheduleToken }]);
      expect(JSON.parse(raw) as { enableBlocking: boolean }).toMatchObject({
        enableBlocking: false,
      });
      const status = tech.getScheduleTokenStatus();
      expect(status.valid).toBe(true);
      expect(status.groups?.groups[0]).toMatchObject({
        state: "degraded",
        authenticatedNodeIds: ["dns1"],
        primaryCredential: { state: "ready", nodeId: "dns1" },
        failoverCoverage: "partial",
        secondaryCredentialUnavailableNodeIds: ["dns2"],
        admittedNodeIds: { primaryConfigWrite: ["dns1"], cacheFlush: ["dns1"] },
        capabilities: { primaryConfigWrite: true },
      });
      const publicOutput = JSON.stringify({ result, status, logs });
      expect(publicOutput.includes(scheduleToken)).toBe(false);
      expect(publicOutput.includes(sessionToken)).toBe(false);
    },
  );

  it.each(["invalid-primary", "missing-permission", "no-primary"] as const)(
    "fails closed for %s without ownership or a remote write",
    async (failure) => {
      if (failure === "invalid-primary") rejectPrimary = true;
      if (failure === "missing-permission") appsModify = false;
      if (failure === "no-primary") primary = undefined;
      await expect(inSession(() => pause.pause(5))).rejects.toBeDefined();
      expect(writes).toEqual([]);
      expect(state.list()).toEqual([]);
      expect(tech.getScheduleTokenStatus().valid).not.toBe(true);
    },
  );

  it("fails closed after dns2 becomes Primary with only the dns1 token", async () => {
    await inSession(() => pause.pause(5));
    primary = "dns2";
    const before = state.list();
    const operation = inSession(() => pause.pause(10));
    await expect(operation).rejects.toMatchObject({ status: 503 });
    await expect(operation).rejects.toThrow("TECHNITIUM_SCHEDULE_TOKEN");
    expect(writes).toHaveLength(1);
    expect(state.list()).toEqual(before);
    expect(tech.getScheduleTokenStatus()).toMatchObject({
      valid: false,
      groups: {
        groups: [
          {
            primaryCredential: { state: "unavailable" },
            failoverCoverage: "none",
            capabilities: { primaryConfigWrite: false },
          },
        ],
      },
    });
    expect(tech.getScheduleTokenStatus().groups?.groups[0].reason).toContain(
      "current Primary",
    );
  });

  it("refreshes admission after promotion if the configured token also authenticates the new Primary", async () => {
    secondaryState = "valid";
    await inSession(() => pause.pause(5));
    primary = "dns2";
    const result = await inSession(() => pause.pause(10));
    expect(result.paused).toBe(true);
    await inSession(() => pause.resumeNow());
    expect(writes.at(-1)).toEqual({ node: "dns2", token: scheduleToken });
    expect(
      tech.getScheduleTokenStatus().groups?.groups[0].primaryCredential,
    ).toEqual({
      state: "ready",
      nodeId: "dns2",
    });
  });

  it("rechecks the exact Primary before a direct schedule config POST", async () => {
    await tech.listNodes({ authMode: "schedule" });
    primary = "dns2";
    await expect(
      tech.request(
        nodes[0],
        {
          method: "POST",
          url: "/api/apps/config/set",
          data: "config={}",
        },
        { authMode: "schedule" },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(writes).toEqual([]);
  });

  it("keeps Primary write admission when a previously valid Secondary token is rejected", async () => {
    secondaryState = "valid";
    await tech.listNodes({ authMode: "schedule" });
    secondaryState = "invalid";
    await expect(
      tech.request(
        nodes[1],
        {
          method: "GET",
          url: "/api/apps/config/get",
        },
        { authMode: "schedule" },
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(tech.getScheduleTokenStatus()).toMatchObject({
      valid: true,
      groups: {
        groups: [
          {
            state: "degraded",
            failoverCoverage: "partial",
            capabilities: { primaryConfigWrite: true },
          },
        ],
      },
    });
    const target = await advanced.resolvePauseTarget("dns2", "schedule");
    expect(target.writeNodeId).toBe("dns1");
  });
});
