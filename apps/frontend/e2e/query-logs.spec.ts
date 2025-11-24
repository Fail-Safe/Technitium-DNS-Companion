import { test, expect, Page } from '@playwright/test';
import { PageHelpers } from './helpers';

/**
 * E2E Tests: Query Logs
 * Tests real user workflows for query log management
 */

test.describe('Query Logs E2E', () => {
    let page: Page;
    let helpers: PageHelpers;

    test.beforeEach(async ({ browser }) => {
        page = await browser.newPage();
        helpers = new PageHelpers(page);
        await helpers.goToPage('/');
    });

    test.afterEach(async () => {
        await page.close();
    });

    test.describe('Viewing Query Logs', () => {
        test('should display query logs page', async () => {
            // Navigate to logs
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Verify page loaded
            await expect(page.locator('h1:has-text("Query Logs")')).toBeVisible();
        });

        test('should display log table with columns', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Check for key columns
            await expect(page.locator('th:has-text("Domain")')).toBeVisible();
            await expect(page.locator('th:has-text("Client")')).toBeVisible();
            await expect(page.locator('th:has-text("Status")')).toBeVisible();

            // Check for data rows
            const rows = await page.locator('[data-testid="logs-table"] tbody tr').count();
            expect(rows).toBeGreaterThan(0);
        });

        test('should show log details on row click', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Click first row
            await page.locator('[data-testid="logs-table"] tbody tr').first().click();

            // Details panel should appear
            const details = page.locator('[data-testid="log-details"]');
            await expect(details).toBeVisible();
        });
    });

    test.describe('Filtering Logs', () => {
        test('should filter by domain', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Get initial count
            const initialCount = await page.locator('[data-testid="logs-table"] tbody tr').count();

            // Filter by domain
            const domainFilter = page.locator('[data-testid="domain-filter"]');
            await domainFilter.fill('ads');
            await page.press('[data-testid="domain-filter"]', 'Enter');

            await page.waitForTimeout(500); // Let filter apply

            // Count should be different or show "no results"
            const filteredCount = await page.locator('[data-testid="logs-table"] tbody tr').count();
            const noResults = await page.locator('text="No logs found"').isVisible();

            expect(filteredCount < initialCount || noResults).toBeTruthy();
        });

        test('should filter by client IP', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Click filter button
            await page.click('[data-testid="filter-btn"]');

            // Fill in client IP
            const ipFilter = page.locator('[data-testid="client-ip-filter"]');
            await ipFilter.fill('192.168');

            // Apply filter
            await page.click('[data-testid="apply-filter-btn"]');
            await page.waitForTimeout(500);

            // Verify filtered results
            const table = page.locator('[data-testid="logs-table"]');
            await expect(table).toBeVisible();
        });

        test('should filter by status', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Open filter panel
            await page.click('[data-testid="filter-btn"]');

            // Select status filter
            const statusSelect = page.locator('[data-testid="status-filter"]');
            await statusSelect.selectOption('BLOCKED');

            // Apply filter
            await page.click('[data-testid="apply-filter-btn"]');
            await page.waitForTimeout(500);

            // Should show only blocked queries
            const rows = page.locator('[data-testid="logs-table"] tbody tr');
            const count = await rows.count();

            if (count > 0) {
                // Check first row has BLOCKED status
                const status = await rows.first().locator('[data-testid="status-badge"]').textContent();
                expect(status).toContain('BLOCKED');
            }
        });

        test('should combine multiple filters', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Open advanced filters
            await page.click('[data-testid="filter-btn"]');

            // Set multiple filters
            await page.locator('[data-testid="domain-filter"]').fill('example.com');
            await page.locator('[data-testid="status-filter"]').selectOption('BLOCKED');

            // Apply
            await page.click('[data-testid="apply-filter-btn"]');
            await page.waitForTimeout(500);

            // Verify results
            const table = page.locator('[data-testid="logs-table"]');
            await expect(table).toBeVisible();
        });

        test('should clear filters', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Apply a filter
            const domainFilter = page.locator('[data-testid="domain-filter"]');
            await domainFilter.fill('test');
            await page.press('[data-testid="domain-filter"]', 'Enter');
            await page.waitForTimeout(500);

            // Clear filter
            await page.click('[data-testid="clear-filters-btn"]');
            await page.waitForTimeout(500);

            // Input should be empty
            const value = await domainFilter.inputValue();
            expect(value).toBe('');
        });
    });

    test.describe('Whitelisting Domains', () => {
        test('should whitelist domain from query log', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Find a blocked query
            const blockedRow = page.locator('[data-testid="logs-table"] tbody tr').first();

            // Click whitelist button
            await blockedRow.locator('[data-testid="whitelist-btn"]').click();

            // Confirm action if modal appears
            const confirmBtn = page.locator('button:has-text("Confirm")');
            if (await confirmBtn.isVisible()) {
                await confirmBtn.click();
            }

            // Should see success toast
            await helpers.expectToast('Added to whitelist', 'success');
        });

        test('should open group selector when whitelisting', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Right-click for context menu
            await page.locator('[data-testid="logs-table"] tbody tr').first().click({
                button: 'right',
            });

            // Select "Whitelist" option
            await page.click('text="Whitelist"');

            // Group selector modal should appear
            const groupModal = page.locator('[data-testid="group-selector-modal"]');
            await expect(groupModal).toBeVisible();

            // Select a group
            const groupCheckbox = page.locator('[data-testid="group-checkbox"]').first();
            await groupCheckbox.click();

            // Confirm
            await page.click('button:has-text("Add to Whitelist")');

            // Success toast
            await helpers.expectToast('whitelisted', 'success');
        });
    });

    test.describe('Blacklisting Domains', () => {
        test('should blacklist domain from query log', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Find an allowed query
            const row = page.locator('[data-testid="logs-table"] tbody tr').first();

            // Click blacklist button
            await row.locator('[data-testid="blacklist-btn"]').click();

            // Confirm if needed
            const confirmBtn = page.locator('button:has-text("Confirm")');
            if (await confirmBtn.isVisible()) {
                await confirmBtn.click();
            }

            // Should see success toast
            await helpers.expectToast('Added to blacklist', 'success');
        });

        test('should open group selector when blacklisting', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Click blacklist button
            const blacklistBtn = page.locator('[data-testid="blacklist-btn"]').first();
            await blacklistBtn.click();

            // Group selector should appear
            const groupModal = page.locator('[data-testid="group-selector-modal"]');
            await expect(groupModal).toBeVisible();

            // Select groups
            const checkboxes = page.locator('[data-testid="group-checkbox"]');
            const count = await checkboxes.count();
            if (count > 0) {
                await checkboxes.first().click();
            }

            // Add to blacklist
            await page.click('button:has-text("Add to Blacklist")');

            // Success message
            await helpers.expectToast('blacklist', 'success');
        });
    });

    test.describe('Bulk Actions', () => {
        test('should select multiple rows', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Click checkboxes
            const checkboxes = page.locator('[data-testid="log-checkbox"]').first();
            await checkboxes.click();

            // Should show bulk action toolbar
            const toolbar = page.locator('[data-testid="bulk-actions-toolbar"]');
            await expect(toolbar).toBeVisible();
        });

        test('should select all visible rows', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Click "select all" checkbox
            const selectAllCheckbox = page.locator('[data-testid="select-all-checkbox"]');
            await selectAllCheckbox.click();

            // All rows should be checked
            const checked = page.locator('[data-testid="log-checkbox"][checked]');
            const total = page.locator('[data-testid="log-checkbox"]');

            const checkedCount = await checked.count();
            const totalCount = await total.count();

            expect(checkedCount).toBe(totalCount);
        });

        test('should bulk whitelist selected rows', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Select some rows
            const checkboxes = page.locator('[data-testid="log-checkbox"]');
            for (let i = 0; i < Math.min(3, await checkboxes.count()); i++) {
                await checkboxes.nth(i).click();
            }

            // Click bulk whitelist
            await page.click('[data-testid="bulk-whitelist-btn"]');

            // May need to confirm
            const confirmBtn = page.locator('button:has-text("Confirm")');
            if (await confirmBtn.isVisible()) {
                await confirmBtn.click();
            }

            // Success message
            await helpers.expectToast('whitelisted', 'success');
        });

        test('should bulk blacklist selected rows', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Select rows
            const checkboxes = page.locator('[data-testid="log-checkbox"]');
            for (let i = 0; i < Math.min(2, await checkboxes.count()); i++) {
                await checkboxes.nth(i).click();
            }

            // Click bulk blacklist
            await page.click('[data-testid="bulk-blacklist-btn"]');

            // Confirm
            const confirmBtn = page.locator('button:has-text("Confirm")');
            if (await confirmBtn.isVisible()) {
                await confirmBtn.click();
            }

            // Success
            await helpers.expectToast('blacklist', 'success');
        });
    });

    test.describe('Mobile Responsiveness', () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        test('should display table on mobile', async ({ viewport }) => {
            const mobileContext = await page.context().browser()?.newContext({
                viewport: { width: 375, height: 667 }, // iPhone SE
            });
            const mobilePage = await mobileContext!.newPage();
            const mobileHelpers = new PageHelpers(mobilePage);

            await mobileHelpers.goToPage('/');

            // Navigate to logs
            await mobilePage.click('a:has-text("Logs")');
            await mobileHelpers.waitForApp();

            // Should display logs in mobile-friendly format
            const table = mobilePage.locator('[data-testid="logs-table"]');
            await expect(table).toBeVisible();

            // May have different layout (cards instead of table)
            const cards = mobilePage.locator('[data-testid="log-card"]');
            const rows = mobilePage.locator('tr');

            const cardsExist = await cards.count() > 0;
            const rowsExist = await rows.count() > 0;

            expect(cardsExist || rowsExist).toBeTruthy();

            await mobilePage.close();
        });

        test('should have touch-friendly action buttons', async () => {
            // Set mobile viewport
            await page.setViewportSize({ width: 375, height: 667 });

            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Check buttons are tap-able (44x44px minimum)
            const buttons = page.locator('[data-testid="logs-table"] button');
            for (let i = 0; i < await buttons.count(); i++) {
                const box = await buttons.nth(i).boundingBox();
                if (box) {
                    expect(box.width).toBeGreaterThanOrEqual(44);
                    expect(box.height).toBeGreaterThanOrEqual(44);
                }
            }
        });
    });

    test.describe('Performance', () => {
        test('should load logs in reasonable time', async () => {
            const startTime = Date.now();

            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            const loadTime = Date.now() - startTime;

            // Should load in under 3 seconds
            expect(loadTime).toBeLessThan(3000);
        });

        test('should scroll large log list smoothly', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Scroll down
            const table = page.locator('[data-testid="logs-table"]');
            await table.evaluate((el) => {
                el.scrollTop += 500;
            });

            // Should still be responsive
            await page.waitForTimeout(500);
            await expect(table).toBeVisible();
        });
    });

    test.describe('Balanced Node Sampling', () => {
        test('should show entries from both nodes in combined view', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Verify we're in combined view
            await expect(page.locator('button:has-text("Combined View")')).toHaveClass(/active|selected/);

            // Get all NODE column values
            const nodeElements = await page.locator('[data-testid="logs-table"] td').filter({ has: page.locator('text=/^(eq14|eq12)$') }).all();

            // Should have entries from at least 2 nodes
            const nodeSet = new Set<string>();
            for (const elem of nodeElements) {
                const text = await elem.textContent();
                if (text) nodeSet.add(text.trim());
            }

            // Should see both eq14 and eq12
            expect(nodeSet.has('eq14')).toBeTruthy();
            expect(nodeSet.has('eq12')).toBeTruthy();
        });

        test('should have roughly balanced node distribution with large buffer', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Increase buffer size to 500 for better visibility
            await page.click('[data-testid="buffer-size-dropdown"], button:has-text("200")');
            await page.click('text=500 entries');
            await helpers.waitForApp();

            // Get all nodes from table
            const nodeElements = await page.locator('[data-testid="logs-table"] tbody tr').all();
            const nodeCounts: Record<string, number> = { eq14: 0, eq12: 0 };

            for (const row of nodeElements) {
                const nodeCell = row.locator('td').nth(1); // NODE column is typically 2nd
                const nodeText = await nodeCell.textContent();
                if (nodeText?.includes('eq14')) nodeCounts['eq14']++;
                if (nodeText?.includes('eq12')) nodeCounts['eq12']++;
            }

            // With balanced sampling, distribution should be roughly equal (within 20% tolerance)
            // If eq14 has 250, eq12 should have ~200-300 (not 0)
            const totalVisible = nodeCounts['eq14'] + nodeCounts['eq12'];
            const eq14Ratio = nodeCounts['eq14'] / totalVisible;

            // Should not be heavily skewed (e.g., >80% from one node)
            expect(eq14Ratio).toBeGreaterThan(0.2);
            expect(eq14Ratio).toBeLessThan(0.8);

            // Both nodes should be represented
            expect(nodeCounts['eq14']).toBeGreaterThan(0);
            expect(nodeCounts['eq12']).toBeGreaterThan(0);
        });

        test('should preserve node diversity when deduplication is enabled', async () => {
            await page.click('a:has-text("Logs")');
            await helpers.waitForApp();

            // Enable deduplication
            const dedupeToggle = page.locator('[data-testid="dedup-toggle"], input[type="checkbox"]:near(text=Deduplicate)');
            const isChecked = await dedupeToggle.isChecked();
            if (!isChecked) {
                await dedupeToggle.click();
            }
            await helpers.waitForApp();

            // Increase buffer to see effect better
            await page.click('[data-testid="buffer-size-dropdown"], button:has-text("200")');
            await page.click('text=500 entries');
            await helpers.waitForApp();

            // Count nodes after deduplication
            const nodeElements = await page.locator('[data-testid="logs-table"] tbody tr').all();
            const nodeCounts: Record<string, number> = { eq14: 0, eq12: 0 };

            for (const row of nodeElements) {
                const nodeCell = row.locator('td').nth(1);
                const nodeText = await nodeCell.textContent();
                if (nodeText?.includes('eq14')) nodeCounts['eq14']++;
                if (nodeText?.includes('eq12')) nodeCounts['eq12']++;
            }

            // Even with deduplication, should still see entries from both nodes
            expect(nodeCounts['eq14']).toBeGreaterThan(0);
            expect(nodeCounts['eq12']).toBeGreaterThan(0);

            // Should not have deduplication hide all entries from one node
            // (e.g., shouldn't go from 250/250 to 500/0)
            const totalVisible = nodeCounts['eq14'] + nodeCounts['eq12'];
            const eq12Ratio = nodeCounts['eq12'] / totalVisible;

            // EQ12 should still be at least 5% of visible entries (not hidden completely)
            expect(eq12Ratio).toBeGreaterThan(0.05);
        });
    });
});
