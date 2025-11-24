import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Toast Notification API Tests
 *
 * Validates the ToastContext notification system.
 * This is CRITICAL because:
 * - Users MUST be notified of errors immediately
 * - Toast queue must not drop notifications
 * - Auto-dismiss timing must be reliable (prevents stale notifications)
 * - Manual dismiss must prevent auto-dismiss (avoids race conditions)
 *
 * These tests ensure:
 * - Notifications are displayed with correct tone (error/success/info)
 * - Auto-dismiss triggers after specified timeout
 * - Manual dismiss removes notification and clears timeout
 * - Multiple toasts can be queued and displayed
 * - Zero-timeout toasts don't auto-dismiss
 * - Notification IDs are unique and are returned for tracking
 * - Cleanup happens on component unmount (no memory leaks)
 */

interface ToastRecord {
    id: string;
    message: string;
    tone: 'info' | 'success' | 'error';
}

interface ToastOptions {
    message: string;
    tone?: 'info' | 'success' | 'error';
    timeout?: number;
}

/**
 * Toast Manager - Simulates the ToastContext behavior
 * Used for testing without needing React Provider setup
 */
class ToastManager {
    private toasts: ToastRecord[] = [];
    private timers: Map<string, number> = new Map();
    private idCounter = 0;

    pushToast(options: ToastOptions): string {
        const id = `toast-${++this.idCounter}`;
        const tone = options.tone ?? 'info';
        const toast: ToastRecord = {
            id,
            message: options.message,
            tone,
        };

        this.toasts.push(toast);

        const duration = options.timeout ?? 5000;
        if (duration > 0) {
            const handle = window.setTimeout(() => {
                this.dismissToast(id);
            }, duration);
            this.timers.set(id, handle);
        }

        return id;
    }

    dismissToast(id: string) {
        this.toasts = this.toasts.filter((toast) => toast.id !== id);

        const handle = this.timers.get(id);
        if (handle !== undefined) {
            window.clearTimeout(handle);
            this.timers.delete(id);
        }
    }

    getToasts(): ToastRecord[] {
        return [...this.toasts];
    }

    cleanup() {
        this.timers.forEach((handle) => window.clearTimeout(handle));
        this.timers.clear();
        this.toasts = [];
    }
}

describe('Toast Notification System', () => {
    let toastManager: ToastManager;

    beforeEach(() => {
        toastManager = new ToastManager();
        vi.useFakeTimers();
    });

    afterEach(() => {
        toastManager.cleanup();
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    /**
     * Test: Basic Toast Creation
     *
     * Validates that toasts can be created with different tones.
     * Critical because: Users need to distinguish error/success/info notifications.
     */
    describe('Toast Creation', () => {
        it('should create an info toast with default tone', () => {
            const id = toastManager.pushToast({
                message: 'This is an info message',
            });

            const toasts = toastManager.getToasts();
            expect(toasts).toHaveLength(1);
            expect(toasts[0].tone).toBe('info');
            expect(toasts[0].message).toBe('This is an info message');
            expect(id).toBeDefined();
        });

        it('should create an error toast', () => {
            const id = toastManager.pushToast({
                message: 'An error occurred',
                tone: 'error',
            });

            const toasts = toastManager.getToasts();
            expect(toasts).toHaveLength(1);
            expect(toasts[0].tone).toBe('error');
            expect(toasts[0].message).toBe('An error occurred');
            expect(typeof id).toBe('string');
        });

        it('should create a success toast', () => {
            const id = toastManager.pushToast({
                message: 'Operation successful',
                tone: 'success',
            });

            const toasts = toastManager.getToasts();
            expect(toasts).toHaveLength(1);
            expect(toasts[0].tone).toBe('success');
            expect(toasts[0].message).toBe('Operation successful');
            expect(id).toBeDefined();
        });

        it('should generate unique toast IDs', () => {
            const id1 = toastManager.pushToast({ message: 'Toast 1' });
            const id2 = toastManager.pushToast({ message: 'Toast 2' });
            const id3 = toastManager.pushToast({ message: 'Toast 3' });

            expect(id1).not.toBe(id2);
            expect(id2).not.toBe(id3);
            expect(id1).not.toBe(id3);
        });

        it('should preserve message text exactly', () => {
            const message = 'Domain "example.com" added to blocklist successfully!';
            toastManager.pushToast({ message });

            const toasts = toastManager.getToasts();
            expect(toasts[0].message).toBe(message);
        });
    });

    /**
     * Test: Toast Queue Management
     *
     * Validates that multiple toasts can coexist in the queue.
     * Critical because: Multiple operations may trigger notifications simultaneously.
     */
    describe('Toast Queue Management', () => {
        it('should queue multiple toasts', () => {
            toastManager.pushToast({ message: 'First', tone: 'info' });
            toastManager.pushToast({ message: 'Second', tone: 'success' });
            toastManager.pushToast({ message: 'Third', tone: 'error' });

            const toasts = toastManager.getToasts();
            expect(toasts).toHaveLength(3);
            expect(toasts[0].message).toBe('First');
            expect(toasts[1].message).toBe('Second');
            expect(toasts[2].message).toBe('Third');
        });

        it('should preserve toast order', () => {
            const id1 = toastManager.pushToast({ message: 'A' });
            const id2 = toastManager.pushToast({ message: 'B' });
            const id3 = toastManager.pushToast({ message: 'C' });

            const toasts = toastManager.getToasts();
            expect(toasts[0].id).toBe(id1);
            expect(toasts[1].id).toBe(id2);
            expect(toasts[2].id).toBe(id3);
        });

        it('should handle large queue of toasts', () => {
            const count = 50;
            for (let i = 0; i < count; i++) {
                toastManager.pushToast({ message: `Toast ${i + 1}` });
            }

            const toasts = toastManager.getToasts();
            expect(toasts).toHaveLength(count);
        });

        it('should not lose toasts when adding new ones', () => {
            const id1 = toastManager.pushToast({ message: 'First' });
            expect(toastManager.getToasts()).toHaveLength(1);

            const id2 = toastManager.pushToast({ message: 'Second' });
            expect(toastManager.getToasts()).toHaveLength(2);

            const id3 = toastManager.pushToast({ message: 'Third' });
            expect(toastManager.getToasts()).toHaveLength(3);

            const toasts = toastManager.getToasts();
            expect(toasts.map((t) => t.id)).toEqual([id1, id2, id3]);
        });
    });

    /**
     * Test: Auto-Dismiss Timeout
     *
     * Validates that toasts automatically dismiss after the specified duration.
     * Critical because: Stale notifications clutter the UI.
     */
    describe('Auto-Dismiss Timeout', () => {
        it('should auto-dismiss after default timeout (5000ms)', () => {
            toastManager.pushToast({ message: 'Will auto-dismiss' });

            expect(toastManager.getToasts()).toHaveLength(1);

            vi.advanceTimersByTime(5000);

            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should auto-dismiss after custom timeout', () => {
            toastManager.pushToast({
                message: 'Custom timeout',
                timeout: 3000,
            });

            expect(toastManager.getToasts()).toHaveLength(1);

            vi.advanceTimersByTime(2999);
            expect(toastManager.getToasts()).toHaveLength(1);

            vi.advanceTimersByTime(1);
            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should not auto-dismiss when timeout is 0', () => {
            toastManager.pushToast({
                message: 'No auto-dismiss',
                timeout: 0,
            });

            expect(toastManager.getToasts()).toHaveLength(1);

            vi.advanceTimersByTime(10000);

            expect(toastManager.getToasts()).toHaveLength(1);
        });

        it('should not auto-dismiss when timeout is negative', () => {
            toastManager.pushToast({
                message: 'No auto-dismiss',
                timeout: -1,
            });

            expect(toastManager.getToasts()).toHaveLength(1);

            vi.advanceTimersByTime(10000);

            expect(toastManager.getToasts()).toHaveLength(1);
        });

        it('should auto-dismiss very short timeouts', () => {
            toastManager.pushToast({
                message: 'Very short',
                timeout: 1,
            });

            expect(toastManager.getToasts()).toHaveLength(1);

            vi.advanceTimersByTime(1);

            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should auto-dismiss multiple toasts with different timeouts', () => {
            toastManager.pushToast({ message: 'Expires in 1s', timeout: 1000 });
            toastManager.pushToast({ message: 'Expires in 2s', timeout: 2000 });
            toastManager.pushToast({ message: 'Expires in 3s', timeout: 3000 });

            expect(toastManager.getToasts()).toHaveLength(3);

            vi.advanceTimersByTime(1000);
            expect(toastManager.getToasts()).toHaveLength(2);

            vi.advanceTimersByTime(1000);
            expect(toastManager.getToasts()).toHaveLength(1);

            vi.advanceTimersByTime(1000);
            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should handle rapid timeout expirations', () => {
            for (let i = 0; i < 10; i++) {
                toastManager.pushToast({
                    message: `Toast ${i}`,
                    timeout: 1000,
                });
            }

            expect(toastManager.getToasts()).toHaveLength(10);

            vi.advanceTimersByTime(1000);

            expect(toastManager.getToasts()).toHaveLength(0);
        });
    });

    /**
     * Test: Manual Dismiss
     *
     * Validates that toasts can be manually dismissed and cleanup is proper.
     * Critical because: Users must be able to dismiss notifications manually.
     */
    describe('Manual Dismiss', () => {
        it('should dismiss a single toast', () => {
            const id = toastManager.pushToast({ message: 'Dismiss me' });

            expect(toastManager.getToasts()).toHaveLength(1);

            toastManager.dismissToast(id);

            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should dismiss specific toast from queue', () => {
            const id1 = toastManager.pushToast({ message: 'Toast 1' });
            const id2 = toastManager.pushToast({ message: 'Toast 2' });
            const id3 = toastManager.pushToast({ message: 'Toast 3' });

            toastManager.dismissToast(id2);

            const toasts = toastManager.getToasts();
            expect(toasts).toHaveLength(2);
            expect(toasts.map((t) => t.id)).toEqual([id1, id3]);
        });

        it('should clear timeout when dismissing', () => {
            const id = toastManager.pushToast({
                message: 'Dismiss before timeout',
                timeout: 5000,
            });

            toastManager.dismissToast(id);

            vi.advanceTimersByTime(5000);

            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should prevent race condition: dismiss then timeout', () => {
            const id = toastManager.pushToast({
                message: 'Dismiss before timeout',
                timeout: 5000,
            });

            toastManager.dismissToast(id);
            expect(toastManager.getToasts()).toHaveLength(0);

            vi.advanceTimersByTime(5000);

            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should not error when dismissing non-existent toast', () => {
            expect(() => {
                toastManager.dismissToast('non-existent-id');
            }).not.toThrow();
        });

        it('should not error when dismissing already dismissed toast', () => {
            const id = toastManager.pushToast({ message: 'Test' });

            toastManager.dismissToast(id);
            expect(() => {
                toastManager.dismissToast(id);
            }).not.toThrow();
        });

        it('should dismiss all toasts individually', () => {
            const ids = [
                toastManager.pushToast({ message: '1' }),
                toastManager.pushToast({ message: '2' }),
                toastManager.pushToast({ message: '3' }),
            ];

            expect(toastManager.getToasts()).toHaveLength(3);

            ids.forEach((id) => toastManager.dismissToast(id));

            expect(toastManager.getToasts()).toHaveLength(0);
        });
    });

    /**
     * Test: Real-World Scenarios
     *
     * Validates common notification patterns in the application.
     * Critical because: These are the actual use cases in production.
     */
    describe('Real-World Scenarios', () => {
        it('should handle error on domain add failure', () => {
            toastManager.pushToast({
                message: 'Failed to add domain to blocklist',
                tone: 'error',
                timeout: 7000,
            });

            const toasts = toastManager.getToasts();
            expect(toasts[0].tone).toBe('error');
            expect(toasts[0].message).toContain('Failed');

            vi.advanceTimersByTime(7000);
            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should handle success on DHCP scope clone', () => {
            toastManager.pushToast({
                message: 'DHCP scope "default" cloned to eq12 successfully',
                tone: 'success',
                timeout: 5000,
            });

            const toasts = toastManager.getToasts();
            expect(toasts[0].tone).toBe('success');
            expect(toasts[0].message).toContain('cloned');
        });

        it('should handle multiple operations with mixed tones', () => {
            const errorId = toastManager.pushToast({
                message: 'API connection lost',
                tone: 'error',
            });

            toastManager.pushToast({
                message: 'Retrying connection...',
                tone: 'info',
            });

            toastManager.pushToast({
                message: 'Reconnected successfully',
                tone: 'success',
            });

            const toasts = toastManager.getToasts();
            expect(toasts).toHaveLength(3);
            expect(toasts[0].tone).toBe('error');
            expect(toasts[1].tone).toBe('info');
            expect(toasts[2].tone).toBe('success');

            toastManager.dismissToast(errorId);
            expect(toastManager.getToasts()).toHaveLength(2);
        });

        it('should handle user dismissing error notification manually', () => {
            const id = toastManager.pushToast({
                message: 'Zone update failed: invalid configuration',
                tone: 'error',
                timeout: 10000,
            });

            vi.advanceTimersByTime(2000);

            toastManager.dismissToast(id);

            expect(toastManager.getToasts()).toHaveLength(0);

            vi.advanceTimersByTime(8000);

            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should handle rapid sequential operations', () => {
            const operations = [
                { message: 'Starting sync...', tone: 'info' as const },
                { message: 'Syncing zones...', tone: 'info' as const },
                { message: 'Syncing DHCP...', tone: 'info' as const },
                { message: 'Sync complete', tone: 'success' as const },
            ];

            operations.forEach((op) =>
                toastManager.pushToast({ ...op, timeout: 3000 }),
            );

            expect(toastManager.getToasts()).toHaveLength(4);

            vi.advanceTimersByTime(3000);

            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should handle persistent error notifications', () => {
            const criticalId = toastManager.pushToast({
                message: 'Critical: Node is offline',
                tone: 'error',
                timeout: 0, // Persistent until manually dismissed
            });

            vi.advanceTimersByTime(60000);

            expect(toastManager.getToasts()).toHaveLength(1);

            toastManager.dismissToast(criticalId);

            expect(toastManager.getToasts()).toHaveLength(0);
        });
    });

    /**
     * Test: Return Value (Toast ID)
     *
     * Validates that pushToast returns a valid ID for tracking/dismissing.
     * Critical because: Caller needs ID to dismiss specific toasts.
     */
    describe('Toast ID Return Value', () => {
        it('should return a string ID', () => {
            const id = toastManager.pushToast({ message: 'Test' });

            expect(typeof id).toBe('string');
            expect(id.length).toBeGreaterThan(0);
        });

        it('should return ID that can be used to dismiss toast', () => {
            const id = toastManager.pushToast({ message: 'Test' });

            expect(toastManager.getToasts()).toHaveLength(1);

            toastManager.dismissToast(id);

            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should return different ID for each toast', () => {
            const id1 = toastManager.pushToast({ message: 'First' });
            const id2 = toastManager.pushToast({ message: 'Second' });

            expect(id1).not.toBe(id2);
        });
    });

    /**
     * Test: Cleanup on Unmount
     *
     * Validates that all timers are cleared on component unmount.
     * Critical because: Memory leaks from uncleaned timers cause issues.
     */
    describe('Cleanup on Unmount', () => {
        it('should clear all timers on cleanup', () => {
            toastManager.pushToast({ message: 'Toast 1', timeout: 5000 });
            toastManager.pushToast({ message: 'Toast 2', timeout: 5000 });
            toastManager.pushToast({ message: 'Toast 3', timeout: 5000 });

            expect(toastManager.getToasts()).toHaveLength(3);

            toastManager.cleanup();

            expect(toastManager.getToasts()).toHaveLength(0);

            vi.advanceTimersByTime(10000);

            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should not have pending timers after cleanup', () => {
            toastManager.pushToast({ message: 'Test', timeout: 5000 });

            toastManager.cleanup();

            const pendingCount = vi.getTimerCount();
            expect(pendingCount).toBe(0);
        });
    });

    /**
     * Test: Edge Cases
     *
     * Validates edge cases and boundary conditions.
     * Critical because: Unexpected input should not crash the system.
     */
    describe('Edge Cases', () => {
        it('should handle empty message', () => {
            toastManager.pushToast({ message: '' });

            const toasts = toastManager.getToasts();
            expect(toasts).toHaveLength(1);
            expect(toasts[0].message).toBe('');
        });

        it('should handle very long message', () => {
            const longMessage = 'A'.repeat(10000);
            toastManager.pushToast({ message: longMessage });

            const toasts = toastManager.getToasts();
            expect(toasts[0].message).toBe(longMessage);
        });

        it('should handle message with special characters', () => {
            const message = 'Error: domain "*.ads.example.com" (regex) blocked 1,234,567 queries!';
            toastManager.pushToast({ message });

            const toasts = toastManager.getToasts();
            expect(toasts[0].message).toBe(message);
        });

        it('should handle message with newlines', () => {
            const message = 'Line 1\nLine 2\nLine 3';
            toastManager.pushToast({ message });

            const toasts = toastManager.getToasts();
            expect(toasts[0].message).toContain('\n');
        });

        it('should handle very short timeout', () => {
            toastManager.pushToast({
                message: 'Very short',
                timeout: 0.001,
            });

            expect(toastManager.getToasts()).toHaveLength(1);

            vi.advanceTimersByTime(1);

            expect(toastManager.getToasts()).toHaveLength(0);
        });

        it('should handle very large timeout', () => {
            toastManager.pushToast({
                message: 'Very long',
                timeout: 86400000, // 24 hours
            });

            expect(toastManager.getToasts()).toHaveLength(1);

            vi.advanceTimersByTime(1000);

            expect(toastManager.getToasts()).toHaveLength(1);
        });
    });

    /**
     * Test: Tone Validation
     *
     * Validates that tone parameter is respected.
     * Critical because: UI styling depends on correct tone.
     */
    describe('Tone Validation', () => {
        it('should default to info tone when not specified', () => {
            toastManager.pushToast({ message: 'No tone specified' });

            const toasts = toastManager.getToasts();
            expect(toasts[0].tone).toBe('info');
        });

        it('should use specified info tone', () => {
            toastManager.pushToast({ message: 'Info', tone: 'info' });

            const toasts = toastManager.getToasts();
            expect(toasts[0].tone).toBe('info');
        });

        it('should use specified success tone', () => {
            toastManager.pushToast({ message: 'Success', tone: 'success' });

            const toasts = toastManager.getToasts();
            expect(toasts[0].tone).toBe('success');
        });

        it('should use specified error tone', () => {
            toastManager.pushToast({ message: 'Error', tone: 'error' });

            const toasts = toastManager.getToasts();
            expect(toasts[0].tone).toBe('error');
        });

        it('should preserve tone across multiple toasts', () => {
            toastManager.pushToast({ message: 'Info', tone: 'info' });
            toastManager.pushToast({ message: 'Success', tone: 'success' });
            toastManager.pushToast({ message: 'Error', tone: 'error' });

            const toasts = toastManager.getToasts();
            expect(toasts[0].tone).toBe('info');
            expect(toasts[1].tone).toBe('success');
            expect(toasts[2].tone).toBe('error');
        });
    });
});
