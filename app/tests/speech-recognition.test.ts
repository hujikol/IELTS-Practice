import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startLiveSpeechRecognition } from '../src/lib/speaking-recorder.ts';
import { buildPatch, mergePatches, applyPatch } from '../src/lib/session.ts';

type Handler = ((e: unknown) => void) | null;
type AnyEvent = Record<string, unknown>;

/** Fake Web Speech API that behaves like Chrome: the trailing final result arrives AFTER stop(). */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  onstart: Handler = null;
  onresult: ((e: { results: unknown[]; resultIndex: number }) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: Handler = null;
  onspeechstart: Handler = null;
  trailingFinal = '';
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    queueMicrotask(() => this.onstart?.({}));
  }
  stop() {
    setTimeout(() => {
      if (this.trailingFinal) this.emit([{ t: this.trailingFinal, final: true }]);
      this.onend?.({});
    }, 5);
  }
  emit(results: { t: string; final: boolean }[]) {
    const list = results.map((r) => Object.assign([{ transcript: r.t }], { isFinal: r.final }));
    this.onresult?.({ results: list, resultIndex: 0 });
  }
}

const install = () => {
  FakeRecognition.instances = [];
  (globalThis as unknown as AnyEvent).window = { SpeechRecognition: FakeRecognition };
  Object.defineProperty(globalThis, 'navigator', { value: { language: 'en-US' }, configurable: true });
};

test('stop() keeps the trailing final result delivered after stop()', async () => {
  install();
  const rec = startLiveSpeechRecognition(() => {});
  assert.ok(rec);
  const fake = FakeRecognition.instances[0]!;
  fake.emit([{ t: 'I live in Jakarta', final: false }]);
  fake.trailingFinal = 'I live in Jakarta and I work as a developer';
  const text = await rec!.stop();
  assert.equal(text, 'I live in Jakarta and I work as a developer');
});

test('interim-only speech is still returned on stop()', async () => {
  install();
  const rec = startLiveSpeechRecognition(() => {});
  FakeRecognition.instances[0]!.emit([{ t: 'hello there', final: false }]);
  assert.equal(await rec!.stop(), 'hello there');
});

test('text from an auto-restarted session is accumulated, not overwritten', async () => {
  install();
  const rec = startLiveSpeechRecognition(() => {});
  const first = FakeRecognition.instances[0]!;
  first.emit([{ t: 'first part', final: true }]);
  first.onend?.({}); // browser ends the session by itself -> restart
  assert.equal(FakeRecognition.instances.length, 2);
  FakeRecognition.instances[1]!.emit([{ t: 'second part', final: true }]);
  assert.equal(await rec!.stop(), 'first part second part');
});

test('fatal errors are reported and never restart the recogniser', async () => {
  install();
  const errors: string[] = [];
  const rec = startLiveSpeechRecognition(() => {}, (e) => errors.push(e));
  const fake = FakeRecognition.instances[0]!;
  fake.onerror?.({ error: 'not-allowed' });
  fake.onend?.({});
  assert.deepEqual(errors, ['not-allowed']);
  assert.equal(FakeRecognition.instances.length, 1);
  assert.equal(await rec!.stop(), '');
});

test('no-speech is harmless and does not surface as an error', async () => {
  install();
  const errors: string[] = [];
  startLiveSpeechRecognition(() => {}, (e) => errors.push(e));
  FakeRecognition.instances[0]!.onerror?.({ error: 'no-speech' });
  assert.deepEqual(errors, []);
});

test('restarts are capped when the engine never produces a result', () => {
  install();
  const errors: string[] = [];
  startLiveSpeechRecognition(() => {}, (e) => errors.push(e));
  for (let i = 0; i < 10; i++) FakeRecognition.instances[FakeRecognition.instances.length - 1]!.onend?.({});
  assert.ok(errors.includes('no-results'));
  assert.ok(FakeRecognition.instances.length <= 8);
});

test('unsupported browsers return null and report it', () => {
  (globalThis as unknown as AnyEvent).window = {};
  const errors: string[] = [];
  assert.equal(startLiveSpeechRecognition(() => {}, (e) => errors.push(e)), null);
  assert.deepEqual(errors, ['unsupported']);
});

test('recordings survive the patch allowlist, merge and apply', () => {
  const patch = buildPatch({ speakingTexts: ['a', 'b', 'c'], recordings: { p1_q0: { key: 'speaking_x_p1_qp1_q0_take1', duration: 12.5, createdAt: 1 } } });
  assert.equal(patch.recordings?.p1_q0?.key, 'speaking_x_p1_qp1_q0_take1');
  const merged = mergePatches(patch, buildPatch({ recordings: { p3_q0: { key: 'k3', duration: 3, createdAt: 2 } } }));
  assert.deepEqual(Object.keys(merged.recordings ?? {}).sort(), ['p1_q0', 'p3_q0']);
  const next = applyPatch({ responses: {}, listening: [], reading: [], texts: [], speakingTexts: [], recordings: {} } as unknown as Parameters<typeof applyPatch>[0], merged);
  assert.equal(Object.keys(next.recordings ?? {}).length, 2);
});

test('a recording without a storage key is refused', () => {
  assert.throws(() => buildPatch({ recordings: { p1_q0: { duration: 1, createdAt: 1 } } }));
});

