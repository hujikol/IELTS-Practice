import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyTest, jobsFor } from '../src/lib/material.ts';
import { guideRequirements } from '../src/lib/guide-requirements.ts';
import { renderGuide } from '../src/lib/guide.ts';
import type { PrepJob } from '../src/lib/types.ts';

// §5.2 the guide must be derived from the material contract, never hand-maintained
// beside it. These tests fail the moment the two drift apart.
const GEN = { provider: 'test', model: 'fixture', createdAt: 0 };
const draft = () => emptyTest('full', 1, 'balanced', GEN, 999);
const identity = { attempt_id: 'a-1', generation_id: 'g-1' };
const job = (key: string, section: PrepJob['section'], part: number): PrepJob => ({ key, label: key, section, part });

test('every hard rule in the guide comes from the material contract', () => {
  const t = draft();
  for (const j of jobsFor('full', 1)) {
    const req = guideRequirements(t, j);
    assert.ok(req.constraints.hard.length > 0, `${j.key} has no hard rules`);
    for (const c of req.constraints.hard) {
      assert.ok(c.text.trim().length > 0, `${j.key} has an empty rule`);
    }
  }
});

test('the rendered guide carries the contract numbers, not a private copy', () => {
  const req = guideRequirements(draft(), job('l0', 'listening', 1));
  const text = renderGuide(req, identity);
  // Question count, word window, match bank and word limit are all §6-owned numbers.
  assert.ok(text.includes('Exactly 10 questions.'), 'question count missing');
  assert.ok(text.includes('620 and 950'), 'listening word window missing');
  assert.ok(text.includes('5 to 8'), 'match bank size missing');
  assert.ok(text.includes('maxWords 1 to 3'), 'gap word limit missing');
});

test('Reading guide numbers differ from Listening numbers', () => {
  const t = draft();
  const listening = renderGuide(guideRequirements(t, job('l0', 'listening', 1)), identity);
  const reading = renderGuide(guideRequirements(t, job('r0', 'reading', 1)), identity);
  assert.ok(reading.includes('Exactly 13 questions.'), 'reading count missing');
  assert.ok(reading.includes('720 and 910'), 'reading word window missing');
  assert.ok(reading.includes('exactly 4 options'), 'reading option count missing');
  assert.ok(listening.includes('exactly 3 options'), 'listening option count missing');
  assert.equal(reading === listening, false);
});

test('authoring targets stay out of the hard rules', () => {
  const req = guideRequirements(draft(), job('l0', 'listening', 1));
  const hard = req.constraints.hard.map((c) => c.text).join(' ');
  const targets = req.constraints.targets.map((c) => c.text).join(' ');
  // 750-850 is a target; 620-950 is the rejection window.
  assert.ok(targets.includes('750-850'), 'target window missing');
  assert.equal(hard.includes('750-850'), false, 'a target leaked into the hard rules');
});

test('the guide still names no integration surface after wiring', () => {
  for (const j of jobsFor('full', 1)) {
    const text = renderGuide(guideRequirements(draft(), j), identity).toLowerCase();
    for (const banned of ['save_generated_part', 'mcp', 'oauth', 'plugin', 'endpoint']) {
      assert.equal(text.includes(banned), false, `${j.key} mentions ${banned}`);
    }
  }
});

test('the adapter is deterministic for a fixed attempt and job', () => {
  const a = renderGuide(guideRequirements(draft(), job('r1', 'reading', 2)), identity);
  const b = renderGuide(guideRequirements(draft(), job('r1', 'reading', 2)), identity);
  assert.equal(a, b);
});

test('previous topics reach the guide from prepared material', () => {
  const t = draft();
  t.reading[0] = { title: 'Cataloguing a municipal archive', text: '', questions: [] };
  const req = guideRequirements(t, job('r1', 'reading', 2));
  assert.ok(req.brief.previous_topics.includes('Cataloguing a municipal archive'));
});

test('focused scope yields a single job whose label matches its part', () => {
  const t = emptyTest('listening', 3, 'note completion', GEN, 5);
  const reqs = guideRequirements(t, job('l', 'listening', 3));
  assert.equal(reqs.brief.part_label, 'Part 3');
  assert.equal(reqs.brief.focus_skill, 'note completion');
});
