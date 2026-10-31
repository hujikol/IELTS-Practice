import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TTS_MODELS,
  getTtsModelPreference,
  setTtsModelPreference,
  getTtsDevicePreference,
  setTtsDevicePreference,
  isAudioModelCached,
  downloadAudioModelOnce,
  synthesizeSpeechAudio,
  getAudioClipCacheKey,
  checkTestAudioCacheStatus,
  type TtsModelType,
} from '../src/lib/audio-manager.ts';

test('TTS_MODELS covers all expected models including 16-bit FP16 with complete specification contracts', () => {
  const expected: TtsModelType[] = [
    'kokoro-fp32',
    'kokoro-fp16',
    'kokoro-q4f16',
    'kokoro-q8',
    'kokoro-q4',
    'webspeech',
  ];
  const keys = Object.keys(TTS_MODELS) as TtsModelType[];

  assert.equal(keys.length, 6, 'Expected exactly 6 TTS model configurations');
  for (const exp of expected) {
    assert.ok(exp in TTS_MODELS, `Missing TTS model definition: ${exp}`);
    const m = TTS_MODELS[exp];
    assert.ok(m.name && m.name.length > 0, `${exp} missing name`);
    assert.ok(m.badge && m.badge.length > 0, `${exp} missing badge`);
    assert.ok(m.minRam && m.minRam.length > 0, `${exp} missing minRam`);
    assert.ok(m.recRam && m.recRam.length > 0, `${exp} missing recRam`);
    assert.ok(m.minCpu && m.minCpu.length > 0, `${exp} missing minCpu`);
    assert.ok(m.recCpu && m.recCpu.length > 0, `${exp} missing recCpu`);
    assert.ok(m.downloadSize && m.downloadSize.length > 0, `${exp} missing downloadSize`);
    assert.ok(m.storageEstimate && m.storageEstimate.length > 0, `${exp} missing storageEstimate`);
    assert.ok(m.description && m.description.length > 0, `${exp} missing description`);
  }
});

test('getTtsModelPreference defaults to kokoro-fp32 and setTtsModelPreference persists changes including fp16', () => {
  // Ensure default
  assert.equal(getTtsModelPreference(), 'kokoro-fp32');

  // Change to fp16
  setTtsModelPreference('kokoro-fp16');
  assert.equal(getTtsModelPreference(), 'kokoro-fp16');

  // Change to q8
  setTtsModelPreference('kokoro-q8');
  assert.equal(getTtsModelPreference(), 'kokoro-q8');

  // Change to webspeech
  setTtsModelPreference('webspeech');
  assert.equal(getTtsModelPreference(), 'webspeech');

  // Revert back to default fp32
  setTtsModelPreference('kokoro-fp32');
  assert.equal(getTtsModelPreference(), 'kokoro-fp32');
});

test('webspeech model requires 0 MB download and is immediately considered cached', async () => {
  const cached = await isAudioModelCached('webspeech');
  assert.equal(cached, true, 'webspeech should always be immediately available');

  let progressCalled = false;
  const result = await downloadAudioModelOnce((pct, msg) => {
    progressCalled = true;
    assert.equal(pct, 100);
    assert.ok(msg.includes('Native Web Speech'));
  }, 'webspeech');

  assert.equal(result, null, 'webspeech does not instantiate an ONNX model instance');
  assert.equal(progressCalled, true);
});

test('synthesizeSpeechAudio returns an empty blob for empty text or webspeech', async () => {
  const emptyRes = await synthesizeSpeechAudio('', 'af_heart', 1.0);
  assert.equal(emptyRes.size, 0);

  const webSpeechRes = await synthesizeSpeechAudio('Hello candidate', 'af_heart', 1.0, 'webspeech');
  assert.equal(webSpeechRes.size, 0, 'webspeech returns empty blob for browser fallback');
});

test('getAudioClipCacheKey produces deterministic cache keys with model precision and voice', () => {
  const key1 = getAudioClipCacheKey('Hello world', 'af_heart', 1.0, 'kokoro-fp16');
  const key2 = getAudioClipCacheKey('Hello world', 'af_heart', 1.0, 'kokoro-fp16');
  const keyFp32 = getAudioClipCacheKey('Hello world', 'af_heart', 1.0, 'kokoro-fp32');

  assert.equal(key1, key2, 'identical input must produce identical key');
  assert.ok(key1.startsWith('kokoro_fp16_af_heart_1.00_'), 'must include dtype and voice');
  assert.ok(keyFp32.startsWith('kokoro_fp32_af_heart_1.00_'), 'must differentiate dtype');
});

test('checkTestAudioCacheStatus accurately reports missing audio when cache is cleared', async () => {
  // Test with webspeech -> never missing
  const wsStatus = await checkTestAudioCacheStatus(
    [{ script: [{ speaker: 'woman', text: 'Good morning, how can I help you?' }] }],
    {},
    'webspeech',
  );
  assert.equal(wsStatus.missingVoices, false);

  // Test with neural model when clips are not in IndexedDB -> missingVoices is true
  const neuralStatus = await checkTestAudioCacheStatus(
    [{ script: [{ speaker: 'woman', text: 'Good morning, how can I help you today at the sports centre?' }] }],
    {},
    'kokoro-fp16',
  );
  assert.equal(neuralStatus.totalLines, 1);
  assert.equal(neuralStatus.cachedLines, 0);
  assert.equal(neuralStatus.missingVoices, true);
});

test('getTtsDevicePreference defaults to webgpu and setTtsDevicePreference toggles to cpu and persists', () => {
  // Must default to webgpu
  assert.equal(getTtsDevicePreference(), 'webgpu', 'TTS compute must default to webgpu');

  // Change to cpu
  setTtsDevicePreference('cpu');
  assert.equal(getTtsDevicePreference(), 'cpu', 'Should toggle to cpu compute');

  // Switch back to webgpu
  setTtsDevicePreference('webgpu');
  assert.equal(getTtsDevicePreference(), 'webgpu', 'Should toggle back to webgpu compute');
});


