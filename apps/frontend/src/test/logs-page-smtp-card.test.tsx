import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LogsPage from "../pages/LogsPage";

const {
  apiFetchMock,
  pushToastMock,
  technitiumStateMock,
  smtpStatusResponse,
  logAlertCapabilitiesResponse,
  logAlertRulesStatusResponse,
  logAlertRulesResponse,
} = vi.hoisted(() => {
  const now = new Date().toISOString();

  return {
    apiFetchMock: vi.fn(),
    pushToastMock: vi.fn(),
    technitiumStateMock: {
      nodes: [
        {
          id: "node1",
          name: "Node 1",
          baseUrl: "http://node1.test",
          isPrimary: true,
          hasAdvancedBlocking: false,
          clusterState: {
            type: "Standalone",
            initialized: true,
            health: "healthy",
          },
        },
      ],
      loadCombinedLogs: vi.fn().mockResolvedValue({
        fetchedAt: now,
        pageNumber: 1,
        entriesPerPage: 25,
        totalPages: 1,
        totalEntries: 0,
        totalMatchingEntries: 0,
        descendingOrder: true,
        entries: [],
        nodes: [],
      }),
      loadNodeLogs: vi.fn().mockResolvedValue({
        nodeId: "node1",
        fetchedAt: now,
        data: {
          pageNumber: 1,
          totalPages: 1,
          totalEntries: 0,
          totalMatchingEntries: 0,
          entries: [],
        },
      }),
      loadStoredCombinedLogs: vi.fn().mockResolvedValue({
        fetchedAt: now,
        pageNumber: 1,
        entriesPerPage: 25,
        totalPages: 1,
        totalEntries: 0,
        totalMatchingEntries: 0,
        descendingOrder: true,
        entries: [],
        nodes: [],
      }),
      loadStoredNodeLogs: vi.fn().mockResolvedValue({
        nodeId: "node1",
        fetchedAt: now,
        data: {
          pageNumber: 1,
          totalPages: 1,
          totalEntries: 0,
          totalMatchingEntries: 0,
          entries: [],
        },
      }),
      loadQueryLogStorageStatus: vi.fn().mockResolvedValue({
        enabled: true,
        ready: false,
        retentionHours: 24,
        pollIntervalMs: 10000,
      }),
      advancedBlocking: undefined,
      loadingAdvancedBlocking: false,
      advancedBlockingError: undefined,
      reloadAdvancedBlocking: vi.fn().mockResolvedValue(undefined),
      saveAdvancedBlockingConfig: vi.fn().mockResolvedValue(undefined),
      blockingStatus: { nodes: [] },
      loadingBlockingStatus: false,
      reloadBlockingStatus: vi.fn().mockResolvedValue(undefined),
      addAllowedDomain: vi
        .fn()
        .mockResolvedValue({ success: true, message: "ok" }),
      addBlockedDomain: vi
        .fn()
        .mockResolvedValue({ success: true, message: "ok" }),
      deleteAllowedDomain: vi
        .fn()
        .mockResolvedValue({ success: true, message: "ok" }),
      deleteBlockedDomain: vi
        .fn()
        .mockResolvedValue({ success: true, message: "ok" }),
    },
    smtpStatusResponse: {
      configured: true,
      ready: true,
      secure: false,
      host: "smtp.example.com",
      port: 587,
      from: "alerts@example.com",
      authConfigured: true,
      missing: [],
    },
    logAlertCapabilitiesResponse: {
      outcomeModes: ["blocked-only", "all-outcomes"],
      domainPatternTypes: ["exact", "wildcard", "regex"],
      defaults: {
        outcomeMode: "blocked-only",
        domainPatternType: "exact",
        debounceSeconds: 900,
      },
      notes: [],
    },
    logAlertRulesStatusResponse: {
      enabled: true,
      ready: true,
      dbPath: "/data/log-alert-rules.sqlite",
    },
    logAlertRulesResponse: [
      {
        id: "rule-1",
        name: "Blocked ads for kid tablet",
        enabled: true,
        outcomeMode: "blocked-only",
        domainPattern: "*.ads.example.com",
        domainPatternType: "wildcard",
        clientIdentifier: "kid-tablet",
        advancedBlockingGroupName: "Kids",
        debounceSeconds: 900,
        emailRecipients: ["alerts@example.com"],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
});

vi.mock("../config", () => ({
  apiFetch: apiFetchMock,
  getAuthRedirectReason: () => null,
}));

vi.mock("../context/useToast", () => ({
  useToast: () => ({ pushToast: pushToastMock }),
}));

vi.mock("../context/useTechnitiumState", () => ({
  useTechnitiumState: () => technitiumStateMock,
}));

describe("LogsPage SMTP card", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/nodes/log-alerts/capabilities") {
        return Promise.resolve(
          new Response(JSON.stringify(logAlertCapabilitiesResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (path === "/nodes/log-alerts/rules/status") {
        return Promise.resolve(
          new Response(JSON.stringify(logAlertRulesStatusResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (path === "/nodes/log-alerts/evaluator/status") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              enabled: true,
              running: false,
              intervalMs: 60000,
              maxEntriesPerPage: 500,
              maxPagesPerRun: 3,
              lookbackSeconds: 900,
              sqliteReady: true,
              smtpReady: true,
              lastRunAt: null,
              lastAlertsSent: 0,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (
        path === "/nodes/log-alerts/rules" &&
        (init?.method ?? "GET") === "GET"
      ) {
        return Promise.resolve(
          new Response(JSON.stringify(logAlertRulesResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (path === "/nodes/log-alerts/rules" && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "rule-2",
              name: "Manual test rule",
              enabled: true,
              outcomeMode: "blocked-only",
              domainPattern: "*.tracking.example.com",
              domainPatternType: "wildcard",
              debounceSeconds: 300,
              emailRecipients: ["admin@example.com"],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (
        path === "/nodes/log-alerts/rules/rule-1/enabled" &&
        init?.method === "PATCH"
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...logAlertRulesResponse[0],
              enabled: false,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (
        path === "/nodes/log-alerts/rules/rule-1" &&
        init?.method === "DELETE"
      ) {
        return Promise.resolve(
          new Response(JSON.stringify({ deleted: true, ruleId: "rule-1" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (
        path === "/nodes/log-alerts/evaluator/run" &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              dryRun: false,
              scannedEntries: 42,
              evaluatedRules: 1,
              matchedRules: 1,
              alertsSent: 1,
              triggeredAt: now,
              rules: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/nodes/log-alerts/smtp/status") {
        return Promise.resolve(
          new Response(JSON.stringify(smtpStatusResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (path === "/nodes/log-alerts/smtp/test") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              accepted: ["admin@example.com"],
              rejected: [],
              messageId: "test-message-id",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
  });

  it("renders SMTP status details from the backend", async () => {
    render(<LogsPage />);

    expect(
      await screen.findByRole("heading", { name: "Log Alert SMTP Settings" }),
    ).toBeInTheDocument();

    const smtpCard = screen.getByRole("region", {
      name: "Log Alert SMTP Settings",
    });

    await waitFor(() => {
      expect(
        within(smtpCard).getByText("smtp.example.com"),
      ).toBeInTheDocument();
      expect(
        within(smtpCard).getByText("alerts@example.com"),
      ).toBeInTheDocument();
      expect(within(smtpCard).getByText("Ready")).toBeInTheDocument();
    });

    expect(apiFetchMock).toHaveBeenCalledWith("/nodes/log-alerts/smtp/status");
  });

  it("submits SMTP test email payload to backend", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);

    await screen.findByRole("heading", { name: "Log Alert SMTP Settings" });
    const smtpCard = screen.getByRole("region", {
      name: "Log Alert SMTP Settings",
    });

    await user.type(
      within(smtpCard).getByLabelText(/Recipients \(comma-separated\)/i),
      "admin@example.com, parent@example.com",
    );
    await user.clear(within(smtpCard).getByLabelText(/Subject/i));
    await user.type(
      within(smtpCard).getByLabelText(/Subject/i),
      "SMTP test from logs page",
    );

    apiFetchMock.mockClear();

    await user.click(
      within(smtpCard).getByRole("button", { name: /Send test email/i }),
    );

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/nodes/log-alerts/smtp/test",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const [, requestInit] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as {
      to: string[];
      subject?: string;
      text?: string;
    };

    expect(body.to).toEqual(["admin@example.com", "parent@example.com"]);
    expect(body.subject).toBe("SMTP test from logs page");
    expect(typeof body.text).toBe("string");

    await waitFor(() => {
      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({ tone: "success" }),
      );
    });
  });

  it("shows missing SMTP config and surfaces send failure", async () => {
    const user = userEvent.setup();

    apiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/nodes/log-alerts/capabilities") {
        return Promise.resolve(
          new Response(JSON.stringify(logAlertCapabilitiesResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (path === "/nodes/log-alerts/rules/status") {
        return Promise.resolve(
          new Response(JSON.stringify(logAlertRulesStatusResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (
        path === "/nodes/log-alerts/rules" &&
        (init?.method ?? "GET") === "GET"
      ) {
        return Promise.resolve(
          new Response(JSON.stringify(logAlertRulesResponse), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (path === "/nodes/log-alerts/smtp/status") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              configured: false,
              ready: false,
              secure: false,
              host: "smtp.example.com",
              port: 587,
              from: "",
              authConfigured: false,
              missing: ["SMTP_FROM", "SMTP_USER", "SMTP_PASS"],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (path === "/nodes/log-alerts/smtp/test") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: "SMTP is not fully configured.",
              missing: ["SMTP_FROM", "SMTP_USER", "SMTP_PASS"],
            }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    render(<LogsPage />);

    await screen.findByRole("heading", { name: "Log Alert SMTP Settings" });
    const smtpCard = screen.getByRole("region", {
      name: "Log Alert SMTP Settings",
    });

    await waitFor(() => {
      expect(
        within(smtpCard).getByText(
          /Missing env vars: SMTP_FROM, SMTP_USER, SMTP_PASS/i,
        ),
      ).toBeInTheDocument();
      expect(within(smtpCard).getByText("Not ready")).toBeInTheDocument();
    });

    await user.type(
      within(smtpCard).getByLabelText(/Recipients \(comma-separated\)/i),
      "admin@example.com",
    );

    apiFetchMock.mockClear();

    await user.click(
      within(smtpCard).getByRole("button", { name: /Send test email/i }),
    );

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/nodes/log-alerts/smtp/test",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(pushToastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tone: "error",
          message: expect.stringContaining("SMTP is not fully configured."),
        }),
      );
    });
  });

  it("re-fetches SMTP status when refresh button is clicked", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);

    await screen.findByRole("heading", { name: "Log Alert SMTP Settings" });

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/nodes/log-alerts/smtp/status",
      );
    });

    const initialStatusCalls = apiFetchMock.mock.calls.filter(
      ([path]) => path === "/nodes/log-alerts/smtp/status",
    ).length;

    await user.click(screen.getByRole("button", { name: /Refresh status/i }));

    await waitFor(() => {
      const statusCalls = apiFetchMock.mock.calls.filter(
        ([path]) => path === "/nodes/log-alerts/smtp/status",
      ).length;
      expect(statusCalls).toBeGreaterThan(initialStatusCalls);
    });
  });

  it("renders log alert rules and allows toggling enabled state", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);

    expect(
      await screen.findByRole("heading", { name: "Log Alert Rules" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Blocked ads for kid tablet"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/nodes/log-alerts/rules/rule-1/enabled",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("submits new log alert rule payload to backend", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);

    await screen.findByRole("heading", { name: "Log Alert Rules" });

    await user.type(screen.getByLabelText(/Rule name/i), "Manual test rule");
    await user.type(
      screen.getByLabelText(/^Domain pattern$/i),
      "*.tracking.example.com",
    );
    await user.clear(screen.getByLabelText(/Debounce seconds/i));
    await user.type(screen.getByLabelText(/Debounce seconds/i), "300");
    await user.type(
      screen.getByLabelText(/Email recipients \(comma-separated\)/i),
      "admin@example.com",
    );

    apiFetchMock.mockClear();
    await user.click(screen.getByRole("button", { name: /Create rule/i }));

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/nodes/log-alerts/rules",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const [, requestInit] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as {
      rule: {
        name: string;
        domainPattern: string;
        debounceSeconds: number;
        emailRecipients: string[];
      };
    };

    expect(body.rule.name).toBe("Manual test rule");
    expect(body.rule.domainPattern).toBe("*.tracking.example.com");
    expect(body.rule.debounceSeconds).toBe(300);
    expect(body.rule.emailRecipients).toEqual(["admin@example.com"]);
  });

  it("runs log alert evaluator from Logs page", async () => {
    const user = userEvent.setup();
    render(<LogsPage />);

    await screen.findByRole("heading", { name: "Log Alert Rules" });

    apiFetchMock.mockClear();
    await user.click(
      screen.getByRole("button", { name: /Run evaluator now/i }),
    );

    await waitFor(() => {
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/nodes/log-alerts/evaluator/run",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
