/**
 * Regex Suggestion Logic Test Suite
 *
 * Tests for the regex suggestion feature in MultiGroupDomainEditor.tsx
 * that automatically suggests proper regex patterns with (\\.|^) prefix.
 *
 * CRITICAL: This was a bug fix in commit f3d990f where the suggestion was
 * duplicating prefixes when user input already started with ^ or \\.
 *
 * These tests ensure the prefix stripping logic works correctly and doesn't regress.
 */

import { describe, it, expect } from 'vitest';

/**
 * Duplicate the regex suggestion logic from MultiGroupDomainEditor.tsx
 * for isolated testing. This will be kept in sync with the actual implementation.
 */
function calculateRegexSuggestion(domain: string): string | null {
    if (!domain || !domain.trim()) return null;

    const hasEscapedDots = /\\\./.test(domain);
    const hasPrefix = /^\(\\.\|\^\)/.test(domain);
    const hasSuffix = domain.endsWith('$');

    if (hasEscapedDots && (!hasPrefix || !hasSuffix)) {
        // Strip leading ^ or \. before adding (\\.|^) prefix to avoid duplication
        // e.g., ^cdn\d\.editmysite\.com$ becomes cdn\d\.editmysite\.com$
        let suggested = domain;

        if (!hasPrefix) {
            // Remove leading ^ or \. patterns
            suggested = suggested.replace(/^\^/, '').replace(/^\\\./, '');
            suggested = `(\\.|^)${suggested}`;
        }
        if (!hasSuffix) {
            suggested = `${suggested}$`;
        }
        return suggested;
    }

    return null;
}

describe('Regex Suggestion Logic', () => {
    describe('calculateRegexSuggestion', () => {
        describe('🔴 CRITICAL: Prefix Stripping (Bug Fix from f3d990f)', () => {
            it('should strip leading ^ before adding (\\.|^) prefix', () => {
                const input = '^cdn\\d\\.editmysite\\.com$';
                const expected = '(\\.|^)cdn\\d\\.editmysite\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should strip leading \\. before adding (\\.|^) prefix', () => {
                const input = '\\.cdn\\.example\\.com';
                const expected = '(\\.|^)cdn\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should NOT duplicate prefix when user types ^', () => {
                // This was the original bug: (\\.|^)^cdn... instead of (\\.|^)cdn...
                const input = '^example\\.com';
                const result = calculateRegexSuggestion(input);
                expect(result).toBe('(\\.|^)example\\.com$');
                expect(result).not.toContain('(\\.|^)^'); // Should NOT have double prefix
            });

            it('should handle input starting with both ^ and escaped dots', () => {
                const input = '^test\\.example\\.com$';
                const expected = '(\\.|^)test\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should strip only the first ^ character', () => {
                const input = '^cdn^backup\\.example\\.com';
                const expected = '(\\.|^)cdn^backup\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });
        });

        describe('🔴 CRITICAL: Suffix Addition', () => {
            it('should add $ suffix when missing', () => {
                const input = 'example\\.com';
                const expected = '(\\.|^)example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should NOT add $ suffix when already present', () => {
                const input = 'example\\.com$';
                const expected = '(\\.|^)example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should add both prefix and suffix when both missing', () => {
                const input = 'cdn\\.example\\.com';
                const expected = '(\\.|^)cdn\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });
        });

        describe('🔴 CRITICAL: No Suggestion Cases', () => {
            it('should return null when pattern already has correct prefix and suffix', () => {
                const input = '(\\.|^)example\\.com$';
                expect(calculateRegexSuggestion(input)).toBeNull();
            });

            it('should return null when domain has no escaped dots', () => {
                const input = 'example.com';
                expect(calculateRegexSuggestion(input)).toBeNull();
            });

            it('should return null for plain domain names', () => {
                const input = 'google.com';
                expect(calculateRegexSuggestion(input)).toBeNull();
            });

            it('should return null for empty string', () => {
                expect(calculateRegexSuggestion('')).toBeNull();
            });

            it('should return null for whitespace only', () => {
                expect(calculateRegexSuggestion('   ')).toBeNull();
            });

            it('should return null when domain has no regex patterns', () => {
                const input = 'simple-domain.com';
                expect(calculateRegexSuggestion(input)).toBeNull();
            });
        });

        describe('🟡 HIGH: Real-world CDN Pattern Scenarios', () => {
            it('should handle CDN number patterns', () => {
                const input = '^cdn\\d+\\.example\\.com$';
                const expected = '(\\.|^)cdn\\d+\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should handle wildcard subdomain patterns', () => {
                const input = '.*\\.cdn\\.example\\.com';
                const expected = '(\\.|^).*\\.cdn\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should handle optional subdomain patterns', () => {
                const input = '^(www\\.)?example\\.com$';
                const expected = '(\\.|^)(www\\.)?example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should handle multiple TLD patterns', () => {
                const input = '^example\\.(com|net|org)$';
                const expected = '(\\.|^)example\\.(com|net|org)$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });
        });

        describe('🟡 HIGH: Edge Cases with Special Regex Syntax', () => {
            it('should handle character classes', () => {
                const input = '^[a-z]+\\.example\\.com$';
                const expected = '(\\.|^)[a-z]+\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should handle escaped special characters', () => {
                const input = '^test\\-api\\.example\\.com$';
                const expected = '(\\.|^)test\\-api\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should handle quantifiers', () => {
                const input = '^cdn[0-9]{1,3}\\.example\\.com$';
                const expected = '(\\.|^)cdn[0-9]{1,3}\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should handle lookahead assertions', () => {
                const input = '^(?!www).*\\.example\\.com$';
                const expected = '(\\.|^)(?!www).*\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should handle word boundaries', () => {
                const input = '\\bexample\\.com\\b';
                const expected = '(\\.|^)\\bexample\\.com\\b$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });
        });

        describe('🟡 HIGH: Partial Pattern Cases', () => {
            it('should add suffix only when prefix already correct', () => {
                const input = '(\\.|^)example\\.com';
                const expected = '(\\.|^)example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should add prefix only when suffix already present', () => {
                const input = 'example\\.com$';
                const expected = '(\\.|^)example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should strip ^ and add proper prefix when suffix present', () => {
                const input = '^example\\.com$';
                const expected = '(\\.|^)example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });
        });

        describe('🟡 HIGH: Complex Multi-Level Subdomains', () => {
            it('should handle deep subdomain patterns', () => {
                const input = '^api\\.v2\\.staging\\.example\\.com$';
                const expected = '(\\.|^)api\\.v2\\.staging\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should handle wildcard in middle of pattern', () => {
                const input = '^cdn.*\\.prod\\.example\\.com$';
                const expected = '(\\.|^)cdn.*\\.prod\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });

            it('should handle mixed literal and wildcard subdomains', () => {
                const input = '^[a-z]+\\.(?:staging|prod)\\.example\\.com$';
                const expected = '(\\.|^)[a-z]+\\.(?:staging|prod)\\.example\\.com$';
                expect(calculateRegexSuggestion(input)).toBe(expected);
            });
        });

        describe('🟢 MEDIUM: Whitespace Handling', () => {
            it('should return null for input with only spaces', () => {
                expect(calculateRegexSuggestion('    ')).toBeNull();
            });

            it('should return null for input with tabs', () => {
                expect(calculateRegexSuggestion('\t\t')).toBeNull();
            });

            it('should handle input with leading/trailing spaces', () => {
                // Note: In actual usage, input would be trimmed before this function
                // but testing behavior as-is
                const input = '  example\\.com  ';
                // Has escaped dots, so should suggest
                const result = calculateRegexSuggestion(input);
                expect(result).not.toBeNull();
                expect(result).toContain('example\\.com');
            });
        });

        describe('🔴 CRITICAL: User Workflow Integration', () => {
            it('should handle progressive typing: user types domain', () => {
                // User types: example.com
                expect(calculateRegexSuggestion('example.com')).toBeNull();
            });

            it('should handle progressive typing: user adds escaped dots', () => {
                // User types: example\.com
                const result = calculateRegexSuggestion('example\\.com');
                expect(result).toBe('(\\.|^)example\\.com$');
            });

            it('should handle progressive typing: user adds ^ prefix', () => {
                // User types: ^example\.com
                const result = calculateRegexSuggestion('^example\\.com');
                expect(result).toBe('(\\.|^)example\\.com$');
                // Should strip the ^ and add proper prefix
            });

            it('should handle progressive typing: user adds $ suffix', () => {
                // User types: ^example\.com$
                const result = calculateRegexSuggestion('^example\\.com$');
                expect(result).toBe('(\\.|^)example\\.com$');
            });

            it('should handle user copying regex from elsewhere with ^', () => {
                // User pastes: ^.*\.example\.com$
                const result = calculateRegexSuggestion('^.*\\.example\\.com$');
                expect(result).toBe('(\\.|^).*\\.example\\.com$');
            });

            it('should NOT suggest when user manually types correct pattern', () => {
                // User manually types the correct pattern
                const input = '(\\.|^)example\\.com$';
                expect(calculateRegexSuggestion(input)).toBeNull();
            });
        });

        describe('🔴 CRITICAL: Regression Prevention', () => {
            it('should NOT create pattern like (\\.|^)^ (the original bug)', () => {
                const inputs = [
                    '^cdn\\.example\\.com',
                    '^test\\.com$',
                    '^api\\.domain\\.org',
                ];

                inputs.forEach(input => {
                    const result = calculateRegexSuggestion(input);
                    if (result) {
                        expect(result).not.toContain('(\\.|^)^');
                        expect(result).not.toContain('(\\.|^)\\.');
                    }
                });
            });

            it('should produce valid regex patterns', () => {
                const inputs = [
                    '^example\\.com$',
                    'cdn\\d+\\.example\\.com',
                    '.*\\.test\\.org',
                ];

                inputs.forEach(input => {
                    const result = calculateRegexSuggestion(input);
                    if (result) {
                        // Should be able to create a RegExp from the suggestion
                        expect(() => new RegExp(result)).not.toThrow();
                    }
                });
            });

            it('should handle all test cases from original bug report', () => {
                // Original bug: ^cdn\d\.editmysite\.com$ was suggesting (\\.|^)^cdn...
                const input = '^cdn\\d\\.editmysite\\.com$';
                const result = calculateRegexSuggestion(input);

                expect(result).toBe('(\\.|^)cdn\\d\\.editmysite\\.com$');
                expect(result).not.toContain('^cdn'); // Should NOT have the original ^

                if (!result) {
                    throw new Error('Expected a non-null regex suggestion');
                }

                // Verify it's a valid regex
                const regex = new RegExp(result);
                expect(regex.test('cdn1.editmysite.com')).toBe(true);
                expect(regex.test('sub.cdn1.editmysite.com')).toBe(true);
            });
        });

        describe('🟢 MEDIUM: Performance', () => {
            it('should handle very long patterns efficiently', () => {
                const longPattern = '^' + 'subdomain\\.'.repeat(50) + 'example\\.com$';

                const start = performance.now();
                const result = calculateRegexSuggestion(longPattern);
                const end = performance.now();

                expect(result).toBeTruthy();
                expect(end - start).toBeLessThan(5); // Should be very fast
            });

            it('should handle many calculations efficiently', () => {
                const patterns = Array.from({ length: 100 }, (_, i) =>
                    `^cdn${i}\\.example\\.com$`
                );

                const start = performance.now();
                patterns.forEach(p => calculateRegexSuggestion(p));
                const end = performance.now();

                expect(end - start).toBeLessThan(50); // 100 calculations in < 50ms
            });
        });
    });
});
