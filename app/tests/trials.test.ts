import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gateReport, newTrialSession, recordTrial, renderEvidence, trialPrompt } from '../src/lib/trials.ts';
import { jobsFor } from '../src/lib/material.ts';
import type { PrepJob } from '../src/lib/types.ts';

// P1-08 harness. These tests verify the harness reports honestly — they are NOT
// generation trials. A fixture accepted here proves nothing about real model output.
const job = (key: string, section: PrepJob['section'], part: number): PrepJob => ({ key, label: key, section, part });

const session = () => {
  const s = newTrialSession('a-1', 'reading', 1);
  s.generationId = 'g-1';
  return s;
};

const envelope = (data: unknown, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    format_version: 1,
    attempt_id: 'a-1',
    job_key: 'r',
    generation_id: 'g-1',
    data,
    ...over,
  });

test('the harness refuses to report a ready gate with no trials', () => {
  const report = gateReport(session());
  assert.equal(report.total, 0);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((b) => b.includes('No trials recorded')));
});

test('the rendered trial prompt carries the real identity fields', () => {
  const s = session();
  const prompt = trialPrompt(s, s.test.jobs![0]!);
  assert.ok(prompt.includes('a-1'));
  assert.ok(prompt.includes('g-1'));
  assert.ok(prompt.includes('"r"'));
});

test('a trial prompt exists for every full-scope job', () => {
  const s = newTrialSession('a-9', 'full', 1);
  s.generationId = 'g-9';
  for (const j of jobsFor('full', 1)) {
    assert.ok(trialPrompt(s, j).length > 200, `${j.key} produced a suspiciously short prompt`);
  }
});

test('a failed response is recorded with its code, not thrown', async () => {
  const s = session();
  const result = await recordTrial(s, job('r', 'reading', 1), 'PROMPT', 'not json at all', {
    chat_label: 'test',
    repair_rounds: 0,
  });
  assert.equal(result.ok, false);
  assert.equal(s.outcomes.length, 1);
  assert.equal(s.outcomes[0]!.imported, false);
  assert.ok(s.outcomes[0]!.error_code);
});

test('an imported response is still unverified until a human reviews it', async () => {
  const s = session();
  const { readingBlock } = await import('./material.test.ts');
  const result = await recordTrial(s, job('r', 'reading', 1), 'PROMPT', envelope(readingBlock()), {
    chat_label: 'test',
    repair_rounds: 0,
  });
  assert.equal(result.ok, true);
  // Software acceptance is not educational acceptance.
  assert.equal(s.outcomes[0]!.human_reviewed, false);
  const report = gateReport(s);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((b) => b.includes('human answer-key review')));
});

test('the gate is only ready once every trial is imported AND human reviewed', async () => {
  const s = session();
  const { readingBlock } = await import('./material.test.ts');
  await recordTrial(s, job('r', 'reading', 1), 'PROMPT', envelope(readingBlock()), {
    chat_label: 'test',
    repair_rounds: 1,
  });
  s.outcomes[0]!.human_reviewed = true;
  const report = gateReport(s);
  assert.equal(report.ready, true);
  assert.equal(report.blockers.length, 0);
  assert.equal(report.maxRepairs, 1);
});

test('exceeding the two-repair budget blocks the gate', async () => {
  const s = session();
  await recordTrial(s, job('r', 'reading', 1), 'PROMPT', 'garbage', {
    chat_label: 'test',
    repair_rounds: 3,
  });
  const report = gateReport(s);
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((b) => b.includes('repair evaluation budget')));
});

test('a wrong attempt id is recorded as wrong_attempt, not as a material failure', async () => {
  const s = session();
  const result = await recordTrial(
    s,
    job('r', 'reading', 1),
    'PROMPT',
    envelope({}, { attempt_id: 'someone-else' }),
    { chat_label: 'test', repair_rounds: 0 },
  );
  assert.equal(result.ok, false);
  assert.equal(s.outcomes[0]!.error_code, 'wrong_attempt');
});

test('evidence output is redacted and never contains the response body', async () => {
  const s = session();
  const secret = 'a-very-distinctive-passage-sentence';
  await recordTrial(s, job('r', 'reading', 1), 'PROMPT', envelope({ text: secret, title: 'T' }), {
    chat_label: 'test',
    repair_rounds: 0,
  });
  const evidence = renderEvidence(s);
  assert.ok(evidence.includes('Phase 1 evidence'));
  assert.equal(evidence.includes(secret), false, 'evidence leaked model content');
  assert.ok(evidence.includes('| job |'));
});

test('evidence states plainly when no trials have been run', () => {
  const evidence = renderEvidence(session());
  assert.ok(evidence.includes('No trials recorded'));
  assert.ok(evidence.includes('_no trials yet_'));
});
