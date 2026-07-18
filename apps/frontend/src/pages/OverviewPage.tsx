import { useCallback, useEffect, useMemo } from "react";
import { PullToRefreshIndicator } from "../components/common/PullToRefreshIndicator";
import { TechnitiumVersionDeprecationBanner } from "../components/common/TechnitiumVersionDeprecationBanner";
import { NodeStatusCard } from "../components/nodes/NodeStatusCard";
import { NodeStatusCardSkeleton } from "../components/nodes/NodeStatusCardSkeleton";
import { useTechnitiumState } from "../context/useTechnitiumState";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import { sortOverviewNodes } from "../utils/overviewNodeOrdering";
import { isDeprecatedTechnitiumVersion } from "../utils/technitium-version-support";

export default function OverviewPage() {
  const { nodes, fetchNodeOverviews } = useTechnitiumState();
  const orderedNodes = useMemo(() => sortOverviewNodes(nodes), [nodes]);
  const deprecatedNodes = useMemo(
    () =>
      orderedNodes.flatMap((node) => {
        const version = node.overview?.version;
        if (!version || !isDeprecatedTechnitiumVersion(version)) {
          return [];
        }

        return [{ id: node.id, name: node.name, version }];
      }),
    [orderedNodes],
  );

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
      <section
        ref={pullToRefresh.containerRef}
        className="dashboard dashboard--overview"
      >
        <header className="dashboard__header">
          <div>
            <h1>Overview</h1>
            <p>
              Monitor Technitium DNS nodes and recent synchronization status.
            </p>
          </div>
        </header>

        <TechnitiumVersionDeprecationBanner nodes={deprecatedNodes} />

        {orderedNodes.length === 0 ? (
          <p className="dashboard__empty-state">
            No nodes configured. Please configure your Technitium DNS nodes via
            environment variables on the backend server.
          </p>
        ) : (
          <section className="dashboard__grid">
            {orderedNodes.map((node) =>
              node.overview ? (
                <NodeStatusCard key={node.id} node={node} />
              ) : (
                <NodeStatusCardSkeleton key={node.id} />
              ),
            )}
          </section>
        )}
      </section>
    </>
  );
}
