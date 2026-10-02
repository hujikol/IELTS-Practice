// §3.2 pure material core. Bundles in browser and Node with no cloudflare:workers,
// Next, node:fs, Tauri, network or environment access. Everything a model may emit
// arrives here as `unknown` and leaves only after shape + semantic validation.
import {
  ValidationError,
  countWords,
  normalized,
  type Block,
  type PrepJob,
  type Question,
  type QuestionKind,
  type RawBlock,
  type RawGroup,
  type RawQuestion,
  type RawScriptLine,
  type RawSpeaking,
  type RawWriting,
  type Scope,
  type ScriptLine,
  type TestData,
  type WritingTask,
} from './types.ts';

// ─── Minimal schema descriptors ───
// No validation library is installed and none may be added (P0-04 constraint), so
// this is the whole schema system: enough to express "every key required, no extras".

type Schema =
  | { kind: 'obj'; props: Record<string, Schema> }
  | { kind: 'arr'; items: Schema }
  | { kind: 'str'; max?: number }
  | { kind: 'int' }
  | { kind: 'num' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'nullable'; inner: Schema };

const obj = (props: Record<string, Schema>): Schema => ({ kind: 'obj', props });
const arr = (items: Schema): Schema => ({ kind: 'arr', items });
const str = (max?: number): Schema => ({ kind: 'str', ...(max ? { max } : {}) });
const int: Schema = { kind: 'int' };
const enm = (values: readonly string[]): Schema => ({ kind: 'enum', values });

export const QUESTION_KINDS = ['gap', 'choice', 'match', 'tfng', 'ynng'] as const;
export const TFNG = ['TRUE', 'FALSE', 'NOT GIVEN'] as const;
export const YNNG = ['YES', 'NO', 'NOT GIVEN'] as const;
export const VISUAL_TYPES = ['table', 'bar', 'line', 'process'] as const;

// §6.1 upper safety limits. Field-specific bounds below are tighter and win.
const ARRAY_LIMIT = 100;
const STRING_LIMIT = 20_000;
const MAX_TURNS = 60;
const MAX_TURN_CHARS = 3500;
const MAX_GROUPS = 4;
const MIN_GROUPS = 2;
const MATCH_BANK_MIN = 5;
const MATCH_BANK_MAX = 8;

const questionSchema: Schema = obj({
  stem: str(),
  kind: enm(QUESTION_KINDS),
  choices: arr(str()),
  correct: int,
  answerText: str(),
  accepted: arr(str()),
  maxWords: int,
  explanation: str(),
  evidence: str(),
  skill: str(),
  group: int,
});

const scriptLineSchema: Schema = obj({
  speaker: enm(['woman', 'man'] as const),
  text: str(),
  group: int,
});

export const rawBlockSchema: Schema = obj({
  title: str(),
  description: str(),
  text: str(),
  groups: arr(obj({ title: str(), instructions: str(), start: int, end: int })),
  questions: arr(questionSchema),
  script: arr(scriptLineSchema),
});

export const rawWritingSchema: Schema = obj({
  tasks: arr(
    obj({
      title: str(),
      prompt: str(),
      minimum: int,
      visual: {
        kind: 'nullable',
        inner: obj({
          type: enm(VISUAL_TYPES),
          caption: str(),
          columns: arr(str()),
          rows: arr(arr(str())),
        }),
      },
    }),
  ),
});

export const rawSpeakingSchema: Schema = obj({
  parts: arr(obj({ part: int, prompt: str(), questions: arr(str()), cue: arr(str()) })),
});

// ─── Shape validation ───

/** §6.1 every declared property required, unknown properties rejected recursively. */
export function validateShape(value: unknown, schema: Schema, path = 'material'): void {
  switch (schema.kind) {
    case 'nullable':
      if (value === null) return;
      validateShape(value, schema.inner, path);
      return;
    case 'obj': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ValidationError('bad_type', `${path}: expected an object.`, path);
      }
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(schema.props)) {
        if (!Object.hasOwn(record, key)) {
          throw new ValidationError('missing_key', `${path}.${key} is required.`, `${path}.${key}`);
        }
        validateShape(record[key], schema.props[key]!, `${path}.${key}`);
      }
      for (const key of Object.keys(record)) {
        if (!Object.hasOwn(schema.props, key)) {
          throw new ValidationError('unknown_key', `${path}.${key} is not allowed.`, `${path}.${key}`);
        }
      }
      return;
    }
    case 'arr': {
      if (!Array.isArray(value)) {
        throw new ValidationError('bad_type', `${path}: expected an array.`, path);
      }
      if (value.length > ARRAY_LIMIT) {
        throw new ValidationError('array_limit', `${path}: more than ${ARRAY_LIMIT} items.`, path);
      }
      value.forEach((item, i) => validateShape(item, schema.items, `${path}[${i}]`));
      return;
    }
    case 'str': {
      if (typeof value !== 'string') {
        throw new ValidationError('bad_type', `${path}: expected text.`, path);
      }
      const max = schema.max ?? STRING_LIMIT;
      if (value.length > max) {
        throw new ValidationError('string_limit', `${path}: longer than ${max} characters.`, path);
      }
      return;
    }
    case 'int': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ValidationError('bad_number', `${path}: expected a number.`, path);
      }
      if (!Number.isInteger(value)) {
        throw new ValidationError('not_integer', `${path}: expected a whole number.`, path);
      }
      return;
    }
    case 'num': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ValidationError('bad_number', `${path}: expected a finite number.`, path);
      }
      return;
    }
    case 'enum': {
      if (typeof value !== 'string' || !schema.values.includes(value)) {
        throw new ValidationError(
          'bad_enum',
          `${path}: must be one of ${schema.values.join(', ')}.`,
          path,
        );
      }
      return;
    }
  }
}

// ─── Job construction (§4.3) ───

/** Full scope: l0-l3 = Listening P1-4, r0-r2 = Reading P1-3, w = both Writing, s = all Speaking. */
export function jobsFor(scope: Scope, part: number): PrepJob[] {
  if (scope === 'full') {
    return [
      ...Array.from({ length: 4 }, (_, i) => ({
        key: `l${i}`,
        label: `Listening · Part ${i + 1}`,
        section: 'listening' as Scope,
        part: i + 1,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        key: `r${i}`,
        label: `Reading · Passage ${i + 1}`,
        section: 'reading' as Scope,
        part: i + 1,
      })),
      { key: 'w', label: 'Writing · both tasks', section: 'writing' as Scope, part: 0 },
      { key: 's', label: 'Speaking · all parts', section: 'speaking' as Scope, part: 0 },
    ];
  }
  const initial = scope[0] as 'l' | 'r' | 'w' | 's';
  const label =
    scope === 'writing'
      ? `Writing · Task ${part}`
      : scope === 'speaking'
        ? `Speaking · Part ${part}`
        : scope === 'listening'
          ? `Listening · Part ${part}`
          : `Reading · Passage ${part}`;
  return [{ key: initial, label, section: scope, part }];
}

export const questionCountFor = (section: 'listening' | 'reading', part: number): number =>
  section === 'listening' ? 10 : part === 3 ? 14 : 13;

export const isFocused = (t: Pick<TestData, 'scope'>): boolean =>
  t.scope !== undefined && t.scope !== 'full';

/** §3.2 generation metadata is explicit. Never read a server model()/env here. */
export function emptyTest(
  scope: Scope,
  part: number,
  focusSkill: string,
  generation: { provider: string; model: string; createdAt: number },
  seed = crypto.getRandomValues(new Uint32Array(1))[0] as number,
): TestData {
  return {
    version: 2,
    seed,
    scope,
    practicePart: part,
    focusSkill,
    jobs: jobsFor(scope, part),
    prepared: [],
    listening: [],
    reading: [],
    writing: [],
    speaking: [],
    answers: {},
    phase: scope === 'full' ? 0 : (['listening', 'reading', 'writing', 'speaking'] as const).indexOf(scope),
    part: 0,
    group: 0,
    responses: {},
    texts: ['', ''],
    speakingTexts: ['', '', ''],
    times: [1920, 3600, 3600, 840],
    notes: ['', '', '', ''],
    marked: [],
    audioPlayed: [],
    privacyWarnings: 0,
    recordings: {},
    generation,
  };
}

// ─── Requirements brief (§5, transport-neutral) ───

export type Requirements = {
  job: PrepJob;
  schema: Schema;
  constraints: string[];
  targets: string[];
  brief: string;
};

const FORMATS: Record<'listening' | 'reading', string[]> = {
  listening: [
    'An everyday service or booking conversation between a woman and a man. Note/form completion with natural corrections to dates, prices or spellings.',
    'ONE speaker giving a social-context talk. Multiple choice plus matching with a shared option bank.',
    'A two-person academic discussion with nuanced disagreement and changing views. Multiple choice and matching.',
    'ONE speaker giving an academic lecture. Note or sentence completion.',
  ],
  reading: [
    'A narrative structure with an unexpected research finding.',
    'A comparison of competing explanations.',
    'Historical development with disputed interpretations.',
    'Problem-solution analysis with qualified conclusions.',
  ],
};

/**
 * §3.2/§5.2 the single source for schema, numeric constraints and prompt rule text.
 * The guide renderer formats this; it must never restate it separately.
 */
export function requirements(t: TestData, job: PrepJob): Requirements {
  const focused = isFocused(t);
  const part = job.section === 'listening' || job.section === 'reading' ? job.part : 0;
  const previousTopics = [...t.listening, ...t.reading]
    .filter(Boolean)
    .map((b) => b.title)
    .filter((title) => title.trim() !== '');

  if (job.section === 'listening' || job.section === 'reading') {
    const section = job.section;
    const count = questionCountFor(section, part);
    const constraints = [
      `Exactly ${count} questions.`,
      section === 'listening'
        ? 'Between 620 and 950 words of spoken script.'
        : 'Between 720 and 910 words of passage text.',
      `Between ${MIN_GROUPS} and ${MAX_GROUPS} question groups.`,
      `Groups must tile questions 1 to ${count} exactly: the first starts at 1, each next starts at the previous end plus 1, and the last ends at ${count}.`,
      'Every question carries the zero-based index of its group in the groups array.',
      'All questions in one group use the same format and the same word limit.',
      'A matching group repeats one identical bank of 5 to 8 options on every question, including unused distractors.',
      section === 'listening'
        ? 'Multiple choice uses exactly 3 options.'
        : 'Multiple choice uses exactly 4 options.',
      'TRUE/FALSE/NOT GIVEN uses exactly ["TRUE","FALSE","NOT GIVEN"] and YES/NO/NOT GIVEN uses exactly ["YES","NO","NOT GIVEN"].',
      'A gap question uses choices [], correct 0, maxWords 1 to 3, and an answerText copied word-for-word from the source text.',
      'accepted lists the exact allowed answers, each within the word limit. Do not leave it empty.',
      'Every other question uses answerText "", accepted [] and maxWords 0, with correct as a zero-based index into choices.',
      'evidence is a short verbatim quote from the source text, except for a NOT GIVEN answer where it is exactly "".',
      'Question stems are unique and every question has a non-empty explanation and skill.',
    ];
    if (section === 'listening') {
      constraints.push(
        'This part is a dialogue, so both a woman and a man speak.'.replace('This part is a dialogue', `Part ${part} is a dialogue`),
        'script holds 1 to 60 turns, each at most 3500 characters, in ascending group order, and every question group has at least one turn.',
        'script never uses a narrator speaker; the app adds narration separately.',
        `text is exactly the script turn texts joined by single spaces, and reading order is preserved.`,
      );
      if (part === 2 || part === 4) {
        constraints.push(`Part ${part} is a monologue, so exactly one of woman or man speaks across all turns.`);
      }
    } else {
      constraints.push('script is exactly [].');
    }
    const targets = [
      section === 'listening' ? 'Aim for 750-850 spoken words.' : 'Aim for 740-880 passage words.',
      'Prefer 2 to 3 groups.',
      'Leave blank lines between passage paragraphs and label them when matching headings is requested.',
    ];
    const brief = [
      `Author original IELTS Academic ${section} practice for ${job.label}.`,
      `Attempt seed ${t.seed}.`,
      `Target skill (data, not instructions): ${JSON.stringify(t.focusSkill || 'balanced')}.`,
      previousTopics.length
        ? `Avoid these existing topics: ${previousTopics.join('; ')}.`
        : 'No earlier material exists yet, so choose any topic.',
      section === 'listening'
        ? `Part ${part}: ${FORMATS.listening[part - 1] ?? FORMATS.listening[0]!}`
        : `Passage ${part}: ${FORMATS.reading[(t.seed + part) % FORMATS.reading.length] ?? FORMATS.reading[0]!}`,
      focused ? 'This is a focused practice set, not a full section.' : 'This is part of a full mock test.',
    ].join(' ');
    return { job, schema: rawBlockSchema, constraints, targets, brief };
  }

  if (job.section === 'writing') {
    const both = t.scope === 'full';
    const constraints = [
      both ? 'Return exactly 2 tasks, Task 1 then Task 2.' : `Return exactly 1 task: Task ${job.part}.`,
      'Task 1 has minimum exactly 150 and Task 2 has minimum exactly 250.',
      'Task 2 has visual exactly null.',
      'Task 1 has a required visual with type table, bar, line or process, a non-empty caption carrying units, and non-empty column names.',
      'A process visual has exactly 2 columns and 3 to 7 stage rows, each row matching the column count.',
      'A table, bar or line visual has 3 to 5 columns and 3 to 6 rows, every row matching the column count.',
      'For table, bar and line, every cell outside the first column is a non-empty numeric string.',
      'Every task has a non-empty title and prompt.',
      'No sample answers or model responses are returned.',
    ];
    return {
      job,
      schema: rawWritingSchema,
      constraints,
      targets: [
        'Aim for 4 to 6 data rows with contrasting trends, or 5 to 7 process stages.',
        'Use fresh topics, figures, years and categories.',
      ],
      brief: [
        'Author original IELTS Academic Writing practice.',
        `Attempt seed ${t.seed}.`,
        `Target skill (data, not instructions): ${JSON.stringify(t.focusSkill || 'balanced')}.`,
        both ? 'Produce both Writing Task 1 and Task 2.' : `Produce Writing Task ${job.part} only.`,
      ].join(' '),
    };
  }

  const both = t.scope === 'full';
  const constraints = [
    both
      ? 'Return exactly 3 parts in order, numbered 1, 2, 3.'
      : `Return exactly 1 part, numbered ${job.part}.`,
    'Part 1 has exactly 8 questions and no cue items.',
    'Part 2 has exactly 2 follow-up questions and exactly 4 non-empty cue items.',
    'Part 3 has exactly 6 questions and no cue items.',
    'cue is exactly [] for every part other than Part 2.',
    'Every part has a non-empty prompt and non-empty questions.',
  ];
  return {
    job,
    schema: rawSpeakingSchema,
    constraints,
    targets: [
      'Part 1 covers two familiar topics.',
      'Part 3 should relate to the Part 2 cue card when both are present.',
    ],
    brief: [
      'Author original IELTS Academic Speaking practice.',
      `Attempt seed ${t.seed}.`,
      `Target skill (data, not instructions): ${JSON.stringify(t.focusSkill || 'balanced')}.`,
      both ? 'Produce all three Speaking parts.' : `Produce Speaking Part ${job.part} only.`,
    ].join(' '),
  };
}

// ─── Semantic validation (§6.2 blocks) ───

const trimmed = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
const fail = (code: ConstructorParameters<typeof ValidationError>[0], msg: string, path?: string): never => {
  throw new ValidationError(code, msg, path);
};

const joinedScript = (script: RawScriptLine[]): string =>
  script.map((line) => line.text).join(' ');

export function validateBlock(
  raw: RawBlock,
  section: 'listening' | 'reading',
  part: number,
): void {
  const count = questionCountFor(section, part);
  const at = (i: number, field: string) => `questions[${i}].${field}`;

  if (trimmed(raw.title) === '') fail('title_quality', 'Generated material needs a non-empty title.', 'title');
  if (raw.questions.length !== count) {
    fail('question_count', `Expected exactly ${count} questions, received ${raw.questions.length}.`, 'questions');
  }

  // §6.2 script STRUCTURE is checked before the word window. An empty or blank turn
  // shortens the joined source, so measuring length first reported a blank turn as a
  // length failure and hid the real defect. Structure is the more specific error.
  if (section === 'listening') {
    if (raw.script.length < 1 || raw.script.length > MAX_TURNS) {
      fail('script_empty', `Script needs 1-${MAX_TURNS} turns, received ${raw.script.length}.`, 'script');
    }
    for (const [i, line] of raw.script.entries()) {
      if (trimmed(line.text) === '') {
        fail('script_empty', `Script turn ${i + 1} is empty.`, `script[${i}].text`);
      }
    }
  } else if (raw.script.length !== 0) {
    fail('script_empty', 'Reading material must have an empty script.', 'script');
  }

  // §6.2 the source for answers and evidence is the passage or the joined script.
  const source = section === 'listening' ? joinedScript(raw.script) : raw.text;
  const words = countWords(source);
  if (section === 'reading' && (words < 720 || words > 910)) {
    fail('passage_length', `Passage is ${words} words; the range is 720-910.`, 'text');
  }
  if (section === 'listening' && (words < 620 || words > 950)) {
    fail('recording_length', `Script is ${words} words; the range is 620-950.`, 'script');
  }

  // §6.2 groups: 2-4 (upstream allowed 1-4; this is deliberately stricter) and they
  // must tile 1..count with no gap and no overlap.
  if (raw.groups.length < MIN_GROUPS || raw.groups.length > MAX_GROUPS) {
    fail('group_count', `Expected ${MIN_GROUPS}-${MAX_GROUPS} question groups, received ${raw.groups.length}.`, 'groups');
  }
  let expectedStart = 1;
  raw.groups.forEach((group: RawGroup, gi) => {
    if (group.start !== expectedStart) {
      fail(
        'group_numbering',
        `Group ${gi + 1} starts at ${group.start} but should start at ${expectedStart}. Groups must tile 1-${count} with no gaps.`,
        `groups[${gi}].start`,
      );
    }
    if (group.end < group.start || group.end > count) {
      fail('group_numbering', `Group ${gi + 1} ends at ${group.end}, outside 1-${count}.`, `groups[${gi}].end`);
    }
    if (trimmed(group.title) === '' || trimmed(group.instructions) === '') {
      fail('group_numbering', `Group ${gi + 1} needs a non-empty title and instructions.`, `groups[${gi}]`);
    }
    for (let n = group.start; n <= group.end; n++) {
      if (raw.questions[n - 1]?.group !== gi) {
        fail('group_index', `Question ${n} must carry group index ${gi}.`, at(n - 1, 'group'));
      }
    }
    const inGroup = raw.questions.slice(group.start - 1, group.end);
    if (new Set(inGroup.map((q) => q.kind)).size !== 1) {
      fail('mixed_kind', `Group ${gi + 1} mixes question formats.`, `groups[${gi}]`);
    }
    if (inGroup[0]?.kind === 'gap' && new Set(inGroup.map((q) => q.maxWords)).size !== 1) {
      fail('mixed_word_limit', `Gap group ${gi + 1} mixes word limits.`, `groups[${gi}]`);
    }
    if (
      inGroup[0]?.kind === 'match' &&
      inGroup.some((q) => JSON.stringify(q.choices) !== JSON.stringify(inGroup[0]!.choices))
    ) {
      fail('match_bank', `Matching group ${gi + 1} must repeat one identical option bank.`, `groups[${gi}]`);
    }
    expectedStart = group.end + 1;
  });
  if (expectedStart !== count + 1) {
    fail('group_coverage', `Groups cover up to ${expectedStart - 1} but must cover 1-${count}.`, 'groups');
  }

  const normSource = normalized(source);
  const stems = new Set<string>();
  // §6.2 the empty-evidence exemption belongs to the question whose CORRECT ANSWER is
  // NOT GIVEN — index 2 of the exact legal literal — not to the format. Keying on the
  // format alone would excuse every tfng/ynng question, and keying on choices[2]
  // alone would excuse a malformed array such as ["FALSE","TRUE","NOT GIVEN"].
  const isNotGiven = (q: RawQuestion) =>
    q.correct === 2 &&
    ((q.kind === 'tfng' && q.choices.join('|') === TFNG.join('|')) ||
      (q.kind === 'ynng' && q.choices.join('|') === YNNG.join('|')));

  raw.questions.forEach((q, i) => {
    const stemKey = normalized(q.stem);
    if (trimmed(q.stem) === '') fail('stem_quality', `Question ${i + 1} has an empty stem.`, at(i, 'stem'));
    if (stems.has(stemKey)) fail('stem_quality', `Question ${i + 1} repeats an earlier stem.`, at(i, 'stem'));
    stems.add(stemKey);
    if (trimmed(q.explanation) === '') fail('stem_quality', `Question ${i + 1} needs an explanation.`, at(i, 'explanation'));
    if (trimmed(q.skill) === '') fail('stem_quality', `Question ${i + 1} needs a skill label.`, at(i, 'skill'));
    const kind = q.kind as QuestionKind;

    if (kind === 'gap') {
      if (q.choices.length !== 0 || q.correct !== 0) {
        fail('gap_answer', `Gap question ${i + 1} uses choices [] and correct 0.`, at(i, 'correct'));
      }
      if (q.maxWords < 1 || q.maxWords > 3) {
        fail('answer_word_limit', `Gap question ${i + 1} needs maxWords 1-3.`, at(i, 'maxWords'));
      }
      if (trimmed(q.answerText) === '') {
        fail('gap_answer', `Gap question ${i + 1} needs a non-empty answerText.`, at(i, 'answerText'));
      }
      if (countWords(q.answerText) > q.maxWords) {
        fail('answer_word_limit', `Gap question ${i + 1} answer exceeds ${q.maxWords} words.`, at(i, 'answerText'));
      }
      if (!normSource.includes(normalized(q.answerText))) {
        fail('gap_answer', `Gap question ${i + 1} answerText must appear word-for-word in the source text.`, at(i, 'answerText'));
      }
      // §6.2 variants are never auto-populated; an empty or overlong one is rejected.
      if (q.accepted.length === 0) {
        fail('gap_variants', `Gap question ${i + 1} needs at least one accepted answer.`, at(i, 'accepted'));
      }
      if (!q.accepted.some((a) => normalized(a) === normalized(q.answerText))) {
        fail('gap_variants', `Gap question ${i + 1} accepted list must contain its answerText.`, at(i, 'accepted'));
      }
      for (const variant of q.accepted) {
        if (trimmed(variant) === '') {
          fail('gap_variants', `Gap question ${i + 1} has an empty accepted variant.`, at(i, 'accepted'));
        }
        if (countWords(variant) > q.maxWords) {
          fail('answer_word_limit', `Gap question ${i + 1} accepted variant exceeds ${q.maxWords} words.`, at(i, 'accepted'));
        }
      }
    } else {
      if (q.answerText !== '' || q.accepted.length !== 0 || q.maxWords !== 0) {
        fail('choice_key', `Question ${i + 1} is not a gap, so answerText is "", accepted [] and maxWords 0.`, at(i, 'answerText'));
      }
      // §6.2 tfng/ynng have a fixed literal array, so their option count is already
      // implied by the format check below. Routing them through the generic
      // multiple-choice count rejected a perfectly legal 3-option tfng array.
      const literalFormat = kind === 'tfng' || kind === 'ynng';
      const expectedOptions = kind === 'match' || literalFormat ? MATCH_BANK_MAX : section === 'listening' ? 3 : 4;
      if (kind !== 'match' && !literalFormat && (q.choices.length !== expectedOptions || q.choices.length < 3)) {
        fail(
          'choice_count',
          `Question ${i + 1} needs exactly ${expectedOptions} options, received ${q.choices.length}.`,
          at(i, 'choices'),
        );
      }
      if (q.choices.length < 3) {
        fail('choice_count', `Question ${i + 1} needs at least 3 options.`, at(i, 'choices'));
      }
      if (q.choices.some((c) => trimmed(c) === '')) {
        fail('choice_count', `Question ${i + 1} has an empty option.`, at(i, 'choices'));
      }
      if (new Set(q.choices.map((c) => normalized(c))).size !== q.choices.length) {
        fail('choice_count', `Question ${i + 1} repeats an option.`, at(i, 'choices'));
      }
      if (q.correct < 0 || q.correct >= q.choices.length) {
        fail('choice_key', `Question ${i + 1} correct index ${q.correct} is outside its options.`, at(i, 'correct'));
      }
      if (kind === 'match' && (q.choices.length < MATCH_BANK_MIN || q.choices.length > MATCH_BANK_MAX)) {
        fail('match_bank', `Matching question ${i + 1} needs a bank of ${MATCH_BANK_MIN}-${MATCH_BANK_MAX} options.`, at(i, 'choices'));
      }
      if (kind === 'tfng' && q.choices.join('|') !== TFNG.join('|')) {
        fail('tfng_format', `Question ${i + 1} must use exactly ["TRUE","FALSE","NOT GIVEN"].`, at(i, 'choices'));
      }
      if (kind === 'ynng' && q.choices.join('|') !== YNNG.join('|')) {
        fail('ynng_format', `Question ${i + 1} must use exactly ["YES","NO","NOT GIVEN"].`, at(i, 'choices'));
      }
      if (section === 'listening' && (kind === 'tfng' || kind === 'ynng')) {
        fail('tfng_format', 'Listening cannot use TRUE/FALSE/NOT GIVEN or YES/NO/NOT GIVEN.', at(i, 'kind'));
      }
    }

    // §6.2 empty evidence is only legitimate for a NOT GIVEN answer. Upstream allowed
    // it anywhere, which let an unjustified answer pass review.
    if (isNotGiven(q)) {
      if (q.evidence !== '') {
        fail('evidence', `Question ${i + 1} is NOT GIVEN, so evidence must be exactly "".`, at(i, 'evidence'));
      }
    } else {
      if (trimmed(q.evidence) === '') {
        fail('evidence', `Question ${i + 1} needs a verbatim evidence quote. Empty is only allowed for NOT GIVEN.`, at(i, 'evidence'));
      }
      if (!normSource.includes(normalized(q.evidence))) {
        fail('evidence', `Question ${i + 1} evidence must appear word-for-word in the source text.`, at(i, 'evidence'));
      }
    }
  });

  // Script presence/emptiness was already settled before the word window above, so
  // only the remaining ordering and coverage rules are left for listening.
  if (section === 'reading') return;

  let previousGroup = -1;
  for (const [i, line] of raw.script.entries()) {
    if (line.text.length > MAX_TURN_CHARS) {
      fail('script_turn_length', `Script turn ${i + 1} exceeds ${MAX_TURN_CHARS} characters.`, `script[${i}].text`);
    }
    if (line.group < previousGroup) {
      fail('script_order', `Script turn ${i + 1} goes back to group ${line.group}. Groups must ascend.`, `script[${i}].group`);
    }
    if (line.group < 0 || line.group >= raw.groups.length) {
      fail('script_group', `Script turn ${i + 1} names group ${line.group}, which does not exist.`, `script[${i}].group`);
    }
    previousGroup = line.group;
  }
  for (let g = 0; g < raw.groups.length; g++) {
    if (!raw.script.some((line) => line.group === g)) {
      fail('missing_recording_group', `Question group ${g + 1} has no spoken turn.`, 'script');
    }
  }
  const speakers = new Set(raw.script.map((line) => line.speaker));
  if (part === 1 || part === 3) {
    if (!speakers.has('woman') || !speakers.has('man')) {
      fail('dialogue_speakers', `Part ${part} is a dialogue and needs both a woman and a man speaker.`, 'script');
    }
  } else if (speakers.size !== 1) {
    fail('monologue_speakers', `Part ${part} is a monologue, so exactly one speaker value is allowed, found ${speakers.size}.`, 'script');
  }
  // §6.2 text is the playback source, so it must equal the canonical join exactly.
  if (raw.text !== joinedScript(raw.script)) {
    fail('transcript_mismatch', 'text must be exactly the script turn texts joined by single spaces.', 'text');
  }
}

// ─── Writing / Speaking validation (§6.3, §6.4) ───

const WRITING_MINIMA = [150, 250] as const;
const SPEAKING_COUNTS: Record<number, number> = { 1: 8, 2: 2, 3: 6 };

export function validateWriting(raw: RawWriting, expectedTasks: number): void {
  if (raw.tasks.length !== expectedTasks) {
    fail('writing_task_count', `Expected exactly ${expectedTasks} task(s), received ${raw.tasks.length}.`, 'tasks');
  }
  raw.tasks.forEach((task, i) => {
    const n = i + 1;
    if (trimmed(task.title) === '' || trimmed(task.prompt) === '') {
      fail('writing_prompt', `Task ${n} needs a non-empty title and prompt.`, `tasks[${i}]`);
    }
    const want = n === 1 ? WRITING_MINIMA[0] : WRITING_MINIMA[1];
    if (task.minimum !== want) {
      fail('writing_minimum', `Task ${n} minimum must be exactly ${want}, received ${task.minimum}.`, `tasks[${i}].minimum`);
    }
    if (n === 2 && task.visual !== null) {
      fail('writing_visual', 'Task 2 visual must be exactly null.', `tasks[${i}].visual`);
    }
    if (n !== 1) return;
    const visual = task.visual;
    if (!visual) {
      fail('writing_visual', 'Task 1 requires a visual.', `tasks[${i}].visual`);
    }
    if (trimmed(visual!.caption) === '') {
      fail('writing_visual', 'Task 1 visual needs a non-empty caption carrying units.', `tasks[${i}].visual.caption`);
    }
    if (visual!.columns.length < 2 || visual!.columns.some((c) => trimmed(c) === '')) {
      fail('writing_visual', 'Task 1 visual needs non-empty column names.', `tasks[${i}].visual.columns`);
    }
    if (visual!.rows.length < 3 || visual!.rows.some((r) => r.length !== visual!.columns.length)) {
      fail('visual_rectangular', 'Task 1 visual rows must be rectangular and match the column count.', `tasks[${i}].visual.rows`);
    }
    if (visual!.type === 'process') {
      if (visual!.columns.length !== 2) {
        fail('writing_visual', 'A process visual has exactly 2 columns.', `tasks[${i}].visual.columns`);
      }
      if (visual!.rows.length < 3 || visual!.rows.length > 7) {
        fail('writing_visual', `A process visual has 3-7 stage rows, received ${visual!.rows.length}.`, `tasks[${i}].visual.rows`);
      }
    } else {
      if (visual!.columns.length < 3 || visual!.columns.length > 5) {
        fail('writing_visual', `A ${visual!.type} visual has 3-5 columns, received ${visual!.columns.length}.`, `tasks[${i}].visual.columns`);
      }
      if (visual!.rows.length < 3 || visual!.rows.length > 6) {
        fail('writing_visual', `A ${visual!.type} visual has 3-6 rows, received ${visual!.rows.length}.`, `tasks[${i}].visual.rows`);
      }
      // §6.3 reject a blank cell outright; Number('') === 0 would read as real data.
      visual!.rows.forEach((row, ri) => {
        for (let ci = 1; ci < row.length; ci++) {
          const cell = trimmed(row[ci] ?? '');
          if (cell === '' || !Number.isFinite(Number(cell))) {
            fail('visual_numeric', `Task 1 visual cell [${ri}][${ci}] must be a non-empty numeric string.`, `tasks[${i}].visual.rows[${ri}][${ci}]`);
          }
        }
      });
    }
  });
}

export function validateSpeaking(raw: RawSpeaking, expected: number[]): void {
  if (raw.parts.length !== expected.length) {
    fail('speaking_parts', `Expected exactly ${expected.length} part(s), received ${raw.parts.length}.`, 'parts');
  }
  raw.parts.forEach((part, i) => {
    const n = expected[i]!;
    if (part.part !== n) {
      fail('speaking_parts', `Part ${i + 1} must be numbered ${n}, received ${part.part}.`, `parts[${i}].part`);
    }
    if (trimmed(part.prompt) === '') {
      fail('speaking_parts', `Part ${n} needs a non-empty prompt.`, `parts[${i}].prompt`);
    }
    const wantQuestions = SPEAKING_COUNTS[n]!;
    if (part.questions.length !== wantQuestions) {
      fail('speaking_count', `Part ${n} needs exactly ${wantQuestions} questions, received ${part.questions.length}.`, `parts[${i}].questions`);
    }
    if (part.questions.some((q) => trimmed(q) === '')) {
      fail('speaking_count', `Part ${n} has an empty question.`, `parts[${i}].questions`);
    }
    if (n === 2) {
      if (part.cue.length !== 4 || part.cue.some((c) => trimmed(c) === '')) {
        fail('speaking_cue', `Part 2 needs exactly 4 non-empty cue items, received ${part.cue.length}.`, `parts[${i}].cue`);
      }
    } else if (part.cue.length !== 0) {
      fail('speaking_cue', `Part ${n} must have an empty cue list.`, `parts[${i}].cue`);
    }
  });
}

// ─── Normalized application ───

const questionNumber = (section: 'listening' | 'reading', part: number, index: number): number => {
  if (section === 'listening') return (part - 1) * 10 + index + 1;
  return part === 1 ? index + 1 : part === 2 ? 13 + index + 1 : 26 + index + 1;
};

/** §4.3 storage index, actual part and display number stay distinct. */
const storageIndex = (scope: Scope | undefined, part: number): number => (scope === 'full' ? part - 1 : 0);

function toBlock(raw: RawBlock, section: 'listening' | 'reading', part: number, scope: Scope | undefined): Block {
  const index = storageIndex(scope, part);
  const questions: Question[] = raw.questions.map((q, i) => ({
    id: `${section[0]}${index + 1}-${i + 1}`,
    number: questionNumber(section, part, i),
    part,
    section,
    topic: raw.title,
    stem: q.stem,
    choices: q.choices,
    correct: q.correct,
    explanation: q.explanation,
    skill: q.skill,
    kind: q.kind,
    answerText: q.answerText,
    accepted: q.accepted,
    group: q.group,
    maxWords: q.maxWords,
    evidence: q.evidence,
  }));
  const script: ScriptLine[] | undefined =
    section === 'listening' ? raw.script.map((l) => ({ ...l })) : undefined;
  const block: Block = {
    title: raw.title,
    text: raw.text,
    questions,
    ...(script ? { script } : {}),
    groups: raw.groups.map((g) => ({ ...g })),
    description: raw.description,
  };
  return block;
}

/**
 * §3.2 the ONE application function. Importer and future provider generation both
 * call it. Model output never sets ids, section, part, topic, voices, revisions,
 * owner, lifecycle, timestamps or prepared state — everything below is app-assigned.
 */
export function applyMaterial(t: TestData, job: PrepJob, data: unknown): TestData {
  const spec = requirements(t, job);
  const next: TestData = {
    ...t,
    listening: [...t.listening],
    reading: [...t.reading],
    writing: [...t.writing],
    speaking: [...t.speaking],
    prepared: [...(t.prepared ?? [])],
    answers: { ...t.answers },
  };

  if (job.section === 'listening' || job.section === 'reading') {
    validateShape(data, spec.schema, 'data');
    const raw = data as RawBlock;
    validateBlock(raw, job.section, job.part);
    const block = toBlock(raw, job.section, job.part, t.scope);
    const bucket = job.section === 'listening' ? next.listening : next.reading;
    bucket[storageIndex(t.scope, job.part)] = block;
  } else if (job.section === 'writing') {
    validateShape(data, spec.schema, 'data');
    const raw = data as RawWriting;
    validateWriting(raw, t.scope === 'full' ? 2 : 1);
    const tasks: WritingTask[] = raw.tasks.map((task) => ({
      title: task.title,
      prompt: task.prompt,
      minimum: task.minimum,
      visual: task.visual,
    }));
    next.writing = tasks;
  } else {
    validateShape(data, spec.schema, 'data');
    const speaking = data as RawSpeaking;
    const expected = t.scope === 'full' ? [1, 2, 3] : [job.part];
    validateSpeaking(speaking, expected);
    next.speaking = speaking.parts.map((p) => ({ ...p, questions: [...p.questions], cue: [...p.cue] }));
  }

  // Arrays are sparse until every job is prepared, so a partially prepared attempt
  // holds undefined holes. Skipping them is required: a hole would otherwise throw
  // here and, worse, a later job could read as already-answered.
  for (const block of [...next.listening, ...next.reading]) {
    if (!block) continue;
    for (const q of block.questions) {
      next.answers[q.id] = q.kind === 'gap' ? q.answerText ?? '' : q.correct;
    }
  }
  // `prepared` is optional on TestData but always initialised as an array above.
  const prepared = next.prepared ?? [];
  if (!prepared.includes(job.key)) prepared.push(job.key);
  next.prepared = prepared;
  return next;
}

export function materialComplete(t: TestData): boolean {
  return !!t.jobs?.length && t.jobs.every((j) => t.prepared?.includes(j.key));
}
