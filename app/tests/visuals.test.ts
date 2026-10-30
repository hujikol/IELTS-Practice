import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMaterial, emptyTest, rawBlockSchema, validateShape } from '../src/lib/material.ts';
import { extractPlaceName, publicTest, type RawWritingVisual } from '../src/lib/types.ts';
import { listeningBlock } from './material.test.ts';

const GEN = { provider: 'test', model: 'test', createdAt: 0 };

test('rawBlockSchema accepts block with visual and groups with visual', () => {
  const visual: RawWritingVisual = {
    type: 'process',
    caption: 'Campus Map & Plan Layout',
    columns: ['Zone', 'Coordinates'],
    rows: [
      ['A', '105,75'],
      ['B', '300,60'],
      ['C', '495,80'],
    ],
  };

  const raw = listeningBlock();
  raw.visual = visual;
  raw.groups[0]!.visual = visual;

  assert.doesNotThrow(() => validateShape(raw, rawBlockSchema, 'data'));
});

test('applyMaterial preserves visual on group and block', () => {
  const visual: RawWritingVisual = {
    type: 'process',
    caption: 'Sports Facility Layout Plan',
    columns: ['Zone', 'Location'],
    rows: [
      ['A', 'Entrance'],
      ['B', 'Squash Courts'],
      ['C', 'Gymnasium'],
    ],
  };

  const testData = emptyTest('full', 1, 'balanced', GEN, 12345);
  const job = { key: 'l1', label: 'Listening · Part 1', section: 'listening' as const, part: 1 };

  const raw = listeningBlock();
  raw.visual = visual;
  raw.groups[0]!.visual = visual;

  const updated = applyMaterial(testData, job, raw);
  const block = updated.listening[0];
  assert.ok(block);
  assert.ok(block.groups);
  assert.equal(block.groups[0]?.visual?.caption, 'Sports Facility Layout Plan');
  assert.equal(block.visual?.caption, 'Sports Facility Layout Plan');
});

test('publicTest hides listening script on all modes when test is in progress (!completed)', () => {
  const testData = emptyTest('full', 1, 'balanced', GEN, 12345);
  const job = { key: 'l1', label: 'Listening · Part 1', section: 'listening' as const, part: 1 };
  const raw = listeningBlock();

  const updated = applyMaterial(testData, job, raw);

  // In untimed mode during test (!completed):
  const publicUntimed = publicTest(updated, 'untimed', false);
  assert.equal(publicUntimed.listening[0]?.text, '', 'Untimed listening text must be blanked during test');
  assert.equal(publicUntimed.listening[0]?.script, undefined, 'Untimed listening script must be redacted during test');

  // In timed mode during test (!completed):
  const publicTimed = publicTest(updated, 'timed', false);
  assert.equal(publicTimed.listening[0]?.text, '', 'Timed listening text must be blanked during test');
  assert.equal(publicTimed.listening[0]?.script, undefined, 'Timed listening script must be redacted during test');

  // After test completion (completed = true for Review screen):
  const publicCompleted = publicTest(updated, 'untimed', true);
  assert.notEqual(publicCompleted.listening[0]?.text, '', 'Completed test exposes text for review');
  assert.ok(publicCompleted.listening[0]?.script?.length, 'Completed test exposes script for review');
});

test('extractPlaceName extracts clean place names from stems and questions', () => {
  assert.equal(extractPlaceName('Gift shop'), 'Gift shop');
  assert.equal(extractPlaceName('11. Gift shop'), 'Gift shop');
  assert.equal(extractPlaceName('Q12: Information desk'), 'Information desk');
  assert.equal(extractPlaceName('Where is the cafe located?'), 'Cafe');
  assert.equal(extractPlaceName('Which letter indicates the Picnic Area?'), 'Picnic Area');
  assert.equal(extractPlaceName('What is the location of the main reception?'), 'Main reception');
  assert.equal(extractPlaceName('The Library'), 'Library');
  assert.equal(extractPlaceName('Where is bicycle parking situated?'), 'Bicycle parking');
});
