import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faMinus, faPencil } from '@fortawesome/free-solid-svg-icons';
import type { AdvancedBlockingConfig, AdvancedBlockingUrlEntry } from '../../types/advancedBlocking';

interface ListSourceEditorProps {
    config?: AdvancedBlockingConfig;
    onSave: (config: AdvancedBlockingConfig) => Promise<void>;
    onDirtyChange?: (isDirty: boolean) => void;
    disabled?: boolean;
}

type ListType = 'allowListUrls' | 'blockListUrls' | 'regexAllowListUrls' | 'regexBlockListUrls' | 'adblockListUrls';

interface ListTypeConfig {
    key: ListType;
    label: string;
    placeholder: string;
    hint?: string;
}

const LIST_TYPES: ListTypeConfig[] = [
    {
        key: 'allowListUrls',
        label: 'Allowlist URLs',
        placeholder: 'https://example.com/allowlist.txt',
        hint: 'URLs containing domains to allow',
    },
    {
        key: 'blockListUrls',
        label: 'Blocklist URLs',
        placeholder: 'https://example.com/blocklist.txt',
        hint: 'URLs containing domains to block',
    },
    {
        key: 'regexAllowListUrls',
        label: 'Regex Allowlist URLs',
        placeholder: 'https://example.com/regex-allow.txt',
        hint: 'URLs containing regex patterns to allow',
    },
    {
        key: 'regexBlockListUrls',
        label: 'Regex Blocklist URLs',
        placeholder: 'https://example.com/regex-block.txt',
        hint: 'URLs containing regex patterns to block',
    },
    {
        key: 'adblockListUrls',
        label: 'Adblock Lists',
        placeholder: 'https://example.com/adblock-filters.txt',
        hint: 'URLs containing adblock-style filters',
    },
];

// Helper function to split URL into origin and path
function splitUrl(url: string): { origin: string; path: string } {
    try {
        const urlObj = new URL(url);
        const origin = urlObj.origin; // e.g., "https://cdn.jsdelivr.net"
        const path = url.substring(origin.length); // Everything after the origin
        return { origin, path };
    } catch {
        // If URL parsing fails, treat entire string as origin
        return { origin: url, path: '' };
    }
}

// Component to render URL with emphasized origin
function UrlDisplay({ url }: { url: string }) {
    const { origin, path } = splitUrl(url);
    return (
        <span className="multi-group-editor__url-text">
            <span className="multi-group-editor__url-origin">{origin}</span>
            {path && <span className="multi-group-editor__url-path">{path}</span>}
        </span>
    );
}

// Validate URL format
function isValidUrl(urlString: string): boolean {
    try {
        const url = new URL(urlString);
        // Must be http or https
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

export function ListSourceEditor({ config, onSave, onDirtyChange, disabled }: ListSourceEditorProps) {
    // Generate unique IDs for form elements
    const refreshIntervalId = useId();

    // Helper function to deep clone config
    const cloneConfig = useCallback((cfg: AdvancedBlockingConfig): AdvancedBlockingConfig => {
        return JSON.parse(JSON.stringify(cfg));
    }, []);

    // Draft config state - clone the incoming config for editing
    const [draftConfig, setDraftConfig] = useState<AdvancedBlockingConfig | undefined>(() =>
        config ? cloneConfig(config) : undefined,
    );

    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();
    const [activeListType, setActiveListType] = useState<ListType>('blockListUrls');
    const [searchFilter, setSearchFilter] = useState('');
    const [urlToRemove, setUrlToRemove] = useState<string | null>(null);
    const [bulkMode, setBulkMode] = useState(false);
    const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
    const [urlsToDelete, setUrlsToDelete] = useState<string[] | null>(null);
    const [editingUrl, setEditingUrl] = useState<{ url: string; groupName?: string } | null>(null);
    const [editDraft, setEditDraft] = useState('');
    const [validationError, setValidationError] = useState<string | undefined>();
    const [showChangesSummary, setShowChangesSummary] = useState(false);
    const hasInitializedRef = useRef(false);

    // Update draft config when incoming config changes
    useEffect(() => {
        if (config) {
            setDraftConfig(cloneConfig(config));
        } else {
            setDraftConfig(undefined);
        }
    }, [config, cloneConfig]);

    // Check if draft differs from original
    const isDirty = useMemo(() => {
        if (!config || !draftConfig) return false;
        return JSON.stringify(config) !== JSON.stringify(draftConfig);
    }, [config, draftConfig]);

    // Compute pending changes for display
    const pendingChanges = useMemo(() => {
        if (!config || !draftConfig || !isDirty) return [];

        const changes: Array<{
            type: 'added' | 'removed' | 'modified';
            listType: string;
            groupName?: string;
            url?: string;
            field?: string;
            oldValue?: string | number;
            newValue?: string | number;
        }> = [];

        // Check for global setting changes
        if (config.blockingAnswerTtl !== draftConfig.blockingAnswerTtl) {
            changes.push({
                type: 'modified',
                listType: 'Global Settings',
                field: 'Blocking answer TTL',
                oldValue: config.blockingAnswerTtl ?? 'not set',
                newValue: draftConfig.blockingAnswerTtl ?? 'not set',
            });
        }

        if (config.blockListUrlUpdateIntervalHours !== draftConfig.blockListUrlUpdateIntervalHours) {
            changes.push({
                type: 'modified',
                listType: 'Global Settings',
                field: 'List source refresh interval',
                oldValue: config.blockListUrlUpdateIntervalHours ?? 'not set',
                newValue: draftConfig.blockListUrlUpdateIntervalHours ?? 'not set',
            });
        }

        // Helper to extract URL string from entry (could be string or object)
        const getUrlString = (entry: AdvancedBlockingUrlEntry): string => {
            return typeof entry === 'string' ? entry : entry.url;
        };

        // For each group, compare each list type
        const processedGroups = new Set<string>();

        // Check draft groups (for additions)
        draftConfig.groups.forEach(draftGroup => {
            processedGroups.add(draftGroup.name);
            const originalGroup = config.groups.find(g => g.name === draftGroup.name);

            LIST_TYPES.forEach(listType => {
                const draftUrls = new Set(
                    (draftGroup[listType.key] as AdvancedBlockingUrlEntry[] || []).map(getUrlString)
                );
                const originalUrls = new Set(
                    originalGroup
                        ? (originalGroup[listType.key] as AdvancedBlockingUrlEntry[] || []).map(getUrlString)
                        : []
                );

                // Find added URLs
                draftUrls.forEach(url => {
                    if (!originalUrls.has(url)) {
                        changes.push({
                            type: 'added',
                            listType: listType.label,
                            groupName: draftGroup.name,
                            url
                        });
                    }
                });

                // Find removed URLs
                originalUrls.forEach(url => {
                    if (!draftUrls.has(url)) {
                        changes.push({
                            type: 'removed',
                            listType: listType.label,
                            groupName: draftGroup.name,
                            url
                        });
                    }
                });
            });
        });

        // Check original groups that might not be in draft
        config.groups.forEach(originalGroup => {
            if (processedGroups.has(originalGroup.name)) return;

            LIST_TYPES.forEach(listType => {
                const originalUrls = (originalGroup[listType.key] as AdvancedBlockingUrlEntry[] || []).map(getUrlString);
                originalUrls.forEach(url => {
                    changes.push({
                        type: 'removed',
                        listType: listType.label,
                        groupName: originalGroup.name,
                        url
                    });
                });
            });
        });

        return changes;
    }, [config, draftConfig, isDirty]);

    // Notify parent of dirty state changes
    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    const groups = useMemo(() => draftConfig?.groups ?? [], [draftConfig]);

    // Auto-select all groups on first load only
    useEffect(() => {
        if (groups.length > 0 && !hasInitializedRef.current) {
            setSelectedGroups(new Set(groups.map((g) => g.name)));
            hasInitializedRef.current = true;
        }
    }, [groups]);

    const toggleGroup = useCallback((groupName: string) => {
        setSelectedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupName)) {
                next.delete(groupName);
            } else {
                next.add(groupName);
            }
            return next;
        });
    }, []);

    const selectAllGroups = useCallback(() => {
        setSelectedGroups(new Set(groups.map((g) => g.name)));
    }, [groups]);

    const clearAllGroups = useCallback(() => {
        setSelectedGroups(new Set());
    }, []);

    // Get URLs for a specific list type from a group
    const getGroupUrls = useCallback((groupName: string, listType: ListType): string[] => {
        const group = groups.find((g) => g.name === groupName);
        if (!group) return [];

        const entries = group[listType] as AdvancedBlockingUrlEntry[];
        return entries.map((entry) => (typeof entry === 'string' ? entry : entry.url));
    }, [groups]);

    // Calculate intersection (URLs in ALL selected groups)
    const intersection = useMemo(() => {
        if (selectedGroups.size === 0) return [];

        const selectedGroupNames = Array.from(selectedGroups);
        const firstGroupUrls = getGroupUrls(selectedGroupNames[0], activeListType);

        return firstGroupUrls.filter((url) =>
            selectedGroupNames.every((groupName) => {
                const groupUrls = getGroupUrls(groupName, activeListType);
                return groupUrls.includes(url);
            }),
        );
    }, [selectedGroups, activeListType, getGroupUrls]);

    // Calculate differences (URLs unique to specific groups)
    const differences = useMemo(() => {
        const result: Record<string, string[]> = {};

        selectedGroups.forEach((groupName) => {
            const groupUrls = getGroupUrls(groupName, activeListType);
            const uniqueUrls = groupUrls.filter((url) => !intersection.includes(url));
            if (uniqueUrls.length > 0) {
                result[groupName] = uniqueUrls;
            }
        });

        return result;
    }, [selectedGroups, activeListType, intersection, getGroupUrls]);

    // URL selection callbacks (depend on intersection)
    const toggleUrlSelection = useCallback((url: string) => {
        setSelectedUrls((prev) => {
            const next = new Set(prev);
            if (next.has(url)) {
                next.delete(url);
            } else {
                next.add(url);
            }
            return next;
        });
    }, []);

    const selectAllUrls = useCallback(() => {
        setSelectedUrls(new Set(intersection));
    }, [intersection]);

    const deselectAllUrls = useCallback(() => {
        setSelectedUrls(new Set());
    }, []);

    // Filter URLs based on search
    const filteredIntersection = useMemo(() => {
        if (!searchFilter) return intersection;
        const lower = searchFilter.toLowerCase();
        return intersection.filter((url) => url.toLowerCase().includes(lower));
    }, [intersection, searchFilter]);

    const filteredDifferences = useMemo(() => {
        if (!searchFilter) return differences;
        const lower = searchFilter.toLowerCase();
        const result: Record<string, string[]> = {};

        Object.entries(differences).forEach(([groupName, urls]) => {
            const filtered = urls.filter((url) => url.toLowerCase().includes(lower));
            if (filtered.length > 0) {
                result[groupName] = filtered;
            }
        });

        return result;
    }, [differences, searchFilter]);

    const addUrlToAllGroups = useCallback(
        async (url: string) => {
            if (!draftConfig) return;

            const trimmed = url.trim();
            if (!trimmed) {
                setError('URL cannot be empty');
                return;
            }

            // Validate URL format
            if (!isValidUrl(trimmed)) {
                setError('Invalid URL format. Must be a valid http:// or https:// URL');
                return;
            }

            setError(undefined);

            const updatedConfig = cloneConfig(draftConfig);
            updatedConfig.groups = updatedConfig.groups.map((group) => {
                if (!selectedGroups.has(group.name)) return group;

                const existingUrls = getGroupUrls(group.name, activeListType);
                if (existingUrls.includes(trimmed)) return group;

                return {
                    ...group,
                    [activeListType]: [...(group[activeListType] as AdvancedBlockingUrlEntry[]), trimmed],
                };
            });

            setDraftConfig(updatedConfig);
        },
        [draftConfig, selectedGroups, activeListType, getGroupUrls, cloneConfig],
    );

    const addBulkUrlsToAllGroups = useCallback(
        async (urlsText: string) => {
            if (!draftConfig) return;

            // Split by newlines and filter out empty lines
            const urls = urlsText
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0);

            if (urls.length === 0) {
                setError('No URLs provided');
                return;
            }

            // Validate all URLs first
            const invalidUrls = urls.filter((url) => !isValidUrl(url));
            if (invalidUrls.length > 0) {
                setError(
                    `Invalid URLs found (${invalidUrls.length}/${urls.length}): ${invalidUrls.slice(0, 3).join(', ')}${invalidUrls.length > 3 ? '...' : ''}`,
                );
                return;
            }

            setError(undefined);

            const updatedConfig = cloneConfig(draftConfig);
            let addedCount = 0;
            let skippedCount = 0;

            updatedConfig.groups = updatedConfig.groups.map((group) => {
                if (!selectedGroups.has(group.name)) return group;

                const existingUrls = getGroupUrls(group.name, activeListType);
                const newUrls = urls.filter((url) => {
                    if (existingUrls.includes(url)) {
                        skippedCount++;
                        return false;
                    }
                    addedCount++;
                    return true;
                });

                if (newUrls.length === 0) return group;

                return {
                    ...group,
                    [activeListType]: [...(group[activeListType] as AdvancedBlockingUrlEntry[]), ...newUrls],
                };
            });

            setDraftConfig(updatedConfig);

            // Show success message with stats
            if (skippedCount > 0) {
                setError(`Added ${addedCount} URLs, skipped ${skippedCount} duplicates`);
            }
        },
        [draftConfig, selectedGroups, activeListType, getGroupUrls, cloneConfig],
    );

    const removeUrlFromAllGroups = useCallback(
        async (url: string) => {
            if (!draftConfig) return;

            setError(undefined);

            const updatedConfig = cloneConfig(draftConfig);
            updatedConfig.groups = updatedConfig.groups.map((group) => {
                if (!selectedGroups.has(group.name)) return group;

                const filtered = (group[activeListType] as AdvancedBlockingUrlEntry[]).filter((entry) => {
                    const entryUrl = typeof entry === 'string' ? entry : entry.url;
                    return entryUrl !== url;
                });

                return {
                    ...group,
                    [activeListType]: filtered,
                };
            });

            setDraftConfig(updatedConfig);
        },
        [draftConfig, selectedGroups, activeListType, cloneConfig],
    );

    const removeUrlFromSpecificGroup = useCallback(
        async (url: string, groupName: string) => {
            if (!draftConfig) return;

            setError(undefined);

            const updatedConfig = cloneConfig(draftConfig);
            updatedConfig.groups = updatedConfig.groups.map((group) => {
                if (group.name !== groupName) return group;

                const filtered = (group[activeListType] as AdvancedBlockingUrlEntry[]).filter((entry) => {
                    const entryUrl = typeof entry === 'string' ? entry : entry.url;
                    return entryUrl !== url;
                });

                return {
                    ...group,
                    [activeListType]: filtered,
                };
            });

            setDraftConfig(updatedConfig);
        },
        [draftConfig, activeListType, cloneConfig],
    );

    const deleteSelectedUrls = useCallback(
        async (urls: string[]) => {
            if (!draftConfig || urls.length === 0) return;

            setError(undefined);

            const updatedConfig = cloneConfig(draftConfig);
            updatedConfig.groups = updatedConfig.groups.map((group) => {
                if (!selectedGroups.has(group.name)) return group;

                const filtered = (group[activeListType] as AdvancedBlockingUrlEntry[]).filter((entry) => {
                    const entryUrl = typeof entry === 'string' ? entry : entry.url;
                    return !urls.includes(entryUrl);
                });

                return {
                    ...group,
                    [activeListType]: filtered,
                };
            });

            setDraftConfig(updatedConfig);
            setSelectedUrls(new Set()); // Clear selection after delete
            setUrlsToDelete(null); // Close confirmation modal
        },
        [draftConfig, selectedGroups, activeListType, cloneConfig],
    );

    // Edit handlers
    const handleStartEdit = useCallback((url: string, groupName?: string) => {
        setEditingUrl({ url, groupName });
        setEditDraft(url);
        setValidationError(undefined);
    }, []);

    const handleCancelEdit = useCallback(() => {
        setEditingUrl(null);
        setEditDraft('');
        setValidationError(undefined);
    }, []);

    const handleSaveEdit = useCallback(
        async () => {
            if (!draftConfig || !editDraft.trim() || !editingUrl) return;

            const { url: oldUrl, groupName } = editingUrl;
            const newUrl = editDraft.trim();

            // Validate URL format
            if (!isValidUrl(newUrl)) {
                setValidationError('Please enter a valid HTTP or HTTPS URL');
                return;
            }

            // Check for duplicates in the target group(s)
            const targetGroups = groupName
                ? draftConfig.groups.filter((g) => g.name === groupName)
                : draftConfig.groups.filter((g) => selectedGroups.has(g.name));

            const urlExists = targetGroups.some((group) => {
                return (group[activeListType] as AdvancedBlockingUrlEntry[]).some((entry) => {
                    const entryUrl = typeof entry === 'string' ? entry : entry.url;
                    return entryUrl === newUrl && entryUrl !== oldUrl;
                });
            });

            if (urlExists) {
                setValidationError('This URL already exists in the target group(s)');
                return;
            }

            setError(undefined);

            const updatedConfig = cloneConfig(draftConfig);
            updatedConfig.groups = updatedConfig.groups.map((group) => {
                // Only update the specific group if groupName is provided
                if (groupName && group.name !== groupName) return group;
                // Or update all selected groups if no specific group
                if (!groupName && !selectedGroups.has(group.name)) return group;

                const updated = (group[activeListType] as AdvancedBlockingUrlEntry[]).map((entry) => {
                    const entryUrl = typeof entry === 'string' ? entry : entry.url;
                    if (entryUrl === oldUrl) {
                        // Preserve entry structure (string or object)
                        return typeof entry === 'string' ? newUrl : { ...entry, url: newUrl };
                    }
                    return entry;
                });

                return {
                    ...group,
                    [activeListType]: updated,
                };
            });

            setDraftConfig(updatedConfig);
            setEditingUrl(null);
            setEditDraft('');
            setValidationError(undefined);
        },
        [draftConfig, selectedGroups, activeListType, editDraft, editingUrl, cloneConfig],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                void handleSaveEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handleCancelEdit();
            }
        },
        [handleSaveEdit, handleCancelEdit],
    );

    const activeListConfig = LIST_TYPES.find((lt) => lt.key === activeListType)!;

    return (
        <section className="configuration-editor configuration-editor--stacked">
            {/* <header className="configuration-editor__header">
                <div>
                    <h2>List Management</h2>
                    <p>Manage blocklist URLs, allowlist URLs, and filter lists across multiple groups.</p>
                </div>
            </header> */}

            {!config ? (
                <div className="configuration-editor__placeholder">
                    <p>No configuration loaded.</p>
                </div>
            ) : (
                <>
                    {/* Global Settings */}
                    <div className="group-management__section">
                        <h3>Global Settings</h3>
                        <div className="field-group">
                            <div className="field-group__control" style={{ maxWidth: '300px' }}>
                                    <label htmlFor="blockingAnswerTtl">Blocking answer TTL (seconds)</label>
                                    <input
                                        id="blockingAnswerTtl"
                                        name="blockingAnswerTtl"
                                        type="number"
                                        min="0"
                                        style={{ width: '100px' }}
                                        placeholder="10"
                                        value={draftConfig?.blockingAnswerTtl ?? ''}
                                        onChange={(event) => {
                                            const raw = event.target.value.trim();
                                            setDraftConfig((prev) => {
                                                if (!prev) {
                                                    return prev;
                                                }

                                                return {
                                                    ...prev,
                                                    blockingAnswerTtl: raw ? Number(raw) : undefined,
                                                };
                                            });
                                        }}
                                        disabled={disabled || saving}
                                    />
                                    <small className="field-hint">
                                        TTL value used in blocked DNS responses (default: 10 seconds)
                                    </small>
                                </div>
                                <div className="field-group__control" style={{ maxWidth: '300px' }}>
                                <label htmlFor={refreshIntervalId}>List source refresh interval (hours)</label>
                                <input
                                    id={refreshIntervalId}
                                    name="listRefreshHours"
                                    type="number"
                                    min="0"
                                    max="168"
                                    style={{ width: '100px' }}
                                    value={draftConfig?.blockListUrlUpdateIntervalHours ?? ''}
                                    onChange={(event) => {
                                        const raw = event.target.value;
                                        setDraftConfig((prev) => {
                                            if (!prev) {
                                                return prev;
                                            }

                                            return {
                                                ...prev,
                                                blockListUrlUpdateIntervalHours: raw
                                                    ? Number(raw)
                                                    : undefined,
                                            };
                                        });
                                    }}
                                    disabled={disabled || saving}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Group Selection */}
                    <div className="multi-group-editor__group-selection">
                        <div className="multi-group-editor__group-header">
                            <h3>Select Groups ({selectedGroups.size} selected)</h3>
                            <div className="multi-group-editor__group-actions">
                                <button
                                    type="button"
                                    className="button button--sm button--secondary"
                                    onClick={selectAllGroups}
                                    disabled={disabled || saving}
                                >
                                    Select All
                                </button>
                                <button
                                    type="button"
                                    className="button button--sm button--secondary"
                                    onClick={clearAllGroups}
                                    disabled={disabled || saving || selectedGroups.size === 0}
                                >
                                    Clear
                                </button>
                            </div>
                        </div>
                        <div className="multi-group-editor__groups">
                            {groups.map((group) => (
                                <label key={group.name} className="multi-group-editor__group-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={selectedGroups.has(group.name)}
                                        name={`group-${group.name}`}
                                        onChange={() => toggleGroup(group.name)}
                                        disabled={disabled || saving}
                                    />
                                    <span>{group.name}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* List Type Selector */}
                    <div className="list-source-editor__type-selector">
                        <h3>List Type</h3>
                        <div className="list-source-editor__type-buttons">
                            {LIST_TYPES.map((listType) => (
                                <button
                                    key={listType.key}
                                    type="button"
                                    className={`list-source-editor__type-button ${activeListType === listType.key ? 'list-source-editor__type-button--active' : ''
                                        }`}
                                    onClick={() => setActiveListType(listType.key)}
                                    disabled={disabled || saving}
                                >
                                    {listType.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {selectedGroups.size === 0 ? (
                        <div className="multi-group-editor__placeholder">
                            <p>Select at least one group to view and manage {activeListConfig.label.toLowerCase()}.</p>
                        </div>
                    ) : (
                        <>
                            {/* Search Filter */}
                            <div className="multi-group-editor__search">
                                <input
                                    name="searchFilter"
                                    type="text"
                                    placeholder={`Search ${activeListConfig.label.toLowerCase()}...`}
                                    value={searchFilter}
                                    onChange={(e) => setSearchFilter(e.target.value)}
                                    disabled={disabled || saving}
                                />
                                {searchFilter && (
                                    <button
                                        type="button"
                                        className="multi-group-editor__search-clear"
                                        onClick={() => setSearchFilter('')}
                                        disabled={disabled || saving}
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>

                            {/* Intersection Section */}
                            <div className="multi-group-editor__section">
                                <div className="multi-group-editor__section-header">
                                    <div>
                                        <h3>
                                            Common URLs{' '}
                                            <span className="multi-group-editor__count">
                                                ({filteredIntersection.length})
                                            </span>
                                        </h3>
                                        <p className="multi-group-editor__hint">
                                            URLs present in {selectedGroups.size} selected group
                                            {selectedGroups.size === 1 ? '' : 's'}
                                        </p>
                                    </div>
                                    {filteredIntersection.length > 0 && (
                                        <div className="multi-group-editor__selection-controls">
                                            <button
                                                type="button"
                                                className="button button--sm button--secondary"
                                                onClick={selectAllUrls}
                                                disabled={disabled || saving || selectedUrls.size === filteredIntersection.length}
                                            >
                                                Select All
                                            </button>
                                            <button
                                                type="button"
                                                className="button button--sm button--secondary"
                                                onClick={deselectAllUrls}
                                                disabled={disabled || saving || selectedUrls.size === 0}
                                            >
                                                Deselect All
                                            </button>
                                            {selectedUrls.size > 0 && (
                                                <button
                                                    type="button"
                                                    className="button button--sm button--danger"
                                                    onClick={() => setUrlsToDelete(Array.from(selectedUrls))}
                                                    disabled={disabled || saving}
                                                >
                                                    Delete Selected ({selectedUrls.size})
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {filteredIntersection.length === 0 ? (
                                    <p className="multi-group-editor__empty">
                                        {searchFilter
                                            ? 'No common URLs match your search.'
                                            : 'No URLs are common to all selected groups.'}
                                    </p>
                                ) : (
                                    <ul className="multi-group-editor__url-list">
                                        {filteredIntersection.map((url) => {
                                            const isEditing = editingUrl?.url === url && !editingUrl?.groupName;
                                            return (
                                                <li
                                                    key={url}
                                                    className={`multi-group-editor__url-item ${isEditing ? 'multi-group-editor__url-item--editing' : ''
                                                        }`}
                                                >
                                                    {isEditing ? (
                                                        <>
                                                            <div className="multi-group-editor__edit-form">
                                                                <input
                                                                    type="text"
                                                                    value={editDraft}
                                                                    onChange={(e) => {
                                                                        setEditDraft(e.target.value);
                                                                        setValidationError(undefined);
                                                                    }}
                                                                    onKeyDown={handleKeyDown}
                                                                    className="multi-group-editor__edit-input"
                                                                    placeholder="https://example.com/list.txt"
                                                                    disabled={disabled || saving}
                                                                    autoFocus
                                                                />
                                                            </div>
                                                            <div className="multi-group-editor__edit-actions">
                                                                {validationError && (
                                                                    <span className="multi-group-editor__edit-error">
                                                                        {validationError}
                                                                    </span>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSaveEdit()}
                                                                    className="multi-group-editor__edit-save"
                                                                    disabled={disabled || saving || !editDraft.trim()}
                                                                    title="Save changes (Enter)"
                                                                >
                                                                    Save
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={handleCancelEdit}
                                                                    className="multi-group-editor__edit-cancel"
                                                                    disabled={disabled || saving}
                                                                    title="Cancel editing (Escape)"
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <label className="multi-group-editor__url-checkbox-label">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedUrls.has(url)}
                                                                    name={`select-url-${url}`}
                                                                    onChange={() => toggleUrlSelection(url)}
                                                                    disabled={disabled || saving}
                                                                    className="multi-group-editor__url-checkbox"
                                                                />
                                                                <UrlDisplay url={url} />
                                                            </label>
                                                            <div className="multi-group-editor__url-actions">
                                                                <button
                                                                    type="button"
                                                                    className="multi-group-editor__url-edit"
                                                                    onClick={() => handleStartEdit(url)}
                                                                    disabled={disabled || saving}
                                                                    title="Edit URL"
                                                                >
                                                                    ✎
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="multi-group-editor__url-remove"
                                                                    onClick={() => setUrlToRemove(url)}
                                                                    disabled={disabled || saving}
                                                                    title="Remove from all selected groups"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        </>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>

                            {/* Differences Section */}
                            {Object.keys(filteredDifferences).length > 0 && (
                                <div className="multi-group-editor__section">
                                    <div className="multi-group-editor__section-header">
                                        <div>
                                            <h3>Group-Specific URLs</h3>
                                            <p className="multi-group-editor__hint">
                                                URLs unique to individual groups
                                            </p>
                                        </div>
                                    </div>
                                    {Object.entries(filteredDifferences).map(([groupName, urls]) => (
                                        <div key={groupName} className="multi-group-editor__difference-group">
                                            <h4 className="multi-group-editor__difference-group-name">
                                                {groupName}{' '}
                                                <span className="multi-group-editor__count">({urls.length})</span>
                                            </h4>
                                            <ul className="multi-group-editor__url-list">
                                                {urls.map((url) => {
                                                    const isEditing =
                                                        editingUrl?.url === url && editingUrl?.groupName === groupName;
                                                    return (
                                                        <li
                                                            key={url}
                                                            className={`multi-group-editor__url-item ${isEditing ? 'multi-group-editor__url-item--editing' : ''
                                                                }`}
                                                        >
                                                            {isEditing ? (
                                                                <>
                                                                    <div className="multi-group-editor__edit-form">
                                                                        <input
                                                                            type="text"
                                                                            value={editDraft}
                                                                            onChange={(e) => {
                                                                                setEditDraft(e.target.value);
                                                                                setValidationError(undefined);
                                                                            }}
                                                                            onKeyDown={handleKeyDown}
                                                                            className="multi-group-editor__edit-input"
                                                                            placeholder="https://example.com/list.txt"
                                                                            disabled={disabled || saving}
                                                                            autoFocus
                                                                        />
                                                                    </div>
                                                                    <div className="multi-group-editor__edit-actions">
                                                                        {validationError && (
                                                                            <span className="multi-group-editor__edit-error">
                                                                                {validationError}
                                                                            </span>
                                                                        )}
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleSaveEdit()}
                                                                            className="multi-group-editor__edit-save"
                                                                            disabled={disabled || saving || !editDraft.trim()}
                                                                            title="Save changes (Enter)"
                                                                        >
                                                                            Save
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={handleCancelEdit}
                                                                            className="multi-group-editor__edit-cancel"
                                                                            disabled={disabled || saving}
                                                                            title="Cancel editing (Escape)"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <UrlDisplay url={url} />
                                                                    <div className="multi-group-editor__url-actions">
                                                                        <button
                                                                            type="button"
                                                                            className="multi-group-editor__url-edit"
                                                                            onClick={() => handleStartEdit(url, groupName)}
                                                                            disabled={disabled || saving}
                                                                            title="Edit URL"
                                                                        >
                                                                            ✎
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="multi-group-editor__url-remove"
                                                                            onClick={() =>
                                                                                removeUrlFromSpecificGroup(url, groupName)
                                                                            }
                                                                            disabled={disabled || saving}
                                                                            title={`Remove from ${groupName}`}
                                                                        >
                                                                            ✕
                                                                        </button>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add URL Form */}
                            <div className="multi-group-editor__add-form">
                                <div className="multi-group-editor__add-header">
                                    <h3>Add URL{bulkMode ? 's' : ''} to Selected Groups</h3>
                                    <button
                                        type="button"
                                        className="multi-group-editor__mode-toggle"
                                        onClick={() => setBulkMode(!bulkMode)}
                                        disabled={disabled || saving}
                                    >
                                        {bulkMode ? '← Single URL' : 'Bulk Add →'}
                                    </button>
                                </div>
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        if (bulkMode) {
                                            const textarea = e.currentTarget.elements.namedItem('urls') as HTMLTextAreaElement;
                                            void addBulkUrlsToAllGroups(textarea.value);
                                            textarea.value = '';
                                        } else {
                                            const input = e.currentTarget.elements.namedItem('url') as HTMLInputElement;
                                            void addUrlToAllGroups(input.value);
                                            input.value = '';
                                        }
                                    }}
                                >
                                    <div className="multi-group-editor__add-input-group">
                                        {bulkMode ? (
                                            <textarea
                                                name="urls"
                                                rows={6}
                                                placeholder={`Paste multiple URLs, one per line:\n${activeListConfig.placeholder}\n${activeListConfig.placeholder}\n...`}
                                                className="multi-group-editor__bulk-input"
                                                disabled={disabled || saving}
                                            />
                                        ) : (
                                            <input
                                                type="text"
                                                name="url"
                                                placeholder={activeListConfig.placeholder}
                                                disabled={disabled || saving}
                                            />
                                        )}
                                        <button type="submit" className="primary" disabled={disabled || saving}>
                                            {bulkMode ? `Add All to ${selectedGroups.size} Group${selectedGroups.size === 1 ? '' : 's'}` : `Add to ${selectedGroups.size} Group${selectedGroups.size === 1 ? '' : 's'}`}
                                        </button>
                                    </div>
                                    {activeListConfig.hint && !bulkMode && (
                                        <p className="multi-group-editor__hint">{activeListConfig.hint}</p>
                                    )}
                                    {bulkMode && (
                                        <p className="multi-group-editor__hint">
                                            Paste one URL per line. Duplicates will be automatically skipped.
                                        </p>
                                    )}
                                </form>
                            </div>

                            {error && (
                                <div className="multi-group-editor__error">
                                    <span className="status status--error">{error}</span>
                                </div>
                            )}
                        </>
                    )}
                </>
            )}

            {/* Save/Discard Footer */}
            {draftConfig && (
                <footer className="multi-group-editor__footer">
                    {isDirty && (
                        <>
                            <button
                                type="button"
                                className="multi-group-editor__footer-hint multi-group-editor__footer-hint--clickable"
                                onClick={() => setShowChangesSummary(!showChangesSummary)}
                                title="Click to see what will be saved"
                            >
                                You have unsaved changes ({pendingChanges.length}) {showChangesSummary ? '▼' : '▲'}
                            </button>

                            {showChangesSummary && pendingChanges.length > 0 && (
                                <div className="multi-group-editor__changes-summary">
                                    <h4>Pending Changes:</h4>
                                    <ul className="multi-group-editor__changes-list">
                                        {pendingChanges.map((change, idx) => (
                                            <li key={idx} className={`change-item change-item--${change.type}`}>
                                                <span className="change-icon">
                                                    <FontAwesomeIcon icon={change.type === 'added' ? faPlus : change.type === 'removed' ? faMinus : faPencil} />
                                                </span>
                                                <span className="change-type">{change.listType}</span>
                                                {change.groupName && (
                                                    <span className="change-group">→ {change.groupName}</span>
                                                )}
                                                {change.url ? (
                                                    <UrlDisplay url={change.url} />
                                                ) : change.field ? (
                                                    <span className="change-field">
                                                        {change.field}: {change.oldValue} → {change.newValue}
                                                    </span>
                                                ) : null}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                    <div className="multi-group-editor__footer-actions">
                        <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                                if (config) {
                                    setDraftConfig(cloneConfig(config));
                                    setSelectedUrls(new Set());
                                    setError(undefined);
                                }
                            }}
                            disabled={!isDirty || saving}
                        >
                            Reset
                        </button>
                        <button
                            type="button"
                            className="primary"
                            onClick={async () => {
                                if (!draftConfig) return;
                                setSaving(true);
                                setError(undefined);
                                try {
                                    await onSave(draftConfig);
                                } catch (err) {
                                    setError(err instanceof Error ? err.message : 'Failed to save configuration');
                                } finally {
                                    setSaving(false);
                                }
                            }}
                            disabled={!isDirty || saving}
                        >
                            Save Changes
                        </button>
                    </div>
                </footer>
            )}

            {/* Confirmation Dialog - Single URL Removal */}
            {urlToRemove && (
                <div className="multi-group-editor__dialog-overlay" onClick={() => setUrlToRemove(null)}>
                    <div className="multi-group-editor__dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="multi-group-editor__dialog-header">
                            <h3>Confirm Removal</h3>
                        </div>
                        <div className="multi-group-editor__dialog-body">
                            <p>
                                Are you sure you want to remove this URL from all {selectedGroups.size} selected group
                                {selectedGroups.size === 1 ? '' : 's'}?
                            </p>
                            <div className="multi-group-editor__dialog-url">
                                <UrlDisplay url={urlToRemove} />
                            </div>
                        </div>
                        <div className="multi-group-editor__dialog-actions">
                            <button
                                type="button"
                                className="button button--secondary"
                                onClick={() => setUrlToRemove(null)}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="button button--danger"
                                onClick={() => {
                                    void removeUrlFromAllGroups(urlToRemove);
                                    setUrlToRemove(null);
                                }}
                                disabled={saving}
                            >
                                {saving ? 'Removing...' : 'Remove URL'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirmation Dialog - Bulk Delete */}
            {urlsToDelete && (
                <div className="multi-group-editor__dialog-overlay" onClick={() => setUrlsToDelete(null)}>
                    <div className="multi-group-editor__dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="multi-group-editor__dialog-header">
                            <h3>⚠️ Confirm Bulk Deletion</h3>
                        </div>
                        <div className="multi-group-editor__dialog-body">
                            <p>
                                Are you sure you want to remove <strong>{urlsToDelete.length} URL{urlsToDelete.length === 1 ? '' : 's'}</strong> from all {selectedGroups.size} selected group
                                {selectedGroups.size === 1 ? '' : 's'}?
                            </p>
                            <div className="multi-group-editor__dialog-warning">
                                <strong>⚠️ This action cannot be undone.</strong>
                            </div>
                            {urlsToDelete.length <= 10 && (
                                <div className="multi-group-editor__dialog-url-list">
                                    <p className="multi-group-editor__hint">URLs to be deleted:</p>
                                    {urlsToDelete.map((url) => (
                                        <div key={url} className="multi-group-editor__dialog-url-item">
                                            <UrlDisplay url={url} />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="multi-group-editor__dialog-actions">
                            <button
                                type="button"
                                className="button button--secondary"
                                onClick={() => setUrlsToDelete(null)}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="button button--danger"
                                onClick={() => void deleteSelectedUrls(urlsToDelete)}
                                disabled={saving}
                            >
                                {saving ? 'Deleting...' : `Delete ${urlsToDelete.length} URL${urlsToDelete.length === 1 ? '' : 's'}`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
