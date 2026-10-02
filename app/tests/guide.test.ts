import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  envelopeSchema,
  renderGuide,
  renderRepair,
  type GuideConstraint,
  type GuideRequirements,
  type JsonSchema,
} from '../src/lib/guide.ts';
import type { PrepJob } from '../src/lib/types.ts';

// P0-06. The renderer is transport-only: it formats the material contract's requirements
// (injected, because material.ts lands in parallel as P0-04) and adds the envelope
// wrapper. The fixtures below stand in for that contract and encode §6 verbatim, so the
// numeric assertions below check the renderer surfaces contract numbers unchanged
// instead of maintaining a competing table inside guide.ts (§5.2).

const rule = (id: string, text: string, note?: string): GuideConstraint =>
  note === undefined ? { id, text } : { id, text, note };

const IDENTITY = { attempt_id: '11111111-2222-4333-8444-555555555555', generation_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };

// ─── Contract fixtures (§6) ───

const LISTENING_RULES = {
  hard: [
    rule('question_count', 'The block has exactly 10 questions.'),
    rule('recording_length', 'The joined script text is 620 to 950 words inclusive.'),
    rule('script_turns', 'The script has 1 to 60 non-empty turns, each at most 3500 characters.'),
    rule('dialogue_speakers', 'Parts 1 and 3 use exactly one woman and one man; Parts 2 and 4 use exactly one of them. No narrator turn.'),
    rule('transcript', 'The block text is exactly the script turn texts joined with one space.'),
    rule('choice_count', 'A choice question has exactly 3 distinct non-empty choices.'),
  ],
  targets: [
    rule('recording_length', 'Prefer 750 to 850 spoken script words.', 'The 620-950 window is a rejection boundary, not a suggestion.'),
    rule('group_count', 'Prefer 2 to 3 groups.', 'The hard range is 2 to 4.'),
  ],
};

const READING_RULES = {
  hard: [
    rule('question_count', 'The block has exactly 13 questions for passages 1 and 2 and exactly 14 questions for passage 3.'),
    rule('passage_length', 'The passage text is 720 to 910 words inclusive.'),
    rule('script', 'The script array is exactly empty.'),
    rule('choice_count', 'A choice question has exactly 4 distinct non-empty choices.'),
    rule('tfng_format', 'A tfng question has choices exactly TRUE, FALSE, NOT GIVEN in that order; correct is 0, 1 or 2.'),
    rule('ynng_format', 'A ynng question has choices exactly YES, NO, NOT GIVEN in that order; correct is 0, 1 or 2.'),
    rule('evidence', 'Evidence is a verbatim substring of the passage text, and is exactly the empty string when the answer is NOT GIVEN.'),
  ],
  targets: [
    rule('passage_length', 'Prefer 740 to 880 words.', 'The 720-910 window is a rejection boundary.'),
    rule('group_count', 'Prefer 2 to 3 groups.', 'The hard range is 2 to 4.'),
  ],
};

const GAP_AND_GROUP_RULES = [
  rule('group_numbering', 'Group ranges tile local questions 1..N with no gap and no overlap.'),
  rule('group_index', 'The zero-based question group index equals the group ordinal minus one.'),
  rule('mixed_kind', 'One question kind per group.'),
  rule('answer_word_limit', 'A gap group declares one maxWords and states that limit once. maxWords is 1 to 3.'),
  rule('gap_answer', 'A gap question has choices exactly empty, correct exactly 0, a non-empty answerText that appears in the source text, and an accepted array containing answerText with every variant non-empty.'),
  rule('gap_variants', 'Every accepted variant is non-empty and within the group maxWords.'),
  rule('choice_fields', 'A non-gap question has answerText exactly empty, accepted exactly empty and maxWords exactly 0.'),
  rule('match_bank', 'A match group carries one bank of 5 to 8 distinct non-empty options, identical across every question in the group.'),
  rule('choice_key', 'correct is a zero-based index inside the choices array.'),
  rule('stem_quality', 'Stems, explanations and skills are non-empty and stems are unique after whitespace and punctuation normalization.'),
];

const WRITING_RULES = {
  hard: [
    rule('writing_task_count', 'Full scope has exactly 2 tasks in Task 1 then Task 2 order; focused scope has exactly its selected task.'),
    rule('writing_minimum', 'Task 1 minimum is exactly 150 and Task 2 minimum is exactly 250. These are task minima, not a check on a student response.'),
    rule('writing_visual', 'Task 1 carries a visual of type table, bar, line or process with a non-empty caption and non-empty column names; Task 2 visual is exactly null.'),
    rule('visual_rectangular', 'Visual rows are rectangular, with no blank or ragged cells.'),
    rule('visual_numeric', 'Table, bar and line visuals have 3 to 5 columns and 3 to 6 rows; every non-first cell is a non-empty string standing for a finite number. Process visuals have exactly 2 columns and 3 to 7 stage rows.'),
  ],
  targets: [
    rule('visual_data', 'Prefer 4 to 6 rows with meaningful contrasts, and caption units.', 'Plausibility needs human review and is not a rejection rule.'),
    rule('process_stages', 'Prefer 5 to 7 process stages.'),
  ],
};

const SPEAKING_RULES = {
  hard: [
    rule('speaking_parts', 'Full scope has parts ordered 1, 2, 3; focused scope has exactly its selected part.'),
    rule('speaking_count', 'Part 1 has exactly 8 questions, Part 2 exactly 2 and Part 3 exactly 6.'),
    rule('speaking_cue', 'Part 2 has exactly 4 non-empty cue strings. Every other part has cue exactly empty.'),
    rule('speaking_prompt', 'Every part has a non-empty prompt and non-empty question strings.'),
  ],
  targets: [
    rule('speaking_link', 'In full scope, Part 3 develops the Part 2 long turn.', 'The relationship is reviewed by a human, not inferred from shape.'),
  ],
};

const SHAPE_RULES = [
  rule('shape', 'Emit every declared field with its exact declared literal type; add no field that no schema lists.'),
  rule('limits', 'Arrays hold at most 100 items and strings at most 20000 characters, and every number is finite.'),
];

const SELF_CHECK = [
  rule('counts', 'Question counts, task counts, part counts and question counts per part match the hard rules above exactly.'),
  rule('groups', 'Group ranges tile 1..N with no gap or overlap, and every question carries the right zero-based group index.'),
  rule('answers', 'Every answerText is copied verbatim from the passage text or the joined script, and every evidence string is a verbatim substring of the same source.'),
  rule('choices', 'Every correct is a valid zero-based index into that question\'s choices, and every choice array has the required length and order.'),
  rule('identity', 'attempt_id, job_key and generation_id are copied character for character from section 2, and format_version is 1.'),
  rule('escaping', 'Every quote and backslash inside a string is escaped, and no unescaped newline appears inside a string value.'),
];

type PrepJobLike = PrepJob;

const blockSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'description', 'text', 'groups', 'questions', 'script'],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    text: { type: 'string' },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'instructions', 'start', 'end'],
        properties: {
          title: { type: 'string' },
          instructions: { type: 'string' },
          start: { type: 'integer' },
          end: { type: 'integer' },
        },
      },
    },
    questions: { type: 'array', items: { type: 'object' } },
    script: { type: 'array', items: { type: 'object' } },
  },
};

function schemaFor(job: PrepJobLike): JsonSchema {
  if (job.section === 'listening' || job.section === 'reading') return blockSchema;
  if (job.section === 'writing') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['tasks'],
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'prompt', 'minimum', 'visual'],
            properties: {
              title: { type: 'string' },
              prompt: { type: 'string' },
              minimum: { type: 'integer' },
              visual: { type: ['object', 'null'] },
            },
          },
        },
      },
    };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['parts'],
    properties: {
      parts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['part', 'prompt', 'questions', 'cue'],
          properties: {
            part: { type: 'integer' },
            prompt: { type: 'string' },
            questions: { type: 'array', items: { type: 'string' } },
            cue: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  };
}

function rulesFor(job: PrepJobLike): GuideRequirements['constraints'] {
  if (job.section === 'listening') {
    return { hard: [...LISTENING_RULES.hard, ...GAP_AND_GROUP_RULES, ...SHAPE_RULES], targets: LISTENING_RULES.targets, self_check: SELF_CHECK };
  }
  if (job.section === 'reading') {
    return { hard: [...READING_RULES.hard, ...GAP_AND_GROUP_RULES, ...SHAPE_RULES], targets: READING_RULES.targets, self_check: SELF_CHECK };
  }
  if (job.section === 'writing') {
    return { hard: [...WRITING_RULES.hard, ...SHAPE_RULES], targets: WRITING_RULES.targets, self_check: SELF_CHECK };
  }
  return { hard: [...SPEAKING_RULES.hard, ...SHAPE_RULES], targets: SPEAKING_RULES.targets, self_check: SELF_CHECK };
}

function requirements(job: PrepJobLike, focusSkill = 'paraphrase'): GuideRequirements {
  return {
    job,
    schema: schemaFor(job),
    constraints: rulesFor(job),
    brief: {
      section: job.section === 'reading' ? 'Reading' : job.section[0]!.toUpperCase() + job.section.slice(1),
      part_label:
        job.section === 'reading' ? `Passage ${job.part}` : job.part > 0 ? `Part ${job.part}` : job.label,
      seed: 8123,
      focus_skill: focusSkill,
      structure: job.section === 'listening' || job.section === 'reading'
        ? ['A short source section.', 'Two to four question groups over it.']
        : ['One task or part per schema entry.'],
      previous_topics: ['urban beekeeping'],
    },
  };
}

const FULL_JOBS: PrepJob[] = [
  { key: 'l0', label: 'Listening Part 1', section: 'listening', part: 1 },
  { key: 'l1', label: 'Listening Part 2', section: 'listening', part: 2 },
  { key: 'l2', label: 'Listening Part 3', section: 'listening', part: 3 },
  { key: 'l3', label: 'Listening Part 4', section: 'listening', part: 4 },
  { key: 'r0', label: 'Reading Passage 1', section: 'reading', part: 1 },
  { key: 'r1', label: 'Reading Passage 2', section: 'reading', part: 2 },
  { key: 'r2', label: 'Reading Passage 3', section: 'reading', part: 3 },
  { key: 'w', label: 'Writing Tasks 1 and 2', section: 'writing', part: 0 },
  { key: 's', label: 'Speaking Parts 1, 2 and 3', section: 'speaking', part: 0 },
];

const FOCUSED_JOBS: PrepJob[] = [
  { key: 'l', label: 'Listening Part 4', section: 'listening', part: 4 },
  { key: 'r', label: 'Reading Passage 2', section: 'reading', part: 2 },
  { key: 'w', label: 'Writing Task 2', section: 'writing', part: 2 },
  { key: 's', label: 'Speaking Part 3', section: 'speaking', part: 3 },
];

const FENCE = '```';

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

// ─── Every job variant renders, with the right label and part ───

test('every full-scope and focused job variant renders with its label and part', () => {
  for (const job of [...FULL_JOBS, ...FOCUSED_JOBS]) {
    const guide = renderGuide(requirements(job), IDENTITY);
    assert.ok(guide.length > 0, job.key);
    assert.ok(guide.includes(job.label), `${job.key} label`);
    assert.ok(guide.includes(`\`${job.key}\``), `${job.key} key present`);
    if (job.part > 0) {
      const partWord = job.section === 'reading' ? 'Passage' : 'Part';
      assert.ok(guide.includes(`${partWord} ${job.part}`), `${job.key} part ${job.part}`);
    }
  }
});

test('job key and part number are distinguished, including the l2 -> Part 3 mix-up', () => {
  const l2 = renderGuide(requirements(FULL_JOBS[2]!), IDENTITY);
  assert.match(l2, /job key `l2` and the part number 3 are different/);
  assert.match(l2, /key\s+`l2` is Part 3\./);

  const r2 = renderGuide(requirements(FULL_JOBS[6]!), IDENTITY);
  assert.match(r2, /job key `r2` and the part number 3 are different/);
  assert.match(r2, /key\s+`r2` is Passage 3\./);

  // A focused key carries no digit, so no zero-based explanation is invented for it.
  const focused = renderGuide(requirements(FOCUSED_JOBS[0]!), IDENTITY);
  assert.match(focused, /job key `l` and the part number 4 are different/);
  assert.doesNotMatch(focused, /counts job slots from zero/);
});

// ─── Identity is pinned, not merely requested ───

test('envelope schema pins every identity field as a singleton enum', () => {
  for (const job of FULL_JOBS) {
    const schema = envelopeSchema(requirements(job), IDENTITY);
    const props = schema.properties as Record<string, Record<string, unknown>>;
    assert.deepEqual(props.attempt_id!.enum, [IDENTITY.attempt_id]);
    assert.deepEqual(props.job_key!.enum, [job.key]);
    assert.deepEqual(props.generation_id!.enum, [IDENTITY.generation_id]);
    assert.deepEqual(props.format_version!.enum, [1]);
    assert.equal(props.format_version!.const, 1);
    for (const field of ['attempt_id', 'job_key', 'generation_id', 'format_version']) {
      assert.equal((props[field]!.enum as unknown[]).length, 1, `${job.key} ${field}`);
    }
    assert.deepEqual(schema.required, ['format_version', 'attempt_id', 'job_key', 'generation_id', 'data']);
    assert.equal(schema.additionalProperties, false);
  }
});

test('render never invents an identity: it only echoes the supplied one', () => {
  const other = { attempt_id: '00000000-0000-4000-8000-000000000000', generation_id: '99999999-8888-4777-8666-555555555555' };
  const a = renderGuide(requirements(FULL_JOBS[2]!), IDENTITY);
  const b = renderGuide(requirements(FULL_JOBS[2]!), other);
  assert.ok(a.includes(IDENTITY.attempt_id) && !a.includes(other.attempt_id));
  assert.ok(b.includes(other.generation_id) && !b.includes(IDENTITY.generation_id));
});

// ─── One output contract, no second skeleton ───

test('exactly one fenced json block appears in the whole document', () => {
  for (const job of [...FULL_JOBS, ...FOCUSED_JOBS]) {
    const guide = renderGuide(requirements(job), IDENTITY);
    assert.equal(countOccurrences(guide, '```json'), 1, `${job.key} json fence`);
    assert.equal(countOccurrences(guide, FENCE), 2, `${job.key} total fences`);
  }
});

// ─── Transport neutrality (§5.1) ───

test('guide names no integration surface of any kind', () => {
  for (const job of [...FULL_JOBS, ...FOCUSED_JOBS]) {
    const guide = renderGuide(requirements(job), IDENTITY).toLowerCase();
    for (const banned of ['save_generated_part', 'mcp', 'tool', 'endpoint', 'oauth', 'plugin', 'api', 'submit', 'upload']) {
      assert.ok(!guide.includes(banned), `${job.key} leaked ${banned}`);
    }
  }
});

test('guide states the single return-the-JSON instruction', () => {
  const guide = renderGuide(requirements(FULL_JOBS[0]!), IDENTITY);
  assert.match(guide, /one complete JSON envelope as the whole of your message/);
  assert.match(guide, /no prose after it/);
});

// ─── Prompt order (§5.1) ───

test('sections appear in the order IDEA.md 5.1 requires', () => {
  const guide = renderGuide(requirements(FULL_JOBS[0]!), IDENTITY);
  const order = [
    '## 1. What to produce',
    '## 2. Target identity',
    '## 3. Material brief',
    '## 4. Rules for this job',
    '## 5. Output contract',
    '## 6. Self-check before you answer',
  ];
  let at = -1;
  for (const heading of order) {
    const found = guide.indexOf(heading);
    assert.ok(found > at, `${heading} out of order`);
    at = found;
  }
});

// ─── Brief: focus skill as quoted data, previous topics from the snapshot ───

test('focus skill is quoted as data and previous topics come from the snapshot', () => {
  const guide = renderGuide(requirements(FULL_JOBS[0]!, 'compound noun formation'), IDENTITY);
  assert.ok(guide.includes('Focus skill (quoted data): `"compound noun formation"`'));
  assert.match(guide, /never instructions/);
  assert.ok(guide.includes('- urban beekeeping'));

  const none = renderGuide(requirements(FULL_JOBS[0]!, ''), IDENTITY);
  assert.match(none, /Focus skill: none requested/);
});

test('hard rules and authoring targets are labelled separately', () => {
  const guide = renderGuide(requirements(FULL_JOBS[0]!), IDENTITY);
  assert.match(guide, /### Hard acceptance rules/);
  assert.match(guide, /rejected outright/);
  assert.match(guide, /### Authoring targets/);
  assert.match(guide, /They are not rejection criteria/);
  const hard = guide.indexOf('### Hard acceptance rules');
  const targets = guide.indexOf('### Authoring targets');
  const schema = guide.indexOf('## 5. Output contract');
  assert.ok(hard < targets && targets < schema);
});

// ─── Numeric and literal constraints reach the prompt unchanged ───

test('reading numbers and literals appear', () => {
  const guide = renderGuide(requirements(FULL_JOBS[6]!), IDENTITY);
  for (const expected of [
    'exactly 13 questions for passages 1 and 2 and exactly 14 questions for passage 3',
    '720 to 910 words',
    'exactly 4 distinct non-empty choices',
    'TRUE, FALSE, NOT GIVEN',
    'YES, NO, NOT GIVEN',
    '1..N with no gap and no overlap',
    'maxWords is 1 to 3',
    'one bank of 5 to 8 distinct non-empty options',
    'exactly empty',
  ]) {
    assert.ok(guide.includes(expected), `missing: ${expected}`);
  }
  assert.match(guide, /Prefer 740 to 880 words/);
});

test('listening numbers and literals appear', () => {
  const guide = renderGuide(requirements(FULL_JOBS[0]!), IDENTITY);
  for (const expected of [
    'exactly 10 questions',
    '620 to 950 words',
    'exactly 3 distinct non-empty choices',
    '1 to 60 non-empty turns, each at most 3500 characters',
    'No narrator turn',
  ]) {
    assert.ok(guide.includes(expected), `missing: ${expected}`);
  }
  assert.match(guide, /Prefer 750 to 850 spoken script words/);
});

test('writing minima are exactly 150 and 250', () => {
  const guide = renderGuide(requirements(FULL_JOBS[7]!), IDENTITY);
  assert.ok(guide.includes('Task 1 minimum is exactly 150 and Task 2 minimum is exactly 250'));
  assert.ok(guide.includes('3 to 5 columns and 3 to 6 rows'));
  assert.ok(guide.includes('exactly 2 columns and 3 to 7 stage rows'));
  assert.ok(guide.includes('Task 2 visual is exactly null'));
});

test('speaking counts are 8, 2 and 6 with exactly four cue strings', () => {
  const guide = renderGuide(requirements(FULL_JOBS[8]!), IDENTITY);
  assert.ok(guide.includes('Part 1 has exactly 8 questions, Part 2 exactly 2 and Part 3 exactly 6'));
  assert.ok(guide.includes('exactly 4 non-empty cue strings'));
});

test('self-check covers counts, groups, answers, choices, identity and escaping', () => {
  const guide = renderGuide(requirements(FULL_JOBS[0]!), IDENTITY);
  for (const expected of ['Group ranges tile 1..N', 'copied character for character', 'format_version is 1', 'backslash', 'zero-based index']) {
    assert.ok(guide.includes(expected), `missing: ${expected}`);
  }
});

// ─── Repair request (§5.3) ───

test('repair carries the unchanged identity, the error and the issued snapshot verbatim', () => {
  const req = requirements(FULL_JOBS[2]!);
  const snapshot = renderGuide(req, IDENTITY);
  const repair = renderRepair({
    identity: IDENTITY,
    job_key: req.job.key,
    job_label: req.job.label,
    error: { code: 'question_count', path: 'data.questions', message: 'Expected 10 questions, found 9.' },
    snapshot,
  });

  assert.ok(repair.includes(IDENTITY.attempt_id));
  assert.ok(repair.includes(IDENTITY.generation_id));
  assert.ok(repair.includes('- job_key: `l2`'));
  assert.ok(repair.includes('- Material: Listening Part 3'));
  assert.ok(repair.includes('`question_count`'));
  assert.ok(repair.includes('`data.questions`'));
  assert.ok(repair.includes('Expected 10 questions, found 9.'));
  assert.ok(repair.includes(snapshot), 'snapshot must appear verbatim');
  assert.equal(repair.split(snapshot).length - 1, 1, 'snapshot appears exactly once');
  assert.ok(
    repair.endsWith('Correct your previous response and return the complete envelope, not a patch.'),
    'repair closes with the required instruction',
  );
  assert.equal(countOccurrences(repair, '```json'), 1, 'repair adds no second skeleton');
});

test('repair tolerates an error without a path', () => {
  const snapshot = renderGuide(requirements(FULL_JOBS[0]!), IDENTITY);
  const repair = renderRepair({
    identity: IDENTITY,
    job_key: 'l0',
    job_label: 'Listening Part 1',
    error: { code: 'parse_failed', message: 'The response was not one JSON object.' },
    snapshot,
  });
  assert.ok(repair.includes('`(whole envelope)`'));
});

test('repair includes failed material only when the user chose to', () => {
  const snapshot = renderGuide(requirements(FULL_JOBS[0]!), IDENTITY);
  const without = renderRepair({
    identity: IDENTITY,
    job_key: 'l0',
    job_label: 'Listening Part 1',
    error: { code: 'group_coverage', message: 'x' },
    snapshot,
  });
  assert.ok(!without.includes('Your previous response'));

  const with_ = renderRepair({
    identity: IDENTITY,
    job_key: 'l0',
    job_label: 'Listening Part 1',
    error: { code: 'group_coverage', message: 'x' },
    snapshot,
    failed_response: '{"format_version":1}',
  });
  assert.ok(with_.includes('Your previous response'));
  assert.ok(with_.includes('{"format_version":1}'));
});

// ─── Determinism: the snapshot is persisted and reused (§4.2, §20.1) ───

test('rendering is byte-identical across calls and does not mutate its input', () => {
  for (const job of FULL_JOBS) {
    const req = requirements(job);
    const before = JSON.stringify(req);
    const first = renderGuide(req, IDENTITY);
    const second = renderGuide(req, IDENTITY);
    const third = renderGuide(requirements(job), IDENTITY);
    assert.equal(first, second, `${job.key} determinism`);
    assert.equal(first, third, `${job.key} determinism across equal requirements`);
    assert.equal(JSON.stringify(req), before, `${job.key} input mutated`);
  }
});

test('repair rendering is deterministic too', () => {
  const snapshot = renderGuide(requirements(FULL_JOBS[5]!), IDENTITY);
  const args = {
    identity: IDENTITY,
    job_key: 'r0',
    job_label: 'Reading Passage 1',
    error: { code: 'evidence' as const, path: 'data.questions[2].evidence', message: 'Evidence is not a substring.' },
    snapshot,
  };
  assert.equal(renderRepair(args), renderRepair(args));
});
