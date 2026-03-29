import { expect, test } from "@playwright/test";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Navigate to /automation and wait for all pending API requests to settle. */
async function gotoAutomation(page: Parameters<Parameters<typeof test>[1]>[0]["page"]) {
  await page.goto("/automation");
  await page.waitForLoadState("networkidle");
}

// ── Tests that need a guaranteed-empty schedule list ──────────────────────────
//
// These intercept GET /rules before navigation so they don't race with
// schedule-creation tests that share the mock server's in-memory state.

test.describe("Automation page — empty state", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/nodes/dns-schedules/rules", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      } else {
        await route.continue();
      }
    });
    await gotoAutomation(page);
  });

  test("shows empty state when no schedules exist", async ({ page }) => {
    await expect(
      page.getByText("No schedules configured yet. Create one to get started."),
    ).toBeVisible();
  });

  test("Cancel button closes the form", async ({ page }) => {
    await page.getByRole("button", { name: /new schedule/i }).click();
    await expect(page.getByRole("heading", { name: "New Schedule" })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("heading", { name: "New Schedule" })).not.toBeVisible();
  });
});

// ── Tests that don't depend on schedule list contents ─────────────────────────

test.describe("Automation page", () => {
  test.beforeEach(async ({ page }) => {
    await gotoAutomation(page);
  });

  // ── Page structure ────────────────────────────────────────────────────────────

  test("renders the page heading and evaluator section", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "DNS Schedules" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Schedule Evaluator" })).toBeVisible();
  });

  test("shows Refresh and New Schedule buttons in the header", async ({ page }) => {
    await expect(page.getByRole("button", { name: /refresh/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /new schedule/i })).toBeVisible();
  });

  // ── Schedule form ─────────────────────────────────────────────────────────────

  test("New Schedule button opens the form", async ({ page }) => {
    await page.getByRole("button", { name: /new schedule/i }).click();

    await expect(page.getByRole("heading", { name: "New Schedule" })).toBeVisible();
    await expect(page.getByText("Schedule name")).toBeVisible();
    await expect(page.getByText("Advanced Blocking group", { exact: true })).toBeVisible();
    await expect(page.getByText("Start time (24h)")).toBeVisible();
  });

  test("New Schedule button is hidden while the form is open", async ({ page }) => {
    await page.getByRole("button", { name: /new schedule/i }).click();

    // The button is conditionally rendered (not just hidden), so it should not exist in the DOM.
    await expect(page.getByRole("button", { name: /new schedule/i })).not.toBeVisible();
  });

  test("form contains a Create Schedule submit button", async ({ page }) => {
    await page.getByRole("button", { name: /new schedule/i }).click();

    await expect(page.getByRole("button", { name: "Create Schedule" })).toBeVisible();
  });

  test("form contains day-of-week checkboxes", async ({ page }) => {
    await page.getByRole("button", { name: /new schedule/i }).click();

    for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      // exact:true avoids matching e.g. "allowed" (which contains "wed")
      await expect(page.getByText(day, { exact: true })).toBeVisible();
    }
  });

  // ── Schedule creation ─────────────────────────────────────────────────────────

  test("creating a schedule closes the form and shows it in the list", async ({ page }) => {
    await page.getByRole("button", { name: /new schedule/i }).click();

    // Fill required fields: name, AB group, and at least one domain entry.
    // Time fields are pre-filled by DEFAULT_DRAFT (22:00 / 06:00).
    await page.getByPlaceholder("e.g. Kids bedtime block").fill("Bedtime Block");
    await page.getByPlaceholder("e.g. Kids, Parents", { exact: true }).fill("KidsGroup");
    await page.getByPlaceholder(/social\.example\.com/).fill("example.com");

    await page.getByRole("button", { name: "Create Schedule" }).click();

    // Form closes and new schedule card is visible.
    await expect(page.getByRole("heading", { name: "New Schedule" })).not.toBeVisible();
    // exact:true avoids matching the transient toast "Schedule "Bedtime Block" created."
    await expect(page.getByText("Bedtime Block", { exact: true })).toBeVisible();
  });

  test("after creating a schedule the empty state is gone", async ({ page }) => {
    await page.getByRole("button", { name: /new schedule/i }).click();
    await page.getByPlaceholder("e.g. Kids bedtime block").fill("Morning Block");
    await page.getByPlaceholder("e.g. Kids, Parents", { exact: true }).fill("KidsGroup");
    await page.getByPlaceholder(/social\.example\.com/).fill("example.com");
    await page.getByRole("button", { name: "Create Schedule" }).click();

    await expect(
      page.getByText("No schedules configured yet. Create one to get started."),
    ).not.toBeVisible();
  });
});
