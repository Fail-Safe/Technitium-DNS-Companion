import { AdvancedBlockingService } from "./advanced-blocking.service";
import type { TechnitiumService } from "./technitium.service";

describe("AdvancedBlockingService.serializeConfig", () => {
  const createService = () => {
    const technitiumService = {} as unknown as TechnitiumService;
    return new AdvancedBlockingService(technitiumService);
  };

  const callSerialize = (
    service: AdvancedBlockingService,
    config: Parameters<
      (AdvancedBlockingService & Record<string, unknown>)["serializeConfig"]
    >[0],
  ) => {
    const serialize = (service as unknown as Record<string, unknown>)[
      "serializeConfig"
    ];
    if (typeof serialize !== "function") {
      throw new Error("serializeConfig is not available on service");
    }

    return (serialize as (cfg: typeof config) => Record<string, unknown>).call(
      service,
      config,
    );
  };

  it("includes blockingAnswerTtl when defined", () => {
    const service = createService();

    const payload = callSerialize(service, {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
      blockingAnswerTtl: 60,
    });

    expect(payload.blockingAnswerTtl).toBe(60);
  });

  it("coerces blockingAnswerTtl from a numeric string", () => {
    const service = createService();

    const payload = callSerialize(service, {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
      // Simulate a client accidentally sending a string.
      blockingAnswerTtl: "60" as unknown as number,
    });

    expect(payload.blockingAnswerTtl).toBe(60);
  });

  it("preserves blockingAnswerTtl=0 (valid value)", () => {
    const service = createService();

    const payload = callSerialize(service, {
      localEndPointGroupMap: {},
      networkGroupMap: {},
      groups: [],
      blockingAnswerTtl: 0,
    });

    expect(payload.blockingAnswerTtl).toBe(0);
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
