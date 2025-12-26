import "@testing-library/jest-dom/vitest";
import { act, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ListSourceEditor } from "../components/configuration/ListSourceEditor";
import type { AdvancedBlockingConfig } from "../types/advancedBlocking";

const createBaseConfig = (
  overrides: Partial<AdvancedBlockingConfig> = {},
): AdvancedBlockingConfig => {
  return {
    enableBlocking: true,
    blockListUrlUpdateIntervalHours: 4,
    blockListUrlUpdateIntervalMinutes: undefined,
    localEndPointGroupMap: {},
    networkGroupMap: {},
    groups: [
      {
        name: "Default",
        enableBlocking: true,
        allowTxtBlockingReport: false,
        blockAsNxDomain: false,
        blockingAddresses: [],
        allowed: [],
        blocked: [],
        allowListUrls: [],
        blockListUrls: [],
        allowedRegex: [],
        blockedRegex: [],
        regexAllowListUrls: [],
        regexBlockListUrls: [],
        adblockListUrls: [],
      },
    ],
    ...overrides,
  };
};

describe("ListSourceEditor refresh interval minutes", () => {
  it("allows deleting the default 0 while focused, then entering 30 without a leading zero", async () => {
    const user = userEvent.setup();

    const config = createBaseConfig({
      blockListUrlUpdateIntervalMinutes: undefined,
    });

    const { container } = render(
      <ListSourceEditor
        config={config}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const minutesInput = container.querySelector(
      'input[name="listRefreshMinutes"]',
    ) as HTMLInputElement | null;

    expect(minutesInput).not.toBeNull();
    if (!minutesInput) return;

    // When not focused, we display 0 by default.
    expect(minutesInput.value).toBe("0");

    // When focused, undefined minutes should temporarily render as empty
    // so users can type without fighting the controlled value.
    await user.click(minutesInput);
    await waitFor(() => expect(minutesInput.value).toBe(""));

    await user.type(minutesInput, "30");
    expect(minutesInput.value).toBe("30");

    // Blur should keep the typed value.
    act(() => {
      minutesInput.blur();
    });
    await waitFor(() => expect(minutesInput.value).toBe("30"));
  });

  it("restores minutes to 0 on blur when left empty", async () => {
    const user = userEvent.setup();

    const config = createBaseConfig({
      blockListUrlUpdateIntervalMinutes: undefined,
    });

    const { container } = render(
      <ListSourceEditor
        config={config}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const minutesInput = container.querySelector(
      'input[name="listRefreshMinutes"]',
    ) as HTMLInputElement | null;

    expect(minutesInput).not.toBeNull();
    if (!minutesInput) return;

    // Focus -> empty
    await user.click(minutesInput);
    await waitFor(() => expect(minutesInput.value).toBe(""));

    // Leave empty -> blur -> returns to 0
    act(() => {
      minutesInput.blur();
    });
    await waitFor(() => expect(minutesInput.value).toBe("0"));
  });
});
