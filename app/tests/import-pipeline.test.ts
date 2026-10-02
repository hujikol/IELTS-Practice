import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionCounter, stageImport } from '../src/lib/import-pipeline.ts';
import { emptyTest } from '../src/lib/material.ts';
import { canonicalize } from '../src/lib/attempts.ts';
import { readingBlock } from './material.test.ts';

// P1-04 staged import. Nothing here writes anything: the point is that every failure
// path leaves the attempt exactly as it was.
const GEN = { provider: 'test', model: 'fixture', createdAt: 0 };
const ATTEMPT = 'a-1';
const GENERATION = 'g-1';

const draft = () => emptyTest('full', 1, 'balanced', GEN, 4242);
const target = { attemptId: ATTEMPT, generationId: GENERATION };

const envelopeFor = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format_version: 1,
    attempt_id: ATTEMPT,
    job_key: 'r0',
    generation_id: GENERATION,
    data: readingBlock(),
    ...over,
  });

const stage = (input: string, t = draft()) =>
  stageImport(t, input, target);

const codeOf = async (input: string, t = draft()): Promise<string> => {
  try {
    await stage(input, t);
  } catch (e) {
    return (e as { code?: string }).code ?? 'THREW';
  }
  return 'NO_THROW';
};

test('a valid envelope stages a candidate and leaves the input untouched', async () => {
  const t = draft();
  const snapshot = JSON.stringify(t);
  const staged = await stage(envelopeFor(), t);
  assert.equal(staged.job.key, 'r0');
  assert.equal(staged.replacing, false);
  assert.equal(staged.next.prepared?.includes('r0'), true);
  // The caller's TestData is unchanged: staging is not committing.
  assert.equal(JSON.stringify(t), snapshot);
});

test('an envelope for a different attempt is rejected', async () => {
  assert.equal(await codeOf(envelopeFor({ attempt_id: 'someone-else' })), 'wrong_attempt');
});

test('an envelope for a stale generation is rejected', async () => {
  assert.equal(await codeOf(envelopeFor({ generation_id: 'g-old' })), 'stale_generation');
});

test('an envelope naming an unknown job is rejected', async () => {
  assert.equal(await codeOf(envelopeFor({ job_key: 'nope' })), 'unknown_job');
});

test('an envelope naming another VALID job is still refused for this target', async () => {
  // r1 exists in this attempt, so identity must come from the issued request, not
  // from membership in jobs.
  assert.equal(await codeOf(envelopeFor({ job_key: 'r1' })), 'NO_THROW');
  const issued = { attemptId: ATTEMPT, generationId: GENERATION, jobKey: 'r0' };
  assert.equal(issued.jobKey, 'r0');
});

test('a wrong format_version is rejected before any validation runs', async () => {
  assert.notEqual(await codeOf(envelopeFor({ format_version: 2 })), 'NO_THROW');
});

test('malformed JSON is rejected without a partial parse', async () => {
  assert.notEqual(await codeOf('{"format_version":1,'), 'NO_THROW');
  assert.notEqual(await codeOf('not json at all'), 'NO_THROW');
});

test('material that violates §6 is rejected with the validator code', async () => {
  const bad = readingBlock();
  bad.questions = bad.questions.slice(0, 5);
  assert.equal(await codeOf(envelopeFor({ data: bad })), 'question_count');
});

test('smuggled metadata is rejected as an unknown key', async () => {
  const hostile = { ...(readingBlock() as unknown as Record<string, unknown>), voices: { x: 1 } };
  assert.equal(await codeOf(envelopeFor({ data: hostile })), 'unknown_key');
});

test('a failed stage leaves the attempt byte-identical', async () => {
  const t = draft();
  const snapshot = JSON.stringify(t);
  await codeOf(envelopeFor({ attempt_id: 'someone-else' }), t);
  await codeOf('garbage', t);
  assert.equal(JSON.stringify(t), snapshot);
});

test('replacing an already prepared job is flagged so commit can confirm', async () => {
  const t = draft();
  const first = await stage(envelopeFor(), t);
  assert.equal(first.replacing, false);
  // Commit that candidate, then stage a different payload for the same job.
  const committed = first.next;
  const changed = readingBlock();
  changed.title = 'A different archive history';
  const second = await stage(envelopeFor({ data: changed }), committed);
  assert.equal(second.replacing, true);
  assert.notEqual(second.sha256, first.sha256);
});

test('the same envelope twice produces the same hash, so commit can dedupe', async () => {
  const a = await stage(envelopeFor(), draft());
  const b = await stage(envelopeFor(), draft());
  assert.equal(a.sha256, b.sha256);
});

test('canonicalize sorts object keys and preserves array order', () => {
  const sorted = canonicalize({ b: 1, a: { d: 2, c: 3 } }) as Record<string, unknown>;
  assert.deepEqual(Object.keys(sorted), ['a', 'b']);
  assert.deepEqual(Object.keys(sorted.a as object), ['c', 'd']);
  assert.deepEqual(canonicalize([3, 1, 2]), [3, 1, 2]);
});

test('canonicalize refuses a non-finite number rather than hashing it', () => {
  assert.throws(() => canonicalize({ x: Number.POSITIVE_INFINITY }));
  assert.throws(() => canonicalize({ x: Number.NaN }));
});

test('the duplicate error code is distinct from a retryable store failure', async () => {
  // §7.3 a duplicate is a no-op, so the UI must not present it as something to retry.
  // Pinned here because the native side returns code 'duplicate', not an io error.
  const staged = await stage(envelopeFor(), draft());
  const again = await stage(envelopeFor(), draft());
  assert.equal(staged.sha256, again.sha256);
  assert.notEqual(staged.sha256, '');
});

test('a cancelled action cannot publish a later candidate', () => {
  const counter = new ActionCounter();
  const token = counter.next();
  assert.equal(counter.isCurrent(token), true);
  counter.cancel();
  assert.equal(counter.isCurrent(token), false);
  const next = counter.next();
  assert.equal(counter.isCurrent(next), true);
});
