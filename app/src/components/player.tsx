// §11.1 player. Every state change goes through Session; this component never touches
// storage, never invokes a command and never sees an answer key.
//
// Redaction: everything rendered comes from publicTest(), which strips correct, answerText,
// accepted, explanation and evidence, and blanks the listening transcript while a timed
// attempt is in progress. `data` is used only for the student's own responses, notes and
// navigation — never to render a question. Keeping that split structural (separate typed
// values) is what stops a future edit from accidentally reintroducing the key.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandError, loadAttempt, type AttemptRecord } from '../lib/attempts.ts';
import { Session, type Outbox, type Patch, type SaveState, type TimerState } from '../lib/session.ts';
import { countWords, publicTest, type QuestionGroup } from '../lib/types.ts';
import { VisualRenderer, MapPlanLabellingRenderer, extractPlaceName } from './visual-renderer.tsx';
import { ListeningAudioPlayer } from './listening-audio-player.tsx';
import { Button } from './ui/button.tsx';

const SECTION_LABELS = ['Listening', 'Reading', 'Writing', 'Speaking'] as const;

/** The redacted shapes publicTest() actually produces. */
type PublicTest = ReturnType<typeof publicTest>;
type PublicBlock = PublicTest['reading'][number];
type PublicQuestion = PublicBlock['questions'][number];

const labelOf = (n: number) =>
  `${Math.floor(Math.max(0, n) / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(Math.max(0, n) % 60)
    .toString()
    .padStart(2, '0')}`;

/** localStorage-backed recovery outbox (§7.2). Derived, never the system of record. */
const browserOutbox: Outbox = {
  read: (attemptId) => {
    try {
      const raw = window.localStorage.getItem(`ielts-outbox:${attemptId}`);
      return raw ? (JSON.parse(raw) as Patch) : null;
    } catch {
      return null;
    }
  },
  write: (attemptId, patch) => {
    try {
      if (patch === null) window.localStorage.removeItem(`ielts-outbox:${attemptId}`);
      else window.localStorage.setItem(`ielts-outbox:${attemptId}`, JSON.stringify(patch));
    } catch {
      // A full or blocked store must not break answering; the durable save still works.
    }
  },
};

/** Question groups, deriving them when the material did not carry them. */
function groupsFor(questions: PublicQuestion[], declared?: QuestionGroup[]): QuestionGroup[] {
  if (declared?.length) return declared;
  const groups: QuestionGroup[] = [];
  questions.forEach((q, i) => {
    const kind = q.kind ?? 'choice';
    const last = groups.at(-1);
    if (i > 0 && kind === (questions[i - 1]?.kind ?? 'choice') && last) last.end = i + 1;
    else
      groups.push({
        title: kind === 'gap' ? 'Short answers' : kind === 'match' ? 'Matching' : 'Choose an answer',
        instructions:
          kind === 'gap'
            ? 'Write ONE WORD AND/OR A NUMBER for each answer.'
            : kind === 'match'
              ? 'Choose the correct answer for each item.'
              : 'Choose ONE correct answer for each question.',
        start: i + 1,
        end: i + 1,
      });
  });
  return groups;
}

const numberOf = (q: PublicQuestion, offset = 0) => q.number ?? offset + Number(q.id.split('-')[1] ?? 0);

/**
 * §18.4 the persisted timer is read from the record if native carries one. A record without
 * one recovers at the full budget; Session clamps anything above the budget itself.
 */
function readTimer(record: AttemptRecord): TimerState | null {
  const raw = (record as { timer?: unknown }).timer;
  if (raw && typeof raw === 'object') {
    const value = raw as Partial<TimerState>;
    if (typeof value.remaining === 'number') {
      return { remaining: value.remaining, running: value.running === true, checkpoint: value.checkpoint ?? 0 };
    }
  }
  return null;
}

export function Player({
  attempt,
  phase: initialPhase,
  onExit,
  onFinish,
}: {
  attempt: AttemptRecord;
  phase: number;
  onExit: () => void;
  onFinish: (record: AttemptRecord) => void;
}) {
  const [phase, setPhase] = useState(initialPhase ?? 0);
  const [session] = useState(
    () =>
      new Session({
        attemptId: attempt.id,
        mode: attempt.mode === 'timed' ? 'timed' : 'untimed',
        data: attempt.data,
        revision: attempt.revision,
        timer: readTimer(attempt),
        outbox: browserOutbox,
        onConflict: (_patch, error) =>
          setNotice(
            error.currentRevision
              ? `This test changed elsewhere (revision ${error.currentRevision}). Reload to see the newer version.`
              : 'This test changed elsewhere. Reload to see the newer version.',
          ),
      }),
  );
  const [state, setState] = useState<SaveState>(() => session.state());
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [part, setPart] = useState(0);
  const [group, setGroup] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [showForfeitModal, setShowForfeitModal] = useState(false);
  const [selectedMapQuestionId, setSelectedMapQuestionId] = useState<string | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const availableSections = useMemo(() => {
    const list: { phase: number; key: string; label: string; count: number; partLabel: string }[] = [];
    if (attempt.data.listening && attempt.data.listening.length > 0) {
      list.push({ phase: 0, key: 'listening', label: 'Listening', count: attempt.data.listening.length, partLabel: 'Part' });
    }
    if (attempt.data.reading && attempt.data.reading.length > 0) {
      list.push({ phase: 1, key: 'reading', label: 'Reading', count: attempt.data.reading.length, partLabel: 'Passage' });
    }
    if (attempt.data.writing && attempt.data.writing.length > 0) {
      list.push({ phase: 2, key: 'writing', label: 'Writing', count: attempt.data.writing.length, partLabel: 'Task' });
    }
    if (attempt.data.speaking && attempt.data.speaking.length > 0) {
      list.push({ phase: 3, key: 'speaking', label: 'Speaking', count: attempt.data.speaking.length, partLabel: 'Part' });
    }
    return list;
  }, [attempt.data]);

  const currentSectionIdx = availableSections.findIndex((s) => s.phase === phase);
  const nextSection = currentSectionIdx >= 0 && currentSectionIdx < availableSections.length - 1
    ? availableSections[currentSectionIdx + 1]
    : null;
  const isLastSection = !nextSection;

  const switchSection = (targetPhase: number) => {
    session.checkpoint(Date.now());
    setPhase(targetPhase);
    setPart(0);
    setGroup(0);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToNextSection = () => {
    if (nextSection) {
      switchSection(nextSection.phase);
    }
  };

  useEffect(() => session.subscribe(setState), [session]);

  // §8.4 time decreases only while the window is in the foreground. Losing it pauses and
  // persists; a tick can only ever reduce remaining.
  useEffect(() => {
    if (attempt.mode !== 'timed') return;
    session.setForeground(true, Date.now());
    const timer = setInterval(() => sessionRef.current.tick(Date.now()), 250);
    const hide = () => {
      if (document.hidden) sessionRef.current.setForeground(false, Date.now());
    };
    const away = () => sessionRef.current.setForeground(false, Date.now());
    const back = () => {
      if (!document.hidden) sessionRef.current.setForeground(true, Date.now());
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('blur', away);
      window.removeEventListener('focus', back);
      sessionRef.current.setForeground(false, Date.now());
      void sessionRef.current.flush().catch(() => undefined);
    };
  }, [attempt.mode, session]);

  // Autosave: the queue holds edits until typing settles, so a keystroke is not a write.
  useEffect(() => {
    if (!state.pending) return;
    const debounce = setTimeout(() => void session.flush().catch(() => undefined), 800);
    return () => clearTimeout(debounce);
  }, [state.pending, state.data, session]);

  const data = state.data;
  const timed = attempt.mode === 'timed';
  // §11.1 the only source of rendered question data. `completed` stays false: nothing is
  // unredacted until the attempt finishes and review takes over.
  const view = useMemo(() => publicTest(data, timed ? 'timed' : 'untimed', false), [data, timed]);

  const partCount = phase === 0 ? view.listening.length : phase === 1 ? view.reading.length : phase === 2 ? view.writing.length : view.speaking.length;
  const index = Math.min(part, Math.max(0, partCount - 1));
  const blocks: PublicBlock[] = phase === 0 ? view.listening : phase === 1 ? view.reading : [];
  const block = blocks[index];
  const questions = block?.questions ?? [];
  const groups = useMemo(() => groupsFor(questions, block?.groups), [questions, block]);
  const activeGroup = groups[group] ?? groups[0];
  const visible = activeGroup ? questions.slice(activeGroup.start - 1, activeGroup.end) : questions;
  const matchBank = visible[0]?.kind === 'match' ? visible[0].choices : null;

  const isMapQuestion = useMemo(() => {
    if (!activeGroup) return false;
    const groupText = `${activeGroup.title} ${activeGroup.instructions}`.toLowerCase();
    const hasMapKeyword =
      groupText.includes('map') ||
      groupText.includes('plan') ||
      groupText.includes('diagram') ||
      groupText.includes('layout') ||
      groupText.includes('labelling');
    const hasLetterChoices = visible.some(
      (q) => q.choices && q.choices.length >= 4 && q.choices.every((c) => /^[A-H]$/.test(c.trim())),
    );
    return hasMapKeyword || hasLetterChoices;
  }, [activeGroup, visible]);

  const offsetOf = useCallback(
    (p: number) => blocks.slice(0, p).reduce((n, b) => n + b.questions.length, 0),
    [blocks],
  );

  const placedMapAnswers = useMemo(() => {
    const result: Record<string, { questionId: string; questionNumber: number; stem: string; placeName: string }> = {};
    visible.forEach((q) => {
      const val = data.responses[q.id];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        const letter =
          typeof val === 'number' && q.choices && q.choices[val]
            ? q.choices[val].trim().toUpperCase()
            : String(val).trim().toUpperCase();
        if (letter && /^[A-H]$/.test(letter)) {
          result[letter] = {
            questionId: q.id,
            questionNumber: numberOf(q, offsetOf(index)),
            stem: q.stem,
            placeName: extractPlaceName(q.stem),
          };
        }
      }
    });
    return result;
  }, [visible, data.responses, offsetOf, index]);

  const handleDropMapAnswer = (pin: string, qId: string) => {
    const targetQ = visible.find((q) => q.id === qId);
    if (!targetQ) return;
    const choiceIndex = targetQ.choices ? targetQ.choices.findIndex((c) => c.trim().toUpperCase() === pin) : -1;
    const answerVal = choiceIndex >= 0 ? choiceIndex : pin;

    const patch: Record<string, string | number> = {
      [qId]: answerVal,
    };
    // Unassign previous owner of this pin to avoid conflicting duplicate placements
    const prevOwner = Object.entries(placedMapAnswers).find(([p, ans]) => p === pin && ans.questionId !== qId);
    if (prevOwner) {
      patch[prevOwner[1].questionId] = '';
    }
    edit({ responses: patch });
    setSelectedMapQuestionId(null);
  };

  const handleClearMapPin = (pin: string) => {
    const placed = placedMapAnswers[pin];
    if (placed) {
      edit({ responses: { [placed.questionId]: '' } });
    }
  };

  const answered = (id: string) => {
    const value = data.responses[id];
    return value !== undefined && String(value).trim() !== '';
  };
  const marked = data.marked ?? [];

  const edit = (patch: Patch) => {
    setError('');
    session.enqueue(patch);
  };

  const toggleMark = (id: string) => {
    edit({ marked: marked.includes(id) ? marked.filter((m) => m !== id) : [...marked, id] });
  };

  // §18.4 navigation is a checkpoint boundary.
  const goToPart = (target: number) => {
    session.checkpoint(Date.now());
    setPart(target);
    setGroup(0);
  };

  const saveAndExit = async () => {
    setBusy(true);
    setError('');
    try {
      await Promise.race([
        session.saveAndExit(Date.now()),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Save timeout')), 3000)),
      ]);
    } catch (e) {
      console.warn('[IELTS Studio] Notice during save & exit:', e);
    } finally {
      setBusy(false);
      onExit();
    }
  };

  const handleForfeit = async () => {
    setShowForfeitModal(false);
    setBusy(true);
    setError('');
    try {
      await session.finish();
      onFinish(await loadAttempt(attempt.id));
    } catch (e) {
      setError(e instanceof CommandError ? e.message : 'Could not forfeit the attempt.');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      await session.finish();
      onFinish(await loadAttempt(attempt.id));
    } catch (e) {
      setError(e instanceof CommandError ? e.message : 'Could not finish the attempt. Your answers are saved.');
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setBusy(true);
    try {
      const fresh = await loadAttempt(attempt.id);
      session.adopt({ revision: fresh.revision, data: fresh.data, timer: readTimer(fresh) });
      setNotice('Reloaded. The unsaved changes that could not be applied were discarded.');
    } catch (e) {
      setError(e instanceof CommandError ? e.message : 'Could not reload this test.');
    } finally {
      setBusy(false);
    }
  };

  const statusText: Record<SaveState['status'], string> = {
    idle: 'Saved',
    unsaved: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    failed: 'Save failed — retry',
    conflict: 'Changed elsewhere — reload',
  };

  const currentNotes = data.notes?.[phase] ?? '';
  const totalQuestions = questions.length;
  const answeredCount = useMemo(() => questions.filter((q) => answered(q.id)).length, [questions, data.responses]);
  const markedCount = useMemo(() => questions.filter((q) => marked.includes(q.id)).length, [questions, marked]);

  return (
    <main
      style={{
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        maxWidth: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: '#ffffff',
        zIndex: 10,
      }}
    >
      <style>{`
        .ielts-pane-scroll {
          scrollbar-width: thin;
          scrollbar-color: #cbd5e1 #f8fafc;
        }
        .ielts-pane-scroll::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .ielts-pane-scroll::-webkit-scrollbar-track {
          background: #f8fafc;
        }
        .ielts-pane-scroll::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }
        .ielts-pane-scroll::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
        .ielts-split-container {
          flex: 1 1 0;
          min-height: 0;
          height: 100%;
          overflow: hidden;
        }
        .ielts-split-container > section {
          min-height: 0;
          height: 100%;
          overflow-y: auto;
          box-sizing: border-box;
        }
        @media (max-width: 860px) {
          .ielts-split-container {
            grid-template-columns: 1fr !important;
            overflow-y: auto !important;
          }
          .ielts-split-left {
            border-right: none !important;
            border-bottom: 2px solid #e2e8f0 !important;
            height: auto !important;
            min-height: auto !important;
          }
          .ielts-split-right {
            height: auto !important;
            min-height: auto !important;
          }
        }
      `}</style>

      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          padding: '10px 24px',
          borderBottom: '1px solid #e2e8f0',
          backgroundColor: '#ffffff',
          flexShrink: 0,
          zIndex: 20,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <strong style={{ fontSize: '1rem', color: '#0f172a' }}>{SECTION_LABELS[phase] ?? 'Practice'}</strong>
          <div style={{ fontSize: 13, color: '#475569' }}>
            {view.scope === 'full' ? 'Academic mock test' : 'Focused practice'} ·{' '}
            {partCount > 1 ? `Part ${index + 1} of ${partCount}` : 'Single part'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Announced without moving focus: a busy state must not steal the keyboard. */}
          <span aria-live="polite" role="status" style={{ fontSize: 13 }}>
            {statusText[state.status]}
          </span>
          {state.status === 'failed' && (
            <Button variant="danger" size="sm" onClick={() => void session.flush().catch(() => undefined)}>
              Retry save
            </Button>
          )}
          {state.status === 'conflict' && (
            <Button variant="outline" size="sm" onClick={() => void reload()} disabled={busy}>
              Reload
            </Button>
          )}
          <Button
            variant={notesOpen ? 'primary' : 'outline'}
            size="sm"
            aria-pressed={notesOpen}
            onClick={() => setNotesOpen(!notesOpen)}
          >
            Notes
          </Button>
          <Button variant="outline" size="sm" onClick={() => void saveAndExit()} disabled={busy}>
            {busy ? 'Saving…' : 'Save & exit'}
          </Button>
          {timed && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowForfeitModal(true)}
              disabled={busy}
              title="End the timed test immediately and view your diagnostic report"
            >
              Forfeit Test
            </Button>
          )}
          {timed ? (
            <strong aria-label={`Time remaining ${state.timer.remaining} seconds`} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {labelOf(state.timer.remaining)}
            </strong>
          ) : (
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>No time limit</span>
          )}
        </div>
      </header>

      {/* Multi-Section Navigation Tabs */}
      {availableSections.length > 1 && (
        <nav
          aria-label="Test sections"
          style={{
            display: 'flex',
            gap: 8,
            padding: '6px 24px',
            backgroundColor: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            overflowX: 'auto',
            flexShrink: 0,
          }}
        >
          {availableSections.map((sec, idx) => {
            const isActive = sec.phase === phase;
            return (
              <button
                key={sec.phase}
                type="button"
                onClick={() => switchSection(sec.phase)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: isActive ? '#0f172a' : 'transparent',
                  color: isActive ? '#ffffff' : '#475569',
                  fontSize: 13,
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{idx + 1}. {sec.label}</span>
                <span
                  style={{
                    fontSize: 11,
                    padding: '2px 7px',
                    borderRadius: 9999,
                    backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : '#e2e8f0',
                    color: isActive ? '#ffffff' : '#64748b',
                    fontWeight: 600,
                  }}
                >
                  {sec.count} {sec.partLabel}{sec.count > 1 ? 's' : ''}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {notice && (
        <div role="status" style={{ background: '#eff6ff', padding: '8px 24px', flexShrink: 0, fontSize: 13 }}>
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" style={{ background: '#fef2f2', padding: '8px 24px', flexShrink: 0, color: '#dc2626', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* 2-Section Split Layout for Listening & Reading */}
      {block && (
        <div
          className="ielts-split-container"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            width: '100%',
            overflow: 'hidden',
          }}
        >
          {/* Left Section: Reading Passage or Listening Audio Briefing */}
          <section
            aria-label={phase === 1 ? 'Reading passage' : 'Listening track and briefing'}
            className="ielts-split-left ielts-pane-scroll"
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: '24px 32px',
              borderRight: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              boxSizing: 'border-box',
            }}
          >
            {phase === 1 ? (
              <article aria-label="Reading passage">
                <h2 style={{ marginTop: 0, fontSize: '1.4rem', color: '#0f172a', fontWeight: 800, lineHeight: 1.3 }}>
                  {block.title}
                </h2>
                {block.visual && (
                  <div style={{ margin: '16px 0' }}>
                    <VisualRenderer visual={block.visual} />
                  </div>
                )}
                <div style={{ marginTop: 16 }}>
                  {block.text.split('\n\n').map((p, i) => (
                    <p key={i} style={{ lineHeight: 1.7, color: '#334155', fontSize: '1rem', marginBottom: 16 }}>
                      {p}
                    </p>
                  ))}
                </div>
              </article>
            ) : (
              <article aria-label="Listening audio track">
                <h2 style={{ marginTop: 0, fontSize: '1.4rem', color: '#0f172a', fontWeight: 800, lineHeight: 1.3 }}>
                  {block.title}
                </h2>
                <div style={{ marginTop: 16 }}>
                  <ListeningAudioPlayer
                    partNumber={index + 1}
                    script={data.listening[index]?.script || []}
                    timed={timed}
                  />
                </div>
                {block.visual && (
                  <div style={{ marginTop: 16 }}>
                    <VisualRenderer visual={block.visual} />
                  </div>
                )}
                <div
                  style={{
                    marginTop: 24,
                    padding: '14px 16px',
                    borderRadius: '8px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.86rem',
                    color: '#64748b',
                    lineHeight: 1.6,
                  }}
                >
                  <strong style={{ color: '#334155', display: 'block', marginBottom: 4 }}>
                    Official Computer-Delivered IELTS Conditions:
                  </strong>
                  Listen carefully to the recording and answer the questions on the right. You may make rough notes at any time using the Notes tool. In accordance with examination regulations, the written transcript remains hidden throughout test execution.
                </div>
              </article>
            )}
          </section>

          {/* Right Section: Question List & Interactive Inputs */}
          <section
            aria-label="Questions list"
            className="ielts-split-right ielts-pane-scroll"
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: '24px 32px',
              backgroundColor: '#ffffff',
              boxSizing: 'border-box',
            }}
          >

            {groups.length > 1 && (
              <div
                role="tablist"
                aria-label="Question groups"
                style={{
                  display: 'flex',
                  gap: 8,
                  margin: '14px 0 10px',
                  borderBottom: '1px solid #e2e8f0',
                  paddingBottom: '8px',
                }}
              >
                {groups.map((g, i) => {
                  const isSelected = group === i;
                  return (
                    <button
                      key={i}
                      role="tab"
                      type="button"
                      aria-selected={isSelected}
                      onClick={() => setGroup(i)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: isSelected ? '#0f172a' : '#f1f5f9',
                        color: isSelected ? '#ffffff' : '#475569',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Questions {numberOf(questions[g.start - 1] ?? questions[0]!, offsetOf(index))}–
                      {numberOf(questions[g.end - 1] ?? questions[0]!, offsetOf(index))}
                    </button>
                  );
                })}
              </div>
            )}

            {activeGroup && (
              <h3 style={{ fontSize: '1rem', color: '#1e293b', marginTop: 12, marginBottom: 8 }}>
                {activeGroup.title} — <span style={{ fontWeight: 400, color: '#475569' }}>{activeGroup.instructions}</span>
              </h3>
            )}

            {/* Visual Specs / Maps / Charts */}
            {isMapQuestion ? (
              <MapPlanLabellingRenderer
                title={activeGroup?.title || 'Map & Plan Labelling'}
                placedAnswers={placedMapAnswers}
                questions={visible.map((q) => ({
                  id: q.id,
                  number: numberOf(q, offsetOf(index)),
                  stem: q.stem,
                  placeName: extractPlaceName(q.stem),
                  isMarked: marked.includes(q.id),
                }))}
                onDropAnswer={handleDropMapAnswer}
                onClearPin={handleClearMapPin}
                selectedQuestionId={selectedMapQuestionId}
                onSelectQuestion={setSelectedMapQuestionId}
                onToggleMark={toggleMark}
              />
            ) : (
              (activeGroup?.visual || block.visual) && (
                <VisualRenderer visual={activeGroup?.visual || block.visual!} />
              )
            )}

            {!isMapQuestion && matchBank && (
              <div
                aria-label="Matching answer bank"
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '10px 14px',
                  margin: '10px 0',
                }}
              >
                {matchBank.map((c, i) => (
                  <span key={i} style={{ fontSize: '13px', color: '#1e293b' }}>
                    <strong>{String.fromCharCode(65 + i)}.</strong> {c}
                  </span>
                ))}
              </div>
            )}

            {!isMapQuestion && (
            <ol style={{ listStyle: 'none', padding: 0 }}>
              {visible.map((q) => {
                const n = numberOf(q, offsetOf(index));
                const value = data.responses[q.id];
                const kind = q.kind ?? 'choice';
                const isMarked = marked.includes(q.id);
                return (
                  <li
                    key={q.id}
                    id={`q-${q.id}`}
                    style={{
                      border: isMarked ? '1px solid #fcd34d' : '1px solid #cbd5e1',
                      borderRadius: '8px',
                      padding: '14px 16px',
                      margin: '12px 0',
                      backgroundColor: isMarked ? '#fffbeb' : '#ffffff',
                      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                      <span style={{ fontSize: '14px', lineHeight: 1.5, color: '#0f172a' }}>
                        <strong style={{ marginRight: '6px' }}>{n}.</strong> {q.stem}
                      </span>
                      <button
                        type="button"
                        aria-pressed={isMarked}
                        aria-label={`${isMarked ? 'Unmark' : 'Mark'} question ${n}`}
                        onClick={() => toggleMark(q.id)}
                        style={{
                          background: isMarked ? '#fef3c7' : '#f8fafc',
                          color: isMarked ? '#b45309' : '#64748b',
                          border: isMarked ? '1px solid #fde68a' : '1px solid #cbd5e1',
                          borderRadius: '6px',
                          padding: '3px 8px',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          flexShrink: 0,
                        }}
                      >
                        {isMarked ? '⚑ Marked' : '⚐ Mark'}
                      </button>
                    </div>

                    <div style={{ marginTop: '10px' }}>
                      {isMapQuestion ? (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
                              Map Location:
                            </span>
                            {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((letter) => {
                              const isCurrent =
                                (typeof value === 'number' && q.choices?.[value]?.toUpperCase() === letter) ||
                                String(value).toUpperCase() === letter;
                              return (
                                <button
                                  key={letter}
                                  type="button"
                                  onClick={() => handleDropMapAnswer(letter, q.id)}
                                  style={{
                                    width: '30px',
                                    height: '30px',
                                    borderRadius: '50%',
                                    border: isCurrent ? '2px solid #1e40af' : '1px solid #cbd5e1',
                                    backgroundColor: isCurrent ? '#2563eb' : '#ffffff',
                                    color: isCurrent ? '#ffffff' : '#1e3a8a',
                                    fontSize: '12px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: isCurrent ? '0 1px 3px rgba(37,99,235,0.3)' : 'none',
                                    transition: 'all 0.15s ease',
                                  }}
                                  title={`Place Question ${n} on Pin ${letter}`}
                                >
                                  {letter}
                                </button>
                              );
                            })}
                            {value !== undefined && value !== null && String(value).trim() !== '' && (
                              <button
                                type="button"
                                onClick={() => edit({ responses: { [q.id]: '' } })}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: '#dc2626',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: '2px 6px',
                                  textDecoration: 'underline',
                                }}
                              >
                                Clear Pin
                              </button>
                            )}
                          </div>
                        </div>
                      ) : kind === 'gap' ? (
                        <div>
                          <label
                            htmlFor={`a-${q.id}`}
                            style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}
                          >
                            Answer for Question {n}
                            {q.maxWords
                              ? ` (NO MORE THAN ${q.maxWords} ${q.maxWords === 1 ? 'WORD' : 'WORDS'})`
                              : ''}
                          </label>
                          <input
                            id={`a-${q.id}`}
                            value={typeof value === 'string' ? value : ''}
                            maxLength={150}
                            autoComplete="off"
                            placeholder="Type your answer here..."
                            onChange={(e) => edit({ responses: { [q.id]: e.target.value } })}
                            style={{
                              height: '38px',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              fontSize: '14px',
                              width: '100%',
                              maxWidth: '380px',
                              outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        </div>
                      ) : (
                        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                          <legend className="sr-only" style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden' }}>
                            Options for question {n}
                          </legend>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {q.choices.map((c, i) => {
                              const isChecked = value === i;
                              return (
                                <label
                                  key={i}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '8px 12px',
                                    borderRadius: '6px',
                                    border: isChecked ? '1px solid #93c5fd' : '1px solid #e2e8f0',
                                    backgroundColor: isChecked ? '#eff6ff' : '#f8fafc',
                                    color: isChecked ? '#1e40af' : '#334155',
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name={`q-${q.id}`}
                                    checked={isChecked}
                                    onChange={() => edit({ responses: { [q.id]: i } })}
                                    style={{ margin: 0 }}
                                  />
                                  <span>{c}</span>
                                </label>
                              );
                            })}
                          </div>
                        </fieldset>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            )}
          </section>
        </div>
      )}

      {/* 2-Section Split Layout for Writing */}
      {phase === 2 && view.writing[index] && (
        <div
          className="ielts-split-container"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            width: '100%',
            overflow: 'hidden',
          }}
        >
          <section
            aria-label="Writing task instructions"
            className="ielts-split-left ielts-pane-scroll"
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: '24px 32px',
              borderRight: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              boxSizing: 'border-box',
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: '1.4rem', color: '#0f172a', fontWeight: 800 }}>
              {view.writing[index].title}
            </h2>
            <div
              style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '12px 16px',
                margin: '16px 0',
                color: '#1e40af',
                fontSize: '0.92rem',
                fontWeight: 600,
              }}
            >
              Write at least {view.writing[index].minimum} words.
            </div>
            <p style={{ lineHeight: 1.7, color: '#334155', fontSize: '1rem', whiteSpace: 'pre-line' }}>
              {view.writing[index].prompt}
            </p>
            {view.writing[index].visual && (
              <div style={{ marginTop: 20 }}>
                <VisualRenderer visual={view.writing[index].visual} />
              </div>
            )}
          </section>

          <section
            aria-label="Writing response area"
            className="ielts-split-right ielts-pane-scroll"
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: '24px 32px',
              backgroundColor: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <label htmlFor="writing-answer" style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a' }}>
                Your Response:
              </label>
              <span
                aria-live="polite"
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color:
                    countWords(data.texts[index] ?? '') >= view.writing[index].minimum
                      ? '#16a34a'
                      : '#dc2626',
                  backgroundColor:
                    countWords(data.texts[index] ?? '') >= view.writing[index].minimum
                      ? '#f0fdf4'
                      : '#fef2f2',
                  padding: '3px 10px',
                  borderRadius: '6px',
                  border:
                    countWords(data.texts[index] ?? '') >= view.writing[index].minimum
                      ? '1px solid #bbf7d0'
                      : '1px solid #fecaca',
                }}
              >
                {countWords(data.texts[index] ?? '')} / {view.writing[index].minimum} words
              </span>
            </div>
            <textarea
              id="writing-answer"
              rows={20}
              placeholder="Type your essay or report here..."
              style={{
                width: '100%',
                flex: 1,
                minHeight: '340px',
                padding: '14px 16px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '1rem',
                lineHeight: 1.6,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                resize: 'none',
                boxSizing: 'border-box',
                outline: 'none',
              }}
              value={data.texts[index] ?? ''}
              onChange={(e) => {
                const texts = [...data.texts];
                texts[index] = e.target.value;
                edit({ texts });
              }}
            />
          </section>
        </div>
      )}

      {/* 2-Section Split Layout for Speaking */}
      {phase === 3 && view.speaking[index] && (
        <div
          className="ielts-split-container"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            width: '100%',
            overflow: 'hidden',
          }}
        >
          <section
            aria-label="Speaking prompt"
            className="ielts-split-left ielts-pane-scroll"
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: '24px 32px',
              borderRight: '1px solid #e2e8f0',
              backgroundColor: '#ffffff',
              boxSizing: 'border-box',
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: '1.4rem', color: '#0f172a', fontWeight: 800 }}>
              Speaking Part {view.speaking[index].part}
            </h2>
            <p style={{ lineHeight: 1.7, color: '#334155', fontSize: '1rem' }}>
              {view.speaking[index].prompt}
            </p>
            {view.speaking[index].cue?.length ? (
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '16px 20px',
                  margin: '16px 0',
                }}
              >
                <strong style={{ color: '#0f172a', display: 'block', marginBottom: 8 }}>
                  You should say:
                </strong>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#334155', lineHeight: 1.6 }}>
                  {view.speaking[index].cue?.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {view.speaking[index].questions?.length ? (
              <div style={{ marginTop: 16 }}>
                <strong style={{ color: '#0f172a', display: 'block', marginBottom: 8 }}>
                  Discussion Questions:
                </strong>
                <ol style={{ paddingLeft: 20, color: '#334155', lineHeight: 1.6 }}>
                  {view.speaking[index].questions?.map((q, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>{q}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </section>

          <section
            aria-label="Speaking practice reflection"
            className="ielts-split-right ielts-pane-scroll"
            style={{
              height: '100%',
              overflowY: 'auto',
              padding: '24px 32px',
              backgroundColor: '#ffffff',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
            }}
          >
            <label htmlFor="speaking-notes" style={{ fontWeight: 700, fontSize: '1rem', color: '#0f172a', marginBottom: 10 }}>
              Your Notes or Reflection:
            </label>
            <textarea
              id="speaking-notes"
              rows={16}
              placeholder="Draft your key speaking points or reflection..."
              style={{
                width: '100%',
                flex: 1,
                minHeight: '260px',
                padding: '14px 16px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '1rem',
                lineHeight: 1.6,
                fontFamily: 'system-ui, -apple-system, sans-serif',
                resize: 'none',
                boxSizing: 'border-box',
                outline: 'none',
              }}
              value={data.speakingTexts[index] ?? ''}
              onChange={(e) => {
                const speakingTexts = [...data.speakingTexts];
                speakingTexts[index] = e.target.value;
                edit({ speakingTexts });
              }}
            />
          </section>
        </div>
      )}

      {/* Floating Fillout Notes Drawer */}
      {notesOpen && (
        <aside
          aria-label={`Rough notes for ${SECTION_LABELS[phase]}`}
          style={{
            position: 'fixed',
            top: '72px',
            right: '24px',
            width: '360px',
            maxHeight: 'calc(100vh - 150px)',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '12px',
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 60,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span aria-hidden="true" style={{ fontSize: '16px' }}>📝</span>
              <strong style={{ fontSize: '13px', color: '#0f172a' }}>
                Rough Notes · {SECTION_LABELS[phase]}
              </strong>
            </div>
            <button
              type="button"
              onClick={() => setNotesOpen(false)}
              aria-label="Close notes"
              style={{
                background: 'none',
                border: 'none',
                color: '#64748b',
                fontSize: '18px',
                fontWeight: 700,
                cursor: 'pointer',
                lineHeight: 1,
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              ×
            </button>
          </div>
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#64748b', lineHeight: 1.4 }}>
              Private scratchpad for your rough workings. Saved automatically with your attempt.
            </p>
            <textarea
              id="section-notes"
              aria-label={`Scratchpad notes for ${SECTION_LABELS[phase]}`}
              rows={10}
              placeholder="Write your rough notes or draft calculations here..."
              style={{
                width: '100%',
                flex: 1,
                minHeight: '180px',
                padding: '10px 12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                fontFamily: 'monospace',
                lineHeight: 1.5,
                boxSizing: 'border-box',
                resize: 'none',
                outline: 'none',
              }}
              value={data.notes?.[phase] ?? ''}
              onChange={(e) => {
                const notes = [...(data.notes ?? [])];
                notes[phase] = e.target.value;
                edit({ notes });
              }}
            />
            <div style={{ marginTop: '8px', fontSize: '11px', color: '#94a3b8', textAlign: 'right' }}>
              {countWords(currentNotes)} words
            </div>
          </div>
        </aside>
      )}

      {/* Floating Notes Toggle on bottom-right if notes drawer is closed */}
      {!notesOpen && (
        <button
          type="button"
          onClick={() => setNotesOpen(true)}
          aria-label="Open scratchpad notes"
          style={{
            position: 'fixed',
            right: '24px',
            bottom: '68px',
            zIndex: 35,
            backgroundColor: '#0f172a',
            color: '#ffffff',
            border: 'none',
            borderRadius: '24px',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: 600,
            boxShadow: '0 4px 14px rgba(15, 23, 42, 0.25)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span aria-hidden="true">📝</span>
          <span>Notes</span>
          {currentNotes.trim().length > 0 && (
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: '#38bdf8',
                display: 'inline-block',
              }}
              title="Notes contain text"
            />
          )}
        </button>
      )}

      {/* Sticky Bottom Navigation Bar */}
      <footer
        role="region"
        aria-label="Test navigation and question jump"
        style={{
          flexShrink: 0,
          position: 'sticky',
          bottom: 0,
          left: 0,
          right: 0,
          width: '100%',
          backgroundColor: '#ffffff',
          borderTop: '1px solid #cbd5e1',
          boxShadow: '0 -4px 16px rgba(15, 23, 42, 0.08)',
          padding: '8px 24px',
          zIndex: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          boxSizing: 'border-box',
        }}
      >
        {/* Left: Part Switchers and Prev/Next */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {partCount > 1 &&
            Array.from({ length: partCount }, (_, i) => (
              <Button
                key={i}
                variant={i === index ? 'primary' : 'outline'}
                size="sm"
                aria-current={i === index ? 'true' : undefined}
                aria-label={`${phase === 1 ? 'Passage' : phase === 2 ? 'Task' : 'Part'} ${i + 1}`}
                onClick={() => goToPart(i)}
              >
                {phase === 2 ? 'Task' : phase === 1 ? 'Passage' : 'Part'} {i + 1}
              </Button>
            ))}
          {partCount > 1 && (
            <>
              <Button variant="outline" size="sm" disabled={index === 0} onClick={() => goToPart(index - 1)}>
                ← Previous
              </Button>
              <Button variant="outline" size="sm" disabled={index >= partCount - 1} onClick={() => goToPart(index + 1)}>
                Next →
              </Button>
            </>
          )}
        </div>

        {/* Center: Question Jump Buttons (authentic CD-IELTS footer navigation) */}
        {questions.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              overflowX: 'auto',
              maxWidth: '48vw',
              padding: '2px 4px',
            }}
            aria-label="Question jump buttons"
          >
            {questions.map((q, i) => {
              const num = numberOf(q, offsetOf(index));
              const isAnswered = answered(q.id);
              const isMarked = marked.includes(q.id);
              const isInCurrentGroup = activeGroup && i >= activeGroup.start - 1 && i < activeGroup.end;
              return (
                <button
                  key={q.id}
                  type="button"
                  aria-label={`Question ${num}${isMarked ? ', marked' : ''}${isAnswered ? ', answered' : ''}`}
                  onClick={() => {
                    const gi = groups.findIndex((g) => i >= g.start - 1 && i < g.end);
                    if (gi >= 0) setGroup(gi);
                    if (isMapQuestion) {
                      setSelectedMapQuestionId(q.id);
                    } else {
                      document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                  style={{
                    minWidth: '28px',
                    height: '30px',
                    padding: '0 6px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: isAnswered ? 700 : 500,
                    backgroundColor: isAnswered ? '#eff6ff' : '#ffffff',
                    color: isAnswered ? '#1d4ed8' : '#334155',
                    border: isMarked
                      ? '2px solid #f59e0b'
                      : isInCurrentGroup
                        ? '2px solid #0f172a'
                        : isAnswered
                          ? '1px solid #93c5fd'
                          : '1px solid #cbd5e1',
                    cursor: 'pointer',
                    position: 'relative',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                  }}
                  title={`Question ${num}: ${isAnswered ? 'Answered' : 'Unanswered'}${isMarked ? ' (Marked for review)' : ''}`}
                >
                  {num}
                  {isMarked && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '-3px',
                        right: '-3px',
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: '#f59e0b',
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Right: Progress & Continue/Finish Buttons */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
          {questions.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '12px', color: '#475569', fontWeight: 600 }}>
                {answeredCount}/{totalQuestions} Answered
              </span>
              {markedCount > 0 && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: '#b45309',
                    backgroundColor: '#fef3c7',
                    border: '1px solid #fde68a',
                    borderRadius: '4px',
                    padding: '2px 6px',
                  }}
                  title={`${markedCount} question${markedCount > 1 ? 's' : ''} marked for review`}
                >
                  ⚑ {markedCount} Marked
                </span>
              )}
            </div>
          )}
          {index >= partCount - 1 && nextSection && (
            <Button
              variant="primary"
              size="md"
              onClick={goToNextSection}
              disabled={busy}
            >
              Continue to {nextSection.label} →
            </Button>
          )}

          {(!nextSection || index >= partCount - 1) && (
            <Button
              variant={isLastSection ? 'primary' : 'outline'}
              size="md"
              onClick={() => void finish()}
              disabled={busy}
              title={isLastSection ? 'Submit test and review results' : 'Finish early and review submitted sections'}
            >
              {busy ? 'Finishing…' : isLastSection ? 'Finish and Review' : 'Finish Test Early'}
            </Button>
          )}
        </div>
      </footer>

      {/* Forfeit Confirmation Modal */}
      {showForfeitModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="forfeit-title"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '24px 28px',
              maxWidth: '460px',
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              border: '1px solid #e2e8f0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  backgroundColor: '#fee2e2',
                  color: '#b91c1c',
                  fontSize: '18px',
                  fontWeight: 700,
                }}
              >
                ⚠️
              </span>
              <h3 id="forfeit-title" style={{ margin: 0, fontSize: '1.2rem', color: '#0f172a', fontWeight: 800 }}>
                Forfeit Timed Test?
              </h3>
            </div>
            <p style={{ fontSize: '0.92rem', color: '#475569', lineHeight: 1.5, margin: '0 0 20px' }}>
              Are you sure you want to forfeit this timed examination? The timer will be stopped immediately, and your
              current answers will be submitted for scoring and diagnostic feedback.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <Button
                variant="outline"
                size="md"
                onClick={() => setShowForfeitModal(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="md"
                onClick={() => void handleForfeit()}
                disabled={busy}
                loading={busy}
              >
                Confirm & Forfeit
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}