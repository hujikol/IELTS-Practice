// §11.2 / P3-04 results view. Bands come from score() and nothing else; a null band is
// "not available", never 0. A focused set shows accuracy, and any band shown for generated
// material is labelled an uncalibrated practice estimate (§15: generated questions are not
// examiner-calibrated).

import { score, type Block, type Result, type TestData, type Wrong } from '../lib/types.ts';

const bandText = (band: number | null | undefined, label: string): string => {
  // §16.1 zero is a real band. The two failure modes to avoid are rendering null as "0.0"
  // and rendering an unavailable section as if it had been scored.
  if (band === null || band === undefined) return 'Not available';
  return `${band.toFixed(1)}${label}`;
};

const snippetFor = (wrong: Wrong, blocks: Block[]): string => {
  const block = blocks.find((b) => b.questions.some((q) => q.id === wrong.id));
  const passage = wrong.passage || block?.text || '';
  if (!passage) return '';
  // Show the paragraph containing the answer rather than the first 700 characters, so the
  // student can see why their choice was wrong.
  const paragraphs = passage.split('\n\n');
  const needle = wrong.correct;
  const hit = needle ? paragraphs.find((p) => p.toLowerCase().includes(needle.toLowerCase())) : undefined;
  const target = hit ?? paragraphs[0] ?? '';
  return target.length > 700 ? `${target.slice(0, 700)}…` : target;
};

export function Review({
  data,
  result,
  onPractise,
}: {
  data: TestData;
  /** A finished attempt's stored result; recomputed from saved data when absent. */
  result?: Result | null;
  onPractise?: (section: string, skill: string) => void;
}) {
  const r = result ?? score(data);
  const focused = data.scope !== undefined && data.scope !== 'full';
  const objective = [...data.listening, ...data.reading];
  const objectiveTotal = objective.reduce((n, b) => n + b.questions.length, 0);
  const correct = r.listening.correct + r.reading.correct;
  const audible = [...data.listening, ...data.reading];
  const silent = [...data.reading];

  const sections: { key: string; label: string; band: number | null | undefined; got: number; of: number }[] = [
    ...(data.listening.length > 0
      ? [{ key: 'listening', label: 'Listening', band: r.listening.band, got: r.listening.correct, of: data.listening.reduce((n, b) => n + b.questions.length, 0) }]
      : []),
    ...(data.reading.length > 0
      ? [{ key: 'reading', label: 'Reading', band: r.reading.band, got: r.reading.correct, of: data.reading.reduce((n, b) => n + b.questions.length, 0) }]
      : []),
    ...(data.writing.length > 0
      ? [{ key: 'writing', label: 'Writing', band: r.writing.band, got: 0, of: 0 }]
      : []),
    ...(data.speaking.length > 0
      ? [{ key: 'speaking', label: 'Speaking', band: r.speaking.band, got: 0, of: 0 }]
      : []),
  ];

  const weakest = r.weaknesses.find((w) => w.wrong > 0);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16, maxWidth: 1000, margin: '0 auto' }}>
      <h1>Your results</h1>
      <p style={{ maxWidth: 640 }}>{r.note}</p>

      <section aria-label="Score summary">
        {objectiveTotal > 0 && (
          <p>
            <strong>
              {correct}/{objectiveTotal}
            </strong>{' '}
            correct ({Math.round((correct / objectiveTotal) * 100)}%)
          </p>
        )}
        {!focused && r.overall !== null && r.overall !== undefined && (
          <p>
            <strong>Practice estimate {r.overall.toFixed(1)}</strong> — uncalibrated, not an official band
          </p>
        )}
        {!focused && (r.overall === null || r.overall === undefined) && (
          <p>An overall estimate appears only when all four sections have a valid result.</p>
        )}
      </section>

      <section aria-label="Section breakdown">
        <h2>Sections</h2>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {sections.map((s) => (
            <li key={s.key} style={{ borderBottom: '1px solid #e2e8f0', padding: '8px 0' }}>
              <strong>{s.label}</strong>
              {s.of > 0 && (
                <span>
                  {' '}
                  — {s.got}/{s.of} correct
                </span>
              )}
              <div>{bandText(s.band, focused ? ' (not shown for a focused set)' : ' — uncalibrated practice estimate')}</div>
            </li>
          ))}
        </ul>
      </section>

      {r.weaknesses.length > 0 && (
        <section aria-label="Skills">
          <h2>By skill</h2>
          <ul>
            {r.weaknesses.map((w) => (
              <li key={w.skill}>
                {w.skill}: {w.wrong} of {w.total} missed
                {onPractise && w.wrong > 0 && (
                  <>
                    {' '}
                    <button onClick={() => onPractise(w.skill.split(':')[0]?.trim().toLowerCase() || 'reading', w.skill)}>
                      Practise this
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {weakest && !focused && (
            <p style={{ fontSize: 13, color: '#475569' }}>
              Weakest area: {weakest.skill}. Scores are practice estimates from generated questions, not examiner
              marks.
            </p>
          )}
        </section>
      )}

      {r.writing.feedback.length > 0 && (
        <section aria-label="Writing feedback">
          <h2>Writing</h2>
          {data.writing.map((task, i) => (
            <article key={i}>
              <h3>
                {task.title} — {countWordsLocal(data.texts[i] ?? '')} words (minimum {task.minimum})
              </h3>
              <p>{r.writing.feedback[i]}</p>
              {r.writing.assessments?.[i] && (
                <details>
                  <summary>Assessment detail</summary>
                  <ul>
                    {r.writing.assessments![i]!.criteria.map((c) => (
                      <li key={c.name}>
                        {c.name}: {bandText(c.band, '')} — {c.feedback}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </article>
          ))}
        </section>
      )}

      {data.speaking.length > 0 && (
        <section aria-label="Speaking feedback">
          <h2>Speaking</h2>
          <p>{r.speaking.feedback}</p>
          <p>
            Band: {bandText(r.speaking.band, focused ? '' : ' — uncalibrated practice estimate')}
          </p>
        </section>
      )}

      <section aria-label="Answers to revisit">
        <h2>Answers to revisit ({r.wrong.length})</h2>
        {r.wrong.length === 0 && <p>Every answer was correct.</p>}
        {r.wrong.map((w) => (
          <article key={w.id} style={{ border: '1px solid #cbd5e1', padding: 10, margin: '8px 0' }}>
            <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>
              {w.id} · {w.section} part {w.part} · {w.skill}
            </p>
            <h3 style={{ margin: '4px 0' }}>{w.stem}</h3>
            {w.kind !== 'gap' && (
              <ol type="A">
                {w.choices.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ol>
            )}
            <p>
              <span style={{ color: '#b91c1c' }}>Your answer: {w.selected || 'Unanswered'}</span>
              {' · '}
              <span style={{ color: '#15803d' }}>Correct: {w.correct}</span>
            </p>
            {w.explanation && <p>{w.explanation}</p>}
            {snippetFor(w, w.section === 'listening' ? audible : silent) && (
              <details>
                <summary>Source passage</summary>
                <p style={{ whiteSpace: 'pre-wrap' }}>{snippetFor(w, w.section === 'listening' ? audible : silent)}</p>
              </details>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}

const countWordsLocal = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);