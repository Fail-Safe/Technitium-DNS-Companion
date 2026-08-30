import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GroupCredentialStatusBanner } from "../components/common/GroupCredentialStatusBanner";
import type { GroupCredentialStatus } from "../types/auth";

const status = (
  groupId: string,
  state: GroupCredentialStatus["state"],
  reason?: string,
): GroupCredentialStatus => ({
  groupId,
  state,
  authenticatedNodeIds: [],
  unreachableNodeIds: [],
  failedNodeIds: [],
  admittedNodeIds: {
    interactive: [],
    ptrRead: [],
    dhcpRead: [],
    primaryConfigWrite: [],
    cacheFlush: [],
  },
  capabilities: {
    ptrRead: false,
    dhcpRead: false,
    primaryConfigWrite: false,
    cacheFlush: false,
  },
  reason,
});

describe("GroupCredentialStatusBanner", () => {
  it("surfaces degraded and failed groups with their sanitized reasons", () => {
    render(
      <GroupCredentialStatusBanner
        credentials={{
          anyReady: true,
          allReady: false,
          groups: [
            status("site-a", "degraded", "Primary is unreachable."),
            status("site-b", "failed", "Token owner mismatch."),
          ],
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "site-a: degraded (Primary is unreachable.)",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "site-b: failed (Token owner mismatch.)",
    );
  });

  it("does not present an intentionally unauthorized group as an error", () => {
    const { container } = render(
      <GroupCredentialStatusBanner
        credentials={{
          anyReady: true,
          allReady: true,
          groups: [
            status("site-a", "ready"),
            status("site-b", "not-authorized"),
          ],
        }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
