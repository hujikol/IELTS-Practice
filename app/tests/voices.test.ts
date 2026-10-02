import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  DIALOGUE_SETS,
  MONOLOGUE_VOICES,
  NARRATOR_VOICE,
  VOICES,
  resolveVoiceMap,
  voiceForPart,
  voiceInfo,
} from '../src/lib/voices.ts';

// P2-01. These tests pin the voice table to the INSTALLED package rather than to
// assumption. If kokoro-js is upgraded or replaced, this fails loudly instead of
// shipping voice ids that do not exist.
const KOKORO = new URL('../node_modules/kokoro-js/dist/kokoro.js', import.meta.url);

const packageVoiceIds = (): Set<string> => {
  const src = readFileSync(KOKORO, 'utf8');
  const found = new Set<string>();
  for (const m of src.matchAll(/\b((?:am|bm|bf)_[a-z]+):\{name:"[^"]+",language:"([^"]+)",gender:"([^"]+)"/g)) {
    found.add(m[1]!);
  }
  return found;
};

test('every voice id exists in the installed kokoro package', () => {
  const available = packageVoiceIds();
  assert.ok(available.size > 0, 'could not parse the package voice table at all');
  for (const v of VOICES) {
    assert.ok(available.has(v.id), `${v.id} is not in the installed package`);
  }
});

test('the table covers the package exactly, with no invented entries', () => {
  const available = packageVoiceIds();
  assert.equal(VOICES.length, available.size, 'voice count drifted from the package');
});

test('accent metadata matches the package language code, not a guess', () => {
  const src = readFileSync(KOKORO, 'utf8');
  for (const v of VOICES) {
    const m = new RegExp(`${v.id}:\\{name:"[^"]+",language:"([^"]+)"`).exec(src);
    assert.ok(m, `${v.id} not found in package`);
    const expected = m[1] === 'en-gb' ? 'British' : m[1] === 'en-us' ? 'American' : null;
    assert.equal(v.accent, expected, `${v.id} accent is wrong`);
  }
});

test('P2-01 finding: the package has no American female voice', () => {
  const usFemale = VOICES.filter((v) => v.accent === 'American' && v.gender === 'Female');
  // This is a property of the upstream model, not a choice. If a future release adds
  // one, this test failing is the signal to add US dialogue sets.
  assert.equal(usFemale.length, 0);
  const britishBoth = VOICES.filter((v) => v.accent === 'British');
  assert.ok(britishBoth.some((v) => v.gender === 'Male'));
  assert.ok(britishBoth.some((v) => v.gender === 'Female'));
});

test('every dialogue set is one woman and one man, and the two differ', () => {
  for (const set of DIALOGUE_SETS) {
    assert.equal(voiceInfo(set.woman)?.gender, 'Female', `${set.id} woman`);
    assert.equal(voiceInfo(set.man)?.gender, 'Male', `${set.id} man`);
    assert.notEqual(set.woman, set.man, `${set.id} reuses one voice for both speakers`);
  }
});

test('Parts 1 and 3 resolve to different dialogue sets', () => {
  for (let seed = 0; seed < 40; seed++) {
    const map = resolveVoiceMap(seed);
    assert.equal(map['1']?.kind, 'dialogue');
    assert.equal(map['3']?.kind, 'dialogue');
    assert.notEqual(map['1']?.set_id, map['3']?.set_id, `seed ${seed} reused one pair for P1 and P3`);
  }
});

test('Parts 2 and 4 are monologues and resolve to a single voice', () => {
  const map = resolveVoiceMap(7);
  assert.equal(map['2']?.kind, 'monologue');
  assert.equal(map['4']?.kind, 'monologue');
  assert.ok((MONOLOGUE_VOICES as readonly string[]).includes(map['2']!.set_id));
});

test('the same seed always resolves identically, and different seeds usually differ', () => {
  assert.deepEqual(resolveVoiceMap(42), resolveVoiceMap(42));
  const variants = new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(resolveVoiceMap(i))));
  assert.ok(variants.size > 1, 'every seed produced the same assignment');
});

test('speaker resolution respects the part kind', () => {
  const map = resolveVoiceMap(3);
  // Dialogue: woman and man must differ.
  assert.notEqual(voiceForPart(map, 1, 'woman'), voiceForPart(map, 1, 'man'));
  // Monologue: both speaker labels resolve to the same single voice.
  assert.equal(voiceForPart(map, 2, 'woman'), voiceForPart(map, 2, 'man'));
});

test('narration always uses one fixed voice, never a character voice', () => {
  const map = resolveVoiceMap(11);
  for (const part of [1, 2, 3, 4]) {
    assert.equal(voiceForPart(map, part, 'narrator'), NARRATOR_VOICE);
  }
});

test('every resolved voice id is a real package voice', () => {
  const available = packageVoiceIds();
  for (let seed = 0; seed < 25; seed++) {
    const map = resolveVoiceMap(seed);
    for (const part of [1, 2, 3, 4]) {
      for (const speaker of ['woman', 'man', 'narrator'] as const) {
        const id = voiceForPart(map, part, speaker);
        assert.ok(available.has(id), `seed ${seed} part ${part} ${speaker} -> ${id}`);
      }
    }
  }
});
