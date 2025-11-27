/**
 * URL Parsing Utilities
 *
 * Used by DNS Lookup (Policy Simulator, Global Lookup) to extract domains
 * from various input formats including full URLs, paths, and plain domains.
 *
 * This allows users to paste full URLs and automatically extract just the
 * domain for DNS lookups and policy checks.
 */

/**
 * Extract domain from a URL or return the input as-is if it's already a domain
 *
 * Handles multiple input formats:
 * - Full URLs with protocol: https://example.com/path → example.com
 * - URLs with ports: http://example.com:8080 → example.com
 * - Paths without protocol: example.com/path/file.jpg → example.com
 * - Plain domains: example.com → example.com
 * - Subdomains: cdn.example.com → cdn.example.com
 *
 * @param input - User input (URL, path, or domain)
 * @returns Extracted domain or hostname
 *
 * @example
 * // Full URLs
 * extractDomainFromInput('https://cdn.moego.pet/path/file.jpg')
 * // Returns: 'cdn.moego.pet'
 *
 * @example
 * // URLs with ports
 * extractDomainFromInput('http://example.com:8080/api')
 * // Returns: 'example.com'
 *
 * @example
 * // Paths without protocol
 * extractDomainFromInput('example.com/path/to/resource')
 * // Returns: 'example.com'
 *
 * @example
 * // Plain domains (returned as-is)
 * extractDomainFromInput('example.com')
 * // Returns: 'example.com'
 *
 * @example
 * // Subdomains preserved
 * extractDomainFromInput('www.example.com')
 * // Returns: 'www.example.com'
 *
 * @example
 * // Query strings and anchors stripped
 * extractDomainFromInput('https://example.com/path?query=1#anchor')
 * // Returns: 'example.com'
 */
export function extractDomainFromInput(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) return trimmed;

    // If input contains protocol or looks like a URL path, parse it
    if (trimmed.includes('://') || trimmed.includes('/')) {
        try {
            // Add protocol if missing to help URL parser
            const urlString = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
            const url = new URL(urlString);
            return url.hostname;
        } catch {
            // If URL parsing fails, return as-is (might be a partial domain)
            return trimmed;
        }
    }

    // If it's just a domain (no protocol, no path), return as-is
    return trimmed;
}
