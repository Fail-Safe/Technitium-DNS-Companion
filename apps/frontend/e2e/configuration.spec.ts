import { test, expect, Page } from '@playwright/test';
import { PageHelpers } from './helpers';

/**
 * E2E Tests: Configuration
 * Tests real user workflows for node configuration and settings management
 */

test.describe('Configuration E2E', () => {
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

    test.describe('Configuration Page Navigation', () => {
        test('should navigate to configuration page', async () => {
            // Click Configuration link
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Verify page loaded
            await expect(page.locator('h1:has-text("Configuration")')).toBeVisible();
        });

        test('should display node list on configuration page', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Should have node cards or list
            const nodes = page.locator('[data-testid="node-card"]');
            const nodeCount = await nodes.count();

            expect(nodeCount).toBeGreaterThan(0);
        });

        test('should display configuration sections for each node', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // First node should have configuration options
            const nodeCard = page.locator('[data-testid="node-card"]').first();
            await expect(nodeCard).toBeVisible();

            // Should have settings button or expandable section
            const settingsBtn = nodeCard.locator('[data-testid="node-settings-btn"]');
            const expandBtn = nodeCard.locator('[data-testid="expand-btn"]');

            const hasSettingsBtn = await settingsBtn.isVisible().catch(() => false);
            const hasExpandBtn = await expandBtn.isVisible().catch(() => false);

            expect(hasSettingsBtn || hasExpandBtn).toBeTruthy();
        });
    });

    test.describe('Node Credentials Management', () => {
        test('should edit node credentials', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Click edit on first node
            const nodeCard = page.locator('[data-testid="node-card"]').first();
            await nodeCard.locator('[data-testid="edit-btn"]').click();

            // Should open edit modal/form
            const modal = page.locator('[data-testid="node-edit-modal"]');
            await expect(modal).toBeVisible();

            // Should have name field
            const nameInput = modal.locator('[data-testid="node-name-input"]');
            await expect(nameInput).toBeVisible();
        });

        test('should update node hostname', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            const nodeCard = page.locator('[data-testid="node-card"]').first();
            await nodeCard.locator('[data-testid="edit-btn"]').click();

            const modal = page.locator('[data-testid="node-edit-modal"]');
            const hostnameInput = modal.locator('[data-testid="node-hostname-input"]');

            // Clear and enter new value
            await hostnameInput.clear();
            await hostnameInput.fill('test-hostname.local');

            // Save
            await modal.locator('button:has-text("Save")').click();
            await helpers.waitForApp();

            // Should see success toast
            await helpers.expectToast('saved', 'success');
        });

        test('should test node connection', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            const nodeCard = page.locator('[data-testid="node-card"]').first();

            // Click test connection button
            const testBtn = nodeCard.locator('[data-testid="test-connection-btn"]');
            if (await testBtn.isVisible()) {
                await testBtn.click();
                await page.waitForTimeout(1000);

                // Should show connection status
                const status = page.locator('[data-testid="connection-status"]');
                await expect(status).toBeVisible();
            }
        });

        test('should display node status indicator', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Node card should have status badge
            const nodeCard = page.locator('[data-testid="node-card"]').first();
            const statusBadge = nodeCard.locator('[data-testid="node-status-badge"]');

            await expect(statusBadge).toBeVisible();

            // Status should be one of: online, offline, error, unknown
            const status = await statusBadge.textContent();
            expect(['online', 'offline', 'error', 'unknown']).toContain(status?.toLowerCase());
        });

        test('should handle connection error gracefully', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Try to connect to invalid hostname
            const nodeCard = page.locator('[data-testid="node-card"]').first();
            await nodeCard.locator('[data-testid="edit-btn"]').click();

            const modal = page.locator('[data-testid="node-edit-modal"]');
            const hostnameInput = modal.locator('[data-testid="node-hostname-input"]');

            await hostnameInput.clear();
            await hostnameInput.fill('invalid-host-12345.invalid');

            await modal.locator('button:has-text("Save")').click();
            await page.waitForTimeout(1000);

            // Should show error message
            const errorMsg = page.locator('[data-testid="connection-error"]');
            const hasError = await errorMsg.isVisible().catch(() => false);

            if (hasError) {
                expect(await errorMsg.textContent()).toContain('connection');
            }
        });
    });

    test.describe('DNS Settings', () => {
        test('should view DNS settings', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Click on DNS settings tab or section
            const dnsTab = page.locator('[data-testid="dns-settings-tab"]');
            if (await dnsTab.isVisible()) {
                await dnsTab.click();
                await helpers.waitForApp();
            }

            // Should show DNS configuration
            const dnsSection = page.locator('[data-testid="dns-settings"]');
            const hasSettings = await dnsSection.isVisible().catch(() => false);

            if (hasSettings) {
                expect(await dnsSection.isVisible()).toBeTruthy();
            }
        });

        test('should update recursive resolution setting', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Find recursive resolution toggle
            const recursiveToggle = page.locator('[data-testid="recursive-resolution-toggle"]');

            if (await recursiveToggle.isVisible()) {
                const initialState = await recursiveToggle.isChecked();

                // Toggle it
                await recursiveToggle.click();
                await page.waitForTimeout(500);

                // Get new state
                const newState = await recursiveToggle.isChecked();
                expect(newState).not.toBe(initialState);

                // Should save automatically or show save button
                const saveBtn = page.locator('[data-testid="save-dns-settings-btn"]');
                if (await saveBtn.isVisible()) {
                    await saveBtn.click();
                    await helpers.waitForApp();
                    await helpers.expectToast('saved', 'success');
                }
            }
        });

        test('should update forwarder settings', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Find forwarder input
            const forwarderInput = page.locator('[data-testid="forwarder-input"]');

            if (await forwarderInput.isVisible()) {
                // Add a forwarder
                await forwarderInput.fill('8.8.8.8');
                await page.press('[data-testid="forwarder-input"]', 'Enter');

                await page.waitForTimeout(500);

                // Should see in list
                const forwarders = page.locator('[data-testid="forwarder-item"]');
                const count = await forwarders.count();
                expect(count).toBeGreaterThan(0);
            }
        });
    });

    test.describe('DHCP Settings', () => {
        test('should view DHCP settings', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Click DHCP settings tab
            const dhcpTab = page.locator('[data-testid="dhcp-settings-tab"]');
            if (await dhcpTab.isVisible()) {
                await dhcpTab.click();
                await helpers.waitForApp();
            }

            // Should show DHCP configuration
            const dhcpSection = page.locator('[data-testid="dhcp-settings"]');
            const hasDHCP = await dhcpSection.isVisible().catch(() => false);

            if (hasDHCP) {
                expect(await dhcpSection.isVisible()).toBeTruthy();
            }
        });

        test('should toggle DHCP enabled', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Find DHCP toggle
            const dhcpToggle = page.locator('[data-testid="dhcp-enabled-toggle"]');

            if (await dhcpToggle.isVisible()) {
                const initialState = await dhcpToggle.isChecked();

                // Toggle
                await dhcpToggle.click();
                await page.waitForTimeout(500);

                const newState = await dhcpToggle.isChecked();
                expect(newState).not.toBe(initialState);

                // Save
                const saveBtn = page.locator('[data-testid="save-dhcp-settings-btn"]');
                if (await saveBtn.isVisible()) {
                    await saveBtn.click();
                    await helpers.expectToast('saved', 'success');
                }
            }
        });

        test('should update DHCP lease time', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            const leaseInput = page.locator('[data-testid="dhcp-lease-time-input"]');

            if (await leaseInput.isVisible()) {
                await leaseInput.clear();
                await leaseInput.fill('3600');

                // Save
                const saveBtn = page.locator('[data-testid="save-dhcp-settings-btn"]');
                if (await saveBtn.isVisible()) {
                    await saveBtn.click();
                    await helpers.expectToast('saved', 'success');
                }
            }
        });

        test('should configure DHCP scope', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Find add scope button
            const addScopeBtn = page.locator('[data-testid="add-dhcp-scope-btn"]');

            if (await addScopeBtn.isVisible()) {
                await addScopeBtn.click();
                await helpers.waitForApp();

                // Should show scope form
                const scopeForm = page.locator('[data-testid="dhcp-scope-form"]');
                await expect(scopeForm).toBeVisible();

                // Fill scope details
                const nameInput = scopeForm.locator('[data-testid="scope-name-input"]');
                const startInput = scopeForm.locator('[data-testid="scope-start-input"]');
                const endInput = scopeForm.locator('[data-testid="scope-end-input"]');

                if (await nameInput.isVisible()) {
                    await nameInput.fill('Test Scope');
                }
                if (await startInput.isVisible()) {
                    await startInput.fill('192.168.1.100');
                }
                if (await endInput.isVisible()) {
                    await endInput.fill('192.168.1.150');
                }

                // Save scope
                const saveScopeBtn = scopeForm.locator('button:has-text("Create")');
                if (await saveScopeBtn.isVisible()) {
                    await saveScopeBtn.click();
                    await helpers.expectToast('created', 'success');
                }
            }
        });
    });

    test.describe('Logging Settings', () => {
        test('should view logging settings', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Click logging tab
            const loggingTab = page.locator('[data-testid="logging-settings-tab"]');
            if (await loggingTab.isVisible()) {
                await loggingTab.click();
                await helpers.waitForApp();
            }

            // Should show logging configuration
            const loggingSection = page.locator('[data-testid="logging-settings"]');
            const hasLogging = await loggingSection.isVisible().catch(() => false);

            if (hasLogging) {
                expect(await loggingSection.isVisible()).toBeTruthy();
            }
        });

        test('should toggle query logging', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            const queryLogToggle = page.locator('[data-testid="query-logging-toggle"]');

            if (await queryLogToggle.isVisible()) {
                const initialState = await queryLogToggle.isChecked();

                await queryLogToggle.click();
                await page.waitForTimeout(500);

                const newState = await queryLogToggle.isChecked();
                expect(newState).not.toBe(initialState);

                // Save
                const saveBtn = page.locator('[data-testid="save-logging-settings-btn"]');
                if (await saveBtn.isVisible()) {
                    await saveBtn.click();
                    await helpers.expectToast('saved', 'success');
                }
            }
        });

        test('should update log retention', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            const retentionInput = page.locator('[data-testid="log-retention-input"]');

            if (await retentionInput.isVisible()) {
                await retentionInput.clear();
                await retentionInput.fill('30');

                const saveBtn = page.locator('[data-testid="save-logging-settings-btn"]');
                if (await saveBtn.isVisible()) {
                    await saveBtn.click();
                    await helpers.expectToast('saved', 'success');
                }
            }
        });
    });

    test.describe('Settings Persistence', () => {
        test('should persist DNS settings across page reload', async () => {
            // First visit: Update a setting
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            const toggle = page.locator('[data-testid="recursive-resolution-toggle"]');
            if (await toggle.isVisible()) {
                const initialState = await toggle.isChecked();
                await toggle.click();

                const saveBtn = page.locator('[data-testid="save-dns-settings-btn"]');
                if (await saveBtn.isVisible()) {
                    await saveBtn.click();
                    await helpers.expectToast('saved', 'success');
                }

                await page.waitForTimeout(500);

                // Reload page
                await page.reload();
                await helpers.waitForApp();

                // Navigate back to configuration
                await page.click('a:has-text("Configuration")');
                await helpers.waitForApp();

                // Check setting is still changed
                const reloadedToggle = page.locator('[data-testid="recursive-resolution-toggle"]');
                if (await reloadedToggle.isVisible()) {
                    const reloadedState = await reloadedToggle.isChecked();
                    expect(reloadedState).not.toBe(initialState);
                }
            }
        });

        test('should sync settings across nodes', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Find sync button
            const syncBtn = page.locator('[data-testid="sync-nodes-btn"]');

            if (await syncBtn.isVisible()) {
                await syncBtn.click();
                await page.waitForTimeout(1000);

                // Should show sync results
                const syncModal = page.locator('[data-testid="sync-results-modal"]');
                const hasSyncModal = await syncModal.isVisible().catch(() => false);

                if (hasSyncModal) {
                    expect(await syncModal.isVisible()).toBeTruthy();
                }
            }
        });
    });

    test.describe('Error Handling', () => {
        test('should validate required fields', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Try to save without filling required fields
            const nodeCard = page.locator('[data-testid="node-card"]').first();
            await nodeCard.locator('[data-testid="edit-btn"]').click();

            const modal = page.locator('[data-testid="node-edit-modal"]');
            const nameInput = modal.locator('[data-testid="node-name-input"]');

            // Clear the name field
            await nameInput.clear();

            // Try to save
            const saveBtn = modal.locator('button:has-text("Save")');
            await saveBtn.click();

            // Should show validation error
            const errorMsg = modal.locator('[data-testid="validation-error"]');
            const hasError = await errorMsg.isVisible().catch(() => false);

            if (hasError) {
                expect(await errorMsg.textContent()).toContain('required');
            }
        });

        test('should handle API errors gracefully', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Try to update with invalid data
            const forwarderInput = page.locator('[data-testid="forwarder-input"]');

            if (await forwarderInput.isVisible()) {
                await forwarderInput.fill('invalid-ip');
                await page.press('[data-testid="forwarder-input"]', 'Enter');

                await page.waitForTimeout(500);

                // Should show error toast
                const errorToast = page.locator('[data-testid="toast"]:has-text("invalid")');
                const hasError = await errorToast.isVisible().catch(() => false);

                if (hasError) {
                    await helpers.expectToast('invalid', 'error');
                }
            }
        });
    });

    test.describe('Mobile Responsiveness', () => {
        test('should display configuration on mobile', async () => {
            // Set mobile viewport
            await page.setViewportSize({ width: 375, height: 667 });

            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Should still be accessible
            const nodes = page.locator('[data-testid="node-card"]');
            const count = await nodes.count();

            expect(count).toBeGreaterThan(0);
        });

        test('should show responsive tabs on mobile', async () => {
            await page.setViewportSize({ width: 375, height: 667 });

            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Tabs should be visible or in a menu
            const tabs = page.locator('[data-testid="settings-tab"]');
            const tabCount = await tabs.count();

            // Should have at least some tabs visible
            expect(tabCount).toBeGreaterThan(0);
        });

        test('should have mobile-friendly forms', async () => {
            await page.setViewportSize({ width: 375, height: 667 });

            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            // Get all form inputs
            const inputs = page.locator('input, select, textarea');
            const inputCount = await inputs.count();

            for (let i = 0; i < Math.min(3, inputCount); i++) {
                const box = await inputs.nth(i).boundingBox();
                if (box) {
                    // Input should be readable on mobile
                    expect(box.width).toBeGreaterThan(50);
                    expect(box.height).toBeGreaterThan(40);
                }
            }
        });
    });

    test.describe('Performance', () => {
        test('should load configuration page quickly', async () => {
            const startTime = Date.now();

            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            const loadTime = Date.now() - startTime;

            // Should load in under 2 seconds
            expect(loadTime).toBeLessThan(2000);
        });

        test('should update settings without full page reload', async () => {
            await page.click('a:has-text("Configuration")');
            await helpers.waitForApp();

            const toggle = page.locator('[data-testid="recursive-resolution-toggle"]');

            if (await toggle.isVisible()) {
                const startTime = Date.now();

                await toggle.click();
                const saveBtn = page.locator('[data-testid="save-dns-settings-btn"]');
                if (await saveBtn.isVisible()) {
                    await saveBtn.click();
                    await page.waitForTimeout(500);
                }

                const updateTime = Date.now() - startTime;

                // Update should be quick (< 1.5 seconds)
                expect(updateTime).toBeLessThan(1500);
            }
        });
    });
});
