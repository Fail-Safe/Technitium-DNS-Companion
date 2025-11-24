import './DhcpPageSkeleton.css';

export function DhcpPageSkeleton() {
    return (
        <section className="dhcp-page-skeleton">
            <header className="dhcp-page-skeleton__header">
                <div>
                    <div className="skeleton skeleton--title"></div>
                    <div className="skeleton skeleton--subtitle"></div>
                </div>
                <div className="skeleton skeleton--button"></div>
            </header>

            {/* Node Selector Skeleton */}
            <div className="dhcp-page-skeleton__node-selector">
                <div className="skeleton skeleton--selector-label"></div>
                <div className="dhcp-page-skeleton__node-cards">
                    <div className="dhcp-page-skeleton__node-card">
                        <div className="skeleton skeleton--node-radio"></div>
                        <div className="dhcp-page-skeleton__node-content">
                            <div className="skeleton skeleton--node-title"></div>
                            <div className="skeleton skeleton--node-stats"></div>
                        </div>
                    </div>
                    <div className="dhcp-page-skeleton__node-card">
                        <div className="skeleton skeleton--node-radio"></div>
                        <div className="dhcp-page-skeleton__node-content">
                            <div className="skeleton skeleton--node-title"></div>
                            <div className="skeleton skeleton--node-stats"></div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Content Panels */}
            <div className="dhcp-page-skeleton__panels">
                {/* Scope List Panel */}
                <section className="dhcp-page-skeleton__card">
                    <div className="skeleton skeleton--card-header"></div>
                    <div className="dhcp-page-skeleton__scope-list">
                        <div className="skeleton skeleton--scope-item"></div>
                        <div className="skeleton skeleton--scope-item"></div>
                        <div className="skeleton skeleton--scope-item"></div>
                    </div>
                </section>

                {/* Details Panel */}
                <section className="dhcp-page-skeleton__card">
                    <div className="skeleton skeleton--card-header"></div>
                    <div className="dhcp-page-skeleton__details">
                        <div className="dhcp-page-skeleton__field">
                            <div className="skeleton skeleton--field-label"></div>
                            <div className="skeleton skeleton--field-input"></div>
                        </div>
                        <div className="dhcp-page-skeleton__field">
                            <div className="skeleton skeleton--field-label"></div>
                            <div className="skeleton skeleton--field-input"></div>
                        </div>
                        <div className="dhcp-page-skeleton__field">
                            <div className="skeleton skeleton--field-label"></div>
                            <div className="skeleton skeleton--field-input"></div>
                        </div>
                    </div>
                </section>
            </div>
        </section>
    );
}
