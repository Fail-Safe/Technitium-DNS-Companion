import { useEffect, useMemo, useState } from 'react';
import type { MigrationDhcpReservation } from '../../types/migrationPreview';

interface DhcpReservationsEditorProps {
    reservations: MigrationDhcpReservation[];
    onSave: (reservations: MigrationDhcpReservation[]) => Promise<void> | void;
}

type DraftReservation = MigrationDhcpReservation & { internalId: string };

export function DhcpReservationsEditor({ reservations, onSave }: DhcpReservationsEditorProps) {
    const [drafts, setDrafts] = useState<DraftReservation[]>(() => mapToDrafts(reservations));
    const [baseline, setBaseline] = useState<string>(() => serializeReservations(reservations));
    const [activeId, setActiveId] = useState<string | null>(drafts[0]?.internalId ?? null);
    const [status, setStatus] = useState<string | undefined>();
    const [error, setError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const nextDrafts = mapToDrafts(reservations);
        setDrafts(nextDrafts);
        setBaseline(serializeReservations(reservations));
        if (!nextDrafts.some((item) => item.internalId === activeId)) {
            setActiveId(nextDrafts[0]?.internalId ?? null);
        }
    }, [reservations, activeId]);

    const activeReservation = drafts.find((item) => item.internalId === activeId) ?? null;

    const serializedDrafts = useMemo(() => serializeDrafts(drafts), [drafts]);
    const isDirty = serializedDrafts !== baseline;

    const setReservation = (id: string, updater: (draft: DraftReservation) => DraftReservation) => {
        setDrafts((prev) => prev.map((item) => (item.internalId === id ? updater(item) : item)));
    };

    const handleAddReservation = () => {
        const internalId = `new-${Date.now()}`;
        const nextReservation: DraftReservation = {
            internalId,
            mac: '',
            ips: [],
            hostnames: [],
            sources: [],
            leaseTimes: [],
            static: true,
            scope: undefined,
        };
        setDrafts((prev) => [...prev, nextReservation]);
        setActiveId(internalId);
    };

    const handleRemove = (id: string) => {
        setDrafts((prev) => prev.filter((item) => item.internalId !== id));
        setActiveId((prevId) => {
            if (prevId !== id) {
                return prevId;
            }
            const remaining = drafts.filter((item) => item.internalId !== id);
            return remaining[0]?.internalId ?? null;
        });
    };

    const handleReset = () => {
        const nextDrafts = mapToDrafts(reservations);
        setDrafts(nextDrafts);
        setBaseline(serializeReservations(reservations));
        setActiveId(nextDrafts[0]?.internalId ?? null);
        setStatus(undefined);
        setError(undefined);
    };

    const handleSave = async () => {
        setSaving(true);
        setStatus(undefined);
        setError(undefined);

        const sanitized = drafts.map(stripInternal).map(normalizeReservation);
        const macs = new Set<string>();

        for (const reservation of sanitized) {
            if (!reservation.mac) {
                setSaving(false);
                setError('MAC address cannot be empty.');
                return;
            }
            if (macs.has(reservation.mac.toLowerCase())) {
                setSaving(false);
                setError(`Duplicate reservation for MAC ${reservation.mac}`);
                return;
            }
            macs.add(reservation.mac.toLowerCase());
            if (reservation.ips.length === 0) {
                setSaving(false);
                setError(`Reservation for ${reservation.mac} requires at least one IP.`);
                return;
            }
        }

        try {
            await onSave(sanitized);
            const payloadDrafts = mapToDrafts(sanitized.map((item) => ({ ...item, sources: item.sources ?? [] })));
            setDrafts(payloadDrafts);
            setBaseline(serializeReservations(sanitized));
            setStatus('DHCP reservations saved.');
        } catch (saveError) {
            setError((saveError as Error).message || 'Failed to save DHCP reservations.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="configuration-editor">
            <header className="configuration-editor__header">
                <div>
                    <h2>DHCP Reservations</h2>
                    <p>Align static lease assignments and ensure consistent addressing.</p>
                </div>
                <div className="configuration-editor__actions">
                    <button type="button" className="secondary" onClick={handleAddReservation}>
                        Add Reservation
                    </button>
                </div>
            </header>
            <div className="configuration-editor__body">
                <aside className="configuration-editor__list">
                    {drafts.length === 0 && <p className="configuration-editor__empty">No reservations defined.</p>}
                    {drafts.map((reservation) => (
                        <button
                            type="button"
                            key={reservation.internalId}
                            className={
                                reservation.internalId === activeId
                                    ? 'configuration-editor__list-item active'
                                    : 'configuration-editor__list-item'
                            }
                            onClick={() => setActiveId(reservation.internalId)}
                        >
                            {reservation.mac || 'New reservation'}
                        </button>
                    ))}
                </aside>
                <div className="configuration-editor__detail">
                    {!activeReservation && (
                        <p className="configuration-editor__placeholder">Select a reservation to edit.</p>
                    )}
                    {activeReservation && (
                        <form
                            className="configuration-editor__form"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void handleSave();
                            }}
                        >
                            <div className="field-group">
                                <label htmlFor="dhcp-mac">MAC Address</label>
                                <input
                                    id="dhcp-mac"
                                    value={activeReservation.mac}
                                    onChange={(event) =>
                                        setReservation(activeReservation.internalId, (draft) => ({
                                            ...draft,
                                            mac: event.target.value,
                                        }))
                                    }
                                    placeholder="AA:BB:CC:DD:EE:FF"
                                />
                            </div>
                            <div className="field-group">
                                <label htmlFor="dhcp-ips">IP Addresses</label>
                                <textarea
                                    id="dhcp-ips"
                                    value={formatList(activeReservation.ips)}
                                    onChange={(event) =>
                                        setReservation(activeReservation.internalId, (draft) => ({
                                            ...draft,
                                            ips: parseList(event.target.value),
                                        }))
                                    }
                                    placeholder="10.0.1.100"
                                />
                                <span className="field-hint">One address per line.</span>
                            </div>
                            <div className="field-group">
                                <label htmlFor="dhcp-hostnames">Hostnames</label>
                                <textarea
                                    id="dhcp-hostnames"
                                    value={formatList(activeReservation.hostnames)}
                                    onChange={(event) =>
                                        setReservation(activeReservation.internalId, (draft) => ({
                                            ...draft,
                                            hostnames: parseList(event.target.value),
                                        }))
                                    }
                                    placeholder="printer.local"
                                />
                                <span className="field-hint">Optional. One hostname per line.</span>
                            </div>
                            <div className="field-group field-group--inline">
                                <label className="checkbox">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(activeReservation.static)}
                                        onChange={(event) =>
                                            setReservation(activeReservation.internalId, (draft) => ({
                                                ...draft,
                                                static: event.target.checked,
                                            }))
                                        }
                                    />
                                    Static Lease
                                </label>
                                <label htmlFor="dhcp-scope">
                                    Scope
                                    <input
                                        id="dhcp-scope"
                                        value={activeReservation.scope ?? ''}
                                        onChange={(event) =>
                                            setReservation(activeReservation.internalId, (draft) => ({
                                                ...draft,
                                                scope: event.target.value || undefined,
                                            }))
                                        }
                                        placeholder="192.168.45.0/24"
                                    />
                                </label>
                            </div>
                            <div className="field-group">
                                <label htmlFor="dhcp-lease-times">Preferred Lease Durations</label>
                                <textarea
                                    id="dhcp-lease-times"
                                    value={formatList(activeReservation.leaseTimes)}
                                    onChange={(event) =>
                                        setReservation(activeReservation.internalId, (draft) => ({
                                            ...draft,
                                            leaseTimes: parseList(event.target.value),
                                        }))
                                    }
                                    placeholder="12h\n1d"
                                />
                                <span className="field-hint">Optional. Examples: 12h, 1d, 8h30m.</span>
                            </div>
                            {(activeReservation.sources?.length ?? 0) > 0 && (
                                <div className="field-group">
                                    <span className="field-label">Sources</span>
                                    <ul className="chip-list">
                                        {activeReservation.sources?.map((source: string) => (
                                            <li key={source}>{source}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            <div className="configuration-editor__detail-actions">
                                <button
                                    type="button"
                                    className="danger-link"
                                    onClick={() => handleRemove(activeReservation.internalId)}
                                >
                                    Remove reservation
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

function mapToDrafts(reservations: MigrationDhcpReservation[]): DraftReservation[] {
    return reservations.map((reservation) => ({
        ...reservation,
        internalId: reservation.mac || cryptoRandom(),
    }));
}

function serializeReservations(reservations: MigrationDhcpReservation[]): string {
    return JSON.stringify(reservations.map(normalizeReservation));
}

function serializeDrafts(drafts: DraftReservation[]): string {
    return JSON.stringify(drafts.map(stripInternal).map(normalizeReservation));
}

function stripInternal(draft: DraftReservation): MigrationDhcpReservation {
    const { internalId, ...rest } = draft;
    void internalId;
    return rest;
}

function normalizeReservation(reservation: MigrationDhcpReservation): MigrationDhcpReservation {
    return {
        ...reservation,
        mac: reservation.mac.trim().toLowerCase(),
        ips: normalizeList(reservation.ips),
        hostnames: normalizeList(reservation.hostnames),
        leaseTimes: normalizeList(reservation.leaseTimes),
        sources: reservation.sources?.slice() ?? [],
        static: reservation.static !== false,
        scope: reservation.scope?.trim() || undefined,
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

function cryptoRandom(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }
    return `id-${Math.random().toString(36).slice(2, 11)}`;
}
