import { BuiltInBlockingService } from "./built-in-blocking.service";
import type { TechnitiumApiResponse } from "./technitium.types";
import type { TechnitiumService } from "./technitium.service";

describe("BuiltInBlockingService - export parsing", () => {
  it("preserves wildcard entries from export and strips comments/blank lines", async () => {
    const exportPayload = [
      "# built-in blocking export",
      "",
      "*.zeronet.org",
      "*.zeroeu.uk",
      "# trailing comment",
      "",
    ].join("\n");

    const executeAction = jest
      .fn()
      .mockImplementation((_nodeId: string, options: { url: string }) => {
        if (options.url === "/api/blocked/export") {
          // Export endpoint returns plain text
          return exportPayload as unknown as TechnitiumApiResponse<string>;
        }
        throw new Error(`Unexpected URL: ${options.url}`);
      });

    const fakeTechnitiumService = {
      executeAction,
    } as unknown as TechnitiumService;

    const service = new BuiltInBlockingService(fakeTechnitiumService);

    const result = await service.listBlockedZones("node1");

    expect(result.domains.map((d) => d.domain)).toEqual([
      "*.zeronet.org",
      "*.zeroeu.uk",
    ]);
    expect(executeAction).toHaveBeenCalledWith(
      "node1",
      expect.objectContaining({ method: "GET", url: "/api/blocked/export" }),
    );
  });
});
