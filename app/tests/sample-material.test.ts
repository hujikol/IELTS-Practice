import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBlock } from '../src/lib/material.ts';
import {
  CONVERSATIONAL_LISTENING_BLOCK,
  createConversationalListeningAttempt,
} from '../src/lib/sample-material.ts';
import { randomizeVoiceMap, voiceForPart } from '../src/lib/voices.ts';

test('sample-material: conversational listening block satisfies validateBlock', () => {
  assert.doesNotThrow(() => {
    validateBlock(CONVERSATIONAL_LISTENING_BLOCK, 'listening', 1);
  });
  assert.equal(CONVERSATIONAL_LISTENING_BLOCK.questions.length, 10);
  assert.equal(CONVERSATIONAL_LISTENING_BLOCK.groups.length, 2);

  const speakers = new Set(CONVERSATIONAL_LISTENING_BLOCK.script?.map((s) => s.speaker));
  assert.ok(speakers.has('woman'), 'must have woman speaker');
  assert.ok(speakers.has('man'), 'must have man speaker');
});

test('sample-material: creates ready-to-play attempt with 2-way conversation', async () => {
  const attempt = await createConversationalListeningAttempt('untimed');
  assert.equal(attempt.status, 'preparing');
  assert.equal(attempt.data.prepared?.includes('l0'), true);
  assert.equal(attempt.data.listening.length, 1);
  assert.equal(attempt.data.listening[0]?.questions.length, 10);
  assert.equal(attempt.data.listening[0]?.script?.length, 29);
});

test('voices: randomizeVoiceMap assigns valid distinct voices for conversations', () => {
  const randomized = randomizeVoiceMap();
  assert.equal(randomized['1']?.kind, 'dialogue');
  assert.equal(randomized['3']?.kind, 'dialogue');
  assert.equal(randomized['2']?.kind, 'monologue');
  assert.equal(randomized['4']?.kind, 'monologue');

  const p1Woman = voiceForPart(randomized, 1, 'woman');
  const p1Man = voiceForPart(randomized, 1, 'man');
  assert.notEqual(p1Woman, p1Man, 'dialogue speakers must differ');
  assert.ok(p1Woman.length > 0);
  assert.ok(p1Man.length > 0);
});
