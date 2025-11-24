import './ConfigurationSkeleton.css';

export function ConfigurationSkeleton() {
    return (
        <div className="configuration-skeleton">
            {/* Tab bar skeleton */}
            <div className="configuration-skeleton__tabs">
                <div className="skeleton skeleton--tab"></div>
                <div className="skeleton skeleton--tab"></div>
                <div className="skeleton skeleton--tab"></div>
                <div className="skeleton skeleton--tab"></div>
            </div>

            {/* Node selector skeleton */}
            <div className="configuration-skeleton__node-selector">
                <div className="skeleton skeleton--label"></div>
                <div className="skeleton skeleton--dropdown"></div>
            </div>

            {/* Content area skeleton */}
            <div className="configuration-skeleton__content">
                {/* Group list */}
                <div className="configuration-skeleton__sidebar">
                    <div className="skeleton skeleton--sidebar-header"></div>
                    <div className="configuration-skeleton__group-list">
                        <div className="skeleton skeleton--group-item"></div>
                        <div className="skeleton skeleton--group-item"></div>
                        <div className="skeleton skeleton--group-item"></div>
                    </div>
                </div>

                {/* Editor area */}
                <div className="configuration-skeleton__editor">
                    <div className="skeleton skeleton--editor-header"></div>
                    <div className="configuration-skeleton__form">
                        <div className="configuration-skeleton__field">
                            <div className="skeleton skeleton--field-label"></div>
                            <div className="skeleton skeleton--field-input"></div>
                        </div>
                        <div className="configuration-skeleton__field">
                            <div className="skeleton skeleton--field-label"></div>
                            <div className="skeleton skeleton--field-input"></div>
                        </div>
                        <div className="configuration-skeleton__field">
                            <div className="skeleton skeleton--field-label"></div>
                            <div className="skeleton skeleton--field-textarea"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
