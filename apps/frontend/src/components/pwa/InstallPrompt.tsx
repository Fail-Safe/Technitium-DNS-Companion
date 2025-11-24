import { useEffect, useState } from 'react';
import './InstallPrompt.css';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [showPrompt, setShowPrompt] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);
    const [showIOSInstructions, setShowIOSInstructions] = useState(false);

    useEffect(() => {
        // Check if app is already installed (works for both Android and iOS)
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
            (navigator as any).standalone ||
            document.referrer.includes('android-app://');

        if (isStandalone) {
            setIsInstalled(true);
            return;
        }

        // Detect iOS
        const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
        setIsIOS(iOS);

        // Listen for the beforeinstallprompt event (Chrome, Edge, etc.)
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            setShowPrompt(true);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        // For iOS, show prompt after a short delay if not installed
        if (iOS && !isInstalled) {
            const timer = setTimeout(() => setShowPrompt(true), 3000);
            return () => clearTimeout(timer);
        }

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, [isInstalled]);

    const handleInstallClick = async () => {
        if (isIOS) {
            setShowIOSInstructions(!showIOSInstructions);
            return;
        }

        if (!deferredPrompt) return;

        // Show the install prompt
        await deferredPrompt.prompt();

        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;

        if (outcome === 'accepted') {
            console.log('User accepted the install prompt');
            setShowPrompt(false);
        }

        // Clear the deferredPrompt so it can't be used again
        setDeferredPrompt(null);
    };

    const handleDismiss = () => {
        setShowPrompt(false);
        // Remember dismissal for this session
        sessionStorage.setItem('install-prompt-dismissed', 'true');
    };

    // Don't show if already installed or user dismissed
    if (isInstalled || !showPrompt || sessionStorage.getItem('install-prompt-dismissed')) {
        return null;
    }

    return (
        <>
            <div className="install-prompt">
                <button
                    className="install-prompt__button"
                    onClick={handleInstallClick}
                    aria-label={isIOS ? 'Show install instructions' : 'Install app'}
                    title={isIOS ? 'Install instructions' : 'Install app'}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="install-prompt__icon"
                    >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    <span className="install-prompt__text">Install App</span>
                </button>
                <button
                    className="install-prompt__close"
                    onClick={handleDismiss}
                    aria-label="Dismiss install prompt"
                >
                    ×
                </button>
            </div>

            {/* iOS Installation Instructions Modal */}
            {isIOS && showIOSInstructions && (
                <div className="install-modal" onClick={() => setShowIOSInstructions(false)}>
                    <div className="install-modal__content" onClick={(e) => e.stopPropagation()}>
                        <div className="install-modal__header">
                            <h3>Install {__APP_NAME__}</h3>
                            <button
                                className="install-modal__close"
                                onClick={() => setShowIOSInstructions(false)}
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>
                        <div className="install-modal__body">
                            <p>To install this app on your iOS device:</p>
                            <ol>
                                <li>
                                    Tap the <strong>Share</strong> button
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 24 24"
                                        fill="currentColor"
                                        className="install-modal__ios-icon"
                                    >
                                        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                                        <path d="M16 2l-4 4-4-4" stroke="currentColor" strokeWidth="2" fill="none" />
                                        <path d="M12 6V2" stroke="currentColor" strokeWidth="2" />
                                    </svg>
                                    in Safari's toolbar
                                </li>
                                <li>
                                    Scroll down and tap <strong>"Add to Home Screen"</strong>
                                </li>
                                <li>
                                    Tap <strong>"Add"</strong> in the top-right corner
                                </li>
                            </ol>
                            <p className="install-modal__note">
                                Note: This only works in Safari. If you're using another browser, please open this page in Safari.
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
