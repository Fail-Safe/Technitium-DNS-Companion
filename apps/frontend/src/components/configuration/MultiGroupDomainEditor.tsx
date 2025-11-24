import { useCallback, useEffect, useState, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faBan, faPlus, faMinus, faPencil } from '@fortawesome/free-solid-svg-icons';
import type { AdvancedBlockingConfig } from '../../types/advancedBlocking';

interface MultiGroupDomainEditorProps {
    config?: AdvancedBlockingConfig;
    onSave: (updatedConfig: AdvancedBlockingConfig) => Promise<void>;
    onDirtyChange?: (isDirty: boolean) => void;
    disabled?: boolean;
}

type DomainType = 'blocked' | 'allowed' | 'blockedRegex' | 'allowedRegex';

interface DomainListSection {
    type: DomainType;
    title: string;
    description: string;
    icon: string;
}

const DOMAIN_SECTIONS: DomainListSection[] = [
    {
        type: 'allowed',
        title: 'Allowed Domains',
        description: 'Exact domain matches allowed across selected groups',
        icon: 'faCheck',
    },
    {
        type: 'blocked',
        title: 'Blocked Domains',
        description: 'Exact domain matches blocked across selected groups',
        icon: 'faBan',
    },
    {
        type: 'allowedRegex',
        title: 'Allowed Regex',
        description: 'Regex patterns allowed across selected groups',
        icon: 'faCheck',
    },
    {
        type: 'blockedRegex',
        title: 'Blocked Regex',
        description: 'Regex patterns blocked across selected groups',
        icon: 'faBan',
    },
];

export function MultiGroupDomainEditor({
    config,
    onSave,
    onDirtyChange,
    disabled = false,
}: MultiGroupDomainEditorProps) {
    // Helper function to deep clone config
    const cloneConfig = useCallback((cfg: AdvancedBlockingConfig): AdvancedBlockingConfig => {
        return JSON.parse(JSON.stringify(cfg));
    }, []);

    // Draft state for editing
    const [draftConfig, setDraftConfig] = useState<AdvancedBlockingConfig | undefined>(() =>
        config ? cloneConfig(config) : undefined,
    );

    // Sync draft when config prop changes
    useEffect(() => {
        if (config) {
            setDraftConfig(cloneConfig(config));
        }
    }, [config, cloneConfig]);

    // Track if draft differs from original config
    const isDirty = useMemo(() => {
        if (!config || !draftConfig) return false;
        return JSON.stringify(config) !== JSON.stringify(draftConfig);
    }, [config, draftConfig]);

    // Notify parent of dirty state changes
    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    const groups = useMemo(() => draftConfig?.groups ?? [], [draftConfig?.groups]);
    const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
    const [newDomain, setNewDomain] = useState('');
    const [activeDomainType, setActiveDomainType] = useState<DomainType>('blocked');
    const [searchFilter, setSearchFilter] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | undefined>();
    const [success, setSuccess] = useState<string | undefined>();
    const [confirmRemove, setConfirmRemove] = useState<{ domain: string; type: DomainType } | null>(null);
    const [editingDomain, setEditingDomain] = useState<{ domain: string; type: DomainType } | null>(null);
    const [editDraft, setEditDraft] = useState('');
    const [validationError, setValidationError] = useState<string | undefined>();
    const [showChangesSummary, setShowChangesSummary] = useState(false);

    // Calculate pending changes for the summary
    const pendingChanges = useMemo(() => {
        if (!config || !draftConfig) return [];

        const changes: Array<{ type: 'added' | 'removed' | 'modified'; category: string; description: string }> = [];

        // Compare each group's domain lists
        draftConfig.groups.forEach((draftGroup, idx) => {
            const originalGroup = config.groups[idx];
            if (!originalGroup || originalGroup.name !== draftGroup.name) return;

            // Check blocked domains
            const addedBlocked = draftGroup.blocked.filter(d => !originalGroup.blocked.includes(d));
            const removedBlocked = originalGroup.blocked.filter(d => !draftGroup.blocked.includes(d));

            addedBlocked.forEach(domain => {
                changes.push({ type: 'added', category: 'Blocked', description: `${domain} → ${draftGroup.name}` });
            });
            removedBlocked.forEach(domain => {
                changes.push({ type: 'removed', category: 'Blocked', description: `${domain} → ${draftGroup.name}` });
            });

            // Check allowed domains
            const addedAllowed = draftGroup.allowed.filter(d => !originalGroup.allowed.includes(d));
            const removedAllowed = originalGroup.allowed.filter(d => !draftGroup.allowed.includes(d));

            addedAllowed.forEach(domain => {
                changes.push({ type: 'added', category: 'Allowed', description: `${domain} → ${draftGroup.name}` });
            });
            removedAllowed.forEach(domain => {
                changes.push({ type: 'removed', category: 'Allowed', description: `${domain} → ${draftGroup.name}` });
            });

            // Check blocked regex
            const addedBlockedRegex = draftGroup.blockedRegex.filter(d => !originalGroup.blockedRegex.includes(d));
            const removedBlockedRegex = originalGroup.blockedRegex.filter(d => !draftGroup.blockedRegex.includes(d));

            addedBlockedRegex.forEach(domain => {
                changes.push({ type: 'added', category: 'Blocked Regex', description: `${domain} → ${draftGroup.name}` });
            });
            removedBlockedRegex.forEach(domain => {
                changes.push({ type: 'removed', category: 'Blocked Regex', description: `${domain} → ${draftGroup.name}` });
            });

            // Check allowed regex
            const addedAllowedRegex = draftGroup.allowedRegex.filter(d => !originalGroup.allowedRegex.includes(d));
            const removedAllowedRegex = originalGroup.allowedRegex.filter(d => !draftGroup.allowedRegex.includes(d));

            addedAllowedRegex.forEach(domain => {
                changes.push({ type: 'added', category: 'Allowed Regex', description: `${domain} → ${draftGroup.name}` });
            });
            removedAllowedRegex.forEach(domain => {
                changes.push({ type: 'removed', category: 'Allowed Regex', description: `${domain} → ${draftGroup.name}` });
            });
        });

        return changes;
    }, [config, draftConfig]);

    // Auto-dismiss success messages after 5 seconds
    useEffect(() => {
        if (success) {
            const timer = setTimeout(() => setSuccess(undefined), 5000);
            return () => clearTimeout(timer);
        }
    }, [success]);

    // Calculate intersection of domains across selected groups
    const commonDomains = useMemo(() => {
        if (selectedGroups.size === 0) {
            return {
                blocked: [] as string[],
                allowed: [] as string[],
                blockedRegex: [] as string[],
                allowedRegex: [] as string[],
            };
        }

        const selectedGroupObjects = groups.filter((g) => selectedGroups.has(g.name));

        if (selectedGroupObjects.length === 0) {
            return {
                blocked: [] as string[],
                allowed: [] as string[],
                blockedRegex: [] as string[],
                allowedRegex: [] as string[],
            };
        }

        // Start with first group's domains
        const firstGroup = selectedGroupObjects[0];
        let blocked = new Set(firstGroup.blocked);
        let allowed = new Set(firstGroup.allowed);
        let blockedRegex = new Set(firstGroup.blockedRegex);
        let allowedRegex = new Set(firstGroup.allowedRegex);

        // Intersect with remaining groups
        for (let i = 1; i < selectedGroupObjects.length; i++) {
            const group = selectedGroupObjects[i];
            blocked = new Set([...blocked].filter((d) => group.blocked.includes(d)));
            allowed = new Set([...allowed].filter((d) => group.allowed.includes(d)));
            blockedRegex = new Set([...blockedRegex].filter((d) => group.blockedRegex.includes(d)));
            allowedRegex = new Set([...allowedRegex].filter((d) => group.allowedRegex.includes(d)));
        }

        return {
            blocked: Array.from(blocked).sort(),
            allowed: Array.from(allowed).sort(),
            blockedRegex: Array.from(blockedRegex).sort(),
            allowedRegex: Array.from(allowedRegex).sort(),
        };
    }, [groups, selectedGroups]);

    // Filter domains based on search query (fuzzy match)
    const filteredDomains = useMemo(() => {
        if (!searchFilter.trim()) {
            return commonDomains;
        }

        const query = searchFilter.toLowerCase();

        return {
            blocked: commonDomains.blocked.filter((d) => d.toLowerCase().includes(query)),
            allowed: commonDomains.allowed.filter((d) => d.toLowerCase().includes(query)),
            blockedRegex: commonDomains.blockedRegex.filter((d) => d.toLowerCase().includes(query)),
            allowedRegex: commonDomains.allowedRegex.filter((d) => d.toLowerCase().includes(query)),
        };
    }, [commonDomains, searchFilter]);

    const toggleGroupSelection = useCallback((groupName: string) => {
        setSelectedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupName)) {
                next.delete(groupName);
            } else {
                next.add(groupName);
            }
            return next;
        });
        setError(undefined);
        setSuccess(undefined);
    }, []);

    const selectAllGroups = useCallback(() => {
        setSelectedGroups(new Set(groups.map((g) => g.name)));
        setError(undefined);
        setSuccess(undefined);
    }, [groups]);

    const clearGroupSelection = useCallback(() => {
        setSelectedGroups(new Set());
        setError(undefined);
        setSuccess(undefined);
    }, []);

    const addDomainToSelectedGroups = useCallback(
        async (domain: string, type: DomainType) => {
            if (!draftConfig || selectedGroups.size === 0 || !domain.trim()) {
                return;
            }

            const trimmedDomain = domain.trim();
            setError(undefined);
            setSuccess(undefined);

            const updatedGroups = draftConfig.groups.map((group) => {
                if (!selectedGroups.has(group.name)) {
                    return group;
                }

                const updatedGroup = { ...group };

                switch (type) {
                    case 'blocked':
                        if (!updatedGroup.blocked.includes(trimmedDomain)) {
                            updatedGroup.blocked = [...updatedGroup.blocked, trimmedDomain];
                        }
                        break;
                    case 'allowed':
                        if (!updatedGroup.allowed.includes(trimmedDomain)) {
                            updatedGroup.allowed = [...updatedGroup.allowed, trimmedDomain];
                        }
                        break;
                    case 'blockedRegex':
                        if (!updatedGroup.blockedRegex.includes(trimmedDomain)) {
                            updatedGroup.blockedRegex = [...updatedGroup.blockedRegex, trimmedDomain];
                        }
                        break;
                    case 'allowedRegex':
                        if (!updatedGroup.allowedRegex.includes(trimmedDomain)) {
                            updatedGroup.allowedRegex = [...updatedGroup.allowedRegex, trimmedDomain];
                        }
                        break;
                }

                return updatedGroup;
            });

            const updatedConfig = cloneConfig(draftConfig);
            updatedConfig.groups = updatedGroups;
            setDraftConfig(updatedConfig);
            setSuccess(
                `Added "${trimmedDomain}" to ${selectedGroups.size} group${selectedGroups.size === 1 ? '' : 's'}`,
            );
            setNewDomain('');
        },
        [draftConfig, selectedGroups, cloneConfig],
    );

    const removeDomainFromSelectedGroups = useCallback(
        async (domain: string, type: DomainType) => {
            if (!draftConfig || selectedGroups.size === 0) {
                return;
            }

            // Close confirmation dialog
            setConfirmRemove(null);

            setError(undefined);
            setSuccess(undefined);

            const updatedGroups = draftConfig.groups.map((group) => {
                if (!selectedGroups.has(group.name)) {
                    return group;
                }

                const updatedGroup = { ...group };

                switch (type) {
                    case 'blocked':
                        updatedGroup.blocked = updatedGroup.blocked.filter((d) => d !== domain);
                        break;
                    case 'allowed':
                        updatedGroup.allowed = updatedGroup.allowed.filter((d) => d !== domain);
                        break;
                    case 'blockedRegex':
                        updatedGroup.blockedRegex = updatedGroup.blockedRegex.filter((d) => d !== domain);
                        break;
                    case 'allowedRegex':
                        updatedGroup.allowedRegex = updatedGroup.allowedRegex.filter((d) => d !== domain);
                        break;
                }

                return updatedGroup;
            });

            const updatedConfig = cloneConfig(draftConfig);
            updatedConfig.groups = updatedGroups;
            setDraftConfig(updatedConfig);
            setSuccess(
                `Removed "${domain}" from ${selectedGroups.size} group${selectedGroups.size === 1 ? '' : 's'}`,
            );
        },
        [draftConfig, selectedGroups, cloneConfig],
    );

    // Check if regex could be improved with standard domain + subdomain format
    const regexSuggestion = useMemo(() => {
        if (!newDomain.trim() || (activeDomainType !== 'blockedRegex' && activeDomainType !== 'allowedRegex')) {
            return null;
        }

        const domain = newDomain.trim();

        // Check if it looks like a plain domain (alphanumeric, dots, hyphens)
        const plainDomainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

        if (plainDomainPattern.test(domain)) {
            // Suggest converting to domain + subdomain regex format
            return `(\\.|^)${domain.replace(/\./g, '\\.')}$`;
        }

        // Check if it's already escaped but missing the prefix/suffix
        const hasEscapedDots = domain.includes('\\.');
        const hasPrefix = domain.startsWith('(\\.|^)') || domain.startsWith('(\\.\\|^)');
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
    }, [newDomain, activeDomainType]);

    const handleAddDomain = useCallback(
        (e: React.FormEvent) => {
            e.preventDefault();
            if (newDomain.trim()) {
                void addDomainToSelectedGroups(newDomain, activeDomainType);
            }
        },
        [newDomain, activeDomainType, addDomainToSelectedGroups],
    );

    const applyRegexSuggestion = useCallback(() => {
        if (regexSuggestion) {
            setNewDomain(regexSuggestion);
        }
    }, [regexSuggestion]);

    // Keyboard shortcuts
    const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Escape') {
            setSearchFilter('');
            e.currentTarget.blur();
        }
    }, []);

    const handleRemoveClick = useCallback((domain: string, type: DomainType) => {
        setConfirmRemove({ domain, type });
    }, []);

    const cancelRemove = useCallback(() => {
        setConfirmRemove(null);
    }, []);

    // Edit handlers
    const handleStartEdit = useCallback((domain: string, type: DomainType) => {
        setEditingDomain({ domain, type });
        setEditDraft(domain);
        setValidationError(undefined);
    }, []);

    const handleCancelEdit = useCallback(() => {
        setEditingDomain(null);
        setEditDraft('');
        setValidationError(undefined);
    }, []);

    const handleSaveEdit = useCallback(
        (oldDomain: string, type: DomainType) => {
            if (!draftConfig || !editDraft.trim()) return;

            const newDomain = editDraft.trim();

            // Don't allow duplicate domains in selected groups
            const domainExists = draftConfig.groups.some((group) => {
                if (!selectedGroups.has(group.name)) return false;
                const list = group[type] as string[];
                return list.includes(newDomain) && newDomain !== oldDomain;
            });

            if (domainExists) {
                setValidationError('This domain already exists in one or more selected groups');
                return;
            }

            setError(undefined);

            const updatedConfig = cloneConfig(draftConfig);
            updatedConfig.groups = updatedConfig.groups.map((group) => {
                if (!selectedGroups.has(group.name)) return group;

                const list = group[type] as string[];
                const updated = list.map((d) => (d === oldDomain ? newDomain : d));

                return {
                    ...group,
                    [type]: updated,
                };
            });

            setDraftConfig(updatedConfig);
            setEditingDomain(null);
            setEditDraft('');
            setValidationError(undefined);
        },
        [draftConfig, selectedGroups, editDraft, cloneConfig],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent, oldDomain: string, type: DomainType) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSaveEdit(oldDomain, type);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handleCancelEdit();
            }
        },
        [handleSaveEdit, handleCancelEdit],
    );

    if (!config || groups.length === 0) {
        return (
            <section className="multi-group-editor">
                <header className="multi-group-editor__header">
                    <h2>Multi-Group Domain Editor</h2>
                    <p className="multi-group-editor__description">
                        No Advanced Blocking groups available. Create groups first to use bulk editing.
                    </p>
                </header>
            </section>
        );
    }

    return (
        <section className="multi-group-editor">
            {/* Group Selection */}
            <div className="multi-group-editor__group-selector">
                <div className="multi-group-editor__selector-header">
                    <h3>Select Groups ({selectedGroups.size} selected)</h3>
                    <div className="multi-group-editor__selector-actions">
                        <button
                            type="button"
                            onClick={selectAllGroups}
                            className="button button--sm button--secondary"
                            disabled={disabled || saving}
                        >
                            Select All
                        </button>
                        <button
                            type="button"
                            onClick={clearGroupSelection}
                            className="button button--sm button--secondary"
                            disabled={disabled || saving || selectedGroups.size === 0}
                        >
                            Clear
                        </button>
                    </div>
                </div>
                <div className="multi-group-editor__group-checkboxes">
                    {groups.map((group) => (
                        <label key={group.name} className="multi-group-editor__group-checkbox">
                            <input
                                type="checkbox"
                                checked={selectedGroups.has(group.name)}
                                onChange={() => toggleGroupSelection(group.name)}
                                disabled={disabled || saving}
                            />
                            <span className="multi-group-editor__group-name">{group.name}</span>
                            <div className="multi-group-editor__group-stats">
                                {group.blocked.length + group.blockedRegex.length > 0 && (
                                    <span className="multi-group-editor__stat-badge multi-group-editor__stat-badge--blocked">
                                        {group.blocked.length + group.blockedRegex.length} blocked
                                    </span>
                                )}
                                {group.allowed.length + group.allowedRegex.length > 0 && (
                                    <span className="multi-group-editor__stat-badge multi-group-editor__stat-badge--allowed">
                                        {group.allowed.length + group.allowedRegex.length} allowed
                                    </span>
                                )}
                                {group.blocked.length + group.blockedRegex.length === 0 &&
                                    group.allowed.length + group.allowedRegex.length === 0 && (
                                        <span className="multi-group-editor__stat-badge multi-group-editor__stat-badge--empty">
                                            empty
                                        </span>
                                    )}
                            </div>
                        </label>
                    ))}
                </div>
            </div>

            {/* Status Messages */}
            {error && (
                <div className="multi-group-editor__error">
                    <span className="status status--error">{error}</span>
                </div>
            )}
            {success && (
                <div className="multi-group-editor__success">
                    <span className="status status--success">{success}</span>
                </div>
            )}

            {selectedGroups.size === 0 ? (
                <div className="multi-group-editor__empty-state">
                    <p>Select one or more groups above to view and edit their common domains.</p>
                </div>
            ) : (
                <>
                    {/* Add Domain Form */}
                    <form onSubmit={handleAddDomain} className="multi-group-editor__add-form">
                        <div className="multi-group-editor__add-header">
                            <h3>Add Domain to Selected Groups</h3>
                        </div>
                        <div className="multi-group-editor__add-controls">
                            <select
                                value={activeDomainType}
                                onChange={(e) => setActiveDomainType(e.target.value as DomainType)}
                                className="multi-group-editor__type-select"
                                disabled={disabled || saving}
                            >
                                <option value="blocked">Blocked Domain</option>
                                <option value="allowed">Allowed Domain</option>
                                <option value="blockedRegex">Blocked Regex</option>
                                <option value="allowedRegex">Allowed Regex</option>
                            </select>
                            <input
                                type="text"
                                value={newDomain}
                                onChange={(e) => setNewDomain(e.target.value)}
                                placeholder="Enter domain or regex pattern"
                                className="multi-group-editor__domain-input"
                                disabled={disabled || saving}
                            />
                            <button
                                type="submit"
                                className="button button--primary"
                                disabled={disabled || saving || !newDomain.trim()}
                            >
                                {saving ? 'Adding...' : 'Add'}
                            </button>
                        </div>

                        {/* Regex Suggestion */}
                        {regexSuggestion && (
                            <div className="multi-group-editor__regex-suggestion">
                                <div className="multi-group-editor__regex-suggestion-icon">💡</div>
                                <div className="multi-group-editor__regex-suggestion-content">
                                    <p className="multi-group-editor__regex-suggestion-text">
                                        <strong>Suggestion:</strong> Use domain + subdomain format to match domain and subdomains:
                                    </p>
                                    <code className="multi-group-editor__regex-suggestion-code">
                                        {regexSuggestion}
                                    </code>
                                </div>
                                <button
                                    type="button"
                                    onClick={applyRegexSuggestion}
                                    className="button button--sm button--secondary"
                                >
                                    Apply
                                </button>
                            </div>
                        )}
                    </form>

                    {/* Search/Filter Box */}
                    <div className="multi-group-editor__search">
                        <input
                            type="text"
                            value={searchFilter}
                            onChange={(e) => setSearchFilter(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            placeholder="Filter domains... (e.g., google, \.com$, analytics) — Press Esc to clear"
                            className="multi-group-editor__search-input"
                            disabled={disabled || saving}
                        />
                        {searchFilter && (
                            <button
                                type="button"
                                onClick={() => setSearchFilter('')}
                                className="multi-group-editor__search-clear"
                                title="Clear filter (Esc)"
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    {/* Domain Lists */}
                    <div className="multi-group-editor__domain-sections">
                        {DOMAIN_SECTIONS.map((section) => {
                            const domains = filteredDomains[section.type];
                            const totalDomains = commonDomains[section.type].length;
                            const isFiltered = searchFilter.trim().length > 0;
                            return (
                                <div key={section.type} className="multi-group-editor__domain-section">
                                    <header className="multi-group-editor__section-header">
                                        <h3>
                                            <FontAwesomeIcon icon={section.icon === 'faCheck' ? faCheck : faBan} /> {section.title}
                                        </h3>
                                        <span className="badge">
                                            {isFiltered && domains.length !== totalDomains
                                                ? `${domains.length} / ${totalDomains}`
                                                : domains.length}
                                        </span>
                                    </header>
                                    <p className="multi-group-editor__section-description">
                                        {section.description}
                                    </p>
                                    {domains.length === 0 ? (
                                        <p className="multi-group-editor__empty-list">
                                            {isFiltered
                                                ? `No matching ${section.title.toLowerCase()} for "${searchFilter}".`
                                                : `No common ${section.title.toLowerCase()} across selected groups.`}
                                        </p>
                                    ) : (
                                        <ul className="multi-group-editor__domain-list">
                                            {domains.map((domain) => {
                                                const isEditing =
                                                    editingDomain?.domain === domain && editingDomain?.type === section.type;
                                                return (
                                                    <li
                                                        key={domain}
                                                        className={`multi-group-editor__domain-item ${isEditing ? 'multi-group-editor__domain-item--editing' : ''
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
                                                                        onKeyDown={(e) => handleKeyDown(e, domain, section.type)}
                                                                        className="multi-group-editor__edit-input"
                                                                        placeholder="example.com or ^.*\.example\.com$"
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
                                                                        onClick={() => handleSaveEdit(domain, section.type)}
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
                                                                <code className="multi-group-editor__domain-text">
                                                                    {domain}
                                                                </code>
                                                                <div className="multi-group-editor__domain-actions">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleStartEdit(domain, section.type)}
                                                                        className="multi-group-editor__domain-edit"
                                                                        disabled={disabled || saving}
                                                                        title="Edit domain"
                                                                    >
                                                                        ✎
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleRemoveClick(domain, section.type)}
                                                                        className="multi-group-editor__domain-remove"
                                                                        disabled={disabled || saving}
                                                                        title={`Remove from ${selectedGroups.size} group(s)`}
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
                            );
                        })}
                    </div>
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
                                                <span className="change-type">{change.category}</span>
                                                <span className="change-group" style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                                                    {change.description}
                                                </span>
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
                                    setError(undefined);
                                    setSuccess(undefined);
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
                                setSuccess(undefined);
                                try {
                                    await onSave(draftConfig);
                                    setSuccess('Configuration saved successfully');
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

            {/* Confirmation Dialog */}
            {confirmRemove && (
                <div className="multi-group-editor__dialog-overlay" onClick={cancelRemove}>
                    <div
                        className="multi-group-editor__dialog"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="multi-group-editor__dialog-title">Confirm Removal</h3>
                        <p className="multi-group-editor__dialog-message">
                            Remove <code>{confirmRemove.domain}</code> from{' '}
                            <strong>{selectedGroups.size} group(s)</strong>?
                        </p>
                        <p className="multi-group-editor__dialog-note">
                            This action cannot be undone.
                        </p>
                        <div className="multi-group-editor__dialog-actions">
                            <button
                                type="button"
                                onClick={cancelRemove}
                                className="button button--secondary"
                                disabled={saving}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() =>
                                    removeDomainFromSelectedGroups(confirmRemove.domain, confirmRemove.type)
                                }
                                className="button button--danger"
                                disabled={saving}
                            >
                                {saving ? 'Removing...' : 'Remove'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
