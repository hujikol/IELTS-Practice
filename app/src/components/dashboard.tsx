import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  listAttempts,
  createAttempt,
  deleteAttempt,
  type AttemptSummary,
  type AttemptRecord,
} from '../lib/attempts.ts';
import { createConversationalListeningAttempt } from '../lib/sample-material.ts';
import { emptyTest } from '../lib/material.ts';
import { loadProviderConfig, type ProviderConfig } from '../lib/providers.ts';
import { ieltsBandToCefr } from '../lib/bands.ts';
import { AiConnectionModal, AiConnectionStatusPill } from './ai-connection.tsx';
import { DeleteTestModal } from './delete-test-modal.tsx';
import { Button } from './ui/button.tsx';
import type { Scope } from '../lib/types.ts';

function formatLastUpdated(timestamp: number | undefined | null): string {
  if (!timestamp || typeof timestamp !== 'number' || isNaN(timestamp)) {
    return 'Recently';
  }
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return 'Recently';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Recently';
  }
}

function formatCompletedDate(timestamp: number | undefined | null): string {
  if (!timestamp || typeof timestamp !== 'number' || isNaN(timestamp)) {
    return 'Recently completed';
  }
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return 'Recently completed';
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return 'Recently completed';
  }
}

interface DashboardProps {
  onOpenAttempt: (id: string) => void;
  onStartPreparation: (attempt: AttemptRecord) => void;
}

const MODULE_OPTIONS = [
  {
    scope: 'full' as Scope,
    title: 'Full Mock Test',
    desc: 'All 4 modules (Listening, Reading, Writing, Speaking)',
    icon: '📚',
    time: '~2h 45m',
  },
  {
    scope: 'listening' as Scope,
    title: 'Listening',
    desc: '4 parts · 40 questions with neural audio',
    icon: '🎧',
    time: '30 mins',
  },
  {
    scope: 'reading' as Scope,
    title: 'Reading',
    desc: '3 academic passages · 40 questions',
    icon: '📖',
    time: '60 mins',
  },
  {
    scope: 'writing' as Scope,
    title: 'Writing',
    desc: 'Task 1 visual report & Task 2 essay',
    icon: '✍️',
    time: '60 mins',
  },
  {
    scope: 'speaking' as Scope,
    title: 'Speaking',
    desc: '3-part interactive interview & cue card',
    icon: '🗣️',
    time: '14 mins',
  },
];

export function Dashboard({ onOpenAttempt, onStartPreparation }: DashboardProps) {
  const [summaries, setSummaries] = useState<AttemptSummary[] | null>(null);
  const [selectedMode, setSelectedMode] = useState<'timed' | 'untimed'>('untimed');
  const [selectedScope, setSelectedScope] = useState<Scope>('full');
  const [selectedPart, setSelectedPart] = useState<number>(1);
  const [showAiModal, setShowAiModal] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(loadProviderConfig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listAttempts();
      setSummaries(data);
    } catch {
      setSummaries([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreateTest = async () => {
    setBusy(true);
    setError(null);
    try {
      const meta = providerConfig.enabled
        ? { provider: 'api', model: providerConfig.model || 'gpt-4o', createdAt: Date.now() }
        : { provider: 'manual-copy-paste', model: 'external-chat', createdAt: Date.now() };

      const data = emptyTest(selectedScope, selectedPart, 'balanced', meta);
      const created = await createAttempt({
        mode: selectedMode,
        scope: selectedScope,
        practice_part: selectedPart,
        data,
      });
      onStartPreparation(created);
    } catch (e) {
      setError((e as Error).message || 'Failed to create new practice test.');
    } finally {
      setBusy(false);
    }
  };

  const handleLaunchConversationalListening = async () => {
    setBusy(true);
    try {
      const att = await createConversationalListeningAttempt(selectedMode);
      onOpenAttempt(att.id);
    } catch (e) {
      setError((e as Error).message || 'Failed to start conversational listening practice.');
    } finally {
      setBusy(false);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<AttemptSummary | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (summary: AttemptSummary, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteTarget(summary);
  };

  const handleConfirmDelete = async (id: string) => {
    setIsDeleting(true);
    try {
      await deleteAttempt(id);
      setDeleteTarget(null);
      await refresh();
    } catch {
      setError('Could not delete test.');
    } finally {
      setIsDeleting(false);
    }
  };

  const inProgressTests = summaries?.filter((s) => s.status === 'preparing' || s.status === 'active') ?? [];
  const completedTests = summaries?.filter((s) => s.status === 'completed') ?? [];

  const completedStats = useMemo(() => {
    if (!completedTests.length) return null;
    const scoredTests = completedTests.filter((t) => typeof t.overallBand === 'number' && t.overallBand > 0);
    const bestBand = scoredTests.length ? Math.max(...scoredTests.map((t) => t.overallBand!)) : null;
    const bestCefr = bestBand ? ieltsBandToCefr(bestBand) : null;
    const latestTest = completedTests[0];
    const latestBand = latestTest?.overallBand ?? null;
    const latestCefr = latestBand ? ieltsBandToCefr(latestBand) : null;

    const calcAvg = (key: 'listening' | 'reading' | 'writing' | 'speaking') => {
      const vals = completedTests
        .map((t) => t.bands?.[key])
        .filter((b): b is number => typeof b === 'number' && b > 0);
      if (!vals.length) return null;
      return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
    };

    return {
      count: completedTests.length,
      bestBand,
      bestCefr,
      latestBand,
      latestCefr,
      avgListening: calcAvg('listening'),
      avgReading: calcAvg('reading'),
      avgWriting: calcAvg('writing'),
      avgSpeaking: calcAvg('speaking'),
    };
  }, [completedTests]);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 48px', fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: '#0f172a' }}>
      {/* Header Banner */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          paddingBottom: 24,
          borderBottom: '1px solid #e2e8f0',
          marginBottom: 28,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 100%)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.2rem',
              letterSpacing: '-0.02em',
              boxShadow: '0 2px 8px rgba(37, 99, 235, 0.25)',
            }}
          >
            IE
          </span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                IELTS Studio
              </h1>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 9999,
                  background: '#eff6ff',
                  color: '#1d4ed8',
                  border: '1px solid #bfdbfe',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                Academic Practice
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: '#64748b' }}>
              Private offline-first IELTS practice with neural voice synthesis &amp; code-verified scoring.
            </p>
          </div>
        </div>

        {/* AI Connection Status Pill Button */}
        <AiConnectionStatusPill onClick={() => setShowAiModal(true)} config={providerConfig} />
      </header>

      {/* AI Connection Modal */}
      <AiConnectionModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        onConfigChanged={setProviderConfig}
      />

      {error && (
        <div
          role="alert"
          style={{
            background: '#fff1f2',
            border: '1px solid #fecdd3',
            color: '#be123c',
            padding: '12px 16px',
            borderRadius: 10,
            marginBottom: 24,
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      <main style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
        {/* Performance Overview (Shown when completed tests exist) */}
        {completedStats && (
          <section
            aria-labelledby="overview-heading"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 16,
              padding: '20px 24px',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
                    Best Estimated Band
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
                    <span style={{ fontSize: '2.1rem', fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>
                      {completedStats.bestBand ? completedStats.bestBand.toFixed(1) : '—'}
                    </span>
                    {completedStats.bestCefr && (
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: '0.75rem',
                          fontWeight: 800,
                          backgroundColor: completedStats.bestCefr.badgeStyle.bg,
                          color: completedStats.bestCefr.badgeStyle.text,
                          border: `1px solid ${completedStats.bestCefr.badgeStyle.border}`,
                        }}
                      >
                        CEFR {completedStats.bestCefr.level} · {completedStats.bestCefr.name.split(' ')[0]}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ width: 1, height: 42, backgroundColor: '#e2e8f0' }} aria-hidden="true" />

                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block' }}>
                    Latest Exam Band
                  </span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#2563eb', lineHeight: 1 }}>
                      {completedStats.latestBand ? completedStats.latestBand.toFixed(1) : '—'}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      ({completedStats.count} test{completedStats.count > 1 ? 's' : ''} total)
                    </span>
                  </div>
                </div>
              </div>

              {/* Category Averages Row */}
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                  background: '#f8fafc',
                  padding: '8px 14px',
                  borderRadius: 10,
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ fontSize: '0.82rem', color: '#334155' }}>
                  🎧 Listening <strong>{completedStats.avgListening ? `Band ${completedStats.avgListening}` : '—'}</strong>
                </div>
                <div style={{ width: 1, height: 16, backgroundColor: '#cbd5e1', alignSelf: 'center' }} aria-hidden="true" />
                <div style={{ fontSize: '0.82rem', color: '#334155' }}>
                  📖 Reading <strong>{completedStats.avgReading ? `Band ${completedStats.avgReading}` : '—'}</strong>
                </div>
                <div style={{ width: 1, height: 16, backgroundColor: '#cbd5e1', alignSelf: 'center' }} aria-hidden="true" />
                <div style={{ fontSize: '0.82rem', color: '#334155' }}>
                  ✍️ Writing <strong>{completedStats.avgWriting ? `Band ${completedStats.avgWriting}` : '—'}</strong>
                </div>
                <div style={{ width: 1, height: 16, backgroundColor: '#cbd5e1', alignSelf: 'center' }} aria-hidden="true" />
                <div style={{ fontSize: '0.82rem', color: '#334155' }}>
                  🗣️ Speaking <strong>{completedStats.avgSpeaking ? `Band ${completedStats.avgSpeaking}` : '—'}</strong>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Section: Simple & Intuitive Test Launcher */}
        <section
          aria-labelledby="start-test-heading"
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: '24px 28px',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
            <div>
              <h2 id="start-test-heading" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                Start Practice Session
              </h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: '#64748b' }}>
                Select your focus module and preferred exam timing condition.
              </p>
            </div>

            {/* Test Timing Segmented Control */}
            <div
              role="radiogroup"
              aria-label="Test timing mode"
              style={{
                display: 'inline-flex',
                background: '#f1f5f9',
                padding: '3px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
              }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selectedMode === 'untimed'}
                onClick={() => setSelectedMode('untimed')}
                style={{
                  border: 'none',
                  background: selectedMode === 'untimed' ? '#ffffff' : 'transparent',
                  color: selectedMode === 'untimed' ? '#1d4ed8' : '#64748b',
                  fontWeight: selectedMode === 'untimed' ? 700 : 500,
                  fontSize: '0.82rem',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  boxShadow: selectedMode === 'untimed' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>∞</span>
                <span>Self-Paced (Untimed)</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={selectedMode === 'timed'}
                onClick={() => setSelectedMode('timed')}
                style={{
                  border: 'none',
                  background: selectedMode === 'timed' ? '#ffffff' : 'transparent',
                  color: selectedMode === 'timed' ? '#1d4ed8' : '#64748b',
                  fontWeight: selectedMode === 'timed' ? 700 : 500,
                  fontSize: '0.82rem',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  boxShadow: selectedMode === 'timed' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>⏱</span>
                <span>Exam Timed</span>
              </button>
            </div>
          </div>

          {/* Module Selector: 5 intuitive cards */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              marginBottom: 24,
            }}
          >
            {MODULE_OPTIONS.map((m) => {
              const isSelected = selectedScope === m.scope;
              return (
                <div
                  key={m.scope}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedScope(m.scope);
                    setSelectedPart(m.scope === 'full' ? 0 : 1);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setSelectedScope(m.scope);
                      setSelectedPart(m.scope === 'full' ? 0 : 1);
                    }
                  }}
                  style={{
                    border: '1.5px solid',
                    borderColor: isSelected ? '#2563eb' : '#e2e8f0',
                    background: isSelected ? '#eff6ff' : '#ffffff',
                    borderRadius: 12,
                    padding: '14px 16px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    boxShadow: isSelected ? '0 2px 8px rgba(37, 99, 235, 0.12)' : '0 1px 2px rgba(0,0,0,0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: 90,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '1.25rem' }}>{m.icon}</span>
                      <strong style={{ fontSize: '0.95rem', color: isSelected ? '#1d4ed8' : '#0f172a' }}>
                        {m.title}
                      </strong>
                    </div>
                    {isSelected && (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: '#2563eb',
                        }}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.35 }}>
                      {m.desc}
                    </p>
                    <span style={{ display: 'inline-block', marginTop: 6, fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>
                      {m.time}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 12,
              paddingTop: 16,
              borderTop: '1px solid #f1f5f9',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Contextual conversational listening shortcut */}
              {(selectedScope === 'full' || selectedScope === 'listening') && (
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  icon="🎧"
                  onClick={handleLaunchConversationalListening}
                  title="Practice 2-way conversation dialogue with real-time Kokoro FP32 neural speech"
                >
                  2-Way Conversational Listening
                </Button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                icon="🚀"
                onClick={handleCreateTest}
              >
                {selectedScope === 'full' ? 'Create Full Mock Test →' : `Start ${MODULE_OPTIONS.find((m) => m.scope === selectedScope)?.title} Practice →`}
              </Button>
            </div>
          </div>
        </section>

        {/* Section: In-Progress Tests (Active Practice) */}
        {inProgressTests.length > 0 && (
          <section aria-labelledby="in-progress-heading">
            <h2 id="in-progress-heading" style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>
              Tests in Progress ({inProgressTests.length})
            </h2>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {inProgressTests.map((t) => {
                const isComplete = t.preparedCount === t.jobCount;
                return (
                  <article
                    key={t.id}
                    onClick={() => onOpenAttempt(t.id)}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: '14px 18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 12,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#93c5fd')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#e2e8f0')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: 9999,
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: t.status === 'active' ? '#ecfdf5' : isComplete ? '#eff6ff' : '#fffbeb',
                          color: t.status === 'active' ? '#047857' : isComplete ? '#1d4ed8' : '#b45309',
                          border: `1px solid ${t.status === 'active' ? '#a7f3d0' : isComplete ? '#bfdbfe' : '#fde68a'}`,
                        }}
                      >
                        {t.status === 'active' ? 'Testing' : isComplete ? 'Ready' : 'Draft'}
                      </span>
                      <div>
                        <strong style={{ fontSize: '0.98rem', color: '#0f172a', textTransform: 'capitalize' }}>
                          {t.scope === 'full' ? 'Full Mock Test' : `${t.scope || 'Practice'} Section`} · {t.mode === 'timed' ? '⏱ Timed' : '∞ Self-Paced'}
                        </strong>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>
                          {t.preparedCount ?? 0} of {t.jobCount ?? 0} sections ready · Last updated {formatLastUpdated(t.updatedAt)}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Button
                        variant={t.status === 'active' || isComplete ? 'primary' : 'secondary'}
                        size="sm"
                        icon={t.status === 'active' || isComplete ? '▶' : '📋'}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenAttempt(t.id);
                        }}
                      >
                        {t.status === 'active' ? 'Resume Test →' : isComplete ? 'Start Test →' : 'Continue Preparation →'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="🗑️"
                        className="ui-btn-delete"
                        onClick={(e) => handleDeleteClick(t, e)}
                        title="Delete in-progress test permanently"
                      >
                        Delete
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {/* Section: Completed Test History */}
        <section aria-labelledby="history-heading">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
            <div>
              <h2 id="history-heading" style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                Completed Test History ({completedTests.length})
              </h2>
              <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 3 }}>
                Past test performances, category band scores, and CEFR estimates.
              </div>
            </div>
          </div>

          {completedTests.length === 0 ? (
            <div
              style={{
                background: '#ffffff',
                border: '1px dashed #cbd5e1',
                borderRadius: 14,
                padding: '36px 20px',
                textAlign: 'center',
                color: '#64748b',
              }}
            >
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>📊</div>
              <strong style={{ fontSize: '0.95rem', color: '#334155', display: 'block', marginBottom: 4 }}>
                No completed tests yet
              </strong>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                Start a practice test above. Once completed, your scores, detailed answers, and CEFR ratings will be preserved here.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {completedTests.map((t) => {
                const cefrInfo = ieltsBandToCefr(t.overallBand);
                const hasOverall = typeof t.overallBand === 'number' && t.overallBand > 0;

                return (
                  <article
                    key={t.id}
                    onClick={() => onOpenAttempt(t.id)}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 12,
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 16,
                      cursor: 'pointer',
                      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#93c5fd')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#e2e8f0')}
                  >
                    {/* Left: Title, Mode, Date */}
                    <div style={{ minWidth: 220 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ fontSize: '0.98rem', color: '#0f172a', textTransform: 'capitalize' }}>
                          {t.scope === 'full' ? 'Full Academic Mock' : `${t.scope || 'Practice'} Section`}
                        </strong>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: '#f1f5f9',
                            color: '#475569',
                            fontWeight: 600,
                          }}
                        >
                          {t.mode === 'timed' ? '⏱ Timed' : '∞ Self-Paced'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 4 }}>
                        {formatCompletedDate(t.updatedAt)}
                      </div>
                    </div>

                    {/* Middle: Clean Category Band Chips */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.78rem',
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: typeof t.bands?.listening === 'number' ? '#eff6ff' : '#f8fafc',
                          color: typeof t.bands?.listening === 'number' ? '#1d4ed8' : '#94a3b8',
                          border: '1px solid',
                          borderColor: typeof t.bands?.listening === 'number' ? '#bfdbfe' : '#e2e8f0',
                          fontWeight: 600,
                        }}
                      >
                        🎧 {typeof t.bands?.listening === 'number' ? t.bands.listening.toFixed(1) : '—'}
                      </span>

                      <span
                        style={{
                          fontSize: '0.78rem',
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: typeof t.bands?.reading === 'number' ? '#ecfdf5' : '#f8fafc',
                          color: typeof t.bands?.reading === 'number' ? '#047857' : '#94a3b8',
                          border: '1px solid',
                          borderColor: typeof t.bands?.reading === 'number' ? '#a7f3d0' : '#e2e8f0',
                          fontWeight: 600,
                        }}
                      >
                        📖 {typeof t.bands?.reading === 'number' ? t.bands.reading.toFixed(1) : '—'}
                      </span>

                      <span
                        style={{
                          fontSize: '0.78rem',
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: typeof t.bands?.writing === 'number' ? '#f5f3ff' : '#f8fafc',
                          color: typeof t.bands?.writing === 'number' ? '#6d28d9' : '#94a3b8',
                          border: '1px solid',
                          borderColor: typeof t.bands?.writing === 'number' ? '#ddd6fe' : '#e2e8f0',
                          fontWeight: 600,
                        }}
                      >
                        ✍️ {typeof t.bands?.writing === 'number' ? t.bands.writing.toFixed(1) : '—'}
                      </span>

                      <span
                        style={{
                          fontSize: '0.78rem',
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: typeof t.bands?.speaking === 'number' ? '#fffbeb' : '#f8fafc',
                          color: typeof t.bands?.speaking === 'number' ? '#b45309' : '#94a3b8',
                          border: '1px solid',
                          borderColor: typeof t.bands?.speaking === 'number' ? '#fde68a' : '#e2e8f0',
                          fontWeight: 600,
                        }}
                      >
                        🗣️ {typeof t.bands?.speaking === 'number' ? t.bands.speaking.toFixed(1) : '—'}
                      </span>
                    </div>

                    {/* Right: Overall Band & Action Buttons */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: '1.25rem', fontWeight: 900, color: '#0f172a' }}>
                            {hasOverall ? `Band ${t.overallBand!.toFixed(1)}` : '—'}
                          </span>
                          {cefrInfo && (
                            <span
                              style={{
                                padding: '2px 6px',
                                borderRadius: 4,
                                fontSize: '0.7rem',
                                fontWeight: 800,
                                backgroundColor: cefrInfo.badgeStyle.bg,
                                color: cefrInfo.badgeStyle.text,
                                border: `1px solid ${cefrInfo.badgeStyle.border}`,
                              }}
                              title={cefrInfo.summary}
                            >
                              {cefrInfo.level}
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="📊"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenAttempt(t.id);
                          }}
                        >
                          Review →
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="🗑️"
                          className="ui-btn-delete"
                          onClick={(e) => handleDeleteClick(t, e)}
                          title="Delete test record permanently"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Standardized Delete Confirmation Modal */}
      <DeleteTestModal
        test={deleteTarget}
        isOpen={deleteTarget !== null}
        onClose={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
        onConfirm={handleConfirmDelete}
        loading={isDeleting}
      />
    </div>
  );
}
