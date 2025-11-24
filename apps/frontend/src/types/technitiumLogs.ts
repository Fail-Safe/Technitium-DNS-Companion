export interface TechnitiumQueryLogFilters {
    pageNumber?: number;
    entriesPerPage?: number;
    descendingOrder?: boolean;
    start?: string;
    end?: string;
    clientIpAddress?: string;
    protocol?: string;
    responseType?: string;
    rcode?: string;
    qname?: string;
    qtype?: string;
    qclass?: string;
    deduplicateDomains?: boolean;
    disableCache?: boolean;
}

export interface TechnitiumQueryLogEntry {
    rowNumber: number;
    timestamp: string;
    clientIpAddress?: string;
    clientName?: string;
    protocol?: string;
    responseType?: string;
    responseRtt?: number;
    rcode?: string;
    qname?: string;
    qtype?: string;
    qclass?: string;
    answer?: string;
}

export interface TechnitiumQueryLogPage {
    pageNumber: number;
    totalPages: number;
    totalEntries: number;
    totalMatchingEntries: number;
    hasMorePages?: boolean; // True if we hit fetch limit and there might be more data
    entries: TechnitiumQueryLogEntry[];
}

export interface TechnitiumCombinedQueryLogEntry extends TechnitiumQueryLogEntry {
    nodeId: string;
    baseUrl: string;
}

export interface TechnitiumNodeQueryLogEnvelope {
    nodeId: string;
    fetchedAt: string;
    data: TechnitiumQueryLogPage;
}

export interface TechnitiumCombinedNodeLogSnapshot {
    nodeId: string;
    baseUrl: string;
    fetchedAt: string;
    totalEntries?: number;
    totalPages?: number;
    error?: string;
}

export interface TechnitiumCombinedQueryLogPage {
    fetchedAt: string;
    pageNumber: number;
    entriesPerPage: number;
    totalPages: number;
    totalEntries: number;
    totalMatchingEntries: number;
    hasMorePages?: boolean; // True if we hit fetch limit and there might be more data
    duplicatesRemoved?: number; // Number of duplicate entries removed by deduplication
    descendingOrder: boolean;
    entries: TechnitiumCombinedQueryLogEntry[];
    nodes: TechnitiumCombinedNodeLogSnapshot[];
}
