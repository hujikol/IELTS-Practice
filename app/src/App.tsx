// One screen per lifecycle stage. Preparation (P1-06) and practice/review (P3-02,
// P3-04) are implemented; the voice model is Phase 2/4 and is not stubbed here.
import { useCallback, useState } from 'react';
import { Preparation } from './components/preparation.tsx';
import { Player } from './components/player.tsx';
import { Review } from './components/review.tsx';
import { listAttempts, loadAttempt, type AttemptRecord } from './lib/attempts.ts';

type View = { stage: 'list' } | { stage: 'prepare' } | { stage: 'practice'; attempt: AttemptRecord } | { stage: 'review'; attempt: AttemptRecord };

export function App() {
  const [view, setView] = useState<View>({ stage: 'list' });
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async (id: string) => {
    setError(null);
    try {
      const attempt = await loadAttempt(id);
      setView(
        attempt.status === 'completed'
          ? { stage: 'review', attempt }
          : attempt.status === 'active'
            ? { stage: 'practice', attempt }
            : { stage: 'prepare' },
      );
    } catch {
      setError('That test could not be opened. Your saved work is safe.');
    }
  }, []);

  const start = useCallback((attempt: AttemptRecord) => setView({ stage: 'practice', attempt }), []);
  const finished = useCallback((attempt: AttemptRecord) => setView({ stage: 'review', attempt }), []);

  if (view.stage === 'practice') {
    return (
      <Player
        attempt={view.attempt}
        phase={view.attempt.data.phase ?? 0}
        onExit={() => setView({ stage: 'prepare' })}
        onFinish={finished}
      />
    );
  }

  if (view.stage === 'review') {
    // Review recomputes from saved data when no stored result exists, so a finished
    // attempt never shows a score the app did not derive (§11.2).
    return (
      <Review
        data={view.attempt.data}
        result={view.attempt.data.result ?? null}
        onPractise={() => setView({ stage: 'prepare' })}
      />
    );
  }

  if (view.stage === 'prepare') {
    return (
      <Preparation onOpenPractice={start} />
    );
  }

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 900 }}>
      <h1>IELTS Studio</h1>
      <p>Offline practice. Create a test, copy each prompt into any chat, paste the result back.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setView({ stage: 'prepare' })}>New test</button>
        <button onClick={() => void listAttempts().then((all) => all.length || setError('No saved tests yet.'))}>
          Refresh
        </button>
      </div>
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      <SavedTests onOpen={open} />
    </main>
  );
}

function SavedTests({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<
    { id: string; mode: string; status: string; scope: string | null; preparedCount: number; jobCount: number; updatedAt: number }[] | null
  >(null);

  const load = useCallback(() => {
    listAttempts().then(setRows).catch(() => setRows([]));
  }, []);
  load();

  if (rows === null) return <p>Loading saved tests…</p>;
  if (rows.length === 0) return <p>No saved tests yet.</p>;

  return (
    <ul>
      {rows.map((r) => (
        <li key={r.id} style={{ marginBottom: 6 }}>
          <code>{r.id.slice(0, 8)}</code> — {r.status} — {r.scope ?? 'full'} — {r.preparedCount}/{r.jobCount} prepared{' '}
          <button onClick={() => onOpen(r.id)}>Open</button>
        </li>
      ))}
    </ul>
  );
}
