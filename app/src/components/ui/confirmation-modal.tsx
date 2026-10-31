import React, { useEffect, useRef } from 'react';
import { Button, type ButtonVariant } from './button.tsx';

export interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  confirmIcon?: React.ReactNode;
  icon?: React.ReactNode;
  iconBgColor?: string;
  iconColor?: string;
  loading?: boolean;
  /** Optional structured preview card for target item */
  details?: React.ReactNode;
  /** Optional alert callout */
  warningNote?: string;
}

/**
 * Standardized, accessible confirmation dialog built to WCAG 2.1 AA /web-uix standards.
 * Features focus trapping, Escape dismiss, backdrop dismiss, and ARIA alertdialog semantics.
 */
export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'danger',
  confirmIcon,
  icon = '🗑️',
  iconBgColor = '#fee2e2',
  iconColor = '#b91c1c',
  loading = false,
  details,
  warningNote,
}: ConfirmationModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Focus trap and keyboard management
  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current = document.activeElement as HTMLElement | null;

    // Focus safest action by default (Cancel)
    const timer = setTimeout(() => {
      cancelBtnRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Prevent background scrolling
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      onClick={() => {
        if (!loading) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '16px',
        animation: 'modalFadeIn 0.18s ease-out',
      }}
    >
      <div
        ref={modalRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-modal-title"
        aria-describedby="confirmation-modal-desc"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '26px 28px',
          maxWidth: '480px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.12), 0 10px 10px -5px rgba(15, 23, 42, 0.04)',
          border: '1px solid #e2e8f0',
          position: 'relative',
        }}
      >
        {/* Header with Icon */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', marginBottom: '14px' }}>
          <div
            aria-hidden="true"
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '42px',
              height: '42px',
              borderRadius: '50%',
              backgroundColor: iconBgColor,
              color: iconColor,
              fontSize: '20px',
              border: `1px solid ${iconColor}22`,
            }}
          >
            {icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              id="confirmation-modal-title"
              style={{
                margin: '0 0 6px',
                fontSize: '1.22rem',
                color: '#0f172a',
                fontWeight: 800,
                letterSpacing: '-0.015em',
                lineHeight: 1.25,
              }}
            >
              {title}
            </h2>
            <div
              id="confirmation-modal-desc"
              style={{
                fontSize: '0.92rem',
                color: '#475569',
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {description}
            </div>
          </div>
        </div>

        {/* Optional Metadata Details Card */}
        {details && (
          <div
            style={{
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '12px 14px',
              marginBottom: '16px',
              fontSize: '0.86rem',
            }}
          >
            {details}
          </div>
        )}

        {/* Optional Warning Note */}
        {warningNote && (
          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: '#fff1f2',
              border: '1px solid #fecdd3',
              borderRadius: '8px',
              padding: '10px 12px',
              marginBottom: '20px',
              fontSize: '0.85rem',
              color: '#9f1239',
              fontWeight: 500,
              lineHeight: 1.4,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: '14px', flexShrink: 0 }}>⚠️</span>
            <span>{warningNote}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            marginTop: warningNote || details ? '4px' : '20px',
            paddingTop: '14px',
            borderTop: '1px solid #f1f5f9',
          }}
        >
          <Button
            ref={cancelBtnRef}
            variant="outline"
            size="md"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            size="md"
            icon={confirmIcon}
            onClick={() => void onConfirm()}
            disabled={loading}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>

      <style>{`
        @keyframes modalFadeIn {
          from {
            opacity: 0;
            transform: scale(0.97);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="presentation"] {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

