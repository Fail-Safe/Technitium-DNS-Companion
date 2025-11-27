import { useEffect, useRef, useState } from 'react';

interface UsePullToRefreshOptions {
    onRefresh: () => Promise<void> | void;
    threshold?: number; // Distance in pixels to trigger refresh
    disabled?: boolean;
}

/**
 * Custom hook for implementing pull-to-refresh functionality on mobile devices
 *
 * @param options Configuration options for pull-to-refresh
 * @returns Ref to attach to the scrollable container
 *
 * @example
 * const containerRef = usePullToRefresh({
 *   onRefresh: async () => {
 *     await fetchData();
 *   },
 * });
 *
 * return <div ref={containerRef}>Content</div>
 */
export function usePullToRefresh({
    onRefresh,
    threshold = 80,
    disabled = false,
}: UsePullToRefreshOptions) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPulling, setIsPulling] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pullDistance, setPullDistance] = useState(0);

    const startY = useRef(0);
    const currentY = useRef(0);
    const touchStartedAtTop = useRef(false);

    useEffect(() => {
        if (disabled) return;

        const container = containerRef.current;
        if (!container) return;

        let rafId: number | null = null;

        const isAtTop = () => {
            // Check BOTH window scroll and any scrollable parent
            // The page scrolls on window, not on the container element
            const windowAtTop = window.scrollY <= 1;

            // Also check if there's a scrollable parent (like main or app-content)
            let parent = container.parentElement;
            while (parent && parent !== document.body) {
                if (parent.scrollTop > 1) {
                    return false; // A parent is scrolled down
                }
                parent = parent.parentElement;
            }

            return windowAtTop;
        };

        const handleTouchStart = (e: TouchEvent) => {
            // Record starting position and whether we're at top
            // Don't set isPulling yet - wait to see the direction
            startY.current = e.touches[0].clientY;
            currentY.current = startY.current;
            touchStartedAtTop.current = isAtTop() && !isRefreshing;
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (isRefreshing) return;

            // Must have started touch while at top
            if (!touchStartedAtTop.current) return;

            currentY.current = e.touches[0].clientY;
            const distance = currentY.current - startY.current;

            // Re-check if we're still at top (user might have scrolled)
            const stillAtTop = isAtTop();

            // Only activate pull-to-refresh if:
            // 1. We're pulling DOWN (distance > 0)
            // 2. We're still at the top
            // 3. The pull distance is meaningful (> 10px to avoid accidental triggers)
            if (distance > 10 && stillAtTop) {
                // Now we know user is intentionally pulling down at the top
                if (!isPulling) {
                    setIsPulling(true);
                }

                // Prevent default scroll behavior when pulling
                e.preventDefault();

                // Apply resistance (diminishing returns as you pull further)
                const resistance = 0.5;
                const adjustedDistance = distance * resistance;

                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    setPullDistance(Math.min(adjustedDistance, threshold * 1.5));
                });
            } else if (distance <= 0 || !stillAtTop) {
                // User is scrolling UP or page has scrolled - cancel pull
                if (isPulling) {
                    setIsPulling(false);
                    setPullDistance(0);
                }
                // Allow normal scrolling - don't prevent default
                touchStartedAtTop.current = false;
            }
        };

        const handleTouchEnd = async () => {
            // Reset touch tracking
            touchStartedAtTop.current = false;

            if (!isPulling || isRefreshing) {
                setIsPulling(false);
                setPullDistance(0);
                return;
            }

            setIsPulling(false);

            if (pullDistance >= threshold) {
                setIsRefreshing(true);
                setPullDistance(threshold); // Lock at threshold during refresh

                try {
                    await onRefresh();
                } catch (error) {
                    console.error('Refresh failed:', error);
                } finally {
                    setIsRefreshing(false);
                    setPullDistance(0);
                }
            } else {
                // Snap back if not pulled far enough
                setPullDistance(0);
            }
        };

        // Listen on document to catch all touch events, not just on container
        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: false });
        document.addEventListener('touchend', handleTouchEnd);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            document.removeEventListener('touchstart', handleTouchStart);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };
    }, [disabled, isPulling, isRefreshing, pullDistance, threshold, onRefresh]);

    return {
        containerRef,
        isPulling,
        isRefreshing,
        pullDistance,
        threshold,
    };
}
