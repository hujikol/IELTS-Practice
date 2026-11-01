// §10 / §11.2 IELTS Practice Review Screen & Comprehensive Diagnostic Report
// Built following the /web-uix protocol: WCAG 2.1 AA semantics, high contrast,
// verified evidence quote highlights, and actionable targeted drills.

import { useState, useEffect, useMemo } from 'react';
import type { FinalReport, WeaknessItem } from '../lib/scoring.ts';
import { countWords, type AttemptRecord, type TestData, type Question } from '../lib/types.ts';
import { generateFinalReport } from '../lib/assessment-coordinator.ts';
import { isWritingAttempted, isSpeakingAttempted, writeRecord } from '../lib/attempts.ts';
import { getSpeakingAudioBlob } from '../lib/speaking-recorder.ts';
import { ieltsBandToCefr } from '../lib/bands.ts';
import { Button } from './ui/button.tsx';
import { VisualRenderer } from './visual-renderer.tsx';

function SpeakingAudioClipPlayer({
  storageKey,
  label,
  durationS,
}: {
  storageKey: string;
  label: string;
  durationS?: number;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let url: string | null = null;

    if (storageKey) {
      setLoading(true);
      getSpeakingAudioBlob(storageKey)
        .then((blob) => {
          if (!active) return;
          if (blob && blob.size > 0) {
            url = URL.createObjectURL(blob);
            setBlobUrl(url);
          } else {
            setError('Audio recording not found in storage.');
          }
        })
        .catch((e) => {
          if (active) setError((e as Error).message || 'Failed to load audio');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [storageKey]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        backgroundColor: '#f8fafc',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        padding: '10px 14px',
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '18px' }} aria-hidden="true">🎙️</span>
        <div>
          <strong style={{ fontSize: '12.5px', color: '#1e293b', display: 'block' }}>{label}</strong>
          {durationS !== undefined && durationS > 0 && (
            <span style={{ fontSize: '11px', color: '#64748b' }}>
              Duration: {Math.floor(durationS / 60)}:{String(Math.floor(durationS % 60)).padStart(2, '0')}
            </span>
          )}
        </div>
      </div>

      <div>
        {loading && <span style={{ fontSize: '12px', color: '#64748b' }}>Loading audio…</span>}
        {error && <span style={{ fontSize: '12px', color: '#ef4444' }}>{error}</span>}
        {blobUrl && (
          <audio
            controls
            src={blobUrl}
            style={{ height: '36px', maxWidth: '300px', outline: 'none' }}
          />
        )}
      </div>
    </div>
  );
}

interface ReviewProps {
  data: TestData;
  attempt?: AttemptRecord;
  onAttemptChange?: (record: AttemptRecord) => void;
  onPractiseDrill?: (drill: WeaknessItem['drill']) => void;
  onBackToDashboard?: () => void;
}

export function Review({
  data,
  attempt,
  onAttemptChange,
  onPractiseDrill,
  onBackToDashboard,
}: ReviewProps) {
  const [currentAttempt, setCurrentAttempt] = useState<AttemptRecord | undefined>(attempt);
  const [report, setReport] = useState<FinalReport | null>(attempt?.data?.finalReport ?? data.finalReport ?? null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [evaluatingAi, setEvaluatingAi] = useState(false);
  const [evaluationProgress, setEvaluationProgress] = useState<string>('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [copiedTask, setCopiedTask] = useState<number | null>(null);

  useEffect(() => {
    if (attempt) {
      setCurrentAttempt(attempt);
      if (attempt.data?.finalReport) {
        setReport(attempt.data.finalReport);
      }
    }
  }, [attempt]);

  // Question review filters
  const [objectiveFilter, setObjectiveFilter] = useState<'all' | 'wrong' | 'unanswered'>('all');

  // Question stem lookup map
  const questionMap = useMemo(() => {
    const map = new Map<string, Question>();
    const test = attempt?.data || data;
    for (const block of [...(test.listening || []), ...(test.reading || [])]) {
      for (const q of block.questions || []) {
        map.set(q.id, q);
      }
    }
    return map;
  }, [attempt, data]);

  // Determine active tab
  const [activeTab, setActiveTab] = useState<string>('overview');

  // 7-Day Plan persisted state
  const planStorageKey = `ielts_plan_completed_${attempt?.id || 'temp'}`;
  const [completedPlanTasks, setCompletedPlanTasks] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(planStorageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const togglePlanTask = (taskKey: string) => {
    setCompletedPlanTasks((prev) => {
      const next = { ...prev, [taskKey]: !prev[taskKey] };
      try {
        localStorage.setItem(planStorageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // If final report is not yet generated in the attempt, compute instant report on mount
  useEffect(() => {
    const rec = currentAttempt || attempt;
    if (!report && rec) {
      setLoadingReport(true);
      generateFinalReport(rec, undefined, true)
        .then((rep) => setReport(rep))
        .catch((e) => console.error('[IELTS Studio] Failed to build report:', e))
        .finally(() => setLoadingReport(false));
    }
  }, [report, currentAttempt, attempt]);

  const handleRunAiEvaluation = async () => {
    const rec = currentAttempt || attempt;
    if (!rec) return;
    setEvaluatingAi(true);
    setAiError(null);
    setEvaluationProgress('Starting AI evaluation...');
    try {
      const updated = await generateFinalReport(rec, undefined, false, (progress) => {
        setEvaluationProgress(progress);
      });
      setReport(updated);

      // Persist updated scores and finalReport to attempt
      const updatedRecord: AttemptRecord = {
        ...rec,
        updated_at: Date.now(),
        revision: (rec.revision || 0) + 1,
        data: {
          ...rec.data,
          finalReport: updated,
          result: rec.data.result
            ? {
                ...rec.data.result,
                listening: {
                  ...rec.data.result.listening,
                  band: updated.modules.listening?.band ?? rec.data.result.listening.band,
                },
                reading: {
                  ...rec.data.result.reading,
                  band: updated.modules.reading?.band ?? rec.data.result.reading.band,
                },
                writing: {
                  ...rec.data.result.writing,
                  band: updated.modules.writing?.band ?? rec.data.result.writing.band,
                },
                speaking: {
                  ...rec.data.result.speaking,
                  band: updated.modules.speaking?.band ?? rec.data.result.speaking.band,
                },
                overall: updated.overall.band ?? rec.data.result.overall,
              }
            : undefined,
        },
      };

      writeRecord(updatedRecord);
      setCurrentAttempt(updatedRecord);
      onAttemptChange?.(updatedRecord);
    } catch (e) {
      setAiError((e as Error).message || 'Failed to complete AI evaluation.');
    } finally {
      setEvaluatingAi(false);
      setEvaluationProgress('');
    }
  };

  const testRecord = currentAttempt?.data || attempt?.data || data;
  const writingAttempted = isWritingAttempted(testRecord);
  const speakingAttempted = isSpeakingAttempted(testRecord);
  const modules = report?.modules;

  const displayWritingBand = writingAttempted && modules?.writing?.band !== null && modules?.writing?.band !== undefined;
  const displaySpeakingBand = speakingAttempted && modules?.speaking?.band !== null && modules?.speaking?.band !== undefined;
  const overallBand = report?.overall?.band ?? (testRecord.scope !== 'full' ? (modules?.writing?.band ?? modules?.speaking?.band ?? modules?.listening?.band ?? modules?.reading?.band) : null);
  const cefrInfo = ieltsBandToCefr(overallBand ?? modules?.listening?.band ?? modules?.reading?.band ?? modules?.writing?.band ?? modules?.speaking?.band);

  const weaknesses = report?.weakness_profile.weaknesses || [];
  const strengths = report?.weakness_profile.strengths || [];
  const plan = report?.weakness_profile.seven_day_plan || [];

  const listeningItems = report?.review.listening || [];
  const readingItems = report?.review.reading || [];
  const writingTasks = report?.review.writing.tasks || [];
  const speakingParts = report?.review.speaking.parts || [];

  // Dynamically available tabs
  const availableTabs = useMemo(() => {
    const tabs = [{ id: 'overview', label: '📊 Overview & Action Plan' }];
    if (listeningItems.length > 0) {
      tabs.push({ id: 'listening', label: `🎧 Listening (${listeningItems.length})` });
    }
    if (readingItems.length > 0) {
      tabs.push({ id: 'reading', label: `📖 Reading (${readingItems.length})` });
    }
    const hasWriting = Boolean(
      writingAttempted ||
      writingTasks.length > 0 ||
      (testRecord.writing && testRecord.writing.length > 0) ||
      testRecord.scope === 'writing' ||
      testRecord.scope === 'full'
    );
    if (hasWriting) {
      tabs.push({ id: 'writing', label: `✍️ Writing (${writingTasks.length || (testRecord.writing?.length || 2)} Tasks)` });
    }
    const hasSpeaking = Boolean(
      speakingAttempted ||
      speakingParts.length > 0 ||
      (testRecord.speaking && testRecord.speaking.length > 0) ||
      testRecord.scope === 'speaking' ||
      testRecord.scope === 'full'
    );
    if (hasSpeaking) {
      tabs.push({ id: 'speaking', label: `🗣️ Speaking (${speakingParts.length || (testRecord.speaking?.length || 3)} Parts)` });
    }
    return tabs;
  }, [
    listeningItems.length,
    readingItems.length,
    writingAttempted,
    writingTasks.length,
    speakingAttempted,
    speakingParts.length,
    testRecord.writing,
    testRecord.speaking,
    testRecord.scope,
  ]);

  return (
    <main style={{ fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", padding: '24px 20px 48px', maxWidth: '1040px', margin: '0 auto', color: '#0f172a' }}>
      {/* Top Header Bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: '24px',
        }}
      >
        {onBackToDashboard && (
          <Button variant="outline" size="sm" icon="←" onClick={onBackToDashboard}>
            Back to Dashboard
          </Button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '9999px',
              fontSize: '11.5px',
              fontWeight: 700,
              backgroundColor: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
            }}
          >
            Code-Verified Scoring · Cambridge Criteria
          </span>
        </div>
      </header>

      {/* Hero Performance Card (Clean, Soft & Approachable) */}
      <section
        aria-label="Score Summary Header"
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '24px 28px',
          marginBottom: '24px',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '20px', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#2563eb', fontWeight: 800, marginBottom: '4px' }}>
              Academic Performance Diagnostic
            </div>
            <h1 style={{ margin: '0 0 6px 0', fontSize: '24px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
              Test Review &amp; Diagnostic Breakdown
            </h1>
            <p style={{ margin: 0, fontSize: '13.5px', color: '#64748b', maxWidth: '620px', lineHeight: 1.5 }}>
              {report?.weakness_profile.summary || 'Detailed answer evaluation, verified Cambridge paraphrase evidence, and concrete 7-day action drills.'}
            </p>
          </div>

          {/* Overall Band Box */}
          <div
            style={{
              backgroundColor: '#eff6ff',
              border: '1.5px solid #bfdbfe',
              borderRadius: '12px',
              padding: '14px 22px',
              textAlign: 'center',
              minWidth: '150px',
            }}
          >
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#1e40af', fontWeight: 700 }}>
              Estimated Band
            </div>
            <div style={{ fontSize: '36px', fontWeight: 900, color: '#1d4ed8', lineHeight: 1.1, margin: '2px 0' }}>
              {overallBand !== null && overallBand !== undefined
                ? overallBand.toFixed(1)
                : modules?.listening?.band != null
                ? modules.listening.band.toFixed(1)
                : modules?.reading?.band != null
                ? modules.reading.band.toFixed(1)
                : '—'}
            </div>
            {cefrInfo && (
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 800,
                  backgroundColor: cefrInfo.badgeStyle.bg,
                  color: cefrInfo.badgeStyle.text,
                  border: `1px solid ${cefrInfo.badgeStyle.border}`,
                }}
              >
                CEFR {cefrInfo.level}
              </span>
            )}
          </div>
        </div>

        {/* 4 Skill Category Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            paddingTop: '18px',
            borderTop: '1px solid #f1f5f9',
          }}
        >
          {/* Listening */}
          <div style={{ backgroundColor: '#f8fafc', borderRadius: '10px', padding: '12px 16px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 600, color: '#475569' }}>
              <span>🎧</span>
              <span>Listening</span>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: modules?.listening?.band != null ? '#1d4ed8' : '#94a3b8', marginTop: '2px' }}>
              {modules?.listening?.band != null ? `Band ${modules.listening.band.toFixed(1)}` : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {modules?.listening && modules.listening.band != null ? `${modules.listening.raw} of ${modules.listening.of} correct` : 'Not taken'}
            </div>
          </div>

          {/* Reading */}
          <div style={{ backgroundColor: '#f8fafc', borderRadius: '10px', padding: '12px 16px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 600, color: '#475569' }}>
              <span>📖</span>
              <span>Reading</span>
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: modules?.reading?.band != null ? '#047857' : '#94a3b8', marginTop: '2px' }}>
              {modules?.reading?.band != null ? `Band ${modules.reading.band.toFixed(1)}` : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {modules?.reading && modules.reading.band != null ? `${modules.reading.raw} of ${modules.reading.of} correct` : 'Not taken'}
            </div>
          </div>

          {/* Writing */}
          <div style={{ backgroundColor: '#f8fafc', borderRadius: '10px', padding: '12px 16px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                <span>✍️</span>
                <span>Writing</span>
              </div>
              {displayWritingBand && (
                <span style={{ fontSize: '10px', color: '#6d28d9', fontWeight: 700 }}>
                  {modules?.writing?.confidence === 'low' ? 'Heuristic' : 'AI Scored'}
                </span>
              )}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: displayWritingBand && modules?.writing?.band != null ? '#6d28d9' : '#94a3b8', marginTop: '2px' }}>
              {displayWritingBand && modules?.writing?.band != null ? `Band ${modules.writing.band.toFixed(1)}` : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {displayWritingBand && modules?.writing?.task1 != null && modules?.writing?.task2 != null
                ? `T1: ${modules.writing.task1.toFixed(1)} | T2: ${modules.writing.task2.toFixed(1)}`
                : 'Not attempted'}
            </div>
          </div>

          {/* Speaking */}
          <div style={{ backgroundColor: '#f8fafc', borderRadius: '10px', padding: '12px 16px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                <span>🗣️</span>
                <span>Speaking</span>
              </div>
              {displaySpeakingBand && (
                <span style={{ fontSize: '10px', color: '#b45309', fontWeight: 700 }}>
                  {modules?.speaking?.confidence === 'low' ? 'Heuristic' : 'AI Scored'}
                </span>
              )}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: displaySpeakingBand && modules?.speaking?.band != null ? '#b45309' : '#94a3b8', marginTop: '2px' }}>
              {displaySpeakingBand && modules?.speaking?.band != null ? `Band ${modules.speaking.band.toFixed(1)}` : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {displaySpeakingBand ? 'Fluency & Lexical Analysis' : 'Not attempted'}
            </div>
          </div>
        </div>
      </section>

      {/* Legacy Rubric Warning Banner */}
      {report?.rubric_version === 'legacy' && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            backgroundColor: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: 12,
            padding: '14px 18px',
            marginBottom: 20,
            color: '#92400e',
          }}
        >
          <div>
            <strong style={{ fontSize: '0.92rem' }}>⚠️ Legacy Scoring Method</strong>
            <p style={{ margin: '3px 0 0', fontSize: '0.84rem' }}>
              This attempt was evaluated with the legacy scoring engine. Re-score with AI to apply the calibrated rubric with verified quotes and honest speech metrics.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleRunAiEvaluation()}
            disabled={evaluatingAi}
            style={{
              padding: '6px 14px',
              borderRadius: '8px',
              backgroundColor: '#b45309',
              color: '#ffffff',
              border: 'none',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: evaluatingAi ? 'not-allowed' : 'pointer',
            }}
          >
            {evaluatingAi ? 'Re-scoring…' : 'Re-score with AI'}
          </button>
        </div>
      )}

      {/* Optional AI Diagnostic Action Card */}
      {((writingAttempted && modules?.writing?.confidence === 'low') ||
        (speakingAttempted && modules?.speaking?.confidence === 'low')) ? (
        <div
          role="region"
          aria-label="AI Writing and Speaking Assessment"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 12,
            padding: '16px 20px',
            marginBottom: 24,
          }}
        >
          <div>
            <strong style={{ fontSize: '0.94rem', color: '#1e40af', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>✨</span>
              <span>Detailed AI Writing &amp; Speaking Assessment</span>
            </strong>
            <p style={{ margin: '3px 0 0', fontSize: '0.84rem', color: '#2563eb' }}>
              Instant objective scoring is complete. Run deep LLM evaluation on both your written essays and spoken recordings in parallel.
            </p>
            {evaluatingAi && evaluationProgress && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  marginTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: '0.82rem',
                  color: '#1d4ed8',
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 14,
                    height: 14,
                    border: '2px solid #93c5fd',
                    borderTopColor: '#1d4ed8',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <span>{evaluationProgress}</span>
              </div>
            )}
          </div>
          <Button
            variant="primary"
            size="sm"
            loading={evaluatingAi}
            disabled={evaluatingAi}
            icon="⚡"
            onClick={handleRunAiEvaluation}
          >
            {evaluatingAi ? 'Evaluating with AI…' : 'Run Deep AI Evaluation →'}
          </Button>
        </div>
      ) : (writingAttempted || speakingAttempted) && (modules?.writing?.confidence === 'medium' || modules?.speaking?.confidence === 'medium') ? (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 12,
            padding: '14px 20px',
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '20px', color: '#16a34a' }}>✓</span>
            <div>
              <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#166534' }}>
                AI Writing &amp; Speaking Assessment Complete
              </div>
              <div style={{ fontSize: '0.82rem', color: '#15803d' }}>
                All criteria and band scores have been evaluated with LLM and persisted to your test record.
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            loading={evaluatingAi}
            disabled={evaluatingAi}
            onClick={handleRunAiEvaluation}
          >
            {evaluatingAi ? 'Re-evaluating…' : 'Re-evaluate with AI'}
          </Button>
        </div>
      ) : null}

      {aiError && (
        <div role="alert" style={{ background: '#fff1f2', border: '1px solid #fecdd3', color: '#be123c', padding: '10px 14px', borderRadius: 8, marginBottom: 20, fontSize: '0.88rem' }}>
          ⚠️ {aiError}
        </div>
      )}

      {/* Navigation Tabs */}
      <nav
        aria-label="Review Navigation"
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: '24px',
          overflowX: 'auto',
          paddingBottom: '2px',
        }}
      >
        {availableTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 18px',
              border: 'none',
              background: 'none',
              fontSize: '13.5px',
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? '#2563eb' : '#64748b',
              borderBottom: activeTab === tab.id ? '2.5px solid #2563eb' : '2.5px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {loadingReport && (
        <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
          <div style={{ margin: '0 auto 12px auto', width: '28px', height: '28px', border: '3px solid #cbd5e1', borderRightColor: '#2563eb', borderRadius: '50%', animation: 'btn-spin 0.6s linear infinite' }} />
          Building diagnostic review and verified evidence quotes...
        </div>
      )}

      {/* ─── TAB 1: OVERVIEW & ACTION PLAN ─── */}
      {activeTab === 'overview' && report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {/* Top Prioritized Weaknesses & Targeted Drills */}
          <section aria-labelledby="weaknesses-heading">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
              <h2 id="weaknesses-heading" style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                🎯 Top Priority Weaknesses &amp; Targeted Drills
              </h2>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Ranked by impact on your band score</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {weaknesses.map((w) => (
                <article
                  key={w.rank}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '18px 20px',
                    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flex: 1, minWidth: '260px' }}>
                      <div
                        style={{
                          width: '30px',
                          height: '30px',
                          borderRadius: '8px',
                          backgroundColor: '#fff1f2',
                          color: '#be123c',
                          border: '1px solid #fecdd3',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '13px',
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        #{w.rank}
                      </div>
                      <div>
                        <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                          {w.title}
                        </h3>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#be123c', marginBottom: '6px' }}>
                          Gap: {w.evidence.stat}
                        </div>
                        <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#475569', lineHeight: 1.45 }}>
                          <strong>Likely Cause:</strong> {w.likely_cause}
                        </p>
                        <div style={{ fontSize: '12px', color: '#334155' }}>
                          <strong>Actionable Fixes:</strong>
                          <ul style={{ margin: '4px 0 0 0', paddingLeft: '18px' }}>
                            {w.fixes.map((fix, fIdx) => (
                              <li key={fIdx} style={{ marginBottom: '2px' }}>{fix}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* Drill Action Button */}
                    {onPractiseDrill && w.drill && (
                      <Button
                        variant="primary"
                        size="sm"
                        icon="⚡"
                        onClick={() => onPractiseDrill(w.drill)}
                        title={`Generate targeted drill for ${w.drill.focus}`}
                      >
                        Practise Drill ({w.drill.count} Qs)
                      </Button>
                    )}
                  </div>
                </article>
              ))}

              {weaknesses.length === 0 && (
                <div style={{ padding: '24px', backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', textAlign: 'center', color: '#64748b' }}>
                  No significant accuracy gaps identified. Excellent performance!
                </div>
              )}
            </div>
          </section>

          {/* Strengths */}
          {strengths.length > 0 && (
            <section aria-labelledby="strengths-heading">
              <h2 id="strengths-heading" style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', marginBottom: '12px' }}>
                🌟 Verified Strengths (High Accuracy Areas)
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                {strengths.map((str, idx) => (
                  <div
                    key={idx}
                    style={{
                      backgroundColor: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: '10px',
                      padding: '14px 18px',
                    }}
                  >
                    <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#065f46', marginBottom: '3px' }}>
                      ✓ {str.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#047857' }}>
                      {str.evidence}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 7-Day Improvement Plan */}
          {plan.length > 0 && (
            <section aria-labelledby="plan-heading">
              <div style={{ marginBottom: '14px' }}>
                <h2 id="plan-heading" style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', margin: '0 0 4px 0' }}>
                  📅 Personalized 7-Day Action Plan
                </h2>
                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                  Targeted daily 30-60 minute sessions addressing your identified accuracy bottlenecks.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {plan.map((day) => (
                  <div
                    key={day.day}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '16px 20px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>
                        Day {day.day}
                      </span>
                      <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#64748b' }}>
                        ⏱ {day.minutes} mins
                      </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {day.tasks.map((task, tIdx) => {
                        const taskKey = `d${day.day}_t${tIdx}`;
                        const isDone = completedPlanTasks[taskKey] || false;

                        return (
                          <div
                            key={tIdx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 14px',
                              borderRadius: '8px',
                              backgroundColor: isDone ? '#f0fdf4' : '#f8fafc',
                              border: isDone ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
                            }}
                          >
                            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: isDone ? '#166534' : '#334155', textDecoration: isDone ? 'line-through' : 'none' }}>
                              <input
                                type="checkbox"
                                checked={isDone}
                                onChange={() => togglePlanTask(taskKey)}
                                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                              />
                              <span>
                                <strong style={{ textTransform: 'capitalize', color: isDone ? '#15803d' : '#2563eb' }}>
                                  [{task.type}]
                                </strong>{' '}
                                {task.text}
                              </span>
                            </label>

                            {task.drill && onPractiseDrill && (
                              <Button
                                variant="outline"
                                size="sm"
                                icon="⚡"
                                onClick={() => onPractiseDrill(task.drill!)}
                              >
                                Launch Drill
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ─── TAB 2 & 3: OBJECTIVE QUESTIONS (LISTENING & READING) ─── */}
      {(activeTab === 'listening' || activeTab === 'reading') && report && (
        <div>
          {/* Filter Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['all', 'wrong', 'unanswered'] as const).map((filter) => {
                const filterIcon = filter === 'all' ? '📋' : filter === 'wrong' ? '❌' : '⏳';
                const filterLabel = filter === 'all' ? 'All Questions' : filter === 'wrong' ? 'Wrong Only' : 'Unanswered';
                return (
                  <Button
                    key={filter}
                    variant={objectiveFilter === filter ? 'primary' : 'outline'}
                    size="sm"
                    icon={filterIcon}
                    onClick={() => setObjectiveFilter(filter)}
                  >
                    {filterLabel}
                  </Button>
                );
              })}
            </div>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Cambridge explanations &amp; verified evidence quotes
            </span>
          </div>

          {/* Question List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {((activeTab === 'listening' ? report.review.listening : report.review.reading) || [])
              .filter((it) => {
                if (objectiveFilter === 'wrong') return !it.correct;
                if (objectiveFilter === 'unanswered') return it.user_answer === null;
                return true;
              })
              .map((it) => {
                const questionObj = questionMap.get(it.item_id);

                return (
                  <article
                    key={it.item_id}
                    style={{
                      backgroundColor: '#ffffff',
                      border: it.correct ? '1px solid #e2e8f0' : '1px solid #fecdd3',
                      borderRadius: '12px',
                      padding: '18px 20px',
                      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                    }}
                  >
                    {/* Item Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            width: '26px',
                            height: '26px',
                            borderRadius: '50%',
                            backgroundColor: it.correct ? '#ecfdf5' : '#fff1f2',
                            color: it.correct ? '#047857' : '#be123c',
                            border: `1px solid ${it.correct ? '#a7f3d0' : '#fecdd3'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '12px',
                            fontWeight: 800,
                          }}
                        >
                          {it.q}
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#475569' }}>
                          {it.type || 'Question'}
                        </span>
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#475569' }}>
                          Target Band {it.target_band.toFixed(1)}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {it.error_flag && (
                          <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' }}>
                            {it.error_flag === 'spelling' ? 'Spelling Near-Miss' : 'Over Word Limit'}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: '12px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: it.correct ? '#ecfdf5' : '#fff1f2',
                            color: it.correct ? '#047857' : '#be123c',
                            border: `1px solid ${it.correct ? '#a7f3d0' : '#fecdd3'}`,
                          }}
                        >
                          {it.correct ? '✓ Correct' : '✗ Incorrect'}
                        </span>
                      </div>
                    </div>

                    {/* Question Stem (if available) */}
                    {questionObj?.stem && (
                      <p style={{ margin: '0 0 12px 0', fontSize: '13.5px', color: '#1e293b', fontWeight: 500, lineHeight: 1.45 }}>
                        {questionObj.stem}
                      </p>
                    )}

                    {/* Answer Comparison Strip */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                      <div
                        style={{
                          backgroundColor: it.correct ? '#f8fafc' : '#fff1f2',
                          border: `1px solid ${it.correct ? '#e2e8f0' : '#fecdd3'}`,
                          padding: '10px 14px',
                          borderRadius: '8px',
                        }}
                      >
                        <span style={{ fontSize: '11px', color: it.correct ? '#64748b' : '#be123c', display: 'block', fontWeight: 700 }}>
                          YOUR ANSWER
                        </span>
                        <span style={{ fontSize: '13.5px', fontWeight: 700, color: it.correct ? '#047857' : '#be123c' }}>
                          {it.user_answer ?? 'Unanswered'}
                        </span>
                      </div>

                      <div
                        style={{
                          backgroundColor: '#ecfdf5',
                          border: '1px solid #a7f3d0',
                          padding: '10px 14px',
                          borderRadius: '8px',
                        }}
                      >
                        <span style={{ fontSize: '11px', color: '#047857', display: 'block', fontWeight: 700 }}>
                          CORRECT ANSWER
                        </span>
                        <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#065f46' }}>
                          {it.correct_answer}
                        </span>
                        {it.accepted_alternatives && it.accepted_alternatives.length > 0 && (
                          <div style={{ fontSize: '11px', color: '#059669', marginTop: 2 }}>
                            Also accepts: {it.accepted_alternatives.join(', ')}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Unified Explanations & Evidence Container */}
                    <div
                      style={{
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '12px 14px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        fontSize: '12.5px',
                        lineHeight: 1.5,
                      }}
                    >
                      {/* Source Evidence */}
                      {it.evidence_quote && (
                        <div style={{ color: '#1e40af', backgroundColor: '#eff6ff', padding: '8px 10px', borderRadius: '6px', borderLeft: '3px solid #2563eb' }}>
                          <strong>Source Evidence:</strong> &ldquo;{it.evidence_quote}&rdquo;
                          {it.jump_to?.paragraph && <span style={{ marginLeft: '6px', color: '#2563eb' }}>(Paragraph {it.jump_to.paragraph})</span>}
                        </div>
                      )}

                      {/* Explanation */}
                      <div style={{ color: '#334155' }}>
                        <strong style={{ color: '#0f172a' }}>Explanation:</strong> {it.explanation}
                      </div>

                      {/* AI Diagnostic for wrong items */}
                      {it.personal_note && (
                        <div style={{ color: '#92400e', backgroundColor: '#fffbeb', border: '1px solid #fde68a', padding: '6px 10px', borderRadius: '6px' }}>
                          <strong>Diagnostic Note:</strong> {it.personal_note}
                        </div>
                      )}

                      {/* Strategy Tip */}
                      {it.strategy_tip && (
                        <div style={{ color: '#475569', fontSize: '12px' }}>
                          💡 <strong>Strategy Tip:</strong> {it.strategy_tip}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
          </div>
        </div>
      )}

      {/* ─── TAB 4: WRITING REVIEW ─── */}
      {activeTab === 'writing' && report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {writingTasks.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', backgroundColor: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', color: '#64748b' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>✍️</div>
              <h3 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '18px', fontWeight: 800 }}>Writing Section Not Attempted</h3>
              <p style={{ margin: 0, fontSize: '0.92rem', color: '#64748b' }}>
                You did not submit responses for the Writing tasks in this test session.
              </p>
            </div>
          ) : (
            writingTasks.map((task) => {
              const taskIndex = task.task - 1;
              const taskMeta = testRecord.writing?.[taskIndex];
              const submittedText = (testRecord.texts?.[taskIndex] ?? '').trim();
              const words = countWords(submittedText);
              const minWords = taskMeta?.minimum ?? (task.task === 1 ? 150 : 250);
              const meetsMin = words >= minWords;

              return (
                <article
                  key={task.task}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '16px',
                    padding: '24px 28px',
                    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                  }}
                >
                  {/* Task Header & Overall Band */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 12,
                      paddingBottom: '16px',
                      borderBottom: '1px solid #f1f5f9',
                      marginBottom: '20px',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: '#6d28d9', letterSpacing: '0.05em', marginBottom: 2 }}>
                        IELTS Academic Writing · Task {task.task}
                      </div>
                      <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                        {taskMeta?.title || `Writing Task ${task.task}`}
                      </h3>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          fontSize: '0.88rem',
                          fontWeight: 800,
                          padding: '4px 12px',
                          borderRadius: '8px',
                          backgroundColor: task.band !== null ? '#f5f3ff' : '#fffbeb',
                          color: task.band !== null ? '#6d28d9' : '#b45309',
                          border: `1px solid ${task.band !== null ? '#ddd6fe' : '#fde68a'}`,
                        }}
                      >
                        {task.band !== null ? `Band ${task.band.toFixed(1)}` : 'Unscored'}
                      </span>
                      {task.band === null && (
                        <button
                          type="button"
                          onClick={() => void handleRunAiEvaluation()}
                          disabled={evaluatingAi}
                          style={{
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            padding: '4px 10px',
                            borderRadius: '6px',
                            backgroundColor: '#6d28d9',
                            color: '#ffffff',
                            border: 'none',
                            cursor: evaluatingAi ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {evaluatingAi ? 'Scoring…' : '🔄 Retry Scoring'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Unscored Explanation */}
                  {task.band === null && task.unscored_reason && (
                    <div
                      style={{
                        padding: '12px 16px',
                        borderRadius: 10,
                        backgroundColor: '#fffbeb',
                        border: '1px solid #fde68a',
                        color: '#92400e',
                        marginBottom: 18,
                        fontSize: '0.88rem',
                        lineHeight: 1.5,
                      }}
                    >
                      <strong>⚠️ Task Unscored:</strong>{' '}
                      {task.unscored_reason === 'ai_disabled'
                        ? 'AI provider is not configured or disabled in Settings. Enable AI to score writing tasks.'
                        : task.unscored_reason === 'too_short'
                          ? 'This submission was under the minimum scorable word count (25 words).'
                          : task.unscored_reason === 'not_attempted'
                            ? 'No text was submitted for this task.'
                            : 'AI scoring encountered an error or timeout. You can retry evaluation using the button above.'}
                    </div>
                  )}

                  {/* Task Prompt Reference Callout */}
                  {taskMeta?.prompt && (
                    <details
                      style={{
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        borderRadius: '10px',
                        padding: '12px 16px',
                        marginBottom: '20px',
                      }}
                      open
                    >
                      <summary
                        style={{
                          fontSize: '0.84rem',
                          fontWeight: 700,
                          color: '#334155',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          userSelect: 'none',
                        }}
                      >
                        <span>📋 Task {task.task} Prompt &amp; Instructions</span>
                      </summary>
                      <div style={{ marginTop: '10px', fontSize: '0.92rem', color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                        {taskMeta.prompt}
                      </div>
                      {taskMeta.visual && (
                        <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                          <VisualRenderer visual={taskMeta.visual} />
                        </div>
                      )}
                    </details>
                  )}

                  {/* ─── YOUR SUBMITTED ESSAY / RESPONSE ─── */}
                  <div
                    style={{
                      border: '1px solid #cbd5e1',
                      borderRadius: '12px',
                      backgroundColor: '#ffffff',
                      marginBottom: '22px',
                      overflow: 'hidden',
                      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 10,
                        backgroundColor: '#f8fafc',
                        padding: '10px 16px',
                        borderBottom: '1px solid #e2e8f0',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '1rem' }}>✍️</span>
                        <strong style={{ fontSize: '0.88rem', color: '#0f172a' }}>
                          Your Submitted Response
                        </strong>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                          style={{
                            fontSize: '0.78rem',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: meetsMin ? '#f0fdf4' : '#fff1f2',
                            color: meetsMin ? '#15803d' : '#be123c',
                            border: `1px solid ${meetsMin ? '#bbf7d0' : '#fecdd3'}`,
                          }}
                        >
                          {words} words ({meetsMin ? `✓ Meets min ${minWords}` : `Under min ${minWords}`})
                        </span>

                        {submittedText && (
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(submittedText);
                              setCopiedTask(task.task);
                              setTimeout(() => setCopiedTask(null), 2000);
                            }}
                            style={{
                              background: '#ffffff',
                              border: '1px solid #cbd5e1',
                              borderRadius: '6px',
                              padding: '3px 9px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: copiedTask === task.task ? '#15803d' : '#475569',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <span>{copiedTask === task.task ? '✓' : '📋'}</span>
                            <span>{copiedTask === task.task ? 'Copied' : 'Copy Text'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '18px 20px',
                        fontSize: '0.94rem',
                        lineHeight: 1.75,
                        color: submittedText ? '#1e293b' : '#94a3b8',
                        whiteSpace: 'pre-wrap',
                        fontStyle: submittedText ? 'normal' : 'italic',
                        maxHeight: '400px',
                        overflowY: 'auto',
                      }}
                    >
                      {submittedText || 'No written response was submitted for this task during the test.'}
                    </div>
                  </div>

                  {/* 4 Public Criteria Breakdown */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '18px' }}>
                    {Object.entries(task.criteria).map(([criterion, data]) => (
                      <div key={criterion} style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '11px', textTransform: 'capitalize', color: '#64748b', fontWeight: 700 }}>
                          {criterion.replace('_', ' ')}
                        </div>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', margin: '2px 0' }}>
                          Band {data.band.toFixed(1)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#475569', lineHeight: 1.35 }}>
                          {data.next_band_gap || 'Maintain precise academic register.'}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Error Annotations */}
                  {task.errors.length > 0 && (
                    <div style={{ marginBottom: '18px' }}>
                      <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                        Identified Errors &amp; Corrections
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {task.errors.map((err, errIdx) => (
                          <div key={errIdx} style={{ backgroundColor: '#fff1f2', border: '1px solid #fecdd3', borderRadius: '6px', padding: '8px 12px', fontSize: '12px' }}>
                            <span style={{ color: '#be123c', fontWeight: 700 }}>&ldquo;{err.span}&rdquo;</span>
                            <span style={{ margin: '0 8px', color: '#94a3b8' }}>→</span>
                            <span style={{ color: '#047857', fontWeight: 700 }}>{err.correction}</span>
                            <span style={{ marginLeft: '10px', color: '#64748b' }}>({err.category})</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Model Answer (Band 9) */}
                  {task.model_answer && (
                    <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '10px', padding: '16px 18px' }}>
                      <h4 style={{ margin: '0 0 6px 0', fontSize: '13px', fontWeight: 700, color: '#065f46' }}>
                        Band 9 Benchmark Comparison
                      </h4>
                      <p style={{ margin: '0 0 10px 0', fontSize: '12.5px', color: '#047857', lineHeight: 1.5 }}>
                        {task.model_answer}
                      </p>
                      <div style={{ fontSize: '11.5px', color: '#065f46' }}>
                        <strong>Key Technique:</strong> Paraphrased the prompt accurately, highlighted primary trends without extraneous detail, and used fluent cohesive markers.
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      )}

      {/* ─── TAB 5: SPEAKING REVIEW ─── */}
      {activeTab === 'speaking' && report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {(() => {
            const rawSpeaking = testRecord.speaking || [];
            const displaySpeakingParts: FinalReport['review']['speaking']['parts'] =
              speakingParts.length > 0
                ? speakingParts
                : (rawSpeaking.length > 0
                    ? rawSpeaking.map((_, idx) => {
                        const partNum = (idx + 1) as 1 | 2 | 3;
                        const txt = testRecord.speakingTexts?.[idx] || '';
                        const hasRecs = Object.keys(testRecord.recordings || {}).some((k) => k.startsWith(`p${partNum}_`));
                        return {
                          part: partNum,
                          transcript: txt,
                          status: 'unscored' as const,
                          unscored_reason: txt.trim().length > 0 ? 'ai_disabled' : hasRecs ? 'no_transcript' : 'not_attempted',
                          highlights: [],
                          vocab_upgrades: [],
                          strengths: [],
                          priority_fixes: [],
                          metrics: undefined,
                          improved_answer: undefined,
                          cue_card_outline: undefined,
                        };
                      })
                    : [
                        { part: 1 as const, transcript: testRecord.speakingTexts?.[0] || '', status: 'unscored' as const, unscored_reason: 'not_attempted', highlights: [], vocab_upgrades: [], strengths: [], priority_fixes: [], metrics: undefined, improved_answer: undefined, cue_card_outline: undefined },
                        { part: 2 as const, transcript: testRecord.speakingTexts?.[1] || '', status: 'unscored' as const, unscored_reason: 'not_attempted', highlights: [], vocab_upgrades: [], strengths: [], priority_fixes: [], metrics: undefined, improved_answer: undefined, cue_card_outline: undefined },
                        { part: 3 as const, transcript: testRecord.speakingTexts?.[2] || '', status: 'unscored' as const, unscored_reason: 'not_attempted', highlights: [], vocab_upgrades: [], strengths: [], priority_fixes: [], metrics: undefined, improved_answer: undefined, cue_card_outline: undefined },
                      ]);

            return displaySpeakingParts.map((part) => {
              const partIdx = part.part - 1;
              const partMeta = rawSpeaking[partIdx];
              const partRecordings = Object.entries(testRecord.recordings || {})
                .filter(([k]) => k.startsWith(`p${part.part}_`))
                .sort(([a], [b]) => {
                  if (a === 'p2_speech') return -1;
                  if (b === 'p2_speech') return 1;
                  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                });

              const partTitle =
                part.part === 1
                  ? 'Speaking Part 1: Interview & Introduction'
                  : part.part === 2
                    ? 'Speaking Part 2: Individual Long Turn (Cue Card)'
                    : 'Speaking Part 3: Two-Way Analytical Discussion';

              return (
                <article
                  key={part.part}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '14px',
                    padding: '24px 26px',
                    boxShadow: '0 1px 3px rgba(15, 23, 42, 0.04)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: '#b45309', letterSpacing: '0.05em', marginBottom: 2 }}>
                        IELTS Academic Speaking · Part {part.part}
                      </div>
                      <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                        {partTitle}
                      </h3>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          fontSize: '0.88rem',
                          fontWeight: 800,
                          padding: '4px 12px',
                          borderRadius: '8px',
                          backgroundColor: modules?.speaking?.band != null ? '#fef3c7' : '#fffbeb',
                          color: modules?.speaking?.band != null ? '#b45309' : '#92400e',
                          border: `1px solid ${modules?.speaking?.band != null ? '#fde68a' : '#fde68a'}`,
                        }}
                      >
                        {modules?.speaking?.band != null ? `Overall Band ${modules.speaking.band.toFixed(1)}` : 'Unscored'}
                      </span>
                    </div>
                  </div>

                  {/* Unscored Speaking Banner */}
                  {part.status === 'unscored' && (
                    <div
                      style={{
                        padding: '12px 16px',
                        borderRadius: 10,
                        backgroundColor: '#fffbeb',
                        border: '1px solid #fde68a',
                        color: '#92400e',
                        marginBottom: 16,
                        fontSize: '0.88rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 10,
                      }}
                    >
                      <div>
                        <strong>⚠️ Speaking Part Unscored:</strong>{' '}
                        {part.unscored_reason === 'no_transcript'
                          ? 'Audio recording is stored in local storage, but no speech transcript was generated.'
                          : part.unscored_reason === 'not_attempted'
                            ? 'This speaking part was not attempted or had fewer than 5 words.'
                            : 'Speech recognition or AI scoring was not completed.'}
                      </div>
                      {part.unscored_reason === 'no_transcript' && (
                        <button
                          type="button"
                          onClick={() => void handleRunAiEvaluation()}
                          disabled={evaluatingAi}
                          style={{
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            padding: '4px 10px',
                            borderRadius: '6px',
                            backgroundColor: '#b45309',
                            color: '#ffffff',
                            border: 'none',
                            cursor: evaluatingAi ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {evaluatingAi ? 'Transcribing…' : '🎙️ Transcribe & Score'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Part Prompt & Questions Reference */}
                  <div
                    style={{
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '10px',
                      padding: '14px 18px',
                      marginBottom: '18px',
                    }}
                  >
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, color: '#64748b', marginBottom: 6 }}>
                      {part.part === 2 ? 'Official IELTS Candidate Cue Card' : 'Examiner Interview Prompts'}
                    </div>

                    {part.part === 2 ? (
                      <div>
                        <strong style={{ fontSize: '14px', color: '#0f172a', display: 'block', marginBottom: 6 }}>
                          {partMeta?.prompt || 'Describe a memorable journey or experience.'}
                        </strong>
                        {partMeta?.cue && partMeta.cue.length > 0 && (
                          <div style={{ fontSize: '12.5px', color: '#334155', paddingLeft: 14 }}>
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>You should say:</div>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {partMeta.cue.map((c, cIdx) => (
                                <li key={cIdx} style={{ marginBottom: 2 }}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        {partMeta?.questions && partMeta.questions.length > 0 ? (
                          <ol style={{ margin: 0, paddingLeft: 18, fontSize: '12.5px', color: '#334155' }}>
                            {partMeta.questions.map((q, qIdx) => (
                              <li key={qIdx} style={{ marginBottom: 4 }}>{q}</li>
                            ))}
                          </ol>
                        ) : (
                          <p style={{ margin: 0, fontSize: '12.5px', color: '#64748b' }}>
                            {partMeta?.prompt || `Interview questions for Speaking Part ${part.part}.`}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Candidate Voice Recordings (Playable Audio Players) */}
                  <div style={{ marginBottom: '18px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>🎙️</span>
                      <span>Your Recorded Voice Clips ({partRecordings.length})</span>
                    </div>

                    {partRecordings.length === 0 ? (
                      <div
                        style={{
                          fontSize: '12.5px',
                          color: '#64748b',
                          fontStyle: 'italic',
                          padding: '12px 16px',
                          backgroundColor: '#f8fafc',
                          borderRadius: 8,
                          border: '1px dashed #cbd5e1',
                        }}
                      >
                        No voice recording was stored for this part.
                      </div>
                    ) : (
                      partRecordings.map(([key, rec]) => {
                        const clipLabel =
                          key === 'p2_speech'
                            ? 'Candidate Long Turn (2-Minute Speech)'
                            : key.startsWith('p2_roundoff_')
                              ? `Part 2 Follow-up Question ${Number(key.replace('p2_roundoff_', '')) + 1}`
                              : key.startsWith('p1_q')
                                ? `Part 1 Question ${Number(key.replace('p1_q', '')) + 1} Answer`
                                : key.startsWith('p3_q')
                                  ? `Part 3 Discussion Question ${Number(key.replace('p3_q', '')) + 1} Answer`
                                  : `Answer Recording (${key})`;

                        return (
                          <SpeakingAudioClipPlayer
                            key={key}
                            storageKey={rec.key}
                            label={clipLabel}
                            durationS={rec.duration}
                          />
                        );
                      })
                    )}
                  </div>

                  {/* Candidate Transcript Box */}
                  <div
                    style={{
                      backgroundColor: '#f8fafc',
                      padding: '14px 18px',
                      borderRadius: '10px',
                      border: '1px solid #e2e8f0',
                      marginBottom: '18px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, color: '#475569' }}>
                        Candidate Speech Transcript
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748b' }}>
                        {part.transcript ? `${countWords(part.transcript)} words` : '0 words'}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.6, color: part.transcript ? '#1e293b' : '#94a3b8', fontStyle: part.transcript ? 'normal' : 'italic' }}>
                      {part.transcript || 'No speech transcript recorded for this part.'}
                    </p>
                  </div>

                  {/* 4 Public Criteria Breakdown (Overall Speaking) */}
                  {modules?.speaking?.criteria && part.part === 1 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '18px' }}>
                      <div style={{ backgroundColor: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Fluency &amp; Coherence</div>
                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '2px 0' }}>Band {modules.speaking.criteria.FC.toFixed(1)}</div>
                      </div>
                      <div style={{ backgroundColor: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Lexical Resource</div>
                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '2px 0' }}>Band {modules.speaking.criteria.LR.toFixed(1)}</div>
                      </div>
                      <div style={{ backgroundColor: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Grammar Range</div>
                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '2px 0' }}>Band {modules.speaking.criteria.GRA.toFixed(1)}</div>
                      </div>
                      <div style={{ backgroundColor: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Pronunciation</div>
                        <div style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a', margin: '2px 0' }}>Band {modules.speaking.criteria.PR.toFixed(1)}</div>
                      </div>
                    </div>
                  )}

                  {/* Speech Pacing & Pause Metrics */}
                  {part.metrics ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: '18px', fontSize: '12px', color: '#475569' }}>
                      <div style={{ backgroundColor: '#f1f5f9', padding: '6px 10px', borderRadius: '6px' }}>
                        <strong>Pacing:</strong> {part.metrics.words_per_minute} WPM
                      </div>
                      <div style={{ backgroundColor: '#f1f5f9', padding: '6px 10px', borderRadius: '6px' }}>
                        <strong>Fillers:</strong> {Math.round(part.metrics.filler_rate * 100)}%
                      </div>
                      <div style={{ backgroundColor: '#f1f5f9', padding: '6px 10px', borderRadius: '6px' }}>
                        <strong>Pauses &gt; 1s:</strong> {part.metrics.pause_count_over_1s}
                      </div>
                      <div style={{ backgroundColor: '#f1f5f9', padding: '6px 10px', borderRadius: '6px' }}>
                        <strong>Self-Repairs:</strong> {part.metrics.self_repair_count}
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginBottom: '18px', fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
                      Speech timing and pacing metrics not measured (requires word-timestamped audio transcription).
                    </div>
                  )}

                  {/* Suggestions Section (Like in Writing): Strengths & Priority Fixes */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px', marginBottom: '18px' }}>
                    {/* Strengths */}
                    <div
                      style={{
                        backgroundColor: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        borderRadius: '10px',
                        padding: '14px 16px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: '15px' }}>✓</span>
                        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#166534' }}>
                          Candidate Spoken Strengths
                        </h4>
                      </div>
                      {part.strengths && part.strengths.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '12px', color: '#14532d', lineHeight: 1.5 }}>
                          {part.strengths.map((s, sIdx) => (
                            <li key={sIdx} style={{ marginBottom: 4 }}>{s}</li>
                          ))}
                        </ul>
                      ) : (
                        <p style={{ margin: 0, fontSize: '12px', color: '#166534', fontStyle: 'italic' }}>
                          Answer addresses the prompt and maintains communication.
                        </p>
                      )}
                    </div>

                    {/* Priority Fixes */}
                    <div
                      style={{
                        backgroundColor: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: '10px',
                        padding: '14px 16px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: '15px' }}>🎯</span>
                        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#92400e' }}>
                          Priority Fixes for a Higher Band
                        </h4>
                      </div>
                      {part.priority_fixes && part.priority_fixes.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: '12px', color: '#78350f', lineHeight: 1.5 }}>
                          {part.priority_fixes.map((f, fIdx) => (
                            <li key={fIdx} style={{ marginBottom: 4 }}>{f}</li>
                          ))}
                        </ul>
                      ) : (
                        <p style={{ margin: 0, fontSize: '12px', color: '#92400e', fontStyle: 'italic' }}>
                          Expand answers with specific reasons, concrete personal examples, and complex discourse markers.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Model Spoken Answer */}
                  {part.improved_answer && (
                    <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '14px 18px', marginBottom: '18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: '14px' }}>✨</span>
                        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#166534' }}>
                          Band 8.5 Model Spoken Answer (Cambridge Benchmark)
                        </h4>
                      </div>
                      <p style={{ margin: 0, fontSize: '12.5px', lineHeight: 1.6, color: '#14532d', fontStyle: 'italic' }}>
                        &ldquo;{part.improved_answer}&rdquo;
                      </p>
                    </div>
                  )}

                  {/* Vocabulary Upgrades */}
                  {part.vocab_upgrades && part.vocab_upgrades.length > 0 && (
                    <div style={{ marginBottom: '18px' }}>
                      <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                        Recommended Lexical Resource Upgrades (+1 Band)
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
                        {part.vocab_upgrades.map((v, vIdx) => (
                          <div key={vIdx} style={{ backgroundColor: '#eff6ff', padding: '10px 14px', borderRadius: '8px', fontSize: '12px', border: '1px solid #bfdbfe' }}>
                            <div>
                              <span style={{ color: '#475569', textDecoration: 'line-through' }}>{v.original}</span>
                              <span style={{ margin: '0 6px', color: '#94a3b8' }}>→</span>
                              <span style={{ color: '#1d4ed8', fontWeight: 700 }}>{v.upgraded}</span>
                            </div>
                            {v.context && (
                              <div style={{ fontSize: '11px', color: '#64748b', marginTop: 4, fontStyle: 'italic' }}>
                                &ldquo;{v.context}&rdquo;
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Part 2 Cue Card Monologue Structure Outline */}
                  {part.cue_card_outline && part.cue_card_outline.length > 0 && (
                    <div style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '14px 18px' }}>
                      <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 700, color: '#92400e' }}>
                        Band 8 Speaking Monologue Structure Roadmap (2-Minute Pacing)
                      </h4>
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#78350f', lineHeight: 1.5 }}>
                        {part.cue_card_outline.map((item, iIdx) => (
                          <li key={iIdx} style={{ marginBottom: '4px' }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              );
            });
          })()}
        </div>
      )}
    </main>
  );
}
