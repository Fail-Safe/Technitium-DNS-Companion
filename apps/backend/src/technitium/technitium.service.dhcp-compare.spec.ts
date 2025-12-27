import { TechnitiumService } from "./technitium.service";
import type { TechnitiumDhcpScope } from "./technitium.types";

// Minimal unit coverage for DHCP scope diff logic used by bulk sync.
// This ensures fields like pingCheckEnabled/Timeout/Retries are not ignored.

describe("TechnitiumService DHCP scope comparison", () => {
  const makeService = () =>
    new TechnitiumService(
      [],
      // The compare method is pure; snapshot service is not used in these tests.
      {} as unknown as any,
    );

  const baseScope = (): TechnitiumDhcpScope => ({
    name: "Test Scope",
    startingAddress: "192.168.1.10",
    endingAddress: "192.168.1.200",
    subnetMask: "255.255.255.0",
  });

  it("treats identical scopes as equal", () => {
    const service = makeService();

    const a: TechnitiumDhcpScope = {
      ...baseScope(),
      pingCheckEnabled: false,
      pingCheckTimeout: 1000,
      pingCheckRetries: 2,
    };

    const b: TechnitiumDhcpScope = {
      ...baseScope(),
      pingCheckEnabled: false,
      pingCheckTimeout: 1000,
      pingCheckRetries: 2,
    };

    const result = (service as any)["compareDhcpScopes"](a, b) as {
      equal: boolean;
      differences: string[];
    };

    expect(result.equal).toBe(true);
    expect(result.differences).toEqual([]);
  });

  it("includes ping check fields in differences", () => {
    const service = makeService();

    const source: TechnitiumDhcpScope = {
      ...baseScope(),
      pingCheckEnabled: true,
      pingCheckTimeout: 1000,
      pingCheckRetries: 2,
    };

    const target: TechnitiumDhcpScope = {
      ...baseScope(),
      pingCheckEnabled: false,
      pingCheckTimeout: 250,
      pingCheckRetries: 1,
    };

    const result = (service as any)["compareDhcpScopes"](source, target) as {
      equal: boolean;
      differences: string[];
    };

    expect(result.equal).toBe(false);

    const joined = result.differences.join("\n");
    expect(joined).toContain("Ping check enabled");
    expect(joined).toContain("Ping check timeout");
    expect(joined).toContain("Ping check retries");
  });
});
