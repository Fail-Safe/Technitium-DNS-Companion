/**
 * URL Parsing & Domain Extraction Test Suite
 *
 * Tests for extractDomainFromInput() function extracted to utils/urlParsing.ts.
 *
 * Used in DnsLookupPage.tsx for the Policy Simulator and Global Lookup features.
 * This ensures that URL parsing works correctly for various input formats
 * and can extract domains from full URLs while preserving plain domain inputs.
 */

import { describe, it, expect } from 'vitest';
import { extractDomainFromInput } from '../utils/urlParsing';

describe('URL Parsing & Domain Extraction', () => {
    describe('extractDomainFromInput', () => {
        describe('🔴 CRITICAL: Basic URL Parsing', () => {
            it('should extract domain from https URL', () => {
                expect(extractDomainFromInput('https://example.com')).toBe('example.com');
            });

            it('should extract domain from http URL', () => {
                expect(extractDomainFromInput('http://example.com')).toBe('example.com');
            });

            it('should extract domain from URL with path', () => {
                expect(extractDomainFromInput('https://example.com/path/to/page')).toBe('example.com');
            });

            it('should extract domain from URL with query string', () => {
                expect(extractDomainFromInput('https://example.com?query=value')).toBe('example.com');
            });

            it('should extract domain from URL with anchor', () => {
                expect(extractDomainFromInput('https://example.com#section')).toBe('example.com');
            });

            it('should extract domain from URL with port', () => {
                expect(extractDomainFromInput('https://example.com:8080')).toBe('example.com');
            });

            it('should extract domain from complex URL', () => {
                expect(extractDomainFromInput('https://example.com:8080/path?query=value#anchor')).toBe('example.com');
            });
        });

        describe('🔴 CRITICAL: Plain Domain Input', () => {
            it('should preserve plain domain input', () => {
                expect(extractDomainFromInput('example.com')).toBe('example.com');
            });

            it('should preserve subdomain input', () => {
                expect(extractDomainFromInput('www.example.com')).toBe('www.example.com');
            });

            it('should preserve deep subdomain input', () => {
                expect(extractDomainFromInput('api.v2.example.com')).toBe('api.v2.example.com');
            });

            it('should preserve TLD variations', () => {
                expect(extractDomainFromInput('example.co.uk')).toBe('example.co.uk');
                expect(extractDomainFromInput('example.org')).toBe('example.org');
                expect(extractDomainFromInput('example.net')).toBe('example.net');
            });
        });

        describe('🔴 CRITICAL: Whitespace Handling', () => {
            it('should trim leading whitespace', () => {
                expect(extractDomainFromInput('  example.com')).toBe('example.com');
            });

            it('should trim trailing whitespace', () => {
                expect(extractDomainFromInput('example.com  ')).toBe('example.com');
            });

            it('should trim leading and trailing whitespace', () => {
                expect(extractDomainFromInput('  example.com  ')).toBe('example.com');
            });

            it('should trim whitespace from URLs', () => {
                expect(extractDomainFromInput('  https://example.com  ')).toBe('example.com');
            });
        });

        describe('🟡 HIGH: Subdomain Extraction', () => {
            it('should extract subdomain from URL', () => {
                expect(extractDomainFromInput('https://www.example.com')).toBe('www.example.com');
            });

            it('should extract deep subdomain from URL', () => {
                expect(extractDomainFromInput('https://api.v2.staging.example.com')).toBe('api.v2.staging.example.com');
            });

            it('should extract subdomain from URL with path', () => {
                expect(extractDomainFromInput('https://blog.example.com/post/123')).toBe('blog.example.com');
            });
        });

        describe('🟡 HIGH: URL with Path/Query/Anchor', () => {
            it('should handle URL with path only', () => {
                expect(extractDomainFromInput('example.com/path/to/page')).toBe('example.com');
            });

            it('should NOT parse URL with query only (no slash, returns as-is)', () => {
                // Without slash, it's treated as a plain domain even with query string
                expect(extractDomainFromInput('example.com?query=value')).toBe('example.com?query=value');
            });

            it('should NOT parse URL with anchor only (no slash, returns as-is)', () => {
                // Without slash, it's treated as a plain domain even with anchor
                expect(extractDomainFromInput('example.com#section')).toBe('example.com#section');
            });

            it('should NOT parse URL with multiple query parameters (no slash, returns as-is)', () => {
                // Without slash, treated as plain input
                expect(extractDomainFromInput('example.com?a=1&b=2&c=3')).toBe('example.com?a=1&b=2&c=3');
            });

            it('should handle URL with complex path and query', () => {
                expect(extractDomainFromInput('example.com/api/v1/users?page=1&limit=10')).toBe('example.com');
            });
        });

        describe('🟡 HIGH: Edge Cases', () => {
            it('should handle empty string', () => {
                expect(extractDomainFromInput('')).toBe('');
            });

            it('should handle URL with authentication', () => {
                expect(extractDomainFromInput('https://user:pass@example.com')).toBe('example.com');
            });

            it('should handle localhost', () => {
                expect(extractDomainFromInput('http://localhost')).toBe('localhost');
                expect(extractDomainFromInput('localhost')).toBe('localhost');
            });

            it('should handle localhost with port', () => {
                expect(extractDomainFromInput('http://localhost:3000')).toBe('localhost');
            });

            it('should handle IP addresses', () => {
                expect(extractDomainFromInput('https://192.168.1.1')).toBe('192.168.1.1');
                expect(extractDomainFromInput('192.168.1.1')).toBe('192.168.1.1');
            });

            it('should handle IPv6 addresses', () => {
                expect(extractDomainFromInput('https://[2001:db8::1]')).toBe('[2001:db8::1]');
            });

            it('should handle malformed URLs gracefully', () => {
                // Should return trimmed input if parsing fails
                expect(extractDomainFromInput('not a valid url')).toBe('not a valid url');
            });
        });

        describe('🟡 HIGH: Case Sensitivity', () => {
            it('should preserve domain case (URLs normalize, but input might not)', () => {
                expect(extractDomainFromInput('https://EXAMPLE.COM')).toBe('example.com'); // URL API normalizes
            });

            it('should preserve plain domain case', () => {
                expect(extractDomainFromInput('EXAMPLE.COM')).toBe('EXAMPLE.COM'); // No URL parsing
            });

            it('should handle mixed case URLs', () => {
                expect(extractDomainFromInput('https://Example.Com/Path')).toBe('example.com');
            });
        });

        describe('🟡 HIGH: Protocol Variations', () => {
            it('should handle HTTPS protocol (uppercase)', () => {
                expect(extractDomainFromInput('HTTPS://example.com')).toBe('example.com');
            });

            it('should handle HTTP protocol (uppercase)', () => {
                expect(extractDomainFromInput('HTTP://example.com')).toBe('example.com');
            });

            it('should handle mixed case protocol', () => {
                expect(extractDomainFromInput('HtTpS://example.com')).toBe('example.com');
            });

            it('should parse ftp:// URLs (URL API supports it)', () => {
                // The URL API actually supports ftp:// and extracts hostname correctly
                const result = extractDomainFromInput('ftp://example.com');
                expect(result).toBe('example.com');
            });
        });

        describe('🔴 CRITICAL: Real-world Policy Simulator Scenarios', () => {
            it('should extract domain from pasted webpage URL', () => {
                expect(extractDomainFromInput('https://ads.doubleclick.net/tracking?id=12345')).toBe('ads.doubleclick.net');
            });

            it('should extract domain from social media URL', () => {
                expect(extractDomainFromInput('https://www.facebook.com/profile/123')).toBe('www.facebook.com');
            });

            it('should extract domain from CDN URL', () => {
                expect(extractDomainFromInput('https://cdn.example.com/assets/script.js')).toBe('cdn.example.com');
            });

            it('should extract domain from analytics URL', () => {
                expect(extractDomainFromInput('https://google-analytics.com/collect?v=1&tid=UA-12345')).toBe('google-analytics.com');
            });

            it('should handle domain typed directly', () => {
                expect(extractDomainFromInput('ads.google.com')).toBe('ads.google.com');
            });
        });

        describe('🔴 CRITICAL: Real-world Global Lookup Scenarios', () => {
            it('should extract domain from copied browser URL', () => {
                expect(extractDomainFromInput('https://www.example.com/products/item?sku=123')).toBe('www.example.com');
            });

            it('should handle apex domain lookup', () => {
                expect(extractDomainFromInput('example.com')).toBe('example.com');
            });

            it('should handle subdomain lookup', () => {
                expect(extractDomainFromInput('mail.example.com')).toBe('mail.example.com');
            });

            it('should extract from URL with tracking parameters', () => {
                expect(extractDomainFromInput('https://example.com/?utm_source=google&utm_medium=cpc')).toBe('example.com');
            });
        });

        describe('🟢 MEDIUM: Special Characters', () => {
            it('should handle domains with hyphens', () => {
                expect(extractDomainFromInput('my-awesome-site.com')).toBe('my-awesome-site.com');
                expect(extractDomainFromInput('https://my-awesome-site.com')).toBe('my-awesome-site.com');
            });

            it('should handle domains with numbers', () => {
                expect(extractDomainFromInput('cdn123.example.com')).toBe('cdn123.example.com');
            });

            it('should handle internationalized domain names (IDN)', () => {
                // Punycode representation
                expect(extractDomainFromInput('https://xn--e1afmkfd.xn--p1ai')).toBe('xn--e1afmkfd.xn--p1ai');
            });

            it('should handle URL with encoded characters', () => {
                expect(extractDomainFromInput('https://example.com/path%20with%20spaces')).toBe('example.com');
            });
        });

        describe('🟢 MEDIUM: Performance', () => {
            it('should handle very long URLs efficiently', () => {
                const longPath = '/very/long/path/'.repeat(100);
                const longUrl = `https://example.com${longPath}`;

                const start = performance.now();
                const result = extractDomainFromInput(longUrl);
                const end = performance.now();

                expect(result).toBe('example.com');
                expect(end - start).toBeLessThan(5); // Should be very fast
            });

            it('should handle many extractions efficiently', () => {
                const urls = [
                    'https://example1.com/path',
                    'https://example2.com?query=1',
                    'example3.com',
                    'https://example4.com:8080',
                    'example5.com/page'
                ];

                const start = performance.now();
                urls.forEach(url => extractDomainFromInput(url));
                const end = performance.now();

                expect(end - start).toBeLessThan(10);
            });
        });
    });

    describe('🔴 CRITICAL: Integration with Policy Simulator', () => {
        it('should work correctly in policy simulation flow', () => {
            // User pastes full URL from blocked page
            const userInput = 'https://ads.tracking.net/pixel?id=12345&ref=example.com';
            const domain = extractDomainFromInput(userInput);

            expect(domain).toBe('ads.tracking.net');
            // This domain would then be sent to the policy simulator API
        });

        it('should work correctly with direct domain input', () => {
            // User types domain directly
            const userInput = 'facebook.com';
            const domain = extractDomainFromInput(userInput);

            expect(domain).toBe('facebook.com');
        });

        it('should handle user copying URL from address bar', () => {
            // Browser includes protocol when copying
            const userInput = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
            const domain = extractDomainFromInput(userInput);

            expect(domain).toBe('www.youtube.com');
        });
    });

    describe('🔴 CRITICAL: Integration with Global Lookup', () => {
        it('should extract domain for DNS record lookup', () => {
            const userInput = 'https://mail.google.com/mail/';
            const domain = extractDomainFromInput(userInput);

            expect(domain).toBe('mail.google.com');
            // This domain would then be used for DNS record lookup
        });

        it('should handle apex domain for zone lookup', () => {
            const userInput = 'example.com';
            const domain = extractDomainFromInput(userInput);

            expect(domain).toBe('example.com');
        });

        it('should handle subdomain for specific record lookup', () => {
            const userInput = 'cdn.example.com';
            const domain = extractDomainFromInput(userInput);

            expect(domain).toBe('cdn.example.com');
        });
    });
});
