/**
 * Types for predefined block lists catalog
 */

export interface BlockListEntry {
    id: string;
    name: string;
    url: string;
    description: string;
    category: 'multi' | 'security' | 'content';
    recommended: boolean;
}

export interface BlockListProvider {
    name: string;
    website: string;
    description: string;
    lists: BlockListEntry[];
}

export interface BlockListCatalog {
    version: string;
    lastUpdated: string;
    sourceUrl: string;
    lists: {
        [providerId: string]: BlockListProvider;
    };
}

export interface BlockListUpdate {
    type: 'new' | 'changed' | 'removed';
    providerId: string;
    listId: string;
    oldEntry?: BlockListEntry;
    newEntry?: BlockListEntry;
}

export interface BlockListUpdateCheck {
    hasUpdates: boolean;
    currentVersion: string;
    latestVersion: string;
    lastChecked: string;
    updates: BlockListUpdate[];
}
