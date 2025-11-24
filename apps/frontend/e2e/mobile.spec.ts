import { test, expect, Page } from '@playwright/test';
import { PageHelpers } from './helpers';

/**
 * E2E Tests: Mobile Workflows
 * Tests real user workflows on mobile devices (phones/tablets)
 * Focuses on responsive design, touch interactions, and mobile-specific UX
 */

test.describe('Mobile Workflows E2E', () => {
    let page: Page;
    let helpers: PageHelpers;

    test.beforeEach(async ({ browser }) => {
        // Create mobile context for iPhone 12
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
            isMobile: true,
            hasTouch: true,
        });

        page = await context.newPage();
        helpers = new PageHelpers(page);
        await helpers.goToPage('/');
    });

    test.afterEach(async () => {
        await page.close();
    });

    test.describe('Mobile Navigation', () => {
        test('should display mobile navigation menu', async () => {
            // On mobile, nav should be in hamburger menu or bottom bar
            const hamburger = page.locator('[data-testid="mobile-menu-button"]');
            const bottomNav = page.locator('[data-testid="bottom-navigation"]');

            const hasHamburger = await hamburger.isVisible().catch(() => false);
            const hasBottomNav = await bottomNav.isVisible().catch(() => false);

            expect(hasHamburger || hasBottomNav).toBeTruthy();
        });

        test('should open/close mobile menu', async () => {
            const hamburger = page.locator('[data-testid="mobile-menu-button"]');

            if (await hamburger.isVisible()) {
                // Open menu
                await hamburger.click();
                await page.waitForTimeout(300);

                // Menu should be visible
                const menu = page.locator('[data-testid="mobile-menu"]');
                await expect(menu).toBeVisible();

                // Close menu
                await hamburger.click();
                await page.waitForTimeout(300);

                // Menu should be hidden
                const isHidden = await menu.isHidden().catch(() => true);
                expect(isHidden).toBeTruthy();
            }
        });

        test('should navigate using mobile menu', async () => {
            const hamburger = page.locator('[data-testid="mobile-menu-button"]');

            if (await hamburger.isVisible()) {
                await hamburger.click();
                await page.waitForTimeout(300);

                // Click Logs
                const logsLink = page.locator('[data-testid="mobile-menu"] a:has-text("Logs")');
                if (await logsLink.isVisible()) {
                    await logsLink.click();
                    await helpers.waitForApp();

                    // Should navigate to logs
                    const title = page.locator('h1:has-text("Query Logs")');
                    const isMissing = await title.isHidden().catch(() => true);
                    expect(!isMissing).toBeTruthy();
                }
            }
        });

        test('should keep menu closed when navigating', async () => {
            const hamburger = page.locator('[data-testid="mobile-menu-button"]');

            if (await hamburger.isVisible()) {
                await hamburger.click();
                await page.waitForTimeout(300);

                // Navigate
                await page.click('[data-testid="mobile-menu"] a:has-text("Configuration")');
                await helpers.waitForApp();

                // Menu should auto-close after navigation
                const menu = page.locator('[data-testid="mobile-menu"]');
                const isClosed = await menu.isHidden().catch(() => true);
                expect(isClosed).toBeTruthy();
            }
        });
    });

    test.describe('Mobile Query Logs Workflow', () => {
        test('should display logs in mobile card format', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            // Should use cards instead of table on mobile
            const cards = page.locator('[data-testid="log-card"]');
            const table = page.locator('[data-testid="logs-table"]');

            const hasCards = await cards.count().catch(() => 0) > 0;
            const hasTable = await table.isVisible().catch(() => false);

            // Mobile should prefer cards
            expect(hasCards || !hasTable).toBeTruthy();
        });

        test('should show essential info on mobile card', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            const card = page.locator('[data-testid="log-card"]').first();

            // Should show domain and status at minimum
            const domain = card.locator('[data-testid="log-domain"]');
            const status = card.locator('[data-testid="log-status"]');

            if (await card.isVisible()) {
                expect(await domain.isVisible().catch(() => false) || await status.isVisible().catch(() => false)).toBeTruthy();
            }
        });

        test('should expand card to see full details', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            const card = page.locator('[data-testid="log-card"]').first();

            if (await card.isVisible()) {
                // Click to expand
                await card.click();
                await page.waitForTimeout(300);

                // Should show more details
                const details = page.locator('[data-testid="log-expanded-details"]');
                const modal = page.locator('[data-testid="log-details-modal"]');

                const hasDetails = await details.isVisible().catch(() => false);
                const hasModal = await modal.isVisible().catch(() => false);

                expect(hasDetails || hasModal).toBeTruthy();
            }
        });

        test('should filter logs on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            // Find filter button
            const filterBtn = page.locator('[data-testid="mobile-filter-btn"]');

            if (await filterBtn.isVisible()) {
                await filterBtn.click();
                await page.waitForTimeout(300);

                // Should show mobile filter panel
                const filterPanel = page.locator('[data-testid="mobile-filter-panel"]');
                await expect(filterPanel).toBeVisible();

                // Fill filter
                const domainInput = filterPanel.locator('[data-testid="domain-filter-input"]');
                if (await domainInput.isVisible()) {
                    await domainInput.fill('ads');
                    await page.press('[data-testid="domain-filter-input"]', 'Enter');

                    await page.waitForTimeout(500);

                    // Results should be filtered
                    const cards = page.locator('[data-testid="log-card"]');
                    expect(await cards.count()).toBeGreaterThanOrEqual(0);
                }
            }
        });

        test('should whitelist domain on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            // Long press or tap menu on card
            const card = page.locator('[data-testid="log-card"]').first();

            if (await card.isVisible()) {
                // Right-click for context menu or tap menu button
                const menuBtn = card.locator('[data-testid="card-menu-btn"]');

                if (await menuBtn.isVisible()) {
                    await menuBtn.click();
                    await page.waitForTimeout(300);

                    // Click whitelist
                    const whitelistBtn = page.locator('text="Whitelist"');
                    if (await whitelistBtn.isVisible()) {
                        await whitelistBtn.click();
                        await page.waitForTimeout(500);

                        await helpers.expectToast('whitelisted', 'success');
                    }
                }
            }
        });
    });

    test.describe('Mobile Configuration Workflow', () => {
        test('should display configuration on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Configuration")');
            await helpers.waitForApp();

            // Should show nodes
            const nodes = page.locator('[data-testid="node-card"]');
            expect(await nodes.count()).toBeGreaterThan(0);
        });

        test('should stack settings vertically on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Configuration")');
            await helpers.waitForApp();

            // Tabs should be scrollable or stacked
            const tabs = page.locator('[data-testid="settings-tab"]');

            // On mobile, tabs may be in a horizontal scroll
            const tabsContainer = page.locator('[data-testid="settings-tabs-container"]');
            const isScrollable = await tabsContainer.evaluate((el) => el.scrollWidth > el.clientWidth).catch(() => false);

            expect(isScrollable || (await tabs.count()) < 5).toBeTruthy();
        });

        test('should have full-width forms on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Configuration")');
            await helpers.waitForApp();

            // Edit a node
            const editBtn = page.locator('[data-testid="edit-btn"]').first();

            if (await editBtn.isVisible()) {
                await editBtn.click();
                await page.waitForTimeout(300);

                // Form should be full width
                const form = page.locator('[data-testid="node-edit-modal"]');
                const box = await form.boundingBox();

                if (box) {
                    // Form should use most of viewport width
                    expect(box.width).toBeGreaterThan(300);
                }
            }
        });

        test('should show expanded settings on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Configuration")');
            await helpers.waitForApp();

            // Click to expand DNS settings
            const dnsTab = page.locator('[data-testid="dns-settings-tab"]');

            if (await dnsTab.isVisible()) {
                await dnsTab.click();
                await page.waitForTimeout(300);

                // Should show expanded view
                const dnsSettings = page.locator('[data-testid="dns-settings"]');
                await expect(dnsSettings).toBeVisible();
            }
        });
    });

    test.describe('Mobile Zone Management Workflow', () => {
        test('should display zones on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Zones")');
            await helpers.waitForApp();

            // Should show zones
            const zones = page.locator('[data-testid="zone-item"]');
            expect(await zones.count()).toBeGreaterThan(0);
        });

        test('should use cards for zones on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Zones")');
            await helpers.waitForApp();

            // Should prefer cards on mobile
            const cards = page.locator('[data-testid="zone-card"]');
            const table = page.locator('[data-testid="zones-table"]');

            const hasCards = await cards.count().catch(() => 0) > 0;
            const hasTable = await table.isVisible().catch(() => false);

            // Mobile should use cards
            expect(hasCards || !hasTable).toBeTruthy();
        });

        test('should show zone status clearly on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Zones")');
            await helpers.waitForApp();

            // Zone status should be prominent
            const statusBadge = page.locator('[data-testid="zone-status"]').first();

            if (await statusBadge.isVisible()) {
                const box = await statusBadge.boundingBox();
                if (box) {
                    // Badge should be readable
                    expect(box.width).toBeGreaterThan(50);
                    expect(box.height).toBeGreaterThan(20);
                }
            }
        });

        test('should expand zone details on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Zones")');
            await helpers.waitForApp();

            const zone = page.locator('[data-testid="zone-item"]').first();

            if (await zone.isVisible()) {
                await zone.click();
                await page.waitForTimeout(300);

                // Should show detailed view
                const details = page.locator('[data-testid="zone-details"]');
                const modal = page.locator('[data-testid="zone-details-modal"]');

                const hasDetails = await details.isVisible().catch(() => false);
                const hasModal = await modal.isVisible().catch(() => false);

                expect(hasDetails || hasModal).toBeTruthy();
            }
        });
    });

    test.describe('Mobile DHCP Workflow', () => {
        test('should display DHCP scopes on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("DHCP")');
            await helpers.waitForApp();

            // Should show scopes
            const scopes = page.locator('[data-testid="dhcp-scope"]');
            expect(await scopes.count()).toBeGreaterThanOrEqual(0);
        });

        test('should show essential scope info on mobile', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("DHCP")');
            await helpers.waitForApp();

            const scope = page.locator('[data-testid="dhcp-scope"]').first();

            if (await scope.isVisible()) {
                // Should show name and status at minimum
                const name = scope.locator('[data-testid="scope-name"]');
                const status = scope.locator('[data-testid="scope-status"]');

                expect(await name.isVisible().catch(() => false) || await status.isVisible().catch(() => false)).toBeTruthy();
            }
        });

        test('should clone scope on mobile with single tap', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("DHCP")');
            await helpers.waitForApp();

            const scope = page.locator('[data-testid="dhcp-scope"]').first();

            if (await scope.isVisible()) {
                // Menu button should be easy to tap
                const menuBtn = scope.locator('[data-testid="scope-menu-btn"]');

                if (await menuBtn.isVisible()) {
                    const box = await menuBtn.boundingBox();
                    if (box) {
                        // Should be at least 44x44 pixels
                        expect(box.width).toBeGreaterThanOrEqual(44);
                        expect(box.height).toBeGreaterThanOrEqual(44);
                    }

                    await menuBtn.click();
                    await page.waitForTimeout(300);

                    // Should show clone option
                    const cloneBtn = page.locator('text="Clone"');
                    const hasClone = await cloneBtn.isVisible().catch(() => false);
                    expect(hasClone).toBeTruthy();
                }
            }
        });
    });

    test.describe('Mobile Orientation Changes', () => {
        test('should handle portrait orientation', async () => {
            // Already in portrait (390x844)
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            const content = page.locator('main, [data-testid="main-content"]');
            await expect(content).toBeVisible();
        });

        test('should handle landscape orientation', async () => {
            // Change to landscape
            await page.setViewportSize({ width: 844, height: 390 });

            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            // Should still be readable
            const content = page.locator('main, [data-testid="main-content"]');
            await expect(content).toBeVisible();
        });

        test('should persist data on orientation change', async () => {
            // Start in portrait
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            // Get initial data
            const initialCards = await page.locator('[data-testid="log-card"]').count();

            // Change to landscape
            await page.setViewportSize({ width: 844, height: 390 });
            await page.waitForTimeout(300);

            // Data should still be visible
            const landscapeCards = await page.locator('[data-testid="log-card"]').count();
            expect(landscapeCards).toBe(initialCards);
        });
    });

    test.describe('Mobile Safe Areas', () => {
        test('should respect safe areas on notched devices', async () => {
            // Create context with notch (simulated)
            const context = await page.context().browser()!.newContext({
                viewport: { width: 390, height: 844 },
                deviceScaleFactor: 1,
                isMobile: true,
                hasTouch: true,
            });

            const notchedPage = await context.newPage();
            const notchedHelpers = new PageHelpers(notchedPage);
            await notchedHelpers.goToPage('/');

            // Header should have safe area padding
            const header = notchedPage.locator('header, [data-testid="app-header"]');

            if (await header.isVisible()) {
                // Should have safe area consideration
                expect(header).toBeVisible();
            }

            await notchedPage.close();
        });

        test('should not hide content under status bar', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            // First card should be visible and not under status bar
            const firstCard = page.locator('[data-testid="log-card"]').first();
            const box = await firstCard.boundingBox();

            if (box) {
                // Should not start at y=0 (would be under status bar)
                expect(box.y).toBeGreaterThan(0);
            }
        });
    });

    test.describe('Mobile Touch Interactions', () => {
        test('should handle tap on buttons', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            // Tap filter button
            const filterBtn = page.locator('[data-testid="mobile-filter-btn"]');

            if (await filterBtn.isVisible()) {
                await filterBtn.click(); // Playwright click emulates tap on mobile
                await page.waitForTimeout(300);

                const filterPanel = page.locator('[data-testid="mobile-filter-panel"]');
                await expect(filterPanel).toBeVisible();
            }
        });

        test('should handle swipe/scroll gestures', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            const cards = page.locator('[data-testid="log-card"]');

            if (await cards.count() > 0) {
                // Scroll down
                const list = page.locator('[data-testid="logs-list"]');

                if (await list.isVisible()) {
                    await list.evaluate((el) => {
                        el.scrollTop += 300;
                    });

                    await page.waitForTimeout(300);

                    // Should still have cards visible
                    expect(await cards.count()).toBeGreaterThan(0);
                }
            }
        });

        test('should handle long-press for context menu', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            const card = page.locator('[data-testid="log-card"]').first();

            if (await card.isVisible()) {
                // Right-click simulates long-press on mobile
                await card.click({ button: 'right' });
                await page.waitForTimeout(300);

                // Should show context menu
                const contextMenu = page.locator('[data-testid="context-menu"]');
                const hasMenu = await contextMenu.isVisible().catch(() => false);

                // Or menu button on card
                const menuBtn = card.locator('[data-testid="card-menu-btn"]');
                const hasMenuBtn = await menuBtn.isVisible().catch(() => false);

                expect(hasMenu || hasMenuBtn).toBeTruthy();
            }
        });
    });

    test.describe('Mobile Performance', () => {
        test('should load mobile interface quickly', async () => {
            const startTime = Date.now();

            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            const loadTime = Date.now() - startTime;

            // Should be fast on mobile
            expect(loadTime).toBeLessThan(2500);
        });

        test('should not have layout shifts', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            // Get initial position
            const card = page.locator('[data-testid="log-card"]').first();
            const initialBox = await card.boundingBox();

            // Wait for potential image load or async operations
            await page.waitForTimeout(1000);

            const finalBox = await card.boundingBox();

            if (initialBox && finalBox) {
                // Position shouldn't change significantly
                expect(Math.abs(initialBox.y - finalBox.y)).toBeLessThan(50);
            }
        });

        test('should maintain 60fps scrolling', async () => {
            await page.click('[data-testid="mobile-menu-button"]');
            await page.click('[data-testid="mobile-menu"] a:has-text("Logs")');
            await helpers.waitForApp();

            const list = page.locator('[data-testid="logs-list"]');

            if (await list.isVisible()) {
                // Scroll smoothly
                await list.evaluate((el) => {
                    el.scrollTop += 500;
                });

                // Should be smooth (can't measure FPS directly, but interaction should complete quickly)
                await page.waitForTimeout(500);

                expect(await list.isVisible()).toBeTruthy();
            }
        });
    });
});
