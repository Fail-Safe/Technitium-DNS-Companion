import { useEffect, useMemo, useState } from 'react';
import type { MigrationDnsOverride } from '../../types/migrationPreview';

interface DnsOverridesEditorProps {
    overrides: MigrationDnsOverride[];
    onSave: (overrides: MigrationDnsOverride[]) => Promise<void> | void;
}

type DraftOverride = MigrationDnsOverride & { internalId: string };
type FieldErrors = {
    host?: string;
    ipv4?: string;
    ipv6?: string;
};
type ValidationResult = {
    errorMap: Record<string, FieldErrors>;
    hasErrors: boolean;
};

export function DnsOverridesEditor({ overrides, onSave }: DnsOverridesEditorProps) {
    const [drafts, setDrafts] = useState<DraftOverride[]>(() => mapToDrafts(overrides));
    const [baseline, setBaseline] = useState<string>(() => serializeOverrides(overrides));
    const [activeId, setActiveId] = useState<string | null>(drafts[0]?.internalId ?? null);
    const [status, setStatus] = useState<string | undefined>();
    const [error, setError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);
    const [errorsById, setErrorsById] = useState<Record<string, FieldErrors>>({});

    useEffect(() => {
        const nextDrafts = mapToDrafts(overrides);
        setDrafts(nextDrafts);
        setBaseline(serializeOverrides(overrides));
        if (!nextDrafts.some((item) => item.internalId === activeId)) {
            setActiveId(nextDrafts[0]?.internalId ?? null);
        }
        setErrorsById({});
    }, [overrides, activeId]);

    const activeOverride = drafts.find((item) => item.internalId === activeId) ?? null;
    const activeErrors = activeId ? errorsById[activeId] ?? {} : {};

    const serializedDrafts = useMemo(() => serializeDrafts(drafts), [drafts]);
    const isDirty = serializedDrafts !== baseline;

    const setOverride = (id: string, updater: (draft: DraftOverride) => DraftOverride) => {
        setDrafts((prev) => prev.map((item) => (item.internalId === id ? updater(item) : item)));
    };

    const clearFieldError = (id: string, field: keyof FieldErrors) => {
        setErrorsById((prev) => {
            const entry = prev[id];
            if (!entry || !entry[field]) {
                return prev;
            }
            const nextEntry: FieldErrors = { ...entry };
            delete nextEntry[field];
            const next = { ...prev };
            if (Object.keys(nextEntry).length === 0) {
                delete next[id];
            } else {
                next[id] = nextEntry;
            }
            return next;
        });
    };

    const handleAddOverride = () => {
        const internalId = `new-${Date.now()}`;
        const nextOverride: DraftOverride = {
            internalId,
            host: '',
            ipv4: [],
            ipv6: [],
            sources: [],
        };

        setDrafts((prev) => [...prev, nextOverride]);
        setActiveId(internalId);
        setErrorsById((prev) => ({ ...prev, [internalId]: {} }));
    };

    const handleRemove = (id: string) => {
        setDrafts((prev) => {
            const filtered = prev.filter((item) => item.internalId !== id);
            if (activeId === id) {
                setActiveId(filtered[0]?.internalId ?? null);
            }
            return filtered;
        });
        setErrorsById((prev) => {
            if (!(id in prev)) {
                return prev;
            }
            const next = { ...prev };
            delete next[id];
            return next;
        });
    };

    const handleReset = () => {
        const nextDrafts = mapToDrafts(overrides);
        setDrafts(nextDrafts);
        setBaseline(serializeOverrides(overrides));
        setActiveId(nextDrafts[0]?.internalId ?? null);
        setStatus(undefined);
        setError(undefined);
        setErrorsById({});
    };

    const handleSave = async () => {
        setSaving(true);
        setStatus(undefined);
        setError(undefined);

        const sanitized = drafts.map(stripInternal).map(normalizeOverride);
        const validation = validateOverrides(drafts, sanitized);

        if (validation.hasErrors) {
            setSaving(false);
            setErrorsById(validation.errorMap);
            setError('Resolve the highlighted DNS override issues before saving.');
            return;
        }

        try {
            await onSave(sanitized);
            const payloadDrafts = mapToDrafts(
                sanitized.map((item) => ({ ...item, sources: item.sources ?? [] })),
            );
            setDrafts(payloadDrafts);
            setBaseline(serializeOverrides(sanitized));
            setStatus('DNS overrides saved.');
            setErrorsById({});
        } catch (saveError) {
            setError((saveError as Error).message || 'Failed to save DNS overrides.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="configuration-editor">
            <header className="configuration-editor__header">
                <div>
                    <h2>DNS Overrides</h2>
                    <p>Manage host-to-IP mappings enforced across Technitium DNS nodes.</p>
                </div>
                <div className="configuration-editor__actions">
                    <button type="button" className="secondary" onClick={handleAddOverride}>
                        Add Override
                    </button>
                </div>
            </header>
            <div className="configuration-editor__body">
                <aside className="configuration-editor__list">
                    {drafts.length === 0 && <p className="configuration-editor__empty">No overrides defined.</p>}
                    {drafts.map((override) => (
                        <button
                            type="button"
                            key={override.internalId}
                            className={
                                override.internalId === activeId
                                    ? 'configuration-editor__list-item active'
                                    : 'configuration-editor__list-item'
                            }
                            onClick={() => setActiveId(override.internalId)}
                        >
                            {override.host || 'New override'}
                        </button>
                    ))}
                </aside>
                <div className="configuration-editor__detail">
                    {!activeOverride && <p className="configuration-editor__placeholder">Select an override to edit.</p>}
                    {activeOverride && (
                        <form
                            className="configuration-editor__form"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void handleSave();
                            }}
                        >
                            <div className="field-group">
                                <label htmlFor="dns-host">Host</label>
                                <input
                                    id="dns-host"
                                    value={activeOverride.host}
                                    className={activeErrors.host ? 'field-error' : ''}
                                    onChange={(event) =>
                                        setOverride(activeOverride.internalId, (draft) => ({
                                            ...draft,
                                            host: event.target.value,
                                        }))
                                    }
                                    placeholder="example.local"
                                    onInput={() => clearFieldError(activeOverride.internalId, 'host')}
                                />
                                {activeErrors.host && (
                                    <span className="field-error-message">{activeErrors.host}</span>
                                )}
                            </div>
                            <div className="field-group">
                                <label htmlFor="dns-ipv4">IPv4 Addresses</label>
                                <textarea
                                    id="dns-ipv4"
                                    value={formatList(activeOverride.ipv4)}
                                    className={activeErrors.ipv4 ? 'field-error' : ''}
                                    onChange={(event) =>
                                        setOverride(activeOverride.internalId, (draft) => ({
                                            ...draft,
                                            ipv4: parseList(event.target.value),
                                        }))
                                    }
                                    placeholder={"10.0.0.1\n10.0.0.2"}
                                    onInput={() => clearFieldError(activeOverride.internalId, 'ipv4')}
                                />
                                <span className="field-hint">One address per line.</span>
                                {activeErrors.ipv4 && (
                                    <span className="field-error-message">{activeErrors.ipv4}</span>
                                )}
                            </div>
                            <div className="field-group">
                                <label htmlFor="dns-ipv6">IPv6 Addresses</label>
                                <textarea
                                    id="dns-ipv6"
                                    value={formatList(activeOverride.ipv6)}
                                    className={activeErrors.ipv6 ? 'field-error' : ''}
                                    onChange={(event) =>
                                        setOverride(activeOverride.internalId, (draft) => ({
                                            ...draft,
                                            ipv6: parseList(event.target.value),
                                        }))
                                    }
                                    placeholder="fd00::1"
                                    onInput={() => clearFieldError(activeOverride.internalId, 'ipv6')}
                                />
                                <span className="field-hint">Leave blank if this host has no IPv6 mapping.</span>
                                {activeErrors.ipv6 && (
                                    <span className="field-error-message">{activeErrors.ipv6}</span>
                                )}
                            </div>
                            {(activeOverride.sources?.length ?? 0) > 0 && (
                                <div className="field-group">
                                    <span className="field-label">Sources</span>
                                    <ul className="chip-list">
                                        {activeOverride.sources?.map((source: string) => (
                                            <li key={source}>{source}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div className="configuration-editor__detail-actions">
                                <button
                                    type="button"
                                    className="danger-link"
                                    onClick={() => handleRemove(activeOverride.internalId)}
                                >
                                    Remove override
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
            <footer className="configuration-editor__footer">
                <div className="configuration-editor__status">
                    {status && <span className="status status--ok">{status}</span>}
                    {error && <span className="status status--error">{error}</span>}
                </div>
                <div className="configuration-editor__footer-buttons">
                    <button type="button" className="secondary" onClick={handleReset} disabled={!isDirty || saving}>
                        Reset
                    </button>
                    <button
                        type="button"
                        className="primary"
                        onClick={() => void handleSave()}
                        disabled={!isDirty || saving}
                    >
                        Save Changes
                    </button>
                </div>
            </footer>
        </section>
    );
}

function mapToDrafts(overrides: MigrationDnsOverride[]): DraftOverride[] {
    return overrides.map((override) => ({ ...override, internalId: override.host || cryptoRandom() }));
}

function serializeOverrides(overrides: MigrationDnsOverride[]): string {
    return JSON.stringify(overrides.map(normalizeOverride));
}

function serializeDrafts(drafts: DraftOverride[]): string {
    return JSON.stringify(drafts.map(stripInternal).map(normalizeOverride));
}

function stripInternal(draft: DraftOverride): MigrationDnsOverride {
    const { internalId, ...rest } = draft;
    void internalId;
    return rest;
}

function normalizeOverride(override: MigrationDnsOverride): MigrationDnsOverride {
    return {
        ...override,
        host: override.host.trim(),
        ipv4: normalizeList(override.ipv4),
        ipv6: normalizeList(override.ipv6),
        sources: override.sources?.slice() ?? [],
    };
}

function normalizeList(values: string[]): string[] {
    return values.map((value) => value.trim()).filter(Boolean);
}

function parseList(input: string): string[] {
    return input
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);
}

function formatList(values: string[]): string {
    return values.join('\n');
}

function validateOverrides(drafts: DraftOverride[], sanitized: MigrationDnsOverride[]): ValidationResult {
    const errorMap: Record<string, FieldErrors> = {};
    const seenHosts = new Map<string, string>();

    drafts.forEach((draft, index) => {
        const override = sanitized[index];
        const errors: FieldErrors = {};

        if (!override.host) {
            errors.host = 'Host cannot be empty.';
        } else if (!isValidHostname(override.host)) {
            errors.host = 'Host must be a valid hostname.';
        }

        if (override.host) {
            const key = override.host.toLowerCase();
            const existing = seenHosts.get(key);
            if (existing && existing !== draft.internalId) {
                errors.host = `Duplicate host ${override.host}`;
            } else {
                seenHosts.set(key, draft.internalId);
            }
        }

        const invalidIpv4 = override.ipv4.find((address: string) => !isValidIpv4(address));
        if (invalidIpv4) {
            errors.ipv4 = `Invalid IPv4 address: ${invalidIpv4}`;
        }

        const invalidIpv6 = override.ipv6.find((address: string) => !isValidIpv6(address));
        if (invalidIpv6) {
            errors.ipv6 = `Invalid IPv6 address: ${invalidIpv6}`;
        }

        if (Object.keys(errors).length > 0) {
            errorMap[draft.internalId] = errors;
        }
    });

    return { errorMap, hasErrors: Object.keys(errorMap).length > 0 };
}

function isValidHostname(value: string): boolean {
    const hostnamePattern = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;
    return hostnamePattern.test(value);
}

function isValidIpv4(value: string): boolean {
    const parts = value.split('.');
    if (parts.length !== 4) {
        return false;
    }
    return parts.every((part) => {
        if (!/^\d+$/.test(part)) {
            return false;
        }
        const num = Number(part);
        return num >= 0 && num <= 255;
    });
}

function isValidIpv6(value: string): boolean {
    if (!value.includes(':')) {
        return false;
    }
    const segments = value.split(':');
    if (segments.length < 3 || segments.length > 8) {
        return false;
    }
    return segments.every((segment) => segment.length === 0 || /^[0-9a-fA-F]{1,4}$/.test(segment));
}

function cryptoRandom(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `id-${Math.random().toString(36).slice(2, 11)}`;
}
