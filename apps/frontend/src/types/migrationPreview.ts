/**
 * Types for migration/import configuration editors.
 * These are used by DhcpReservationsEditor and DnsOverridesEditor components.
 */

export interface MigrationDhcpReservation {
    mac: string;
    ips: string[];
    hostnames: string[];
    leaseTimes: string[];
    sources?: string[];
    static?: boolean;
    scope?: string;
}

export interface MigrationDnsOverride {
    host: string;
    ipv4: string[];
    ipv6: string[];
    sources?: string[];
}
