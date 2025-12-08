/**
 * DomainTreeView Component
 *
 * Renders a hierarchical tree view of domains matching DNS structure.
 * Example: net → akadns → com → push-apple → us-sandbox-courier-4
 */

import React, { useState, useMemo, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faChevronRight,
    faChevronDown,
    faShield,
    faBan,
    faFolder,
    faPencil,
    faTrash,
    faCheck,
    faTimes,
} from '@fortawesome/free-solid-svg-icons';

export interface DomainTreeNode {
    label: string;
    fullDomain: string;
    children: DomainTreeNode[];
    isLeaf: boolean;
    domainCount: number;
}

interface DomainTreeViewProps {
    tree: DomainTreeNode;
    type: 'blocked' | 'allowed';
    onEdit?: (domain: string) => void;
    onDelete?: (domain: string) => void;
    baselineDomains?: Set<string>;
    searchTerm?: string;
    editingDomain?: string | null;
    editDomainValue?: string;
    editDomainError?: string | null;
    onChangeEditValue?: (value: string) => void;
    onSaveEdit?: () => void;
    onCancelEdit?: () => void;
    saving?: boolean;
    pendingRenames?: Array<{ from: string; to: string }>;
}

interface TreeNodeProps {
    node: DomainTreeNode;
    level: number;
    type: 'blocked' | 'allowed';
    onEdit?: (domain: string) => void;
    onDelete?: (domain: string) => void;
    baselineDomains?: Set<string>;
    searchTerm?: string;
    editingDomain?: string | null;
    editDomainValue?: string;
    editDomainError?: string | null;
    onChangeEditValue?: (value: string) => void;
    onSaveEdit?: () => void;
    onCancelEdit?: () => void;
    saving?: boolean;
    pendingRenames?: Array<{ from: string; to: string }>;
}

const TreeNodeComponent: React.FC<TreeNodeProps> = ({
    node,
    level,
    type,
    onEdit,
    onDelete,
    searchTerm,
    editingDomain,
    editDomainValue,
    editDomainError,
    onChangeEditValue,
    onSaveEdit,
    onCancelEdit,
    saving,
    pendingRenames,
    baselineDomains,
}) => {
    const [isExpanded, setIsExpanded] = useState(level === 0); // Auto-expand root

    const [isDesktop, setIsDesktop] = useState(() => {
        if (typeof window === 'undefined') return true;
        return window.innerWidth >= 900;
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const handler = () => setIsDesktop(window.innerWidth >= 900);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);

    // Check if this node or any descendants match search
    const matchesSearch = useMemo(() => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();

        // Check current node
        if (node.label.toLowerCase().includes(term) ||
            node.fullDomain.toLowerCase().includes(term)) {
            return true;
        }

        // Check descendants
        const checkChildren = (n: DomainTreeNode): boolean => {
            if (n.label.toLowerCase().includes(term) ||
                n.fullDomain.toLowerCase().includes(term)) {
                return true;
            }
            return n.children.some(checkChildren);
        };

        return node.children.some(checkChildren);
    }, [node, searchTerm]);

    // Auto-expand if search matches this path
    React.useEffect(() => {
        if (searchTerm && matchesSearch && !isExpanded) {
            setIsExpanded(true);
        }
    }, [searchTerm, matchesSearch, isExpanded]);

    if (!matchesSearch) return null;

    const hasChildren = node.children.length > 0;

    // Calculate indentation with tree lines
    const indentPx = level * 24;

    const isPendingAdd = node.isLeaf && baselineDomains && !baselineDomains.has(node.fullDomain);

    const formatFullDomain = (domain: string) => (domain.includes('.') ? domain : `*.${domain}`);

    const handleToggle = () => {
        setIsExpanded((prev) => !prev);
    };

    const rowStyle: CSSProperties = {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '10px 12px',
        paddingLeft: `${indentPx + 20}px`,
        borderBottom: '1px solid var(--color-border)',
        transition: 'background-color 0.2s ease, box-shadow 0.2s ease',
        background: isPendingAdd
            ? 'var(--color-warning-bg, rgba(251, 191, 36, 0.12))'
            : node.isLeaf
                ? type === 'blocked'
                    ? 'rgba(255, 99, 71, 0.14)'
                    : 'rgba(46, 204, 113, 0.16)'
                : 'transparent',
        boxShadow: isPendingAdd
            ? 'inset 3px 0 var(--color-warning, #f59e0b)'
            : node.isLeaf
                ? 'inset 3px 0 var(--color-border-strong, #cbd5e1)'
                : undefined,
        position: 'relative',
    };

    const contentStyle: CSSProperties = {
        display: 'flex',
        flexDirection: node.isLeaf && isDesktop ? 'column' : 'row',
        alignItems: node.isLeaf && isDesktop ? 'flex-start' : 'center',
        gap: node.isLeaf && isDesktop ? 4 : 8,
        minWidth: 0,
        flex: 1,
    };

    const actionsContainerStyle: CSSProperties = {
        display: 'flex',
        flexShrink: 0,
        alignItems: 'center',
    };

    const toggleBtnStyle: CSSProperties = {
        width: 28,
        height: 28,
        borderRadius: 6,
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: 'var(--color-text-secondary)',
        transition: 'background-color 0.15s ease, transform 0.15s ease',
    };

    // Highlight matching text
    const highlightText = (text: string) => {
        if (!searchTerm) return text;

        const parts = text.split(new RegExp(`(${searchTerm})`, 'gi'));
        return parts.map((part, i) =>
            part.toLowerCase() === searchTerm.toLowerCase() ? (
                <span
                    key={i}
                    style={{
                        background: 'rgba(250, 204, 21, 0.35)',
                        fontWeight: 700,
                        padding: '0 2px',
                        borderRadius: 4,
                    }}
                >
                    {part}
                </span>
            ) : (
                part
            ),
        );
    };

    const isEditing = editingDomain === node.fullDomain;
    const renameMatch = pendingRenames?.find(r => r.from === node.fullDomain || r.to === node.fullDomain);

    return (
        <div style={{ position: 'relative', fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace', fontSize: '13px' }}>
            {/* Tree line connecting to parent (except for root level) */}
            {level > 0 && (
                <div
                    style={{
                        position: 'absolute',
                        left: `${indentPx - 10}px`,
                        top: 0,
                        bottom: 0,
                        width: 1.5,
                        background: 'var(--color-border-strong, var(--color-border))',
                    }}
                />
            )}

            {/* Current Node */}
            <div style={rowStyle}>
                {/* Horizontal tree line */}
                {level > 0 && (
                    <div
                        style={{
                            position: 'absolute',
                            left: `${indentPx - 10}px`,
                            width: 16,
                            height: 1.5,
                            top: '50%',
                            background: 'var(--color-border-strong, var(--color-border))',
                        }}
                    />
                )}

                {/* Expand/Collapse Button */}
                {hasChildren ? (
                    <button
                        type="button"
                        onClick={handleToggle}
                        style={{
                            ...toggleBtnStyle,
                            transform: isExpanded ? 'none' : 'none',
                        }}
                        aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                        <FontAwesomeIcon
                            icon={isExpanded ? faChevronDown : faChevronRight}
                            style={{ width: 12, height: 12, color: 'var(--color-text-secondary)' }}
                        />
                    </button>
                ) : (
                    <div style={{ width: 28, marginRight: 8 }} />
                )}

                {/* Content (icon + labels) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    {/* Icon */}
                    <div style={{ marginRight: 4, flexShrink: 0 }}>
                        {node.isLeaf ? (
                            type === 'blocked' ? (
                                <FontAwesomeIcon
                                    icon={faBan}
                                    style={{ width: 16, height: 16, color: 'var(--color-danger, #d14343)' }}
                                />
                            ) : (
                                <FontAwesomeIcon
                                    icon={faShield}
                                    style={{ width: 16, height: 16, color: 'var(--color-success, #2e9f4d)' }}
                                />
                            )
                        ) : (
                            <FontAwesomeIcon
                                icon={faFolder}
                                style={{
                                    width: 16,
                                    height: 16,
                                    color: isExpanded ? 'var(--color-warning, #f5a524)' : 'var(--color-primary, #3b82f6)',
                                }}
                            />
                        )}
                    </div>

                    {/* Label + FQDN / badge */}
                    <div style={contentStyle}>
                        {isEditing && node.isLeaf ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                                <input
                                    type="text"
                                    value={editDomainValue ?? ''}
                                    onChange={(e) => onChangeEditValue?.(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            onSaveEdit?.();
                                        } else if (e.key === 'Escape') {
                                            onCancelEdit?.();
                                        }
                                    }}
                                    autoFocus
                                    className={editDomainError ? 'built-in-blocking-editor__edit-input--error' : ''}
                                    style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: '14px' }}
                                />
                                {editDomainError && (
                                    <span className="built-in-blocking-editor__edit-error">
                                        {editDomainError}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <>
                                <span
                                    style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        fontWeight: node.isLeaf ? 600 : 500,
                                        color: node.isLeaf ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                    }}
                                    title={formatFullDomain(node.fullDomain)}
                                >
                                    {highlightText(node.label)}
                                </span>
                                {!renameMatch && node.isLeaf && (
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            minWidth: 0,
                                            color: 'var(--color-text-tertiary)',
                                            fontWeight: 500,
                                            fontSize: '12px',
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        <span aria-hidden="true" style={{ color: 'var(--color-text-tertiary)' }}>
                                            →
                                        </span>
                                        <span
                                            style={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                color: 'var(--color-text-secondary)',
                                            }}
                                        >
                                            {formatFullDomain(node.fullDomain)}
                                        </span>
                                        {isPendingAdd && (
                                            <span className="built-in-blocking-editor__pending-badge built-in-blocking-editor__pending-badge--add">
                                                Pending
                                            </span>
                                        )}
                                    </span>
                                )}

                                {renameMatch && node.isLeaf && (
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            minWidth: 0,
                                            color: 'var(--color-warning, #d97706)',
                                            fontWeight: 600,
                                            fontSize: '12px',
                                            whiteSpace: 'nowrap',
                                            border: '1px solid var(--color-warning, #d97706)',
                                            borderRadius: 9999,
                                            padding: '4px 10px',
                                            background: 'rgba(217, 119, 6, 0.12)',
                                        }}
                                    >
                                        <FontAwesomeIcon icon={faPencil} style={{ width: 12, height: 12 }} />
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {formatFullDomain(renameMatch.from)} → {formatFullDomain(renameMatch.to)}
                                        </span>
                                    </span>
                                )}

                                {!node.isLeaf && (
                                    <span
                                        style={{
                                            flexShrink: 0,
                                            fontSize: '11px',
                                            padding: '2px 8px',
                                            borderRadius: 9999,
                                            background: 'var(--color-bg-tertiary)',
                                            color: 'var(--color-text-secondary)',
                                            fontWeight: 600,
                                            border: '1px solid var(--color-border)',
                                        }}
                                    >
                                        {node.domainCount}
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Actions (only for leaf nodes) */}
                {node.isLeaf && (
                    <div style={actionsContainerStyle}>
                        {isEditing ? (
                            <>
                                <button
                                    type="button"
                                    onClick={onSaveEdit}
                                    className="built-in-blocking-editor__save-edit-btn"
                                    disabled={saving}
                                    title="Save domain"
                                    aria-label={`Save ${node.fullDomain}`}
                                >
                                    <FontAwesomeIcon icon={faCheck} />
                                </button>
                                <button
                                    type="button"
                                    onClick={onCancelEdit}
                                    className="built-in-blocking-editor__cancel-edit-btn"
                                    title="Cancel edit"
                                    aria-label={`Cancel edit for ${node.fullDomain}`}
                                >
                                    <FontAwesomeIcon icon={faTimes} />
                                </button>
                            </>
                        ) : (
                            <>
                                {onEdit && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onEdit(node.fullDomain);
                                        }}
                                        className="built-in-blocking-editor__edit-btn"
                                        title="Edit domain"
                                        aria-label={`Edit ${node.fullDomain}`}
                                    >
                                        <FontAwesomeIcon icon={faPencil} />
                                    </button>
                                )}
                                {onDelete && (
                                    <button
                                        type="button"
                                        onClick={() => onDelete(node.fullDomain)}
                                        className="built-in-blocking-editor__delete-btn"
                                        title="Delete domain"
                                        aria-label={`Delete ${node.fullDomain}`}
                                    >
                                        <FontAwesomeIcon icon={faTrash} />
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Children (recursive) with slide animation */}
            {hasChildren && isExpanded && (
                <div style={{ animation: 'fade-in 150ms ease-out' }}>
                    {node.children.map((child, idx) => (
                        <TreeNodeComponent
                            key={`${child.fullDomain}-${idx}`}
                            node={child}
                            level={level + 1}
                            type={type}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            searchTerm={searchTerm}
                            editingDomain={editingDomain}
                            editDomainValue={editDomainValue}
                            editDomainError={editDomainError}
                            onChangeEditValue={onChangeEditValue}
                            onSaveEdit={onSaveEdit}
                            onCancelEdit={onCancelEdit}
                            saving={saving}
                            pendingRenames={pendingRenames}
                            baselineDomains={baselineDomains}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const DomainTreeView: React.FC<DomainTreeViewProps> = ({
    tree,
    type,
    onEdit,
    onDelete,
    searchTerm,
    editingDomain,
    editDomainValue,
    editDomainError,
    onChangeEditValue,
    onSaveEdit,
    onCancelEdit,
    saving,
    pendingRenames,
    baselineDomains,
}) => {
    // Skip rendering root itself, just render its children
    return (
        <div
            style={{
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                overflow: 'hidden',
                background: 'var(--color-bg-primary)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
                fontFamily: 'SFMono-Regular, Menlo, Consolas, monospace',
                fontSize: '13px',
            }}
        >
            {tree.children.length === 0 ? (
                <div
                    style={{
                        padding: '2.5rem 1.5rem',
                        textAlign: 'center',
                        color: 'var(--color-text-secondary)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.75rem',
                    }}
                >
                    <FontAwesomeIcon
                        icon={faFolder}
                        style={{ width: 48, height: 48, color: 'var(--color-border)' }}
                    />
                    <p style={{ margin: 0, fontWeight: 600 }}>No domains found</p>
                    {searchTerm && (
                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                            Try adjusting your search
                        </p>
                    )}
                </div>
            ) : (
                <div>
                    {tree.children.map((child, idx) => (
                        <TreeNodeComponent
                            key={`${child.fullDomain}-${idx}`}
                            node={child}
                            level={0}
                            type={type}
                            onEdit={onEdit}
                            onDelete={onDelete}
                            searchTerm={searchTerm}
                            editingDomain={editingDomain}
                            editDomainValue={editDomainValue}
                            editDomainError={editDomainError}
                            onChangeEditValue={onChangeEditValue}
                            onSaveEdit={onSaveEdit}
                            onCancelEdit={onCancelEdit}
                            saving={saving}
                            pendingRenames={pendingRenames}
                            baselineDomains={baselineDomains}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default DomainTreeView;
