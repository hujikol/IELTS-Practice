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
    return `Completed on ${d.toLocaleDateString()} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return 'Recently completed';
  }
}

interface DashboardProps {
  onOpenAttempt: (id: string) => void;
  onStartPreparation: (attempt: AttemptRecord) => void;
}

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

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this test? This action cannot be undone.')) {
      return;
    }
    try {
      await deleteAttempt(id);
      await refresh();
    } catch {
      setError('Could not delete test.');
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
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px', fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: '#0f172a' }}>
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
          marginBottom: 32,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: '#0f172a',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '1.1rem',
                letterSpacing: '-0.02em',
              }}
            >
              IE
            </span>
            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
              IELTS Studio
            </h1>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 9999,
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #cbd5e1',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              Academic Practice
            </span>
          </div>
          <p style={{ margin: '6px 0 0 0', fontSize: '0.92rem', color: '#64748b' }}>
            Private offline-first IELTS preparation with persistent local storage and automated test generation.
          </p>
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
        <div role="alert" style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '12px 16px', borderRadius: 8, marginBottom: 24 }}>
          ⚠️ {error}
        </div>
      )}

      <main>
        {/* Section 1: Create a Test */}
        <section
          aria-labelledby="start-test-heading"
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 16,
            padding: 28,
            marginBottom: 36,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 20 }}>
            <div>
              <h2 id="start-test-heading" style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
                Create New Practice Test
              </h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: '#64748b' }}>
                Select test timing model and module scope.
              </p>
            </div>
          </div>

          {/* Test Timing Selector: 2 distinct types */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
            {/* Unlimited Mode */}
            <div
              onClick={() => setSelectedMode('untimed')}
              style={{
                border: '2px solid',
                borderColor: selectedMode === 'untimed' ? '#0f172a' : '#e2e8f0',
                background: selectedMode === 'untimed' ? '#f8fafc' : '#ffffff',
                borderRadius: 12,
                padding: 20,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              role="radio"
              aria-checked={selectedMode === 'untimed'}
              tabIndex={0}
              onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setSelectedMode('untimed')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: '1.1rem', color: '#0f172a' }}>∞ Unlimited (Untimed)</strong>
                {selectedMode === 'untimed' && (
                  <span style={{ background: '#0f172a', color: '#fff', fontSize: '0.72rem', padding: '3px 8px', borderRadius: 9999, fontWeight: 700 }}>
                    Selected
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: '0.88rem', color: '#64748b', lineHeight: 1.5 }}>
                Practice freely at your own speed with no timer pressure. Great for in-depth analysis, drafting essays, and studying explanations.
              </p>
            </div>

            {/* Time-gated Mode */}
            <div
              onClick={() => setSelectedMode('timed')}
              style={{
                border: '2px solid',
                borderColor: selectedMode === 'timed' ? '#0f172a' : '#e2e8f0',
                background: selectedMode === 'timed' ? '#f8fafc' : '#ffffff',
                borderRadius: 12,
                padding: 20,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              role="radio"
              aria-checked={selectedMode === 'timed'}
              tabIndex={0}
              onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setSelectedMode('timed')}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: '1.1rem', color: '#0f172a' }}>⏱ Time-Gated Exam Simulation</strong>
                {selectedMode === 'timed' && (
                  <span style={{ background: '#0f172a', color: '#fff', fontSize: '0.72rem', padding: '3px 8px', borderRadius: 9999, fontWeight: 700 }}>
                    Selected
                  </span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: '0.88rem', color: '#64748b', lineHeight: 1.5 }}>
                Official IELTS test conditions with live countdown timers. Strict section time limits with monotonic time tracking.
              </p>
            </div>
          </div>

          {/* Scope Selector */}
          <div style={{ marginBottom: 28 }}>
            <label style={{ display: 'block', fontSize: '0.88rem', fontWeight: 700, color: '#334155', marginBottom: 10 }}>
              Select Test Modules:
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { scope: 'full' as Scope, label: 'Full Mock Test (All 4 Modules)', icon: '📚', count: 0 },
                { scope: 'listening' as Scope, label: 'Listening Only', icon: '🎧', count: 4 },
                { scope: 'reading' as Scope, label: 'Reading Only', icon: '📖', count: 3 },
                { scope: 'writing' as Scope, label: 'Writing Only', icon: '✍️', count: 2 },
                { scope: 'speaking' as Scope, label: 'Speaking Only', icon: '🗣️', count: 3 },
              ].map((s) => {
                const isSelected = selectedScope === s.scope;
                return (
                  <Button
                    key={s.scope}
                    variant={isSelected ? 'primary' : 'outline'}
                    size="md"
                    icon={s.icon}
                    onClick={() => {
                      setSelectedScope(s.scope);
                      setSelectedPart(s.count > 0 ? 1 : 0);
                    }}
                  >
                    {s.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              size="lg"
              loading={busy}
              icon="🎧"
              onClick={handleLaunchConversationalListening}
              title="Practice official 2-way dialogue with Kokoro FP32 neural speech synthesis"
            >
              Practice 2-Way Conversational Listening →
            </Button>
            <Button
              variant="primary"
              size="lg"
              loading={busy}
              icon="🚀"
              onClick={handleCreateTest}
            >
              Configure &amp; Generate Test →
            </Button>
          </div>
        </section>

        {/* Section 2: Active Tests in Progress */}
        <section aria-labelledby="in-progress-heading" style={{ marginBottom: 36 }}>
          <h2 id="in-progress-heading" style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: 16 }}>
            Tests in Progress ({inProgressTests.length})
          </h2>

          {inProgressTests.length === 0 ? (
            <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 28, textAlign: 'center', color: '#64748b' }}>
              No tests in progress. Create a new test above to practice.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                      padding: '16px 20px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 12,
                      cursor: 'pointer',
                      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#94a3b8')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#e2e8f0')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: 9999,
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: t.status === 'active' ? '#dcfce7' : isComplete ? '#dbeafe' : '#fef3c7',
                          color: t.status === 'active' ? '#15803d' : isComplete ? '#1e40af' : '#b45309',
                        }}
                      >
                        {t.status === 'active' ? 'Testing' : isComplete ? 'Ready' : 'Draft'}
                      </span>
                      <div>
                        <strong style={{ fontSize: '1.02rem', color: '#0f172a', textTransform: 'capitalize' }}>
                          {t.scope === 'full' ? 'Full Mock Test' : `${t.scope || 'Practice'} Section`} · {t.mode === 'timed' ? '⏱ Timed' : '∞ Untimed'}
                        </strong>
                        <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 2 }}>
                          Progress: {t.preparedCount ?? 0} of {t.jobCount ?? 0} sections saved · Last updated {formatLastUpdated(t.updatedAt)}
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
                        onClick={(e) => handleDelete(t.id, e)}
                        title="Delete test permanently"
                      >
                        Delete
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Section 3: Completed History */}
        <section aria-labelledby="history-heading">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            <div>
              <h2 id="history-heading" style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                Completed Test History ({completedTests.length})
              </h2>
              <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: 4 }}>
                Review past estimated band scores, CEFR levels, and category performance breakdown.
              </div>
            </div>
          </div>

          {completedTests.length === 0 ? (
            <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 32, textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: 8 }}>📊</div>
              <strong style={{ fontSize: '1rem', color: '#334155', display: 'block', marginBottom: 4 }}>No completed tests yet</strong>
              <span>Your finished tests, full IELTS category bands, and CEFR level estimates will be tracked here.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Executive Proficiency Summary Card */}
              {completedStats && (
                <div
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 14,
                    padding: '20px 24px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 20,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Best Estimated Band
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
                      <span style={{ fontSize: '2rem', fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>
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
                          CEFR {completedStats.bestCefr.level}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
                      {completedStats.bestCefr?.name || 'Proficiency level'}
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Latest Test Band
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
                      <span style={{ fontSize: '2rem', fontWeight: 900, color: '#2563eb', lineHeight: 1 }}>
                        {completedStats.latestBand ? completedStats.latestBand.toFixed(1) : '—'}
                      </span>
                      {completedStats.latestCefr && (
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: '0.75rem',
                            fontWeight: 800,
                            backgroundColor: completedStats.latestCefr.badgeStyle.bg,
                            color: completedStats.latestCefr.badgeStyle.text,
                            border: `1px solid ${completedStats.latestCefr.badgeStyle.border}`,
                          }}
                        >
                          CEFR {completedStats.latestCefr.level}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 4 }}>
                      {completedStats.count} test{completedStats.count > 1 ? 's' : ''} completed
                    </div>
                  </div>

                  <div style={{ borderLeft: '1px solid #e2e8f0', paddingLeft: 18 }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                      Category Averages
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', fontSize: '0.82rem' }}>
                      <div style={{ color: '#334155' }}>🎧 Listening: <strong>{completedStats.avgListening ? `Band ${completedStats.avgListening}` : '—'}</strong></div>
                      <div style={{ color: '#334155' }}>📖 Reading: <strong>{completedStats.avgReading ? `Band ${completedStats.avgReading}` : '—'}</strong></div>
                      <div style={{ color: '#334155' }}>✍️ Writing: <strong>{completedStats.avgWriting ? `Band ${completedStats.avgWriting}` : '—'}</strong></div>
                      <div style={{ color: '#334155' }}>🗣️ Speaking: <strong>{completedStats.avgSpeaking ? `Band ${completedStats.avgSpeaking}` : '—'}</strong></div>
                    </div>
                  </div>
                </div>
              )}

              {/* Completed Tests List */}
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
                      borderRadius: 14,
                      padding: '20px 22px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 16,
                      cursor: 'pointer',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                    }}
                  >
                    {/* Top Row: Title, Date, Actions */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: 9999,
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            background: '#ecfdf5',
                            color: '#065f46',
                            border: '1px solid #a7f3d0',
                          }}
                        >
                          ✓ Completed
                        </span>
                        <strong style={{ fontSize: '1.05rem', color: '#0f172a', textTransform: 'capitalize' }}>
                          {t.scope === 'full' ? 'Full Academic Mock Test' : `${t.scope || 'Practice'} Section`} · {t.mode === 'timed' ? '⏱ Timed' : '∞ Untimed'}
                        </strong>
                        <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                          · {formatCompletedDate(t.updatedAt)}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="📊"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenAttempt(t.id);
                          }}
                        >
                          Review Score & Analysis →
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon="🗑️"
                          onClick={(e) => handleDelete(t.id, e)}
                          title="Delete test"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>

                    {/* Band Scores Strip: All IELTS Categories + Overall & CEFR */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                        gap: 12,
                        background: '#f8fafc',
                        padding: '14px 16px',
                        borderRadius: 10,
                        border: '1px solid #edf2f7',
                      }}
                    >
                      {/* Overall Band + CEFR Badge */}
                      <div
                        style={{
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: 8,
                          padding: '10px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                        }}
                      >
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.04em' }}>
                          Overall Band
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 3 }}>
                          <span style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>
                            {hasOverall ? t.overallBand!.toFixed(1) : '—'}
                          </span>
                          {cefrInfo && (
                            <span
                              style={{
                                padding: '2px 8px',
                                borderRadius: 6,
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                backgroundColor: cefrInfo.badgeStyle.bg,
                                color: cefrInfo.badgeStyle.text,
                                border: `1px solid ${cefrInfo.badgeStyle.border}`,
                              }}
                              title={cefrInfo.summary}
                            >
                              CEFR {cefrInfo.level}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 4 }}>
                          {cefrInfo ? cefrInfo.name : 'Estimated band'}
                        </div>
                      </div>

                      {/* 🎧 Listening Category Band */}
                      <div
                        style={{
                          background: '#ffffff',
                          border: t.scope === 'listening' ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                          borderRadius: 8,
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                          <span>🎧</span>
                          <span>Listening</span>
                        </div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 800, color: typeof t.bands?.listening === 'number' ? '#1d4ed8' : '#94a3b8', marginTop: 3 }}>
                          {typeof t.bands?.listening === 'number' ? `Band ${t.bands.listening.toFixed(1)}` : '—'}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {typeof t.bands?.listening === 'number' && ieltsBandToCefr(t.bands.listening)
                            ? `CEFR ${ieltsBandToCefr(t.bands.listening)?.level}`
                            : t.scope === 'full' ? 'Not recorded' : 'Optional'}
                        </div>
                      </div>

                      {/* 📖 Reading Category Band */}
                      <div
                        style={{
                          background: '#ffffff',
                          border: t.scope === 'reading' ? '2px solid #10b981' : '1px solid #e2e8f0',
                          borderRadius: 8,
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                          <span>📖</span>
                          <span>Reading</span>
                        </div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 800, color: typeof t.bands?.reading === 'number' ? '#047857' : '#94a3b8', marginTop: 3 }}>
                          {typeof t.bands?.reading === 'number' ? `Band ${t.bands.reading.toFixed(1)}` : '—'}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {typeof t.bands?.reading === 'number' && ieltsBandToCefr(t.bands.reading)
                            ? `CEFR ${ieltsBandToCefr(t.bands.reading)?.level}`
                            : t.scope === 'full' ? 'Not recorded' : 'Optional'}
                        </div>
                      </div>

                      {/* ✍️ Writing Category Band */}
                      <div
                        style={{
                          background: '#ffffff',
                          border: t.scope === 'writing' ? '2px solid #8b5cf6' : '1px solid #e2e8f0',
                          borderRadius: 8,
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                          <span>✍️</span>
                          <span>Writing</span>
                        </div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 800, color: typeof t.bands?.writing === 'number' ? '#6d28d9' : '#94a3b8', marginTop: 3 }}>
                          {typeof t.bands?.writing === 'number' ? `Band ${t.bands.writing.toFixed(1)}` : '—'}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {typeof t.bands?.writing === 'number' && ieltsBandToCefr(t.bands.writing)
                            ? `CEFR ${ieltsBandToCefr(t.bands.writing)?.level}`
                            : t.scope === 'full' ? 'Not recorded' : 'Optional'}
                        </div>
                      </div>

                      {/* 🗣️ Speaking Category Band */}
                      <div
                        style={{
                          background: '#ffffff',
                          border: t.scope === 'speaking' ? '2px solid #f59e0b' : '1px solid #e2e8f0',
                          borderRadius: 8,
                          padding: '10px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', fontWeight: 600, color: '#475569' }}>
                          <span>🗣️</span>
                          <span>Speaking</span>
                        </div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 800, color: typeof t.bands?.speaking === 'number' ? '#b45309' : '#94a3b8', marginTop: 3 }}>
                          {typeof t.bands?.speaking === 'number' ? `Band ${t.bands.speaking.toFixed(1)}` : '—'}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          {typeof t.bands?.speaking === 'number' && ieltsBandToCefr(t.bands.speaking)
                            ? `CEFR ${ieltsBandToCefr(t.bands.speaking)?.level}`
                            : t.scope === 'full' ? 'Not recorded' : 'Optional'}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
