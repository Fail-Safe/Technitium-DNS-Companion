import { expect, test } from "@playwright/test";

test("app loads and renders top nav", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/technitium/i);

  // From a user's perspective: the global nav should render.
  await expect(page.getByText("DNS Logs")).toBeVisible();
  await expect(page.getByText("DNS Zones")).toBeVisible();
});
