import { useEffect, useRef } from 'react';
import { useLocation, UNSAFE_NavigationContext } from 'react-router-dom';
import type { Navigator } from 'react-router-dom';
import { useContext } from 'react';

/**
 * Hook to prevent navigation (both in-app and browser) when there are unsaved changes.
 *
 * Compatible with BrowserRouter (doesn't require data router).
 *
 * @param hasUnsavedChanges - Boolean indicating if there are unsaved changes
 * @param message - Custom message to display (optional)
 *
 * @example
 * ```tsx
 * const [hasChanges, setHasChanges] = useState(false);
 * useNavigationBlocker(hasChanges, 'You have unsaved changes in the form.');
 * ```
 */
export function useNavigationBlocker(
    hasUnsavedChanges: boolean,
    message: string = 'You have unsaved changes. Are you sure you want to leave? Your changes will be lost.',
) {
    const location = useLocation();
    const navigationContext = useContext(UNSAFE_NavigationContext);
    const currentLocation = useRef(location);
    const isBlocking = useRef(false);

    // Update current location when it changes
    useEffect(() => {
        currentLocation.current = location;
    }, [location]);

    // Intercept navigator push/replace to show confirmation
    useEffect(() => {
        if (!hasUnsavedChanges || !navigationContext || typeof navigationContext !== 'object' || !('navigator' in navigationContext)) {
            return;
        }

        const { navigator } = navigationContext as { navigator: Navigator };
        const originalPush = navigator.push;
        const originalReplace = navigator.replace;

        // Override push method
        (navigator as Navigator).push = (...args: Parameters<typeof originalPush>) => {
            if (isBlocking.current) {
                // Already showing dialog, don't interfere
                return originalPush.apply(navigator, args);
            }

            isBlocking.current = true;
            const confirmed = window.confirm(message);
            isBlocking.current = false;

            if (confirmed) {
                return originalPush.apply(navigator, args);
            }
            // Don't navigate if user cancels
        };

        // Override replace method
        (navigator as Navigator).replace = (...args: Parameters<typeof originalReplace>) => {
            if (isBlocking.current) {
                // Already showing dialog, don't interfere
                return originalReplace.apply(navigator, args);
            }

            isBlocking.current = true;
            const confirmed = window.confirm(message);
            isBlocking.current = false;

            if (confirmed) {
                return originalReplace.apply(navigator, args);
            }
            // Don't navigate if user cancels
        };

        // Cleanup: restore original methods
        return () => {
            (navigator as Navigator).push = originalPush;
            (navigator as Navigator).replace = originalReplace;
        };
    }, [hasUnsavedChanges, message, navigationContext]);

    // Block browser navigation (refresh, close tab, external navigation)
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = ''; // Chrome requires returnValue to be set
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedChanges]);
}
