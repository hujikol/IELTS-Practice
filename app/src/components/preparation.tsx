// §9 Phase 1 screen: the whole human handoff on one surface. No wizard, no player,
// no model download, no provider settings. Creating a draft, copying a prompt,
// pasting a result, previewing it and committing are all here.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommandError, createAttempt, issueRequest, commitImport, listAttempts, loadAttempt, type AttemptRecord, type AttemptSummary } from '../lib/attempts.ts';
import { emptyTest, materialComplete } from '../lib/material.ts';
import { guideRequirements } from '../lib/guide-requirements.ts';
import { renderGuide, renderRepair, type RepairError } from '../lib/guide.ts';
import { ActionCounter, stageImport, type ImportFailure, type StagedCandidate } from '../lib/import-pipeline.ts';
import type { PrepJob, Scope, TestData } from '../lib/types.ts';

const SCOPES: { value: Scope; label: string; part: number }[] = [
  { value: 'full', label: 'Full mock (4 Listening, 3 Reading, Writing, Speaking)', part: 0 },
  { value: 'listening', label: 'Listening only', part: 4 },
  { value: 'reading', label: 'Reading only', part: 3 },
  { value: 'writing', label: 'Writing only', part: 2 },
  { value: 'speaking', label: 'Speaking only', part: 3 },
];

const GENERATION_META = { provider: 'manual-copy-paste', model: 'external-chat', createdAt: Date.now() };

export function Preparation() {
  const [summaries, setSummaries] = useState<AttemptSummary[]>([]);
  const [record, setRecord] = useState<AttemptRecord | null>(null);
  const [selectedJob, setSelectedJob] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [candidate, setCandidate] = useState<StagedCandidate | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const actions = useRef(new ActionCounter());

  const test: TestData | null = record?.data ?? null;
  const jobs: PrepJob[] = useMemo(() => test?.jobs ?? [], [test]);
  const job = jobs.find((j) => j.key === selectedJob) ?? jobs[0] ?? null;
  const request = job && record ? record.requests[job.key] : undefined;
  const prepared = test?.prepared ?? [];

  const refresh = useCallback(async () => {
    try {
      setSummaries(await listAttempts());
    } catch {
      // A missing native runtime is expected in a plain browser; the screen still
      // explains itself rather than showing a stack trace.
      setError('Native storage is unavailable. Run this inside the desktop app.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof CommandError) {
        setError(e.isConflict ? 'This test changed elsewhere. Reloading the latest version.' : e.message);
        if (e.isConflict) await reload();
      } else {
        setError('That action could not finish. Your saved work is safe.');
      }
    } finally {
      setBusy(null);
    }
  };

  const reload = useCallback(async () => {
    if (!record) return;
    const fresh = await loadAttempt(record.id);
    setRecord(fresh);
  }, [record]);

  const create = (scope: Scope, part: number, mode: 'timed' | 'untimed') =>
    guard('create', async () => {
      const data = emptyTest(scope, part, 'balanced', GENERATION_META);
      const created = await createAttempt({ mode, scope, practice_part: part, data });
      setRecord(created);
      setSelectedJob(created.data.jobs?.[0]?.key ?? '');
      setCandidate(null);
      setFailure(null);
      setPasted('');
      await refresh();
    });

  const guideText = useMemo(() => {
    if (!test || !job || !record || !request) return '';
    return renderGuide(guideRequirements(test, job), {
      attempt_id: record.id,
      generation_id: request.generation_id,
    });
  }, [test, job, record, request]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${what} copied.`);
    } catch {
      // §5.1 clipboard failure must still leave a selectable fallback.
      setNotice('Copying failed. Select the text below and copy it manually.');
    }
  };

  const issue = (rotate: boolean) =>
    guard('issue', async () => {
      if (!test || !job || !record) return;
      const snapshot = renderGuide(guideRequirements(test, job), {
        attempt_id: record.id,
        generation_id: 'pending',
      });
      await issueRequest({
        attempt_id: record.id,
        expected_revision: record.revision,
        job_key: job.key,
        rotate,
        snapshot,
        contract_version: 1,
      });
      setNotice(rotate ? 'New generation issued. Earlier answers are now stale.' : 'Prompt ready.');
      await reload();
    });

  const stage = () =>
    guard('validate', async () => {
      if (!test || !job || !record || !request) return;
      const token = actions.current.next();
      setCandidate(null);
      setConfirmReplace(false);
      try {
        const staged = await stageImport(test, pasted, {
          attemptId: record.id,
          generationId: request.generation_id,
        });
        if (!actions.current.isCurrent(token)) return;
        setCandidate(staged);
        setFailure(null);
      } catch (e) {
        if (!actions.current.isCurrent(token)) return;
        setCandidate(null);
        setFailure({
          code: (e as ImportFailure).code ?? 'parse_failed',
          message: (e as ImportFailure).message ?? 'That response could not be validated.',
          path: (e as ImportFailure).path,
          retryable: false,
        });
      }
    });

  const commit = () =>
    guard('commit', async () => {
      if (!candidate || !record) return;
      const updated = await commitImport({
        attempt_id: record.id,
        expected_revision: record.revision,
        job_key: candidate.job.key,
        generation_id: candidate.envelope.generation_id,
        data: candidate.next,
        sha256: candidate.sha256,
        contract_version: 1,
        raw_original: pasted,
        replace_confirmed: confirmReplace,
      });
      setRecord(updated);
      setCandidate(null);
      setConfirmReplace(false);
      setPasted('');
      setNotice('Saved. This job is prepared.');
      await refresh();
    });

  const repairText = useMemo(() => {
    if (!failure || !record || !job || !request) return '';
    const err: RepairError = { code: failure.code as RepairError['code'], message: failure.message, path: failure.path };
    return renderRepair({
      identity: { attempt_id: record.id, generation_id: request.generation_id },
      job_key: job.key,
      job_label: job.label,
      error: err,
      snapshot: guideText,
    });
  }, [failure, record, job, request, guideText]);

  if (!record) {
    return (
      <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 900 }}>
        <h1>IELTS Studio — preparation</h1>
        <p>Create a test, then copy each prompt into any chat and paste the result back.</p>
        {SCOPES.map((s) => (
          <div key={s.value} style={{ marginBottom: 12 }}>
            <strong>{s.label}</strong>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              {s.part > 0 &&
                Array.from({ length: s.part }, (_, i) => i + 1).map((p) => (
                  <button key={p} disabled={busy !== null} onClick={() => create(s.value, p, 'untimed')}>
                    Part {p}
                  </button>
                ))}
              {s.part === 0 && (
                <button disabled={busy !== null} onClick={() => create(s.value, 1, 'untimed')}>
                  Start
                </button>
              )}
            </div>
          </div>
        ))}
        {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
        <h2>Saved tests</h2>
        <ul>
          {summaries.map((s) => (
            <li key={s.id}>
              {s.id.slice(0, 8)} — {s.status} — {s.preparedCount}/{s.jobCount} prepared{' '}
              <button
                onClick={() =>
                  guard('load', async () => {
                    setRecord(await loadAttempt(s.id));
                  })
                }
              >
                Open
              </button>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const complete = materialComplete(test!);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 1000 }}>
      <h1>IELTS Studio — preparation</h1>
      <p>
        Test <code>{record.id.slice(0, 8)}</code> · revision {record.revision} · {record.status} ·{' '}
        {prepared.length}/{jobs.length} prepared{complete ? ' · ready to start' : ''}
      </p>

      <h2>1. Choose a part</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {jobs.map((j) => (
          <li key={j.key}>
            <button
              aria-pressed={j.key === job?.key}
              onClick={() => {
                setSelectedJob(j.key);
                setCandidate(null);
                setFailure(null);
                setPasted('');
              }}
            >
              {j.label} {prepared.includes(j.key) ? '✓' : '— not prepared'}
            </button>
          </li>
        ))}
      </ul>

      {job && (
        <>
          <h2>2. Copy the prompt for {job.label}</h2>
          <p>
            Your focus/topic context goes to whichever chat you paste into. Essays and
            recordings are never sent automatically.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button disabled={busy !== null} onClick={() => issue(false)}>
              {request ? 'Copy prompt' : 'Issue prompt'}
            </button>
            {guideText && (
              <button disabled={busy !== null} onClick={() => copy(guideText, 'Prompt')}>
                Copy to clipboard
              </button>
            )}
            {request && (
              <button disabled={busy !== null} onClick={() => issue(true)}>
                New generation request
              </button>
            )}
          </div>
          {guideText && (
            <textarea readOnly value={guideText} rows={10} style={{ width: '100%', fontFamily: 'monospace' }} />
          )}

          <h2>3. Paste the chat result</h2>
          <label htmlFor="paste">Paste the JSON the chat returned</label>
          <textarea
            id="paste"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={8}
            style={{ width: '100%', fontFamily: 'monospace' }}
          />
          <button disabled={busy !== null || pasted.trim() === ''} onClick={stage}>
            Validate
          </button>

          {failure && (
            <div role="alert" style={{ border: '1px solid #b91c1c', padding: 12, marginTop: 12 }}>
              <strong>{failure.code}</strong>
              <p>{failure.message}</p>
              {failure.path && <p style={{ fontFamily: 'monospace' }}>{failure.path}</p>}
              {repairText && (
                <button onClick={() => copy(repairText, 'Repair request')}>Copy repair request</button>
              )}
            </div>
          )}

          {candidate && (
            <div style={{ border: '1px solid #334155', padding: 12, marginTop: 12 }}>
              <strong>Preview — answers are visible. This is a preparation screen, not a test.</strong>
              <p>
                {candidate.job.label}: {candidate.next.reading[0]?.title ?? candidate.next.listening[0]?.title ?? ''}
              </p>
              <p>
                Questions:{' '}
                {[...candidate.next.listening, ...candidate.next.reading]
                  .flatMap((b) => b.questions ?? [])
                  .length || 'see material'}
              </p>
              {candidate.replacing && !confirmReplace && (
                <p>
                  This job already has accepted material.{' '}
                  <button onClick={() => setConfirmReplace(true)}>Replace prepared material</button>
                </p>
              )}
              <button
                disabled={busy !== null || (candidate.replacing && !confirmReplace)}
                onClick={commit}
              >
                {candidate.replacing ? 'Replace and save' : 'Save material'}
              </button>
            </div>
          )}
        </>
      )}

      {busy && <p aria-live="polite">Working: {busy}…</p>}
      {notice && <p aria-live="polite">{notice}</p>}
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
    </main>
  );
}
