/**
 * Levenshtein Distance & String Similarity Utilities
 *
 * Used for detecting domain modifications in sync views (purple badges).
 * Helps distinguish between:
 * - Pure additions (completely new domains)
 * - Pure removals (domains deleted)
 * - Modifications (similar domains that changed slightly)
 *
 * Examples of modifications detected:
 * - cdn1.example.com → cdn2.example.com (CDN number change)
 * - example.com → ^example\.com$ (regex conversion)
 * - ads.example.com → ads.exmaple.com (typo fix)
 */

/**
 * Calculate Levenshtein distance between two strings
 *
 * Levenshtein distance is the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to change one string into another.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns The edit distance between the strings
 *
 * @example
 * levenshteinDistance('kitten', 'sitting') // 3
 * levenshteinDistance('example.com', 'example.org') // 3
 * levenshteinDistance('cdn1.ex.com', 'cdn2.ex.com') // 1
 *
 * @complexity O(m * n) where m and n are the lengths of the strings
 */
export function levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    // Initialize first column (transforming from empty string)
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    // Initialize first row (transforming to empty string)
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    // Fill in the rest of the matrix
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                // Characters match, no edit needed
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                // Take minimum of three possible edits
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, // substitution
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j] + 1      // deletion
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

/**
 * Check if two strings are similar enough to be considered a modification
 *
 * Uses Levenshtein distance with a threshold based on string length.
 * Default threshold is 60% similarity - strings that share at least 60%
 * of their characters (considering edits) are considered modifications.
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @param threshold - Similarity threshold (0-1), defaults to 0.6 (60%)
 * @returns true if strings are similar enough to be considered a modification
 *
 * @example
 * // CDN number changes
 * areSimilar('cdn1.example.com', 'cdn2.example.com') // true
 *
 * // Regex conversions
 * areSimilar('example.com', '^example\\.com$') // true
 *
 * // Typo fixes
 * areSimilar('ads.example.com', 'ads.exmaple.com') // true
 *
 * // Completely different domains
 * areSimilar('google.com', 'facebook.com') // false
 *
 * // Custom threshold for stricter matching
 * areSimilar('cdn1.ex.com', 'cdn9.ex.com', 0.9) // false (90% similarity required)
 */
export function areSimilar(
    str1: string,
    str2: string,
    threshold: number = 0.6
): boolean {
    // Quick check for identical strings
    if (str1 === str2) return true;

    const maxLen = Math.max(str1.length, str2.length);

    // Empty strings are considered similar
    if (maxLen === 0) return true;

    const distance = levenshteinDistance(str1, str2);
    const similarity = 1 - distance / maxLen;

    // Consider strings similar if they meet the threshold
    // Default: 60% similarity catches domain changes, regex additions, typos
    return similarity >= threshold;
}
