import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faMinus, faPencil } from '@fortawesome/free-solid-svg-icons';
import type {
    AdvancedBlockingConfig,
    AdvancedBlockingGroup,
    AdvancedBlockingOverview,
    AdvancedBlockingUrlEntry,
    AdvancedBlockingUrlOverride,
} from '../../types/advancedBlocking';

interface AdvancedBlockingEditorProps {
    overview?: AdvancedBlockingOverview;
    loading: boolean;
    error?: string;
    onSave: (nodeId: string, config: AdvancedBlockingConfig) => Promise<void>;
    onDirtyChange?: (isDirty: boolean) => void;
    selectedNodeId?: string;
    onNodeChange?: (nodeId: string) => void;
}

export function AdvancedBlockingEditor({
    overview,
    loading,
    error,
    onSave,
    onDirtyChange,
    selectedNodeId: externalSelectedNodeId,
    onNodeChange,
}: AdvancedBlockingEditorProps) {
    const nodes = useMemo(() => overview?.nodes ?? [], [overview]);
    const firstNode = nodes[0];
    const [internalSelectedNodeId, setInternalSelectedNodeId] = useState<string>(() => firstNode?.nodeId ?? '');

    // Use external selectedNodeId if provided, otherwise use internal state
    const selectedNodeId = externalSelectedNodeId ?? internalSelectedNodeId;

    // Function to change selected node
    const setSelectedNodeId = useCallback((nodeId: string) => {
        if (onNodeChange) {
            onNodeChange(nodeId);
        } else {
            setInternalSelectedNodeId(nodeId);
        }
    }, [onNodeChange]);

    const [draftConfig, setDraftConfig] = useState<AdvancedBlockingConfig | undefined>(() =>
        firstNode?.config ? cloneConfig(firstNode.config) : undefined,
    );
    const [baseline, setBaseline] = useState<string>(() => serializeConfig(firstNode?.config));
    const [activeGroupName, setActiveGroupName] = useState<string | null>(
        () => firstNode?.config?.groups[0]?.name ?? null,
    );
    const [newGroupName, setNewGroupName] = useState('');
    const [renameValue, setRenameValue] = useState('');
    const [status, setStatus] = useState<string | undefined>();
    const [localError, setLocalError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [showChangesSummary, setShowChangesSummary] = useState(false);

    useEffect(() => {
        if (!nodes.some((node) => node.nodeId === selectedNodeId)) {
            setSelectedNodeId(nodes[0]?.nodeId ?? '');
        }
    }, [nodes, selectedNodeId, setSelectedNodeId]);

    useEffect(() => {
        const nextNode = nodes.find((node) => node.nodeId === selectedNodeId);
        const config = nextNode?.config;

        if (config) {
            setDraftConfig(cloneConfig(config));
            setBaseline(serializeConfig(config));
            setActiveGroupName((prev) => {
                if (prev && config.groups.some((group) => group.name === prev)) {
                    return prev;
                }
                return config.groups[0]?.name ?? null;
            });
        } else {
            setDraftConfig(undefined);
            setBaseline('null');
            setActiveGroupName(null);
        }

        setStatus(undefined);
        setLocalError(undefined);
    }, [nodes, selectedNodeId]);
    const selectedNode = useMemo(
        () => nodes.find((node) => node.nodeId === selectedNodeId),
        [nodes, selectedNodeId],
    );

    const activeGroup = useMemo(() => {
        if (!draftConfig) {
            return undefined;
        }

        const current = activeGroupName
            ? draftConfig.groups.find((group) => group.name === activeGroupName)
            : undefined;

        return current ?? draftConfig.groups[0];
    }, [draftConfig, activeGroupName]);

    useEffect(() => {
        setRenameValue(activeGroup?.name ?? '');
    }, [activeGroup]);

    useEffect(() => {
        if (!draftConfig) {
            return;
        }

        if (activeGroupName && !draftConfig.groups.some((group) => group.name === activeGroupName)) {
            setActiveGroupName(draftConfig.groups[0]?.name ?? null);
        }
    }, [draftConfig, activeGroupName]);

    const serializedDraft = useMemo(() => serializeConfig(draftConfig), [draftConfig]);
    const isDirty = useMemo(() => serializedDraft !== baseline, [serializedDraft, baseline]);

    // Compute pending changes for display
    const pendingChanges = useMemo(() => {
        if (!isDirty || !draftConfig) return [];

        const changes: Array<{
            type: 'added' | 'removed' | 'modified';
            category: string;
            description: string;
        }> = [];

        // Parse baseline config
        const baselineConfig = baseline !== 'null' ? JSON.parse(baseline) as AdvancedBlockingConfig : null;

        if (!baselineConfig) {
            // All groups are new
            draftConfig.groups.forEach(group => {
                changes.push({
                    type: 'added',
                    category: 'Group',
                    description: `Added group "${group.name}"`
                });
            });
            return changes;
        }

        // Check for added/removed groups
        const baselineGroupNames = new Set(baselineConfig.groups.map(g => g.name));
        const draftGroupNames = new Set(draftConfig.groups.map(g => g.name));

        // Added groups
        draftConfig.groups.forEach(group => {
            if (!baselineGroupNames.has(group.name)) {
                changes.push({
                    type: 'added',
                    category: 'Group',
                    description: `Added group "${group.name}"`
                });
            }
        });

        // Removed groups
        baselineConfig.groups.forEach(group => {
            if (!draftGroupNames.has(group.name)) {
                changes.push({
                    type: 'removed',
                    category: 'Group',
                    description: `Removed group "${group.name}"`
                });
            }
        });

        // Check for modified groups (only for groups that exist in both)
        draftConfig.groups.forEach(draftGroup => {
            const baselineGroup = baselineConfig.groups.find(g => g.name === draftGroup.name);
            if (!baselineGroup) return; // Already handled as "added"

            // Check if group was renamed (different object but checking properties)
            // Since groups are identified by name, renaming would be remove + add

            // Check blocked domains
            const baselineBlocked = new Set(baselineGroup.blocked || []);
            const draftBlocked = new Set(draftGroup.blocked || []);
            const addedBlocked = [...draftBlocked].filter(d => !baselineBlocked.has(d));
            const removedBlocked = [...baselineBlocked].filter(d => !draftBlocked.has(d));

            addedBlocked.forEach(domain => {
                changes.push({
                    type: 'added',
                    category: `Group: ${draftGroup.name}`,
                    description: `Blocked domain: ${domain}`
                });
            });

            removedBlocked.forEach(domain => {
                changes.push({
                    type: 'removed',
                    category: `Group: ${draftGroup.name}`,
                    description: `Unblocked domain: ${domain}`
                });
            });

            // Check allowed domains
            const baselineAllowed = new Set(baselineGroup.allowed || []);
            const draftAllowed = new Set(draftGroup.allowed || []);
            const addedAllowed = [...draftAllowed].filter(d => !baselineAllowed.has(d));
            const removedAllowed = [...baselineAllowed].filter(d => !draftAllowed.has(d));

            addedAllowed.forEach(domain => {
                changes.push({
                    type: 'added',
                    category: `Group: ${draftGroup.name}`,
                    description: `Allowed domain: ${domain}`
                });
            });

            removedAllowed.forEach(domain => {
                changes.push({
                    type: 'removed',
                    category: `Group: ${draftGroup.name}`,
                    description: `Removed allowed domain: ${domain}`
                });
            });

            // Check blocked regex
            const baselineBlockedRegex = new Set(baselineGroup.blockedRegex || []);
            const draftBlockedRegex = new Set(draftGroup.blockedRegex || []);
            const addedBlockedRegex = [...draftBlockedRegex].filter(d => !baselineBlockedRegex.has(d));
            const removedBlockedRegex = [...baselineBlockedRegex].filter(d => !draftBlockedRegex.has(d));

            addedBlockedRegex.forEach(pattern => {
                changes.push({
                    type: 'added',
                    category: `Group: ${draftGroup.name}`,
                    description: `Blocked regex: ${pattern}`
                });
            });

            removedBlockedRegex.forEach(pattern => {
                changes.push({
                    type: 'removed',
                    category: `Group: ${draftGroup.name}`,
                    description: `Removed blocked regex: ${pattern}`
                });
            });

            // Check allowed regex
            const baselineAllowedRegex = new Set(baselineGroup.allowedRegex || []);
            const draftAllowedRegex = new Set(draftGroup.allowedRegex || []);
            const addedAllowedRegex = [...draftAllowedRegex].filter(d => !baselineAllowedRegex.has(d));
            const removedAllowedRegex = [...baselineAllowedRegex].filter(d => !draftAllowedRegex.has(d));

            addedAllowedRegex.forEach(pattern => {
                changes.push({
                    type: 'added',
                    category: `Group: ${draftGroup.name}`,
                    description: `Allowed regex: ${pattern}`
                });
            });

            removedAllowedRegex.forEach(pattern => {
                changes.push({
                    type: 'removed',
                    category: `Group: ${draftGroup.name}`,
                    description: `Removed allowed regex: ${pattern}`
                });
            });
        });

        // Check global settings changes
        if (baselineConfig.enableBlocking !== draftConfig.enableBlocking) {
            changes.push({
                type: 'modified',
                category: 'Global Setting',
                description: `Enable blocking: ${baselineConfig.enableBlocking} → ${draftConfig.enableBlocking}`
            });
        }

        if (baselineConfig.blockingAnswerTtl !== draftConfig.blockingAnswerTtl) {
            changes.push({
                type: 'modified',
                category: 'Global Setting',
                description: `Blocking answer TTL: ${baselineConfig.blockingAnswerTtl != null ? baselineConfig.blockingAnswerTtl + 's' : 'not set'} → ${draftConfig.blockingAnswerTtl != null ? draftConfig.blockingAnswerTtl + 's' : 'not set'}`
            });
        }

        if (baselineConfig.blockListUrlUpdateIntervalHours !== draftConfig.blockListUrlUpdateIntervalHours) {
            changes.push({
                type: 'modified',
                category: 'Global Setting',
                description: `Update interval: ${baselineConfig.blockListUrlUpdateIntervalHours}h → ${draftConfig.blockListUrlUpdateIntervalHours}h`
            });
        }

        // Check network mappings
        const baselineNetworkMap = baselineConfig.networkGroupMap || {};
        const draftNetworkMap = draftConfig.networkGroupMap || {};
        const allNetworkKeys = new Set([...Object.keys(baselineNetworkMap), ...Object.keys(draftNetworkMap)]);

        allNetworkKeys.forEach(key => {
            const baselineValue = baselineNetworkMap[key];
            const draftValue = draftNetworkMap[key];

            if (!baselineValue && draftValue) {
                changes.push({
                    type: 'added',
                    category: 'Network Mapping',
                    description: `${key} → ${draftValue}`
                });
            } else if (baselineValue && !draftValue) {
                changes.push({
                    type: 'removed',
                    category: 'Network Mapping',
                    description: `${key} → ${baselineValue}`
                });
            } else if (baselineValue !== draftValue) {
                changes.push({
                    type: 'modified',
                    category: 'Network Mapping',
                    description: `${key}: ${baselineValue} → ${draftValue}`
                });
            }
        });

        // Check local endpoint mappings
        const baselineLocalMap = baselineConfig.localEndPointGroupMap || {};
        const draftLocalMap = draftConfig.localEndPointGroupMap || {};
        const allLocalKeys = new Set([...Object.keys(baselineLocalMap), ...Object.keys(draftLocalMap)]);

        allLocalKeys.forEach(key => {
            const baselineValue = baselineLocalMap[key];
            const draftValue = draftLocalMap[key];

            if (!baselineValue && draftValue) {
                changes.push({
                    type: 'added',
                    category: 'Local Endpoint',
                    description: `${key} → ${draftValue}`
                });
            } else if (baselineValue && !draftValue) {
                changes.push({
                    type: 'removed',
                    category: 'Local Endpoint',
                    description: `${key} → ${baselineValue}`
                });
            } else if (baselineValue !== draftValue) {
                changes.push({
                    type: 'modified',
                    category: 'Local Endpoint',
                    description: `${key}: ${baselineValue} → ${draftValue}`
                });
            }
        });

        return changes;
    }, [isDirty, draftConfig, baseline]);

    useEffect(() => {
        if (isDirty) {
            setStatus(undefined);
        }
    }, [isDirty]);

    // Notify parent component of dirty state changes
    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    // Warn user before navigating away with unsaved changes
    useEffect(() => {
        if (!isDirty) {
            return;
        }

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            // Modern browsers require returnValue to be set
            event.returnValue = '';
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [isDirty]);

    const handleReset = useCallback(() => {
        const node = nodes.find((item) => item.nodeId === selectedNodeId);

        if (node?.config) {
            const cloned = cloneConfig(node.config);
            setDraftConfig(cloned);
            setBaseline(serializeConfig(node.config));
            setActiveGroupName(cloned.groups[0]?.name ?? null);
        } else {
            setDraftConfig(undefined);
            setBaseline('null');
            setActiveGroupName(null);
        }

        setStatus(undefined);
        setLocalError(undefined);
        setNewGroupName('');
        setRenameValue('');
    }, [nodes, selectedNodeId]);

    const handleCreateGroup = useCallback(
        (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (!draftConfig) {
                return;
            }

            const trimmed = newGroupName.trim();
            if (!trimmed) {
                setLocalError('Group name cannot be empty.');
                return;
            }

            if (draftConfig.groups.some((group) => group.name === trimmed)) {
                setLocalError(`Group "${trimmed}" already exists.`);
                return;
            }

            const updatedConfig: AdvancedBlockingConfig = {
                ...draftConfig,
                groups: [...draftConfig.groups, createEmptyGroup(trimmed)],
            };

            setDraftConfig(updatedConfig);
            setActiveGroupName(trimmed);
            setNewGroupName('');
            setRenameValue(trimmed);
            setLocalError(undefined);
            setStatus(undefined);
        },
        [draftConfig, newGroupName],
    );

    const handleRenameGroup = useCallback(() => {
        if (!draftConfig || !activeGroup) {
            return;
        }

        const trimmed = renameValue.trim();
        if (!trimmed) {
            setLocalError('Group name cannot be empty.');
            return;
        }

        if (trimmed === activeGroup.name) {
            return;
        }

        if (draftConfig.groups.some((group) => group.name === trimmed)) {
            setLocalError(`Group "${trimmed}" already exists.`);
            return;
        }

        const newGroups = draftConfig.groups.map((group) =>
            group.name === activeGroup.name ? { ...group, name: trimmed } : group,
        );
        const newLocalMap = renameMappingTarget(draftConfig.localEndPointGroupMap, activeGroup.name, trimmed);
        const newNetworkMap = renameMappingTarget(draftConfig.networkGroupMap, activeGroup.name, trimmed);

        const updatedConfig: AdvancedBlockingConfig = {
            ...draftConfig,
            groups: newGroups,
            localEndPointGroupMap: newLocalMap,
            networkGroupMap: newNetworkMap,
        };

        setDraftConfig(updatedConfig);
        setActiveGroupName(trimmed);
        setRenameValue(trimmed);
        setLocalError(undefined);
        setStatus(undefined);
    }, [activeGroup, draftConfig, renameValue]);

    const handleDeleteGroup = useCallback(() => {
        if (!draftConfig || !activeGroup) {
            return;
        }

        setDeleteConfirmOpen(true);
    }, [activeGroup, draftConfig]);

    const confirmDeleteGroup = useCallback(() => {
        if (!draftConfig || !activeGroup) {
            return;
        }

        const remainingGroups = draftConfig.groups.filter((group) => group.name !== activeGroup.name);
        const newLocalMap = removeMappingTarget(draftConfig.localEndPointGroupMap, activeGroup.name);
        const newNetworkMap = removeMappingTarget(draftConfig.networkGroupMap, activeGroup.name);

        const updatedConfig: AdvancedBlockingConfig = {
            ...draftConfig,
            groups: remainingGroups,
            localEndPointGroupMap: newLocalMap,
            networkGroupMap: newNetworkMap,
        };

        setDraftConfig(updatedConfig);
        setActiveGroupName(remainingGroups[0]?.name ?? null);
        setRenameValue(remainingGroups[0]?.name ?? '');
        setLocalError(undefined);
        setStatus(undefined);
        setDeleteConfirmOpen(false);
    }, [activeGroup, draftConfig]);

    const cancelDeleteGroup = useCallback(() => {
        setDeleteConfirmOpen(false);
    }, []);

    const renameDirty = useMemo(() => {
        if (!activeGroup) {
            return false;
        }
        const trimmed = renameValue.trim();
        return trimmed.length > 0 && trimmed !== activeGroup.name;
    }, [activeGroup, renameValue]);

    const handleSave = useCallback(async () => {
        if (!draftConfig || !selectedNodeId) {
            return;
        }

        const sanitized = sanitizeConfig(draftConfig);
        const unknownTargets = findUnknownGroupMappings(sanitized);
        if (unknownTargets.length > 0) {
            setLocalError(
                `Cannot save mappings for undefined group${unknownTargets.length === 1 ? '' : 's'}: ${unknownTargets.join(
                    ', ',
                )}. Create the group${unknownTargets.length === 1 ? '' : 's'} first.`,
            );
            return;
        }

        setSaving(true);
        setLocalError(undefined);

        try {
            await onSave(selectedNodeId, sanitized);
            setDraftConfig(cloneConfig(sanitized));
            setBaseline(serializeConfig(sanitized));
            setStatus('Advanced Blocking config saved.');
        } catch (saveError) {
            const message = saveError instanceof Error
                ? saveError.message
                : 'Failed to save Advanced Blocking config.';
            setLocalError(message);
        } finally {
            setSaving(false);
        }
    }, [draftConfig, onSave, selectedNodeId]);

    const updateGroup = useCallback(
        (groupName: string, updater: (group: AdvancedBlockingGroup) => AdvancedBlockingGroup) => {
            setDraftConfig((prev) => {
                if (!prev) {
                    return prev;
                }

                const index = prev.groups.findIndex((group) => group.name === groupName);
                if (index === -1) {
                    return prev;
                }

                const nextGroups = prev.groups.map((group, position) => {
                    if (position !== index) {
                        return group;
                    }

                    return sanitizeGroup(updater(cloneGroup(group)));
                });

                return {
                    ...prev,
                    groups: nextGroups,
                };
            });
        },
        [],
    );

    return (
        <section className="configuration-editor configuration-editor--stacked">
            {/* <header className="configuration-editor__header advanced-blocking-summary__actions">
                <div>
                    <h2>Group Management</h2>
                    <p>
                        Create and manage filtering groups. Configure global settings, network mappings, and group-specific blocking behavior.
                    </p>
                </div>
            </header> */}

      {loading ?
        <p className="advanced-blocking-summary__message">
          Loading Advanced Blocking configuration…
        </p>
      : <>
          {selectedNode?.error ?
            <p className="configuration-editor__placeholder">
              Unable to load config for this node: {selectedNode.error}
            </p>
          : !draftConfig ?
            <p className="configuration-editor__placeholder">
              The selected node does not have an Advanced Blocking config yet.
            </p>
          : <>
              {/* Status Messages */}
              {localError && (
                <div className="multi-group-editor__error">
                  <span className="status status--error">{localError}</span>
                </div>
              )}
              {error && (
                <div className="multi-group-editor__error">
                  <span className="status status--error">{error}</span>
                </div>
              )}
              {status && (
                <div className="multi-group-editor__success">
                  <span className="status status--success">{status}</span>
                </div>
              )}

              <form
                className="configuration-editor__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSave();
                }}
              >
                {/* Global Settings */}
                <section className="group-management__section">
                  <h3>Global Settings</h3>
                  <div className="field-group">
                    <div className="field-group__option">
                      <label className="checkbox">
                        <input
                          name="enableBlockingGlobally"
                          type="checkbox"
                          checked={Boolean(draftConfig.enableBlocking)}
                          onChange={(event) =>
                            setDraftConfig((prev) =>
                              prev ?
                                {
                                  ...prev,
                                  enableBlocking: event.target.checked,
                                }
                              : prev,
                            )
                          }
                        />
                        Enable blocking globally
                      </label>
                    </div>
                    <div className="field-group__option">
                      <label htmlFor="blockingAnswerTtl">
                        Blocking answer TTL (seconds)
                      </label>
                      <input
                        id="blockingAnswerTtl"
                        name="blockingAnswerTtl"
                        type="number"
                        min="0"
                        placeholder="10"
                        value={draftConfig.blockingAnswerTtl ?? ""}
                        onChange={(event) => {
                          const raw = event.target.value.trim();
                          const value =
                            raw === "" ? undefined : parseInt(raw, 10);
                          setDraftConfig((prev) =>
                            prev ? { ...prev, blockingAnswerTtl: value } : prev,
                          );
                        }}
                      />
                      <small className="field-hint">
                        TTL value used in blocked DNS responses (default: 10
                        seconds)
                      </small>
                    </div>
                  </div>
                </section>

                {/* Global Mappings */}
                <section className="group-management__section">
                  <h3>Client Mappings</h3>
                  <MappingEditor
                    id="advanced-blocking-local-map"
                    label="Local endpoint group map"
                    keyLabel="Endpoint"
                    entries={draftConfig.localEndPointGroupMap}
                    groups={draftConfig.groups.map((group) => group.name)}
                    keyPlaceholder="client.example.com"
                    hint="Map endpoint hostnames or host:port pairs to a filtering group."
                    emptyLabel="No endpoint mappings yet."
                    onChange={(nextMap: Record<string, string>) =>
                      setDraftConfig((prev) =>
                        prev ?
                          { ...prev, localEndPointGroupMap: nextMap }
                        : prev,
                      )
                    }
                  />
                  <MappingEditor
                    id="advanced-blocking-network-map"
                    label="Network group map"
                    keyLabel="Network / CIDR"
                    entries={draftConfig.networkGroupMap}
                    groups={draftConfig.groups.map((group) => group.name)}
                    keyPlaceholder="192.168.45.0/24 or 10.10.10.10"
                    hint="Map networks, CIDR ranges, or individual IPs to a filtering group. Single IPs (e.g., 192.168.1.100) are treated as /32 for IPv4 or /128 for IPv6."
                    emptyLabel="No network mappings yet."
                    onChange={(nextMap: Record<string, string>) =>
                      setDraftConfig((prev) =>
                        prev ? { ...prev, networkGroupMap: nextMap } : prev,
                      )
                    }
                  />
                </section>

                {/* Group Settings */}
                <section className="group-management__section">
                  <h3>Group Settings</h3>
                  <div className="group-management__cards">
                    {draftConfig.groups.map((group) => {
                      const isActive = group.name === activeGroup?.name;
                      const blockingAddressesDisabled = Boolean(
                        group.blockAsNxDomain,
                      );
                      const blockingAddressesHint =
                        blockingAddressesDisabled ?
                          'Disabled when "Respond with NXDOMAIN" is enabled.'
                        : 'One address per entry. Disable "Respond with NXDOMAIN" to edit addresses.';

                      return (
                        <div
                          key={group.name}
                          className={`group-card ${isActive ? "group-card--active" : ""}`}
                        >
                          <div
                            className="group-card__header"
                            onClick={() =>
                              setActiveGroupName(isActive ? null : group.name)
                            }
                          >
                            <h4>{group.name}</h4>
                            <span className="group-card__toggle">
                              {isActive ? "▼" : "▶"}
                            </span>
                          </div>

                          {isActive && (
                            <div className="group-card__content">
                              <div className="group-card__name-section">
                                <label htmlFor="advanced-blocking-group-name">
                                  Group name
                                </label>
                                <div className="group-card__name-actions">
                                  <input
                                    id="advanced-blocking-group-name"
                                    name="groupName"
                                    type="text"
                                    value={renameValue}
                                    onChange={(event) =>
                                      setRenameValue(event.target.value)
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={handleRenameGroup}
                                    disabled={!renameDirty}
                                  >
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    className="danger"
                                    onClick={handleDeleteGroup}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>

                              <div className="field-group field-group--inline">
                                <label className="checkbox">
                                  <input
                                    name={`enableBlocking-${group.name}`}
                                    type="checkbox"
                                    checked={Boolean(group.enableBlocking)}
                                    onChange={(event) =>
                                      updateGroup(group.name, (g) => ({
                                        ...g,
                                        enableBlocking: event.target.checked,
                                      }))
                                    }
                                  />
                                  Enable blocking for this group
                                </label>
                                <label className="checkbox">
                                  <input
                                    name={`blockAsNxDomain-${group.name}`}
                                    type="checkbox"
                                    checked={Boolean(group.blockAsNxDomain)}
                                    onChange={(event) =>
                                      updateGroup(group.name, (g) => ({
                                        ...g,
                                        blockAsNxDomain: event.target.checked,
                                      }))
                                    }
                                  />
                                  Respond with NXDOMAIN
                                </label>
                                <label className="checkbox">
                                  <input
                                    name={`allowTxtBlockingReport-${group.name}`}
                                    type="checkbox"
                                    checked={Boolean(
                                      group.allowTxtBlockingReport,
                                    )}
                                    onChange={(event) =>
                                      updateGroup(group.name, (g) => ({
                                        ...g,
                                        allowTxtBlockingReport:
                                          event.target.checked,
                                      }))
                                    }
                                  />
                                  Allow TXT blocking report
                                </label>
                              </div>

                              <StringListEditor
                                id="advanced-blocking-blocking-addresses"
                                label="Blocking addresses"
                                values={group.blockingAddresses}
                                placeholder="0.0.0.0"
                                hint={blockingAddressesHint}
                                disabled={blockingAddressesDisabled}
                                onChange={(next: string[]) =>
                                  updateGroup(group.name, (g) => ({
                                    ...g,
                                    blockingAddresses: next,
                                  }))
                                }
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Add New Group Card */}
                    <div className="group-card group-card--add">
                      <div className="group-card__add-form">
                        <input
                          aria-label="New group name"
                          name="newGroupName"
                          type="text"
                          value={newGroupName}
                          onChange={(event) =>
                            setNewGroupName(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && newGroupName.trim()) {
                              event.preventDefault();
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              handleCreateGroup(event as any);
                            }
                          }}
                          placeholder="Group name"
                        />
                        <button
                          type="button"
                          className="secondary"
                          onClick={(event) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            handleCreateGroup(event as any);
                          }}
                          disabled={!newGroupName.trim()}
                        >
                          Add group
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </form>

              <footer className="multi-group-editor__footer">
                {isDirty && (
                  <>
                    <button
                      type="button"
                      className="multi-group-editor__footer-hint multi-group-editor__footer-hint--clickable"
                      onClick={() => setShowChangesSummary(!showChangesSummary)}
                      title="Click to see what will be saved"
                    >
                      You have unsaved changes ({pendingChanges.length}){" "}
                      {showChangesSummary ? "▼" : "▲"}
                    </button>

                    {showChangesSummary && pendingChanges.length > 0 && (
                      <div className="multi-group-editor__changes-summary">
                        <h4>Pending Changes:</h4>
                        <ul className="multi-group-editor__changes-list">
                          {pendingChanges.map((change, idx) => (
                            <li
                              key={idx}
                              className={`change-item change-item--${change.type}`}
                            >
                              <span className="change-icon">
                                <FontAwesomeIcon
                                  icon={
                                    change.type === "added" ? faPlus
                                    : change.type === "removed" ?
                                      faMinus
                                    : faPencil
                                  }
                                />
                              </span>
                              <span className="change-type">
                                {change.category}
                              </span>
                              <span
                                className="change-group"
                                style={{
                                  flex: 1,
                                  minWidth: 0,
                                  wordBreak: "break-word",
                                }}
                              >
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
                    onClick={handleReset}
                    disabled={!isDirty || saving}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void handleSave()}
                    disabled={
                      !isDirty ||
                      saving ||
                      !draftConfig ||
                      Boolean(selectedNode?.error)
                    }
                  >
                    Save Changes
                  </button>
                </div>
              </footer>
            </>
          }
        </>
      }

      {/* Delete Group Confirmation Modal */}
      {deleteConfirmOpen && activeGroup && (
        <div
          className="advanced-blocking__delete-overlay"
          onClick={cancelDeleteGroup}
        >
          <div
            className="advanced-blocking__delete-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="advanced-blocking__delete-title">🗑️ Remove Group</h3>
            <div className="advanced-blocking__delete-content">
              <p className="advanced-blocking__delete-message">
                Are you sure you want to remove the group{" "}
                <strong>"{activeGroup.name}"</strong> and all its mappings?
              </p>
              <p className="advanced-blocking__delete-warning">
                ⚠️ This action cannot be undone.
              </p>
            </div>
            <div className="advanced-blocking__delete-actions">
              <button
                type="button"
                onClick={cancelDeleteGroup}
                className="button button--secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteGroup}
                className="button button--danger"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface StringListEditorProps {
  id: string;
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}

function StringListEditor({
  id,
  label,
  values,
  onChange,
  placeholder,
  hint,
  disabled,
}: StringListEditorProps) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (disabled) {
      setDraft("");
    }
  }, [disabled]);

  const handleAdd = useCallback(() => {
    if (disabled) {
      return;
    }

    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }

    if (values.includes(trimmed)) {
      setDraft("");
      return;
    }

    onChange([...values, trimmed]);
    setDraft("");
  }, [disabled, draft, onChange, values]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleAdd();
      }
    },
    [handleAdd],
  );

  const handleRemove = useCallback(
    (value: string) => {
      if (disabled) {
        return;
      }

      onChange(values.filter((entry) => entry !== value));
    },
    [disabled, onChange, values],
  );

  const addDisabled = disabled || !draft.trim();

  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <div
        className={`list-editor${disabled ? " list-editor--disabled" : ""}`}
        aria-disabled={disabled}
      >
        {values.length > 0 ?
          <ul className="list-editor__items">
            {values.map((value) => (
              <li key={value} className="list-editor__item">
                <span>{value}</span>
                <button
                  type="button"
                  className="list-editor__remove"
                  onClick={() => handleRemove(value)}
                  aria-label={`Remove ${value}`}
                  disabled={disabled}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        : <p className="list-editor__empty">No entries yet.</p>}
        <div className="list-editor__input">
          <input
            id={id}
            name={`${id}-input`}
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
          />
          <button
            type="button"
            className="secondary"
            onClick={handleAdd}
            disabled={addDisabled}
          >
            Add
          </button>
        </div>
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

interface MappingEditorProps {
  id: string;
  label: string;
  keyLabel: string;
  entries: Record<string, string>;
  groups: string[];
  keyPlaceholder: string;
  emptyLabel: string;
  hint?: string;
  onChange: (map: Record<string, string>) => void;
}

function MappingEditor({
  id,
  label,
  keyLabel,
  entries,
  groups,
  keyPlaceholder,
  emptyLabel,
  hint,
  onChange,
}: MappingEditorProps) {
  const [keyDraft, setKeyDraft] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(groups[0] ?? "");
  const [removeConfirm, setRemoveConfirm] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editGroupDraft, setEditGroupDraft] = useState("");
  const [validationError, setValidationError] = useState<string | undefined>();

  // Load view mode from localStorage, with id as key for per-section preference
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    const stored = localStorage.getItem(`mapping-editor-view-${id}`);
    return stored === "grid" || stored === "list" ? stored : "list";
  });

  // Save view mode to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem(`mapping-editor-view-${id}`, viewMode);
  }, [viewMode, id]);

  // Validate network/CIDR format
  const validateNetworkEntry = useCallback(
    (value: string): string | undefined => {
      const trimmed = value.trim();
      if (!trimmed) return "Value cannot be empty";

      // Check for CIDR notation
      const cidrMatch = trimmed.match(/^(.+?)\/(\d+)$/);

      if (cidrMatch) {
        const [, address, maskStr] = cidrMatch;
        const mask = parseInt(maskStr, 10);

        // Check if it's IPv6 (contains colons or brackets)
        if (address.includes(":") || address.startsWith("[")) {
          if (mask > 128) {
            return "IPv6 subnet mask cannot be larger than /128";
          }
        } else {
          // IPv4
          if (mask > 32) {
            return "IPv4 subnet mask cannot be larger than /32";
          }
        }
      }

      return undefined;
    },
    [],
  );

  useEffect(() => {
    if (groups.length === 0) {
      setSelectedGroup("");
      return;
    }

    if (!groups.includes(selectedGroup)) {
      setSelectedGroup(groups[0]);
    }
  }, [groups, selectedGroup]);

  const sortedEntries = useMemo(
    () =>
      Object.entries(entries).sort((a, b) =>
        a[0].localeCompare(b[0], undefined, { sensitivity: "base" }),
      ),
    [entries],
  );

  const handleAdd = useCallback(() => {
    const trimmedKey = keyDraft.trim();
    if (!trimmedKey || !selectedGroup) {
      return;
    }

    // Validate before adding
    const error = validateNetworkEntry(trimmedKey);
    if (error) {
      setValidationError(error);
      return;
    }

    setValidationError(undefined);
    const nextMap = { ...entries, [trimmedKey]: selectedGroup };
    onChange(nextMap);
    setKeyDraft("");
  }, [entries, keyDraft, onChange, selectedGroup, validateNetworkEntry]);

  const handleStartEdit = useCallback((key: string, value: string) => {
    setEditingKey(key);
    setEditDraft(key);
    setEditGroupDraft(value);
    setValidationError(undefined);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingKey(null);
    setEditDraft("");
    setEditGroupDraft("");
    setValidationError(undefined);
  }, []);

  const handleSaveEdit = useCallback(
    (oldKey: string) => {
      const trimmedKey = editDraft.trim();
      if (!trimmedKey || !editGroupDraft) {
        return;
      }

      // Validate before saving
      const error = validateNetworkEntry(trimmedKey);
      if (error) {
        setValidationError(error);
        return;
      }

      setValidationError(undefined);
      const nextMap = { ...entries };

      // Remove old key
      delete nextMap[oldKey];

      // Add new key/value (or update if key didn't change)
      nextMap[trimmedKey] = editGroupDraft;

      onChange(nextMap);
      setEditingKey(null);
      setEditDraft("");
      setEditGroupDraft("");
    },
    [entries, editDraft, editGroupDraft, onChange, validateNetworkEntry],
  );

  const handleRemove = useCallback(
    (key: string) => {
      const nextMap = { ...entries };
      delete nextMap[key];
      onChange(nextMap);
      setRemoveConfirm(null);
    },
    [entries, onChange],
  );

  const handleRemoveClick = useCallback((key: string) => {
    setRemoveConfirm(key);
  }, []);

  const handleCancelRemove = useCallback(() => {
    setRemoveConfirm(null);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleAdd();
      }
    },
    [handleAdd],
  );

  const canAdd =
    Boolean(keyDraft.trim()) && Boolean(selectedGroup) && groups.length > 0;

  return (
    <div className="field-group">
      <div className="mapping-editor__header">
        <label htmlFor={id}>{label}</label>
        <div className="mapping-editor__view-toggle">
          <button
            type="button"
            className={`mapping-editor__view-btn ${viewMode === "list" ? "mapping-editor__view-btn--active" : ""}`}
            onClick={() => setViewMode("list")}
            aria-label="List view"
            title="List view"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                x="2"
                y="3"
                width="12"
                height="2"
                rx="1"
                fill="currentColor"
              />
              <rect
                x="2"
                y="7"
                width="12"
                height="2"
                rx="1"
                fill="currentColor"
              />
              <rect
                x="2"
                y="11"
                width="12"
                height="2"
                rx="1"
                fill="currentColor"
              />
            </svg>
          </button>
          <button
            type="button"
            className={`mapping-editor__view-btn ${viewMode === "grid" ? "mapping-editor__view-btn--active" : ""}`}
            onClick={() => setViewMode("grid")}
            aria-label="Grid view"
            title="Grid view"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect
                x="2"
                y="2"
                width="5"
                height="5"
                rx="1"
                fill="currentColor"
              />
              <rect
                x="9"
                y="2"
                width="5"
                height="5"
                rx="1"
                fill="currentColor"
              />
              <rect
                x="2"
                y="9"
                width="5"
                height="5"
                rx="1"
                fill="currentColor"
              />
              <rect
                x="9"
                y="9"
                width="5"
                height="5"
                rx="1"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="mapping-editor">
        {sortedEntries.length > 0 ?
          <ul
            className={`mapping-editor__items ${viewMode === "grid" ? "mapping-editor__items--grid" : ""}`}
          >
            {sortedEntries.map(([key, value]) => {
              const isEditing = editingKey === key;

              return (
                <li
                  key={key}
                  className={`mapping-editor__item ${isEditing ? "mapping-editor__item--editing" : ""}`}
                >
                  {isEditing ?
                    <>
                      <div className="mapping-editor__edit-form">
                        <input
                          name="editMappingKey"
                          type="text"
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          placeholder={keyPlaceholder}
                          className="mapping-editor__edit-input"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSaveEdit(key);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              handleCancelEdit();
                            }
                          }}
                        />
                        <span className="mapping-editor__arrow">→</span>
                        <select
                          name="editMappingGroup"
                          value={editGroupDraft}
                          onChange={(e) => setEditGroupDraft(e.target.value)}
                          className="mapping-editor__edit-select"
                        >
                          {groups.map((group) => (
                            <option key={group} value={group}>
                              {group}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mapping-editor__edit-actions">
                        <button
                          type="button"
                          className="mapping-editor__edit-save"
                          onClick={() => handleSaveEdit(key)}
                          aria-label="Save changes"
                          title="Save (Enter)"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="mapping-editor__edit-cancel"
                          onClick={handleCancelEdit}
                          aria-label="Cancel editing"
                          title="Cancel (Esc)"
                        >
                          ✕
                        </button>
                      </div>
                    </>
                  : <>
                      <span
                        className="mapping-editor__entry"
                        aria-label={`${keyLabel} mapping`}
                      >
                        <span className="mapping-editor__key">{key}</span>
                        <span className="mapping-editor__arrow">→</span>
                        <span className="mapping-editor__value">{value}</span>
                      </span>
                      <div className="mapping-editor__actions">
                        <button
                          type="button"
                          className="mapping-editor__edit"
                          onClick={() => handleStartEdit(key, value)}
                          aria-label={`Edit mapping for ${key}`}
                          title="Edit mapping"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="mapping-editor__remove"
                          onClick={() => handleRemoveClick(key)}
                          aria-label={`Remove mapping for ${key}`}
                          title="Remove mapping"
                        >
                          ✕
                        </button>
                      </div>
                    </>
                  }
                </li>
              );
            })}
          </ul>
        : <p className="mapping-editor__empty">{emptyLabel}</p>}
        {groups.length === 0 && (
          <p className="mapping-editor__empty-note">
            Create a group before adding mappings.
          </p>
        )}
        {validationError && (
          <div className="mapping-editor__error">
            <span className="status status--error">{validationError}</span>
          </div>
        )}
        <div className="mapping-editor__input">
          <input
            id={id}
            name={`${id}-key-input`}
            type="text"
            value={keyDraft}
            onChange={(event) => {
              setKeyDraft(event.target.value);
              if (validationError) setValidationError(undefined);
            }}
            onKeyDown={handleKeyDown}
            placeholder={keyPlaceholder}
          />
          <select
            name={`${id}-group-select`}
            aria-label={`${label} target group`}
            value={selectedGroup}
            onChange={(event) => setSelectedGroup(event.target.value)}
            disabled={groups.length === 0}
          >
            {groups.length === 0 ?
              <option value="">No groups available</option>
            : groups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))
            }
          </select>
          <button
            type="button"
            className="secondary"
            onClick={handleAdd}
            disabled={!canAdd}
          >
            Add mapping
          </button>
        </div>
      </div>
      {hint && <span className="field-hint">{hint}</span>}

      {/* Confirmation Modal */}
      {removeConfirm && (
        <div className="sync-view__dialog-overlay" onClick={handleCancelRemove}>
          <div
            className="sync-view__dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="sync-view__dialog-title">Confirm Removal</h3>
            <div className="sync-view__dialog-content">
              <p className="sync-view__dialog-message">
                Are you sure you want to remove the mapping for{" "}
                <strong>{removeConfirm}</strong>?
              </p>
              <div className="sync-view__dialog-warning">
                <strong>{removeConfirm}</strong> →{" "}
                <strong>{entries[removeConfirm]}</strong>
              </div>
            </div>
            <div className="sync-view__dialog-actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={handleCancelRemove}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button--danger"
                onClick={() => handleRemove(removeConfirm)}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function serializeConfig(
  config: AdvancedBlockingConfig | AdvancedBlockingConfig[] | undefined | null,
): string {
  if (!config) {
    return "null";
  }

  return JSON.stringify(config);
}

function sanitizeConfig(
  config: AdvancedBlockingConfig,
): AdvancedBlockingConfig {
  return {
    enableBlocking: config.enableBlocking,
    blockListUrlUpdateIntervalHours: config.blockListUrlUpdateIntervalHours,
    blockListUrlUpdateIntervalMinutes: config.blockListUrlUpdateIntervalMinutes,
    localEndPointGroupMap: sanitizeMap(config.localEndPointGroupMap),
    networkGroupMap: sanitizeMap(config.networkGroupMap),
    groups: config.groups.map(sanitizeGroup),
  };
}

function findUnknownGroupMappings(config: AdvancedBlockingConfig): string[] {
  const knownGroups = new Set(config.groups.map((group) => group.name));
  const unknown = new Set<string>();

  for (const target of Object.values(config.localEndPointGroupMap)) {
    if (!knownGroups.has(target)) {
      unknown.add(target);
    }
  }

  for (const target of Object.values(config.networkGroupMap)) {
    if (!knownGroups.has(target)) {
      unknown.add(target);
    }
  }

  return [...unknown];
}

function renameMappingTarget(
  source: Record<string, string>,
  previousName: string,
  nextName: string,
): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(source)) {
    if (value === previousName) {
      entries.push([key, nextName]);
    } else {
      entries.push([key, value]);
    }
  }
  return Object.fromEntries(entries);
}

function removeMappingTarget(
  source: Record<string, string>,
  targetName: string,
): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(source)) {
    if (value !== targetName) {
      entries.push([key, value]);
    }
  }
  return Object.fromEntries(entries);
}

function sanitizeGroup(group: AdvancedBlockingGroup): AdvancedBlockingGroup {
  return {
    name: group.name,
    enableBlocking: group.enableBlocking,
    allowTxtBlockingReport: group.allowTxtBlockingReport,
    blockAsNxDomain: group.blockAsNxDomain,
    blockingAddresses: sanitizeStringList(group.blockingAddresses),
    allowed: sanitizeStringList(group.allowed),
    blocked: sanitizeStringList(group.blocked),
    allowListUrls: sanitizeUrlEntries(group.allowListUrls),
    blockListUrls: sanitizeUrlEntries(group.blockListUrls),
    allowedRegex: sanitizeStringList(group.allowedRegex),
    blockedRegex: sanitizeStringList(group.blockedRegex),
    regexAllowListUrls: sanitizeUrlEntries(group.regexAllowListUrls),
    regexBlockListUrls: sanitizeUrlEntries(group.regexBlockListUrls),
    adblockListUrls: sanitizeStringList(group.adblockListUrls),
  };
}
function sanitizeMap(map: Record<string, string>): Record<string, string> {
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();

  for (const [key, value] of Object.entries(map)) {
    const trimmedKey = key.trim();
    const trimmedValue = value.trim();
    if (!trimmedKey || !trimmedValue) {
      continue;
    }

    // Prefer the last entry encountered if duplicates exist.
    if (seen.has(trimmedKey)) {
      const existingIndex = entries.findIndex(
        ([candidate]) => candidate === trimmedKey,
      );
      if (existingIndex !== -1) {
        entries[existingIndex] = [trimmedKey, trimmedValue];
        continue;
      }
    }

    seen.add(trimmedKey);
    entries.push([trimmedKey, trimmedValue]);
  }

  return Object.fromEntries(entries);
}

function sanitizeStringList(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function sanitizeUrlEntries(
  entries: AdvancedBlockingUrlEntry[],
): AdvancedBlockingUrlEntry[] {
  const result: AdvancedBlockingUrlEntry[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }

      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(trimmed);
      continue;
    }

    const sanitized = sanitizeUrlOverride(entry);
    if (!sanitized) {
      continue;
    }

    const key = sanitized.url.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(sanitized);
  }

  return result;
}

function sanitizeUrlOverride(
  source: AdvancedBlockingUrlOverride,
): AdvancedBlockingUrlOverride | null {
  const url = source.url?.trim();
  if (!url) {
    return null;
  }

  const blockingAddresses =
    source.blockingAddresses ?
      sanitizeStringList(source.blockingAddresses)
    : undefined;

  return {
    url,
    blockAsNxDomain: Boolean(source.blockAsNxDomain),
    blockingAddresses:
      blockingAddresses && blockingAddresses.length > 0 ?
        blockingAddresses
      : undefined,
  };
}

function cloneConfig(config: AdvancedBlockingConfig): AdvancedBlockingConfig {
  return {
    enableBlocking: config.enableBlocking,
    blockListUrlUpdateIntervalHours: config.blockListUrlUpdateIntervalHours,
    blockListUrlUpdateIntervalMinutes: config.blockListUrlUpdateIntervalMinutes,
    localEndPointGroupMap: { ...config.localEndPointGroupMap },
    networkGroupMap: { ...config.networkGroupMap },
    groups: config.groups.map(cloneGroup),
  };
}

function cloneGroup(group: AdvancedBlockingGroup): AdvancedBlockingGroup {
  return {
    name: group.name,
    enableBlocking: group.enableBlocking,
    allowTxtBlockingReport: group.allowTxtBlockingReport,
    blockAsNxDomain: group.blockAsNxDomain,
    blockingAddresses: [...group.blockingAddresses],
    allowed: [...group.allowed],
    blocked: [...group.blocked],
    allowListUrls: cloneUrlEntries(group.allowListUrls),
    blockListUrls: cloneUrlEntries(group.blockListUrls),
    allowedRegex: [...group.allowedRegex],
    blockedRegex: [...group.blockedRegex],
    regexAllowListUrls: cloneUrlEntries(group.regexAllowListUrls),
    regexBlockListUrls: cloneUrlEntries(group.regexBlockListUrls),
    adblockListUrls: [...group.adblockListUrls],
  };
}

function createEmptyGroup(name: string): AdvancedBlockingGroup {
  return {
    name,
    enableBlocking: true,
    allowTxtBlockingReport: true,
    blockAsNxDomain: true,
    blockingAddresses: ["0.0.0.0", "::"],
    allowed: [],
    blocked: [],
    allowListUrls: [],
    blockListUrls: [],
    allowedRegex: [],
    blockedRegex: [],
    regexAllowListUrls: [],
    regexBlockListUrls: [],
    adblockListUrls: [],
  };
}

function cloneUrlEntries(
  entries: AdvancedBlockingUrlEntry[],
): AdvancedBlockingUrlEntry[] {
  return entries.map((entry) => {
    if (typeof entry === "string") {
      return entry;
    }

    return {
      url: entry.url,
      blockAsNxDomain: entry.blockAsNxDomain,
      blockingAddresses:
        entry.blockingAddresses ? [...entry.blockingAddresses] : undefined,
    };
  });
}
