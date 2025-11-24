import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import type { TechnitiumNode } from '../../context/TechnitiumContext';
import ClusterBadge from './ClusterBadge';

interface NodeStatusCardProps {
    node: TechnitiumNode;
}

const statusLabels: Record<TechnitiumNode['status'], string> = {
    online: 'Online',
    syncing: 'Syncing',
    offline: 'Offline',
    unknown: 'Unknown',
};

function formatUptime(seconds: number): string {
    if (seconds === 0) return 'Unknown';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatNumber(num: number): string {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
}

export function NodeStatusCard({ node }: NodeStatusCardProps) {
    const overview = node.overview;

    return (
        <article className={`node-card node-card--${node.status}`}>
            <header className="node-card__header">
                <div>
                    <h3>{node.name}</h3>
                    {overview && <span className="node-card__version">{overview.version}</span>}
                </div>
                <div className="node-card__status-badges">
                    <span className="node-card__status">{statusLabels[node.status]}</span>
                    <ClusterBadge clusterState={node.clusterState} />
                    {node.hasAdvancedBlocking !== undefined && (
                        <span className={`node-card__app-badge ${node.hasAdvancedBlocking ? 'node-card__app-badge--has' : 'node-card__app-badge--missing'}`}>
                            <FontAwesomeIcon icon={node.hasAdvancedBlocking ? faCheck : faExclamationTriangle} /> Advanced Blocking
                        </span>
                    )}
                </div>
            </header>

            {overview && (
                <div className="node-card__stats">
                    <div className="node-card__stat">
                        <span className="node-card__stat-value">{overview.totalZones}</span>
                        <span className="node-card__stat-label">Zones</span>
                    </div>
                    <div className="node-card__stat">
                        <span className="node-card__stat-value">{formatNumber(overview.totalQueries)}</span>
                        <span className="node-card__stat-label">Queries (24h)</span>
                    </div>
                    <div className="node-card__stat">
                        <span className="node-card__stat-value">{formatNumber(overview.totalBlockedQueries)}</span>
                        <span className="node-card__stat-label">Blocked (24h)</span>
                    </div>
                    <div className="node-card__stat">
                        <span className="node-card__stat-value">{overview.totalApps}</span>
                        <span className="node-card__stat-label">Apps</span>
                    </div>
                </div>
            )}

            <dl className="node-card__details">
                <div>
                    <dt>API Base URL</dt>
                    <dd>{node.baseUrl}</dd>
                </div>
                {node.clusterState?.initialized && (
                    <>
                        <div>
                            <dt>Cluster Domain</dt>
                            <dd>{node.clusterState.domain || 'Unknown'}</dd>
                        </div>
                        <div>
                            <dt>Node Role</dt>
                            <dd>{node.clusterState.type || 'Unknown'}</dd>
                        </div>
                    </>
                )}
                {overview && overview.uptime > 0 && (
                    <div>
                        <dt>Uptime</dt>
                        <dd>{formatUptime(overview.uptime)}</dd>
                    </div>
                )}
                <div>
                    <dt>Last Check</dt>
                    <dd>{new Date(node.lastSync).toLocaleString()}</dd>
                </div>
            </dl>
            {node.issues && node.issues.length > 0 && (
                <footer className="node-card__issues">
                    <h4>Attention Needed</h4>
                    <ul>
                        {node.issues.map((issue) => (
                            <li key={issue}>{issue}</li>
                        ))}
                    </ul>
                </footer>
            )}
        </article>
    );
}
