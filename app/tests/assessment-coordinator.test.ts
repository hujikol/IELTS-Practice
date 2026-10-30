import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFinalReport, buildAttemptCapture } from '../src/lib/assessment-coordinator.ts';
import { emptyTest } from '../src/lib/material.ts';
import type { AttemptRecord } from '../src/lib/attempts.ts';

test('assessment-coordinator: unattempted writing and speaking yields null bands', async () => {
  const data = emptyTest('full', 0, 'balanced', { provider: 'manual', model: 'mock', createdAt: Date.now() });
  const record: AttemptRecord = {
    id: 'test_att_1',
    owner_id: 'user_1',
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
    owner_id: 'user_1',
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

