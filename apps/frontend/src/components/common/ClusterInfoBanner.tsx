import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHourglassHalf } from '@fortawesome/free-solid-svg-icons';
import './ClusterInfoBanner.css';

interface ClusterInfoBannerProps {
    primaryNodeName?: string;
    show: boolean;
}

/**
 * Banner component that explains clustering restrictions for write operations.
 * Shows when clustering is enabled to inform users that only the Primary node can be edited.
 * Can be dismissed, leaving a small indicator badge with tooltip.
 *
 * PERFORMANCE: Renders immediately (even while loading) to avoid blocking LCP.
 * Shows skeleton/loading state until cluster data arrives.
 */
export function ClusterInfoBanner({ primaryNodeName, show }: ClusterInfoBannerProps) {
    const [isDismissed, setIsDismissed] = useState(() => {
        // Check localStorage for dismissed state
        return localStorage.getItem('clusterBannerDismissed') === 'true';
    });

    const [isExpanded, setIsExpanded] = useState(false);

    // Loading state: show=true but primaryNodeName is still undefined
    const isLoading = show && !primaryNodeName;

    const handleToggleExpanded = () => {
        if (isDismissed) {
            // If dismissed, expand the banner
            setIsExpanded(!isExpanded);
        } else {
            // If showing full banner initially, dismiss it
            setIsDismissed(true);
            setIsExpanded(false);
            localStorage.setItem('clusterBannerDismissed', 'true');
        }
    };

    // Clear dismissed state when clustering is disabled
    useEffect(() => {
        if (!show) {
            localStorage.removeItem('clusterBannerDismissed');
            setIsExpanded(false);
        }
    }, [show]);

    if (!show) {
        return null;
    }

    // Show minimal loading indicator while cluster data loads (optimistic render)
    if (isLoading && !isDismissed) {
        return (
            <div className="cluster-info-banner cluster-info-banner--loading">
                <div className="cluster-info-banner__content">
                    <h3 className="cluster-info-banner__title">⏳ Checking cluster status...</h3>
                </div>
            </div>
        );
    }

    // Show compact badge when dismissed (with optional expanded banner below)
    if (isDismissed) {
        return (
            <div className="cluster-info-badge-container">
                <div className="cluster-info-badge">
                    <button
                        type="button"
                        className="cluster-info-badge__button"
                        onClick={handleToggleExpanded}
                        aria-label="Toggle cluster information"
                        aria-expanded={isExpanded}
                    >
                        <span className="cluster-info-badge__icon">🔗</span>
                        <span className="cluster-info-badge__text">Cluster Mode</span>
                    </button>
                </div>
                {isExpanded && (
                    <div className="cluster-info-banner cluster-info-banner--dropdown">
                        <div className="cluster-info-banner__icon">ℹ️</div>
                        <div className="cluster-info-banner__content">
                            <h3 className="cluster-info-banner__title">Cluster Mode Active</h3>
                            <p className="cluster-info-banner__message">
                                Your Technitium DNS servers are running in a cluster. Configuration changes can only be made on the <strong>Primary node ({primaryNodeName || 'Unknown'})</strong>.
                                Secondary nodes will automatically receive updates via zone transfers.
                            </p>
                        </div>
                        <button
                            type="button"
                            className="cluster-info-banner__dismiss"
                            onClick={handleToggleExpanded}
                            aria-label="Close cluster information"
                            title="Close"
                        >
                            ✕
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // Show full banner when not dismissed initially
    return (
        <div className="cluster-info-banner">
            <div className="cluster-info-banner__icon">ℹ️</div>
            <div className="cluster-info-banner__content">
                <h3 className="cluster-info-banner__title">Cluster Mode Active</h3>
                <p className="cluster-info-banner__message">
                    Your Technitium DNS servers are running in a cluster. Configuration changes can only be made on the <strong>Primary node ({primaryNodeName || 'Unknown'})</strong>.
                    Secondary nodes will automatically receive updates via zone transfers.
                </p>
            </div>
            <button
                type="button"
                className="cluster-info-banner__dismiss"
                onClick={handleToggleExpanded}
                aria-label="Dismiss cluster information"
                title="Dismiss (can be shown again by clicking the badge)"
            >
                ✕
            </button>
        </div>
    );
}
