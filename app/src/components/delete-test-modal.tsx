import { ConfirmationModal } from './ui/confirmation-modal.tsx';
import type { AttemptSummary } from '../lib/attempts.ts';

export interface DeleteTestModalProps {
  test: AttemptSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (testId: string) => Promise<void> | void;
  loading?: boolean;
}

/**
 * Standardized delete confirmation modal for IELTS Studio.
 * Unifies deletion confirmation across both active in-progress tests and historical test records.
 * Complies with /web-uix accessibility, typography, and contrast standards.
 */
export function DeleteTestModal({
  test,
  isOpen,
  onClose,
  onConfirm,
  loading = false,
}: DeleteTestModalProps) {
  if (!test) return null;

  const isCompleted = test.status === 'completed';

  const scopeLabel =
    test.scope === 'full'
      ? 'Full Mock Test'
      : `${(test.scope || 'Practice').charAt(0).toUpperCase() + (test.scope || 'Practice').slice(1)} Focus Section`;

  const modeLabel = test.mode === 'timed' ? '⏱ Timed Examination' : '∞ Self-Paced Practice';

  const formattedDate = new Date(test.updatedAt || test.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Tailored title and description based on test lifecycle status
  const title = isCompleted ? 'Delete Test History Record?' : 'Delete Test In Progress?';

  const description = isCompleted
    ? 'Are you sure you want to delete this completed test from your history? The diagnostic score report, verified evidence notes, and error analysis will be permanently erased.'
    : 'Are you sure you want to delete this in-progress test? Any draft answers, prepared material, and synthesized audio tracks will be discarded immediately.';

  const confirmLabel = isCompleted ? 'Delete Record' : 'Delete Test';

  const warningNote = isCompleted
    ? 'Permanent deletion: This record and your official estimated band report cannot be recovered.'
    : 'Permanent deletion: All unsaved answers and prepared test sections will be lost.';

  // Structured test preview details
  const details = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ color: '#0f172a', fontSize: '0.92rem', fontWeight: 700 }}>
          {scopeLabel}
        </strong>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: '9999px',
            backgroundColor: isCompleted ? '#ecfdf5' : '#eff6ff',
            color: isCompleted ? '#065f46' : '#1e40af',
            border: `1px solid ${isCompleted ? '#a7f3d0' : '#bfdbfe'}`,
          }}
        >
          {isCompleted ? '✓ Completed' : '⏳ In Progress'}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', fontSize: '0.82rem', color: '#64748b' }}>
        <span>{modeLabel}</span>
        <span>•</span>
        <span>{isCompleted ? `Completed on ${formattedDate}` : `Last active ${formattedDate}`}</span>
      </div>

      {isCompleted ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '6px',
            marginTop: '4px',
            borderTop: '1px solid #e2e8f0',
            fontSize: '0.82rem',
          }}
        >
          <span style={{ color: '#475569' }}>Overall Score:</span>
          <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem' }}>
            {typeof test.overallBand === 'number' && test.overallBand > 0
              ? `Band ${test.overallBand.toFixed(1)}${test.cefr ? ` (${test.cefr})` : ''}`
              : 'Practice Score'}
          </span>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: '6px',
            marginTop: '4px',
            borderTop: '1px solid #e2e8f0',
            fontSize: '0.82rem',
          }}
        >
          <span style={{ color: '#475569' }}>Preparation:</span>
          <span style={{ fontWeight: 600, color: '#0f172a' }}>
            {test.preparedCount ?? 0} of {test.jobCount ?? 0} sections prepared
          </span>
        </div>
      )}
    </div>
  );

  return (
    <ConfirmationModal
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={() => onConfirm(test.id)}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      cancelLabel="Keep Test"
      confirmVariant="danger"
      confirmIcon="🗑️"
      icon="🗑️"
      iconBgColor="#fee2e2"
      iconColor="#dc2626"
      loading={loading}
      details={details}
      warningNote={warningNote}
    />
  );
}

