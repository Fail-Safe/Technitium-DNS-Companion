import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle, faTrash, faExclamationCircle } from '@fortawesome/free-solid-svg-icons';
import './ConfirmModal.css';

export type ConfirmModalVariant = 'warning' | 'danger' | 'info';

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string | React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: ConfirmModalVariant;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Reusable confirmation modal to replace window.confirm()
 */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
    isOpen,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'warning',
    onConfirm,
    onCancel,
}) => {
    if (!isOpen) return null;

    const getIcon = () => {
        switch (variant) {
            case 'danger':
                return faTrash;
            case 'info':
                return faExclamationCircle;
            default:
                return faExclamationTriangle;
        }
    };

    return (
        <div className="confirm-modal-overlay" onClick={onCancel}>
            <div
                className={`confirm-modal confirm-modal--${variant}`}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="confirm-modal-title"
            >
                <div className="confirm-modal__header">
                    <div className={`confirm-modal__icon confirm-modal__icon--${variant}`}>
                        <FontAwesomeIcon icon={getIcon()} />
                    </div>
                    <h2 id="confirm-modal-title" className="confirm-modal__title">
                        {title}
                    </h2>
                </div>

                <div className="confirm-modal__body">
                    {typeof message === 'string' ? (
                        <p className="confirm-modal__message">{message}</p>
                    ) : (
                        message
                    )}
                </div>

                <div className="confirm-modal__actions">
                    <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={onCancel}
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        className={`btn ${variant === 'danger' ? 'btn--danger' : 'btn--primary'}`}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;
