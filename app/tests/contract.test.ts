import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationError, band, normalized, score } from '../src/lib/types.ts';

// P0-03 gate: the shared contract compiles and behaves. P0-07 replaces this with
// the full §6 matrix; this exists so downstream agents have a runnable harness.
test('normalized collapses case, punctuation and whitespace', () => {
  assert.equal(normalized('  The  Quick, Brown! '), 'the quick brown');
});

test('band returns a real band, never a zero placeholder', () => {
  assert.equal(band(39, 'listening'), 9);
  assert.equal(band(0, 'reading'), 1);
});

test('focused set yields null objective bands, not zero (§16.1)', () => {
  const t = {
    seed: 1, scope: 'reading' as const, listening: [], reading: [], writing: [], speaking: [],
    answers: {}, phase: 0, responses: {}, texts: [''], speakingTexts: ['', '', ''],
    times: [1920, 3600, 3600, 840],
  };
  const r = score(t);
  assert.equal(r.listening.band, null);
  assert.equal(r.reading.band, null);
  assert.equal(r.overall, null);
});

test('ValidationError carries a machine code and converts to AppError', () => {
  const e = new ValidationError('group_coverage', 'Groups must tile 1..10.', 'data.groups');
  assert.equal(e.toAppError().code, 'group_coverage');
  assert.equal(e.toAppError().path, 'data.groups');
  assert.equal(e.toAppError().retryable, false);
});