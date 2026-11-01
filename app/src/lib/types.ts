// Shared type contract. Owned centrally so parallel workstreams compile against one shape.
// Behavioral rules live in material.ts (validators) — this file is types only.

import type { MistakeTag, FinalReport, Attempt } from './scoring.ts';

export * from './bands.ts';
export * from './scoring.ts';

export type Section = 'listening' | 'reading';
export type Scope = 'full' | 'listening' | 'reading' | 'writing' | 'speaking';
export type QuestionKind = 'gap' | 'choice' | 'match' | 'tfng' | 'ynng';
export type Speaker = 'narrator' | 'woman' | 'man';

export type Question = {
  id: string;
  section: Section;
  part: number;
  topic: string;
  stem: string;
  choices: string[];
  correct: number;
  explanation: string;
  skill: string;
  kind?: QuestionKind;
  answerText?: string;
  accepted?: string[];
  group?: number;
  number?: number;
  maxWords?: number;
  evidence?: string;
  target_band?: number;
  common_mistake_tag?: MistakeTag;
  strategy_tip?: string;
  distractor_notes?: { option: string; why_tempting: string; why_wrong: string }[];
  paraphrase_map?: { question_wording: string; source_wording: string }[];
};

export type ScriptLine = { speaker: Speaker; text: string; group: number };

export type QuestionGroup = {
  title: string;
  instructions: string;
  start: number;
  end: number;
  visual?: WritingVisual | null;
};

export type Block = {
  title: string;
  text: string;
  questions: Question[];
  script?: ScriptLine[];
  groups?: QuestionGroup[];
  description?: string;
  voices?: Record<string, { voice: string; accent: string }>;
  visual?: WritingVisual | null;
};

export type Rubric = {
  band: number | null;
  criteria: { name: string; band: number; feedback: string }[];
  feedback: string;
  improvements: string[];
  transcript?: string;
  status?: 'assessed' | 'insufficient';
};

export type Recording = { key: string; duration: number; createdAt: number; assessment?: Rubric };

export type WritingVisual = {
  type?: 'table' | 'bar' | 'line' | 'process';
  caption: string;
  columns: string[];
  rows: string[][];
};

export type WritingTask = {
  title: string;
  prompt: string;
  minimum: number;
  visual?: WritingVisual | null;
};

export type SpeakingPart = { part: number; prompt: string; questions?: string[]; cue?: string[] };

export type SpeakingMode = 'practice' | 'exam';

export type SpeakingClip = {
  attempt_id: string;
  test_id?: string;
  part: number; // 0 (intro), 1, 2, 3
  question_id: string;
  take: number;
  duration_s: number;
  started_at: number;
  ended_at: number;
  end_reason: 'learner_next' | 'silence' | 'hard_cap' | 'timer';
  transcript?: string;
  blob?: Blob;
};

export type PrepJob = { key: string; label: string; section: Scope; part: number };

export type Wrong = {
  id: string;
  stem: string;
  selected: string;
  correct: string;
  explanation: string;
  skill: string;
  section: string;
  part: number;
  topic: string;
  passage: string;
  choices: string[];
  kind: string;
};

// §16.1/P3-04: objective bands are nullable. A focused set or absent section is
// unavailable, NOT zero. Zero is a real band and must never stand in for "no data".
export type SectionResult = { correct: number; band: number | null };

export type Result = {
  listening: SectionResult;
  reading: SectionResult;
  writing: { words: number[]; feedback: string[]; band?: number | null; assessments?: Rubric[] };
  speaking: { feedback: string; band?: number | null; assessments?: Rubric[] };
  overall?: number | null;
  weaknesses: { skill: string; wrong: number; total: number }[];
  wrong: Wrong[];
  note: string;
};

export type TestData = {
  seed: number;
  version?: number;
  scope?: Scope;
  focusSkill?: string;
  practicePart?: number;
  jobs?: PrepJob[];
  jobLocks?: Record<string, number>;
  prepared?: string[];
  part?: number;
  group?: number;
  recordings?: Record<string, Recording>;
  writingAssessments?: Rubric[];
  audioDurations?: number[];
  generation?: { provider: string; model: string; createdAt: number };
  materialReady?: boolean;
  audioProvider?: 'openai' | 'kokoro';
  chatgptFeedback?: Record<string, { feedback: string; createdAt: number; source: string }>;
  listening: Block[];
  reading: Block[];
  writing: WritingTask[];
  speaking: SpeakingPart[];
  answers: Record<string, number | string>;
  phase: number;
  responses: Record<string, number | string>;
  texts: string[];
  speakingTexts: string[];
  times: number[];
  notes?: string[];
  marked?: string[];
  audioPlayed?: boolean[];
  privacyWarnings?: number;
  result?: Result;
  finalReport?: FinalReport;
  attemptCapture?: Attempt;
};

// §4 canonical envelope. Exactly these five keys, no aliases.
export type Envelope = {
  format_version: 1;
  attempt_id: string;
  job_key: string;
  generation_id: string;
  data: unknown;
};

// ─── Raw model material ───
// §16.1: what a model is allowed to emit. Deliberately NOT Question/Block —
// no app ids, no section metadata, no answers state, no voices. The app assigns
// those after validation, which is what stops model output smuggling in state.

export type RawQuestion = {
  stem: string;
  kind: QuestionKind;
  choices: string[];
  correct: number;
  answerText: string;
  accepted: string[];
  maxWords: number;
  explanation: string;
  evidence: string;
  skill: string;
  group: number;
  target_band?: number;
  common_mistake_tag?: MistakeTag;
  strategy_tip?: string;
  distractor_notes?: { option: string; why_tempting: string; why_wrong: string }[];
  paraphrase_map?: { question_wording: string; source_wording: string }[];
};

/** No 'narrator': the app injects narration when building audio lines. */
export type RawScriptLine = { speaker: 'woman' | 'man'; text: string; group: number };

export type RawGroup = {
  title: string;
  instructions: string;
  start: number;
  end: number;
  visual?: RawWritingVisual | null;
};

export type RawBlock = {
  title: string;
  description?: string;
  text: string;
  groups: RawGroup[];
  questions: RawQuestion[];
  /** Reading must be exactly []; Listening carries the turns. */
  script: RawScriptLine[];
  visual?: RawWritingVisual | null;
};

export type RawWritingVisual = {
  type: 'table' | 'bar' | 'line' | 'process';
  caption: string;
  columns: string[];
  rows: string[][];
};

export type RawWritingTask = {
  title: string;
  prompt: string;
  minimum: number;
  visual: RawWritingVisual | null;
};

export type RawWriting = { tasks: RawWritingTask[] };
export type RawSpeakingPart = { part: number; prompt: string; questions: string[]; cue: string[] };
export type RawSpeaking = { parts: RawSpeakingPart[] };

export type RawMaterial =
  | { section: 'listening' | 'reading'; job: PrepJob; data: RawBlock }
  | { section: 'writing'; job: PrepJob; data: RawWriting }
  | { section: 'speaking'; job: PrepJob; data: RawSpeaking };

// ─── Error contract (§6.5, §18.1) ───
// Stable machine code + optional JSON path. Message is for humans; `code` is what
// tests and UI branch on. New rules get new codes rather than reusing old ones.
export type ErrorCode =
  // parse / envelope
  | 'parse_failed' | 'not_json' | 'multiple_fences' | 'fence_prose' | 'too_large'
  | 'bad_encoding' | 'depth_exceeded' | 'duplicate_key' | 'unsafe_key' | 'nul_byte'
  // shape
  | 'missing_key' | 'unknown_key' | 'bad_type' | 'bad_enum' | 'array_limit'
  | 'string_limit' | 'bad_number' | 'not_integer'
  // block level
  | 'question_count' | 'passage_length' | 'recording_length' | 'group_count'
  | 'group_numbering' | 'group_coverage' | 'group_index' | 'mixed_kind'
  | 'mixed_word_limit' | 'match_bank' | 'stem_quality' | 'choice_key'
  | 'choice_count' | 'gap_answer' | 'gap_variants' | 'answer_word_limit'
  | 'tfng_format' | 'ynng_format' | 'evidence' | 'title_quality'
  // listening specifics
  | 'script_empty' | 'script_turn_length' | 'script_group' | 'script_order'
  | 'missing_recording_group' | 'dialogue_speakers' | 'monologue_speakers'
  | 'narrator_in_script' | 'transcript_mismatch'
  // writing / speaking
  | 'writing_task_count' | 'writing_minimum' | 'writing_visual' | 'visual_rectangular'
  | 'visual_numeric' | 'writing_prompt' | 'speaking_parts' | 'speaking_count'
  | 'speaking_cue'
  // identity / lifecycle / store
  | 'bad_envelope_version' | 'wrong_attempt' | 'wrong_job' | 'stale_generation'
  | 'unknown_job' | 'not_preparing' | 'revision_conflict' | 'store_unavailable'
  | 'store_corrupt' | 'store_version_unsupported' | 'no_space' | 'permission_denied';

export type AppError = {
  code: ErrorCode;
  message: string;
  path?: string;
  retryable: boolean;
  /** Set on revision_conflict so the UI reloads instead of applying a stale snapshot. */
  current_revision?: number;
};

// Runtime error for validator/parser/import failures. `code` is the contract.
export class ValidationError extends Error {
  readonly code: ErrorCode;
  readonly path: string | undefined;
  readonly retryable = false;
  constructor(code: ErrorCode, message: string, path?: string) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
    this.path = path;
  }
  toAppError(): AppError {
    return { code: this.code, message: this.message, path: this.path, retryable: this.retryable };
  }
}

export const isValidationError = (e: unknown): e is ValidationError => e instanceof ValidationError;

export type Lifecycle = 'preparing' | 'active' | 'completed';

// §8.1 attempt record. owner_id is metadata, not access control.
export type AttemptRecord = {
  id: string;
  owner_id: 'local';
  created_at: number;
  updated_at: number;
  revision: number;
  mode: string;
  status: Lifecycle;
  data: TestData;
  // Per-job issued request state: snapshot + current generation id.
  requests: Record<string, JobRequest>;
  // Current accepted import per job, plus append-only audit history (§18.3).
  imports: Record<string, ImportRef>;
  import_history: Record<string, unknown[]>;
  voice_seed?: number;
  voice_map?: VoiceMap;
  timer?: { remaining: number; running: boolean; checkpoint: number };
};

export type JobRequest = {
  generation_id: string;
  issued_at: number;
  // Rendered prompt snapshot. Immutable: copy/repair reuse it verbatim, only rotation
  // replaces it. §18.3 — an upgrade must not reinterpret an old prompt under a new schema.
  snapshot: string;
  /** Material contract version at issue time. Import of an unsupported version is rejected. */
  contract_version?: number;
  envelope_version?: 1;
};

export type ImportRef = {
  sha256: string;
  accepted_at?: number;
  original_path: string;
  generation_id: string;
  contract_version?: number;
  envelope_version?: 1;
};

/** §18.3 ordered per-job audit history. Replacement appends; deletion is explicit only. */
export type ImportHistoryEntry = ImportRef & { superseded_at: number | null };

// §10.2: resolved actual voice ids, persisted once at attempt creation. Model output
// never writes these. Accent is truthful metadata, not a label derived from an id.
export type VoiceAssignment = { voice_id: string; accent: 'British' | 'American' };
export type VoiceSet = { id: string; woman: VoiceAssignment; man: VoiceAssignment };
export type VoiceMap = Record<string, { set_id: string; kind: 'dialogue' | 'monologue' }>;

export type StoreFile = {
  store_version: 1;
  attempts: Record<string, AttemptRecord>;
};

// ─── Native command payloads (§18.2) ───
// Proposed names, not assertions of existing Tauri APIs. Only these are bound.

export type CreateAttemptInput = {
  mode: 'timed' | 'untimed';
  scope: Scope;
  practice_part: number;
  focus_skill?: string;
};

export type IssueRequestInput = {
  attempt_id: string;
  expected_revision: number;
  job_key: string;
  rotate: boolean;
};

export type CommitImportInput = {
  attempt_id: string;
  expected_revision: number;
  job_key: string;
  generation_id: string;
  envelope: Envelope;
  raw_original: string;
  replace_confirmed: boolean;
};

export type SavePatchInput = {
  attempt_id: string;
  expected_revision: number;
  /** Allowlisted fields only. Native rejects anything outside this set. */
  patch: Partial<Pick<TestData, 'responses' | 'texts' | 'speakingTexts' | 'recordings' | 'notes' | 'marked' | 'audioPlayed' | 'audioDurations'>> & {
    timer?: { remaining: number; running: boolean; checkpoint: number };
  };
};

export type CommandResult<T> = { ok: true; revision: number; data: T } | { ok: false; error: AppError };

export const countWords = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);
export const halfBand = (n: number): number => Math.round(n * 2) / 2;

// §6.1: matching normalization only. Not paraphrase tolerance.
export function normalized(s: string): string {
  return s.trim().toLocaleLowerCase('en').replace(/[.,!?]/g, '').replace(/\s+/g, ' ');
}

export function questionCorrect(q: Question, value: unknown): boolean {
  if (q.kind === 'gap') {
    return (
      typeof value === 'string' &&
      (!q.maxWords || countWords(value) <= q.maxWords) &&
      (q.accepted?.length ? q.accepted : [q.answerText || q.choices[q.correct] || '']).some((v) =>
        normalized(value) === normalized(v),
      )
    );
  }
  return value === q.correct;
}

const LISTENING_THRESHOLDS: [number, number][] = [
  [39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5],
  [16, 5], [13, 4.5], [11, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1.5],
];
const READING_THRESHOLDS: [number, number][] = [
  [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5],
  [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1.5],
];

export function band(raw: number, section: Section): number {
  const t = section === 'listening' ? LISTENING_THRESHOLDS : READING_THRESHOLDS;
  return t.find(([minimum]) => raw >= minimum)?.[1] || 1;
}

// §11.2: focused sets show accuracy only. Full sections may show labelled estimates.
export function score(t: TestData): Result {
  const blocks = [...t.listening, ...t.reading];
  const all = blocks.flatMap((b) => b.questions);
  const isCorrect = (q: Question) => questionCorrect(q, t.responses[q.id]);
  const correct = (section: Section) => all.filter((q) => q.section === section && isCorrect(q)).length;
  const focused = t.scope !== undefined && t.scope !== 'full';

  const wrong: Wrong[] = all
    .filter((q) => !isCorrect(q))
    .map((q) => ({
      id: q.id,
      stem: q.stem,
      selected:
        t.responses[q.id] === undefined
          ? 'Unanswered'
          : q.kind === 'gap'
            ? String(t.responses[q.id])
            : q.choices[Number(t.responses[q.id])] || 'Unanswered',
      correct: q.kind === 'gap' ? q.answerText || q.choices[q.correct] || '' : q.choices[q.correct] || '',
      explanation: q.explanation,
      skill: q.skill,
      section: q.section,
      part: q.part,
      topic: q.topic,
      passage:
        blocks.find((b) => b.questions.includes(q))?.script?.map((l) => `${l.speaker}: ${l.text}`).join('\n\n') ||
        blocks.find((b) => b.questions.includes(q))?.text ||
        '',
      choices: q.choices,
      kind: q.kind || 'choice',
    }));

  const weaknesses = [...new Set(all.map((q) => q.skill))]
    .map((skill) => ({
      skill,
      total: all.filter((q) => q.skill === skill).length,
      wrong: wrong.filter((q) => q.skill === skill).length,
    }))
    .sort((a, b) => b.wrong / b.total - a.wrong / a.total);

  const words = t.texts.map((x) => (x.trim() ? x.trim().split(/\s+/).length : 0));
  const wa = t.writingAssessments || [];
  const sa = Object.keys(t.recordings || {})
    .sort()
    .map((k) => t.recordings![k]!.assessment)
    .filter(Boolean) as Rubric[];

  const wb =
    wa.filter(Boolean).length === t.writing.length && wa.length > 0 && wa.every((x) => x.band !== null)
      ? halfBand(wa.length === 2 ? (wa[0]!.band! + 2 * wa[1]!.band!) / 3 : wa[0]!.band!)
      : null;
  const sb =
    sa.length === t.speaking.length && sa.length > 0 && sa.every((x) => x.band !== null)
      ? halfBand(sa.reduce((n, x) => n + x.band!, 0) / sa.length)
      : null;

  // §11.2: no section band from a focused set, and never an invented overall.
  const lb = focused ? null : band(correct('listening'), 'listening');
  const rb = focused ? null : band(correct('reading'), 'reading');

  return {
    listening: { correct: correct('listening'), band: lb },
    reading: { correct: correct('reading'), band: rb },
    writing: {
      words,
      band: wb,
      assessments: wa,
      feedback: t.writing.map((w, i) =>
        wa[i]?.feedback ||
        (words[i] ? `Your ${words[i]}-word response is saved. AI assessment is pending.` : 'No response submitted.'),
      ),
    },
    speaking: {
      band: sb,
      assessments: sa,
      feedback:
        sb !== null
          ? 'Estimated from the recordings using fluency and coherence, vocabulary, grammar, and pronunciation.'
          : sa.length
            ? 'Partial speaking feedback is available. Every part needs an assessable recording for a section estimate.'
            : 'Recordings need audio assessment before a Speaking estimate is available.',
    },
    overall: focused || wb === null || sb === null || lb === null || rb === null ? null : halfBand((lb + rb + wb + sb) / 4),
    weaknesses,
    wrong,
    note: 'AI practice estimates, not official IELTS results. Generated questions are not standardised or examiner-calibrated. Focused sets show accuracy; full-section bands require a complete section.',
  };
}

// Redaction for the timed view. Local redaction prevents accidental spoilers,
// not inspection by a machine owner.
export function publicTest(t: TestData, _mode = 'untimed', completed = false) {
  const strip = (b: Block, listening = false) => ({
    ...b,
    ...(listening && !completed ? { text: '', script: undefined } : {}),
    questions: b.questions.map(({ correct, explanation, answerText, accepted, evidence, ...q }) => q),
  });
  const { answers, jobLocks, ...rest } = t;
  return {
    ...rest,
    listening: t.listening.map((b) => strip(b, true)),
    reading: t.reading.map((b) => strip(b)),
  };
}

/**
 * Extracts the clean place or facility name from a question stem,
 * stripping extraneous question wrappers (e.g. "Where is the...", "Which letter indicates the...").
 */
export function extractPlaceName(stem: string): string {
  if (!stem) return '';
  let s = stem.trim();
  s = s.replace(/^(Q?\d+[.:)-]\s*)/i, '').trim();
  s = s.replace(/^(where\s+(is|are)\s+(the\s+)?)/i, '');
  s = s.replace(/^(which\s+(letter|number|area|building|location|place|zone|pin)\s+(marks|represents|shows|indicates|is|is\s+the)\s+(the\s+)?)/i, '');
  s = s.replace(/^(what\s+is\s+the\s+location\s+of\s+(the\s+)?)/i, '');
  s = s.replace(/^(the\s+location\s+of\s+(the\s+)?)/i, '');
  s = s.replace(/^(label\s+for\s+(the\s+)?)/i, '');
  s = s.replace(/\s+(located|situated|found)\??$/i, '');
  s = s.replace(/\?+$/, '').trim();
  s = s.replace(/[.:-]+$/, '').trim();
  s = s.replace(/^the\s+/i, '');
  s = s.trim();
  if (!s) s = stem.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
