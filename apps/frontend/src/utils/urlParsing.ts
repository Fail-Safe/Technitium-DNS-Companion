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

  // Fast-path parsing without constructing URL objects (perf-sensitive hot path)
  if (trimmed.includes("://") || trimmed.includes("/")) {
    try {
      const candidate =
        trimmed.includes("://") ? trimmed : `https://${trimmed}`;
      const schemeIndex = candidate.indexOf("://");
      const hostStart = schemeIndex >= 0 ? schemeIndex + 3 : 0;

      let hostAndRest = candidate.slice(hostStart);

      // Drop auth segment if present (user:pass@host)
      const atIndex = hostAndRest.lastIndexOf("@");
      if (atIndex !== -1) {
        hostAndRest = hostAndRest.slice(atIndex + 1);
      }

      // Find first path/query/fragment delimiter
      let hostEnd = hostAndRest.length;
      const slashIndex = hostAndRest.indexOf("/");
      const queryIndex = hostAndRest.indexOf("?");
      const hashIndex = hostAndRest.indexOf("#");

      if (slashIndex !== -1 && slashIndex < hostEnd) hostEnd = slashIndex;
      if (queryIndex !== -1 && queryIndex < hostEnd) hostEnd = queryIndex;
      if (hashIndex !== -1 && hashIndex < hostEnd) hostEnd = hashIndex;

      let hostPort = hostAndRest.slice(0, hostEnd);

      // IPv6 literals keep brackets; trim port after closing bracket if present
      if (hostPort.startsWith("[")) {
        const closing = hostPort.indexOf("]");
        if (closing !== -1) {
          return hostPort.slice(0, closing + 1);
        }
      }

      // Strip port for IPv4/hostname
      const portIndex = hostPort.lastIndexOf(":");
      if (portIndex !== -1) {
        hostPort = hostPort.slice(0, portIndex);
      }

      return hostPort.toLowerCase();
    } catch {
      // Fallback to original behavior if string ops fail unexpectedly
      return trimmed;
    }
  }

  // If it's just a domain (no protocol, no path), return as-is
  return trimmed;
}
