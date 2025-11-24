import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Form Validation Tests
 * Tests for input validation, error messages, and submission flows
 * Ensures data integrity and prevents invalid inputs
 */

interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

class FormValidator {
    private errors: Map<string, string[]> = new Map();
    private warnings: Map<string, string[]> = new Map();

    // Domain validation (RFC 1123)
    validateDomain(domain: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!domain || domain.trim().length === 0) {
            errors.push('Domain is required');
        } else if (domain.length > 253) {
            errors.push('Domain must be 253 characters or less');
        } else if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(domain)) {
            errors.push('Invalid domain format');
        }

        // Warnings for suspicious patterns
        if (domain.includes('..')) {
            warnings.push('Domain contains consecutive dots');
        }
        if (domain.startsWith('-') || domain.endsWith('-')) {
            warnings.push('Domain label cannot start or end with hyphen');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // IPv4 validation
    validateIPv4(ip: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!ip || ip.trim().length === 0) {
            errors.push('IP address is required');
        } else {
            const parts = ip.split('.');

            if (parts.length !== 4) {
                errors.push('IPv4 must have 4 octets');
            } else {
                for (let i = 0; i < parts.length; i++) {
                    const octet = parseInt(parts[i], 10);

                    if (isNaN(octet) || octet < 0 || octet > 255) {
                        errors.push(`Octet ${i + 1} must be 0-255`);
                        break;
                    }
                }
            }
        }

        // Warnings
        if (ip === '0.0.0.0') {
            warnings.push('0.0.0.0 is not a valid unicast address');
        }
        if (ip === '255.255.255.255') {
            warnings.push('255.255.255.255 is broadcast address');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // CIDR notation validation
    validateCIDR(cidr: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!cidr || cidr.trim().length === 0) {
            errors.push('CIDR notation is required');
        } else {
            const [ip, prefix] = cidr.split('/');

            if (!ip) {
                errors.push('CIDR must include IP address');
            } else {
                const ipValidation = this.validateIPv4(ip);
                if (!ipValidation.valid) {
                    errors.push('Invalid IP address in CIDR');
                }
            }

            if (!prefix) {
                errors.push('CIDR must include prefix length');
            } else {
                const prefixNum = parseInt(prefix, 10);

                if (isNaN(prefixNum) || prefixNum < 0 || prefixNum > 32) {
                    errors.push('CIDR prefix must be 0-32');
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // Port validation
    validatePort(port: string | number): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        const portNum = typeof port === 'string' ? parseInt(port, 10) : port;

        if (!port || port.toString().trim().length === 0) {
            errors.push('Port is required');
        } else if (isNaN(portNum)) {
            errors.push('Port must be numeric');
        } else if (portNum < 1 || portNum > 65535) {
            errors.push('Port must be 1-65535');
        }

        // Warnings
        if (portNum < 1024) {
            warnings.push('Port below 1024 requires administrative privileges');
        }
        if (portNum === 53) {
            warnings.push('Port 53 is used by DNS (standard)');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // Email validation
    validateEmail(email: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!email || email.trim().length === 0) {
            errors.push('Email is required');
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errors.push('Invalid email format');
        } else if (email.length > 254) {
            errors.push('Email must be 254 characters or less');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // Group name validation
    validateGroupName(name: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!name || name.trim().length === 0) {
            errors.push('Group name is required');
        } else if (name.length > 64) {
            errors.push('Group name must be 64 characters or less');
        } else if (!/^[a-z0-9_\-. ]/i.test(name)) {
            errors.push('Group name contains invalid characters');
        }

        if (name.toLowerCase() === 'default') {
            warnings.push('Group named "default" may be confused with system default');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // Validate multiple domains at once
    validateDomainList(domains: string[]): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];
        const seen = new Set<string>();

        if (!domains || domains.length === 0) {
            errors.push('At least one domain is required');
            return { valid: false, errors, warnings };
        }

        domains.forEach((domain, index) => {
            const trimmed = domain.trim();

            if (trimmed.length === 0) {
                errors.push(`Domain ${index + 1} is empty`);
                return;
            }

            const validation = this.validateDomain(trimmed);

            if (!validation.valid) {
                errors.push(`Domain ${index + 1}: ${validation.errors[0]}`);
            }

            if (seen.has(trimmed.toLowerCase())) {
                warnings.push(`Domain ${index + 1} is a duplicate`);
            }

            seen.add(trimmed.toLowerCase());
        });

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // Cross-field validation
    validateIPAndPort(ip: string, port: string | number): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        const ipValidation = this.validateIPv4(ip);
        const portValidation = this.validatePort(port);

        errors.push(...ipValidation.errors, ...portValidation.errors);
        warnings.push(...ipValidation.warnings, ...portValidation.warnings);

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // Validate conditional forwarding rule
    validateForwardingRule(domain: string, ip: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!domain || !ip) {
            errors.push('Both domain and IP are required');
        } else {
            const domainValidation = this.validateDomain(domain);
            const ipValidation = this.validateIPv4(ip);

            if (!domainValidation.valid) {
                errors.push(`Invalid domain: ${domainValidation.errors[0]}`);
            }
            if (!ipValidation.valid) {
                errors.push(`Invalid IP: ${ipValidation.errors[0]}`);
            }

            warnings.push(...domainValidation.warnings, ...ipValidation.warnings);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // Validate zone name
    validateZoneName(name: string): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!name || name.trim().length === 0) {
            errors.push('Zone name is required');
        } else {
            const validation = this.validateDomain(name);
            if (!validation.valid) {
                errors.push(`Invalid zone name: ${validation.errors[0]}`);
            }
            warnings.push(...validation.warnings);
        }

        if (name.toLowerCase() === 'localhost') {
            warnings.push('localhost is reserved');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // String length validation
    validateLength(value: string, min: number, max: number, fieldName: string = 'Field'): ValidationResult {
        const errors: string[] = [];

        if (!value || value.trim().length < min) {
            errors.push(`${fieldName} must be at least ${min} characters`);
        } else if (value.length > max) {
            errors.push(`${fieldName} must be no more than ${max} characters`);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings: [],
        };
    }

    // Number range validation
    validateRange(value: number, min: number, max: number, fieldName: string = 'Value'): ValidationResult {
        const errors: string[] = [];

        if (isNaN(value)) {
            errors.push(`${fieldName} must be numeric`);
        } else if (value < min || value > max) {
            errors.push(`${fieldName} must be between ${min} and ${max}`);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings: [],
        };
    }

    // Required field validation
    validateRequired(value: string | number | boolean | string[], fieldName: string = 'Field'): ValidationResult {
        const errors: string[] = [];

        if (Array.isArray(value)) {
            if (value.length === 0) {
                errors.push(`${fieldName} is required`);
            }
        } else if (typeof value === 'string') {
            if (value.trim().length === 0) {
                errors.push(`${fieldName} is required`);
            }
        } else if (typeof value === 'boolean') {
            // Booleans are always valid if present
        } else if (typeof value === 'number') {
            // Numbers are valid if present (even 0)
        } else {
            errors.push(`${fieldName} is required`);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings: [],
        };
    }

    // Get all errors
    getErrors(): Map<string, string[]> {
        return this.errors;
    }

    // Clear all errors
    clearErrors(): void {
        this.errors.clear();
        this.warnings.clear();
    }
}

describe('Form Validation Tests', () => {
    let validator: FormValidator;

    beforeEach(() => {
        validator = new FormValidator();
    });

    describe('Domain Validation', () => {
        it('should validate correct domain', () => {
            const result = validator.validateDomain('example.com');

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should validate subdomain', () => {
            const result = validator.validateDomain('api.example.com');

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should validate domain with numbers', () => {
            const result = validator.validateDomain('host123.example.com');

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject empty domain', () => {
            const result = validator.validateDomain('');

            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Domain is required');
        });

        it('should reject domain with invalid characters', () => {
            const result = validator.validateDomain('host_name.com');

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('Invalid domain format');
        });

        it('should reject domain exceeding 253 characters', () => {
            const longDomain = 'a'.repeat(254) + '.com';
            const result = validator.validateDomain(longDomain);

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('253 characters');
        });

        it('should warn on consecutive dots', () => {
            const result = validator.validateDomain('ex..ample.com');

            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });

    describe('IPv4 Validation', () => {
        it('should validate correct IP address', () => {
            const result = validator.validateIPv4('192.168.1.1');

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should validate localhost IP', () => {
            const result = validator.validateIPv4('127.0.0.1');

            expect(result.valid).toBe(true);
        });

        it('should reject invalid octet (too high)', () => {
            const result = validator.validateIPv4('192.168.1.256');

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('0-255');
        });

        it('should reject invalid octet (negative)', () => {
            const result = validator.validateIPv4('192.168.-1.1');

            expect(result.valid).toBe(false);
        });

        it('should reject non-numeric octet', () => {
            const result = validator.validateIPv4('192.168.a.1');

            expect(result.valid).toBe(false);
        });

        it('should reject incomplete IP', () => {
            const result = validator.validateIPv4('192.168.1');

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('4 octets');
        });

        it('should reject empty IP', () => {
            const result = validator.validateIPv4('');

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('required');
        });

        it('should warn on 0.0.0.0', () => {
            const result = validator.validateIPv4('0.0.0.0');

            expect(result.warnings.length).toBeGreaterThan(0);
        });

        it('should warn on broadcast address', () => {
            const result = validator.validateIPv4('255.255.255.255');

            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });

    describe('CIDR Notation Validation', () => {
        it('should validate correct CIDR', () => {
            const result = validator.validateCIDR('192.168.1.0/24');

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should validate /32 CIDR', () => {
            const result = validator.validateCIDR('192.168.1.1/32');

            expect(result.valid).toBe(true);
        });

        it('should validate /0 CIDR', () => {
            const result = validator.validateCIDR('0.0.0.0/0');

            expect(result.valid).toBe(true);
            // Note: Warnings may or may not appear depending on CIDR validation order
        });

        it('should reject CIDR without prefix', () => {
            const result = validator.validateCIDR('192.168.1.0');

            expect(result.valid).toBe(false);
        });

        it('should reject CIDR with invalid prefix', () => {
            const result = validator.validateCIDR('192.168.1.0/33');

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('0-32');
        });

        it('should reject CIDR with invalid IP', () => {
            const result = validator.validateCIDR('192.168.1.256/24');

            expect(result.valid).toBe(false);
        });
    });

    describe('Port Validation', () => {
        it('should validate valid port', () => {
            const result = validator.validatePort('8080');

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should validate port 1', () => {
            const result = validator.validatePort(1);

            expect(result.valid).toBe(true);
        });

        it('should validate port 65535', () => {
            const result = validator.validatePort(65535);

            expect(result.valid).toBe(true);
        });

        it('should reject port 0', () => {
            const result = validator.validatePort(0);

            expect(result.valid).toBe(false);
        });

        it('should reject port > 65535', () => {
            const result = validator.validatePort(70000);

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('1-65535');
        });

        it('should reject non-numeric port', () => {
            const result = validator.validatePort('abc');

            expect(result.valid).toBe(false);
        });

        it('should warn on privileged port', () => {
            const result = validator.validatePort(80);

            expect(result.warnings.length).toBeGreaterThan(0);
        });

        it('should warn on DNS port', () => {
            const result = validator.validatePort(53);

            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });

    describe('Email Validation', () => {
        it('should validate correct email', () => {
            const result = validator.validateEmail('user@example.com');

            expect(result.valid).toBe(true);
        });

        it('should validate email with subdomain', () => {
            const result = validator.validateEmail('user@mail.example.com');

            expect(result.valid).toBe(true);
        });

        it('should reject email without @', () => {
            const result = validator.validateEmail('userexample.com');

            expect(result.valid).toBe(false);
        });

        it('should reject email without domain', () => {
            const result = validator.validateEmail('user@');

            expect(result.valid).toBe(false);
        });

        it('should reject email without TLD', () => {
            const result = validator.validateEmail('user@example');

            expect(result.valid).toBe(false);
        });
    });

    describe('Group Name Validation', () => {
        it('should validate correct group name', () => {
            const result = validator.validateGroupName('block-ads');

            expect(result.valid).toBe(true);
        });

        it('should validate group name with spaces', () => {
            const result = validator.validateGroupName('ads blocklist');

            expect(result.valid).toBe(true);
        });

        it('should reject empty group name', () => {
            const result = validator.validateGroupName('');

            expect(result.valid).toBe(false);
        });

        it('should reject group name exceeding 64 chars', () => {
            const longName = 'a'.repeat(65);
            const result = validator.validateGroupName(longName);

            expect(result.valid).toBe(false);
        });

        it('should warn on "default" group name', () => {
            const result = validator.validateGroupName('default');

            expect(result.warnings.length).toBeGreaterThan(0);
        });
    });

    describe('Domain List Validation', () => {
        it('should validate multiple domains', () => {
            const domains = ['example.com', 'test.com', 'api.example.com'];
            const result = validator.validateDomainList(domains);

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject empty list', () => {
            const result = validator.validateDomainList([]);

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('At least one domain');
        });

        it('should reject list with invalid domain', () => {
            const domains = ['example.com', 'invalid_domain.com'];
            const result = validator.validateDomainList(domains);

            expect(result.valid).toBe(false);
        });

        it('should warn on duplicate domains', () => {
            const domains = ['example.com', 'EXAMPLE.COM'];
            const result = validator.validateDomainList(domains);

            expect(result.warnings.length).toBeGreaterThan(0);
            expect(result.warnings[0]).toContain('duplicate');
        });

        it('should warn on empty domain in list', () => {
            const domains = ['example.com', ''];
            const result = validator.validateDomainList(domains);

            expect(result.valid).toBe(false);
        });
    });

    describe('Cross-Field Validation', () => {
        it('should validate IP and port together', () => {
            const result = validator.validateIPAndPort('192.168.1.1', '5380');

            expect(result.valid).toBe(true);
        });

        it('should reject invalid IP but valid port', () => {
            const result = validator.validateIPAndPort('999.999.999.999', '5380');

            expect(result.valid).toBe(false);
        });

        it('should reject valid IP but invalid port', () => {
            const result = validator.validateIPAndPort('192.168.1.1', '70000');

            expect(result.valid).toBe(false);
        });
    });

    describe('Forwarding Rule Validation', () => {
        it('should validate correct forwarding rule', () => {
            const result = validator.validateForwardingRule('internal.local', '192.168.1.1');

            expect(result.valid).toBe(true);
        });

        it('should reject invalid domain in rule', () => {
            const result = validator.validateForwardingRule('invalid_domain.local', '192.168.1.1');

            expect(result.valid).toBe(false);
        });

        it('should reject invalid IP in rule', () => {
            const result = validator.validateForwardingRule('internal.local', '999.999.999.999');

            expect(result.valid).toBe(false);
        });

        it('should require both domain and IP', () => {
            const result = validator.validateForwardingRule('', '192.168.1.1');

            expect(result.valid).toBe(false);
        });
    });

    describe('Zone Name Validation', () => {
        it('should validate correct zone name', () => {
            const result = validator.validateZoneName('example.com');

            expect(result.valid).toBe(true);
        });

        it('should warn on localhost zone', () => {
            const result = validator.validateZoneName('localhost');

            expect(result.warnings.length).toBeGreaterThan(0);
        });

        it('should reject invalid zone name', () => {
            const result = validator.validateZoneName('invalid_zone.local');

            expect(result.valid).toBe(false);
        });
    });

    describe('General Validation Helpers', () => {
        it('should validate string length', () => {
            const result = validator.validateLength('hello', 1, 10, 'Name');

            expect(result.valid).toBe(true);
        });

        it('should reject string too short', () => {
            const result = validator.validateLength('', 1, 10, 'Name');

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('at least');
        });

        it('should reject string too long', () => {
            const result = validator.validateLength('x'.repeat(11), 1, 10, 'Name');

            expect(result.valid).toBe(false);
            expect(result.errors[0]).toContain('no more than');
        });

        it('should validate number range', () => {
            const result = validator.validateRange(5, 1, 10, 'Score');

            expect(result.valid).toBe(true);
        });

        it('should reject number below range', () => {
            const result = validator.validateRange(0, 1, 10, 'Score');

            expect(result.valid).toBe(false);
        });

        it('should reject number above range', () => {
            const result = validator.validateRange(11, 1, 10, 'Score');

            expect(result.valid).toBe(false);
        });

        it('should validate required string', () => {
            const result = validator.validateRequired('value', 'Field');

            expect(result.valid).toBe(true);
        });

        it('should reject empty required string', () => {
            const result = validator.validateRequired('', 'Field');

            expect(result.valid).toBe(false);
        });

        it('should validate required array', () => {
            const result = validator.validateRequired(['item1', 'item2'], 'Items');

            expect(result.valid).toBe(true);
        });

        it('should reject empty required array', () => {
            const result = validator.validateRequired([], 'Items');

            expect(result.valid).toBe(false);
        });

        it('should validate required number', () => {
            const result = validator.validateRequired(42, 'Count');

            expect(result.valid).toBe(true);
        });

        it('should validate required number including zero', () => {
            const result = validator.validateRequired(0, 'Count');

            expect(result.valid).toBe(true);
        });

        it('should validate required boolean', () => {
            const result = validator.validateRequired(true, 'Flag');

            expect(result.valid).toBe(true);
        });
    });

    describe('Error Clearing', () => {
        it('should clear stored errors', () => {
            validator.validateDomain('invalid_domain');
            let errors = validator.getErrors();

            validator.clearErrors();
            errors = validator.getErrors();

            expect(errors.size).toBe(0);
        });
    });
});
