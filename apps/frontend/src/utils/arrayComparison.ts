/**
 * Array Comparison Utilities
 *
 * Order-independent comparison functions for arrays used in sync detection
 * and configuration comparison across Technitium DNS nodes.
 *
 * These functions are critical for:
 * - Sync badge calculation (counting differences between nodes)
 * - Configuration sync view (detecting changes)
 * - Advanced Blocking group comparison
 */

import type { AdvancedBlockingUrlEntry } from '../types/advancedBlocking';

/**
 * Compare two string arrays for equality (order-independent)
 *
 * @param arr1 - First array to compare
 * @param arr2 - Second array to compare
 * @returns true if arrays contain the same elements (regardless of order)
 *
 * @example
 * compareStringArrays(['a', 'b'], ['b', 'a']) // true
 * compareStringArrays(['a', 'b'], ['a', 'c']) // false
 */
export function compareStringArrays(
    arr1: string[] | undefined,
    arr2: string[] | undefined
): boolean {
    // Handle undefined cases
    if (!arr1 && !arr2) return true;
    if (!arr1 || !arr2) return false;

    // Quick length check
    if (arr1.length !== arr2.length) return false;

    // Sort and compare element by element
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();
    return sorted1.every((val, idx) => val === sorted2[idx]);
}

/**
 * Compare two URL entry arrays for equality (order-independent)
 *
 * URL entries can be either:
 * - Simple strings (URL)
 * - Objects with url, blockAsNxDomain, and blockingAddresses properties
 *
 * @param arr1 - First array of URL entries
 * @param arr2 - Second array of URL entries
 * @returns true if arrays contain the same URL entries (regardless of order)
 *
 * @example
 * compareUrlArrays(['http://example.com'], ['http://example.com']) // true
 * compareUrlArrays(
 *   [{ url: 'http://example.com', blockAsNxDomain: true }],
 *   [{ url: 'http://example.com', blockAsNxDomain: true }]
 * ) // true
 */
export function compareUrlArrays(
    arr1: AdvancedBlockingUrlEntry[] | undefined,
    arr2: AdvancedBlockingUrlEntry[] | undefined
): boolean {
    // Handle undefined cases
    if (!arr1 && !arr2) return true;
    if (!arr1 || !arr2) return false;

    // Quick length check
    if (arr1.length !== arr2.length) return false;

    /**
     * Convert URL entry to comparable string
     * - String entries: use as-is
     * - Object entries: JSON stringify with consistent property order
     */
    const toComparable = (entry: AdvancedBlockingUrlEntry): string => {
        if (typeof entry === 'string') return entry;
        return JSON.stringify({
            url: entry.url,
            blockAsNxDomain: entry.blockAsNxDomain,
            blockingAddresses: entry.blockingAddresses,
        });
    };

    // Convert to comparable strings, sort, and compare
    const sorted1 = arr1.map(toComparable).sort();
    const sorted2 = arr2.map(toComparable).sort();
    return sorted1.every((val, idx) => val === sorted2[idx]);
}
