import { AdvancedBlockingService } from "./advanced-blocking.service";
import type { AdvancedBlockingConfig } from "./advanced-blocking.types";
import type { TechnitiumService } from "./technitium.service";

describe("AdvancedBlockingService.serializeConfig", () => {
  const createService = () => {
    const technitiumService = {} as unknown as TechnitiumService;
    return new AdvancedBlockingService(technitiumService);
  };

  const callSerialize = (
    service: AdvancedBlockingService,
    config: AdvancedBlockingConfig,
  ) => {
    type PrivateApi = {
      serializeConfig: (cfg: AdvancedBlockingConfig) => Record<string, unknown>;
    };
    const api = service as unknown as Partial<PrivateApi>;
    if (typeof api.serializeConfig !== "function") {
      throw new Error("serializeConfig is not available on service");
    }

    return api.serializeConfig(config);
  };

  it("includes blockingAnswerTtl when defined", () => {
    const service = createService();

    const payload = callSerialize(service, {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
      blockingAnswerTtl: 60,
    });

    expect(payload["blockingAnswerTtl"]).toBe(60);
  });

  it("coerces blockingAnswerTtl from a numeric string", () => {
    const service = createService();

    const config: AdvancedBlockingConfig & Record<string, unknown> = {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
    };
    // Simulate a client accidentally sending a string.
    config["blockingAnswerTtl"] = "60";

    const payload = callSerialize(service, config);

    expect(payload["blockingAnswerTtl"]).toBe(60);
  });

  it("preserves blockingAnswerTtl=0 (valid value)", () => {
    const service = createService();

    const payload = callSerialize(service, {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
      blockingAnswerTtl: 0,
    });

    expect(payload["blockingAnswerTtl"]).toBe(0);
  });

  it("omits blockingAnswerTtl when undefined", () => {
    const service = createService();

    const payload = callSerialize(service, {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
    });

    expect(
      Object.prototype.hasOwnProperty.call(payload, "blockingAnswerTtl"),
    ).toBe(false);
  });
});
