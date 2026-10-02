// §7 transactional import. Nothing is written until the user has seen a preview of
// validated material: parse → envelope identity → staged apply → preview → commit.
//
// Every failure path leaves the previous accepted state untouched. A revision conflict
// discards the staged candidate rather than overwriting fresher server state.

import { parseEnvelopeInput } from './import.ts';
import { applyMaterial } from './material.ts';
import { ValidationError, type Envelope, type ErrorCode, type PrepJob, type TestData } from './types.ts';
import { canonicalSha256 } from './attempts.ts';

export type StagedCandidate = {
  job: PrepJob;
  envelope: Envelope;
  /** Fully validated clone. Never written until the user commits. */
  next: TestData;
  sha256: string;
  /** True when this job already holds accepted material, so commit needs confirmation. */
  replacing: boolean;
};

export type ImportFailure = { code: ErrorCode | string; message: string; path?: string; retryable: boolean };

const failure = (code: string, message: string, path?: string): ImportFailure => ({
  code,
  message,
  path,
  retryable: false,
});

const jobOf = (test: TestData, key: string): PrepJob | undefined =>
  test.jobs?.find((j) => j.key === key);

/**
 * Stage a candidate without mutating anything. Throws ImportFailure-shaped results so
 * the UI can show the validator's own message next to a "copy repair request" button.
 */
export async function stageImport(
  test: TestData,
  rawInput: string | Uint8Array,
  target: { attemptId: string; generationId: string },
): Promise<StagedCandidate> {
  let envelope: Envelope;
  try {
    envelope = parseEnvelopeInput(rawInput);
  } catch (e) {
    if (e instanceof ValidationError) throw failure(e.code, e.message, e.path);
    throw failure('parse_failed', 'That response could not be read as JSON.');
  }

  // §4.1 identity must equal the UI-selected attempt, job and CURRENT generation.
  // Membership in jobs alone is not enough — another valid job must also be refused.
  if (envelope.attempt_id !== target.attemptId) {
    throw failure('wrong_attempt', 'This response belongs to a different test. Copy the prompt again from this screen.');
  }
  if (envelope.generation_id !== target.generationId) {
    throw failure('stale_generation', 'This response answers an earlier prompt. Issue a new generation request and paste the new result.');
  }
  const job = jobOf(test, envelope.job_key);
  if (!job) {
    throw failure('unknown_job', `"${envelope.job_key}" is not one of this test's jobs.`);
  }

  // Validation runs on a clone; the caller's TestData is never touched.
  let next: TestData;
  try {
    next = applyMaterial(test, job, envelope.data);
  } catch (e) {
    if (e instanceof ValidationError) throw failure(e.code, e.message, e.path);
    throw failure('parse_failed', 'That material could not be validated.');
  }

  return {
    job,
    envelope,
    next,
    sha256: await canonicalSha256(envelope),
    replacing: (test.prepared ?? []).includes(job.key),
  };
}

/** §19 one screen: a discarded candidate must be explicit, never silently dropped. */
export type StagedState =
  | { status: 'empty' }
  | { status: 'staged'; candidate: StagedCandidate }
  | { status: 'failed'; failure: ImportFailure; rawInput: string };

export const emptyStaged = (): StagedState => ({ status: 'empty' });

/** Monotonic action counter so a callback from a cancelled attempt cannot publish. */
export class ActionCounter {
  private current = 0;
  next(): number {
    this.current += 1;
    return this.current;
  }
  isCurrent(token: number): boolean {
    return token === this.current;
  }
  cancel(): void {
    this.current += 1;
  }
}
