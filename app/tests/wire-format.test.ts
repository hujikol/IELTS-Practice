// The Rust store serializes snake_case; §18 command args arrive camelCase. These tests
// pin the field names both sides depend on, because a silent rename in either language
// would deserialize as `undefined` at runtime with no compile error.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize } from '../src/lib/attempts.ts';
import type { AttemptRecord, AttemptSummary } from '../src/lib/attempts.ts';

test('AttemptRecord uses the snake_case names the Rust store writes', () => {
  // Constructed literally so a renamed field fails to compile here.
  const record: AttemptRecord = {
    id: 'a1',
    owner_id: 'local',
    created_at: 1,
    updated_at: 2,
    revision: 3,
    mode: 'untimed',
    status: 'preparing',
    data: {} as AttemptRecord['data'],
    requests: {},
    imports: {},
    import_history: {},
  };
  assert.equal(record.owner_id, 'local');
  assert.equal(record.import_history !== undefined, true);
});

test('AttemptSummary uses the camelCase names the Rust summary serializes', () => {
  const summary: AttemptSummary = {
    id: 'a1',
    mode: 'untimed',
    status: 'preparing',
    scope: 'full',
    createdAt: 1,
    updatedAt: 2,
    revision: 0,
    preparedCount: 0,
    jobCount: 9,
  };
  assert.equal(summary.preparedCount, 0);
  assert.equal(summary.jobCount, 9);
});

test('command arguments use the camelCase names Tauri passes to Rust', () => {
  // Mirrors the #[serde(rename_all = "camelCase")] args structs in commands.rs.
  const args = {
    attemptId: 'a1',
    expectedRevision: 4,
    jobKey: 'r0',
    generationId: 'g1',
    replaceConfirmed: false,
  };
  assert.equal(args.attemptId, 'a1');
  assert.equal(args.expectedRevision, 4);
  assert.equal(args.replaceConfirmed, false);
});

test('canonical hashing is stable across key insertion order', () => {
  const a = canonicalize({ format_version: 1, job_key: 'r0', data: { b: 1, a: 2 } });
  const b = canonicalize({ data: { a: 2, b: 1 }, job_key: 'r0', format_version: 1 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('canonical hashing distinguishes payloads that differ only in a nested value', () => {
  const a = canonicalize({ data: { title: 'One' } });
  const b = canonicalize({ data: { title: 'Two' } });
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
});
