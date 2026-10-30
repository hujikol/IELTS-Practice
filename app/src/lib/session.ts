// §8.3/P3-02 practice save layer. The only code that writes practice state: the player
// calls enqueue/flush/tick, native owns the store. Behaviour is ported from the upstream
// SaveQueue (in-flight edits, outbox recovery, field-level merge) with the fetch transport
// replaced by an allowlisted native command.
//
// Two rules shape everything here:
//  1. A patch can carry answers, texts, notes, marks, playback state and a timer
//     checkpoint. Nothing else — no material, ids, owner, lifecycle or prepared state.
//  2. Time only ever decreases, and never by more than what the app itself observed.

import { CommandError, finishAttempt, savePatch } from './attempts.ts';
import { isValidationError, type Result, type TestData } from './types.ts';

export const PATCH_KEYS = [
  'responses',
  'texts',
  'speakingTexts',
  'notes',
  'marked',
  'audioPlayed',
  'audioDurations',
  'timer',
] as const;

export type PatchKey = (typeof PATCH_KEYS)[number];

export type TimerCheckpoint = { remaining: number; running: boolean; checkpoint: number };

export type Patch = {
  responses?: Record<string, string | number>;
  texts?: string[];
  speakingTexts?: string[];
  notes?: string[];
  marked?: string[];
  audioPlayed?: boolean[];
  audioDurations?: number[];
  timer?: TimerCheckpoint;
};

/** §18.2 keys a response save may never carry. Named so the refusal can quote the field. */
export const FORBIDDEN_PATCH_KEYS = [
  'material',
  'prepared',
  'listening',
  'reading',
  'writing',
  'speaking',
  'id',
  'owner',
  'owner_id',
  'status',
  'lifecycle',
  'revision',
  'phase',
  'part',
  'group',
  'times',
  'jobs',
  'requests',
  'imports',
  'import_history',
  'result',
] as const;

export class PatchError extends Error {
  readonly key: string;
  constructor(key: string, reason?: string) {
    super(
      `A response save cannot carry "${key}"${reason ? `: ${reason}` : ''}. ` +
        'Only answers, texts, notes, marks, playback state and the timer checkpoint may be saved.',
    );
    this.name = 'PatchError';
    this.key = key;
  }
}

// Upstream applyPatch bounds, kept so a malformed renderer value cannot inflate the store.
const LIMITS = { texts: 15000, speakingTexts: 6000, notes: 5000, responses: 150 } as const;

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const responseMap = (value: unknown, key: string): Record<string, string | number> => {
  if (!isPlain(value)) throw new PatchError(key, 'must be an object keyed by question id');
  const out: Record<string, string | number> = {};
  for (const [id, raw] of Object.entries(value)) {
    // An explicit undefined means "drop this key" — JSON would drop it anyway. Every
    // other value, including '' and 0, is a real edit and is kept.
    if (raw === undefined) continue;
    if (typeof raw === 'string') {
      out[id] = raw.slice(0, LIMITS.responses);
      continue;
    }
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      out[id] = raw;
      continue;
    }
    throw new PatchError(key, `"${id}" must be text or a choice index`);
  }
  return out;
};

const textArray = (value: unknown, key: string, max: number): string[] => {
  if (!Array.isArray(value)) throw new PatchError(key, 'must be an array');
  return value.map((v) => (typeof v === 'string' ? v.slice(0, max) : String(v ?? '')));
};

const boolArray = (value: unknown, key: string): boolean[] => {
  if (!Array.isArray(value)) throw new PatchError(key, 'must be an array');
  return value.map((v) => v === true);
};

const numberArray = (value: unknown, key: string): number[] => {
  if (!Array.isArray(value)) throw new PatchError(key, 'must be an array');
  return value.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0));
};

const checkpoint = (value: unknown, key: string): TimerCheckpoint => {
  if (!isPlain(value)) throw new PatchError(key, 'must be { remaining, running, checkpoint }');
  const remaining = value.remaining;
  const at = value.checkpoint;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) {
    throw new PatchError(key, 'remaining must be a finite number of seconds');
  }
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    throw new PatchError(key, 'checkpoint must be a finite timestamp');
  }
  // Floor, never round: rounding could hand back up to half a second on resume.
  return {
    remaining: Math.max(0, Math.floor(remaining)),
    running: value.running === true,
    checkpoint: Math.max(0, Math.floor(at)),
  };
};

/**
 * §18.2 allowlist. Unknown keys are refused outright rather than silently dropped, so a
 * caller that thinks it is saving material gets a loud failure instead of a no-op.
 */
export function buildPatch(input: unknown): Patch {
  if (input === undefined || input === null) return {};
  if (!isPlain(input)) throw new PatchError('patch', 'must be an object');
  const out: Patch = {};
  for (const key of Object.keys(input)) {
    if (!(PATCH_KEYS as readonly string[]).includes(key)) throw new PatchError(key);
    const value = input[key];
    if (value === undefined) continue;
    switch (key) {
      case 'responses':
        out.responses = responseMap(value, key);
        break;
      case 'texts':
        out.texts = textArray(value, key, LIMITS.texts);
        break;
      case 'speakingTexts':
        out.speakingTexts = textArray(value, key, LIMITS.speakingTexts);
        break;
      case 'notes':
        out.notes = textArray(value, key, LIMITS.notes);
        break;
      case 'marked':
        out.marked = textArray(value, key, 200);
        break;
      case 'audioPlayed':
        out.audioPlayed = boolArray(value, key);
        break;
      case 'audioDurations':
        out.audioDurations = numberArray(value, key);
        break;
      case 'timer':
        out.timer = checkpoint(value, key);
        break;
    }
  }
  return out;
}

const ARRAY_KEYS = ['texts', 'speakingTexts', 'notes', 'marked', 'audioPlayed', 'audioDurations'] as const;

const later = <K extends (typeof ARRAY_KEYS)[number]>(out: Patch, a: Patch, b: Patch, key: K): void => {
  // Presence, not truthiness: an empty array or empty string is an edit.
  if (Object.hasOwn(b, key)) out[key] = b[key];
  else if (Object.hasOwn(a, key)) out[key] = a[key];
};

/** Field-level merge. `b` wins per key; responses merge per question. */
export function mergePatches(a: Patch, b: Patch): Patch {
  const out: Patch = {};
  if (a.responses || b.responses) out.responses = { ...(a.responses ?? {}), ...(b.responses ?? {}) };
  for (const key of ARRAY_KEYS) later(out, a, b, key);
  if (Object.hasOwn(b, 'timer')) out.timer = b.timer;
  else if (Object.hasOwn(a, 'timer')) out.timer = a.timer;
  return out;
}

export function isEmptyPatch(patch: Patch): boolean {
  return !PATCH_KEYS.some((key) => Object.hasOwn(patch, key));
}

/**
 * Apply a patch to a clone. Never mutates the argument: the queue keeps `base` as the last
 * durable state and derives every render from base + inflight + pending.
 *
 * Array patches are merged per index against the current value, so a short array cannot
 * erase an untouched slot. `marked` is the exception: it carries the complete list of
 * flagged ids, because "unmark" is expressed by removing an id, not by a falsey entry.
 */
export function applyPatch(current: TestData, patch: Patch): TestData {
  const next: TestData = { ...current, responses: { ...current.responses } };
  const questions = [...current.listening, ...current.reading].flatMap((b) => b.questions);
  const byId = new Map(questions.map((q) => [q.id, q]));

  for (const [id, value] of Object.entries(patch.responses ?? {})) {
    const q = byId.get(id);
    if (!q) continue;
    // An emptied gap box is a real stored value: `score()` renders the text verbatim.
    if (q.kind === 'gap') {
      if (typeof value === 'string') next.responses[id] = value.slice(0, LIMITS.responses);
      continue;
    }
    if (typeof value === 'number') {
      // A choice index must actually exist in this question's options.
      if (Number.isInteger(value) && value >= 0 && value < q.choices.length) next.responses[id] = value;
      continue;
    }
    // Empty text for a choice question means "no option selected". Storing '' would make
    // review read `choices[Number('')]` — option A — as the student's answer, so the
    // honest encoding of a cleared radio is an absent key.
    if (value === '') delete next.responses[id];
  }

  const byIndex = (patched: string[], currentValues: string[]): string[] =>
    Array.from({ length: Math.max(currentValues.length, patched.length) }, (_, i) => patched[i] ?? currentValues[i] ?? '');

  if (patch.texts) next.texts = byIndex(patch.texts, current.texts);
  if (patch.speakingTexts) next.speakingTexts = byIndex(patch.speakingTexts, current.speakingTexts);
  if (patch.notes) next.notes = byIndex(patch.notes, current.notes ?? []);

  if (patch.marked) {
    const known = new Set(questions.map((q) => q.id));
    next.marked = [...new Set(patch.marked.filter((id) => known.has(id)))];
  }
  if (patch.audioPlayed) {
    // Once a Listening part has been played it stays played; a replay is not a rewind.
    next.audioPlayed = current.listening.map((_, i) => current.audioPlayed?.[i] === true || patch.audioPlayed![i] === true);
  }
  if (patch.audioDurations) {
    next.audioDurations = Array.from(
      { length: Math.max(current.audioDurations?.length ?? 0, patch.audioDurations.length) },
      (_, i) => patch.audioDurations![i] ?? current.audioDurations?.[i] ?? 0,
    );
  }
  // `timer` is intentionally not applied here: it lives on the Timer, not in TestData.
  return next;
}

// ─── §8.4 / §18.4 timer ───

// §18.4 checkpoints go out at most every five seconds, plus pause, navigation and finish.
//
// ponytail: a hard crash between checkpoints loses up to one interval (≤5s) of elapsed
// time, because recovery restores the last durable `remaining` and resumes paused. That is
// the deliberate practice-app ceiling stated in §18.4 — this is not secure exam timing.
// Upgrade path if it ever matters: persist a monotonic session start plus a wall-clock
// bound on `start_attempt`, so recovery can subtract the gap without ever trusting a
// larger budget; until then, losing ≤5s is strictly better than a clock rollback handing
// back minutes.
export const CHECKPOINT_INTERVAL_MS = 5000;

export type TimerState = TimerCheckpoint;

export class Timer {
  readonly budgetMs: number;
  private remainingMs: number;
  private runningFlag: boolean;
  private last: number;
  private lastCheckpointAt: number;

  constructor(budgetSeconds: number, state?: TimerState | null, now = 0) {
    this.budgetMs = Math.max(0, Math.floor(budgetSeconds)) * 1000;
    // A persisted state is never larger than the budget and never resumes running:
    // §18.4 recovery is paused at the last durable remaining time.
    const persisted = state && Number.isFinite(state.remaining) ? Math.floor(state.remaining) * 1000 : this.budgetMs;
    this.remainingMs = Math.min(this.budgetMs, Math.max(0, persisted));
    this.runningFlag = false;
    this.last = now;
    this.lastCheckpointAt = now;
  }

  get running(): boolean {
    return this.runningFlag;
  }

  get expired(): boolean {
    return this.remainingMs <= 0;
  }

  /** Whole seconds, always floored: rounding could add time on the next resume. */
  get remainingSeconds(): number {
    return Math.floor(this.remainingMs / 1000);
  }

  get remainingMsValue(): number {
    return this.remainingMs;
  }

  tick(now: number): number {
    if (!this.runningFlag) return 0;
    // §8.4 a backwards wall clock must not add time. Keeping the high-water mark means
    // the eventual catch-up measures from the last known-good reading, so neither the
    // rollback nor the catch-up is charged.
    if (now < this.last) return 0;
    const elapsed = now - this.last;
    this.last = now;
    this.remainingMs = Math.max(0, this.remainingMs - elapsed);
    return elapsed;
  }

  resume(now: number): void {
    // Resume continues from the durable remaining value. It never recomputes a budget
    // from elapsed wall-clock time, which is how a reopen used to hand back free minutes.
    if (this.expired) return;
    this.runningFlag = true;
    this.last = now;
  }

  pause(now: number): void {
    this.tick(now);
    this.runningFlag = false;
  }

  dueForCheckpoint(now: number): boolean {
    return this.runningFlag && now - this.lastCheckpointAt >= CHECKPOINT_INTERVAL_MS;
  }

  /** Marks the checkpoint as taken so the next one waits a full interval. */
  checkpoint(now: number): TimerState {
    this.lastCheckpointAt = now;
    return this.state();
  }

  /** `checkpoint` is the monotonic reading when the value was last taken, not wall clock. */
  state(): TimerState {
    return { remaining: this.remainingSeconds, running: this.runningFlag, checkpoint: this.lastCheckpointAt };
  }
}

export const totalBudget = (times: number[]): number => times.reduce((n, t) => n + (Number.isFinite(t) ? t : 0), 0);

// ─── Save queue ───

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'failed' | 'conflict';

export type SaveState = {
  data: TestData;
  status: SaveStatus;
  error: string;
  timer: TimerState;
  pending: boolean;
};

export type SaveResponse = { revision: number; data?: TestData };
export type Transport = (patch: Patch, revision: number, attemptId: string) => Promise<SaveResponse>;

export type Outbox = {
  read(attemptId: string): Patch | null;
  write(attemptId: string, patch: Patch | null): void;
};

export type SessionOptions = {
  attemptId: string;
  mode: 'timed' | 'untimed';
  data: TestData;
  revision: number;
  /** Persisted timer from the loaded attempt; absent on a never-started attempt. */
  timer?: TimerState | null;
  outbox?: Outbox;
  transport?: Transport;
  /** Called after a revision conflict with the patch that was NOT applied. */
  onConflict?: (discarded: Patch, error: CommandError) => void;
  onFinish?: (data: TestData, result: Result | null) => void;
};

/** §18.2 `save_patch`. Merges allowed fields only and rechecks the revision. */
export const nativeTransport: Transport = async (patch, revision, attemptId) => {
  const raw = await savePatch({ attemptId, expectedRevision: revision, patch });
  if (!raw || typeof raw.revision !== 'number') {
    throw new CommandError({
      code: 'store_unavailable',
      message: 'The attempt service did not report a saved revision. Nothing is confirmed as saved.',
      retryable: true,
    });
  }
  return { revision: raw.revision, data: raw.data };
};

const asCommandError = (e: unknown): CommandError => {
  if (e instanceof CommandError) return e;
  if (isValidationError(e)) return new CommandError(e.toAppError());
  const raw = e as { code?: string; message?: string; retryable?: boolean } | null;
  return new CommandError({
    code: raw?.code ?? 'store_unavailable',
    message: raw?.message ?? 'That change could not be saved. Your work is still on this device.',
    retryable: raw?.retryable ?? true,
  });
};

export class Session {
  readonly id: string;
  readonly mode: 'timed' | 'untimed';
  private base: TestData;
  private currentRevision: number;
  private inflight: Patch = {};
  private pending: Patch = {};
  private running: Promise<void> | null = null;
  private statusValue: SaveStatus = 'idle';
  private errorValue = '';
  private readonly timer: Timer;
  private readonly outbox: Outbox | undefined;
  private readonly transport: Transport;
  private readonly onConflict: ((patch: Patch, error: CommandError) => void) | undefined;
  private listeners = new Set<(state: SaveState) => void>();

  constructor(options: SessionOptions) {
    this.id = options.attemptId;
    this.mode = options.mode;
    this.base = options.data;
    this.currentRevision = options.revision;
    this.outbox = options.outbox;
    this.transport = options.transport ?? nativeTransport;
    this.onConflict = options.onConflict;
    this.timer = new Timer(totalBudget(options.data.times), options.timer ?? null);

    // §7.2 recovery outbox: a renderer crash between a keystroke and a durable write
    // leaves the patch here, and reopening the attempt replays it as unsaved work.
    const recovered = this.outbox?.read(this.id) ?? null;
    if (recovered && !isEmptyPatch(buildPatch(recovered))) {
      this.pending = buildPatch(recovered);
      this.statusValue = 'unsaved';
    }
  }

  get revision(): number {
    return this.currentRevision;
  }

  get status(): SaveStatus {
    return this.statusValue;
  }

  get error(): string {
    return this.errorValue;
  }

  subscribe(listener: (state: SaveState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state());
    return () => this.listeners.delete(listener);
  }

  state(): SaveState {
    return {
      data: this.view(),
      status: this.statusValue,
      error: this.errorValue,
      timer: this.timer.state(),
      pending: !isEmptyPatch(this.pending),
    };
  }

  view(): TestData {
    return applyPatch(this.base, mergePatches(this.inflight, this.pending));
  }

  /** The patch that would be sent next, inflight included. For tests and diagnostics. */
  outstanding(): Patch {
    return mergePatches(this.inflight, this.pending);
  }

  timerState(): TimerState {
    return this.timer.state();
  }

  get timerRemaining(): number {
    return this.timer.remainingSeconds;
  }

  get timerRunning(): boolean {
    return this.timer.running;
  }

  get timerExpired(): boolean {
    return this.timer.expired;
  }

  private publish(): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }

  private persistOutbox(): void {
    if (!this.outbox) return;
    const outstanding = this.outstanding();
    this.outbox.write(this.id, isEmptyPatch(outstanding) ? null : outstanding);
  }

  enqueue(patch: Patch): void {
    const built = buildPatch(patch);
    if (isEmptyPatch(built)) return;
    this.pending = mergePatches(this.pending, built);
    this.statusValue = 'unsaved';
    this.errorValue = '';
    this.persistOutbox();
    this.publish();
  }

  /**
   * §18.4 foreground-only decrement. Called from the player's interval with an explicit
   * clock so the cadence is testable and a paused clock is genuinely inert.
   */
  tick(now: number): number {
    if (this.mode !== 'timed') return 0;
    const elapsed = this.timer.tick(now);
    if (!this.timer.running) return 0;
    this.publish();
    if (this.timer.dueForCheckpoint(now)) {
      this.enqueue({ timer: this.timer.checkpoint(now) });
      // Checkpointing is the durability promise of §18.4, so it does not wait for the
      // player's own save cadence.
      void this.flush().catch(() => {});
    }
    return elapsed;
  }

  /** Losing the foreground pauses and persists. It never keeps running in the background. */
  setForeground(visible: boolean, now: number): void {
    if (this.mode !== 'timed') return;
    if (!visible) {
      if (!this.timer.running) return;
      this.timer.pause(now);
      this.enqueue({ timer: this.timer.checkpoint(now) });
      return;
    }
    this.timer.resume(now);
    this.enqueue({ timer: this.timer.checkpoint(now) });
  }

  /** Navigation and finish checkpoint without changing the run/pause state. */
  checkpoint(now: number): void {
    if (this.mode !== 'timed') return;
    this.enqueue({ timer: this.timer.checkpoint(now) });
  }

  /** §8.3 Save & exit: pause, flush the queue, return a paused durable state. */
  async saveAndExit(now: number): Promise<void> {
    if (this.mode === 'timed') {
      this.timer.pause(now);
      this.enqueue({ timer: this.timer.checkpoint(now) });
    }
    await this.flush();
    this.persistOutbox();
  }

  /** §18.2 `finish_attempt`. Results are computed by the app from the flushed state. */
  async finish(): Promise<Result | null> {
    if (this.mode === 'timed') {
      this.timer.pause(Date.now());
      this.enqueue({ timer: this.timer.checkpoint(Date.now()) });
    }
    await this.flush();
    const raw = await finishAttempt({ attemptId: this.id, expectedRevision: this.currentRevision });
    if (!raw || typeof raw.revision !== 'number' || !raw.data) {
      throw new CommandError({
        code: 'store_unavailable',
        message: 'The attempt service did not return a finished attempt. Your answers are still saved.',
        retryable: true,
      });
    }
    this.currentRevision = raw.revision;
    this.base = raw.data;
    this.inflight = {};
    this.pending = {};
    this.persistOutbox();
    this.statusValue = 'saved';
    this.publish();
    return raw.data.result ?? null;
  }

  async flush(): Promise<void> {
    if (this.running) {
      await this.running;
      if (!isEmptyPatch(this.pending)) return this.flush();
      return;
    }
    if (isEmptyPatch(this.pending)) return;
    this.running = this.drain();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  private async drain(): Promise<void> {
    while (!isEmptyPatch(this.pending)) {
      const sending = this.pending;
      this.pending = {};
      this.inflight = sending;
      this.statusValue = 'saving';
      this.publish();
      try {
        const result = await this.transport(sending, this.currentRevision, this.id);
        // §18.1 a save is only a save once it reports a persisted revision. Refusing here
        // keeps the invariant regardless of which transport is injected.
        if (!result || typeof result.revision !== 'number' || !Number.isFinite(result.revision)) {
          throw new CommandError({
            code: 'store_unavailable',
            message: 'The attempt service did not report a saved revision. Nothing is confirmed as saved.',
            retryable: true,
          });
        }
        this.currentRevision = result.revision;
        // Prefer the authoritative snapshot; fall back to a local apply if the command
        // returns only a revision.
        this.base = result.data ?? applyPatch(this.base, sending);
        this.inflight = {};
        this.errorValue = '';
        this.statusValue = 'saving';
        this.persistOutbox();
        this.publish();
        continue;
      } catch (e) {
        const error = asCommandError(e);
        this.inflight = {};
        if (error.isConflict) {
          // §18.1 a conflict means reload, not re-apply. The stale snapshot stays on this
          // side of the store; the patch is handed back so the user decides after the reload.
          const discarded = mergePatches(sending, this.pending);
          this.pending = {};
          this.errorValue = error.message;
          this.statusValue = 'conflict';
          this.persistOutbox();
          this.publish();
          this.onConflict?.(discarded, error);
          return;
        }
        // Retryable failure: the patch goes back to pending and stays in the outbox so a
        // later flush, or a reopen, still carries it.
        this.pending = mergePatches(sending, this.pending);
        this.errorValue = error.message;
        this.statusValue = 'failed';
        this.persistOutbox();
        this.publish();
        throw error;
      }
    }
    this.statusValue = this.statusValue === 'saving' ? 'saved' : this.statusValue;
    this.persistOutbox();
    this.publish();
  }

  /** §18.1 after the UI reloads: adopt the authoritative record and drop local edits. */
  adopt(record: { revision: number; data: TestData; timer?: TimerState | null }): void {
    this.base = record.data;
    this.currentRevision = record.revision;
    this.inflight = {};
    this.pending = {};
    this.errorValue = '';
    this.statusValue = 'saved';
    this.persistOutbox();
    this.publish();
  }

  /** §19 after a reload the user chose to keep their unsaved patch. */
  reapply(patch: Patch): void {
    this.enqueue(patch);
  }

  clearOutbox(): void {
    this.pending = {};
    this.inflight = {};
    this.persistOutbox();
  }
}