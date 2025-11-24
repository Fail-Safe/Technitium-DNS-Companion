import { useCallback, useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faRotate, faHourglassHalf } from '@fortawesome/free-solid-svg-icons';
import { useTechnitiumState } from '../context/TechnitiumContext';
import { useToast } from '../context/ToastContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '../components/common/PullToRefreshIndicator';
import { ZonesPageSkeleton } from '../components/zones/ZonesPageSkeleton';
import './ZonesPage.css';
import type {
    TechnitiumCombinedZoneOverview,
    TechnitiumZoneComparison,
    TechnitiumZoneNodeState,
    TechnitiumZoneStatus,
} from '../types/zones';

type LoadState = 'idle' | 'loading' | 'refreshing' | 'error';
type ZoneFilter = 'all' | TechnitiumZoneStatus;

type ZoneSummary = {
    total: number;
    inSync: number;
    different: number;
    missing: number;
    unknown: number;
};

const STATUS_LABELS: Record<TechnitiumZoneStatus, string> = {
    'in-sync': 'In Sync',
    different: 'Different',
    missing: 'Missing',
    unknown: 'Unknown',
};

const STATUS_BADGE_CLASS: Record<TechnitiumZoneStatus, string> = {
    'in-sync': 'badge badge--success',
    different: 'badge badge--error',
    missing: 'badge badge--warning',
    unknown: 'badge badge--muted',
};

const FILTER_OPTIONS: Array<{ key: ZoneFilter; label: string }> = [
    { key: 'different', label: 'Differences' },
    { key: 'missing', label: 'Missing' },
    { key: 'unknown', label: 'Unknown' },
    { key: 'in-sync', label: 'In Sync' },
    { key: 'all', label: 'All Zones' },
];

const formatTimestamp = (value?: string) => {
    if (!value) {
        return '—';
    }

    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        return value;
    }

    return new Date(parsed).toLocaleString();
};

const describeBoolean = (value?: boolean) => {
    if (value === undefined) {
        return undefined;
    }

    return value ? 'Yes' : 'No';
};

const collectDetails = (node: TechnitiumZoneNodeState) => {
    if (!node.zone) {
        return [] as Array<{ label: string; value: string }>;
    }

    const details: Array<{ label: string; value: string }> = [];
    const { zone } = node;

    if (zone.type) {
        details.push({ label: 'Type', value: zone.type });
    }

    if (zone.primaryNameServerAddresses && zone.primaryNameServerAddresses.length > 0) {
        details.push({
            label: 'Primary Name Server',
            value: zone.primaryNameServerAddresses.join(', '),
        });
    }

    if (zone.dnssecStatus) {
        details.push({ label: 'DNSSEC', value: zone.dnssecStatus });
    }

    if (zone.soaSerial !== undefined) {
        details.push({ label: 'SOA Serial', value: zone.soaSerial.toString() });
    }

    if (zone.lastModified) {
        details.push({ label: 'Last Modified', value: formatTimestamp(zone.lastModified) });
    }

    const disabled = describeBoolean(zone.disabled);
    if (disabled) {
        details.push({ label: 'Disabled', value: disabled });
    }

    const syncFailed = describeBoolean(zone.syncFailed);
    if (syncFailed) {
        details.push({ label: 'Sync Failed', value: syncFailed });
    }

    const notifyFailed = describeBoolean(zone.notifyFailed);
    if (notifyFailed) {
        details.push({ label: 'Notify Failed', value: notifyFailed });
    }

    if (zone.expiry) {
        details.push({ label: 'Expiry', value: formatTimestamp(zone.expiry) });
    }

    const expired = describeBoolean(zone.isExpired);
    if (expired) {
        details.push({ label: 'Expired', value: expired });
    }

    if (zone.notifyFailedFor && zone.notifyFailedFor.length > 0) {
        details.push({
            label: 'Notify Targets',
            value: zone.notifyFailedFor.join(', '),
        });
    }

    if (zone.queryAccess) {
        details.push({ label: 'Query Access', value: zone.queryAccess });
    }

    if (zone.queryAccessNetworkACL && zone.queryAccessNetworkACL.length > 0) {
        details.push({
            label: 'Query Access ACL',
            value: zone.queryAccessNetworkACL.join(', '),
        });
    }

    if (zone.zoneTransfer) {
        details.push({ label: 'Zone Transfer', value: zone.zoneTransfer });
    }

    if (zone.notify) {
        details.push({ label: 'Notify', value: zone.notify });
    }

    if (zone.notifyNameServers && zone.notifyNameServers.length > 0) {
        details.push({
            label: 'Notify Servers',
            value: zone.notifyNameServers.join(', '),
        });
    }

    if (zone.zoneTransferNetworkACL && zone.zoneTransferNetworkACL.length > 0) {
        details.push({
            label: 'Zone Transfer ACL',
            value: zone.zoneTransferNetworkACL.join(', '),
        });
    }

    if (zone.zoneTransferTsigKeyNames && zone.zoneTransferTsigKeyNames.length > 0) {
        details.push({
            label: 'Zone Transfer TSIG Keys',
            value: zone.zoneTransferTsigKeyNames.join(', '),
        });
    }

    return details;
};

export function ZonesPage() {
    const { loadCombinedZones } = useTechnitiumState();
    const { pushToast } = useToast();
    const [overview, setOverview] = useState<TechnitiumCombinedZoneOverview | undefined>();
    const [loadState, setLoadState] = useState<LoadState>('idle');
    const [errorMessage, setErrorMessage] = useState<string | undefined>();
    const [filter, setFilter] = useState<ZoneFilter>('different');

    const fetchOverview = useCallback(
        async (mode: 'initial' | 'refresh') => {
            setLoadState(mode === 'refresh' ? 'refreshing' : 'loading');
            setErrorMessage(undefined);

            try {
                const data = await loadCombinedZones();
                setOverview(data);

                if (mode === 'initial' && data.zones.every((zone) => zone.status === 'in-sync')) {
                    setFilter('all');
                }

                setLoadState('idle');
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to load zones.';
                setErrorMessage(message);
                pushToast({ message, tone: 'error' });
                setLoadState('error');
            }
        },
        [loadCombinedZones, pushToast],
    );

    // Pull-to-refresh functionality
    const handlePullToRefresh = useCallback(async () => {
        await fetchOverview('refresh');
    }, [fetchOverview]);

    const pullToRefresh = usePullToRefresh({
        onRefresh: handlePullToRefresh,
        threshold: 80,
        disabled: false,
    });

    useEffect(() => {
        void fetchOverview('initial');
    }, [fetchOverview]);

    const summary: ZoneSummary = useMemo(() => {
        if (!overview) {
            return { total: 0, inSync: 0, different: 0, missing: 0, unknown: 0 };
        }

        const result: ZoneSummary = {
            total: overview.zoneCount,
            inSync: 0,
            different: 0,
            missing: 0,
            unknown: 0,
        };

        overview.zones.forEach((zone) => {
            switch (zone.status) {
                case 'in-sync':
                    result.inSync += 1;
                    break;
                case 'different':
                    result.different += 1;
                    break;
                case 'missing':
                    result.missing += 1;
                    break;
                case 'unknown':
                    result.unknown += 1;
                    break;
                default:
                    break;
            }
        });

        return result;
    }, [overview]);

    const filterCounts = useMemo(() => ({
        all: summary.total,
        'in-sync': summary.inSync,
        different: summary.different,
        missing: summary.missing,
        unknown: summary.unknown,
    }), [summary]);

    const filteredZones = useMemo(() => {
        if (!overview) {
            return [] as TechnitiumZoneComparison[];
        }

        if (filter === 'all') {
            return overview.zones;
        }

        return overview.zones.filter((zone) => zone.status === filter);
    }, [overview, filter]);

    const nodeCount = overview?.nodes.length ?? 0;

    const summaryCards = useMemo(
        () => [
            {
                key: 'total',
                label: 'Total Zones',
                value: summary.total,
                caption: nodeCount === 1 ? 'Modifiable across 1 node' : `Modifiable across ${nodeCount} nodes`,
            },
            {
                key: 'different',
                label: 'Differences',
                value: summary.different,
                caption: 'Need review to reconcile',
            },
            {
                key: 'missing',
                label: 'Missing',
                value: summary.missing,
                caption: 'Missing on at least one node',
            },
            {
                key: 'in-sync',
                label: 'In Sync',
                value: summary.inSync,
                caption: 'Consistent across nodes',
            },
            {
                key: 'unknown',
                label: 'Unknown',
                value: summary.unknown,
                caption: 'Unable to compare',
            },
        ],
        [summary, nodeCount],
    );

    const nodeSnapshots = overview?.nodes ?? [];
    const hasNodeSnapshots = nodeSnapshots.length > 0;

    // Show skeleton while loading initial data
    if (loadState === 'loading' && !overview) {
        return <ZonesPageSkeleton />;
    }

    return (
        <>
            <PullToRefreshIndicator
                pullDistance={pullToRefresh.pullDistance}
                threshold={pullToRefresh.threshold}
                isRefreshing={pullToRefresh.isRefreshing}
            />
            <div ref={pullToRefresh.containerRef} className="zones-page">
                <header className="zones-page__header">
                    <div className="zones-page__header-content">
                        <div className="zones-page__title-row">
                            <div className="zones-page__title-group">
                                <h1 className="zones-page__title">🌐 Authoritative Zones</h1>
                                <p className="zones-page__subtitle">
                                    {overview
                                        ? `Tracking ${summary.total} zone${summary.total === 1 ? '' : 's'} across ${nodeCount} node${nodeCount === 1 ? '' : 's'}`
                                        : 'Monitor authoritative zones across your Technitium DNS cluster.'}
                                </p>
                            </div>
                            <div className="zones-page__header-actions">
                                <button
                                    type="button"
                                    className="button primary"
                                    onClick={() => void fetchOverview('refresh')}
                                    disabled={loadState === 'loading' || loadState === 'refreshing'}
                                >
                                    {loadState === 'refreshing' ? <><FontAwesomeIcon icon={faRotate} spin /> Refreshing…</> : loadState === 'loading' ? <><FontAwesomeIcon icon={faHourglassHalf} /> Loading…</> : <><FontAwesomeIcon icon={faRotate} /> Refresh</>}
                                </button>
                            </div>
                        </div>
                        <div className="zones-page__meta-row">
                            <span className="zones-page__meta-info">
                                🧭{' '}
                                {nodeCount === 0
                                    ? 'Waiting for node data'
                                    : nodeCount === 1
                                        ? '1 node connected'
                                        : `${nodeCount} nodes connected`}
                            </span>
                            <span className="zones-page__meta-info">
                                {overview ? `Updated ${formatTimestamp(overview.fetchedAt)}` : 'Collecting zone data…'}
                            </span>
                        </div>
                        {errorMessage ? (
                            <p className="zones-page__error" role="status">
                                {errorMessage}
                            </p>
                        ) : null}
                    </div>
                </header>

                <section className="zones-page__overview">
                    <ul className="zones-page__summary-grid" role="list">
                        {summaryCards.map((card) => (
                            <li key={card.key}>
                                <button
                                    type="button"
                                    className={`zones-page__summary-card zones-page__summary-card--${card.key}${filter === card.key || (card.key === 'total' && filter === 'all')
                                        ? ' zones-page__summary-card--active'
                                        : ''
                                        }`}
                                    onClick={() => setFilter(card.key === 'total' ? 'all' : (card.key as ZoneFilter))}
                                    disabled={card.value === 0}
                                >
                                    <span className="zones-page__summary-card-label">{card.label}</span>
                                    <span className="zones-page__summary-card-value">{card.value}</span>
                                    <span className="zones-page__summary-card-caption">{card.caption}</span>
                                </button>
                            </li>
                        ))}
                    </ul>

                    <div className="zones-page__nodes-grid">
                        {hasNodeSnapshots ? (
                            nodeSnapshots.map((node) => (
                                <article
                                    key={node.nodeId}
                                    className={`zones-page__node-card${node.error ? ' zones-page__node-card--error' : ''}`}
                                >
                                    <header className="zones-page__node-card-header">
                                        <span className="zones-page__node-card-name">{node.nodeId}</span>
                                        <span
                                            className={`zones-page__node-status ${node.error
                                                ? 'zones-page__node-status--error'
                                                : 'zones-page__node-status--ok'
                                                }`}
                                        >
                                            {node.error ? 'Attention' : 'Healthy'}
                                        </span>
                                    </header>
                                    <dl className="zones-page__node-card-meta">
                                        <div>
                                            <dt>Zones (Internal)</dt>
                                            <dd>
                                                {node.totalZones !== undefined && node.modifiableZones !== undefined
                                                    ? node.totalZones - node.modifiableZones
                                                    : '—'}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt>Zones (User Defined)</dt>
                                            <dd>{node.modifiableZones ?? '—'}</dd>
                                        </div>
                                        <div>
                                            <dt>Snapshot</dt>
                                            <dd>{formatTimestamp(node.fetchedAt)}</dd>
                                        </div>
                                    </dl>
                                    {node.error ? (
                                        <p className="zones-page__node-card-error" role="status">
                                            {node.error}
                                        </p>
                                    ) : null}
                                </article>
                            ))
                        ) : (
                            <div className="zones-page__nodes-placeholder">
                                {loadState === 'loading' ? 'Collecting node snapshots…' : 'No node data available.'}
                            </div>
                        )}
                    </div>
                </section>

                <div className="zones-page__toolbar">
                    <div className="zones-page__filters">
                        {FILTER_OPTIONS.map((option) => (
                            <button
                                key={option.key}
                                type="button"
                                className={
                                    option.key === filter
                                        ? 'zones-page__filter-button zones-page__filter-button--active'
                                        : 'zones-page__filter-button'
                                }
                                onClick={() => setFilter(option.key)}
                            >
                                <span>{option.label}</span>
                                <span className="zones-page__filter-count">{filterCounts[option.key]}</span>
                            </button>
                        ))}
                    </div>
                    <div className="zones-page__result-count">
                        Showing <strong>{filteredZones.length}</strong> of <strong>{summary.total}</strong> zones
                    </div>
                </div>

                <div className="zones-page__list">
                    {loadState === 'loading' && filteredZones.length === 0 ? (
                        <div className="zones-page__empty">Collecting zone data…</div>
                    ) : null}

                    {loadState === 'error' && filteredZones.length === 0 ? (
                        <div className="zones-page__empty">Unable to load zone data.</div>
                    ) : null}

                    {loadState !== 'loading' && filteredZones.length === 0 && overview ? (
                        <div className="zones-page__empty">No zones match the current filter.</div>
                    ) : null}

                    {filteredZones.map((zone) => (
                        <article key={`${zone.name}-${zone.status}`} className="zones-page__zone-card">
                            <header className="zones-page__zone-header">
                                <h2 className="zones-page__zone-name">{zone.name || '(root)'}</h2>
                                <span className={STATUS_BADGE_CLASS[zone.status]}>{STATUS_LABELS[zone.status]}</span>
                            </header>
                            {zone.differences && zone.differences.length > 0 ? (
                                <div className="zones-page__differences">
                                    {zone.differences.map((difference, index) => (
                                        <span key={`${difference}-${index}`} className="badge badge--info">
                                            {difference}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            <div className="zones-page__zone-nodes">
                                {zone.nodes.map((node) => (
                                    <section key={node.nodeId} className="zones-page__zone-node">
                                        <div className="zones-page__zone-node-header">
                                            <div className="zones-page__zone-node-title">{node.nodeId}</div>
                                        </div>
                                        {node.error ? (
                                            <div className="zones-page__zone-node-body">
                                                <p className="zones-page__zone-node-error">{node.error}</p>
                                            </div>
                                        ) : null}
                                        {!node.error && !node.zone ? (
                                            <div className="zones-page__zone-node-body">
                                                <p className="zones-page__zone-node-missing">Zone not present.</p>
                                            </div>
                                        ) : null}
                                        {!node.error && node.zone ? (
                                            <div className="zones-page__zone-node-body">
                                                <div className="zones-page__details-grid">
                                                    {collectDetails(node).map((detail, index) => (
                                                        <div key={`${detail.label}-${index}`} className="zones-page__detail-item">
                                                            <span className="zones-page__detail-label">{detail.label}</span>
                                                            <span className="zones-page__detail-value">{detail.value}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}
                                    </section>
                                ))}
                            </div>
                        </article>
                    ))}
                </div>
            </div>
        </>
    );
}

export default ZonesPage;
