import { useState, useCallback } from 'react';
import { apiFetch } from '../config';

/**
 * Information about a Hagezi block list parsed from their GitHub README
 */
export interface HageziListInfo {
    id: string;
    name: string;
    url: string;
    description: string;
    category: 'multi' | 'security' | 'content';
    entries?: string;
}

/**
 * Result of checking for Hagezi updates
 */
export interface HageziUpdateCheckResult {
    success: boolean;
    timestamp: string;
    lists: HageziListInfo[];
    rawCommitDate?: string;
    error?: string;
}

/**
 * Comparison result showing new and changed lists
 */
export interface HageziCompareResult {
    newLists: HageziListInfo[];
    changedUrls: Array<{ oldUrl: string; newUrl: string; listName: string }>;
}

interface UseBlockListCatalogReturn {
    /** Fetch latest Hagezi catalog from GitHub */
    fetchHageziCatalog: (forceRefresh?: boolean) => Promise<HageziUpdateCheckResult | null>;
    /** Compare current URLs with latest Hagezi catalog */
    compareWithHagezi: (currentUrls: string[]) => Promise<HageziCompareResult | null>;
    /** Loading state for catalog operations */
    isLoading: boolean;
    /** Error message if operation failed */
    error: string | null;
    /** Last fetched catalog */
    catalog: HageziUpdateCheckResult | null;
}

/**
 * Hook for interacting with the blocklist catalog API
 * Used to check for updates to predefined block lists (Hagezi, etc.)
 */
export function useBlockListCatalog(): UseBlockListCatalogReturn {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<HageziUpdateCheckResult | null>(null);

    const fetchHageziCatalog = useCallback(async (forceRefresh = false): Promise<HageziUpdateCheckResult | null> => {
        setIsLoading(true);
        setError(null);

        try {
            const url = `/blocklist-catalog/hagezi${forceRefresh ? '?refresh=true' : ''}`;
            const response = await apiFetch(url);

            if (!response.ok) {
                throw new Error(`Failed to fetch catalog: ${response.status} ${response.statusText}`);
            }

            const result: HageziUpdateCheckResult = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch catalog');
            }

            setCatalog(result);
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    const compareWithHagezi = useCallback(async (currentUrls: string[]): Promise<HageziCompareResult | null> => {
        setIsLoading(true);
        setError(null);

        try {
            const encodedUrls = encodeURIComponent(currentUrls.join(','));
            const url = `/blocklist-catalog/hagezi/compare?urls=${encodedUrls}`;
            const response = await apiFetch(url);

            if (!response.ok) {
                throw new Error(`Failed to compare: ${response.status} ${response.statusText}`);
            }

            const result: HageziCompareResult = await response.json();
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    return {
        fetchHageziCatalog,
        compareWithHagezi,
        isLoading,
        error,
        catalog,
    };
}
