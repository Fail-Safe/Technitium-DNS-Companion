import { useEffect, useCallback } from 'react';
import { useTechnitiumState } from '../context/TechnitiumContext';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '../components/common/PullToRefreshIndicator';
import { NodeStatusCard } from '../components/nodes/NodeStatusCard';
import { NodeStatusCardSkeleton } from '../components/nodes/NodeStatusCardSkeleton';

export default function OverviewPage() {
    const { nodes, fetchNodeOverviews } = useTechnitiumState();

    // Fetch node overviews once nodes are available
    useEffect(() => {
        if (nodes.length === 0) {
            return;
        }

        fetchNodeOverviews();
    }, [fetchNodeOverviews, nodes.length]);

    // Pull-to-refresh functionality
    const handlePullToRefresh = useCallback(async () => {
        await fetchNodeOverviews();
    }, [fetchNodeOverviews]);

    const pullToRefresh = usePullToRefresh({
        onRefresh: handlePullToRefresh,
        threshold: 80,
        disabled: nodes.length === 0,
    });

    return (
        <>
            <PullToRefreshIndicator
                pullDistance={pullToRefresh.pullDistance}
                threshold={pullToRefresh.threshold}
                isRefreshing={pullToRefresh.isRefreshing}
            />
            <section ref={pullToRefresh.containerRef} className="dashboard dashboard--overview">
                <header className="dashboard__header">
                    <div>
                        <h1>Overview</h1>
                        <p>Monitor Technitium DNS nodes and recent synchronization status.</p>
                    </div>
                </header>

                {nodes.length === 0 ? (
                    <p className="dashboard__empty-state">
                        No nodes configured. Please configure your Technitium DNS nodes via environment variables on the backend server.
                    </p>
                ) : (
                    <section className="dashboard__grid">
                        {nodes.map((node) => (
                            node.overview ? (
                                <NodeStatusCard key={node.id} node={node} />
                            ) : (
                                <NodeStatusCardSkeleton key={node.id} />
                            )
                        ))}
                    </section>
                )}
            </section>
        </>
    );
}
