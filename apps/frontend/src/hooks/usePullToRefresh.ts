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

    useEffect(() => {
        if (disabled) return;

        const container = containerRef.current;
        if (!container) return;

        let rafId: number | null = null;

        const isAtTop = () => {
            // Check if we're at the top, with a small tolerance for edge cases
            return container.scrollTop <= 1;
        };

        const handleTouchStart = (e: TouchEvent) => {
            // Only start if we're at the top of the scroll container
            if (isAtTop() && !isRefreshing) {
                startY.current = e.touches[0].clientY;
                currentY.current = startY.current;
                setIsPulling(true);
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (!isPulling || isRefreshing) return;

            currentY.current = e.touches[0].clientY;
            const distance = currentY.current - startY.current;

            // Only allow pulling down when at the top
            if (distance > 0 && isAtTop()) {
                // Prevent default scroll behavior when pulling
                e.preventDefault();

                // Apply resistance (diminishing returns as you pull further)
                const resistance = 0.5;
                const adjustedDistance = distance * resistance;

                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(() => {
                    setPullDistance(Math.min(adjustedDistance, threshold * 1.5));
                });
            } else if (distance <= 0 || !isAtTop()) {
                // If scrolling up or not at top, cancel the pull
                if (isPulling) {
                    setIsPulling(false);
                    setPullDistance(0);
                }
            }
        };

        const handleTouchEnd = async () => {
            if (!isPulling || isRefreshing) return;

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

        container.addEventListener('touchstart', handleTouchStart, { passive: true });
        container.addEventListener('touchmove', handleTouchMove, { passive: false });
        container.addEventListener('touchend', handleTouchEnd);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            container.removeEventListener('touchstart', handleTouchStart);
            container.removeEventListener('touchmove', handleTouchMove);
            container.removeEventListener('touchend', handleTouchEnd);
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
