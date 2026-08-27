import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { useAuth } from "../context/useAuth";

const redirectMock = vi.hoisted(() => vi.fn());
vi.mock("../utils/trustedSso", () => ({
  redirectToTrustedSsoLogout: redirectMock,
}));

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("trusted SSO authentication context", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider>{children}</AuthProvider>
  );
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.sessionStorage.clear();
    redirectMock.mockReset();
    fetchSpy = vi.spyOn(global, "fetch");
  });

  afterEach(() => fetchSpy.mockRestore());

  it("bootstraps SSO once and refreshes authenticated status", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        response({
          authenticated: false,
          trustedSso: {
            enabled: true,
            available: true,
            manualLoginAllowed: false,
          },
        }),
      )
      .mockResolvedValueOnce(response({ authenticated: true }))
      .mockResolvedValueOnce(
        response({
          authenticated: true,
          authSource: "trusted-sso",
          user: "alice@example.test",
          technitiumUser: "alice",
          trustedSso: {
            enabled: true,
            available: true,
            manualLoginAllowed: false,
          },
        }),
      );

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toMatchObject({
      authenticated: true,
      authSource: "trusted-sso",
      technitiumUser: "alice",
    });
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/me",
      "/api/auth/sso/login",
      "/api/auth/me",
    ]);
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });

  it("does not loop or retry automatically after SSO validation is denied", async () => {
    const available = {
      authenticated: false,
      trustedSso: {
        enabled: true,
        available: true,
        manualLoginAllowed: false,
      },
    };
    fetchSpy
      .mockResolvedValueOnce(response(available))
      .mockResolvedValueOnce(
        response({ message: "Trusted SSO token validation failed" }, 401),
      )
      .mockResolvedValueOnce(response(available));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() =>
      expect(result.current.error).toBe(
        "Trusted SSO token validation failed",
      ),
    );

    await act(async () => result.current.refresh());
    expect(
      fetchSpy.mock.calls.filter(([url]) => url === "/api/auth/sso/login"),
    ).toHaveLength(1);
  });

  it("suppresses automatic re-login after local SSO logout until continued", async () => {
    const authenticated = {
      authenticated: true,
      authSource: "trusted-sso",
      trustedSso: {
        enabled: true,
        available: true,
        manualLoginAllowed: false,
      },
    };
    const available = {
      authenticated: false,
      trustedSso: authenticated.trustedSso,
    };
    fetchSpy
      .mockResolvedValueOnce(response(authenticated))
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response(available))
      .mockResolvedValueOnce(response(available))
      .mockResolvedValueOnce(response({ authenticated: true }))
      .mockResolvedValueOnce(response(authenticated));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status?.authenticated).toBe(true));

    await act(async () => result.current.logout());
    expect(result.current.ssoSuppressed).toBe(true);
    expect(result.current.status?.authenticated).toBe(false);
    expect(
      fetchSpy.mock.calls.filter(([url]) => url === "/api/auth/sso/login"),
    ).toHaveLength(0);

    await act(async () => result.current.continueWithSso());
    expect(result.current.ssoSuppressed).toBe(false);
    expect(result.current.status?.authenticated).toBe(true);
    expect(
      fetchSpy.mock.calls.filter(([url]) => url === "/api/auth/sso/login"),
    ).toHaveLength(1);
  });

  it("redirects to the IdP logout URL after clearing the local session", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        response({
          authenticated: true,
          authSource: "trusted-sso",
          trustedSso: {
            enabled: true,
            available: true,
            manualLoginAllowed: false,
            logoutUrl: "https://idp.example.test/end-session/",
          },
        }),
      )
      .mockResolvedValueOnce(response({ ok: true }));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status?.authenticated).toBe(true));
    await act(async () => result.current.logout());

    expect(redirectMock).toHaveBeenCalledWith(
      "https://idp.example.test/end-session/",
    );
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
