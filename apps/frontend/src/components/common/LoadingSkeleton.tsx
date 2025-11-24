/**
 * LoadingSkeleton Component
 *
 * Provides skeleton loading states for better perceived performance
 * while content is loading. Reduces CLS (Cumulative Layout Shift).
 */

interface SkeletonProps {
    className?: string;
}

/**
 * Generic skeleton box
 */
export const Skeleton = ({ className = '' }: SkeletonProps) => (
    <div
        className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className}`}
        aria-hidden="true"
    />
);

/**
 * Skeleton for table rows (used in LogsPage, ZonesPage, etc.)
 */
export const SkeletonTable = ({ rows = 10, columns = 5 }: { rows?: number; columns?: number }) => (
    <div className="w-full space-y-2" aria-busy="true" aria-label="Loading content">
        {/* Table header */}
        <div className="flex gap-4 pb-2 border-b border-gray-300 dark:border-gray-600">
            {Array.from({ length: columns }).map((_, i) => (
                <Skeleton key={`header-${i}`} className="h-4 flex-1" />
            ))}
        </div>

        {/* Table rows */}
        {Array.from({ length: rows }).map((_, rowIndex) => (
            <div key={`row-${rowIndex}`} className="flex gap-4 py-2">
                {Array.from({ length: columns }).map((_, colIndex) => (
                    <Skeleton
                        key={`cell-${rowIndex}-${colIndex}`}
                        className={`h-4 ${colIndex === 0 ? 'flex-1' : 'w-24'}`}
                    />
                ))}
            </div>
        ))}
    </div>
);

/**
 * Skeleton for cards (used in OverviewPage, ConfigurationPage)
 */
export const SkeletonCard = () => (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <Skeleton className="h-6 w-1/3 mb-4" />
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-5/6 mb-2" />
        <Skeleton className="h-4 w-4/6" />
    </div>
);

/**
 * Skeleton for stats cards (used in OverviewPage)
 */
export const SkeletonStatCard = () => (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-8 rounded-full" />
        </div>
        <Skeleton className="h-8 w-24 mb-1" />
        <Skeleton className="h-3 w-32" />
    </div>
);

/**
 * Skeleton for form fields (used in ConfigurationPage)
 */
export const SkeletonForm = ({ fields = 5 }: { fields?: number }) => (
    <div className="space-y-4">
        {Array.from({ length: fields }).map((_, i) => (
            <div key={`field-${i}`}>
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-10 w-full" />
            </div>
        ))}
    </div>
);

/**
 * Skeleton for DNS query logs specifically
 * Matches the card layout structure to prevent layout shifts
 */
export const SkeletonLogEntries = ({ entries = 20 }: { entries?: number }) => (
    <div className="flex flex-col gap-4 px-3 py-3" aria-busy="true" aria-label="Loading query logs">
        {/* Skeleton cards matching actual log card structure */}
        {Array.from({ length: entries }).map((_, i) => (
            <div
                key={`log-${i}`}
                className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700"
                style={{ minHeight: '180px' }} // Match actual card height to prevent shift
            >
                {/* Card header: checkbox + domain + status badge */}
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4 rounded" /> {/* Checkbox */}
                        <Skeleton className="h-5 w-48" /> {/* Domain */}
                    </div>
                    <Skeleton className="h-7 w-7 rounded" /> {/* Status button */}
                </div>

                {/* Card body: info rows */}
                <div className="space-y-2">
                    {/* Client row */}
                    <div className="flex justify-between text-sm">
                        <Skeleton className="h-3 w-12" /> {/* Label */}
                        <Skeleton className="h-3 w-32" /> {/* Value */}
                    </div>
                    {/* Type row */}
                    <div className="flex justify-between text-sm">
                        <Skeleton className="h-3 w-10" />
                        <Skeleton className="h-3 w-16" />
                    </div>
                    {/* Time row */}
                    <div className="flex justify-between text-sm">
                        <Skeleton className="h-3 w-10" />
                        <Skeleton className="h-3 w-40" />
                    </div>
                    {/* Response time row (conditional) */}
                    <div className="flex justify-between text-sm">
                        <Skeleton className="h-3 w-24" />
                        <Skeleton className="h-3 w-16" />
                    </div>
                </div>
            </div>
        ))}
    </div>
);

/**
 * Skeleton for zone list
 */
export const SkeletonZoneList = ({ zones = 15 }: { zones?: number }) => (
    <div className="space-y-2" aria-busy="true" aria-label="Loading zones">
        {Array.from({ length: zones }).map((_, i) => (
            <div
                key={`zone-${i}`}
                className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
            >
                <div className="flex-1">
                    <Skeleton className="h-5 w-48 mb-2" />
                    <Skeleton className="h-3 w-32" />
                </div>
                <div className="flex gap-2">
                    <Skeleton className="h-6 w-16 rounded-full" />
                    <Skeleton className="h-8 w-8 rounded" />
                </div>
            </div>
        ))}
    </div>
);

/**
 * Skeleton for DHCP scopes
 */
export const SkeletonDhcpScopes = ({ scopes = 8 }: { scopes?: number }) => (
    <div className="space-y-3" aria-busy="true" aria-label="Loading DHCP scopes">
        {Array.from({ length: scopes }).map((_, i) => (
            <div
                key={`scope-${i}`}
                className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
            >
                <div className="flex items-center justify-between mb-3">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <Skeleton className="h-3 w-16 mb-1" />
                        <Skeleton className="h-4 w-28" />
                    </div>
                    <div>
                        <Skeleton className="h-3 w-16 mb-1" />
                        <Skeleton className="h-4 w-28" />
                    </div>
                </div>
            </div>
        ))}
    </div>
);

/**
 * Skeleton for LogsPage statistics bar (collapsed state)
 * This prevents layout shift when stats load
 */
export const SkeletonLogsStats = () => (
    <div
        className="logs-page__statistics collapsed"
        style={{ minHeight: '60px' }}
        aria-busy="true"
        aria-label="Loading statistics"
    >
        <div className="logs-page__statistics-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '16px' }}>
                <Skeleton className="h-4 w-3" /> {/* Toggle icon */}
                <Skeleton className="h-4 w-64" /> {/* Summary text */}
            </div>
        </div>
    </div>
);

/**
 * Skeleton for LogsPage summary bar
 * This prevents layout shift when summary loads
 */
export const SkeletonLogsSummary = () => (
    <div
        className="logs-page__summary"
        style={{ minHeight: '48px', display: 'flex', gap: '16px', padding: '12px 16px' }}
        aria-busy="true"
        aria-label="Loading summary"
    >
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-40" />
    </div>
);
