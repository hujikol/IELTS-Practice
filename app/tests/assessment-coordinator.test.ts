import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFinalReport, buildAttemptCapture } from '../src/lib/assessment-coordinator.ts';
import { emptyTest } from '../src/lib/material.ts';
import { sanitizeAttemptRecord, isWritingAttempted, isSpeakingAttempted, type AttemptRecord } from '../src/lib/attempts.ts';

test('assessment-coordinator: unattempted writing and speaking yields null bands', async () => {
  const data = emptyTest('full', 0, 'balanced', { provider: 'manual', model: 'mock', createdAt: Date.now() });
  const record: AttemptRecord = {
    id: 'test_att_1',
    owner_id: 'local',
    created_at: Date.now() - 3600000,
    updated_at: Date.now(),
    revision: 1,
    mode: 'untimed',
    status: 'completed',
    data,
    requests: {},
    imports: {},
    import_history: {},
  };

  const capture = buildAttemptCapture(record);
  assert.equal(capture.attempt_id, 'test_att_1');

  const report = await generateFinalReport(record, undefined, true);
  assert.equal(report.attempt_id, 'test_att_1');
  assert.equal(report.modules.writing?.band, null);
  assert.equal(report.modules.writing?.status, 'unattempted');
  assert.equal(report.modules.speaking?.band, null);
  assert.equal(report.modules.speaking?.status, 'unattempted');
  assert.equal(report.overall.band, null);
  assert.equal(report.overall.method, 'partial results (incomplete modules)');
});

test('assessment-coordinator: attempted writing yields calculated writing band', async () => {
  const data = emptyTest('full', 0, 'balanced', { provider: 'manual', model: 'mock', createdAt: Date.now() });
  data.texts[0] = 'The graph clearly demonstrates that over the twenty year period significant shifts occurred. The primary metric expanded while secondary variables declined consistently.';
  data.texts[1] = 'In modern society many people argue that environmental protection should be prioritized over economic development. I firmly agree with this view because long term survival depends on a sustainable environment.';

  const record: AttemptRecord = {
    id: 'test_att_2',
    owner_id: 'local',
    created_at: Date.now() - 3600000,
    updated_at: Date.now(),
    revision: 1,
    mode: 'untimed',
    status: 'completed',
    data,
    requests: {},
    imports: {},
    import_history: {},
  };

  const report = await generateFinalReport(record, undefined, true);
  assert.equal(report.modules.writing?.status, 'assessed');
  assert.ok(typeof report.modules.writing?.band === 'number');
  assert.ok(report.modules.writing!.band! > 0);
});

test('sanitizeAttemptRecord: clears fabricated writing and speaking scores from stale reports', () => {
  const data = emptyTest('full', 0, 'balanced', { provider: 'manual', model: 'mock', createdAt: Date.now() });
  assert.equal(isWritingAttempted(data), false);
  assert.equal(isSpeakingAttempted(data), false);

  // Simulate stale report with fabricated 4.0 and 6.5
  data.finalReport = {
    attempt_id: 'stale_1',
    test_id: 'test-stale_1',
    label: 'Estimated band, not an official IELTS result',
    confidence_notes: [],
    generated_at: new Date().toISOString(),
    overall: { band: 6.5, method: 'mean of 4 modules, IELTS rounding' },
    modules: {
      listening: { raw: 32, of: 40, band: 7.5 },
      reading: { raw: 30, of: 40, band: 7.0 },
      writing: { band: 4.0, task1: 4.0, task2: 4.0, confidence: 'high', status: 'assessed' },
      speaking: { band: 6.5, confidence: 'high', status: 'assessed' },
    },
    aggregates: {} as any,
    weakness_profile: { summary: '', weaknesses: [], strengths: [], seven_day_plan: [] },
    review: {
      listening: [],
      reading: [],
      writing: { tasks: [{ task: 1, band: 4.0 } as any] },
      speaking: { parts: [{ part: 1, transcript: '' } as any] },
    },
  };

  const record: AttemptRecord = {
    id: 'stale_1',
    owner_id: 'local',
    created_at: Date.now(),
    updated_at: Date.now(),
    revision: 1,
    mode: 'untimed',
    status: 'completed',
    data,
    requests: {},
    imports: {},
    import_history: {},
  };

  const sanitized = sanitizeAttemptRecord(record);
  assert.equal(sanitized.data.finalReport?.modules.writing?.band, null);
  assert.equal(sanitized.data.finalReport?.modules.writing?.status, 'unattempted');
  assert.equal(sanitized.data.finalReport?.review.writing.tasks.length, 0);

  assert.equal(sanitized.data.finalReport?.modules.speaking?.band, null);
  assert.equal(sanitized.data.finalReport?.modules.speaking?.status, 'unattempted');
  assert.equal(sanitized.data.finalReport?.review.speaking.parts.length, 0);

  assert.equal(sanitized.data.finalReport?.overall.band, null);
  assert.equal(sanitized.data.finalReport?.overall.method, 'partial results (incomplete modules)');
});
