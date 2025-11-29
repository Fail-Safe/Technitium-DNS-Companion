import { useState, useCallback, useEffect, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faPlus,
    faTrash,
    faSearch,
    faSpinner,
    faBan,
    faShieldAlt,
    faGear,
    faExclamationTriangle,
    faExternalLinkAlt,
    faPencil,
    faSync,
    faCheckCircle,
    faTimes,
    faCheck,
} from '@fortawesome/free-solid-svg-icons';
import { useTechnitiumState } from '../../context/TechnitiumContext';
import { useToast } from '../../context/ToastContext';
import { useBlockListCatalog, type HageziListInfo } from '../../hooks/useBlockListCatalog';
import { validateDomain } from '../../utils/domainValidation';
import type {
    BlockingSettings,
    BuiltInBlockingSnapshot,
} from '../../types/builtInBlocking';
import './BuiltInBlockingEditor.css';

/** Link to the Technitium DNS developer's explanation about blocking conflicts */
const TECHNITIUM_DEV_ADV_BLOCK_POST_URL = 'https://www.reddit.com/r/technitium/comments/1bg6a6z/comment/kv53t11/';

/** Predefined popular block lists for Quick Add */
interface PredefinedBlockList {
    name: string;
    url: string;
    description: string;
    category: 'hagezi' | 'stevenblack' | 'oisd' | 'other';
}

const PREDEFINED_BLOCK_LISTS: PredefinedBlockList[] = [
    // Hagezi Multi lists (using jsDelivr CDN mirror)
    {
        name: 'Hagezi Light',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/light-onlydomains.txt',
        description: 'Basic protection - Ads, Tracking, Metrics (~82K domains)',
        category: 'hagezi',
    },
    {
        name: 'Hagezi Normal',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/multi-onlydomains.txt',
        description: 'All-round protection - Ads, Tracking, Malware, Scam (~255K domains)',
        category: 'hagezi',
    },
    {
        name: 'Hagezi Pro (Recommended)',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/pro-onlydomains.txt',
        description: 'Extended protection - Balanced blocking (~333K domains)',
        category: 'hagezi',
    },
    {
        name: 'Hagezi Pro++',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/pro.plus-onlydomains.txt',
        description: 'Maximum protection - Aggressive blocking (~378K domains)',
        category: 'hagezi',
    },
    {
        name: 'Hagezi Ultimate',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/ultimate-onlydomains.txt',
        description: 'Aggressive protection - Strictest blocking (~462K domains)',
        category: 'hagezi',
    },
    // Hagezi specialized lists
    {
        name: 'Hagezi TIF (Threat Intelligence)',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/tif-onlydomains.txt',
        description: 'Malware, Phishing, Scam, Spam (~615K domains)',
        category: 'hagezi',
    },
    {
        name: 'Hagezi Gambling',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/gambling-onlydomains.txt',
        description: 'Blocks gambling content (~210K domains)',
        category: 'hagezi',
    },
    {
        name: 'Hagezi NSFW/Adult',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/nsfw-onlydomains.txt',
        description: 'Blocks adult content (~76K domains)',
        category: 'hagezi',
    },
    {
        name: 'Hagezi Anti-Piracy',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/anti.piracy-onlydomains.txt',
        description: 'Blocks piracy sites (~11K domains)',
        category: 'hagezi',
    },
    {
        name: 'Hagezi Social Networks',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/social-onlydomains.txt',
        description: 'Blocks social networks (Facebook, TikTok, X, etc.)',
        category: 'hagezi',
    },
    {
        name: 'Hagezi DoH/VPN/Proxy Bypass',
        url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/wildcard/doh-vpn-proxy-bypass-onlydomains.txt',
        description: 'Prevents DNS bypass methods',
        category: 'hagezi',
    },
    // Steven Black lists
    {
        name: 'Steven Black Unified',
        url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
        description: 'Adware + Malware (~130K domains)',
        category: 'stevenblack',
    },
    {
        name: 'Steven Black + Fakenews',
        url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews/hosts',
        description: 'Unified + Fakenews',
        category: 'stevenblack',
    },
    {
        name: 'Steven Black + Gambling',
        url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/gambling/hosts',
        description: 'Unified + Gambling',
        category: 'stevenblack',
    },
    {
        name: 'Steven Black + Porn',
        url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn/hosts',
        description: 'Unified + Porn',
        category: 'stevenblack',
    },
    {
        name: 'Steven Black + Social',
        url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/social/hosts',
        description: 'Unified + Social Networks',
        category: 'stevenblack',
    },
    // OISD lists
    {
        name: 'OISD Big',
        url: 'https://big.oisd.nl/domainswild',
        description: 'Comprehensive blocking list',
        category: 'oisd',
    },
    {
        name: 'OISD NSFW',
        url: 'https://nsfw.oisd.nl/domainswild',
        description: 'Adult content blocking',
        category: 'oisd',
    },
];

type BuiltInTab = 'allowed' | 'blocked' | 'settings';

/** Description of a pending change for display */
interface PendingChange {
    type: 'modified' | 'added' | 'removed';
    category: string;
    /** Short description (shown on mobile) */
    description: string;
    /** Full description (shown on desktop, optional - falls back to description) */
    fullDescription?: string;
}

interface BuiltInBlockingEditorProps {
    selectedNodeId: string;
    snapshot?: BuiltInBlockingSnapshot;
    onRefresh: () => void;
    loading?: boolean;
    /** Whether Advanced Blocking is active (for conflict warning) */
    advancedBlockingActive?: boolean;
}

export function BuiltInBlockingEditor({
    selectedNodeId,
    snapshot,
    onRefresh,
    loading = false,
    advancedBlockingActive = false,
}: BuiltInBlockingEditorProps) {
    const {
        listAllowedDomains,
        listBlockedDomains,
        addAllowedDomain,
        addBlockedDomain,
        deleteAllowedDomain,
        deleteBlockedDomain,
        getBlockingSettings,
        updateBlockingSettings,
        temporaryDisableBlocking,
        reEnableBlocking,
        forceBlockListUpdate,
    } = useTechnitiumState();
    const { pushToast } = useToast();
    const { fetchHageziCatalog, isLoading: catalogLoading, catalog } = useBlockListCatalog();

    // Tab state
    const [activeTab, setActiveTab] = useState<BuiltInTab>('blocked');

    // Settings state (from server - baseline)
    const [settings, setSettings] = useState<BlockingSettings | null>(null);

    // Draft state for pending changes (domains use Sets for efficient add/remove)
    const [draftSettings, setDraftSettings] = useState<BlockingSettings | null>(null);
    const [draftAllowedDomains, setDraftAllowedDomains] = useState<Set<string>>(new Set());
    const [draftBlockedDomains, setDraftBlockedDomains] = useState<Set<string>>(new Set());

    // Baseline snapshots for comparison (what was on server when we loaded)
    const [baselineAllowedDomains, setBaselineAllowedDomains] = useState<Set<string>>(new Set());
    const [baselineBlockedDomains, setBaselineBlockedDomains] = useState<Set<string>>(new Set());

    // UI state
    const [loadingDomains, setLoadingDomains] = useState(false);
    const [loadingSettings, setLoadingSettings] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [saving, setSaving] = useState(false);
    const [showChangesSummary, setShowChangesSummary] = useState(false);

    // Domain input validation
    const [domainValidationError, setDomainValidationError] = useState<string | null>(null);

    // Domain editing state
    const [editingDomain, setEditingDomain] = useState<string | null>(null);
    const [editDomainValue, setEditDomainValue] = useState('');
    const [editDomainError, setEditDomainError] = useState<string | null>(null);

    // Block list URL editing
    const [newBlockListUrl, setNewBlockListUrl] = useState('');

    // Temporary disable state
    const [tempDisableMinutes, setTempDisableMinutes] = useState(30);

    // Custom address validation
    const [customAddressError, setCustomAddressError] = useState<string | null>(null);
    // Raw textarea value to preserve newlines while typing
    const [customAddressText, setCustomAddressText] = useState<string>('');

    // Catalog updates UI state
    const [showCatalogUpdates, setShowCatalogUpdates] = useState(false);

    // Pagination (client-side)
    const [currentPage, setCurrentPage] = useState(0);
    const entriesPerPage = 25;

    // Load ALL domains for both tabs and initialize baseline + draft
    // This should only be called on initial load, tab change, or explicit refresh
    const loadDomains = useCallback(async (forceLoadBoth = false) => {
        if (!selectedNodeId) return;

        setLoadingDomains(true);
        try {
            // Load all domains without filtering (client-side filtering handles search)
            const params = {
                pageNumber: 0,
                entriesPerPage: 10000, // Load all - filtering is client-side
            };

            // When forceLoadBoth is true (e.g., after save), load both tabs' data
            // Otherwise, only load the active tab's data
            if (forceLoadBoth || activeTab === 'allowed') {
                const data = await listAllowedDomains(selectedNodeId, params);
                // Initialize baseline and draft from server data
                const serverDomains = new Set(data.domains.map(d => d.domain));
                setBaselineAllowedDomains(serverDomains);
                setDraftAllowedDomains(new Set(serverDomains));
            }

            if (forceLoadBoth || activeTab === 'blocked') {
                const data = await listBlockedDomains(selectedNodeId, params);
                // Initialize baseline and draft from server data
                const serverDomains = new Set(data.domains.map(d => d.domain));
                setBaselineBlockedDomains(serverDomains);
                setDraftBlockedDomains(new Set(serverDomains));
            }
        } catch (error) {
            pushToast({ message: `Failed to load ${activeTab} domains: ${(error as Error).message}`, tone: 'error' });
        } finally {
            setLoadingDomains(false);
        }
    }, [selectedNodeId, activeTab, listAllowedDomains, listBlockedDomains, pushToast]);

    // Load settings
    const loadSettings = useCallback(async () => {
        if (!selectedNodeId) return;

        setLoadingSettings(true);
        try {
            const data = await getBlockingSettings(selectedNodeId);
            setSettings(data);
            setDraftSettings(data); // Initialize draft with current settings
            // Initialize custom address text from loaded settings
            setCustomAddressText((data.customBlockingAddresses ?? []).join('\n'));
        } catch (error) {
            pushToast({ message: `Failed to load settings: ${(error as Error).message}`, tone: 'error' });
        } finally {
            setLoadingSettings(false);
        }
    }, [selectedNodeId, getBlockingSettings, pushToast]);

    // Load BOTH tabs' domain counts on initial mount or node change
    // This ensures tab counts are accurate even before switching tabs
    useEffect(() => {
        if (selectedNodeId) {
            void loadDomains(true); // Force load both tabs
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedNodeId]);

    // Load data when tab changes (NOT on search or pagination - those are client-side)
    useEffect(() => {
        if (activeTab === 'settings') {
            loadSettings();
        }
        // Domain tabs don't need to reload - data was loaded on mount
        // Reset pagination when changing tabs
        setCurrentPage(0);
        setSearchQuery('');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    // Reset pagination when search changes (client-side filtering)
    useEffect(() => {
        setCurrentPage(0);
    }, [searchQuery]);

    // Validate domain and update error state when search query changes
    useEffect(() => {
        const trimmed = searchQuery.trim().toLowerCase();
        if (!trimmed) {
            setDomainValidationError(null);
            return;
        }
        const validation = validateDomain(trimmed);
        setDomainValidationError(validation.valid ? null : validation.error ?? 'Invalid domain');
    }, [searchQuery]);

    // Handle add domain from search box (updates draft, not saved immediately)
    const handleAddDomainFromSearch = useCallback((domain: string) => {
        const trimmed = domain.trim().toLowerCase();
        if (!trimmed) return;

        // Validate domain before adding
        const validation = validateDomain(trimmed);
        if (!validation.valid) {
            setDomainValidationError(validation.error ?? 'Invalid domain format');
            return;
        }

        // Check if domain exists in the opposite list
        if (activeTab === 'allowed') {
            if (draftBlockedDomains.has(trimmed)) {
                setDomainValidationError('Domain is already in the Blocked list. Remove it from Blocked first.');
                return;
            }
            setDraftAllowedDomains(prev => new Set([...prev, trimmed]));
        } else {
            if (draftAllowedDomains.has(trimmed)) {
                setDomainValidationError('Domain is already in the Allowed list. Remove it from Allowed first.');
                return;
            }
            setDraftBlockedDomains(prev => new Set([...prev, trimmed]));
        }
        // Clear the search and error after adding
        setSearchQuery('');
        setDomainValidationError(null);
    }, [activeTab, draftAllowedDomains, draftBlockedDomains]);

    // Handle delete domain (updates draft, not saved immediately)
    const handleDeleteDomain = useCallback((domain: string) => {
        if (activeTab === 'allowed') {
            setDraftAllowedDomains(prev => {
                const next = new Set(prev);
                next.delete(domain);
                return next;
            });
        } else {
            setDraftBlockedDomains(prev => {
                const next = new Set(prev);
                next.delete(domain);
                return next;
            });
        }
        // Cancel editing if deleting the domain being edited
        if (editingDomain === domain) {
            setEditingDomain(null);
            setEditDomainValue('');
            setEditDomainError(null);
        }
    }, [activeTab, editingDomain]);

    // Handle editing a domain (rename)
    const handleStartEdit = useCallback((domain: string) => {
        setEditingDomain(domain);
        setEditDomainValue(domain);
        setEditDomainError(null);
    }, []);

    const handleCancelEdit = useCallback(() => {
        setEditingDomain(null);
        setEditDomainValue('');
        setEditDomainError(null);
    }, []);

    const handleSaveEdit = useCallback(() => {
        if (!editingDomain) return;

        const trimmed = editDomainValue.trim().toLowerCase();

        // If no change, just cancel
        if (trimmed === editingDomain) {
            handleCancelEdit();
            return;
        }

        // Validate the new domain
        const validation = validateDomain(trimmed);
        if (!validation.valid) {
            setEditDomainError(validation.error ?? 'Invalid domain format');
            return;
        }

        // Check if new domain already exists in current list
        const currentDraft = activeTab === 'allowed' ? draftAllowedDomains : draftBlockedDomains;
        if (currentDraft.has(trimmed)) {
            setEditDomainError('Domain already exists in the list');
            return;
        }

        // Check if new domain exists in the opposite list
        const oppositeDraft = activeTab === 'allowed' ? draftBlockedDomains : draftAllowedDomains;
        if (oppositeDraft.has(trimmed)) {
            setEditDomainError(`Domain is already in the ${activeTab === 'allowed' ? 'Blocked' : 'Allowed'} list`);
            return;
        }

        // Remove old, add new
        if (activeTab === 'allowed') {
            setDraftAllowedDomains(prev => {
                const next = new Set(prev);
                next.delete(editingDomain);
                next.add(trimmed);
                return next;
            });
        } else {
            setDraftBlockedDomains(prev => {
                const next = new Set(prev);
                next.delete(editingDomain);
                next.add(trimmed);
                return next;
            });
        }

        handleCancelEdit();
    }, [editingDomain, editDomainValue, activeTab, draftAllowedDomains, draftBlockedDomains, handleCancelEdit]);

    // Handle toggle blocking enabled (updates draft, not saved immediately)
    const handleToggleBlocking = useCallback(() => {
        if (!draftSettings) return;
        setDraftSettings((prev) => prev ? { ...prev, enableBlocking: !prev.enableBlocking } : null);
    }, [draftSettings]);

    // Handle blocking type change (updates draft)
    const handleBlockingTypeChange = useCallback((newType: BlockingSettings['blockingType']) => {
        setDraftSettings((prev) => prev ? { ...prev, blockingType: newType } : null);
    }, []);

    // Handle add block list URL(s) - supports bulk adding via newlines (updates draft)
    const handleAddBlockListUrl = useCallback(() => {
        if (!newBlockListUrl.trim() || !draftSettings) return;

        // Split by newlines and filter empty/duplicate URLs
        const newUrls = newBlockListUrl
            .split(/[\r\n]+/)
            .map((url) => url.trim())
            .filter((url) => url.length > 0);

        if (newUrls.length === 0) return;

        const currentUrls = draftSettings.blockListUrls ?? [];
        const urlsToAdd = newUrls.filter((url) => !currentUrls.includes(url));

        if (urlsToAdd.length > 0) {
            setDraftSettings((prev) => prev ? {
                ...prev,
                blockListUrls: [...currentUrls, ...urlsToAdd],
            } : null);
        }
        setNewBlockListUrl('');
    }, [newBlockListUrl, draftSettings]);

    // Handle remove block list URL (updates draft)
    const handleRemoveBlockListUrl = useCallback((urlToRemove: string) => {
        setDraftSettings((prev) => {
            if (!prev) return null;
            return {
                ...prev,
                blockListUrls: (prev.blockListUrls ?? []).filter((url) => url !== urlToRemove),
            };
        });
    }, []);

    // Check Hagezi catalog for updates
    const handleCheckCatalogUpdates = useCallback(async () => {
        const result = await fetchHageziCatalog(true);
        if (result?.success) {
            setShowCatalogUpdates(true);
            pushToast({ message: `Found ${result.lists.length} Hagezi block lists`, tone: 'success' });
        } else {
            pushToast({ message: 'Failed to fetch Hagezi catalog', tone: 'error' });
        }
    }, [fetchHageziCatalog, pushToast]);

    // Add a Hagezi list from the catalog to draft
    const handleAddCatalogList = useCallback((list: HageziListInfo) => {
        if (!draftSettings) return;
        const currentUrls = draftSettings.blockListUrls ?? [];
        if (!currentUrls.includes(list.url)) {
            setDraftSettings((prev) => prev ? {
                ...prev,
                blockListUrls: [...currentUrls, list.url],
            } : null);
            pushToast({ message: `Added "${list.name}" to pending changes`, tone: 'success' });
        } else {
            pushToast({ message: 'This list is already added', tone: 'info' });
        }
    }, [draftSettings, pushToast]);

    // Compute available Hagezi lists (not already in draft)
    const availableCatalogLists = useMemo((): HageziListInfo[] => {
        if (!catalog?.lists || !draftSettings) return [];
        const currentUrls = new Set(draftSettings.blockListUrls ?? []);
        return catalog.lists.filter(list => !currentUrls.has(list.url));
    }, [catalog, draftSettings]);

    // Calculate pending changes
    const pendingChanges = useMemo((): PendingChange[] => {
        const changes: PendingChange[] = [];

        // Settings changes (only if settings are loaded)
        if (settings && draftSettings) {
            if (settings.enableBlocking !== draftSettings.enableBlocking) {
                changes.push({
                    type: 'modified',
                    category: 'Enable Blocking',
                    description: draftSettings.enableBlocking ? 'Enable' : 'Disable',
                });
            }

            if (settings.blockingType !== draftSettings.blockingType) {
                changes.push({
                    type: 'modified',
                    category: 'Blocking Type',
                    description: `${settings.blockingType ?? 'NxDomain'} → ${draftSettings.blockingType ?? 'NxDomain'}`,
                });
            }

            // Check custom blocking addresses
            const oldAddrs = (settings.customBlockingAddresses ?? []).sort().join(',');
            const newAddrs = (draftSettings.customBlockingAddresses ?? []).sort().join(',');
            if (oldAddrs !== newAddrs) {
                changes.push({
                    type: 'modified',
                    category: 'Custom Addresses',
                    description: `${draftSettings.customBlockingAddresses?.length ?? 0} address(es)`,
                });
            }

            if (settings.allowTxtBlockingReport !== draftSettings.allowTxtBlockingReport) {
                changes.push({
                    type: 'modified',
                    category: 'TXT Blocking Report',
                    description: draftSettings.allowTxtBlockingReport ? 'Enable' : 'Disable',
                });
            }

            // Compare with normalized values to avoid false positives
            const oldTtl = settings.blockingAnswerTtl ?? 30;
            const newTtl = draftSettings.blockingAnswerTtl ?? 30;
            if (oldTtl !== newTtl) {
                changes.push({
                    type: 'modified',
                    category: 'Blocking Answer TTL',
                    description: `${oldTtl}s → ${newTtl}s`,
                });
            }

            // Compare with normalized values to avoid false positives
            const oldInterval = settings.blockListUrlUpdateIntervalHours ?? 24;
            const newInterval = draftSettings.blockListUrlUpdateIntervalHours ?? 24;
            if (oldInterval !== newInterval) {
                changes.push({
                    type: 'modified',
                    category: 'Update Interval',
                    description: `${oldInterval}h → ${newInterval}h`,
                });
            }

            const oldUrls = settings.blockListUrls ?? [];
            const newUrls = draftSettings.blockListUrls ?? [];
            const addedUrls = newUrls.filter((u) => !oldUrls.includes(u));
            const removedUrls = oldUrls.filter((u) => !newUrls.includes(u));

            // Show each added URL individually
            for (const url of addedUrls) {
                // Extract just the filename for mobile, keep full URL for desktop
                const urlName = url.split('/').pop() || url;
                changes.push({
                    type: 'added',
                    category: 'Block List URL',
                    description: urlName,
                    fullDescription: url,
                });
            }

            // Show each removed URL individually
            for (const url of removedUrls) {
                const urlName = url.split('/').pop() || url;
                changes.push({
                    type: 'removed',
                    category: 'Block List URL',
                    description: urlName,
                    fullDescription: url,
                });
            }
        }

        // Domain changes (independent of settings)
        // Allowed domain changes
        const addedAllowed = [...draftAllowedDomains].filter(d => !baselineAllowedDomains.has(d));
        const removedAllowed = [...baselineAllowedDomains].filter(d => !draftAllowedDomains.has(d));
        for (const domain of addedAllowed) {
            changes.push({
                type: 'added',
                category: 'Allowed Domain',
                description: domain,
            });
        }
        for (const domain of removedAllowed) {
            changes.push({
                type: 'removed',
                category: 'Allowed Domain',
                description: domain,
            });
        }

        // Blocked domain changes
        const addedBlocked = [...draftBlockedDomains].filter(d => !baselineBlockedDomains.has(d));
        const removedBlocked = [...baselineBlockedDomains].filter(d => !draftBlockedDomains.has(d));
        for (const domain of addedBlocked) {
            changes.push({
                type: 'added',
                category: 'Blocked Domain',
                description: domain,
            });
        }
        for (const domain of removedBlocked) {
            changes.push({
                type: 'removed',
                category: 'Blocked Domain',
                description: domain,
            });
        }

        return changes;
    }, [settings, draftSettings, draftAllowedDomains, baselineAllowedDomains, draftBlockedDomains, baselineBlockedDomains]);

    const isDirty = pendingChanges.length > 0;

    // Warn user before navigating away with unsaved changes
    useEffect(() => {
        if (!isDirty) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isDirty]);

    // Save all pending changes (settings + domains)
    const handleSaveAll = useCallback(async () => {
        if (!selectedNodeId || !isDirty) return;

        // Validate custom addresses before saving
        if (customAddressError) {
            pushToast({ message: 'Please fix invalid IP addresses before saving', tone: 'error' });
            return;
        }

        setSaving(true);
        try {
            // 1. Save settings changes if any
            if (draftSettings && settings) {
                const settingsToSave: Partial<BlockingSettings> = {};
                if (settings.enableBlocking !== draftSettings.enableBlocking) {
                    settingsToSave.enableBlocking = draftSettings.enableBlocking;
                }
                if (settings.blockingType !== draftSettings.blockingType) {
                    settingsToSave.blockingType = draftSettings.blockingType;
                }
                const oldAddrs = (settings.customBlockingAddresses ?? []).sort().join(',');
                const newAddrs = (draftSettings.customBlockingAddresses ?? []).sort().join(',');
                if (oldAddrs !== newAddrs) {
                    settingsToSave.customBlockingAddresses = draftSettings.customBlockingAddresses ?? [];
                }
                if (settings.allowTxtBlockingReport !== draftSettings.allowTxtBlockingReport) {
                    settingsToSave.allowTxtBlockingReport = draftSettings.allowTxtBlockingReport;
                }
                if (settings.blockingAnswerTtl !== draftSettings.blockingAnswerTtl) {
                    settingsToSave.blockingAnswerTtl = draftSettings.blockingAnswerTtl;
                }
                if (settings.blockListUrlUpdateIntervalHours !== draftSettings.blockListUrlUpdateIntervalHours) {
                    settingsToSave.blockListUrlUpdateIntervalHours = draftSettings.blockListUrlUpdateIntervalHours;
                }
                if (JSON.stringify(settings.blockListUrls) !== JSON.stringify(draftSettings.blockListUrls)) {
                    settingsToSave.blockListUrls = draftSettings.blockListUrls ?? [];
                }
                if (Object.keys(settingsToSave).length > 0) {
                    await updateBlockingSettings(selectedNodeId, settingsToSave);
                }
            }

            // 2. Save allowed domain changes
            const addedAllowed = [...draftAllowedDomains].filter(d => !baselineAllowedDomains.has(d));
            const removedAllowed = [...baselineAllowedDomains].filter(d => !draftAllowedDomains.has(d));
            for (const domain of addedAllowed) {
                await addAllowedDomain(selectedNodeId, domain);
            }
            for (const domain of removedAllowed) {
                await deleteAllowedDomain(selectedNodeId, domain);
            }

            // 3. Save blocked domain changes
            const addedBlocked = [...draftBlockedDomains].filter(d => !baselineBlockedDomains.has(d));
            const removedBlocked = [...baselineBlockedDomains].filter(d => !draftBlockedDomains.has(d));
            for (const domain of addedBlocked) {
                await addBlockedDomain(selectedNodeId, domain);
            }
            for (const domain of removedBlocked) {
                await deleteBlockedDomain(selectedNodeId, domain);
            }

            pushToast({ message: 'All changes saved successfully', tone: 'success' });

            // Reload data to update baselines (force reload both tabs)
            await loadSettings();
            await loadDomains(true);
            onRefresh();
        } catch (error) {
            pushToast({ message: `Failed to save changes: ${(error as Error).message}`, tone: 'error' });
        } finally {
            setSaving(false);
        }
    }, [
        selectedNodeId, isDirty, customAddressError, draftSettings, settings,
        draftAllowedDomains, baselineAllowedDomains, draftBlockedDomains, baselineBlockedDomains,
        updateBlockingSettings, addAllowedDomain, deleteAllowedDomain, addBlockedDomain, deleteBlockedDomain,
        loadSettings, loadDomains, onRefresh, pushToast,
    ]);

    // Reset all draft state to baseline
    const handleResetAll = useCallback(() => {
        setDraftSettings(settings);
        setDraftAllowedDomains(new Set(baselineAllowedDomains));
        setDraftBlockedDomains(new Set(baselineBlockedDomains));
        setNewBlockListUrl('');
        setSearchQuery('');
        // Reset custom address text to baseline
        setCustomAddressText((settings?.customBlockingAddresses ?? []).join('\n'));
    }, [settings, baselineAllowedDomains, baselineBlockedDomains]);

    // Temporarily disable blocking
    const handleTemporaryDisable = useCallback(async () => {
        if (!selectedNodeId) return;
        try {
            await temporaryDisableBlocking(selectedNodeId, tempDisableMinutes);
            pushToast({ message: `Blocking disabled for ${tempDisableMinutes} minutes`, tone: 'success' });
            await loadSettings();
        } catch (error) {
            pushToast({ message: `Failed to disable blocking: ${(error as Error).message}`, tone: 'error' });
        }
    }, [selectedNodeId, tempDisableMinutes, temporaryDisableBlocking, loadSettings, pushToast]);

    // Re-enable blocking (cancel temporary disable)
    const handleReEnableBlocking = useCallback(async () => {
        if (!selectedNodeId) return;
        try {
            await reEnableBlocking(selectedNodeId);
            pushToast({ message: 'Blocking re-enabled', tone: 'success' });
            await loadSettings();
        } catch (error) {
            pushToast({ message: `Failed to re-enable blocking: ${(error as Error).message}`, tone: 'error' });
        }
    }, [selectedNodeId, reEnableBlocking, loadSettings, pushToast]);

    // Force update block lists
    const handleForceBlockListUpdate = useCallback(async () => {
        if (!selectedNodeId) return;
        try {
            await forceBlockListUpdate(selectedNodeId);
            pushToast({ message: 'Block list update initiated', tone: 'success' });
        } catch (error) {
            pushToast({ message: `Failed to update block lists: ${(error as Error).message}`, tone: 'error' });
        }
    }, [selectedNodeId, forceBlockListUpdate, pushToast]);

    // Validate custom blocking addresses (IPv4 and IPv6)
    const validateCustomAddresses = useCallback((addresses: string[]): string | null => {
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

        for (const addr of addresses) {
            const trimmed = addr.trim();
            if (!trimmed) continue;

            const isValidIpv4 = ipv4Regex.test(trimmed) &&
                trimmed.split('.').every(octet => parseInt(octet, 10) <= 255);
            const isValidIpv6 = ipv6Regex.test(trimmed) || trimmed === '::';

            if (!isValidIpv4 && !isValidIpv6) {
                return `Invalid IP address: ${trimmed}`;
            }
        }
        return null;
    }, []);

    // Handle custom address changes with validation
    const handleCustomAddressChange = useCallback((value: string) => {
        // Store the raw text value to preserve cursor position and newlines while typing
        setCustomAddressText(value);

        // Parse addresses for validation and storage (filter empty lines)
        const addresses = value.split(/[\r\n]+/).map(a => a.trim()).filter(a => a);

        const error = validateCustomAddresses(addresses);
        setCustomAddressError(error);

        setDraftSettings((prev) => prev ? {
            ...prev,
            customBlockingAddresses: addresses,
        } : null);
    }, [validateCustomAddresses]);

    // Sync customAddressText when draftSettings.customBlockingAddresses changes from external source
    // (e.g., when loading settings or switching nodes)
    useEffect(() => {
        if (draftSettings?.customBlockingAddresses) {
            const currentAddresses = customAddressText.split(/[\r\n]+/).map(a => a.trim()).filter(a => a);
            const settingsAddresses = draftSettings.customBlockingAddresses;

            // Only update if the actual addresses differ (not just whitespace)
            if (JSON.stringify(currentAddresses) !== JSON.stringify(settingsAddresses)) {
                setCustomAddressText(settingsAddresses.join('\n'));
            }
        }
    }, [draftSettings?.customBlockingAddresses]);

    if (loading) {
        return (
            <section className="configuration-editor configuration-editor--stacked">
                <p className="configuration-editor__placeholder">
                    <FontAwesomeIcon icon={faSpinner} spin /> Loading built-in blocking data...
                </p>
            </section>
        );
    }

    return (
        <section className="configuration-editor configuration-editor--stacked built-in-blocking-editor">
            {/* Header with metrics */}
            <header className="built-in-blocking-editor__header">
                <div className="built-in-blocking-editor__title">
                    <h2>Built-in Blocking</h2>
                    <p>Manage global allow and block lists for DNS filtering.</p>
                </div>
                {snapshot && (
                    <div className="built-in-blocking-editor__metrics">
                        <div className="built-in-blocking-editor__metric">
                            <span className="built-in-blocking-editor__metric-value">
                                {snapshot.metrics.blockedCount.toLocaleString()}
                            </span>
                            <span className="built-in-blocking-editor__metric-label">Blocked</span>
                        </div>
                        <div className="built-in-blocking-editor__metric">
                            <span className="built-in-blocking-editor__metric-value">
                                {snapshot.metrics.allowedCount.toLocaleString()}
                            </span>
                            <span className="built-in-blocking-editor__metric-label">Allowed</span>
                        </div>
                        <div className="built-in-blocking-editor__metric">
                            <span className={`built-in-blocking-editor__metric-value ${snapshot.metrics.blockingEnabled ? 'built-in-blocking-editor__metric-value--active' : 'built-in-blocking-editor__metric-value--inactive'}`}>
                                {snapshot.metrics.blockingEnabled ? 'ON' : 'OFF'}
                            </span>
                            <span className="built-in-blocking-editor__metric-label">Status</span>
                        </div>
                    </div>
                )}
            </header>

            {/* Tab navigation */}
            <div className="built-in-blocking-editor__tabs">
                <button
                    type="button"
                    className={`built-in-blocking-editor__tab ${activeTab === 'blocked' ? 'built-in-blocking-editor__tab--active' : ''}`}
                    onClick={() => setActiveTab('blocked')}
                >
                    <FontAwesomeIcon icon={faBan} />
                    <span>Blocked</span>
                    <span className="built-in-blocking-editor__tab-count">
                        {draftBlockedDomains.size}
                    </span>
                </button>
                <button
                    type="button"
                    className={`built-in-blocking-editor__tab ${activeTab === 'allowed' ? 'built-in-blocking-editor__tab--active' : ''}`}
                    onClick={() => setActiveTab('allowed')}
                >
                    <FontAwesomeIcon icon={faShieldAlt} />
                    <span>Allowed</span>
                    <span className="built-in-blocking-editor__tab-count">
                        {draftAllowedDomains.size}
                    </span>
                </button>
                <button
                    type="button"
                    className={`built-in-blocking-editor__tab ${activeTab === 'settings' ? 'built-in-blocking-editor__tab--active' : ''}`}
                    onClick={() => setActiveTab('settings')}
                >
                    <FontAwesomeIcon icon={faGear} />
                    <span>Settings</span>
                </button>
            </div>

            {/* Domain list tabs */}
            {(activeTab === 'blocked' || activeTab === 'allowed') && (
                <div className="built-in-blocking-editor__domain-list">
                    {/* Combined search/add input */}
                    <div className="built-in-blocking-editor__controls">
                        <label className="form-label">
                            <FontAwesomeIcon icon={faSearch} /> Search or Add Domain
                        </label>
                        <div className={`built-in-blocking-editor__search-add ${domainValidationError ? 'built-in-blocking-editor__search-add--error' : ''}`}>
                            <input
                                type="text"
                                placeholder={`Search or add domain to ${activeTab} list...`}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && searchQuery.trim()) {
                                        // On Enter, add the domain if it's valid and not already in list
                                        const trimmed = searchQuery.trim().toLowerCase();
                                        const currentDraft = activeTab === 'allowed' ? draftAllowedDomains : draftBlockedDomains;
                                        if (!currentDraft.has(trimmed) && !domainValidationError) {
                                            handleAddDomainFromSearch(trimmed);
                                        }
                                    }
                                }}
                                disabled={saving}
                            />
                            {(() => {
                                const trimmed = searchQuery.trim().toLowerCase();
                                const currentDraft = activeTab === 'allowed' ? draftAllowedDomains : draftBlockedDomains;
                                const alreadyExists = trimmed && currentDraft.has(trimmed);

                                if (!trimmed) return null;

                                if (alreadyExists) {
                                    return (
                                        <span className="built-in-blocking-editor__exists-badge">
                                            <FontAwesomeIcon icon={faCheckCircle} />
                                            <span>In list</span>
                                        </span>
                                    );
                                }

                                // Don't show Add button if there's a validation error
                                if (domainValidationError) return null;

                                return (
                                    <button
                                        type="button"
                                        className="built-in-blocking-editor__add-btn"
                                        onClick={() => handleAddDomainFromSearch(trimmed)}
                                        disabled={saving}
                                        title={`Add "${trimmed}" to ${activeTab} list`}
                                    >
                                        <FontAwesomeIcon icon={faPlus} />
                                        <span>Add</span>
                                    </button>
                                );
                            })()}
                        </div>
                        {domainValidationError ? (
                            <p className="built-in-blocking-editor__validation-error">
                                <FontAwesomeIcon icon={faExclamationTriangle} />
                                {domainValidationError}
                            </p>
                        ) : (
                            <p className="built-in-blocking-editor__hint">
                                Type to search. Press Enter or click Add to add a new domain. Regex not supported.
                            </p>
                        )}
                    </div>

                    {/* Domain table - renders from draft sets with pending indicators */}
                    <div className="built-in-blocking-editor__table-wrapper">
                        {loadingDomains ? (
                            <div className="built-in-blocking-editor__loading">
                                <FontAwesomeIcon icon={faSpinner} spin />
                                <span>Loading domains...</span>
                            </div>
                        ) : (() => {
                            // Get draft and baseline domains for current tab
                            const draftDomains = activeTab === 'allowed' ? draftAllowedDomains : draftBlockedDomains;
                            const baselineDomains = activeTab === 'allowed' ? baselineAllowedDomains : baselineBlockedDomains;

                            // Merge draft + baseline to show pending removals too
                            // A domain in baseline but not in draft = pending removal
                            // A domain in draft but not in baseline = pending add
                            const allDomains = new Set([...draftDomains, ...baselineDomains]);

                            // Filter by search query and sort
                            const filteredDomains = [...allDomains]
                                .filter(d => !searchQuery || d.toLowerCase().includes(searchQuery.toLowerCase()))
                                .sort();

                            // Paginate
                            const startIdx = currentPage * entriesPerPage;
                            const paginatedDomains = filteredDomains.slice(startIdx, startIdx + entriesPerPage);

                            if (paginatedDomains.length === 0) {
                                return (
                                    <div className="built-in-blocking-editor__empty">
                                        <FontAwesomeIcon icon={activeTab === 'blocked' ? faBan : faShieldAlt} />
                                        <p>No {activeTab} domains found</p>
                                        {searchQuery && <p className="built-in-blocking-editor__empty-hint">Try a different search term</p>}
                                    </div>
                                );
                            }

                            return (
                                <table className="built-in-blocking-editor__table">
                                    <thead>
                                        <tr>
                                            <th>Domain</th>
                                            <th className="built-in-blocking-editor__table-actions">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {paginatedDomains.map((domain) => {
                                            const isInDraft = draftDomains.has(domain);
                                            const isInBaseline = baselineDomains.has(domain);
                                            const isPendingAdd = isInDraft && !isInBaseline;
                                            const isPendingRemove = !isInDraft && isInBaseline;
                                            const isEditing = editingDomain === domain;

                                            return (
                                                <tr
                                                    key={domain}
                                                    className={
                                                        isPendingAdd
                                                            ? 'built-in-blocking-editor__row--pending-add'
                                                            : isPendingRemove
                                                                ? 'built-in-blocking-editor__row--pending-remove'
                                                                : ''
                                                    }
                                                >
                                                    <td className="built-in-blocking-editor__domain-cell">
                                                        {isEditing ? (
                                                            <div className="built-in-blocking-editor__edit-inline">
                                                                <input
                                                                    type="text"
                                                                    value={editDomainValue}
                                                                    onChange={(e) => {
                                                                        setEditDomainValue(e.target.value);
                                                                        setEditDomainError(null);
                                                                    }}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') {
                                                                            handleSaveEdit();
                                                                        } else if (e.key === 'Escape') {
                                                                            handleCancelEdit();
                                                                        }
                                                                    }}
                                                                    autoFocus
                                                                    className={editDomainError ? 'built-in-blocking-editor__edit-input--error' : ''}
                                                                />
                                                                {editDomainError && (
                                                                    <span className="built-in-blocking-editor__edit-error">
                                                                        {editDomainError}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <span className={`built-in-blocking-editor__domain-badge built-in-blocking-editor__domain-badge--${activeTab === 'blocked' ? 'blocked' : 'allowed'}`}>
                                                                    {domain}
                                                                </span>
                                                                {isPendingAdd && (
                                                                    <span className="built-in-blocking-editor__pending-badge built-in-blocking-editor__pending-badge--add">
                                                                        + pending
                                                                    </span>
                                                                )}
                                                                {isPendingRemove && (
                                                                    <span className="built-in-blocking-editor__pending-badge built-in-blocking-editor__pending-badge--remove">
                                                                        − pending
                                                                    </span>
                                                                )}
                                                            </>
                                                        )}
                                                    </td>
                                                    <td className="built-in-blocking-editor__table-actions">
                                                        {isEditing ? (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className="built-in-blocking-editor__save-edit-btn"
                                                                    onClick={handleSaveEdit}
                                                                    disabled={saving}
                                                                    title="Save changes"
                                                                >
                                                                    <FontAwesomeIcon icon={faCheck} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="built-in-blocking-editor__cancel-edit-btn"
                                                                    onClick={handleCancelEdit}
                                                                    disabled={saving}
                                                                    title="Cancel edit"
                                                                >
                                                                    <FontAwesomeIcon icon={faTimes} />
                                                                </button>
                                                            </>
                                                        ) : isPendingRemove ? (
                                                            <button
                                                                type="button"
                                                                className="built-in-blocking-editor__undo-btn"
                                                                onClick={() => {
                                                                    // Re-add the domain to draft (undo delete)
                                                                    if (activeTab === 'allowed') {
                                                                        setDraftAllowedDomains(prev => new Set([...prev, domain]));
                                                                    } else {
                                                                        setDraftBlockedDomains(prev => new Set([...prev, domain]));
                                                                    }
                                                                }}
                                                                disabled={saving}
                                                                title="Undo removal"
                                                            >
                                                                <FontAwesomeIcon icon={faSync} />
                                                            </button>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className="built-in-blocking-editor__edit-btn"
                                                                    onClick={() => handleStartEdit(domain)}
                                                                    disabled={saving || editingDomain !== null}
                                                                    title="Edit domain"
                                                                >
                                                                    <FontAwesomeIcon icon={faPencil} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="built-in-blocking-editor__delete-btn"
                                                                    onClick={() => handleDeleteDomain(domain)}
                                                                    disabled={saving}
                                                                    title="Delete domain"
                                                                >
                                                                    <FontAwesomeIcon icon={faTrash} />
                                                                </button>
                                                            </>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            );
                        })()}
                    </div>

                    {/* Pagination */}
                    {(() => {
                        const draftDomains = activeTab === 'allowed' ? draftAllowedDomains : draftBlockedDomains;
                        const baselineDomains = activeTab === 'allowed' ? baselineAllowedDomains : baselineBlockedDomains;
                        const allDomains = new Set([...draftDomains, ...baselineDomains]);
                        const filteredCount = [...allDomains].filter(d => !searchQuery || d.toLowerCase().includes(searchQuery.toLowerCase())).length;
                        const totalPagesCalc = Math.ceil(filteredCount / entriesPerPage);

                        if (totalPagesCalc <= 1) return null;

                        return (
                            <div className="built-in-blocking-editor__pagination">
                                <button
                                    type="button"
                                    disabled={currentPage === 0}
                                    onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                                >
                                    Previous
                                </button>
                                <span>
                                    Page {currentPage + 1} of {totalPagesCalc}
                                </span>
                                <button
                                    type="button"
                                    disabled={currentPage >= totalPagesCalc - 1}
                                    onClick={() => setCurrentPage((p) => p + 1)}
                                >
                                    Next
                                </button>
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* Settings tab */}
            {activeTab === 'settings' && (
                <div className="built-in-blocking-editor__settings">
                    {loadingSettings ? (
                        <div className="built-in-blocking-editor__loading">
                            <FontAwesomeIcon icon={faSpinner} spin />
                            <span>Loading settings...</span>
                        </div>
                    ) : draftSettings ? (
                        <>
                            {/* Conflict Warning Banner */}
                            {advancedBlockingActive && draftSettings.enableBlocking && (
                                <div className="built-in-blocking-editor__warning-banner">
                                    <div className="built-in-blocking-editor__warning-icon">
                                        <FontAwesomeIcon icon={faExclamationTriangle} />
                                    </div>
                                    <div className="built-in-blocking-editor__warning-content">
                                        <strong>⚠️ Potential Conflict</strong>
                                        <p>
                                            Both Built-in Blocking and Advanced Blocking are enabled. According to
                                            the Technitium DNS developer, this can cause unpredictable behavior.
                                        </p>
                                        <a
                                            href={TECHNITIUM_DEV_ADV_BLOCK_POST_URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="built-in-blocking-editor__warning-link"
                                        >
                                            Read the developer's explanation <FontAwesomeIcon icon={faExternalLinkAlt} />
                                        </a>
                                    </div>
                                </div>
                            )}

                            {/* Enable Blocking */}
                            <div className="built-in-blocking-editor__setting">
                                <div className="built-in-blocking-editor__setting-info">
                                    <label htmlFor="built-in-blocking-enabled">Enable Blocking</label>
                                    <p>Turn DNS blocking on or off globally</p>
                                </div>
                                <label className="checkbox">
                                    <input
                                        id="built-in-blocking-enabled"
                                        type="checkbox"
                                        checked={draftSettings.enableBlocking ?? false}
                                        onChange={handleToggleBlocking}
                                        disabled={saving}
                                    />
                                    <span className="sr-only">Enable Blocking</span>
                                </label>
                            </div>

                            {/* Blocking Type Dropdown */}
                            <div className="built-in-blocking-editor__setting">
                                <div className="built-in-blocking-editor__setting-info">
                                    <label htmlFor="blocking-type">Blocking Type</label>
                                    <p>How blocked domains are handled</p>
                                </div>
                                <select
                                    id="blocking-type"
                                    className="built-in-blocking-editor__select"
                                    value={draftSettings.blockingType ?? 'NxDomain'}
                                    onChange={(e) => handleBlockingTypeChange(e.target.value as BlockingSettings['blockingType'])}
                                    disabled={saving}
                                >
                                    <option value="NxDomain">NxDomain (Non-Existent Domain)</option>
                                    <option value="AnyAddress">ANY Address (0.0.0.0 / ::)</option>
                                    <option value="CustomAddress">Custom Address</option>
                                </select>
                            </div>

                            {/* Custom Blocking Addresses (shown when blockingType is CustomAddress) */}
                            {draftSettings.blockingType === 'CustomAddress' && (
                                <div className="built-in-blocking-editor__setting built-in-blocking-editor__setting--vertical">
                                    <div className="built-in-blocking-editor__setting-info">
                                        <label htmlFor="custom-blocking-addresses">Custom Blocking Addresses</label>
                                        <p>IPv4 and/or IPv6 addresses returned for blocked domains (one per line)</p>
                                    </div>
                                    <textarea
                                        id="custom-blocking-addresses"
                                        className="built-in-blocking-editor__textarea"
                                        placeholder={"192.168.1.1\n::1\n(one IP per line)"}
                                        value={customAddressText}
                                        onChange={(e) => handleCustomAddressChange(e.target.value)}
                                        disabled={saving}
                                        rows={4}
                                        style={{ minHeight: '100px' }}
                                    />
                                    {customAddressError && (
                                        <p className="built-in-blocking-editor__error">{customAddressError}</p>
                                    )}
                                </div>
                            )}

                            {/* Allow TXT Blocking Report */}
                            <div className="built-in-blocking-editor__setting">
                                <div className="built-in-blocking-editor__setting-info">
                                    <label htmlFor="allow-txt-blocking-report">Allow TXT Blocking Report</label>
                                    <p>Return blocking info in TXT record responses</p>
                                </div>
                                <label className="checkbox">
                                    <input
                                        id="allow-txt-blocking-report"
                                        type="checkbox"
                                        checked={draftSettings.allowTxtBlockingReport ?? true}
                                        onChange={() => setDraftSettings((prev) => prev ? { ...prev, allowTxtBlockingReport: !prev.allowTxtBlockingReport } : null)}
                                        disabled={saving}
                                    />
                                    <span className="sr-only">Allow TXT Blocking Report</span>
                                </label>
                            </div>

                            {/* Blocking Answer TTL */}
                            <div className="built-in-blocking-editor__setting">
                                <div className="built-in-blocking-editor__setting-info">
                                    <label htmlFor="blocking-answer-ttl">Blocking Answer TTL</label>
                                    <p>TTL (seconds) for blocked domain responses</p>
                                </div>
                                <input
                                    id="blocking-answer-ttl"
                                    type="number"
                                    className="built-in-blocking-editor__input built-in-blocking-editor__input--number"
                                    value={draftSettings.blockingAnswerTtl ?? 30}
                                    onChange={(e) => setDraftSettings((prev) => prev ? { ...prev, blockingAnswerTtl: parseInt(e.target.value, 10) || 30 } : null)}
                                    min={0}
                                    max={86400}
                                    disabled={saving}
                                />
                            </div>

                            {/* Block List Update Interval */}
                            <div className="built-in-blocking-editor__setting">
                                <div className="built-in-blocking-editor__setting-info">
                                    <label htmlFor="blocklist-update-interval">Block List Update Interval</label>
                                    <p>Hours between automatic block list updates (0-168)</p>
                                </div>
                                <input
                                    id="blocklist-update-interval"
                                    type="number"
                                    className="built-in-blocking-editor__input built-in-blocking-editor__input--number"
                                    value={draftSettings.blockListUrlUpdateIntervalHours ?? 24}
                                    onChange={(e) => {
                                        const parsed = parseInt(e.target.value, 10);
                                        const value = Number.isNaN(parsed) ? 24 : Math.min(168, Math.max(0, parsed));
                                        setDraftSettings((prev) => prev ? { ...prev, blockListUrlUpdateIntervalHours: value } : null);
                                    }}
                                    min={0}
                                    max={168}
                                    disabled={saving}
                                />
                            </div>

                            {/* Temporary Disable Section */}
                            <div className="built-in-blocking-editor__setting built-in-blocking-editor__setting--vertical">
                                <div className="built-in-blocking-editor__setting-info">
                                    <label>Temporarily Disable Blocking</label>
                                    <p>Pause blocking for a specified duration</p>
                                </div>
                                {settings?.temporaryDisableBlockingTill && new Date(settings.temporaryDisableBlockingTill) > new Date() ? (
                                    <div className="built-in-blocking-editor__temp-disable-active">
                                        <span className="built-in-blocking-editor__temp-disable-status">
                                            <FontAwesomeIcon icon={faExclamationTriangle} />
                                            Blocking disabled until: {new Date(settings.temporaryDisableBlockingTill).toLocaleString()}
                                        </span>
                                        <button
                                            type="button"
                                            className="built-in-blocking-editor__btn built-in-blocking-editor__btn--primary"
                                            onClick={() => void handleReEnableBlocking()}
                                            disabled={saving}
                                        >
                                            Re-enable Now
                                        </button>
                                    </div>
                                ) : (
                                    <div className="built-in-blocking-editor__temp-disable-controls">
                                        <select
                                            id="temp-disable-duration"
                                            className="built-in-blocking-editor__select"
                                            value={tempDisableMinutes}
                                            onChange={(e) => setTempDisableMinutes(parseInt(e.target.value, 10))}
                                            disabled={saving}
                                        >
                                            <option value={5}>5 minutes</option>
                                            <option value={15}>15 minutes</option>
                                            <option value={30}>30 minutes</option>
                                            <option value={60}>1 hour</option>
                                            <option value={120}>2 hours</option>
                                            <option value={240}>4 hours</option>
                                            <option value={480}>8 hours</option>
                                            <option value={1440}>24 hours</option>
                                        </select>
                                        <button
                                            type="button"
                                            className="built-in-blocking-editor__btn built-in-blocking-editor__btn--warning"
                                            onClick={() => void handleTemporaryDisable()}
                                            disabled={saving}
                                        >
                                            <FontAwesomeIcon icon={faBan} />
                                            Disable Blocking
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Force Update Block Lists */}
                            <div className="built-in-blocking-editor__setting">
                                <div className="built-in-blocking-editor__setting-info">
                                    <label>Force Block List Update</label>
                                    <p>Manually trigger an immediate update of all block lists</p>
                                </div>
                                <button
                                    type="button"
                                    className="built-in-blocking-editor__btn"
                                    onClick={() => void handleForceBlockListUpdate()}
                                    disabled={saving}
                                >
                                    <FontAwesomeIcon icon={faSync} />
                                    Update Now
                                </button>
                            </div>

                            {/* Block List URLs Management */}
                            <div className="built-in-blocking-editor__setting built-in-blocking-editor__setting--vertical">
                                <div className="built-in-blocking-editor__setting-header">
                                    <div className="built-in-blocking-editor__setting-info">
                                        <label>Block List URLs ({draftSettings.blockListUrls?.length ?? 0})</label>
                                        <p>External block lists to download and use for blocking</p>
                                    </div>

                                    {/* Quick Add - Predefined block lists */}
                                    <div className="built-in-blocking-editor__quick-add">
                                        <select
                                            id="quick-add-list"
                                            className="built-in-blocking-editor__select"
                                            value=""
                                            onChange={(e) => {
                                                const selectedUrl = e.target.value;
                                                if (selectedUrl && draftSettings) {
                                                    const currentUrls = draftSettings.blockListUrls ?? [];
                                                    if (!currentUrls.includes(selectedUrl)) {
                                                        setDraftSettings((prev) => prev ? {
                                                            ...prev,
                                                            blockListUrls: [...currentUrls, selectedUrl],
                                                        } : null);
                                                        pushToast({ message: 'Block list added to pending changes', tone: 'success' });
                                                    } else {
                                                        pushToast({ message: 'This list is already added', tone: 'info' });
                                                    }
                                                }
                                            }}
                                            disabled={saving}
                                        >
                                            <option value="">Quick Add...</option>
                                            <optgroup label="🛡️ Hagezi Multi (Recommended)">
                                                {PREDEFINED_BLOCK_LISTS.filter(l => l.category === 'hagezi' && l.name.includes('Light') || l.name.includes('Normal') || l.name.includes('Pro') || l.name.includes('Ultimate')).slice(0, 5).map(list => (
                                                    <option key={list.url} value={list.url} title={list.description}>
                                                        {list.name}
                                                    </option>
                                                ))}
                                            </optgroup>
                                            <optgroup label="🔒 Hagezi Specialized">
                                                {PREDEFINED_BLOCK_LISTS.filter(l => l.category === 'hagezi' && !l.name.includes('Light') && !l.name.includes('Normal') && !l.name.includes('Pro') && !l.name.includes('Ultimate')).map(list => (
                                                    <option key={list.url} value={list.url} title={list.description}>
                                                        {list.name}
                                                    </option>
                                                ))}
                                            </optgroup>
                                            <optgroup label="📋 Steven Black">
                                                {PREDEFINED_BLOCK_LISTS.filter(l => l.category === 'stevenblack').map(list => (
                                                    <option key={list.url} value={list.url} title={list.description}>
                                                        {list.name}
                                                    </option>
                                                ))}
                                            </optgroup>
                                            <optgroup label="🌐 OISD">
                                                {PREDEFINED_BLOCK_LISTS.filter(l => l.category === 'oisd').map(list => (
                                                    <option key={list.url} value={list.url} title={list.description}>
                                                        {list.name}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        </select>
                                    </div>
                                </div>

                                {/* Add URL input - supports bulk adding */}
                                <div className="built-in-blocking-editor__url-add built-in-blocking-editor__url-add--bulk">
                                    <textarea
                                        placeholder="https://example.com/blocklist.txt&#10;https://another.com/list.txt&#10;(one URL per line)"
                                        value={newBlockListUrl}
                                        onChange={(e) => setNewBlockListUrl(e.target.value)}
                                        disabled={saving}
                                        rows={3}
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddBlockListUrl}
                                        disabled={!newBlockListUrl.trim() || saving}
                                    >
                                        <FontAwesomeIcon icon={faPlus} />
                                        <span>Add URL{newBlockListUrl.includes('\n') ? 's' : ''}</span>
                                    </button>
                                </div>

                                {/* Check for Catalog Updates */}
                                <div className="built-in-blocking-editor__catalog-check">
                                    <button
                                        type="button"
                                        className="built-in-blocking-editor__catalog-check-btn"
                                        onClick={() => void handleCheckCatalogUpdates()}
                                        disabled={catalogLoading || saving}
                                    >
                                        {catalogLoading ? (
                                            <FontAwesomeIcon icon={faSpinner} spin />
                                        ) : (
                                            <FontAwesomeIcon icon={faSync} />
                                        )}
                                        <span>Check Hagezi for Updates</span>
                                    </button>
                                    {catalog && (
                                        <span className="built-in-blocking-editor__catalog-timestamp">
                                            Last checked: {new Date(catalog.timestamp).toLocaleTimeString()}
                                        </span>
                                    )}
                                </div>

                                {/* Catalog Updates Panel */}
                                {showCatalogUpdates && catalog?.lists && (
                                    <div className="built-in-blocking-editor__catalog-panel">
                                        <div className="built-in-blocking-editor__catalog-header">
                                            <h4>
                                                <FontAwesomeIcon icon={faShieldAlt} />
                                                Available Hagezi Block Lists ({availableCatalogLists.length} new)
                                            </h4>
                                            <button
                                                type="button"
                                                className="built-in-blocking-editor__catalog-close"
                                                onClick={() => setShowCatalogUpdates(false)}
                                            >
                                                ×
                                            </button>
                                        </div>
                                        {availableCatalogLists.length > 0 ? (
                                            <ul className="built-in-blocking-editor__catalog-list">
                                                {availableCatalogLists.map((list) => (
                                                    <li key={list.id} className="built-in-blocking-editor__catalog-item">
                                                        <div className="built-in-blocking-editor__catalog-item-info">
                                                            <span className="built-in-blocking-editor__catalog-item-name">{list.name}</span>
                                                            <span className="built-in-blocking-editor__catalog-item-desc">{list.description}</span>
                                                            <span className={`built-in-blocking-editor__catalog-item-category built-in-blocking-editor__catalog-item-category--${list.category}`}>
                                                                {list.category}
                                                            </span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className="built-in-blocking-editor__catalog-item-add"
                                                            onClick={() => handleAddCatalogList(list)}
                                                            disabled={saving}
                                                            title="Add to pending changes"
                                                        >
                                                            <FontAwesomeIcon icon={faPlus} />
                                                        </button>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            <div className="built-in-blocking-editor__catalog-empty">
                                                <FontAwesomeIcon icon={faCheckCircle} />
                                                <p>You have all available Hagezi lists!</p>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* URL list */}
                                {draftSettings.blockListUrls && draftSettings.blockListUrls.length > 0 ? (
                                    <ul className="built-in-blocking-editor__url-list built-in-blocking-editor__url-list--editable">
                                        {draftSettings.blockListUrls.map((url, index) => (
                                            <li key={index}>
                                                <span className="built-in-blocking-editor__url-text">{url}</span>
                                                <button
                                                    type="button"
                                                    className="built-in-blocking-editor__url-remove"
                                                    onClick={() => handleRemoveBlockListUrl(url)}
                                                    disabled={saving}
                                                    title="Remove URL"
                                                >
                                                    <FontAwesomeIcon icon={faTrash} />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="built-in-blocking-editor__url-empty">No block list URLs configured</p>
                                )}
                            </div>

                            {/* Update Interval (read-only for now) */}
                            {settings?.blockListUrlUpdateIntervalHours && (
                                <div className="built-in-blocking-editor__setting">
                                    <div className="built-in-blocking-editor__setting-info">
                                        <label>Update Interval</label>
                                        <p>How often block lists are refreshed</p>
                                    </div>
                                    <span className="built-in-blocking-editor__setting-value">
                                        Every {settings.blockListUrlUpdateIntervalHours} hours
                                    </span>
                                </div>
                            )}

                            {/* Developer recommendation note */}
                            <div className="built-in-blocking-editor__settings-note built-in-blocking-editor__settings-note--info">
                                <p>
                                    <strong>💡 Tip:</strong> If using Advanced Blocking, disable Built-in Blocking to avoid conflicts.
                                    <a
                                        href={TECHNITIUM_DEV_ADV_BLOCK_POST_URL}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        Learn more from the Technitium developer <FontAwesomeIcon icon={faExternalLinkAlt} />
                                    </a>
                                </p>
                            </div>
                        </>
                    ) : (
                        <div className="built-in-blocking-editor__empty">
                            <p>Unable to load settings</p>
                        </div>
                    )}
                </div>
            )}

            {/* Pending Changes Footer */}
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
                                                <FontAwesomeIcon icon={change.type === 'added' ? faPlus : change.type === 'removed' ? faTrash : faPencil} />
                                            </span>
                                            <span className="change-type">{change.category}</span>
                                            <span className="change-group" style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                                                {change.fullDescription ? (
                                                    <>
                                                        <span className="change-group__full">{change.fullDescription}</span>
                                                        <span className="change-group__short">{change.description}</span>
                                                    </>
                                                ) : (
                                                    change.description
                                                )}
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
                        onClick={handleResetAll}
                        disabled={!isDirty || saving}
                    >
                        Reset
                    </button>
                    <button
                        type="button"
                        className="primary"
                        onClick={() => void handleSaveAll()}
                        disabled={!isDirty || saving}
                    >
                        {saving ? (
                            <>
                                <FontAwesomeIcon icon={faSpinner} spin />
                                Saving...
                            </>
                        ) : (
                            'Save Changes'
                        )}
                    </button>
                </div>
            </footer>
        </section>
    );
}
