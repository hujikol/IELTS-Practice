// §10.2 voice table. Every id below was parsed from the INSTALLED kokoro-js package
// (node_modules/kokoro-js/dist/kokoro.js), not guessed and not carried over from the
// upstream OpenAI-style names. Gender and accent come from that table too, so a British
// id is never labelled American.
//
// P2-01 finding: the package ships 17 voices, and **9 of the 9 en-us voices are male**.
// There is no US female voice at all. British is the only region with both genders
// (4 male, 4 female). Any plan that assumed a US male/female pair cannot be satisfied.

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

// A dialogue set needs one woman and one man. Only British satisfies that today.
export type DialogueSet = { id: string; woman: string; man: string };

export const DIALOGUE_SETS: readonly DialogueSet[] = [
  { id: 'uk-emma-george', woman: 'bf_emma', man: 'bm_george' },
  { id: 'uk-alice-daniel', woman: 'bf_alice', man: 'bm_daniel' },
  { id: 'uk-isabella-lewis', woman: 'bf_isabella', man: 'bm_lewis' },
  { id: 'uk-lily-fable', woman: 'bf_lily', man: 'bm_fable' },
] as const;

export const MONOLOGUE_VOICES = ['bm_george', 'am_adam', 'bm_lewis', 'am_fenrir'] as const;

/**
 * Resolve the voice assignment for one attempt. Deterministic from the seed so a
 * retry renders identically and a reported audio bug is reproducible.
 *
 * §6.2: P1 and P3 are dialogues needing a woman and a man; P2 and P4 are monologues
 * needing exactly one speaker. P1 and P3 must differ, otherwise a learner hears the
 * same pair twice and learns nothing about speaker change.
 */
export function resolveVoiceMap(seed: number): Record<string, { set_id: string; kind: 'dialogue' | 'monologue' }> {
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
  map: Record<string, { set_id: string; kind: 'dialogue' | 'monologue' }>,
  part: number,
  speaker: 'woman' | 'man' | 'narrator',
): string {
  if (speaker === 'narrator') return NARRATOR_VOICE;
  const entry = map[String(part)];
  if (!entry) return NARRATOR_VOICE;
  if (entry.kind === 'monologue') return entry.set_id;
  const set = DIALOGUE_SETS.find((d) => d.id === entry.set_id);
  if (!set) return NARRATOR_VOICE;
  return speaker === 'woman' ? set.woman : set.man;
}
