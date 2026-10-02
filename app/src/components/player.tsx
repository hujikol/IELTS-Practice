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
  phase,
  onExit,
  onFinish,
}: {
  attempt: AttemptRecord;
  phase: number;
  onExit: () => void;
  onFinish: (record: AttemptRecord) => void;
}) {
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
  const sessionRef = useRef(session);
  sessionRef.current = session;

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

  const offsetOf = useCallback(
    (p: number) => blocks.slice(0, p).reduce((n, b) => n + b.questions.length, 0),
    [blocks],
  );

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
      await session.saveAndExit(Date.now());
      onExit();
    } catch (e) {
      setError(
        `${e instanceof CommandError ? e.message : 'Could not save.'} Your work is still on this device — retry before you leave.`,
      );
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

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16, maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <strong>{SECTION_LABELS[phase] ?? 'Practice'}</strong>
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
            <button onClick={() => void session.flush().catch(() => undefined)}>Retry save</button>
          )}
          {state.status === 'conflict' && (
            <button onClick={() => void reload()} disabled={busy}>
              Reload
            </button>
          )}
          <button aria-pressed={notesOpen} onClick={() => setNotesOpen(!notesOpen)}>
            Notes
          </button>
          <button onClick={() => void saveAndExit()} disabled={busy}>
            {busy ? 'Saving…' : 'Save & exit'}
          </button>
          {timed ? (
            <strong aria-label={`Time remaining ${state.timer.remaining} seconds`} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {labelOf(state.timer.remaining)}
            </strong>
          ) : (
            <span style={{ fontSize: 13 }}>No time limit</span>
          )}
        </div>
      </header>

      {notice && (
        <p role="status" style={{ background: '#eff6ff', padding: 8 }}>
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" style={{ background: '#fef2f2', padding: 8 }}>
          {error}
        </p>
      )}

      {questions.length > 0 && (
        <nav aria-label="Question navigator" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '12px 0' }}>
          {questions.map((q, i) => (
            <button
              key={q.id}
              aria-label={`Go to question ${numberOf(q, offsetOf(index))}${marked.includes(q.id) ? ', marked' : ''}${
                answered(q.id) ? ', answered' : ''
              }`}
              onClick={() => {
                const gi = groups.findIndex((g) => i >= g.start - 1 && i < g.end);
                if (gi >= 0) setGroup(gi);
                document.getElementById(`q-${q.id}`)?.scrollIntoView({ block: 'center' });
              }}
              style={{
                minWidth: 30,
                fontWeight: marked.includes(q.id) ? 700 : 400,
                background: answered(q.id) ? '#e0f2fe' : undefined,
                borderStyle: marked.includes(q.id) ? 'solid' : 'dashed',
              }}
            >
              {numberOf(q, offsetOf(index))}
            </button>
          ))}
        </nav>
      )}

      {block && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 420px' }}>
            {phase === 1 ? (
              <article aria-label="Reading passage" style={{ border: '1px solid #cbd5e1', padding: 12 }}>
                <h2 style={{ marginTop: 0 }}>{block.title}</h2>
                {block.text.split('\n\n').map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </article>
            ) : (
              <article aria-label="Listening" style={{ border: '1px solid #cbd5e1', padding: 12 }}>
                <h2 style={{ marginTop: 0 }}>{block.title}</h2>
                {/* §11.1 a timed attempt never renders the transcript. publicTest() has already
                    emptied text and script; this states that rather than rendering a gap. */}
                {timed ? (
                  <p>One playback. The transcript is not available during a timed attempt.</p>
                ) : (
                  <details>
                    <summary>Transcript</summary>
                    {block.script?.length ? (
                      block.script.map((l, i) => (
                        <p key={i}>
                          <b>{l.speaker}:</b> {l.text}
                        </p>
                      ))
                    ) : (
                      block.text
                    )}
                  </details>
                )}
              </article>
            )}

            {groups.length > 1 && (
              <div role="tablist" aria-label="Question groups" style={{ display: 'flex', gap: 6, margin: '10px 0' }}>
                {groups.map((g, i) => (
                  <button key={i} role="tab" aria-selected={group === i} onClick={() => setGroup(i)}>
                    {numberOf(questions[g.start - 1] ?? questions[0]!, offsetOf(index))}–
                    {numberOf(questions[g.end - 1] ?? questions[0]!, offsetOf(index))}
                  </button>
                ))}
              </div>
            )}

            {activeGroup && (
              <h3>
                {activeGroup.title} — {activeGroup.instructions}
              </h3>
            )}

            {matchBank && (
              <div aria-label="Matching answer bank" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {matchBank.map((c, i) => (
                  <span key={i}>
                    {String.fromCharCode(65 + i)}. {c}
                  </span>
                ))}
              </div>
            )}

            <ol style={{ listStyle: 'none', padding: 0 }}>
              {visible.map((q) => {
                const n = numberOf(q, offsetOf(index));
                const value = data.responses[q.id];
                const kind = q.kind ?? 'choice';
                return (
                  <li key={q.id} id={`q-${q.id}`} style={{ border: '1px solid #cbd5e1', padding: 10, margin: '8px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span>
                        <b>{n}.</b> {q.stem}
                      </span>
                      <button aria-pressed={marked.includes(q.id)} aria-label={`${marked.includes(q.id) ? 'Unmark' : 'Mark'} question ${n}`} onClick={() => toggleMark(q.id)}>
                        {marked.includes(q.id) ? 'Marked' : 'Mark'}
                      </button>
                    </div>

                    {kind === 'gap' ? (
                      <>
                        <label htmlFor={`a-${q.id}`}>
                          Answer {n}
                          {q.maxWords
                            ? ` (no more than ${q.maxWords} ${q.maxWords === 1 ? 'word' : 'words'})`
                            : ''}
                        </label>
                        <input
                          id={`a-${q.id}`}
                          value={typeof value === 'string' ? value : ''}
                          maxLength={150}
                          autoComplete="off"
                          onChange={(e) => edit({ responses: { [q.id]: e.target.value } })}
                        />
                      </>
                    ) : (
                      <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                        <legend style={{ fontSize: 13, color: '#475569' }}>Answer for question {n}</legend>
                        {q.choices.map((c, i) => (
                          <label key={i} style={{ display: 'block' }}>
                            <input
                              type="radio"
                              name={`q-${q.id}`}
                              checked={value === i}
                              onChange={() => edit({ responses: { [q.id]: i } })}
                            />{' '}
                            {c}
                          </label>
                        ))}
                      </fieldset>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      {phase === 2 && view.writing[index] && (
        <article style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <h2>{view.writing[index].title}</h2>
            <p>{view.writing[index].prompt}</p>
            <p>Write at least {view.writing[index].minimum} words.</p>
            {view.writing[index].visual && (
              <figure>
                <figcaption>{view.writing[index].visual.caption}</figcaption>
                <table>
                  <thead>
                    <tr>
                      {view.writing[index].visual.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.writing[index].visual.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </figure>
            )}
          </div>
          <div style={{ flex: '1 1 320px' }}>
            <label htmlFor="writing-answer">Your response</label>
            <textarea
              id="writing-answer"
              rows={18}
              style={{ width: '100%' }}
              value={data.texts[index] ?? ''}
              onChange={(e) => {
                const texts = [...data.texts];
                texts[index] = e.target.value;
                edit({ texts });
              }}
            />
            <p aria-live="polite">
              {countWords(data.texts[index] ?? '')} words
            </p>
          </div>
        </article>
      )}

      {phase === 3 && view.speaking[index] && (
        <article>
          <h2>Speaking part {view.speaking[index].part}</h2>
          <p>{view.speaking[index].prompt}</p>
          {view.speaking[index].cue?.length ? (
            <>
              <p>You should say:</p>
              <ul>
                {view.speaking[index].cue?.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </>
          ) : null}
          <ol>
            {view.speaking[index].questions?.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
          <label htmlFor="speaking-notes">Your notes or reflection</label>
          <textarea
            id="speaking-notes"
            rows={6}
            style={{ width: '100%' }}
            value={data.speakingTexts[index] ?? ''}
            onChange={(e) => {
              const speakingTexts = [...data.speakingTexts];
              speakingTexts[index] = e.target.value;
              edit({ speakingTexts });
            }}
          />
        </article>
      )}

      {notesOpen && (
        <aside style={{ border: '1px solid #cbd5e1', padding: 10, marginTop: 12 }}>
          <label htmlFor="section-notes">Notes for {SECTION_LABELS[phase]}</label>
          <textarea
            id="section-notes"
            rows={5}
            style={{ width: '100%' }}
            value={data.notes?.[phase] ?? ''}
            onChange={(e) => {
              const notes = [...(data.notes ?? [])];
              notes[phase] = e.target.value;
              edit({ notes });
            }}
          />
        </aside>
      )}

      <footer style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {partCount > 1 && (
          <>
            {Array.from({ length: partCount }, (_, i) => (
              <button
                key={i}
                aria-current={i === index ? 'true' : undefined}
                aria-label={`${phase === 1 ? 'Passage' : phase === 2 ? 'Task' : 'Part'} ${i + 1}`}
                onClick={() => goToPart(i)}
              >
                {phase === 2 ? 'Task' : phase === 1 ? 'Passage' : 'Part'} {i + 1}
              </button>
            ))}
            <button disabled={index === 0} onClick={() => goToPart(index - 1)}>
              Previous
            </button>
            <button disabled={index >= partCount - 1} onClick={() => goToPart(index + 1)}>
              Next
            </button>
          </>
        )}
        <button onClick={() => void finish()} disabled={busy} style={{ marginLeft: 'auto' }}>
          {busy ? 'Working…' : 'Finish and review'}
        </button>
      </footer>
    </main>
  );
}