// §10.2 voice table. Every id below was parsed from the INSTALLED kokoro-js package
// (node_modules/kokoro-js/dist/kokoro.js), not guessed and not carried over from the
// upstream OpenAI-style names. Gender and accent come from that table too, so a British
// id is never labelled American.
//
// P2-01 findings from the installed package (node_modules/kokoro-js/dist/kokoro.js):
//
// 1. 17 voices ship: 9 American (ALL male) and 8 British (4 male, 4 female). There is
//    no American female voice, so a US male/female pair is impossible with this model.
//
// 2. Voice weights are fetched PER VOICE from
//    https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/<id>.bin
//    — one request per distinct voice, not one bundle. Using 17 voices means 17 fetches.
//
// 3. The same code path prefers a LOCAL file when a `readFile` capability is injected:
//    it resolves `../voices/<id>.bin` relative to the module and skips the network
//    entirely. That is the offline route: place the .bin files in that directory and
//    inject readFile. No fetch monkey-patching is required.
//
// Voice count therefore has a direct cost: every id used must be installed locally.
// This table deliberately keeps the used set small (4 pairs + 4 monologues + narrator).

export type Accent = 'British' | 'American';
export type VoiceGender = 'Male' | 'Female';

export type VoiceInfo = {
  id: string;
  name: string;
  accent: Accent;
  gender: VoiceGender;
};

export const VOICES: readonly VoiceInfo[] = [
  { id: 'bf_emma', name: 'Emma', accent: 'British', gender: 'Female' },
  { id: 'bf_isabella', name: 'Isabella', accent: 'British', gender: 'Female' },
  { id: 'bf_alice', name: 'Alice', accent: 'British', gender: 'Female' },
  { id: 'bf_lily', name: 'Lily', accent: 'British', gender: 'Female' },
  { id: 'bm_george', name: 'George', accent: 'British', gender: 'Male' },
  { id: 'bm_lewis', name: 'Lewis', accent: 'British', gender: 'Male' },
  { id: 'bm_daniel', name: 'Daniel', accent: 'British', gender: 'Male' },
  { id: 'bm_fable', name: 'Fable', accent: 'British', gender: 'Male' },
  { id: 'am_adam', name: 'Adam', accent: 'American', gender: 'Male' },
  { id: 'am_echo', name: 'Echo', accent: 'American', gender: 'Male' },
  { id: 'am_eric', name: 'Eric', accent: 'American', gender: 'Male' },
  { id: 'am_fenrir', name: 'Fenrir', accent: 'American', gender: 'Male' },
  { id: 'am_liam', name: 'Liam', accent: 'American', gender: 'Male' },
  { id: 'am_michael', name: 'Michael', accent: 'American', gender: 'Male' },
  { id: 'am_onyx', name: 'Onyx', accent: 'American', gender: 'Male' },
  { id: 'am_puck', name: 'Puck', accent: 'American', gender: 'Male' },
  { id: 'am_santa', name: 'Santa', accent: 'American', gender: 'Male' },
] as const;

export const VOICE_IDS = new Set(VOICES.map((v) => v.id));
const byId = new Map(VOICES.map((v) => [v.id, v]));

/** Narration is always the same British female voice: it is a teacher, not a character. */
export const NARRATOR_VOICE = 'bf_emma';

export const voiceInfo = (id: string): VoiceInfo | undefined => byId.get(id);

// A dialogue set needs one woman and one man.
export type DialogueSet = { id: string; woman: string; man: string };

export const DIALOGUE_SETS: readonly DialogueSet[] = [
  { id: 'uk-emma-george', woman: 'bf_emma', man: 'bm_george' },
  { id: 'uk-alice-daniel', woman: 'bf_alice', man: 'bm_daniel' },
  { id: 'uk-isabella-lewis', woman: 'bf_isabella', man: 'bm_lewis' },
  { id: 'uk-lily-fable', woman: 'bf_lily', man: 'bm_fable' },
] as const;

export const MONOLOGUE_VOICES = ['bm_george', 'am_adam', 'bm_lewis', 'am_fenrir'] as const;

/** Extended roster of high-quality Kokoro voices for randomized speaker generation */
export const RANDOM_FEMALE_VOICES = [
  { id: 'af_heart', name: 'Heart', accent: 'American' as Accent },
  { id: 'af_bella', name: 'Bella', accent: 'American' as Accent },
  { id: 'af_nicole', name: 'Nicole', accent: 'American' as Accent },
  { id: 'bf_emma', name: 'Emma', accent: 'British' as Accent },
  { id: 'bf_alice', name: 'Alice', accent: 'British' as Accent },
  { id: 'bf_isabella', name: 'Isabella', accent: 'British' as Accent },
  { id: 'bf_lily', name: 'Lily', accent: 'British' as Accent },
] as const;

export const RANDOM_MALE_VOICES = [
  { id: 'bm_george', name: 'George', accent: 'British' as Accent },
  { id: 'bm_daniel', name: 'Daniel', accent: 'British' as Accent },
  { id: 'bm_lewis', name: 'Lewis', accent: 'British' as Accent },
  { id: 'bm_fable', name: 'Fable', accent: 'British' as Accent },
  { id: 'am_michael', name: 'Michael', accent: 'American' as Accent },
  { id: 'am_adam', name: 'Adam', accent: 'American' as Accent },
  { id: 'am_fenrir', name: 'Fenrir', accent: 'American' as Accent },
  { id: 'am_eric', name: 'Eric', accent: 'American' as Accent },
] as const;

export type VoiceMapEntry = {
  set_id: string;
  kind: 'dialogue' | 'monologue';
  woman?: string;
  man?: string;
};

/**
 * Randomize speaker voices across all listening parts, guaranteeing distinct
 * female and male voice pairs for conversations and varied accents.
 */
export function randomizeVoiceMap(): Record<string, VoiceMapEntry> {
  const shuffledFemales = [...RANDOM_FEMALE_VOICES].sort(() => Math.random() - 0.5);
  const shuffledMales = [...RANDOM_MALE_VOICES].sort(() => Math.random() - 0.5);

  const p1Woman = shuffledFemales[0]!.id;
  const p1Man = shuffledMales[0]!.id;

  const p3Woman = shuffledFemales[1]!.id;
  const p3Man = shuffledMales[1]!.id;

  const p2Voice = Math.random() > 0.5 ? shuffledMales[2]!.id : shuffledFemales[2]!.id;
  const p4Voice = Math.random() > 0.5 ? shuffledMales[3]!.id : shuffledFemales[3]!.id;

  return {
    '1': { set_id: `custom-${p1Woman}-${p1Man}`, kind: 'dialogue', woman: p1Woman, man: p1Man },
    '2': { set_id: p2Voice, kind: 'monologue' },
    '3': { set_id: `custom-${p3Woman}-${p3Man}`, kind: 'dialogue', woman: p3Woman, man: p3Man },
    '4': { set_id: p4Voice, kind: 'monologue' },
  };
}

/** Get human-friendly label for a voice ID */
export function voiceDisplayName(voiceId: string): string {
  const all = [...VOICES, ...RANDOM_FEMALE_VOICES, ...RANDOM_MALE_VOICES];
  const found = all.find((v) => v.id === voiceId);
  if (!found) return voiceId;
  return `${found.name} (${found.accent === 'British' ? 'UK' : 'US'})`;
}

/**
 * Resolve the voice assignment for one attempt. Deterministic from the seed so a
 * retry renders identically and a reported audio bug is reproducible.
 *
 * §6.2: P1 and P3 are dialogues needing a woman and a man; P2 and P4 are monologues
 * needing exactly one speaker. P1 and P3 must differ, otherwise a learner hears the
 * same pair twice and learns nothing about speaker change.
 */
export function resolveVoiceMap(seed: number): Record<string, VoiceMapEntry> {
  const dialogue = DIALOGUE_SETS;
  const first = dialogue[seed % dialogue.length]!;
  // Offset guarantees a different set for P3 even when the modulus is small.
  const second = dialogue[(seed + 1 + (seed % (dialogue.length - 1))) % dialogue.length]!;
  return {
    '1': { set_id: first.id, kind: 'dialogue' },
    '2': { set_id: MONOLOGUE_VOICES[seed % MONOLOGUE_VOICES.length]!, kind: 'monologue' },
    '3': { set_id: second.id, kind: 'dialogue' },
    '4': { set_id: MONOLOGUE_VOICES[(seed + 2) % MONOLOGUE_VOICES.length]!, kind: 'monologue' },
  };
}

/** Resolve the actual voice id for a speaker in a part. */
export function voiceForPart(
  map: Record<string, VoiceMapEntry>,
  part: number,
  speaker: 'woman' | 'man' | 'narrator',
): string {
  if (speaker === 'narrator') return NARRATOR_VOICE;
  const entry = map[String(part)];
  if (!entry) return NARRATOR_VOICE;
  if (entry.kind === 'monologue') return entry.set_id;
  if (entry.woman && speaker === 'woman') return entry.woman;
  if (entry.man && speaker === 'man') return entry.man;
  const set = DIALOGUE_SETS.find((d) => d.id === entry.set_id);
  if (!set) return NARRATOR_VOICE;
  return speaker === 'woman' ? set.woman : set.man;
}
