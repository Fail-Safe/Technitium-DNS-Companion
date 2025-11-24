import './ZonesPageSkeleton.css';

export function ZonesPageSkeleton() {
    return (
        <div className="zones-page-skeleton">
            <header className="zones-page-skeleton__header">
                <div className="zones-page-skeleton__title-row">
                    <div>
                        <div className="skeleton skeleton--title"></div>
                        <div className="skeleton skeleton--subtitle"></div>
                    </div>
                    <div className="skeleton skeleton--button"></div>
                </div>
                <div className="zones-page-skeleton__meta-row">
                    <div className="skeleton skeleton--meta"></div>
                    <div className="skeleton skeleton--meta"></div>
                </div>
            </header>

            {/* Summary Cards */}
            <section className="zones-page-skeleton__summary">
                <div className="zones-page-skeleton__summary-grid">
                    <div className="zones-page-skeleton__summary-card">
                        <div className="skeleton skeleton--card-label"></div>
                        <div className="skeleton skeleton--card-value"></div>
                        <div className="skeleton skeleton--card-caption"></div>
                    </div>
                    <div className="zones-page-skeleton__summary-card">
                        <div className="skeleton skeleton--card-label"></div>
                        <div className="skeleton skeleton--card-value"></div>
                        <div className="skeleton skeleton--card-caption"></div>
                    </div>
                    <div className="zones-page-skeleton__summary-card">
                        <div className="skeleton skeleton--card-label"></div>
                        <div className="skeleton skeleton--card-value"></div>
                        <div className="skeleton skeleton--card-caption"></div>
                    </div>
                    <div className="zones-page-skeleton__summary-card">
                        <div className="skeleton skeleton--card-label"></div>
                        <div className="skeleton skeleton--card-value"></div>
                        <div className="skeleton skeleton--card-caption"></div>
                    </div>
                </div>

                {/* Node Cards */}
                <div className="zones-page-skeleton__nodes-grid">
                    <div className="zones-page-skeleton__node-card">
                        <div className="skeleton skeleton--node-header"></div>
                        <div className="zones-page-skeleton__node-meta">
                            <div className="skeleton skeleton--node-meta-item"></div>
                            <div className="skeleton skeleton--node-meta-item"></div>
                            <div className="skeleton skeleton--node-meta-item"></div>
                        </div>
                    </div>
                    <div className="zones-page-skeleton__node-card">
                        <div className="skeleton skeleton--node-header"></div>
                        <div className="zones-page-skeleton__node-meta">
                            <div className="skeleton skeleton--node-meta-item"></div>
                            <div className="skeleton skeleton--node-meta-item"></div>
                            <div className="skeleton skeleton--node-meta-item"></div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Filter Buttons */}
            <div className="zones-page-skeleton__filters">
                <div className="skeleton skeleton--filter-button"></div>
                <div className="skeleton skeleton--filter-button"></div>
                <div className="skeleton skeleton--filter-button"></div>
                <div className="skeleton skeleton--filter-button"></div>
                <div className="skeleton skeleton--filter-button"></div>
            </div>

            {/* Zone Cards */}
            <section className="zones-page-skeleton__zones">
                <div className="zones-page-skeleton__zone-card">
                    <div className="skeleton skeleton--zone-header"></div>
                    <div className="skeleton skeleton--zone-badge"></div>
                    <div className="skeleton skeleton--zone-details"></div>
                </div>
                <div className="zones-page-skeleton__zone-card">
                    <div className="skeleton skeleton--zone-header"></div>
                    <div className="skeleton skeleton--zone-badge"></div>
                    <div className="skeleton skeleton--zone-details"></div>
                </div>
                <div className="zones-page-skeleton__zone-card">
                    <div className="skeleton skeleton--zone-header"></div>
                    <div className="skeleton skeleton--zone-badge"></div>
                    <div className="skeleton skeleton--zone-details"></div>
                </div>
            </section>
        </div>
    );
}
