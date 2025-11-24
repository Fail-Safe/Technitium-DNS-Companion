import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGear, faClipboard, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import './AdvancedBlockingSetupGuide.css';

export interface AdvancedBlockingSetupGuideProps {
    /**
     * List of node IDs that are missing the Advanced Blocking app
     */
    missingNodes?: Array<{ id: string; name: string }>;

    /**
     * If true, shows full setup guide (no nodes have the app)
     * If false, shows warning banner (some nodes missing)
     */
    showFullGuide?: boolean;
}

export function AdvancedBlockingSetupGuide({
    missingNodes = [],
    showFullGuide = false,
}: AdvancedBlockingSetupGuideProps) {
    const [showInstructions, setShowInstructions] = useState(false);

    if (missingNodes.length === 0) {
        return null;
    }

    if (showFullGuide) {
        return (
            <div className="ab-setup-guide">
                <div className="ab-setup-guide__icon"><FontAwesomeIcon icon={faGear} /></div>
                <h2 className="ab-setup-guide__title">Advanced Blocking App Required</h2>
                <p className="ab-setup-guide__intro">
                    The DNS Filtering feature requires the <strong>Advanced Blocking</strong> app to be
                    installed on your Technitium DNS servers. This app provides advanced domain blocking,
                    allow/block lists, regex filtering, and client group management.
                </p>

                <div className="ab-setup-guide__section">
                    <h3 className="ab-setup-guide__section-title"><FontAwesomeIcon icon={faClipboard} /> Installation Steps</h3>
                    <ol className="ab-setup-guide__steps">
                        <li>
                            <strong>Access Technitium DNS Admin Panel</strong>
                            <ul>
                                {missingNodes.map((node) => (
                                    <li key={node.id}>
                                        {node.name}: <code>{node.id}</code>
                                    </li>
                                ))}
                            </ul>
                        </li>
                        <li>
                            <strong>Navigate to Apps</strong>
                            <p>Click on the "Apps" tab</p>
                        </li>
                        <li>
                            <strong>Install Advanced Blocking</strong>
                            <p>
                                Click "App Store" button and find <code>Advanced Blocking</code>, then click "Install" on the
                                <code>Advanced Blocking</code> app
                            </p>
                        </li>
                        <li>
                            <strong>Verify Installation</strong>
                            <p>
                                Click "Close" on the <code>DNS App Store</code> after installation. The app should appear in your installed
                                apps list.
                            </p>
                        </li>
                    </ol>
                </div>

                <div className="ab-setup-guide__section">
                    <h3 className="ab-setup-guide__section-title">📚 Documentation</h3>
                    <ul className="ab-setup-guide__links">
                        <li>
                            <a
                                href="https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ab-setup-guide__link"
                            >
                                Technitium DNS API Documentation
                                <span className="ab-setup-guide__external-icon">↗</span>
                            </a>
                        </li>
                        <li>
                            <a
                                href="https://github.com/TechnitiumSoftware/DnsServer/blob/master/Apps/AdvancedBlockingApp/dnsApp.config"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ab-setup-guide__link"
                            >
                                Advanced Blocking Configuration Reference
                                <span className="ab-setup-guide__external-icon">↗</span>
                            </a>
                        </li>
                    </ul>
                </div>

                <div className="ab-setup-guide__note">
                    Technitium DNS                    <strong>Note:</strong> After installing the app, you may need to restart your Technitium
                    DNS server for changes to take full effect.
                </div>
            </div>
        );
    }

    // Warning banner mode (some nodes have it, others don't)
    return (
        <div className="ab-setup-warning">
            <div className="ab-setup-warning__icon">⚠️</div>
            <div className="ab-setup-warning__content">
                <h3 className="ab-setup-warning__title">
                    Advanced Blocking App Missing on Some Nodes
                </h3>
                <p className="ab-setup-warning__message">
                    The following nodes need the Advanced Blocking app installed:
                </p>
                <ul className="ab-setup-warning__nodes">
                    {missingNodes.map((node) => (
                        <li key={node.id}>
                            <code>{node.name}</code>
                        </li>
                    ))}
                </ul>
                <p className="ab-setup-warning__message">
                    DNS Filtering sync operations targeting these nodes will be disabled until the app is
                    installed.{' '}
                    <button
                        type="button"
                        onClick={() => setShowInstructions(!showInstructions)}
                        className="ab-setup-warning__toggle-button"
                    >
                        {showInstructions ? 'Hide' : 'Show'} installation instructions
                    </button>
                </p>

                {showInstructions && (
                    <div className="ab-setup-warning__instructions">
                        <h4 className="ab-setup-warning__instructions-title"><FontAwesomeIcon icon={faClipboard} /> Installation Steps</h4>
                        <ol className="ab-setup-warning__steps">
                            <li>
                                <strong>Access Technitium DNS Admin Panel</strong>
                                <ul>
                                    {missingNodes.map((node) => (
                                        <li key={node.id}>
                                            {node.name}: <code>{node.id}</code>
                                        </li>
                                    ))}
                                </ul>
                            </li>
                            <li>
                                <strong>Navigate to Apps</strong>
                                <p>Click on the "Apps" tab</p>
                            </li>
                            <li>
                                <strong>Install Advanced Blocking</strong>
                                <p>
                                    Click "App Store" button and find <code>Advanced Blocking</code>, then click "Install" on the{' '}
                                    <code>Advanced Blocking</code> app
                                </p>
                            </li>
                            <li>
                                <strong>Verify Installation</strong>
                                <p>
                                    Click "Close" on the <code>DNS App Store</code> after installation. The app should appear in your installed
                                    apps list.
                                </p>
                            </li>
                        </ol>
                        <p className="ab-setup-warning__docs-link">
                            For more details, see the{' '}
                            <a
                                href="https://github.com/TechnitiumSoftware/DnsServer/tree/master/Apps/AdvancedBlockingApp"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ab-setup-warning__link"
                            >
                                Advanced Blocking documentation ↗
                            </a>
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
