import './PullToRefreshIndicator.css';

interface PullToRefreshIndicatorProps {
    pullDistance: number;
    threshold: number;
    isRefreshing: boolean;
}

/**
 * Visual indicator for pull-to-refresh functionality
 * Shows a spinner or arrow based on pull state
 */
export function PullToRefreshIndicator({
    pullDistance,
    threshold,
    isRefreshing,
}: PullToRefreshIndicatorProps) {
    const progress = Math.min(pullDistance / threshold, 1);
    const shouldShowIndicator = pullDistance > 0 || isRefreshing;

    if (!shouldShowIndicator) return null;

    return (
        <div
            className="pull-to-refresh-indicator"
            style={{
                transform: `translateX(-50%) translateY(${Math.min(pullDistance, threshold)}px)`,
                opacity: isRefreshing ? 1 : progress,
            }}
        >
            <div
                className={`pull-to-refresh-indicator__spinner ${isRefreshing ? 'pull-to-refresh-indicator__spinner--active' : ''
                    }`}
                style={{
                    transform: isRefreshing ? 'rotate(0deg)' : `rotate(${progress * 360}deg)`,
                }}
            >
                {isRefreshing ? (
                    <div className="pull-to-refresh-indicator__loader" />
                ) : (
                    <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                )}
            </div>
            <div className="pull-to-refresh-indicator__text">
                {isRefreshing ? 'Refreshing...' : progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
            </div>
        </div>
    );
}
