import './NodeStatusCardSkeleton.css';

export function NodeStatusCardSkeleton() {
    return (
        <article className="node-card-skeleton">
            <header className="node-card-skeleton__header">
                <div>
                    <div className="skeleton skeleton--title"></div>
                    <div className="skeleton skeleton--version"></div>
                </div>
                <div className="node-card-skeleton__badges">
                    <div className="skeleton skeleton--badge"></div>
                    <div className="skeleton skeleton--badge"></div>
                </div>
            </header>

            <div className="node-card-skeleton__stats">
                <div className="node-card-skeleton__stat">
                    <div className="skeleton skeleton--stat-value"></div>
                    <div className="skeleton skeleton--stat-label"></div>
                </div>
                <div className="node-card-skeleton__stat">
                    <div className="skeleton skeleton--stat-value"></div>
                    <div className="skeleton skeleton--stat-label"></div>
                </div>
                <div className="node-card-skeleton__stat">
                    <div className="skeleton skeleton--stat-value"></div>
                    <div className="skeleton skeleton--stat-label"></div>
                </div>
                <div className="node-card-skeleton__stat">
                    <div className="skeleton skeleton--stat-value"></div>
                    <div className="skeleton skeleton--stat-label"></div>
                </div>
            </div>

            <dl className="node-card-skeleton__details">
                <div>
                    <dt className="skeleton skeleton--detail-label"></dt>
                    <dd className="skeleton skeleton--detail-value"></dd>
                </div>
                <div>
                    <dt className="skeleton skeleton--detail-label"></dt>
                    <dd className="skeleton skeleton--detail-value"></dd>
                </div>
            </dl>
        </article>
    );
}
