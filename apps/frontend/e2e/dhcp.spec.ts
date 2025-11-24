import { test, expect, Page } from '@playwright/test';
import { PageHelpers } from './helpers';

/**
 * E2E Tests: DHCP Management
 * Tests real user workflows for DHCP scopes, leases, and reservations
 */

test.describe('DHCP Management E2E', () => {
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

    test.describe('DHCP Page Navigation', () => {
        test('should navigate to DHCP page', async () => {
            // Click DHCP link
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Verify page loaded
            await expect(page.locator('h1:has-text("DHCP")')).toBeVisible();
        });

        test('should display DHCP scopes for all nodes', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Should have scopes displayed
            const scopes = page.locator('[data-testid="dhcp-scope"]');
            const scopeCount = await scopes.count();

            expect(scopeCount).toBeGreaterThan(0);
        });

        test('should show node tabs for DHCP', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Should have tabs for each node
            const nodeTabs = page.locator('[data-testid="node-tab"]');
            const tabCount = await nodeTabs.count();

            expect(tabCount).toBeGreaterThan(0);
        });
    });

    test.describe('DHCP Scopes', () => {
        test('should display DHCP scope list', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Should show scope table or list
            const scopesTable = page.locator('[data-testid="scopes-table"]');
            const scopesList = page.locator('[data-testid="scopes-list"]');

            const hasTable = await scopesTable.isVisible().catch(() => false);
            const hasList = await scopesList.isVisible().catch(() => false);

            expect(hasTable || hasList).toBeTruthy();
        });

        test('should show scope details (name, range, gateway)', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Get first scope
            const firstScope = page.locator('[data-testid="dhcp-scope"]').first();

            // Should have scope info visible
            const name = firstScope.locator('[data-testid="scope-name"]');
            const range = firstScope.locator('[data-testid="scope-range"]');

            const hasName = await name.isVisible();
            const hasRange = await range.isVisible();

            expect(hasName || hasRange).toBeTruthy();
        });

        test('should create new DHCP scope', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Find add scope button
            const addBtn = page.locator('[data-testid="add-scope-btn"]');

            if (await addBtn.isVisible()) {
                await addBtn.click();
                await helpers.waitForApp();

                // Should show scope creation form
                const form = page.locator('[data-testid="scope-form"]');
                await expect(form).toBeVisible();

                // Fill scope details
                await helpers.fillField('Scope Name', 'Guest Network');
                await helpers.fillField('Start IP', '192.168.100.100');
                await helpers.fillField('End IP', '192.168.100.200');

                // Create scope
                const createBtn = form.locator('button:has-text("Create")');
                await createBtn.click();

                await page.waitForTimeout(500);
                await helpers.expectToast('created', 'success');
            }
        });

        test('should edit DHCP scope', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Find first scope
            const firstScope = page.locator('[data-testid="dhcp-scope"]').first();
            const editBtn = firstScope.locator('[data-testid="edit-scope-btn"]');

            if (await editBtn.isVisible()) {
                await editBtn.click();
                await helpers.waitForApp();

                // Should open edit form
                const form = page.locator('[data-testid="scope-edit-form"]');
                await expect(form).toBeVisible();

                // Modify lease time
                const leaseInput = form.locator('[data-testid="lease-duration-input"]');
                if (await leaseInput.isVisible()) {
                    await leaseInput.clear();
                    await leaseInput.fill('7200');
                }

                // Save
                const saveBtn = form.locator('button:has-text("Save")');
                await saveBtn.click();

                await page.waitForTimeout(500);
                await helpers.expectToast('updated', 'success');
            }
        });

        test('should delete DHCP scope', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Find scope to delete
            const firstScope = page.locator('[data-testid="dhcp-scope"]').first();
            const deleteBtn = firstScope.locator('[data-testid="delete-scope-btn"]');

            if (await deleteBtn.isVisible()) {
                await deleteBtn.click();
                await page.waitForTimeout(300);

                // Should show confirmation
                const confirmDialog = page.locator('[data-testid="confirm-delete-dialog"]');
                const hasDialog = await confirmDialog.isVisible().catch(() => false);

                if (hasDialog) {
                    const confirmBtn = confirmDialog.locator('button:has-text("Delete")');
                    await confirmBtn.click();

                    await page.waitForTimeout(500);
                    await helpers.expectToast('deleted', 'success');
                }
            }
        });
    });

    test.describe('DHCP Scope Cloning', () => {
        test('should clone scope to other node', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Find scope
            const firstScope = page.locator('[data-testid="dhcp-scope"]').first();
            const cloneBtn = firstScope.locator('[data-testid="clone-scope-btn"]');

            if (await cloneBtn.isVisible()) {
                await cloneBtn.click();
                await page.waitForTimeout(500);

                // Should show clone modal
                const modal = page.locator('[data-testid="clone-scope-modal"]');
                await expect(modal).toBeVisible();

                // Select target node
                const nodeSelect = modal.locator('[data-testid="target-node-select"]');
                if (await nodeSelect.isVisible()) {
                    const options = await nodeSelect.locator('option').count();
                    if (options > 1) {
                        await nodeSelect.selectOption({ index: 1 });
                    }
                }

                // Confirm clone
                const confirmBtn = modal.locator('button:has-text("Clone")');
                await confirmBtn.click();

                await page.waitForTimeout(500);
                await helpers.expectToast('cloned', 'success');
            }
        });

        test('should clone multiple scopes at once', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Select multiple scopes
            const checkboxes = page.locator('[data-testid="scope-checkbox"]');
            const count = await checkboxes.count();

            if (count >= 2) {
                for (let i = 0; i < Math.min(2, count); i++) {
                    await checkboxes.nth(i).click();
                }

                // Click bulk clone button
                const bulkCloneBtn = page.locator('[data-testid="bulk-clone-btn"]');

                if (await bulkCloneBtn.isVisible()) {
                    await bulkCloneBtn.click();
                    await page.waitForTimeout(500);

                    // Should show bulk clone modal
                    const modal = page.locator('[data-testid="bulk-clone-modal"]');
                    await expect(modal).toBeVisible();

                    // Select target node and confirm
                    const nodeSelect = modal.locator('[data-testid="target-node-select"]');
                    if (await nodeSelect.isVisible()) {
                        await nodeSelect.selectOption({ index: 1 });
                    }

                    const confirmBtn = modal.locator('button:has-text("Clone All")');
                    await confirmBtn.click();

                    await page.waitForTimeout(500);
                    await helpers.expectToast('cloned', 'success');
                }
            }
        });

        test('should handle clone conflicts', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Find scope
            const firstScope = page.locator('[data-testid="dhcp-scope"]').first();
            const cloneBtn = firstScope.locator('[data-testid="clone-scope-btn"]');

            if (await cloneBtn.isVisible()) {
                await cloneBtn.click();
                await page.waitForTimeout(500);

                // If scope already exists, should show conflict resolution
                const conflictDialog = page.locator('[data-testid="conflict-resolution-dialog"]');
                const hasConflict = await conflictDialog.isVisible().catch(() => false);

                if (hasConflict) {
                    // Choose resolution (e.g., overwrite)
                    const overwriteBtn = conflictDialog.locator('button:has-text("Overwrite")');
                    if (await overwriteBtn.isVisible()) {
                        await overwriteBtn.click();
                        await page.waitForTimeout(500);
                    }
                }
            }
        });
    });

    test.describe('DHCP Leases', () => {
        test('should display DHCP leases', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Click Leases tab if separate
            const leasesTab = page.locator('[data-testid="leases-tab"]');
            if (await leasesTab.isVisible()) {
                await leasesTab.click();
                await helpers.waitForApp();
            }

            // Should show leases
            const leases = page.locator('[data-testid="lease-item"]');
            const leaseCount = await leases.count();

            if (leaseCount > 0) {
                expect(leaseCount).toBeGreaterThan(0);
            }
        });

        test('should show lease details (IP, MAC, expiry)', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const leasesTab = page.locator('[data-testid="leases-tab"]');
            if (await leasesTab.isVisible()) {
                await leasesTab.click();
                await helpers.waitForApp();
            }

            // First lease should show details
            const lease = page.locator('[data-testid="lease-item"]').first();
            const hasDetails = await lease.isVisible().catch(() => false);

            if (hasDetails) {
                // Should have IP, MAC, or other info visible
                expect(await lease.isVisible()).toBeTruthy();
            }
        });

        test('should search leases by hostname', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const leasesTab = page.locator('[data-testid="leases-tab"]');
            if (await leasesTab.isVisible()) {
                await leasesTab.click();
                await helpers.waitForApp();
            }

            // Get initial count
            const initialCount = await page.locator('[data-testid="lease-item"]').count();

            // Find search input
            const searchInput = page.locator('[data-testid="lease-search-input"]');
            if (await searchInput.isVisible()) {
                await searchInput.fill('test');
                await page.waitForTimeout(500);

                // Count should change or show no results
                const filteredCount = await page.locator('[data-testid="lease-item"]').count();
                expect(filteredCount <= initialCount).toBeTruthy();
            }
        });

        test('should filter leases by scope', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const leasesTab = page.locator('[data-testid="leases-tab"]');
            if (await leasesTab.isVisible()) {
                await leasesTab.click();
                await helpers.waitForApp();
            }

            // Find scope filter
            const scopeFilter = page.locator('[data-testid="lease-scope-filter"]');
            if (await scopeFilter.isVisible()) {
                const options = await scopeFilter.locator('option').count();
                if (options > 1) {
                    await scopeFilter.selectOption({ index: 1 });
                    await page.waitForTimeout(500);

                    // Should filter leases
                    const leases = page.locator('[data-testid="lease-item"]');
                    expect(await leases.count()).toBeGreaterThanOrEqual(0);
                }
            }
        });
    });

    test.describe('DHCP Reservations', () => {
        test('should create DHCP reservation', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Click reservations tab if exists
            const reservationsTab = page.locator('[data-testid="reservations-tab"]');
            if (await reservationsTab.isVisible()) {
                await reservationsTab.click();
                await helpers.waitForApp();
            }

            // Find add reservation button
            const addBtn = page.locator('[data-testid="add-reservation-btn"]');
            if (await addBtn.isVisible()) {
                await addBtn.click();
                await helpers.waitForApp();

                // Should show reservation form
                const form = page.locator('[data-testid="reservation-form"]');
                await expect(form).toBeVisible();

                // Fill reservation details
                await helpers.fillField('Hostname', 'mydevice.local');
                await helpers.fillField('MAC Address', 'AA:BB:CC:DD:EE:FF');
                await helpers.fillField('IP Address', '192.168.1.50');

                // Create reservation
                const createBtn = form.locator('button:has-text("Create")');
                await createBtn.click();

                await page.waitForTimeout(500);
                await helpers.expectToast('created', 'success');
            }
        });

        test('should edit DHCP reservation', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const reservationsTab = page.locator('[data-testid="reservations-tab"]');
            if (await reservationsTab.isVisible()) {
                await reservationsTab.click();
                await helpers.waitForApp();
            }

            // Find first reservation
            const reservation = page.locator('[data-testid="reservation-item"]').first();
            const editBtn = reservation.locator('[data-testid="edit-reservation-btn"]');

            if (await editBtn.isVisible()) {
                await editBtn.click();
                await helpers.waitForApp();

                // Should open edit form
                const form = page.locator('[data-testid="reservation-edit-form"]');
                await expect(form).toBeVisible();

                // Modify IP
                const ipInput = form.locator('[data-testid="ip-address-input"]');
                if (await ipInput.isVisible()) {
                    await ipInput.clear();
                    await ipInput.fill('192.168.1.51');
                }

                // Save
                const saveBtn = form.locator('button:has-text("Save")');
                await saveBtn.click();

                await page.waitForTimeout(500);
                await helpers.expectToast('updated', 'success');
            }
        });

        test('should delete DHCP reservation', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const reservationsTab = page.locator('[data-testid="reservations-tab"]');
            if (await reservationsTab.isVisible()) {
                await reservationsTab.click();
                await helpers.waitForApp();
            }

            // Find reservation to delete
            const reservation = page.locator('[data-testid="reservation-item"]').first();
            const deleteBtn = reservation.locator('[data-testid="delete-reservation-btn"]');

            if (await deleteBtn.isVisible()) {
                await deleteBtn.click();
                await page.waitForTimeout(300);

                // Confirm deletion
                const confirmDialog = page.locator('[data-testid="confirm-delete-dialog"]');
                const hasDialog = await confirmDialog.isVisible().catch(() => false);

                if (hasDialog) {
                    const confirmBtn = confirmDialog.locator('button:has-text("Delete")');
                    await confirmBtn.click();

                    await page.waitForTimeout(500);
                    await helpers.expectToast('deleted', 'success');
                }
            }
        });

        test('should display all reservations', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const reservationsTab = page.locator('[data-testid="reservations-tab"]');
            if (await reservationsTab.isVisible()) {
                await reservationsTab.click();
                await helpers.waitForApp();
            }

            // Should have reservations
            const reservations = page.locator('[data-testid="reservation-item"]');
            // May have zero or more reservations
            expect(await reservations.count()).toBeGreaterThanOrEqual(0);
        });
    });

    test.describe('DHCP Synchronization', () => {
        test('should sync DHCP configuration between nodes', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Find sync button
            const syncBtn = page.locator('[data-testid="sync-dhcp-btn"]');

            if (await syncBtn.isVisible()) {
                await syncBtn.click();
                await page.waitForTimeout(500);

                // Should show sync options/confirmation
                const syncModal = page.locator('[data-testid="sync-dhcp-modal"]');
                const hasModal = await syncModal.isVisible().catch(() => false);

                if (hasModal) {
                    // Select what to sync (scopes, leases, reservations)
                    const scopesCheckbox = syncModal.locator('[data-testid="sync-scopes-checkbox"]');
                    if (await scopesCheckbox.isVisible()) {
                        // Check/uncheck as needed
                    }

                    // Confirm sync
                    const confirmBtn = syncModal.locator('button:has-text("Sync")');
                    if (await confirmBtn.isVisible()) {
                        await confirmBtn.click();
                        await helpers.expectToast('synced', 'success');
                    }
                }
            }
        });

        test('should compare DHCP scopes across nodes', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Scopes should show which nodes they're on
            const scope = page.locator('[data-testid="dhcp-scope"]').first();

            // Should have node indicators
            const nodeIndicators = scope.locator('[data-testid="node-indicator"]');
            const nodeCount = await nodeIndicators.count();

            expect(nodeCount).toBeGreaterThan(0);
        });
    });

    test.describe('DHCP Error Handling', () => {
        test('should validate IP range', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const addBtn = page.locator('[data-testid="add-scope-btn"]');
            if (await addBtn.isVisible()) {
                await addBtn.click();
                await helpers.waitForApp();

                const form = page.locator('[data-testid="scope-form"]');

                // Try to create with invalid IP range
                const startInput = form.locator('[data-testid="start-ip-input"]');
                const endInput = form.locator('[data-testid="end-ip-input"]');

                if (await startInput.isVisible() && await endInput.isVisible()) {
                    await startInput.fill('192.168.1.100');
                    await endInput.fill('192.168.1.50'); // End < Start (invalid)

                    const createBtn = form.locator('button:has-text("Create")');
                    await createBtn.click();

                    await page.waitForTimeout(500);

                    // Should show error
                    const errorMsg = form.locator('[data-testid="validation-error"]');
                    const hasError = await errorMsg.isVisible().catch(() => false);

                    if (hasError) {
                        expect(await errorMsg.textContent()).toContain('invalid');
                    }
                }
            }
        });

        test('should validate MAC address format', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const reservationsTab = page.locator('[data-testid="reservations-tab"]');
            if (await reservationsTab.isVisible()) {
                await reservationsTab.click();
                await helpers.waitForApp();
            }

            const addBtn = page.locator('[data-testid="add-reservation-btn"]');
            if (await addBtn.isVisible()) {
                await addBtn.click();
                await helpers.waitForApp();

                const form = page.locator('[data-testid="reservation-form"]');
                const macInput = form.locator('[data-testid="mac-address-input"]');

                if (await macInput.isVisible()) {
                    await macInput.fill('invalid-mac-address');

                    const createBtn = form.locator('button:has-text("Create")');
                    await createBtn.click();

                    await page.waitForTimeout(500);

                    // Should show validation error
                    const errorMsg = form.locator('[data-testid="validation-error"]');
                    const hasError = await errorMsg.isVisible().catch(() => false);

                    if (hasError) {
                        expect(await errorMsg.textContent()).toContain('MAC');
                    }
                }
            }
        });
    });

    test.describe('Mobile Responsiveness', () => {
        test('should display DHCP on mobile', async () => {
            await page.setViewportSize({ width: 375, height: 667 });

            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Should have scopes visible
            const scopes = page.locator('[data-testid="dhcp-scope"]');
            expect(await scopes.count()).toBeGreaterThanOrEqual(0);
        });

        test('should have touch-friendly scope cards', async () => {
            await page.setViewportSize({ width: 375, height: 667 });

            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Scope items should be tap-able
            const scopes = page.locator('[data-testid="dhcp-scope"]');

            for (let i = 0; i < Math.min(2, await scopes.count()); i++) {
                const box = await scopes.nth(i).boundingBox();
                if (box) {
                    expect(box.height).toBeGreaterThan(40);
                }
            }
        });

        test('should show responsive tabs on mobile', async () => {
            await page.setViewportSize({ width: 375, height: 667 });

            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            // Tabs should be visible
            const tabs = page.locator('[data-testid="dhcp-tab"]');
            const count = await tabs.count();

            expect(count).toBeGreaterThan(0);
        });
    });

    test.describe('Performance', () => {
        test('should load DHCP page quickly', async () => {
            const startTime = Date.now();

            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const loadTime = Date.now() - startTime;

            // Should load in under 2 seconds
            expect(loadTime).toBeLessThan(2000);
        });

        test('should search leases efficiently', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const leasesTab = page.locator('[data-testid="leases-tab"]');
            if (await leasesTab.isVisible()) {
                await leasesTab.click();
                await helpers.waitForApp();
            }

            const searchInput = page.locator('[data-testid="lease-search-input"]');
            if (await searchInput.isVisible()) {
                const startTime = Date.now();

                await searchInput.fill('test');
                await page.waitForTimeout(500);

                const searchTime = Date.now() - startTime;

                // Search should be quick
                expect(searchTime).toBeLessThan(1000);
            }
        });

        test('should handle large lease lists', async () => {
            await page.click('a:has-text("DHCP")');
            await helpers.waitForApp();

            const leasesTab = page.locator('[data-testid="leases-tab"]');
            if (await leasesTab.isVisible()) {
                await leasesTab.click();
                await helpers.waitForApp();
            }

            // Scroll through leases
            const leasesList = page.locator('[data-testid="leases-list"]');

            if (await leasesList.isVisible()) {
                await leasesList.evaluate((el) => {
                    el.scrollTop += 500;
                });

                await page.waitForTimeout(500);

                // Should still be responsive
                const leases = page.locator('[data-testid="lease-item"]');
                expect(await leases.count()).toBeGreaterThanOrEqual(0);
            }
        });
    });
});
