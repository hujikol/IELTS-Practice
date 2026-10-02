// P3-02/P3-03. The save queue's tested behaviours, plus the §8.4 timer rules that upstream
// got wrong: upstream derived time from wall clock on resume, which handed back free
// minutes after a reopen or a clock change. Here time only ever decreases, and a crash
// recovers paused at the last durable value.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyPatch,
  buildPatch,
  CHECKPOINT_INTERVAL_MS,
  isEmptyPatch,
  mergePatches,
  PatchError,
  Session,
  Timer,
  type Outbox,
  type Patch,
  type SaveResponse,
  type Transport,
} from '../src/lib/session.ts';
import { CommandError } from '../src/lib/attempts.ts';
import type { Block, Question, TestData } from '../src/lib/types.ts';

const question = (over: Partial<Question> = {}): Question => ({
  id: 'r0-0',
  section: 'reading',
  part: 1,
  topic: 'Archive history',
  stem: 'The archive was founded in',
  choices: ['1854', '1922', '1931'],
  correct: 2,
  explanation: 'The text states it directly.',
  skill: 'Reading: locating information',
  kind: 'choice',
  group: 0,
  number: 1,
  ...over,
});

const block = (questions: Question[]): Block => ({
  title: 'Archive history',
  text: 'The archive was founded in 1931 by a group of collectors.',
  questions,
});

const draft = (over: Partial<TestData> = {}): TestData => ({
  seed: 1,
  version: 2,
  scope: 'reading',
  practicePart: 1,
  prepared: ['r0'],
  listening: [],
  reading: [block([question(), question({ id: 'r0-1', number: 2, kind: 'gap', choices: [], answerText: '1931', accepted: ['1931'], maxWords: 1 })])],
  writing: [],
  speaking: [],
  answers: {},
  phase: 1,
  part: 0,
  group: 0,
  responses: {},
  texts: ['', ''],
  speakingTexts: ['', '', ''],
  times: [0, 3600, 0, 0],
  notes: ['', '', '', ''],
  marked: [],
  audioPlayed: [],
  recordings: {},
  ...over,
});

class MemoryOutbox implements Outbox {
  private store = new Map<string, Patch>();
  read(attemptId: string): Patch | null {
    const raw = this.store.get(attemptId);
    return raw ? (JSON.parse(JSON.stringify(raw)) as Patch) : null;
  }
  write(attemptId: string, patch: Patch | null): void {
    if (patch === null) this.store.delete(attemptId);
    else this.store.set(attemptId, JSON.parse(JSON.stringify(patch)) as Patch);
  }
  has(attemptId: string): boolean {
    return this.store.has(attemptId);
  }
}

/** Records what each save carried so a test can assert the exact patch sequence. */
const recorder = () => {
  const sent: Patch[] = [];
  let revision = 3;
  const transport: Transport = async (patch) => {
    sent.push(JSON.parse(JSON.stringify(patch)) as Patch);
    revision += 1;
    return { revision };
  };
  return { sent, transport, revision: () => revision };
};

// ─── Allowlist (§18.2) ───

test('a patch carrying material is refused rather than silently trimmed', () => {
  assert.throws(() => buildPatch({ listening: [] }), (e: unknown) => e instanceof PatchError && e.key === 'listening');
  assert.throws(() => buildPatch({ prepared: ['r0'] }), (e: unknown) => e instanceof PatchError && e.key === 'prepared');
  assert.throws(() => buildPatch({ id: 'a1' }), (e: unknown) => e instanceof PatchError && e.key === 'id');
  assert.throws(() => buildPatch({ owner: 'local' }), (e: unknown) => e instanceof PatchError && e.key === 'owner');
  assert.throws(() => buildPatch({ status: 'completed' }), (e: unknown) => e instanceof PatchError && e.key === 'status');
  assert.throws(() => buildPatch({ phase: 2 }), (e: unknown) => e instanceof PatchError && e.key === 'phase');
});

test('a patch smuggled inside an allowed key is still validated', () => {
  assert.throws(() => buildPatch({ responses: [{ id: 'r0-0' }] }), PatchError);
  assert.throws(() => buildPatch({ responses: { 'r0-0': { value: 'x' } } }), PatchError);
  assert.throws(() => buildPatch({ notes: 'a note' }), PatchError);
  assert.throws(() => buildPatch({ audioPlayed: 'yes' }), PatchError);
  assert.throws(() => buildPatch({ timer: { remaining: Number.NaN, running: false, checkpoint: 0 } }), PatchError);
  assert.throws(() => buildPatch({ timer: { remaining: 10, running: true } }), PatchError);
});

test('a negative or fractional remaining time is clamped, never rounded up', () => {
  assert.equal(buildPatch({ timer: { remaining: -5, running: false, checkpoint: 0 } }).timer?.remaining, 0);
  assert.equal(buildPatch({ timer: { remaining: 9.9, running: false, checkpoint: 0 } }).timer?.remaining, 9);
});

test('a patch with no allowed keys builds to nothing rather than a phantom save', () => {
  assert.equal(isEmptyPatch(buildPatch({})), true);
  assert.equal(isEmptyPatch(buildPatch(undefined)), true);
  assert.equal(isEmptyPatch(buildPatch({ responses: {} })), false);
});

// ─── Empty and zero values (§20.1 session inventory) ───

test('an emptied gap box is a real edit, not an absence', () => {
  const patch = buildPatch({ responses: { 'r0-1': '' } });
  assert.deepEqual(patch.responses, { 'r0-1': '' });
  const next = applyPatch(draft({ responses: { 'r0-1': 'museum' } }), patch);
  assert.equal(next.responses['r0-1'], '', 'score() renders the stored text verbatim');
});

test('clearing a choice question removes the answer instead of storing empty text', () => {
  // `''` stored against a choice question would make review read choices[Number('')] —
  // option A — as the student's answer.
  const next = applyPatch(draft({ responses: { 'r0-0': 2 } }), { responses: { 'r0-0': '' } });
  assert.equal(next.responses['r0-0'], undefined);
});

test('choice index 0 is a real answer and survives the queue', () => {
  const next = applyPatch(draft(), { responses: { 'r0-0': 0 } });
  assert.equal(next.responses['r0-0'], 0);
  assert.notEqual(next.responses['r0-0'], undefined);
});

test('an emptied note and an emptied essay survive merging', () => {
  const merged = mergePatches({ notes: ['', 'a', 'b'] }, { texts: ['essay'] });
  assert.equal(merged.texts?.[0], 'essay');
  assert.equal(merged.notes?.[0], '');
});

test('an out-of-range choice index is dropped, never stored', () => {
  const next = applyPatch(draft(), { responses: { 'r0-0': 7 } });
  assert.equal(next.responses['r0-0'], undefined);
});

// ─── Marks ───

test('marking and unmarking round-trips through the queue', () => {
  const q = recorder();
  const session = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport: q.transport });
  session.enqueue({ marked: ['r0-0', 'r0-1'] });
  assert.deepEqual(session.view().marked, ['r0-0', 'r0-1']);
  session.enqueue({ marked: ['r0-1'] });
  assert.deepEqual(session.view().marked, ['r0-1'], 'the latest list wins: an unmark removes the id');
});

test('marks for questions that do not exist are discarded', () => {
  const next = applyPatch(draft(), { marked: ['r0-0', 'ghost'] });
  assert.deepEqual(next.marked, ['r0-0']);
});

// ─── In-flight edits and outbox recovery ───

test('an edit made during a save is sent after it, not lost and not reordered', async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sent: Patch[] = [];
  let revision = 3;
  const transport: Transport = async (patch) => {
    sent.push(JSON.parse(JSON.stringify(patch)) as Patch);
    if (sent.length === 1) await gate;
    revision += 1;
    return { revision };
  };
  const session = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport });
  session.enqueue({ responses: { 'r0-0': 1 } });
  const flushing = session.flush();
  // Typed while the first patch is still on the wire.
  session.enqueue({ responses: { 'r0-1': 'museum' } });
  assert.deepEqual(session.view().responses, { 'r0-0': 1, 'r0-1': 'museum' });
  release();
  await flushing;

  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0]?.responses, { 'r0-0': 1 });
  assert.deepEqual(sent[1]?.responses, { 'r0-1': 'museum' });
  assert.deepEqual(session.view().responses, { 'r0-0': 1, 'r0-1': 'museum' });
  assert.equal(session.status, 'saved');
});

test('a failed save keeps the patch in the outbox and recovers it on reopen', async () => {
  const outbox = new MemoryOutbox();
  let attempts = 0;
  const transport: Transport = async () => {
    attempts += 1;
    if (attempts === 1) throw new CommandError({ code: 'no_space', message: 'No space left on device', retryable: true });
    return { revision: 9 };
  };
  const session = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport, outbox });
  session.enqueue({ responses: { 'r0-0': 2 } });
  await assert.rejects(session.flush(), /No space/);
  assert.equal(session.status, 'failed');
  assert.deepEqual(outbox.read('a1')?.responses, { 'r0-0': 2 });

  // Reopening the attempt replays the unsaved patch as unsaved work.
  const reopened = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport, outbox });
  assert.equal(reopened.status, 'unsaved');
  assert.deepEqual(reopened.view().responses, { 'r0-0': 2 });
  await reopened.flush();
  assert.equal(reopened.status, 'saved');
  assert.equal(outbox.has('a1'), false, 'a durable save clears the recovery outbox');
});

test('the view survives a failed save so the student never loses what they typed', async () => {
  const transport: Transport = async () => {
    throw new CommandError({ code: 'store_unavailable', message: 'Store unavailable', retryable: true });
  };
  const session = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport });
  session.enqueue({ texts: ['an essay'], notes: ['remember this'] });
  await assert.rejects(session.flush());
  assert.equal(session.view().texts[0], 'an essay');
  assert.equal(session.view().notes?.[0], 'remember this');
});

test('concurrent flushes drain once rather than sending the same patch twice', async () => {
  const q = recorder();
  const session = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport: q.transport });
  session.enqueue({ responses: { 'r0-0': 1 } });
  await Promise.all([session.flush(), session.flush()]);
  assert.equal(q.sent.length, 1);
  assert.equal(session.revision, 4);
});

// ─── Conflict: discard, never overwrite ───

test('a revision conflict discards the local patch instead of re-applying it', async () => {
  let calls = 0;
  const transport: Transport = async () => {
    calls += 1;
    throw new CommandError({
      code: 'revision_conflict',
      message: 'revision conflict',
      retryable: false,
      current_revision: 12,
    });
  };
  let discarded: Patch = {};
  const session = new Session({
    attemptId: 'a1',
    mode: 'untimed',
    data: draft(),
    revision: 3,
    transport,
    onConflict: (patch) => {
      discarded = patch;
    },
  });
  session.enqueue({ responses: { 'r0-0': 2 } });
  await session.flush();

  assert.equal(session.status, 'conflict');
  assert.equal(calls, 1, 'no blind retry against a revision the app has never seen');
  assert.deepEqual(discarded?.responses, { 'r0-0': 2 });
  assert.deepEqual(session.view().responses, {}, 'the stale snapshot is dropped, not merged over fresh state');
});

test('after a reload the authoritative record wins and only then may work be re-applied', async () => {
  let calls = 0;
  const transport: Transport = async () => {
    calls += 1;
    if (calls === 1) throw new CommandError({ code: 'revision_conflict', message: 'conflict', retryable: false, current_revision: 12 });
    return { revision: 14 };
  };
  const session = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport });
  session.enqueue({ responses: { 'r0-0': 2 } });
  await session.flush();

  session.adopt({ revision: 12, data: draft({ responses: { 'r0-0': 0, 'r0-1': 'museum' } }) });
  assert.deepEqual(session.view().responses, { 'r0-0': 0, 'r0-1': 'museum' });
  session.reapply({ responses: { 'r0-0': 1 } });
  assert.equal(session.view().responses['r0-0'], 1);
  assert.equal(session.view().responses['r0-1'], 'museum', 'the other question keeps the reload');
  await session.flush();
  assert.equal(session.status, 'saved');
});

// ─── Timer (§8.4 / §18.4) ───

test('time decreases only while the clock is running', () => {
  const t = new Timer(60, null, 0);
  assert.equal(t.running, false);
  assert.equal(t.tick(5_000), 0, 'a paused clock does not consume time');
  assert.equal(t.remainingSeconds, 60);
  t.resume(5_000);
  assert.equal(t.tick(10_000), 5_000);
  assert.equal(t.remainingSeconds, 55);
});

test('a pause freezes the clock and a later resume does not recount the gap', () => {
  const t = new Timer(60, null, 0);
  t.resume(0);
  t.tick(4_000);
  t.pause(4_000);
  const frozen = t.remainingSeconds;
  t.tick(60_000);
  assert.equal(t.remainingSeconds, frozen, 'a paused timer is inert');
  t.resume(60_000);
  t.tick(61_000);
  assert.equal(t.remainingSeconds, frozen - 1);
});

test('a wall-clock rollback cannot add time', () => {
  const t = new Timer(60, null, 10_000);
  t.resume(10_000);
  t.tick(20_000);
  const before = t.remainingSeconds;
  // The OS clock jumps backwards an hour. Nothing may be credited for it.
  t.tick(-3_400_000);
  assert.equal(t.remainingSeconds, before);
  t.tick(9_000);
  assert.equal(t.remainingSeconds, before, 'nor when the clock returns below the last reading');
  t.tick(20_000);
  assert.equal(t.remainingSeconds, before, 'nor when it catches up: no phantom hour is charged either');
  t.tick(25_000);
  assert.equal(t.remainingSeconds, before - 5, 'only genuine forward movement after the catch-up');
});

test('resume never recomputes a larger budget from wall-clock time', () => {
  const t = new Timer(100, { remaining: 40, running: true, checkpoint: 0 }, 0);
  assert.equal(t.remainingSeconds, 40);
  assert.equal(t.running, false, 'a persisted running state recovers paused (§18.4)');
  t.resume(0);
  assert.equal(t.remainingSeconds, 40);
  t.tick(86_400_000);
  assert.equal(t.remainingSeconds, 0, 'a day away must not restore the original 100 seconds');
});

test('a persisted remaining time above the budget is clamped down, never trusted up', () => {
  const t = new Timer(60, { remaining: 9_999, running: false, checkpoint: 0 }, 0);
  assert.equal(t.remainingSeconds, 60);
});

test('recovery after a crash resumes paused at the last durable remaining value', async () => {
  const outbox = new MemoryOutbox();
  const sent: Patch[] = [];
  let revision = 5;
  const transport: Transport = async (patch) => {
    sent.push(JSON.parse(JSON.stringify(patch)) as Patch);
    revision += 1;
    return { revision };
  };
  // A running attempt checkpoints to native, then the renderer dies between checkpoints.
  const running = new Session({ attemptId: 'a1', mode: 'timed', data: draft(), revision: 5, transport, outbox });
  running.setForeground(true, 0);
  running.tick(1_000);
  await running.tick(CHECKPOINT_INTERVAL_MS);
  await running.flush();
  const durable = sent.at(-1)?.timer;
  assert.ok(durable, 'a running timed attempt checkpoints its remaining time');
  assert.equal(outbox.has('a1'), false, 'the checkpoint was durably stored, so nothing is pending');

  // Native holds `durable`. §18.4 recovers paused at that value; the `running: true` the
  // record may carry is a hint about intent, not permission to keep counting.
  const reopened = new Session({
    attemptId: 'a1',
    mode: 'timed',
    data: draft(),
    revision,
    transport,
    outbox,
    timer: { ...durable, running: true },
  });
  assert.equal(reopened.timerRunning, false);
  assert.equal(reopened.timerRemaining, durable.remaining);
  reopened.setForeground(true, 100_000);
  assert.equal(reopened.timerRunning, true);
  assert.equal(reopened.timerRemaining, durable.remaining, 'resuming does not recompute from wall clock');
  reopened.tick(101_000);
  assert.equal(reopened.timerRemaining, durable.remaining - 1);
});

test('a running timer only reports itself due at five-second boundaries', () => {
  const t = new Timer(60, null, 0);
  t.resume(0);
  const due: number[] = [];
  for (let now = 250; now <= 20_000; now += 250) {
    t.tick(now);
    if (t.dueForCheckpoint(now)) {
      due.push(now);
      t.checkpoint(now);
    }
  }
  assert.deepEqual(due, [5_000, 10_000, 15_000, 20_000]);
});

test('each due checkpoint reaches native as its own write', async () => {
  // Spaced the way a real player ticks (250ms apart, with the async save in between), so
  // each interval boundary is a separate durable write rather than a coalesced one.
  const sent: Patch[] = [];
  const transport: Transport = async (patch) => {
    sent.push(JSON.parse(JSON.stringify(patch)) as Patch);
    return { revision: 3 + sent.length };
  };
  const session = new Session({ attemptId: 'a1', mode: 'timed', data: draft(), revision: 3, transport });
  // Gaining foreground is itself a checkpoint, then one more per five-second interval.
  session.setForeground(true, 0);
  await session.flush();
  for (let now = 250; now <= 20_000; now += 250) {
    session.tick(now);
    await session.flush();
  }
  const checkpoints = sent.filter((p) => p.timer);
  assert.equal(checkpoints.length, 1 + Math.floor(20_000 / CHECKPOINT_INTERVAL_MS));
  assert.deepEqual(
    checkpoints.map((p) => p.timer?.remaining),
    [3600, 3595, 3590, 3585, 3580],
  );
});

test('losing the foreground pauses and persists the checkpoint', async () => {
  const q = recorder();
  const session = new Session({ attemptId: 'a1', mode: 'timed', data: draft(), revision: 3, transport: q.transport });
  session.setForeground(true, 0);
  session.tick(1_000);
  session.setForeground(false, 1_000);
  await session.flush();
  assert.equal(session.timerRunning, false);
  const timer = q.sent.at(-1)?.timer;
  assert.equal(timer?.running, false);
  assert.equal(timer?.remaining, 3599);
});

test('save and exit leaves a paused, fully flushed state', async () => {
  const q = recorder();
  const session = new Session({ attemptId: 'a1', mode: 'timed', data: draft(), revision: 3, transport: q.transport });
  session.setForeground(true, 0);
  session.tick(2_000);
  session.enqueue({ responses: { 'r0-0': 1 } });
  await session.saveAndExit(2_000);
  assert.equal(session.status, 'saved');
  assert.equal(session.timerRunning, false);
  assert.equal(isEmptyPatch(session.outstanding()), true);
  assert.equal(q.sent.at(-1)?.timer?.running, false);
});

test('an untimed attempt never runs a clock or writes a timer checkpoint', () => {
  const q = recorder();
  const session = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport: q.transport });
  session.setForeground(true, 0);
  session.tick(60_000);
  session.checkpoint(60_000);
  assert.equal(isEmptyPatch(session.outstanding()), true);
  assert.equal(session.timerRunning, false);
});

test('remaining time is floored, never rounded up on the way to disk', () => {
  const t = new Timer(10, null, 0);
  t.resume(0);
  t.tick(1_500);
  assert.equal(t.remainingSeconds, 8, '8.5s must not be stored as 9s and hand back half a second');
  assert.equal(buildPatch({ timer: t.checkpoint(1_500) }).timer?.remaining, 8);
});

// ─── Player-facing helpers ───

test('mergePatches prefers the later edit per key but keeps untouched keys', () => {
  const merged = mergePatches(
    { responses: { 'r0-0': 1, 'r0-1': 'a' }, texts: ['first'], marked: ['r0-0'] },
    { responses: { 'r0-0': 2 }, notes: ['note'] },
  );
  assert.deepEqual(merged.responses, { 'r0-0': 2, 'r0-1': 'a' });
  assert.deepEqual(merged.texts, ['first']);
  assert.deepEqual(merged.marked, ['r0-0']);
  assert.deepEqual(merged.notes, ['note']);
});

test('applyPatch leaves the source TestData untouched', () => {
  const source = draft();
  const snapshot = JSON.stringify(source);
  applyPatch(source, { responses: { 'r0-0': 1 }, marked: ['r0-0'] });
  assert.equal(JSON.stringify(source), snapshot);
});

test('a transport that reports no revision is a failure, not a silent success', async () => {
  const transport: Transport = async () => ({ revision: undefined as unknown as number });
  const outbox = new MemoryOutbox();
  const session = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport, outbox });
  session.enqueue({ responses: { 'r0-0': 1 } });
  await assert.rejects(session.flush(), /did not report a saved revision/);
  // The edit is still the student's work and is still recoverable; nothing claims to be saved.
  assert.equal(session.status, 'failed');
  assert.equal(session.view().responses['r0-0'], 1);
  assert.deepEqual(outbox.read('a1')?.responses, { 'r0-0': 1 });
});

test('session state exposes what the player renders: data, status and remaining time', () => {
  const session = new Session({ attemptId: 'a1', mode: 'timed', data: draft(), revision: 3, transport: recorder().transport });
  session.setForeground(true, 0);
  session.tick(1_000);
  const state = session.state();
  assert.equal(state.status, 'unsaved');
  assert.equal(state.pending, true);
  assert.equal(state.timer.remaining, 3599);
  assert.deepEqual(state.data.responses, {});
});

test('subscribers receive the current state immediately and stop after unsubscribe', () => {
  const session = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport: recorder().transport });
  const seen: string[] = [];
  const off = session.subscribe((s) => seen.push(s.status));
  session.enqueue({ notes: ['x'] });
  off();
  session.enqueue({ notes: ['y'] });
  assert.deepEqual(seen, ['idle', 'unsaved']);
});

test('a save that reports saved data adopts it instead of guessing locally', async () => {
  const authoritative: TestData = draft({ responses: { 'r0-0': 1 } });
  let calls = 0;
  const transport: Transport = async (): Promise<SaveResponse> => {
    calls += 1;
    return { revision: 7, data: authoritative };
  };
  const session = new Session({ attemptId: 'a1', mode: 'untimed', data: draft(), revision: 3, transport });
  session.enqueue({ responses: { 'r0-0': 0 } });
  await session.flush();
  assert.equal(calls, 1);
  assert.equal(session.view().responses['r0-0'], 1, 'native is the authority on what was stored');
  assert.equal(session.revision, 7);
});