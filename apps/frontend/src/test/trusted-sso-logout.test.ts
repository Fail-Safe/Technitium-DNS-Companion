import { describe, expect, it, vi } from "vitest";
import { redirectToTrustedSsoLogout } from "../utils/trustedSso";

describe("trusted SSO IdP logout", () => {
  it("redirects to the validated logout URL supplied by the backend", () => {
    const navigate = vi.fn();
    redirectToTrustedSsoLogout(
      "https://idp.example.test/application/o/companion/end-session/",
      navigate,
    );
    expect(navigate).toHaveBeenCalledWith(
      "https://idp.example.test/application/o/companion/end-session/",
    );
  });
});
