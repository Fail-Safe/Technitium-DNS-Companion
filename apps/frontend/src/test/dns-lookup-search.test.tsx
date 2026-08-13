import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DnsLookupPage from "../pages/DnsLookupPage";

const { apiFetchMock, pushToastMock, technitiumStateMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  pushToastMock: vi.fn(),
  technitiumStateMock: {
    nodes: [
      {
        id: "node1",
        name: "Node 1",
        baseUrl: "https://node1.test",
        isPrimary: false,
      },
    ],
  },
}));

vi.mock("../config", () => ({
  apiFetch: apiFetchMock,
}));

vi.mock("../context/useToast", () => ({
  useToast: () => ({ pushToast: pushToastMock }),
}));

vi.mock("../context/useTechnitiumState", () => ({
  useTechnitiumState: () => technitiumStateMock,
}));

describe("DnsLookupPage All Domains search", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/advanced-blocking/node1") {
        return Promise.resolve(
          new Response(JSON.stringify({ config: { groups: [] } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (path.startsWith("/domain-lists/node1/all-domains?")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              domains: [],
              lastRefreshed: null,
              pagination: {
                page: 1,
                limit: 1000,
                total: 100001,
                totalPages: 101,
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests only the settled search value after the debounce", async () => {
    render(<DnsLookupPage />);

    fireEvent.click(screen.getByRole("button", { name: "All Domains" }));
    await act(async () => {
      vi.advanceTimersByTime(750);
      await Promise.resolve();
    });
    apiFetchMock.mockClear();

    const input = screen.getByPlaceholderText("Search domains...");
    fireEvent.change(input, { target: { value: "npm" } });
    fireEvent.change(input, { target: { value: "npm-cache" } });
    fireEvent.change(input, { target: { value: "npm-cache.com" } });

    const allDomainRequests = () =>
      apiFetchMock.mock.calls
        .map(([path]) => path as string)
        .filter((path) => path.startsWith("/domain-lists/node1/all-domains?"));

    expect(allDomainRequests()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(749);
      await Promise.resolve();
    });
    expect(allDomainRequests()).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(allDomainRequests()).toEqual([
      "/domain-lists/node1/all-domains?search=npm-cache.com&searchMode=text&page=1&limit=1000",
    ]);
  });
});
