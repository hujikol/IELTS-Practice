// §10 / §11.2 IELTS Practice Review Screen & Comprehensive Diagnostic Report
// Built following the /web-uix protocol: WCAG 2.1 AA semantics, high contrast,
// verified evidence quote highlights, and actionable targeted drills.

import { useState, useEffect } from 'react';
import type { FinalReport, WeaknessItem } from '../lib/scoring.ts';
import type { AttemptRecord, TestData } from '../lib/types.ts';
import { generateFinalReport } from '../lib/assessment-coordinator.ts';
import { isWritingAttempted, isSpeakingAttempted } from '../lib/attempts.ts';
import { Button } from './ui/button.tsx';

interface ReviewProps {
  data: TestData;
  attempt?: AttemptRecord;
  onPractiseDrill?: (drill: WeaknessItem['drill']) => void;
  onBackToDashboard?: () => void;
}

export function Review({
  data,
  attempt,
  onPractiseDrill,
  onBackToDashboard,
}: ReviewProps) {
  const [report, setReport] = useState<FinalReport | null>(data.finalReport ?? null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [evaluatingAi, setEvaluatingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'listening' | 'reading' | 'writing' | 'speaking' | 'plan'>('overview');

  // Question review filters
  const [objectiveFilter, setObjectiveFilter] = useState<'all' | 'wrong' | 'unanswered'>('all');

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
    if (!report && attempt) {
      setLoadingReport(true);
      generateFinalReport(attempt, undefined, true)
        .then((rep) => setReport(rep))
        .catch((e) => console.error('[IELTS Studio] Failed to build report:', e))
        .finally(() => setLoadingReport(false));
    }
  }, [report, attempt]);

  const handleRunAiEvaluation = async () => {
    if (!attempt) return;
    setEvaluatingAi(true);
    setAiError(null);
    try {
      const updated = await generateFinalReport(attempt, undefined, false);
      setReport(updated);
    } catch (e) {
      setAiError((e as Error).message || 'Failed to complete AI evaluation.');
    } finally {
      setEvaluatingAi(false);
    }
  };

  const writingAttempted = isWritingAttempted(attempt?.data || data);
  const speakingAttempted = isSpeakingAttempted(attempt?.data || data);
  const modules = report?.modules;

  const displayWritingBand = writingAttempted && modules?.writing?.band !== null && modules?.writing?.band !== undefined;
  const displaySpeakingBand = speakingAttempted && modules?.speaking?.band !== null && modules?.speaking?.band !== undefined;
  const overallBand = (writingAttempted && speakingAttempted) ? report?.overall.band : null;
  const weaknesses = report?.weakness_profile.weaknesses || [];
  const strengths = report?.weakness_profile.strengths || [];
  const plan = report?.weakness_profile.seven_day_plan || [];

  return (
    <main style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '24px 20px', maxWidth: '1040px', margin: '0 auto', color: '#0f172a' }}>
      {/* Top Navigation */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        {onBackToDashboard && (
          <Button variant="outline" size="sm" onClick={onBackToDashboard}>
            ← Back to Dashboard
          </Button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#fef3c7',
              color: '#92400e',
              border: '1px solid #fde68a',
            }}
          >
            ESTIMATED BAND — NOT AN OFFICIAL IELTS RESULT (§2.6)
          </span>
        </div>
      </header>

      {/* Hero Score Banner */}
      <section
        aria-label="Score Summary Header"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          borderRadius: '16px',
          padding: '28px',
          color: '#ffffff',
          marginBottom: '28px',
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.2)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '20px' }}>
          <div>
            <div style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#94a3b8', fontWeight: 700, marginBottom: '6px' }}>
              Academic Performance Diagnostic
            </div>
            <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: 800, color: '#f8fafc' }}>
              Test Review &amp; Weakness Analysis
            </h1>
            <p style={{ margin: 0, fontSize: '14px', color: '#cbd5e1', maxWidth: '580px', lineHeight: 1.5 }}>
              {report?.weakness_profile.summary || 'Reviewing question performance, verified paraphrase evidence, and concrete 7-day action drills.'}
            </p>
          </div>

          {/* Overall Band Badge */}
          <div
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '14px',
              padding: '16px 24px',
              textAlign: 'center',
              minWidth: '150px',
            }}
          >
            <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8', fontWeight: 600 }}>
              Estimated Overall
            </div>
            <div style={{ fontSize: '42px', fontWeight: 900, color: '#38bdf8', lineHeight: 1.1, margin: '4px 0' }}>
              {overallBand !== null && overallBand !== undefined ? overallBand.toFixed(1) : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>
              {report?.overall.method === 'mean of 4 modules, IELTS rounding'
                ? 'IELTS Mean Rounding'
                : 'Partial Modules'}
            </div>
          </div>
        </div>

        {/* 4 Modules Band Tiles */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            marginTop: '24px',
            paddingTop: '20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.12)',
          }}
        >
          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)', borderRadius: '10px', padding: '12px 16px' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Listening</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>
              {modules?.listening ? `Band ${modules.listening.band.toFixed(1)}` : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {modules?.listening ? `${modules.listening.raw} of ${modules.listening.of} correct` : 'Not taken'}
            </div>
          </div>

          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)', borderRadius: '10px', padding: '12px 16px' }}>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Reading Academic</div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>
              {modules?.reading ? `Band ${modules.reading.band.toFixed(1)}` : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {modules?.reading ? `${modules.reading.raw} of ${modules.reading.of} correct` : 'Not taken'}
            </div>
          </div>

          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)', borderRadius: '10px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>Writing</span>
              {displayWritingBand ? (
                <span style={{ fontSize: '10px', color: '#38bdf8' }}>
                  {modules?.writing?.confidence === 'low' ? 'Heuristic' : 'AI Scored'}
                </span>
              ) : (
                <span style={{ fontSize: '10px', color: '#94a3b8' }}>Not Attempted</span>
              )}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>
              {displayWritingBand && modules?.writing?.band !== null && modules?.writing?.band !== undefined
                ? `Band ${modules.writing.band.toFixed(1)}`
                : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {displayWritingBand && modules?.writing?.task1 !== null && modules?.writing?.task2 !== null
                ? `T1: ${modules?.writing?.task1?.toFixed(1) ?? '—'} | T2: ${modules?.writing?.task2?.toFixed(1) ?? '—'}`
                : 'No responses submitted'}
            </div>
          </div>

          <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.04)', borderRadius: '10px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>Speaking</span>
              {displaySpeakingBand ? (
                <span style={{ fontSize: '10px', color: '#38bdf8' }}>
                  {modules?.speaking?.confidence === 'low' ? 'Heuristic' : 'AI Scored'}
                </span>
              ) : (
                <span style={{ fontSize: '10px', color: '#94a3b8' }}>Not Attempted</span>
              )}
            </div>
            <div style={{ fontSize: '20px', fontWeight: 800, color: '#f8fafc', marginTop: '2px' }}>
              {displaySpeakingBand && modules?.speaking?.band !== null && modules?.speaking?.band !== undefined
                ? `Band ${modules.speaking.band.toFixed(1)}`
                : '—'}
            </div>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              {displaySpeakingBand
                ? 'Fluency & Lexical Analysis'
                : 'No recordings submitted'}
            </div>
          </div>
        </div>
      </section>

      {/* Optional Deep AI Diagnostic Banner */}
      {((writingAttempted && modules?.writing?.confidence === 'low') ||
        (speakingAttempted && modules?.speaking?.confidence === 'low')) && (
        <div
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
          <div>
            <strong style={{ fontSize: '0.95rem', color: '#166534' }}>
              ✨ Detailed AI Writing &amp; Speaking Assessment
            </strong>
            <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: '#15803d' }}>
              Objective sections are scored instantly. Run LLM evaluation on your written essays and spoken answers whenever you're ready.
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            loading={evaluatingAi}
            disabled={evaluatingAi}
            onClick={handleRunAiEvaluation}
          >
            {evaluatingAi ? 'Evaluating with AI…' : 'Run Deep AI Evaluation →'}
          </Button>
        </div>
      )}

      {aiError && (
        <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '10px 14px', borderRadius: 8, marginBottom: 20, fontSize: '0.88rem' }}>
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
          marginBottom: '28px',
          overflowX: 'auto',
          paddingBottom: '4px',
        }}
      >
        {[
          { id: 'overview', label: '📊 Weakness & Strengths' },
          { id: 'listening', label: `🎧 Listening (${report?.review.listening.length || 0})` },
          { id: 'reading', label: `📖 Reading (${report?.review.reading.length || 0})` },
          { id: 'writing', label: '✍️ Writing Review' },
          { id: 'speaking', label: '🗣️ Speaking Review' },
          { id: 'plan', label: '📅 7-Day Plan' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            style={{
              padding: '10px 18px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? '#2563eb' : '#64748b',
              borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
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
          <div className="btn-spinner" style={{ margin: '0 auto 12px auto', width: '28px', height: '28px', border: '3px solid #cbd5e1', borderRightColor: '#2563eb' }} />
          Generating deep diagnostic review and quote verification...
        </div>
      )}

      {/* ─── TAB 1: OVERVIEW & WEAKNESSES ─── */}
      {activeTab === 'overview' && report && (
        <div>
          {/* Top 5 Prioritized Weaknesses */}
          <section aria-labelledby="weaknesses-heading" style={{ marginBottom: '32px' }}>
            <h2 id="weaknesses-heading" style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '16px' }}>
              🎯 Top Ranked Weaknesses &amp; Targeted Drills (§8.2)
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {weaknesses.map((w) => (
                <article
                  key={w.rank}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '20px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '8px',
                          backgroundColor: '#fee2e2',
                          color: '#b91c1c',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '14px',
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        #{w.rank}
                      </div>
                      <div>
                        <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                          {w.title}
                        </h3>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#b91c1c', marginBottom: '8px' }}>
                          Evidence: {w.evidence.stat}
                        </div>
                        <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                          <strong>Likely Cause:</strong> {w.likely_cause}
                        </p>
                        <div style={{ fontSize: '12px', color: '#334155' }}>
                          <strong>Recommended Techniques:</strong>
                          <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px' }}>
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
                        onClick={() => onPractiseDrill(w.drill)}
                        title={`Generate targeted drill for ${w.drill.focus}`}
                      >
                        ⚡ Practise This ({w.drill.count} items)
                      </Button>
                    )}
                  </div>
                </article>
              ))}

              {weaknesses.length === 0 && (
                <div style={{ padding: '24px', backgroundColor: '#f8fafc', borderRadius: '12px', textAlign: 'center', color: '#64748b' }}>
                  No significant accuracy gaps identified. Excellent job!
                </div>
              )}
            </div>
          </section>

          {/* Top 3 Strengths */}
          <section aria-labelledby="strengths-heading" style={{ marginBottom: '32px' }}>
            <h2 id="strengths-heading" style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '16px' }}>
              🌟 Verified Strengths (≥85% Accuracy)
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
              {strengths.map((str, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '12px',
                    padding: '16px 20px',
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#166534', marginBottom: '4px' }}>
                    ✓ {str.title}
                  </div>
                  <div style={{ fontSize: '12px', color: '#15803d' }}>
                    {str.evidence}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ─── TAB 2 & 3: OBJECTIVE MODULES (LISTENING & READING) ─── */}
      {(activeTab === 'listening' || activeTab === 'reading') && report && (
        <div>
          {/* Filter Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              {(['all', 'wrong', 'unanswered'] as const).map((filter) => (
                <Button
                  key={filter}
                  variant={objectiveFilter === filter ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setObjectiveFilter(filter)}
                >
                  {filter === 'all' ? 'All Items' : filter === 'wrong' ? 'Wrong Only' : 'Unanswered'}
                </Button>
              ))}
            </div>
            <span style={{ fontSize: '13px', color: '#64748b' }}>
              Showing items with official Cambridge explanations &amp; evidence quotes
            </span>
          </div>

          {/* Question List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {((activeTab === 'listening' ? report.review.listening : report.review.reading) || [])
              .filter((it) => {
                if (objectiveFilter === 'wrong') return !it.correct;
                if (objectiveFilter === 'unanswered') return it.user_answer === null;
                return true;
              })
              .map((it) => (
                <article
                  key={it.item_id}
                  style={{
                    backgroundColor: '#ffffff',
                    border: it.correct ? '1px solid #e2e8f0' : '1px solid #fecaca',
                    borderRadius: '12px',
                    padding: '18px 20px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  }}
                >
                  {/* Item Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          width: '26px',
                          height: '26px',
                          borderRadius: '50%',
                          backgroundColor: it.correct ? '#dcfce7' : '#fee2e2',
                          color: it.correct ? '#166534' : '#b91c1c',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: 800,
                        }}
                      >
                        {it.q}
                      </span>
                      <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>
                        {it.type || 'Question'}
                      </span>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#f1f5f9', color: '#475569' }}>
                        Target Band {it.target_band.toFixed(1)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {it.error_flag && (
                        <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: '#fef3c7', color: '#92400e' }}>
                          Flag: {it.error_flag === 'spelling' ? 'Spelling Near-Miss' : 'Exceeded Word Limit'}
                        </span>
                      )}
                      <span style={{ fontSize: '13px', fontWeight: 700, color: it.correct ? '#166534' : '#b91c1c' }}>
                        {it.correct ? '✓ Correct' : '✗ Incorrect'}
                      </span>
                    </div>
                  </div>

                  {/* Answers Comparison */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                    <div style={{ backgroundColor: '#f8fafc', padding: '10px 14px', borderRadius: '8px' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', display: 'block', fontWeight: 600 }}>YOUR ANSWER</span>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: it.correct ? '#15803d' : '#b91c1c' }}>
                        {it.user_answer ?? 'Unanswered'}
                      </span>
                    </div>
                    <div style={{ backgroundColor: '#f0fdf4', padding: '10px 14px', borderRadius: '8px' }}>
                      <span style={{ fontSize: '11px', color: '#15803d', display: 'block', fontWeight: 600 }}>CORRECT ANSWER</span>
                      <span style={{ fontSize: '14px', fontWeight: 700, color: '#166534' }}>
                        {it.correct_answer}
                      </span>
                    </div>
                  </div>

                  {/* Verbatim Evidence Quote */}
                  {it.evidence_quote && (
                    <div style={{ backgroundColor: '#eff6ff', borderLeft: '3px solid #3b82f6', padding: '8px 12px', borderRadius: '4px', marginBottom: '10px', fontSize: '12px', color: '#1e3a8a' }}>
                      <strong>Source Evidence:</strong> &ldquo;{it.evidence_quote}&rdquo;
                      {it.jump_to?.paragraph && <span style={{ marginLeft: '6px', color: '#2563eb' }}>(Paragraph {it.jump_to.paragraph})</span>}
                    </div>
                  )}

                  {/* Explanation & Paraphrase Link */}
                  <div style={{ fontSize: '13px', color: '#334155', lineHeight: 1.5, marginBottom: '8px' }}>
                    <strong>Explanation:</strong> {it.explanation}
                  </div>

                  {/* AI Personalised Note for Wrong Answers (§7.1) */}
                  {it.personal_note && (
                    <div style={{ backgroundColor: '#fefce8', border: '1px solid #fef08a', borderRadius: '6px', padding: '10px 14px', fontSize: '12px', color: '#854d0e', marginBottom: '8px' }}>
                      <strong>Personal Diagnostic:</strong> {it.personal_note}
                    </div>
                  )}

                  {/* Strategy Tip */}
                  <div style={{ fontSize: '12px', color: '#475569' }}>
                    💡 <strong>Strategy Tip:</strong> {it.strategy_tip}
                  </div>
                </article>
              ))}
          </div>
        </div>
      )}

      {/* ─── TAB 4: WRITING REVIEW ─── */}
      {activeTab === 'writing' && report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {!writingAttempted || report.review.writing.tasks.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', backgroundColor: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', color: '#64748b' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>✍️</div>
              <h3 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '18px', fontWeight: 800 }}>Writing Section Not Attempted</h3>
              <p style={{ margin: 0, fontSize: '0.92rem', color: '#64748b' }}>
                You did not submit responses for the Writing tasks in this test session.
              </p>
            </div>
          ) : (
            report.review.writing.tasks.map((task) => (
            <article
              key={task.task}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                  Writing Task {task.task} Performance (Band {task.band.toFixed(1)})
                </h3>
                <span style={{ fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '6px', backgroundColor: '#eff6ff', color: '#1d4ed8' }}>
                  {task.task === 1 ? '150 words min' : '250 words min'}
                </span>
              </div>

              {/* 4 Public Criteria Breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                {Object.entries(task.criteria).map(([criterion, data]) => (
                  <div key={criterion} style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '12px', textTransform: 'capitalize', color: '#64748b', fontWeight: 600 }}>
                      {criterion.replace('_', ' ')}
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a', margin: '2px 0' }}>
                      Band {data.band.toFixed(1)}
                    </div>
                    <div style={{ fontSize: '11px', color: '#475569' }}>
                      {data.next_band_gap || 'Maintain precise academic register.'}
                    </div>
                  </div>
                ))}
              </div>

              {/* Error Annotations (§5.2) */}
              {task.errors.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>
                    Identified Errors &amp; Corrections
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {task.errors.map((err, errIdx) => (
                      <div key={errIdx} style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px', fontSize: '12px' }}>
                        <span style={{ color: '#b91c1c', fontWeight: 700 }}>&ldquo;{err.span}&rdquo;</span>
                        <span style={{ margin: '0 8px', color: '#94a3b8' }}>→</span>
                        <span style={{ color: '#15803d', fontWeight: 700 }}>{err.correction}</span>
                        <span style={{ marginLeft: '12px', color: '#64748b' }}>({err.category})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Model Answer (Band 9) Side by Side */}
              {task.model_answer && (
                <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '18px 20px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 700, color: '#166534' }}>
                    Official Band 9 Model Comparison
                  </h4>
                  <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#15803d', lineHeight: 1.5 }}>
                    {task.model_answer}
                  </p>
                  <div style={{ fontSize: '12px', color: '#166534' }}>
                    <strong>Key Features Annotated:</strong> Paraphrased the prompt accurately, highlighted primary trends without extraneous detail, and used fluent cohesive markers.
                  </div>
                </div>
              )}
            </article>
          )))}
        </div>
      )}

      {/* ─── TAB 5: SPEAKING REVIEW ─── */}
      {activeTab === 'speaking' && report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {!speakingAttempted || report.review.speaking.parts.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', backgroundColor: '#ffffff', borderRadius: 16, border: '1px solid #e2e8f0', color: '#64748b' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>🗣</div>
              <h3 style={{ margin: '0 0 6px', color: '#0f172a', fontSize: '18px', fontWeight: 800 }}>Speaking Section Not Attempted</h3>
              <p style={{ margin: 0, fontSize: '0.92rem', color: '#64748b' }}>
                You did not record or submit answers for the Speaking parts in this test session.
              </p>
            </div>
          ) : (
            report.review.speaking.parts.map((part) => (
            <article
              key={part.part}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <h3 style={{ margin: '0 0 14px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                Speaking Part {part.part} Analysis
              </h3>

              {/* Transcript */}
              <div style={{ backgroundColor: '#f8fafc', padding: '14px 18px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', lineHeight: 1.6 }}>
                <strong>Transcript:</strong> {part.transcript}
              </div>

              {/* Vocabulary Upgrades */}
              {part.vocab_upgrades.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>
                    Recommended Lexical Resource Upgrades (+1 Band)
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
                    {part.vocab_upgrades.map((v, vIdx) => (
                      <div key={vIdx} style={{ backgroundColor: '#eff6ff', padding: '8px 12px', borderRadius: '6px', fontSize: '12px' }}>
                        <span style={{ color: '#475569' }}>{v.original}</span>
                        <span style={{ margin: '0 6px', color: '#94a3b8' }}>→</span>
                        <span style={{ color: '#1d4ed8', fontWeight: 700 }}>{v.upgraded}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Part 2 Cue Card Outline */}
              {part.cue_card_outline && (
                <div style={{ backgroundColor: '#fefce8', border: '1px solid #fef08a', borderRadius: '10px', padding: '14px 18px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 700, color: '#854d0e' }}>
                    Band 8 Speaking Monologue Structure Outline
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#713f12' }}>
                    {part.cue_card_outline.map((item, iIdx) => (
                      <li key={iIdx} style={{ marginBottom: '4px' }}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          )))}
        </div>
      )}

      {/* ─── TAB 6: 7-DAY IMPROVEMENT PLAN ─── */}
      {activeTab === 'plan' && report && (
        <section aria-labelledby="plan-heading">
          <h2 id="plan-heading" style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}>
            📅 Personalized 7-Day Improvement Plan (§8.3)
          </h2>
          <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: '#64748b' }}>
            Targeted daily sessions (30-60 minutes) addressing your exact accuracy bottlenecks. Check off tasks as you complete them.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {plan.map((day) => (
              <div
                key={day.day}
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '18px 22px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <span style={{ fontSize: '15px', fontWeight: 800, color: '#1e293b' }}>
                    Day {day.day}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>
                    ⏱ {day.minutes} minutes
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
    </main>
  );
}
