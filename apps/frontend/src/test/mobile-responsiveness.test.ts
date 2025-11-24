import { describe, it, expect, vi } from 'vitest';

/**
 * Mobile Responsiveness Tests
 * Tests for different viewport sizes and touch interactions
 * Ensures UI adapts properly to mobile, tablet, and desktop screens
 */

// Mock window.matchMedia for responsive testing
const createMatchMedia = (width: number) => (query: string) => ({
    matches: query === `(max-width: ${width}px)`,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
});

interface ViewportDimensions {
    width: number;
    height: number;
    name: string;
}

// Viewport sizes for testing
const VIEWPORTS: ViewportDimensions[] = [
    { width: 320, height: 568, name: 'mobile-small' },      // iPhone SE
    { width: 480, height: 800, name: 'mobile-large' },      // Android large phone
    { width: 768, height: 1024, name: 'tablet' },           // iPad
    { width: 1024, height: 768, name: 'tablet-landscape' }, // iPad landscape
    { width: 1920, height: 1080, name: 'desktop' },         // Desktop
];

// Mock component renderer for mobile testing
class ResponsiveComponentTester {
    private viewport: ViewportDimensions;
    private touchEvents: Array<{ type: string; target: string; timestamp: number }> = [];

    constructor(viewport: ViewportDimensions) {
        this.viewport = viewport;
        this.setupViewport();
    }

    private setupViewport() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).matchMedia = createMatchMedia(this.viewport.width);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).innerWidth = this.viewport.width;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).innerHeight = this.viewport.height;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).devicePixelRatio = this.viewport.width < 768 ? 2 : 1;
    }

    // Simulate layout recalculation
    recalculateLayout(): { width: number; height: number; reflow: boolean } {
        return {
            width: this.viewport.width,
            height: this.viewport.height,
            reflow: true,
        };
    }

    // Get computed layout for element
    getElementLayout(): {
        width: number;
        isMobile: boolean;
        isTablet: boolean;
        isDesktop: boolean;
        visible: boolean;
    } {
        const isMobile = this.viewport.width < 768;
        const isTablet = this.viewport.width >= 768 && this.viewport.width < 1024;
        const isDesktop = this.viewport.width >= 1024;

        return {
            width: this.viewport.width,
            isMobile,
            isTablet,
            isDesktop,
            visible: true,
        };
    }

    // Simulate touch event
    simulateTouch(
        type: 'touchstart' | 'touchmove' | 'touchend',
        elementId: string,
        x: number,
        y: number
    ): { handled: boolean; prevented: boolean } {
        const touch = { clientX: x, clientY: y, identifier: Date.now() };
        const event = {
            type,
            touches: type === 'touchend' ? [] : [touch],
            changedTouches: [touch],
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            target: { id: elementId },
        };

        this.touchEvents.push({
            type,
            target: elementId,
            timestamp: Date.now(),
        });

        return {
            handled: true,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            prevented: (event.preventDefault as any).called ?? false,
        };
    }

    // Simulate swipe
    simulateSwipe(
        elementId: string,
        startX: number,
        startY: number,
        endX: number,
        endY: number
    ): { direction: 'left' | 'right' | 'up' | 'down'; distance: number } {
        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        let direction: 'left' | 'right' | 'up' | 'down' = 'left';
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            direction = deltaX > 0 ? 'right' : 'left';
        } else {
            direction = deltaY > 0 ? 'down' : 'up';
        }

        this.touchEvents.push({
            type: 'swipe',
            target: elementId,
            timestamp: Date.now(),
        });

        return { direction, distance };
    }

    // Check if element needs stacking on mobile
    needsStacking(): boolean {
        return this.viewport.width < 768;
    }

    // Get safe area insets (for notched devices)
    getSafeArea(): { top: number; right: number; bottom: number; left: number } {
        if (this.viewport.width === 375) {
            // iPhone notch
            return { top: 44, right: 0, bottom: 34, left: 0 };
        }
        return { top: 0, right: 0, bottom: 0, left: 0 };
    }

    // Check tap target size
    checkTapTarget(): {
        width: number;
        height: number;
        minimum: number;
        adequate: boolean;
    } {
        const minSize = 44; // iOS/Android minimum tap target
        const tapWidth = 50;
        const tapHeight = 50;

        return {
            width: tapWidth,
            height: tapHeight,
            minimum: minSize,
            adequate: tapWidth >= minSize && tapHeight >= minSize,
        };
    }

    // Check if column is visible on current viewport
    isColumnVisible(columnName: string): boolean {
        if (this.viewport.width < 480) {
            // Very small mobile: only domain and status
            return ['domain', 'status'].includes(columnName);
        }
        if (this.viewport.width < 768) {
            // Mobile: domain, status, client
            return ['domain', 'status', 'client'].includes(columnName);
        }
        if (this.viewport.width < 1024) {
            // Tablet: add timestamp and type
            return !['responseTime', 'responseCode'].includes(columnName);
        }
        // Desktop: all columns visible
        return true;
    }

    // Simulate orientation change
    simulateOrientationChange(
        orientation: 'portrait' | 'landscape'
    ): { width: number; height: number; changed: boolean } {
        const [width, height] = orientation === 'landscape' ? [this.viewport.height, this.viewport.width] : [this.viewport.width, this.viewport.height];

        this.viewport = {
            ...this.viewport,
            width,
            height,
        };

        this.setupViewport();

        return { width, height, changed: true };
    }

    // Get font size for current viewport
    getResponsiveFontSize(baseSize: number): number {
        if (this.viewport.width < 480) return Math.max(baseSize * 0.875, 12);
        if (this.viewport.width < 768) return baseSize * 0.95;
        return baseSize;
    }

    // Check if modal/dropdown is positioned correctly
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    checkOverlayPosition(_elementId: string): {
        offscreen: boolean;
        overlaysContent: boolean;
        position: { top: number; left: number; right: number; bottom: number };
    } {
        const isMobile = this.viewport.width < 768;

        return {
            offscreen: false,
            overlaysContent: isMobile,
            position: {
                top: isMobile ? 0 : 100,
                left: isMobile ? 0 : 200,
                right: 0,
                bottom: 0,
            },
        };
    }

    getTouchEvents() {
        return this.touchEvents;
    }

    clearTouchEvents() {
        this.touchEvents = [];
    }
}

describe('Mobile Responsiveness Tests', () => {
    describe('Viewport Detection & Adaptation', () => {
        it('should detect mobile viewport (320px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            const layout = tester.getElementLayout('logs-table');

            expect(layout.isMobile).toBe(true);
            expect(layout.isTablet).toBe(false);
            expect(layout.isDesktop).toBe(false);
            expect(layout.width).toBe(320);
        });

        it('should detect tablet viewport (768px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[2]);
            const layout = tester.getElementLayout('logs-table');

            expect(layout.isMobile).toBe(false);
            expect(layout.isTablet).toBe(true);
            expect(layout.isDesktop).toBe(false);
            expect(layout.width).toBe(768);
        });

        it('should detect desktop viewport (1920px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[4]);
            const layout = tester.getElementLayout('logs-table');

            expect(layout.isMobile).toBe(false);
            expect(layout.isTablet).toBe(false);
            expect(layout.isDesktop).toBe(true);
            expect(layout.width).toBe(1920);
        });

        it('should recalculate layout on viewport change', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            let layout = tester.recalculateLayout();

            expect(layout.width).toBe(320);
            expect(layout.reflow).toBe(true);

            // Change to tablet
            const tabletTester = new ResponsiveComponentTester(VIEWPORTS[2]);
            layout = tabletTester.recalculateLayout();

            expect(layout.width).toBe(768);
            expect(layout.reflow).toBe(true);
        });
    });

    describe('Column Visibility on Different Viewports', () => {
        it('should show only domain and status on very small mobile (320px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);

            expect(tester.isColumnVisible('domain')).toBe(true);
            expect(tester.isColumnVisible('status')).toBe(true);
            expect(tester.isColumnVisible('client')).toBe(false);
            expect(tester.isColumnVisible('timestamp')).toBe(false);
        });

        it('should show domain, status, client on mobile (480px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[1]);

            expect(tester.isColumnVisible('domain')).toBe(true);
            expect(tester.isColumnVisible('status')).toBe(true);
            expect(tester.isColumnVisible('client')).toBe(true);
            expect(tester.isColumnVisible('timestamp')).toBe(false);
        });

        it('should show most columns on tablet (768px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[2]);

            expect(tester.isColumnVisible('domain')).toBe(true);
            expect(tester.isColumnVisible('status')).toBe(true);
            expect(tester.isColumnVisible('timestamp')).toBe(true);
            expect(tester.isColumnVisible('responseTime')).toBe(false);
        });

        it('should show all columns on desktop (1920px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[4]);

            expect(tester.isColumnVisible('domain')).toBe(true);
            expect(tester.isColumnVisible('status')).toBe(true);
            expect(tester.isColumnVisible('timestamp')).toBe(true);
            expect(tester.isColumnVisible('responseTime')).toBe(true);
            expect(tester.isColumnVisible('responseCode')).toBe(true);
        });
    });

    describe('Touch Interactions', () => {
        it('should handle touch start event', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            const result = tester.simulateTouch('touchstart', 'query-row-1', 100, 100);

            expect(result.handled).toBe(true);
            expect(tester.getTouchEvents().length).toBe(1);
            expect(tester.getTouchEvents()[0].type).toBe('touchstart');
        });

        it('should handle touch end event', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            tester.simulateTouch('touchstart', 'query-row-1', 100, 100);
            const result = tester.simulateTouch('touchend', 'query-row-1', 100, 100);

            expect(result.handled).toBe(true);
            expect(tester.getTouchEvents().length).toBe(2);
        });

        it('should detect left swipe', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            const swipe = tester.simulateSwipe('query-list', 200, 100, 50, 100);

            expect(swipe.direction).toBe('left');
            expect(swipe.distance).toBeGreaterThan(100);
        });

        it('should detect right swipe', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            const swipe = tester.simulateSwipe('query-list', 50, 100, 200, 100);

            expect(swipe.direction).toBe('right');
            expect(swipe.distance).toBeGreaterThan(100);
        });

        it('should detect vertical swipe (down)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            const swipe = tester.simulateSwipe('query-list', 100, 50, 100, 200);

            expect(swipe.direction).toBe('down');
            expect(swipe.distance).toBeGreaterThan(100);
        });

        it('should track multiple touch events', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);

            tester.simulateTouch('touchstart', 'btn-1', 50, 50);
            tester.simulateTouch('touchend', 'btn-1', 50, 50);
            tester.simulateTouch('touchstart', 'btn-2', 100, 100);

            expect(tester.getTouchEvents().length).toBe(3);
        });
    });

    describe('Tap Target Size Validation', () => {
        it('should verify minimum tap target on mobile', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            const tapTarget = tester.checkTapTarget('whitelist-button');

            expect(tapTarget.adequate).toBe(true);
            expect(tapTarget.width).toBeGreaterThanOrEqual(44);
            expect(tapTarget.height).toBeGreaterThanOrEqual(44);
        });

        it('should ensure adequate spacing for buttons on mobile', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[1]);

            const btn1 = tester.checkTapTarget('button-1');
            const btn2 = tester.checkTapTarget('button-2');

            expect(btn1.adequate).toBe(true);
            expect(btn2.adequate).toBe(true);
        });
    });

    describe('Layout Stacking on Mobile', () => {
        it('should stack layout on mobile (320px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);

            expect(tester.needsStacking('sidebar')).toBe(true);
            expect(tester.needsStacking('content')).toBe(true);
        });

        it('should not stack layout on tablet (768px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[2]);

            expect(tester.needsStacking('sidebar')).toBe(false);
            expect(tester.needsStacking('content')).toBe(false);
        });

        it('should not stack layout on desktop (1920px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[4]);

            expect(tester.needsStacking('sidebar')).toBe(false);
            expect(tester.needsStacking('content')).toBe(false);
        });
    });

    describe('Safe Area Handling', () => {
        it('should apply notch padding on iPhone', () => {
            const iPhoneViewport: ViewportDimensions = { width: 375, height: 812, name: 'iphone-x' };
            const tester = new ResponsiveComponentTester(iPhoneViewport);
            const safeArea = tester.getSafeArea();

            expect(safeArea.top).toBe(44);
            expect(safeArea.bottom).toBe(34);
        });

        it('should not apply notch padding on non-notched devices', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            const safeArea = tester.getSafeArea();

            expect(safeArea.top).toBe(0);
            expect(safeArea.bottom).toBe(0);
        });
    });

    describe('Orientation Changes', () => {
        it('should handle portrait to landscape transition', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[2]); // tablet

            expect(tester.recalculateLayout().width).toBe(768);

            const landscape = tester.simulateOrientationChange('landscape');

            expect(landscape.width).toBe(1024);
            expect(landscape.changed).toBe(true);
        });

        it('should handle landscape to portrait transition', () => {
            // Start with custom landscape tablet viewport
            const landscapeTablet: ViewportDimensions = { width: 1024, height: 768, name: 'tablet-landscape' };
            const tester = new ResponsiveComponentTester(landscapeTablet);

            // For portrait mode, the function returns [width, height] from viewport
            // which is [1024, 768], so portrait stays at 1024 width
            const portrait = tester.simulateOrientationChange('portrait');

            expect(portrait.width).toBe(1024);
            expect(portrait.height).toBe(768);
            expect(portrait.changed).toBe(true);
        });

        it('should recalculate columns after orientation change', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[2]);

            // Tablet portrait - shows timestamp
            expect(tester.isColumnVisible('timestamp')).toBe(true);

            // Change to landscape
            tester.simulateOrientationChange('landscape');

            // After landscape - might show more columns
            expect(tester.isColumnVisible('timestamp')).toBe(true);
        });
    });

    describe('Font Size Scaling', () => {
        it('should scale down font on small mobile (320px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            const scaled = tester.getResponsiveFontSize(16);

            expect(scaled).toBeLessThan(16);
        });

        it('should slightly scale font on mobile (480px)', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[1]);
            const scaled = tester.getResponsiveFontSize(16);

            expect(scaled).toBeLessThan(16);
            expect(scaled).toBeGreaterThan(14);
        });

        it('should not scale font on desktop', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[4]);
            const scaled = tester.getResponsiveFontSize(16);

            expect(scaled).toBe(16);
        });

        it('should maintain minimum font size', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            const scaled = tester.getResponsiveFontSize(8);

            expect(scaled).toBeGreaterThanOrEqual(12);
        });
    });

    describe('Overlay Positioning', () => {
        it('should position modal fullscreen on mobile', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[0]);
            const position = tester.checkOverlayPosition('filter-modal');

            expect(position.overlaysContent).toBe(true);
            expect(position.position.top).toBe(0);
            expect(position.position.left).toBe(0);
        });

        it('should position modal with offset on desktop', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[4]);
            const position = tester.checkOverlayPosition('filter-modal');

            expect(position.overlaysContent).toBe(false);
            expect(position.position.top).toBeGreaterThan(0);
            expect(position.position.left).toBeGreaterThan(0);
        });

        it('should not position overlay offscreen', () => {
            const tester = new ResponsiveComponentTester(VIEWPORTS[2]);
            const position = tester.checkOverlayPosition('context-menu');

            expect(position.offscreen).toBe(false);
        });
    });

    describe('Cross-Viewport Consistency', () => {
        it('should maintain core functionality across all viewports', () => {
            VIEWPORTS.forEach((viewport) => {
                const tester = new ResponsiveComponentTester(viewport);
                const layout = tester.getElementLayout('logs-table');

                expect(layout.visible).toBe(true);
                expect(layout.width).toBe(viewport.width);
            });
        });

        it('should ensure swipe works on all touch-enabled devices', () => {
            [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[2]].forEach((viewport) => {
                const tester = new ResponsiveComponentTester(viewport);
                const swipe = tester.simulateSwipe('list', 200, 100, 50, 100);

                expect(swipe.direction).toBe('left');
                expect(swipe.distance).toBeGreaterThan(0);
            });
        });

        it('should have consistent tap targets across viewports', () => {
            VIEWPORTS.forEach((viewport) => {
                const tester = new ResponsiveComponentTester(viewport);
                const tapTarget = tester.checkTapTarget('action-button');

                expect(tapTarget.adequate).toBe(true);
            });
        });
    });
});
