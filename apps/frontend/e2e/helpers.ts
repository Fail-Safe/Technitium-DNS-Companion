import { Page, expect } from '@playwright/test';

/**
 * E2E Test Helpers
 * Common utilities for Playwright tests
 */

export class PageHelpers {
    constructor(private page: Page) { }

    /**
     * Wait for app to be ready
     */
    async waitForApp() {
        await this.page.waitForLoadState('networkidle');
    }

    /**
     * Navigate to a specific page
     */
    async goToPage(path: string) {
        await this.page.goto(path);
        await this.waitForApp();
    }

    /**
     * Check if toast notification appears
     */
    async expectToast(message: string, tone: 'success' | 'error' | 'info' = 'success') {
        const toast = this.page.locator(`[data-testid="toast"][data-tone="${tone}"]`);
        await expect(toast).toContainText(message);
    }

    /**
     * Fill form field
     */
    async fillField(label: string, value: string) {
        const field = this.page.locator(`input[placeholder*="${label}"], input[aria-label*="${label}"]`).first();
        await field.fill(value);
    }

    /**
     * Click button by text or testid
     */
    async clickButton(text: string) {
        const button = this.page.locator(`button:has-text("${text}")`).first();
        await button.click();
    }

    /**
     * Wait for element to be visible
     */
    async waitForElement(selector: string, timeout = 5000) {
        await this.page.locator(selector).waitFor({ state: 'visible', timeout });
    }

    /**
     * Get table rows
     */
    async getTableRows(selector = '[data-testid="logs-table"] tbody tr') {
        return await this.page.locator(selector).count();
    }

    /**
     * Check if element is visible
     */
    async isVisible(selector: string) {
        return await this.page.locator(selector).isVisible();
    }

    /**
     * Get text content
     */
    async getText(selector: string) {
        return await this.page.locator(selector).textContent();
    }

    /**
     * Take screenshot for visual regression
     */
    async screenshot(name: string) {
        await this.page.screenshot({ path: `e2e/screenshots/${name}.png` });
    }
}

/**
 * Mock API response helper
 */
export async function mockAPIResponse(page: Page, pattern: string, data: Record<string, unknown>) {
    await page.route(`**/api/**${pattern}*`, (route) => {
        route.abort('blockedbyextension');
        route.continue({ json: data });
    });
}

/**
 * Wait for API call
 */
export async function waitForAPICall(page: Page, pattern: string) {
    return await page.waitForResponse((response) => response.url().includes(pattern) && response.status() === 200);
}
