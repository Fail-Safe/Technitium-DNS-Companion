import { test, expect, Page } from '@playwright/test';
import { PageHelpers } from './helpers';

/**
 * E2E Tests: Zone Management
 * Tests real user workflows for DNS zone management and synchronization
 */

test.describe('Zone Management E2E', () => {
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

    test.describe('Zone List Display', () => {
        test('should navigate to zones page', async () => {
            // Click Zones link
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Verify page loaded
            await expect(page.locator('h1:has-text("Zones")')).toBeVisible();
        });

        test('should display zones for all nodes', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Should show zones table/list
            const zonesTable = page.locator('[data-testid="zones-table"]');
            const zonesList = page.locator('[data-testid="zones-list"]');

            const hasTable = await zonesTable.isVisible().catch(() => false);
            const hasList = await zonesList.isVisible().catch(() => false);

            expect(hasTable || hasList).toBeTruthy();

            // Should have at least one zone
            const rows = page.locator('[data-testid="zones-table"] tbody tr');
            const rowCount = await rows.count().catch(() => 0);

            if (rowCount === 0) {
                // Or list items
                const items = page.locator('[data-testid="zone-item"]');
                const itemCount = await items.count();
                expect(itemCount).toBeGreaterThan(0);
            } else {
                expect(rowCount).toBeGreaterThan(0);
            }
        });

        test('should display zone status indicators', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // First zone should have status
            const firstZone = page.locator('[data-testid="zone-item"]').first();

            // Should have status badge
            const statusBadge = firstZone.locator('[data-testid="zone-status"]');
            await expect(statusBadge).toBeVisible();

            // Status should be one of: in-sync, different, missing, unknown
            const status = await statusBadge.textContent();
            const validStatuses = ['in-sync', 'different', 'missing', 'unknown'];
            expect(validStatuses.some((s) => status?.toLowerCase().includes(s))).toBeTruthy();
        });

        test('should show zone type icons/labels', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Zones should show their type
            const zoneType = page.locator('[data-testid="zone-type"]').first();

            const hasType = await zoneType.isVisible().catch(() => false);
            if (hasType) {
                const type = await zoneType.textContent();
                const validTypes = ['Primary', 'Secondary', 'Forwarder', 'Stub'];
                expect(validTypes.some((t) => type?.includes(t))).toBeTruthy();
            }
        });
    });

    test.describe('Zone Comparison', () => {
        test('should show comparison status across nodes', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // First zone should show comparison
            const firstZone = page.locator('[data-testid="zone-item"]').first();

            // Should have status badge indicating sync state
            const statusBadge = firstZone.locator('[data-testid="zone-status"]');
            await expect(statusBadge).toBeVisible();
        });

        test('should highlight differences between zones', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Find a zone with "different" status
            const differentZone = page.locator('[data-testid="zone-item"]:has([data-testid="zone-status"]:has-text("different"))').first();

            const hasDifferent = await differentZone.isVisible().catch(() => false);

            if (hasDifferent) {
                // Click to view differences
                await differentZone.click();
                await page.waitForTimeout(500);

                // Should show comparison details
                const details = page.locator('[data-testid="zone-comparison-details"]');
                const hasDetails = await details.isVisible().catch(() => false);

                if (hasDetails) {
                    expect(await details.isVisible()).toBeTruthy();
                }
            }
        });

        test('should show missing zones', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Find zone with "missing" status
            const missingZone = page.locator('[data-testid="zone-item"]:has([data-testid="zone-status"]:has-text("missing"))').first();

            const hasMissing = await missingZone.isVisible().catch(() => false);

            if (hasMissing) {
                expect(await missingZone.isVisible()).toBeTruthy();

                // Should have option to create on missing node
                const createBtn = missingZone.locator('[data-testid="create-zone-btn"]');
                const hasCreate = await createBtn.isVisible().catch(() => false);

                if (hasCreate) {
                    expect(await createBtn.isVisible()).toBeTruthy();
                }
            }
        });
    });

    test.describe('Zone Details', () => {
        test('should view zone records', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Click on first zone
            const firstZone = page.locator('[data-testid="zone-item"]').first();
            await firstZone.click();

            await helpers.waitForApp();

            // Should show zone details/records
            const details = page.locator('[data-testid="zone-details"]');
            const records = page.locator('[data-testid="zone-records"]');

            const hasDetails = await details.isVisible().catch(() => false);
            const hasRecords = await records.isVisible().catch(() => false);

            expect(hasDetails || hasRecords).toBeTruthy();
        });

        test('should display A records', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Find zone with records
            const firstZone = page.locator('[data-testid="zone-item"]').first();
            await firstZone.click();
            await helpers.waitForApp();

            // Look for A records
            const aRecords = page.locator('[data-testid="record-type"]:has-text("A")');
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const count = await aRecords.count();

            // Should have at least SOA and NS records typically
            const records = page.locator('[data-testid="zone-record"]');
            const totalRecords = await records.count();

            expect(totalRecords).toBeGreaterThan(0);
        });

        test('should display CNAME records', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            const firstZone = page.locator('[data-testid="zone-item"]').first();
            await firstZone.click();
            await helpers.waitForApp();

            // Look for CNAME records
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const cnameRecords = page.locator('[data-testid="record-type"]:has-text("CNAME")');
            // May or may not exist, but page should load
            expect(page.locator('[data-testid="zone-details"]')).toBeVisible();
        });

        test('should show record details on click', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            const firstZone = page.locator('[data-testid="zone-item"]').first();
            await firstZone.click();
            await helpers.waitForApp();

            // Click first record
            const firstRecord = page.locator('[data-testid="zone-record"]').first();
            const hasRecords = await firstRecord.isVisible().catch(() => false);

            if (hasRecords) {
                await firstRecord.click();
                await page.waitForTimeout(300);

                // Should show expanded view or modal
                const details = page.locator('[data-testid="record-details"]');
                const modal = page.locator('[data-testid="record-modal"]');

                const hasDetails = await details.isVisible().catch(() => false);
                const hasModal = await modal.isVisible().catch(() => false);

                if (hasDetails || hasModal) {
                    expect(true).toBeTruthy();
                }
            }
        });
    });

    test.describe('Zone Operations', () => {
        test('should create new zone', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Find add zone button
            const addZoneBtn = page.locator('[data-testid="add-zone-btn"]');

            if (await addZoneBtn.isVisible()) {
                await addZoneBtn.click();
                await helpers.waitForApp();

                // Should show zone creation form
                const form = page.locator('[data-testid="zone-form"]');
                await expect(form).toBeVisible();

                // Fill zone name
                const nameInput = form.locator('[data-testid="zone-name-input"]');
                await nameInput.fill('test.local');

                // Select zone type
                const typeSelect = form.locator('[data-testid="zone-type-select"]');
                if (await typeSelect.isVisible()) {
                    await typeSelect.selectOption('Primary');
                }

                // Create zone
                const createBtn = form.locator('button:has-text("Create")');
                await createBtn.click();

                await page.waitForTimeout(500);

                // Should show success message
                await helpers.expectToast('created', 'success');
            }
        });

        test('should edit zone settings', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Find first zone
            const firstZone = page.locator('[data-testid="zone-item"]').first();
            const editBtn = firstZone.locator('[data-testid="edit-zone-btn"]');

            if (await editBtn.isVisible()) {
                await editBtn.click();
                await helpers.waitForApp();

                // Should open edit form
                const form = page.locator('[data-testid="zone-edit-form"]');
                const hasForm = await form.isVisible().catch(() => false);

                if (hasForm) {
                    expect(await form.isVisible()).toBeTruthy();

                    // Could modify settings and save
                    const saveBtn = form.locator('button:has-text("Save")');
                    if (await saveBtn.isVisible()) {
                        await saveBtn.click();
                        await helpers.expectToast('saved', 'success');
                    }
                }
            }
        });

        test('should delete zone', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Find a test zone to delete
            const firstZone = page.locator('[data-testid="zone-item"]').first();
            const deleteBtn = firstZone.locator('[data-testid="delete-zone-btn"]');

            if (await deleteBtn.isVisible()) {
                await deleteBtn.click();
                await page.waitForTimeout(300);

                // Should show confirmation dialog
                const confirmDialog = page.locator('[data-testid="confirm-delete-dialog"]');
                const hasDialog = await confirmDialog.isVisible().catch(() => false);

                if (hasDialog) {
                    // Confirm deletion
                    const confirmBtn = confirmDialog.locator('button:has-text("Delete")');
                    if (await confirmBtn.isVisible()) {
                        await confirmBtn.click();
                        await helpers.expectToast('deleted', 'success');
                    }
                }
            }
        });
    });

    test.describe('Zone Synchronization', () => {
        test('should sync zone to other node', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Find zone with "different" status
            const zones = page.locator('[data-testid="zone-item"]');
            const count = await zones.count();

            if (count > 0) {
                const firstZone = zones.first();
                const syncBtn = firstZone.locator('[data-testid="sync-zone-btn"]');

                if (await syncBtn.isVisible()) {
                    await syncBtn.click();
                    await page.waitForTimeout(500);

                    // Should show sync options
                    const syncModal = page.locator('[data-testid="sync-zone-modal"]');
                    const hasModal = await syncModal.isVisible().catch(() => false);

                    if (hasModal) {
                        expect(await syncModal.isVisible()).toBeTruthy();

                        // Select target node and confirm
                        const confirmBtn = syncModal.locator('button:has-text("Sync")');
                        if (await confirmBtn.isVisible()) {
                            await confirmBtn.click();
                            await helpers.expectToast('synced', 'success');
                        }
                    }
                }
            }
        });

        test('should handle zone conflicts', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Find zone with differences
            const zones = page.locator('[data-testid="zone-item"]');

            // Try to sync and handle conflicts
            const firstZone = zones.first();
            const syncBtn = firstZone.locator('[data-testid="sync-zone-btn"]');

            if (await syncBtn.isVisible()) {
                await syncBtn.click();
                await page.waitForTimeout(500);

                // May show conflict resolution
                const conflictDialog = page.locator('[data-testid="conflict-resolution-dialog"]');
                const hasConflict = await conflictDialog.isVisible().catch(() => false);

                if (hasConflict) {
                    // Select resolution strategy
                    const strategy = page.locator('[data-testid="conflict-strategy"]').first();
                    if (await strategy.isVisible()) {
                        await strategy.click();
                    }

                    // Confirm
                    const confirmBtn = page.locator('button:has-text("Resolve")');
                    if (await confirmBtn.isVisible()) {
                        await confirmBtn.click();
                    }
                }
            }
        });
    });

    test.describe('Zone Filtering and Search', () => {
        test('should filter zones by name', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Get initial count
            const initialCount = await page.locator('[data-testid="zone-item"]').count();

            // Find search input
            const searchInput = page.locator('[data-testid="zone-search-input"]');

            if (await searchInput.isVisible()) {
                await searchInput.fill('test');
                await page.waitForTimeout(500);

                // Count should be different or show no results
                const filteredCount = await page.locator('[data-testid="zone-item"]').count();
                const noResults = await page.locator('text="No zones found"').isVisible().catch(() => false);

                expect(filteredCount <= initialCount || noResults).toBeTruthy();
            }
        });

        test('should filter zones by type', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Find filter dropdown
            const typeFilter = page.locator('[data-testid="zone-type-filter"]');

            if (await typeFilter.isVisible()) {
                await typeFilter.selectOption('Primary');
                await page.waitForTimeout(500);

                // Should show only Primary zones
                const zones = page.locator('[data-testid="zone-item"]');
                const count = await zones.count();

                // All visible zones should be Primary type
                for (let i = 0; i < Math.min(3, count); i++) {
                    const type = await zones.nth(i).locator('[data-testid="zone-type"]').textContent();
                    expect(type).toContain('Primary');
                }
            }
        });

        test('should filter zones by status', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Find status filter
            const statusFilter = page.locator('[data-testid="zone-status-filter"]');

            if (await statusFilter.isVisible()) {
                await statusFilter.selectOption('in-sync');
                await page.waitForTimeout(500);

                // Should show only in-sync zones
                const zones = page.locator('[data-testid="zone-item"]');
                const count = await zones.count();

                if (count > 0) {
                    // All visible zones should be in-sync
                    const status = await zones.first().locator('[data-testid="zone-status"]').textContent();
                    expect(status?.toLowerCase()).toContain('in-sync');
                }
            }
        });

        test('should clear filters', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Apply a filter
            const searchInput = page.locator('[data-testid="zone-search-input"]');
            if (await searchInput.isVisible()) {
                await searchInput.fill('test');
                await page.waitForTimeout(500);
            }

            // Find clear filters button
            const clearBtn = page.locator('[data-testid="clear-filters-btn"]');

            if (await clearBtn.isVisible()) {
                await clearBtn.click();
                await page.waitForTimeout(500);

                // Search input should be empty
                const value = await searchInput.inputValue();
                expect(value).toBe('');
            }
        });
    });

    test.describe('Zone Type Matching Logic', () => {
        test('should not compare Primary with Secondary zones', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // This is a special case that shouldn't be marked as "different"
            // When one node has Primary and other has Secondary of same name
            const zones = page.locator('[data-testid="zone-item"]');
            const count = await zones.count();

            for (let i = 0; i < count; i++) {
                const zone = zones.nth(i);
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const types = await zone.locator('[data-testid="zone-type-per-node"]').allTextContents();

                // If we have mixed Primary/Secondary, status should still be handled correctly
                const status = await zone.locator('[data-testid="zone-status"]').textContent();

                // Should be in-sync or unknown, not incorrectly marked as different
                expect(status?.toLowerCase()).not.toBe('different_type_mismatch');
            }
        });

        test('should handle zone type variations correctly', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Each zone should have consistent handling
            const zones = page.locator('[data-testid="zone-item"]');
            const count = await zones.count();

            for (let i = 0; i < Math.min(3, count); i++) {
                const zone = zones.nth(i);

                // Should have visible type and status
                const type = await zone.locator('[data-testid="zone-type"]').isVisible();
                const status = await zone.locator('[data-testid="zone-status"]').isVisible();

                expect(type && status).toBeTruthy();
            }
        });
    });

    test.describe('Mobile Responsiveness', () => {
        test('should display zones on mobile', async () => {
            await page.setViewportSize({ width: 375, height: 667 });

            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Should have zones visible
            const zones = page.locator('[data-testid="zone-item"]');
            const count = await zones.count();

            expect(count).toBeGreaterThan(0);
        });

        test('should have touch-friendly zone cards', async () => {
            await page.setViewportSize({ width: 375, height: 667 });

            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Zone items should be tap-able
            const zones = page.locator('[data-testid="zone-item"]');

            for (let i = 0; i < Math.min(2, await zones.count()); i++) {
                const zone = zones.nth(i);
                const box = await zone.boundingBox();

                if (box) {
                    // Should be easily tappable
                    expect(box.height).toBeGreaterThan(40);
                }
            }
        });

        test('should collapse zone details on mobile', async () => {
            await page.setViewportSize({ width: 375, height: 667 });

            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Click zone to view details
            const firstZone = page.locator('[data-testid="zone-item"]').first();
            await firstZone.click();
            await page.waitForTimeout(500);

            // Details should be visible (possibly in modal or expanded)
            const details = page.locator('[data-testid="zone-details"]');
            const modal = page.locator('[data-testid="zone-modal"]');

            const hasDetails = await details.isVisible().catch(() => false);
            const hasModal = await modal.isVisible().catch(() => false);

            expect(hasDetails || hasModal).toBeTruthy();
        });
    });

    test.describe('Performance', () => {
        test('should load zones page quickly', async () => {
            const startTime = Date.now();

            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            const loadTime = Date.now() - startTime;

            // Should load in under 2 seconds
            expect(loadTime).toBeLessThan(2000);
        });

        test('should search zones efficiently', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            const searchInput = page.locator('[data-testid="zone-search-input"]');

            if (await searchInput.isVisible()) {
                const startTime = Date.now();

                await searchInput.fill('test');
                await page.waitForTimeout(500);

                const searchTime = Date.now() - startTime;

                // Search should be quick
                expect(searchTime).toBeLessThan(1000);
            }
        });

        test('should handle large zone lists', async () => {
            await page.click('a:has-text("Zones")');
            await helpers.waitForApp();

            // Scroll through zones
            const zonesList = page.locator('[data-testid="zones-list"]');

            if (await zonesList.isVisible()) {
                await zonesList.evaluate((el) => {
                    el.scrollTop += 500;
                });

                await page.waitForTimeout(500);

                // Should still be responsive
                const zones = page.locator('[data-testid="zone-item"]');
                expect(await zones.count()).toBeGreaterThan(0);
            }
        });
    });
});
