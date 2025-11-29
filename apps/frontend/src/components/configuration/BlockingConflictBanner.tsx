import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { NodeBlockingStatus } from '../../types/builtInBlocking';
import './BlockingConflictBanner.css';

interface BlockingConflictBannerProps {
    hasConflict: boolean;
    conflictWarning?: string;
    conflictingNodes?: NodeBlockingStatus[];
    onDismiss?: () => void;
    show: boolean;
}

export function BlockingConflictBanner({
    hasConflict,
    conflictWarning,
    conflictingNodes = [],
    onDismiss,
    show,
}: BlockingConflictBannerProps) {
    if (!show || !hasConflict) {
        return null;
    }

    const nodeNames = conflictingNodes
        .filter((n) => n.hasConflict)
        .map((n) => n.nodeName)
        .join(', ');

    return (
        <div className="blocking-conflict-banner">
            <div className="blocking-conflict-banner__icon">
                <FontAwesomeIcon icon={faExclamationTriangle} />
            </div>
            <div className="blocking-conflict-banner__content">
                <strong>Potential Conflict Detected</strong>
                <p>
                    {conflictWarning ||
                        'Both Built-in Blocking and Advanced Blocking are enabled. This may cause unpredictable behavior.'}
                </p>
                {nodeNames && (
                    <p className="blocking-conflict-banner__nodes">
                        Affected nodes: <strong>{nodeNames}</strong>
                    </p>
                )}
                <p className="blocking-conflict-banner__hint">
                    <em>Tip: Disable Built-in Blocking when using Advanced Blocking for best results.</em>
                </p>
            </div>
            {onDismiss && (
                <button
                    type="button"
                    className="blocking-conflict-banner__dismiss"
                    onClick={onDismiss}
                    aria-label="Dismiss warning"
                >
                    <FontAwesomeIcon icon={faXmark} />
                </button>
            )}
        </div>
    );
}
