/**
 * Domain validation utilities
 * Based on RFC 1123 domain name requirements
 */

export interface DomainValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Validates a domain name according to RFC 1123 rules:
 * - Must be 253 characters or less
 * - Each label (between dots) must be 63 characters or less
 * - Labels can only contain letters, numbers, and hyphens
 * - Labels cannot start or end with a hyphen
 * - Must have at least one character
 *
 * Also allows:
 * - Wildcard domains (*.example.com)
 * - Subdomains (sub.example.com)
 */
export function validateDomain(domain: string): DomainValidationResult {
    if (!domain || domain.trim().length === 0) {
        return { valid: false, error: 'Domain is required' };
    }

    const trimmed = domain.trim().toLowerCase();

    // Check total length
    if (trimmed.length > 253) {
        return { valid: false, error: 'Domain must be 253 characters or less' };
    }

    // Handle wildcard prefix
    let domainToValidate = trimmed;
    if (trimmed.startsWith('*.')) {
        domainToValidate = trimmed.slice(2);
    }

    // Split into labels
    const labels = domainToValidate.split('.');

    // Must have at least one label (TLD or domain.tld)
    if (labels.length === 0 || (labels.length === 1 && labels[0] === '')) {
        return { valid: false, error: 'Invalid domain format' };
    }

    // Validate each label
    for (let i = 0; i < labels.length; i++) {
        const label = labels[i];

        // Check label length
        if (label.length === 0) {
            return { valid: false, error: 'Domain contains empty label (consecutive dots)' };
        }
        if (label.length > 63) {
            return { valid: false, error: `Label "${label}" exceeds 63 characters` };
        }

        // Check for valid characters (letters, numbers, hyphens only)
        if (!/^[a-z0-9-]+$/.test(label)) {
            return { valid: false, error: `Label "${label}" contains invalid characters (only letters, numbers, and hyphens allowed)` };
        }

        // Labels cannot start or end with hyphen
        if (label.startsWith('-')) {
            return { valid: false, error: `Label "${label}" cannot start with a hyphen` };
        }
        if (label.endsWith('-')) {
            return { valid: false, error: `Label "${label}" cannot end with a hyphen` };
        }
    }

    // TLD (last label) should not be all numbers
    const tld = labels[labels.length - 1];
    if (/^\d+$/.test(tld)) {
        return { valid: false, error: 'Top-level domain cannot be all numbers' };
    }

    return { valid: true };
}

/**
 * Check if a domain is valid (strict validation)
 * Returns true if the domain passes full RFC 1123 validation
 */
export function isValidDomainOrWildcard(domain: string): boolean {
    return validateDomain(domain).valid;
}

/**
 * Check if a string looks like a domain (quick check for UI hints)
 * Less strict than full validation - just checks basic structure
 */
export function looksLikeDomain(input: string): boolean {
    if (!input || input.trim().length === 0) {
        return false;
    }

    const trimmed = input.trim().toLowerCase();

    // Has at least one dot and no spaces
    if (!trimmed.includes('.') || trimmed.includes(' ')) {
        return false;
    }

    // Doesn't start with a dot (unless wildcard)
    if (trimmed.startsWith('.') && !trimmed.startsWith('*.')) {
        return false;
    }

    // Doesn't end with a dot
    if (trimmed.endsWith('.')) {
        return false;
    }

    return true;
}
