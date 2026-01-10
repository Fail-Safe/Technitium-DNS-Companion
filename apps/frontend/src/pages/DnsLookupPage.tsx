import {
  faBan,
  faCheck,
  faClipboard,
  faRotate,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import React, { useCallback, useState } from "react";
import { ClusterInfoBanner } from "../components/common/ClusterInfoBanner";
import { PullToRefreshIndicator } from "../components/common/PullToRefreshIndicator";
import { apiFetch } from "../config";
import { useTechnitiumState } from "../context/useTechnitiumState";
import { useToast } from "../context/useToast";
import { useIsClusterEnabled, usePrimaryNode } from "../hooks/usePrimaryNode";
import { usePullToRefresh } from "../hooks/usePullToRefresh";
import type {
  AllDomainEntry,
  AllDomainsResponse,
  DomainCheckResult,
  DomainSource,
  GroupPolicyResult,
} from "../types/technitium";
import { consolidateDomainsByType } from "../utils/domainConsolidation";
import { extractDomainFromInput } from "../utils/urlParsing";
import "./DnsLookupPage.css";

export const DnsLookupPage: React.FC = () => {
  const { nodes } = useTechnitiumState();
  const { pushToast } = useToast();
  const primaryNode = usePrimaryNode(nodes);
  const isClusterEnabled = useIsClusterEnabled(nodes);

  const [domain, setDomain] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [policyResult, setPolicyResult] = useState<GroupPolicyResult | null>(
    null,
  );
  const [globalCheckResult, setGlobalCheckResult] =
    useState<DomainCheckResult | null>(null);
  const [activeTab, setActiveTab] = useState<"lookup" | "domains">("lookup");

  // Domain Lists tab state
  const [allDomains, setAllDomains] = useState<AllDomainEntry[]>([]);
  const [fullDomainCache, setFullDomainCache] = useState<AllDomainEntry[]>([]); // Full unfiltered cache for client-side filtering
  const [lastRefreshed, setLastRefreshed] = React.useState<string | null>(null);
  const [showSearchHelp, setShowSearchHelp] = React.useState<boolean>(() => {
    return localStorage.getItem("domainListsSearchHelpDismissed") !== "true";
  });
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [activeSearchTerm, setActiveSearchTerm] = useState(""); // The search term used for current results
  const [searchMode, setSearchMode] = useState<"text" | "regex">("text");
  const [typeFilter, setTypeFilter] = useState<"all" | "allow" | "block">(
    "all",
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalDomains, setTotalDomains] = useState(0);
  const [pageSize] = useState(1000);
  const [isSearchPending, setIsSearchPending] = useState(false);
  const [useClientSideFiltering, setUseClientSideFiltering] = useState(false); // Switch between client/server filtering
  const [regexValid, setRegexValid] = useState(true);
  const [regexError, setRegexError] = useState("");
  const abortControllerRef = React.useRef<AbortController | null>(null);

  // Exact match check (All Domains tab, Text mode only)
  const [exactCheckDomain, setExactCheckDomain] = useState("");
  const [exactCheckResult, setExactCheckResult] =
    useState<DomainCheckResult | null>(null);
  const [exactCheckLoading, setExactCheckLoading] = useState(false);
  const [exactCheckError, setExactCheckError] = useState("");
  const exactCheckAbortRef = React.useRef<AbortController | null>(null);

  // Regex Preview (All Domains tab, regex mode)
  const [regexPreviewCollapsed, setRegexPreviewCollapsed] =
    React.useState<boolean>(() => {
      return localStorage.getItem("dnsLookupRegexPreviewCollapsed") === "true";
    });

  // Auto-select first node (or Primary if in cluster mode)
  React.useEffect(() => {
    if (nodes.length > 0 && !selectedNodeId) {
      // If clustering is enabled, auto-select Primary node
      if (isClusterEnabled && primaryNode) {
        setSelectedNodeId(primaryNode.id);
      } else if (nodes.length > 0) {
        setSelectedNodeId(nodes[0].id);
      }
    }
    // If clustering was just enabled and current selection is not Primary, switch to Primary
    else if (
      isClusterEnabled &&
      primaryNode &&
      selectedNodeId !== primaryNode.id
    ) {
      setSelectedNodeId(primaryNode.id);
    }
  }, [nodes, selectedNodeId, isClusterEnabled, primaryNode]);

  // Load available groups when node changes
  React.useEffect(() => {
    const loadGroups = async () => {
      if (!selectedNodeId) return;

      try {
        const response = await apiFetch(`/advanced-blocking/${selectedNodeId}`);
        const data = await response.json();
        if (data.config?.groups && Array.isArray(data.config.groups)) {
          const groupNames = data.config.groups.map(
            (group: { name: string }) => group.name,
          );
          setAvailableGroups(groupNames);
          if (groupNames.length > 0 && !selectedGroup) {
            setSelectedGroup(groupNames[0]);
          }
        }
      } catch (error) {
        console.error("Failed to load groups:", error);
      }
    };

    loadGroups();
  }, [selectedNodeId, selectedGroup]);

  // Unified domain lookup handler - calls both policy sim and global check
  const handleDomainLookup = async () => {
    const extractedDomain = extractDomainFromInput(domain);

    if (!extractedDomain) {
      pushToast({ message: "Please enter a domain name or URL" });
      return;
    }

    if (!selectedNodeId) {
      pushToast({ message: "Please select a node" });
      return;
    }

    setLoading(true);
    setPolicyResult(null);
    setGlobalCheckResult(null);

    try {
      // Call both APIs in parallel
      const [policyResponse, globalResponse] = await Promise.all([
        selectedGroup ?
          apiFetch(
            `/domain-lists/${selectedNodeId}/simulate?group=${encodeURIComponent(selectedGroup)}&domain=${encodeURIComponent(extractedDomain)}`,
          )
        : Promise.resolve(null),
        apiFetch(
          `/domain-lists/${selectedNodeId}/check?domain=${encodeURIComponent(extractedDomain)}`,
        ),
      ]);

      // Process policy result
      if (policyResponse) {
        const policyData = await policyResponse.json();
        setPolicyResult(policyData);
      }

      // Process global check result
      const globalData = await globalResponse.json();
      setGlobalCheckResult(globalData);
    } catch (error) {
      pushToast({
        message: `Failed to check domain: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const loadAllDomains = useCallback(
    async (
      page: number = 1,
      searchTerm?: string,
      forceRefresh: boolean = false,
      abortSignal?: AbortSignal,
    ) => {
      if (!selectedNodeId) {
        pushToast({ message: "Please select a node" });
        return;
      }

      setLoadingDomains(true);
      setIsSearchPending(false);

      // Use provided search term or current searchFilter
      const effectiveSearchTerm =
        searchTerm !== undefined ? searchTerm : searchFilter;

      try {
        // If we have a full cache and not forcing refresh, try client-side filtering first
        if (
          !forceRefresh &&
          fullDomainCache.length > 0 &&
          fullDomainCache.length <= 100000
        ) {
          // Client-side filtering for datasets under 100k
          setUseClientSideFiltering(true);
          setActiveSearchTerm(effectiveSearchTerm);
          setLoadingDomains(false);
          return;
        }

        // Server-side filtering for large datasets or initial load
        setUseClientSideFiltering(false);

        // Build query parameters
        const params = new URLSearchParams();
        if (effectiveSearchTerm.trim()) {
          params.append("search", effectiveSearchTerm.trim());
          params.append("searchMode", searchMode);
        }
        if (typeFilter !== "all") {
          params.append("type", typeFilter);
        }
        params.append("page", page.toString());
        params.append("limit", pageSize.toString());

        const url = `/domain-lists/${selectedNodeId}/all-domains?${params.toString()}`;
        const response = await apiFetch(url, { signal: abortSignal });

        // Check if request was aborted
        if (abortSignal?.aborted) {
          return;
        }

        const result: AllDomainsResponse = await response.json();

        setAllDomains(result.domains);
        setLastRefreshed(result.lastRefreshed);
        setCurrentPage(result.pagination.page);
        setTotalPages(result.pagination.totalPages);
        setTotalDomains(result.pagination.total);
        setActiveSearchTerm(effectiveSearchTerm);

        // Cache full results if it's a reasonable size (no filters and under 100k)
        if (
          !effectiveSearchTerm &&
          typeFilter === "all" &&
          result.pagination.total <= 100000
        ) {
          setFullDomainCache(result.domains);
        }
      } catch (error) {
        // Ignore abort errors
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
        pushToast({
          message: `Failed to load domains: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      } finally {
        setLoadingDomains(false);
      }
    },
    [
      selectedNodeId,
      pushToast,
      searchFilter,
      typeFilter,
      pageSize,
      searchMode,
      fullDomainCache,
    ],
  );

  const handleRefreshDomains = async () => {
    if (!selectedNodeId) {
      pushToast({ message: "Please select a node" });
      return;
    }

    setLoadingDomains(true);

    try {
      const response = await apiFetch(
        `/domain-lists/${selectedNodeId}/refresh`,
        { method: "POST" },
      );
      await response.json();
      pushToast({ message: "Lists refreshed successfully", tone: "success" });

      // Clear cache, search filter, and force server-side reload
      setFullDomainCache([]);
      setUseClientSideFiltering(false);
      setSearchFilter(""); // Clear search to show all domains after refresh
      await loadAllDomains(1, "", true);
    } catch (error) {
      pushToast({
        message: `Failed to refresh lists: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
      setLoadingDomains(false);
    }
  };

  // Pull-to-refresh functionality
  const handlePullToRefresh = useCallback(async () => {
    if (activeTab === "domains" && selectedNodeId) {
      await loadAllDomains(1, searchFilter, true);
    }
    // For policy and global tabs, there's no data to refresh without user input
  }, [activeTab, selectedNodeId, searchFilter, loadAllDomains]);

  const pullToRefresh = usePullToRefresh({
    onRefresh: handlePullToRefresh,
    threshold: 80,
    disabled: !selectedNodeId,
  });

  // Load domains when tab is activated
  React.useEffect(() => {
    if (activeTab === "domains" && selectedNodeId && allDomains.length === 0) {
      loadAllDomains();
    }
  }, [activeTab, selectedNodeId, allDomains.length, loadAllDomains]);

  // Validate regex as user types (only in regex mode)
  React.useEffect(() => {
    if (searchMode !== "regex" || !searchFilter.trim()) {
      setRegexValid(true);
      setRegexError("");
      return;
    }

    try {
      new RegExp(searchFilter);
      setRegexValid(true);
      setRegexError("");
    } catch (error) {
      setRegexValid(false);
      setRegexError(error instanceof Error ? error.message : "Invalid regex");
    }
  }, [searchFilter, searchMode]);

  // Exact match lookup for All Domains search (helps when the match isn't on page 1)
  React.useEffect(() => {
    if (activeTab !== "domains" || !selectedNodeId) return;

    // Only show/use this in Text mode (regex mode would be misleading)
    if (searchMode !== "text") {
      if (exactCheckAbortRef.current) exactCheckAbortRef.current.abort();
      setExactCheckDomain("");
      setExactCheckResult(null);
      setExactCheckLoading(false);
      setExactCheckError("");
      return;
    }

    const extracted = extractDomainFromInput(searchFilter);
    const trimmed = extracted.trim();
    const isDomainLike = trimmed.includes(".") || trimmed.startsWith("[");

    if (!searchFilter.trim() || !trimmed || !isDomainLike) {
      if (exactCheckAbortRef.current) exactCheckAbortRef.current.abort();
      setExactCheckDomain("");
      setExactCheckResult(null);
      setExactCheckLoading(false);
      setExactCheckError("");
      return;
    }

    setExactCheckDomain(trimmed);
    setExactCheckLoading(true);
    setExactCheckError("");

    // Cancel any in-flight exact check
    if (exactCheckAbortRef.current) {
      exactCheckAbortRef.current.abort();
    }

    const controller = new AbortController();
    exactCheckAbortRef.current = controller;

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await apiFetch(
          `/domain-lists/${selectedNodeId}/check?domain=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );

        if (controller.signal.aborted) return;

        const data: DomainCheckResult = await response.json();
        setExactCheckResult(data);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setExactCheckResult(null);
        setExactCheckError(
          error instanceof Error ? error.message : "Unknown error",
        );
      } finally {
        if (!controller.signal.aborted) {
          setExactCheckLoading(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeTab, selectedNodeId, searchMode, searchFilter]);

  // Client-side filtering - instant when we have full cache
  const clientFilteredDomains = React.useMemo(() => {
    if (!useClientSideFiltering || fullDomainCache.length === 0) {
      return allDomains;
    }

    let filtered = fullDomainCache;

    // Type filter
    if (typeFilter !== "all") {
      filtered = filtered.filter((d) => d.type === typeFilter);
    }

    // Search filter
    if (searchFilter.trim()) {
      if (searchMode === "text") {
        const searchLower = searchFilter.toLowerCase().trim();
        filtered = filtered.filter((d) =>
          d.domain.toLowerCase().includes(searchLower),
        );
      } else if (searchMode === "regex" && regexValid) {
        try {
          const regex = new RegExp(searchFilter);
          filtered = filtered.filter((d) => regex.test(d.domain));
        } catch {
          // Invalid regex, return empty
          filtered = [];
        }
      }
    }

    return filtered;
  }, [
    useClientSideFiltering,
    fullDomainCache,
    typeFilter,
    searchFilter,
    searchMode,
    regexValid,
    allDomains,
  ]);

  // Debounced search with request cancellation - reload domains when search/filters change
  React.useEffect(() => {
    if (activeTab !== "domains" || !selectedNodeId) return;

    // If using client-side filtering, update activeSearchTerm instantly
    if (useClientSideFiltering && fullDomainCache.length > 0) {
      setActiveSearchTerm(searchFilter);
      setIsSearchPending(false);
      return;
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Show pending indicator immediately for server-side
    setIsSearchPending(true);

    // Shorter debounce for server-side (150ms instead of 250ms)
    const timeoutId = setTimeout(() => {
      // Create new abort controller for this request
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setCurrentPage(1); // Reset to page 1 on new search
      loadAllDomains(1, searchFilter, false, abortController.signal);
    }, 150); // 150ms debounce - aggressive but still prevents too many requests

    return () => {
      clearTimeout(timeoutId);
      // Cancel request if user types again before debounce completes
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [
    searchFilter,
    searchMode,
    typeFilter,
    selectedNodeId,
    activeTab,
    useClientSideFiltering,
    fullDomainCache,
    loadAllDomains,
  ]);

  // Use client-filtered or server-filtered domains
  const displayedDomains =
    useClientSideFiltering ? clientFilteredDomains : allDomains;

  // Consolidate domains - one row per domain+type, with sources grouped by identical groups
  const consolidatedDomains = React.useMemo(() => {
    return consolidateDomainsByType(displayedDomains);
  }, [displayedDomains]);

  const regexPreview = React.useMemo(() => {
    if (searchMode !== "regex" || !regexValid || !activeSearchTerm.trim()) {
      return null;
    }

    try {
      const regex = new RegExp(activeSearchTerm);
      const matches = consolidatedDomains.filter((d) => regex.test(d.domain));
      return {
        count: matches.length,
        sample: matches.slice(0, 10).map((m) => m.domain),
      };
    } catch {
      return { count: 0, sample: [] as string[] };
    }
  }, [searchMode, regexValid, activeSearchTerm, consolidatedDomains]);

  const toggleRegexPreviewCollapsed = () => {
    setRegexPreviewCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(
        "dnsLookupRegexPreviewCollapsed",
        next ? "true" : "false",
      );
      return next;
    });
  };

  const getActionBadgeClass = (action: string): string => {
    switch (action) {
      case "blocked":
        return "dns-lookup__badge--blocked";
      case "allowed":
        return "dns-lookup__badge--allowed";
      case "none":
        return "dns-lookup__badge--none";
      default:
        return "";
    }
  };

  const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      blocklist: "Blocklist",
      allowlist: "Allowlist",
      "regex-blocklist": "Regex Blocklist",
      "regex-allowlist": "Regex Allowlist",
      "manual-blocked": "Manual Block",
      "manual-allowed": "Manual Allow",
    };
    return labels[type] || type;
  };

  const dismissSearchHelp = () => {
    localStorage.setItem("domainListsSearchHelpDismissed", "true");
    setShowSearchHelp(false);
  };

  const copySearchText = async () => {
    if (searchFilter) {
      await navigator.clipboard.writeText(searchFilter);
      pushToast({
        message: "Search text copied to clipboard",
        tone: "success",
      });
    }
  };

  const clearSearch = () => {
    setSearchFilter("");
  };

  const highlightRegexMatch = (domain: string): React.ReactNode => {
    // Use activeSearchTerm (what was actually sent to API) for highlighting, not searchFilter
    if (searchMode !== "regex" || !regexValid || !activeSearchTerm.trim()) {
      return <code>{domain}</code>;
    }

    try {
      const regex = new RegExp(activeSearchTerm, "g");
      const matches: { start: number; end: number }[] = [];
      let match;

      while ((match = regex.exec(domain)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
        });
        // Prevent infinite loop on zero-width matches
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }

      if (matches.length === 0) {
        return <code>{domain}</code>;
      }

      const parts: React.ReactNode[] = [];
      let lastIndex = 0;

      matches.forEach((m, i) => {
        if (m.start > lastIndex) {
          parts.push(domain.substring(lastIndex, m.start));
        }
        parts.push(
          <mark key={`match-${i}`} className="dns-lookup__regex-highlight">
            {domain.substring(m.start, m.end)}
          </mark>,
        );
        lastIndex = m.end;
      });

      if (lastIndex < domain.length) {
        parts.push(domain.substring(lastIndex));
      }

      return <code>{parts}</code>;
    } catch {
      return <code>{domain}</code>;
    }
  };

  // Count types for displayed results
  const typeCounts = React.useMemo(() => {
    const counts = { allow: 0, block: 0 };
    const sourceData =
      useClientSideFiltering ? fullDomainCache : displayedDomains;
    sourceData.forEach((d) => {
      if (d.type === "allow") counts.allow++;
      else if (d.type === "block") counts.block++;
    });
    return counts;
  }, [useClientSideFiltering, fullDomainCache, displayedDomains]);

  return (
    <>
      <PullToRefreshIndicator
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
        isRefreshing={pullToRefresh.isRefreshing}
      />
      <div className="dns-lookup" ref={pullToRefresh.containerRef}>
        <div className="dns-lookup__header">
          <div>
            <h1>DNS Lookup</h1>
            <p className="dns-lookup__subtitle">
              Check domain blocking status and browse domain lists
            </p>
          </div>
          {/* Cluster Mode Badge - top right corner */}
          <ClusterInfoBanner
            primaryNodeName={primaryNode?.name}
            show={isClusterEnabled}
          />
        </div>

        {nodes.length === 0 && (
          <div className="dns-lookup__warning">
            ⚠️ No nodes configured. Please configure nodes to use DNS Lookup.
          </div>
        )}

        {nodes.length > 0 && (
          <>
            {/* Node Selector */}
            <div className="node-selector">
              <div className="node-selector__label">
                <strong>Working on Node:</strong>
                <span className="node-selector__hint">
                  {isClusterEnabled ?
                    "Only the Primary node can be modified (Secondary nodes automatically replicate configuration)"
                  : "All operations will use the selected node"}
                </span>
              </div>
              <div className="node-selector__cards">
                {/* Non-cluster mode: show all nodes */}
                {!isClusterEnabled &&
                  nodes.map((node) => {
                    const isSelected = node.id === selectedNodeId;

                    return (
                      <button
                        key={node.id}
                        type="button"
                        className={`node-selector__card ${isSelected ? "node-selector__card--selected" : ""}`}
                        onClick={() => setSelectedNodeId(node.id)}
                        disabled={loading}
                      >
                        <div className="node-selector__card-radio">
                          <input
                            type="radio"
                            name="selected-dns-lookup-node"
                            checked={isSelected}
                            onChange={() => setSelectedNodeId(node.id)}
                            aria-label={`Select ${node.name || node.id}`}
                            disabled={loading}
                          />
                        </div>
                        <div className="node-selector__card-content">
                          <div className="node-selector__card-header">
                            <strong className="node-selector__card-title">
                              {node.name || node.id}
                            </strong>
                          </div>
                          <div className="node-selector__card-stats">
                            {isSelected ? "Selected" : "Available"}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                {/* Cluster mode: Primary node with full details */}
                {isClusterEnabled &&
                  primaryNode &&
                  (() => {
                    const isSelected = primaryNode.id === selectedNodeId;

                    return (
                      <button
                        key={primaryNode.id}
                        type="button"
                        className={`node-selector__card ${isSelected ? "node-selector__card--selected" : ""}`}
                        onClick={() => setSelectedNodeId(primaryNode.id)}
                        disabled={loading}
                      >
                        <div className="node-selector__card-radio">
                          <input
                            type="radio"
                            name="selected-dns-lookup-node"
                            checked={isSelected}
                            onChange={() => setSelectedNodeId(primaryNode.id)}
                            aria-label={`Select ${primaryNode.name || primaryNode.id}`}
                            disabled={loading}
                          />
                        </div>
                        <div className="node-selector__card-content">
                          <div className="node-selector__card-header">
                            <strong className="node-selector__card-title">
                              {primaryNode.name || primaryNode.id}
                            </strong>
                            <span className="node-selector__card-badge node-selector__card-badge--primary">
                              Primary
                            </span>
                          </div>
                          <div className="node-selector__card-stats">
                            {isSelected ? "Selected" : "Available"}
                          </div>
                        </div>
                      </button>
                    );
                  })()}

                {/* Cluster mode: Secondary nodes - compact row */}
                {isClusterEnabled &&
                  (() => {
                    const secondaryNodes = nodes.filter((n) => !n.isPrimary);
                    if (secondaryNodes.length === 0) return null;

                    return (
                      <div className="node-selector__secondaries">
                        <span className="node-selector__secondaries-label">
                          Secondary nodes:
                        </span>
                        {secondaryNodes.map((node) => (
                          <span
                            key={node.id}
                            className="node-selector__secondary-chip"
                          >
                            {node.name || node.id}
                            <span
                              className="node-selector__secondary-status"
                              title="In sync with Primary"
                            >
                              ✓
                            </span>
                          </span>
                        ))}
                      </div>
                    );
                  })()}
              </div>
            </div>
          </>
        )}

        <div className="dns-lookup__tabs">
          <button
            className={
              activeTab === "lookup" ?
                "dns-lookup__tab active"
              : "dns-lookup__tab"
            }
            onClick={() => setActiveTab("lookup")}
          >
            Domain Lookup
          </button>
          <button
            className={
              activeTab === "domains" ?
                "dns-lookup__tab active"
              : "dns-lookup__tab"
            }
            onClick={() => setActiveTab("domains")}
          >
            All Domains
          </button>
        </div>

        <div className="dns-lookup__content">
          {activeTab === "lookup" && (
            <div className="dns-lookup__section">
              <div className="dns-lookup__description">
                <p>
                  Search for any domain or URL to check its blocking status.
                  Results show both group-specific policies and all matching
                  lists across your configuration.
                </p>
              </div>

              <div className="dns-lookup__form">
                <div className="dns-lookup__form-row">
                  <label htmlFor="domain" className="dns-lookup__label">
                    Domain Name or URL
                  </label>
                  <input
                    id="domain"
                    type="text"
                    className="dns-lookup__input"
                    placeholder="example.com or https://example.com/path"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        handleDomainLookup();
                      }
                    }}
                    disabled={loading || !selectedNodeId}
                  />
                </div>

                <div className="dns-lookup__form-row">
                  <label htmlFor="group" className="dns-lookup__label">
                    Client Group (for policy result)
                  </label>
                  <select
                    id="group"
                    className="dns-lookup__select"
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                    disabled={
                      loading || availableGroups.length === 0 || !selectedNodeId
                    }
                  >
                    {availableGroups.length === 0 && (
                      <option value="">No groups available</option>
                    )}
                    {availableGroups.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                  <small className="dns-lookup__form-hint">
                    Shows what action this group would take for the domain
                  </small>
                </div>

                <button
                  className="dns-lookup__button"
                  onClick={handleDomainLookup}
                  disabled={loading || !domain.trim() || !selectedNodeId}
                >
                  {loading ? "Checking..." : "Check Domain"}
                </button>
              </div>

              {/* Combined Results */}
              {(policyResult || globalCheckResult) && (
                <div className="dns-lookup__results">
                  {policyResult && (
                    <>
                      <div className="dns-lookup__result-header">
                        <h2>Policy Result for {policyResult.domain}</h2>
                        <span
                          className={`dns-lookup__badge ${getActionBadgeClass(policyResult.finalAction)}`}
                        >
                          {policyResult.finalAction.toUpperCase()}
                        </span>
                      </div>

                      <div className="dns-lookup__result-section">
                        <h3>Group: {policyResult.groupName}</h3>
                        <p className="dns-lookup__evaluation">
                          {policyResult.evaluation}
                        </p>
                      </div>

                      {policyResult.reasons.length > 0 && (
                        <div className="dns-lookup__result-section">
                          <h3>
                            Matching Rules ({policyResult.reasons.length})
                          </h3>
                          <div className="dns-lookup__reasons">
                            {policyResult.reasons.map((reason, index) => (
                              <div key={index} className="dns-lookup__reason">
                                <div className="dns-lookup__reason-header">
                                  <span
                                    className={`dns-lookup__action-badge dns-lookup__action-badge--${reason.action}`}
                                  >
                                    <FontAwesomeIcon
                                      icon={
                                        reason.action === "block" ?
                                          faBan
                                        : faCheck
                                      }
                                    />{" "}
                                    {reason.action.toUpperCase()}
                                  </span>
                                  <span className="dns-lookup__type-badge">
                                    {getTypeLabel(reason.type)}
                                  </span>
                                </div>
                                <div className="dns-lookup__reason-source">
                                  {reason.source === "manual" ?
                                    <span className="dns-lookup__manual">
                                      Manual Entry
                                    </span>
                                  : <a
                                      href={reason.source}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="dns-lookup__link"
                                    >
                                      {reason.source}
                                    </a>
                                  }
                                </div>
                                {reason.matchedPattern && (
                                  <div className="dns-lookup__pattern">
                                    Pattern:{" "}
                                    <code>{reason.matchedPattern}</code>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {policyResult.reasons.length === 0 && (
                        <div className="dns-lookup__result-section dns-lookup__result-section--allowed-default">
                          <div className="dns-lookup__allowed-indicator">
                            <span className="dns-lookup__allowed-icon">✓</span>
                            <div>
                              <strong>
                                Domain not found in any lists (allowed by
                                default)
                              </strong>
                              <p className="dns-lookup__no-matches">
                                No matching rules found. Domain is allowed by
                                default.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {globalCheckResult &&
                    globalCheckResult.found &&
                    globalCheckResult.foundIn &&
                    globalCheckResult.foundIn.length > 0 && (
                      <div className="dns-lookup__result-section dns-lookup__result-section--separator">
                        <h3>
                          All Matching Lists ({globalCheckResult.foundIn.length}
                          )
                        </h3>
                        <p className="dns-lookup__section-description">
                          Complete list of all allow/block lists containing this
                          domain across all groups
                        </p>
                        <div className="dns-lookup__reasons">
                          {globalCheckResult.foundIn.map((entry, index) => (
                            <div key={index} className="dns-lookup__reason">
                              <div className="dns-lookup__reason-header">
                                <span className="dns-lookup__type-badge">
                                  {getTypeLabel(entry.type)}
                                </span>
                                {entry.groupName && (
                                  <span className="dns-lookup__group-badge">
                                    Group: {entry.groupName}
                                  </span>
                                )}
                                {entry.groups && entry.groups.length > 0 && (
                                  <div className="dns-lookup__groups-list">
                                    <span className="dns-lookup__groups-label">
                                      Used by groups:
                                    </span>
                                    <div className="dns-lookup__groups-badges">
                                      {entry.groups.map((group, gIndex) => (
                                        <span
                                          key={gIndex}
                                          className="dns-lookup__group-badge"
                                        >
                                          {group}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="dns-lookup__reason-source">
                                {entry.source === "manual" ?
                                  <span className="dns-lookup__manual">
                                    Manual Entry
                                  </span>
                                : <a
                                    href={entry.source}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="dns-lookup__link"
                                  >
                                    {entry.source}
                                  </a>
                                }
                              </div>
                              {entry.matchedPattern && (
                                <div className="dns-lookup__pattern">
                                  Pattern: <code>{entry.matchedPattern}</code>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}

          {activeTab === "domains" && (
            <div className="dns-lookup__section">
              <div className="dns-lookup__description">
                <p>
                  Browse and filter all domains from Advanced Blocking lists.
                  Test regex patterns in real-time to see which domains match.
                </p>
              </div>

              {showSearchHelp && (
                <div className="dns-lookup__info-box">
                  <div className="dns-lookup__info-box-header">
                    <div className="dns-lookup__info-box-title">
                      <span className="dns-lookup__info-box-icon">💡</span>
                      <strong>Search Tips</strong>
                    </div>
                    <button
                      type="button"
                      className="dns-lookup__info-box-dismiss"
                      onClick={dismissSearchHelp}
                      title="Dismiss"
                      aria-label="Dismiss search tips"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="dns-lookup__info-box-content">
                    <p>
                      <strong>Text Mode:</strong> Simple substring matching
                      (case-insensitive)
                    </p>
                    <ul className="dns-lookup__info-box-examples">
                      <li>
                        <code>google</code> - Matches any domain containing
                        "google"
                      </li>
                      <li>
                        <code>ads.</code> - Matches domains with "ads."
                      </li>
                    </ul>
                    <p>
                      <strong>Regex Mode:</strong> Full regular expression
                      support
                    </p>
                    <ul className="dns-lookup__info-box-examples">
                      <li>
                        <code>^ads\.</code> - Domains starting with "ads."
                      </li>
                      <li>
                        <code>\.(com|net)$</code> - Domains ending in .com or
                        .net
                      </li>
                      <li>
                        <code>^.*\.google\.(com|net)$</code> - All
                        google.com/net subdomains
                      </li>
                      <li>
                        <code>tracking|analytics</code> - Domains containing
                        either word
                      </li>
                    </ul>
                  </div>
                </div>
              )}

              <div className="dns-lookup__actions">
                <button
                  className="dns-lookup__button dns-lookup__button--outline"
                  onClick={handleRefreshDomains}
                  disabled={loadingDomains || !selectedNodeId}
                >
                  {loadingDomains ?
                    "Refreshing..."
                  : <>
                      <FontAwesomeIcon icon={faRotate} /> Refresh Lists
                    </>
                  }
                </button>
                {lastRefreshed && (
                  <span className="dns-lookup__last-refresh dns-lookup__last-refresh--small">
                    Last refreshed: {new Date(lastRefreshed).toLocaleString()}
                  </span>
                )}
              </div>

              <div className="dns-lookup__filters">
                <div className="dns-lookup__filter-group">
                  <label className="dns-lookup__label">
                    <strong>Search Domains:</strong>
                    {isSearchPending && (
                      <span className="dns-lookup__search-pending">
                        ⏳ Searching...
                      </span>
                    )}
                    {!isSearchPending &&
                      searchMode === "regex" &&
                      searchFilter && (
                        <span
                          className={
                            regexValid ?
                              "dns-lookup__regex-valid"
                            : "dns-lookup__regex-invalid"
                          }
                        >
                          {regexValid ?
                            <>
                              <FontAwesomeIcon icon={faCheck} /> Valid regex
                            </>
                          : <>
                              <FontAwesomeIcon icon={faXmark} /> {regexError}
                            </>
                          }
                        </span>
                      )}
                  </label>
                  <div className="dns-lookup__search-container">
                    <div className="dns-lookup__search-input-wrapper">
                      <input
                        type="text"
                        className={`dns-lookup__input dns-lookup__search-input ${searchMode === "regex" && !regexValid ? "dns-lookup__input--error" : ""}`}
                        placeholder={
                          searchMode === "text" ? "Search domains..." : (
                            "e.g., ^.*\\.google\\.(com|net)$"
                          )
                        }
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value)}
                      />
                      {searchFilter && (
                        <div className="dns-lookup__search-buttons">
                          <button
                            type="button"
                            className="dns-lookup__icon-button dns-lookup__icon-button--copy"
                            onClick={copySearchText}
                            title="Copy search text"
                            aria-label="Copy search text to clipboard"
                          >
                            <FontAwesomeIcon icon={faClipboard} />
                          </button>
                          <button
                            type="button"
                            className="dns-lookup__icon-button dns-lookup__icon-button--clear"
                            onClick={clearSearch}
                            title="Clear search"
                            aria-label="Clear search input"
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="dns-lookup__search-mode-toggle">
                      <button
                        type="button"
                        className={`dns-lookup__toggle-button ${searchMode === "text" ? "dns-lookup__toggle-button--active" : ""}`}
                        onClick={() => setSearchMode("text")}
                        title="Text search (substring match)"
                      >
                        Text
                      </button>
                      <button
                        type="button"
                        className={`dns-lookup__toggle-button ${searchMode === "regex" ? "dns-lookup__toggle-button--active" : ""}`}
                        onClick={() => setSearchMode("regex")}
                        title="Regular expression search"
                      >
                        Regex
                      </button>
                    </div>
                  </div>
                </div>

                <div className="dns-lookup__filter-group">
                  <label className="dns-lookup__label">
                    <strong>Type Filter:</strong>
                  </label>
                  <select
                    className="dns-lookup__select dns-lookup__select--enhanced"
                    value={typeFilter}
                    onChange={(e) =>
                      setTypeFilter(e.target.value as "all" | "allow" | "block")
                    }
                  >
                    <option value="all">
                      All Domains (
                      {useClientSideFiltering ?
                        fullDomainCache.length.toLocaleString()
                      : totalDomains > 0 ?
                        `${totalDomains.toLocaleString()}`
                      : allDomains.length.toLocaleString()}
                      )
                    </option>
                    <option value="block">
                      🚫 Block Lists ({typeCounts.block.toLocaleString()})
                    </option>
                    <option value="allow">
                      ✅ Allow Lists ({typeCounts.allow.toLocaleString()})
                    </option>
                  </select>
                  {allDomains.length > 0 && (
                    <div className="dns-lookup__filter-breakdown">
                      <span className="dns-lookup__filter-stat dns-lookup__filter-stat--block">
                        {typeCounts.block.toLocaleString()} blocked
                      </span>
                      <span className="dns-lookup__filter-separator">•</span>
                      <span className="dns-lookup__filter-stat dns-lookup__filter-stat--allow">
                        {typeCounts.allow.toLocaleString()} allowed
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Exact Match (Text mode only): helps confirm existence even if not on the current page */}
              {activeTab === "domains" &&
                searchMode === "text" &&
                exactCheckDomain && (
                  <div
                    className={`dns-lookup__exact-check ${exactCheckLoading ? "dns-lookup__exact-check--loading" : ""} ${!exactCheckLoading && !exactCheckError && exactCheckResult?.found ? "dns-lookup__exact-check--found" : ""}`}
                  >
                    <div className="dns-lookup__exact-check-header">
                      <div className="dns-lookup__exact-check-title">
                        <strong>Exact Match</strong>
                      </div>
                      <div className="dns-lookup__exact-check-domain">
                        {exactCheckDomain}
                      </div>
                    </div>

                    <div className="dns-lookup__exact-check-status">
                      {exactCheckLoading ?
                        "Checking…"
                      : exactCheckError ?
                        `Error: ${exactCheckError}`
                      : exactCheckResult?.found ?
                        `Found in ${exactCheckResult.foundIn?.length ?? 0} list entr${(exactCheckResult.foundIn?.length ?? 0) === 1 ? "y" : "ies"}`
                      : "Not found in lists"}
                    </div>

                    {!exactCheckLoading &&
                      !exactCheckError &&
                      exactCheckResult?.found &&
                      exactCheckResult.foundIn &&
                      exactCheckResult.foundIn.length > 0 && (
                        <div className="dns-lookup__exact-check-details">
                          {exactCheckResult.foundIn
                            .slice(0, 5)
                            .map((entry, idx) => (
                              <div key={idx}>
                                {getTypeLabel(entry.type)} —{" "}
                                <a
                                  href={entry.source}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="dns-lookup__source-link"
                                >
                                  {entry.source.split("/").pop() ||
                                    entry.source}
                                </a>
                                {entry.groupName ?
                                  ` (Group: ${entry.groupName})`
                                : ""}
                              </div>
                            ))}
                          {exactCheckResult.foundIn.length > 5 && (
                            <div>
                              …and {exactCheckResult.foundIn.length - 5} more
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                )}

              {/* Regex Preview (no extra API calls; uses already-loaded results) */}
              {!isSearchPending &&
                activeTab === "domains" &&
                searchMode === "regex" &&
                searchFilter.trim() && (
                  <div
                    className={`dns-lookup__regex-preview ${regexValid ? "dns-lookup__regex-preview--valid" : "dns-lookup__regex-preview--invalid"}`}
                  >
                    <div className="dns-lookup__regex-preview-header">
                      <strong>Match Preview</strong>
                      <div className="dns-lookup__regex-preview-actions">
                        <span
                          className={`dns-lookup__regex-preview-count ${regexValid ? "dns-lookup__regex-preview-count--success" : "dns-lookup__regex-preview-count--error"}`}
                        >
                          {regexValid && regexPreview ?
                            `${regexPreview.count.toLocaleString()} match${regexPreview.count === 1 ? "" : "es"} (current results)`
                          : "Invalid regex"}
                        </span>
                        <button
                          type="button"
                          className="dns-lookup__pagination-button"
                          onClick={toggleRegexPreviewCollapsed}
                        >
                          {regexPreviewCollapsed ? "Show" : "Hide"}
                        </button>
                      </div>
                    </div>

                    {!regexPreviewCollapsed && (
                      <>
                        {regexValid &&
                          regexPreview &&
                          regexPreview.sample.length > 0 && (
                            <div className="dns-lookup__regex-preview-samples">
                              <div className="dns-lookup__regex-preview-label">
                                Sample matches
                              </div>
                              <div className="dns-lookup__regex-preview-list">
                                {regexPreview.sample.map((d, idx) => (
                                  <span
                                    key={idx}
                                    className="dns-lookup__regex-preview-item"
                                  >
                                    {d}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                        {!regexValid && regexError && (
                          <div className="dns-lookup__regex-preview-error">
                            {regexError}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

              {loadingDomains && !allDomains.length && (
                <div className="dns-lookup__loading">Loading domains...</div>
              )}

              {!loadingDomains && allDomains.length === 0 && (
                <div className="dns-lookup__empty">
                  No domains loaded. Click "Refresh Lists" to load domains.
                </div>
              )}

              {allDomains.length > 0 && (
                <div
                  className={`dns-lookup__domains-list ${loadingDomains ? "dns-lookup__domains-list--loading" : ""}`}
                >
                  {loadingDomains && (
                    <div className="dns-lookup__loading-overlay">
                      <div className="dns-lookup__loading-spinner">
                        <div className="dns-lookup__spinner"></div>
                        <span>Loading results...</span>
                      </div>
                    </div>
                  )}
                  <div className="dns-lookup__stats">
                    {useClientSideFiltering ?
                      <>
                        <strong>
                          Showing {consolidatedDomains.length.toLocaleString()}
                        </strong>{" "}
                        matching domains
                        <span className="dns-lookup__stats-note">
                          (filtered from{" "}
                          {fullDomainCache.length.toLocaleString()} total -
                          instant client-side filtering)
                        </span>
                      </>
                    : totalDomains > 0 ?
                      <>
                        <strong>
                          Showing {consolidatedDomains.length.toLocaleString()}
                        </strong>{" "}
                        of <strong>{totalDomains.toLocaleString()}</strong>{" "}
                        matching domains
                        {consolidatedDomains.length <
                          displayedDomains.length && (
                          <span className="dns-lookup__stats-note">
                            ({displayedDomains.length.toLocaleString()} entries
                            on this page, consolidated by domain)
                          </span>
                        )}
                      </>
                    : <span>No domains to display</span>}
                  </div>

                  <div className="dns-lookup__domains-table">
                    <div className="dns-lookup__table-header">
                      <div className="dns-lookup__table-col dns-lookup__table-col--domain">
                        Domain
                      </div>
                      <div className="dns-lookup__table-col dns-lookup__table-col--type">
                        Type
                      </div>
                      <div className="dns-lookup__table-col dns-lookup__table-col--sources">
                        Sources
                      </div>
                    </div>
                    <div className="dns-lookup__table-body">
                      {consolidatedDomains
                        .slice(0, 1000)
                        .map((domainEntry, index) => (
                          <div key={index} className="dns-lookup__table-row">
                            <div className="dns-lookup__table-col dns-lookup__table-col--domain">
                              {highlightRegexMatch(domainEntry.domain)}
                            </div>
                            <div className="dns-lookup__table-col dns-lookup__table-col--type">
                              <span
                                className={`dns-lookup__type-badge dns-lookup__type-badge--${domainEntry.type}`}
                              >
                                {domainEntry.type === "allow" ?
                                  "Allow"
                                : "Block"}
                              </span>
                            </div>
                            <div className="dns-lookup__table-col dns-lookup__table-col--sources">
                              {(() => {
                                // Group sources by identical group memberships
                                const sourcesByGroups = new Map<
                                  string,
                                  DomainSource[]
                                >();
                                domainEntry.sources.forEach((source) => {
                                  const groupKey = [...source.groups]
                                    .sort()
                                    .join(",");
                                  if (!sourcesByGroups.has(groupKey)) {
                                    sourcesByGroups.set(groupKey, []);
                                  }
                                  sourcesByGroups.get(groupKey)!.push(source);
                                });

                                return Array.from(sourcesByGroups.values()).map(
                                  (sourcesGroup, groupIndex) => (
                                    <div
                                      key={groupIndex}
                                      className="dns-lookup__source-group"
                                    >
                                      {sourcesGroup.map((source, sIndex) => (
                                        <div
                                          key={sIndex}
                                          className="dns-lookup__source-item"
                                          title={source.url}
                                        >
                                          <a
                                            href={source.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="dns-lookup__source-link"
                                          >
                                            {source.url.split("/").pop() ||
                                              source.url}
                                          </a>
                                        </div>
                                      ))}
                                      {sourcesGroup[0].groups.length > 0 && (
                                        <div className="dns-lookup__source-groups">
                                          {sourcesGroup[0].groups.map(
                                            (group, gIndex) => (
                                              <span
                                                key={gIndex}
                                                className="dns-lookup__group-badge-small"
                                              >
                                                {group}
                                              </span>
                                            ),
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  ),
                                );
                              })()}
                            </div>
                          </div>
                        ))}
                    </div>

                    {/* Pagination Controls */}
                    {totalPages > 0 && (
                      <div className="dns-lookup__pagination">
                        <div className="dns-lookup__pagination-info">
                          Showing {(currentPage - 1) * pageSize + 1} -{" "}
                          {Math.min(currentPage * pageSize, totalDomains)} of{" "}
                          {totalDomains.toLocaleString()} domains
                        </div>
                        <div className="dns-lookup__pagination-controls">
                          <button
                            className="dns-lookup__pagination-button"
                            onClick={() => loadAllDomains(1)}
                            disabled={currentPage === 1 || loadingDomains}
                          >
                            First
                          </button>
                          <button
                            className="dns-lookup__pagination-button"
                            onClick={() => loadAllDomains(currentPage - 1)}
                            disabled={currentPage === 1 || loadingDomains}
                          >
                            Previous
                          </button>
                          <span className="dns-lookup__pagination-text">
                            Page {currentPage} of {totalPages}
                          </span>
                          <button
                            className="dns-lookup__pagination-button"
                            onClick={() => loadAllDomains(currentPage + 1)}
                            disabled={
                              currentPage === totalPages || loadingDomains
                            }
                          >
                            Next
                          </button>
                          <button
                            className="dns-lookup__pagination-button"
                            onClick={() => loadAllDomains(totalPages)}
                            disabled={
                              currentPage === totalPages || loadingDomains
                            }
                          >
                            Last
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default DnsLookupPage;
