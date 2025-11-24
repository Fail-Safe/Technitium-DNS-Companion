// Domain list cache and policy simulation types

export interface PolicyReason {
    action: 'block' | 'allow' | 'none' | string;
    type: 'blocklist' | 'allowlist' | 'regex-blocklist' | 'regex-allowlist' | 'manual-blocked' | 'manual-allowed' | string;
    source: string;
    matchedPattern?: string;
}

export interface GroupPolicyResult {
    domain: string;
    groupName: string;
    evaluation: string;
    finalAction: 'blocked' | 'allowed' | 'none' | string;
    reasons: PolicyReason[];
}

export interface DomainListEntry {
    type: PolicyReason['type'];
    source: string;
    groupName?: string;
    groups?: string[]; // Groups that use this list (for URL-based lists)
    matchedPattern?: string;
    matchedDomain?: string; // The actual domain entry that matched (for wildcard matches like "pet" matching "uptime.kuma.pet")
}


export interface DomainCheckResult {
    domain: string;
    found: boolean;
    foundIn?: DomainListEntry[];
}

export interface ListMetadata {
    url: string;
    hash: string;
    domainCount: number;
    patternCount?: number;
    lineCount: number;
    commentCount: number;
    fetchedAt: string;
    errorMessage?: string;
    isRegex?: boolean;
}

export interface ListSearchResult {
    url: string;
    hash: string;
    matches: string[];
    totalDomains: number;
    isRegex?: boolean;
}

export interface DomainSource {
    url: string;
    groups: string[];
}

export interface AllDomainEntry {
    domain: string;
    type: 'allow' | 'block';
    sources: DomainSource[];
}

export interface AllDomainsResponse {
    lastRefreshed: string | null;
    domains: AllDomainEntry[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}
