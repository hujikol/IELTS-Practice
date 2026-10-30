import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyMaterial,
  emptyTest,
  isFocused,
  jobsFor,
  materialComplete,
  questionCountFor,
  requirements,
  validateBlock,
  validateShape,
  rawBlockSchema,
} from '../src/lib/material.ts';
import type { PrepJob, RawBlock, RawQuestion, RawScriptLine, TestData } from '../src/lib/types.ts';

// P0-04/P0-07. One valid fixture per material type, then exactly one independent rule
// broken at a time. Every rejection asserts its stable ErrorCode, not just "it threw".
const GEN = { provider: 'test', model: 'fixture', createdAt: 0 };

const draft = (scope: TestData['scope'] = 'full', part = 1, focus = 'balanced'): TestData =>
  emptyTest(scope!, part, focus, GEN, 12345);

const job = (key: string, section: PrepJob['section'], part: number): PrepJob => ({
  key,
  label: key,
  section,
  part,
});

// ─── Fixtures ───

/** 10 questions, 2 gap groups tiling 1-10, word count inside 620-950. */
export const listeningBlock = (): RawBlock => {
  const gap = (i: number, answer: string, group: number): RawQuestion => ({
    stem: `Gap question ${i + 1} about the booking`,
    kind: 'gap',
    choices: [],
    correct: 0,
    answerText: answer,
    accepted: [answer],
    maxWords: 1,
    explanation: `Stated directly in the turn.`,
    evidence: answer,
    skill: 'form completion',
    group,
  });
  const script: RawScriptLine[] = [];
  for (let g = 0; g < 2; g++) {
    const filler = 'we should confirm the details before the appointment '.repeat(20);
    script.push({ speaker: 'woman', text: `For group ${g}, ${filler}`, group: g });
    script.push({ speaker: 'man', text: `Noted for group ${g}, ${filler}`, group: g });
  }
  script[0]!.text = 'The booking is on Tuesday and the fee is 40 pounds. ' + script[0]!.text;
  script[1]!.text = 'Yes, Tuesday works and 40 pounds is correct. ' + script[1]!.text;
  return {
    title: 'Community centre booking',
    description: 'A woman books a table tennis course at a community centre.',
    // text is the playback source and must equal the canonical join exactly (§6.2).
    text: script.map((l) => l.text).join(' '),
    groups: [
      { title: 'Course details', instructions: 'Write ONE WORD AND A NUMBER.', start: 1, end: 5 },
      { title: 'Fees', instructions: 'Write ONE WORD AND A NUMBER.', start: 6, end: 10 },
    ],
    questions: [
      ...Array.from({ length: 5 }, (_, i) => gap(i, i === 0 ? 'Tuesday' : '40', 0)),
      ...Array.from({ length: 5 }, (_, i) => gap(i + 5, i === 0 ? '40' : 'Tuesday', 1)),
    ],
    script,
  };
};

export const readingBlock = (passage = 1): RawBlock => {
  const para = (n: number) =>
    `Section ${n} examines how the archive was catalogued and why the earlier count differed from the later one. `.repeat(15);
  const text = [1, 2, 3].map(para).join('\n\n');
  const choice = (i: number, group: number, kind: 'choice' | 'match' = 'choice'): RawQuestion =>
    kind === 'match'
      ? {
          stem: `Match the finding ${i + 1} to its researcher`,
          kind: 'match',
          choices: ['Adler', 'Boone', 'Cruz', 'Dunn', 'Ellis', 'Fay'],
          correct: i % 6,
          answerText: '',
          accepted: [],
          maxWords: 0,
          explanation: 'Directly attributed in the passage.',
          evidence: 'catalogued',
          skill: 'matching information',
          group,
        }
      : {
          stem: `Statement ${i + 1} about the archive`,
          kind: 'choice',
          choices: ['It was incomplete', 'It was duplicated', 'It was disputed', 'It was lost'],
          correct: i % 4,
          answerText: '',
          accepted: [],
          maxWords: 0,
          explanation: 'Supported by the passage.',
          evidence: 'catalogued',
          skill: 'multiple choice',
          group,
        };
  // Passage 3 holds 14 questions (§6.2); the split stays contiguous over 1..total.
  const total = passage === 3 ? 14 : 13;
  const first = Math.ceil(total / 2);
  return {
    title: 'Cataloguing a municipal archive',
    description: 'A history of how a city archive was indexed.',
    text,
    groups: [
      { title: 'Early indexing', instructions: 'Choose the correct letter, A, B, C or D.', start: 1, end: first },
      { title: 'Later revisions', instructions: 'Choose the correct letter, A, B, C or D.', start: first + 1, end: total },
    ],
    questions: [
      ...Array.from({ length: first }, (_, i) => choice(i, 0)),
      ...Array.from({ length: total - first }, (_, i) => choice(i + first, 1)),
    ],
    script: [],
  };
};

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code ?? `THREW:${(e as Error).message}`;
  }
  return 'NO_THROW';
};

// ─── Valid baselines ───

test('a valid listening block passes and a valid reading block passes', () => {
  assert.doesNotThrow(() => validateBlock(listeningBlock(), 'listening', 1));
  assert.doesNotThrow(() => validateBlock(readingBlock(), 'reading', 1));
});

test('validateShape accepts a complete raw block and rejects a missing key', () => {
  const good = readingBlock() as unknown as Record<string, unknown>;
  assert.doesNotThrow(() => validateShape(good, rawBlockSchema, 'data'));
  const missing = { ...good } as Record<string, unknown>;
  delete missing.title;
  assert.equal(code(() => validateShape(missing, rawBlockSchema, 'data')), 'missing_key');
});

test('validateShape accepts a raw block when optional description is omitted', () => {
  const withoutDesc = listeningBlock() as unknown as Record<string, unknown>;
  delete withoutDesc.description;
  assert.doesNotThrow(() => validateShape(withoutDesc, rawBlockSchema, 'data'));
});

test('applyMaterial accepts a listening block without description and defaults to title', () => {
  const block = listeningBlock();
  delete block.description;
  const t = applyMaterial(draft(), job('l0', 'listening', 1), block);
  assert.equal(t.listening[0]?.title, 'Community centre booking');
  assert.equal(t.listening[0]?.description, 'Community centre booking');
});

test('applyMaterial automatically synchronizes text for listening when raw text differs from script join', () => {
  const block = listeningBlock();
  block.text = 'A drift in model generated text that does not match script';
  assert.doesNotThrow(() => {
    const t = applyMaterial(draft(), job('l0', 'listening', 1), block);
    assert.equal(t.listening[0]?.text, block.script.map((l) => l.text).join(' '));
  });
});

test('validateShape rejects an unknown key rather than ignoring it', () => {
  const extra = { ...(readingBlock() as unknown as Record<string, unknown>), notes: 'hello' };
  assert.equal(code(() => validateShape(extra, rawBlockSchema, 'data')), 'unknown_key');
});

// ─── §6.2 question count and word windows ───

test('question count is exact: 9 and 11 both fail for Listening', () => {
  const nine = listeningBlock();
  nine.questions = nine.questions.slice(0, 9);
  assert.equal(code(() => validateBlock(nine, 'listening', 1)), 'question_count');
  const eleven = listeningBlock();
  eleven.questions.push({ ...eleven.questions[0]!, stem: 'extra' });
  assert.equal(code(() => validateBlock(eleven, 'listening', 1)), 'question_count');
});

test('Reading passage word window rejects just outside 720-910 and accepts inside', () => {
  const short = readingBlock();
  short.text = 'too short '.repeat(50);
  assert.equal(code(() => validateBlock(short, 'reading', 1)), 'passage_length');
  const long = readingBlock();
  long.text = 'word '.repeat(1000);
  assert.equal(code(() => validateBlock(long, 'reading', 1)), 'passage_length');
  assert.doesNotThrow(() => validateBlock(readingBlock(), 'reading', 1));
});

// ─── §6.2 groups ───

test('group count below 2 and above 4 are both rejected', () => {
  const one = readingBlock();
  one.groups = [{ title: 'All', instructions: 'Choose A, B, C or D.', start: 1, end: 13 }];
  assert.equal(code(() => validateBlock(one, 'reading', 1)), 'group_count');
  const five = readingBlock();
  const per = Math.floor(13 / 5);
  five.groups = Array.from({ length: 5 }, (_, i) => ({
    title: `G${i}`,
    instructions: 'Choose A, B, C or D.',
    start: i * per + 1,
    end: (i + 1) * per,
  }));
  five.questions.forEach((q, i) => {
    q.group = Math.min(4, Math.floor(i / per));
  });
  assert.equal(code(() => validateBlock(five, 'reading', 1)), 'group_count');
});

test('a gap between groups is rejected as group_numbering', () => {
  const b = readingBlock();
  b.groups[1]!.start = 9; // leaves 8 uncovered
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'group_numbering');
});

test('an overlapping group range is rejected', () => {
  const b = readingBlock();
  b.groups[0]!.end = 8;
  b.questions.slice(0, 8).forEach((q) => (q.group = 0));
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'group_numbering');
});

test('incomplete group coverage is rejected', () => {
  const b = readingBlock();
  b.groups[1]!.end = 12; // stops short of 13
  b.questions.slice(0, 12).forEach((q) => (q.group = q.group === 1 ? 1 : 0));
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'group_coverage');
});

test('a wrong zero-based group index is rejected', () => {
  const b = readingBlock();
  b.questions[3]!.group = 1;
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'group_index');
});

test('mixing two formats inside one group is rejected', () => {
  const b = readingBlock();
  b.questions[2]!.kind = 'match';
  b.questions[2]!.choices = ['Adler', 'Boone', 'Cruz', 'Dunn', 'Ellis', 'Fay'];
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'mixed_kind');
});

test('mixing word limits inside one gap group is rejected', () => {
  const b = listeningBlock();
  b.questions[2]!.maxWords = 2;
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'mixed_word_limit');
});

test('a match group whose bank differs between questions is rejected', () => {
  const b = readingBlock();
  for (let i = 0; i < 7; i++) b.questions[i]!.kind = 'match';
  for (let i = 0; i < 7; i++) {
    b.questions[i]!.choices = i === 3 ? ['Adler', 'Boone', 'Cruz', 'Dunn', 'Ellis', 'Fry'] : ['Adler', 'Boone', 'Cruz', 'Dunn', 'Ellis', 'Fay'];
  }
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'match_bank');
});

test('a match bank outside 5-8 options is rejected', () => {
  const b = readingBlock();
  for (let i = 0; i < 7; i++) {
    b.questions[i]!.kind = 'match';
    b.questions[i]!.choices = ['A', 'B', 'C', 'D'];
  }
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'match_bank');
});

// ─── §6.2 question quality ───

test('an empty and a duplicate stem are both rejected', () => {
  const empty = readingBlock();
  empty.questions[0]!.stem = '   ';
  assert.equal(code(() => validateBlock(empty, 'reading', 1)), 'stem_quality');
  const dupe = readingBlock();
  dupe.questions[1]!.stem = dupe.questions[0]!.stem.toUpperCase();
  assert.equal(code(() => validateBlock(dupe, 'reading', 1)), 'stem_quality');
});

test('duplicate stems compare after normalization, not literally', () => {
  const b = readingBlock();
  // Same words, different case and trailing punctuation: normalized() collapses
  // these to one key, so the second stem must be rejected as a duplicate.
  b.questions[1]!.stem = b.questions[0]!.stem.toUpperCase().replace(/\.$/, '!');
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'stem_quality');
});

test('an empty explanation or skill is rejected', () => {
  const noExp = readingBlock();
  noExp.questions[0]!.explanation = '';
  assert.equal(code(() => validateBlock(noExp, 'reading', 1)), 'stem_quality');
  const noSkill = readingBlock();
  noSkill.questions[0]!.skill = '  ';
  assert.equal(code(() => validateBlock(noSkill, 'reading', 1)), 'stem_quality');
});

// ─── §6.2 gaps ───

test('a gap answer absent from the source is rejected', () => {
  const b = listeningBlock();
  b.questions[0]!.answerText = 'Wednesday';
  b.questions[0]!.accepted = ['Wednesday'];
  b.questions[0]!.evidence = 'Tuesday';
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'gap_answer');
});

test('a gap with an empty accepted list is rejected, not auto-populated', () => {
  const b = listeningBlock();
  b.questions[0]!.accepted = [];
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'gap_variants');
});

test('a gap accepted variant that misses answerText is rejected', () => {
  const b = listeningBlock();
  b.questions[0]!.accepted = ['Monday'];
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'gap_variants');
});

test('a gap variant over the word limit is rejected', () => {
  const b = listeningBlock();
  // answerText stays in the list so the variants rule passes; the second entry is
  // 4 words against maxWords 1, which is the word-limit rule firing.
  b.questions[0]!.accepted = ['Tuesday', 'two words here'];
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'answer_word_limit');
});

test('gap maxWords outside 1-3 is rejected', () => {
  const b = listeningBlock();
  // Raise the whole first group so the group stays internally consistent and the
  // per-question 1-3 bound is the rule that fires.
  for (let i = 0; i < 5; i++) b.questions[i]!.maxWords = 4;
  b.questions[0]!.accepted = [b.questions[0]!.answerText];
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'answer_word_limit');
});

test('a gap carrying choices or a non-zero correct is rejected', () => {
  const b = listeningBlock();
  b.questions[0]!.choices = ['a'];
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'gap_answer');
});

// ─── §6.2 non-gaps ───

test('a non-gap carrying answerText, accepted or maxWords is rejected', () => {
  for (const mutate of [
    (q: RawQuestion) => (q.answerText = 'leaked'),
    (q: RawQuestion) => (q.accepted = ['leaked']),
    (q: RawQuestion) => (q.maxWords = 2),
  ]) {
    const b = readingBlock();
    mutate(b.questions[0]!);
    assert.equal(code(() => validateBlock(b, 'reading', 1)), 'choice_key');
  }
});

test('Reading multiple choice with 3 options is rejected; 4 is accepted', () => {
  const three = readingBlock();
  three.questions[0]!.choices = ['a', 'b', 'c'];
  assert.equal(code(() => validateBlock(three, 'reading', 1)), 'choice_count');
  assert.doesNotThrow(() => validateBlock(readingBlock(), 'reading', 1));
});

test('Listening multiple choice with 4 options is rejected', () => {
  const b = listeningBlock();
  // Convert the whole first group to choice so it stays one kind, then widen it
  // to 4 options: Listening multiple choice must have exactly 3.
  for (let i = 0; i < 5; i++) {
    b.questions[i]!.kind = 'choice';
    b.questions[i]!.choices = ['alpha', 'beta', 'gamma', 'delta'];
    b.questions[i]!.answerText = '';
    b.questions[i]!.accepted = [];
    b.questions[i]!.maxWords = 0;
    b.questions[i]!.correct = 0;
    b.questions[i]!.evidence = 'Tuesday';
  }
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'choice_count');
});

test('a correct index outside the options is rejected', () => {
  const b = readingBlock();
  b.questions[0]!.correct = 9;
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'choice_key');
});

test('an empty or repeated option is rejected', () => {
  const empty = readingBlock();
  empty.questions[0]!.choices = ['a', '  ', 'c', 'd'];
  assert.equal(code(() => validateBlock(empty, 'reading', 1)), 'choice_count');
  const dupe = readingBlock();
  dupe.questions[0]!.choices = ['same', 'same', 'c', 'd'];
  assert.equal(code(() => validateBlock(dupe, 'reading', 1)), 'choice_count');
});

// ─── §6.2 tfng / ynng / evidence ───

test('a wrong TRUE/FALSE option array is rejected', () => {
  const b = readingBlock();
  // Reuse a match group so the option COUNT stays legal (5-8) and the only broken
  // rule is the literal array. Three options would trip choice_count first.
  for (let i = 0; i < 7; i++) {
    b.questions[i]!.kind = 'tfng';
    b.questions[i]!.choices = ['FALSE', 'TRUE', 'NOT GIVEN', 'MAYBE', 'SOMETIMES', 'UNKNOWN'];
    b.questions[i]!.correct = 1;
  }
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'tfng_format');
});

test('a wrong YES/NO option array is rejected', () => {
  const b = readingBlock();
  for (let i = 0; i < 7; i++) {
    b.questions[i]!.kind = 'ynng';
    b.questions[i]!.choices = ['YES', 'NOT GIVEN', 'NO', 'MAYBE', 'SOMETIMES', 'UNKNOWN'];
    b.questions[i]!.correct = 1;
  }
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'ynng_format');
});

test('Listening may not use tfng or ynng at all', () => {
  const b = listeningBlock();
  for (let i = 0; i < 5; i++) {
    b.questions[i]!.kind = 'tfng';
    b.questions[i]!.choices = ['TRUE', 'FALSE', 'NOT GIVEN'];
    b.questions[i]!.answerText = '';
    b.questions[i]!.accepted = [];
    b.questions[i]!.maxWords = 0;
    b.questions[i]!.correct = 0;
    b.questions[i]!.evidence = 'Tuesday';
  }
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'tfng_format');
});

test('non-verbatim evidence is rejected', () => {
  const b = readingBlock();
  b.questions[0]!.evidence = 'a phrase that is not in the passage at all';
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'evidence');
});

test('empty evidence on a non-NOT-GIVEN answer is rejected (upstream allowed it)', () => {
  const b = readingBlock();
  b.questions[0]!.evidence = '';
  assert.equal(code(() => validateBlock(b, 'reading', 1)), 'evidence');
});

test('empty evidence is allowed only when the correct answer IS NOT GIVEN', () => {
  const base = () => {
    const b = readingBlock();
    for (let i = 0; i < 7; i++) {
      b.questions[i]!.kind = 'tfng';
      b.questions[i]!.choices = ['TRUE', 'FALSE', 'NOT GIVEN'];
      b.questions[i]!.correct = 0;
    }
    return b;
  };
  // correct = 0 (TRUE) so evidence is required and must be verbatim.
  const justified = base();
  justified.questions[0]!.evidence = '';
  assert.equal(code(() => validateBlock(justified, 'reading', 1)), 'evidence');

  // correct = 2 (NOT GIVEN) so evidence must be exactly "".
  const exempt = base();
  exempt.questions[0]!.correct = 2;
  exempt.questions[0]!.evidence = '';
  assert.doesNotThrow(() => validateBlock(exempt, 'reading', 1));

  // A NOT GIVEN answer that still carries evidence is rejected.
  const contradictory = base();
  contradictory.questions[0]!.correct = 2;
  contradictory.questions[0]!.evidence = 'catalogued';
  assert.equal(code(() => validateBlock(contradictory, 'reading', 1)), 'evidence');
});

// ─── §6.2 listening script ───

test('an empty script is rejected and a non-empty Reading script is rejected', () => {
  // §6.2 a Reading block must carry an empty script, and a blank listening turn is
  // rejected. (An empty LISTENING script is covered by the word-window test instead:
  // dropping every turn empties the joined source, so length fails before count.)
  // Blank a LATER turn so the 620-word window still holds and emptiness is the
  // only violation. Blanking turn 0 would drop the total below 620 first.
  const blankTurn = listeningBlock();
  blankTurn.script[2]!.text = '   ';
  blankTurn.text = blankTurn.script.map((l) => l.text).join(' ');
  assert.equal(code(() => validateBlock(blankTurn, 'listening', 1)), 'script_empty');

  const rd = readingBlock();
  rd.script = [{ speaker: 'woman', text: 'Should not be here.', group: 0 }];
  assert.equal(code(() => validateBlock(rd, 'reading', 1)), 'script_empty');
});

test('a script turn over 3500 characters is rejected', () => {
  const b = listeningBlock();
  // 4000+ characters is over the 3500 turn limit while the total word count stays
  // inside 620-950. The answer words remain present so gap_answer does not fire first.
  b.script[0]!.text = `Tuesday 40 ${'word '.repeat(798)}`;
  for (let i = 1; i < b.script.length; i++) b.script[i]!.text = 'Tuesday 40 continues here.';
  b.text = b.script.map((l) => l.text).join(' ');
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'script_turn_length');
});

test('a script whose group order goes backwards is rejected', () => {
  const b = listeningBlock();
  b.script[2]!.group = 0;
  b.script[3]!.group = 1;
  b.script[1]!.group = 1;
  b.text = b.script.map((l) => l.text).join(' ');
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'script_order');
});

test('a question group with no spoken turn is rejected', () => {
  const b = listeningBlock();
  // Drop group 1's turns but lengthen what remains, so the word window still passes
  // and an uncovered question group is the only violation.
  b.script = b.script
    .filter((l) => l.group === 0)
    .map((l) => ({ ...l, text: `${l.text} ${'extra spoken detail here '.repeat(55)}` }));
  b.text = b.script.map((l) => l.text).join(' ');
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'missing_recording_group');
});

test('a Part 1 dialogue missing the man is rejected', () => {
  const b = listeningBlock();
  b.script = b.script.map((l) => ({ ...l, speaker: 'woman' as const }));
  b.text = b.script.map((l) => l.text).join(' ');
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'dialogue_speakers');
});

test('a Part 2 monologue with two speakers is rejected, and one speaker passes', () => {
  const two = listeningBlock();
  two.script = two.script.map((l, i) => ({ ...l, speaker: i % 2 === 0 ? ('woman' as const) : ('man' as const) }));
  two.text = two.script.map((l) => l.text).join(' ');
  assert.equal(code(() => validateBlock(two, 'listening', 2)), 'monologue_speakers');

  const one = listeningBlock();
  one.script = one.script.map((l) => ({ ...l, speaker: 'woman' as const }));
  one.text = one.script.map((l) => l.text).join(' ');
  assert.doesNotThrow(() => validateBlock(one, 'listening', 2));
});

test('a transcript that is not the exact canonical join is rejected', () => {
  const b = listeningBlock();
  b.text = `${b.script.map((l) => l.text).join(' ')} `; // trailing space
  assert.equal(code(() => validateBlock(b, 'listening', 1)), 'transcript_mismatch');
});

// ─── §4.3 jobs and identity ───

test('full scope has exactly nine jobs with the documented keys', () => {
  const keys = jobsFor('full', 1).map((j) => j.key);
  assert.deepEqual(keys, ['l0', 'l1', 'l2', 'l3', 'r0', 'r1', 'r2', 'w', 's']);
  assert.equal(draft().jobs?.length, 9);
});

test('l2 is Listening Part 3, not Part 2', () => {
  assert.equal(jobsFor('full', 1)[2]?.key, 'l2');
  assert.equal(jobsFor('full', 1)[2]?.part, 3);
});

test('focused scope has exactly one job keyed by section initial', () => {
  assert.equal(jobsFor('listening', 2).length, 1);
  assert.equal(jobsFor('listening', 2)[0]?.key, 'l');
  assert.equal(jobsFor('reading', 3)[0]?.key, 'r');
  assert.equal(jobsFor('writing', 1)[0]?.key, 'w');
  assert.equal(jobsFor('speaking', 2)[0]?.key, 's');
});

test('question counts are 10 for Listening and 13/13/14 for Reading', () => {
  assert.equal(questionCountFor('listening', 1), 10);
  assert.equal(questionCountFor('reading', 1), 13);
  assert.equal(questionCountFor('reading', 2), 13);
  assert.equal(questionCountFor('reading', 3), 14);
});

test('isFocused distinguishes a focused set from a full test', () => {
  assert.equal(isFocused(draft('full')), false);
  assert.equal(isFocused(draft('reading', 2)), true);
});

// ─── Display numbering (§4.3) ───

test('full-test display numbers use the upstream offsets', () => {
  const t = applyMaterial(draft(), job('l0', 'listening', 1), listeningBlock());
  assert.equal(t.listening[0]?.questions[0]?.number, 1);
  assert.equal(t.listening[0]?.questions[9]?.number, 10);

  // l2 is Part 3, so display numbers start at 21 and storage index is 2.
  const t3 = applyMaterial(draft(), job('l2', 'listening', 3), listeningBlock());
  assert.equal(t3.listening[2]?.questions[0]?.number, 21);
  assert.equal(t3.listening[2]?.questions[9]?.number, 30);

  const r1 = applyMaterial(draft(), job('r0', 'reading', 1), readingBlock());
  assert.equal(r1.reading[0]?.questions[0]?.number, 1);
  const r2 = applyMaterial(draft(), job('r1', 'reading', 2), readingBlock());
  assert.equal(r2.reading[1]?.questions[0]?.number, 14);
  const r3 = applyMaterial(draft(), job('r2', 'reading', 3), readingBlock(3));
  assert.equal(r3.reading[2]?.questions[0]?.number, 27);
  assert.equal(r3.reading[2]?.questions[13]?.number, 40);
});

test('a partially prepared attempt stays sparse without crashing', () => {
  // Preparing only Part 3 leaves holes at indices 0-1. Recomputing answers must skip
  // them, and a later job must not read as already answered.
  const t = applyMaterial(draft(), job('l2', 'listening', 3), listeningBlock());
  assert.equal(t.listening.length, 3);
  assert.equal(t.listening[0], undefined);
  assert.equal(Object.keys(t.answers).length, 10);
  assert.equal(Object.keys(t.answers).some((k) => k.startsWith('l1-')), false);
});

test('focused material keeps its real practice part at storage index 0', () => {
  const t = applyMaterial(draft('listening', 3), job('l', 'listening', 3), listeningBlock());
  assert.equal(t.listening.length, 1);
  // Block carries no part of its own; the actual part is on every question.
  assert.equal(t.listening[0]?.questions[0]?.part, 3);
  assert.equal(t.listening[0]?.questions[0]?.number, 21);
});

// ─── applyMaterial invariants ───

test('applyMaterial does not mutate the input TestData', () => {
  const before = draft();
  const snapshot = JSON.stringify(before);
  applyMaterial(before, job('l0', 'listening', 1), listeningBlock());
  assert.equal(JSON.stringify(before), snapshot);
});

test('applyMaterial sets prepared, answers and app-assigned ids only', () => {
  const t = applyMaterial(draft(), job('l0', 'listening', 1), listeningBlock());
  assert.deepEqual(t.prepared, ['l0']);
  assert.equal(Object.keys(t.answers).length, 10);
  assert.equal(t.listening[0]?.questions[0]?.id, 'l1-1');
  assert.equal(t.listening[0]?.questions[0]?.section, 'listening');
  assert.equal(t.listening[0]?.questions[0]?.topic, 'Community centre booking');
});

test('model output cannot smuggle voices, owner or lifecycle state', () => {
  // §6.1 unknown properties are rejected, not stripped, so a smuggled field never
  // reaches the store at all.
  for (const smuggled of [
    { voices: { narrator: { voice: 'evil', accent: 'Mars' } } },
    { owner_id: 'someone-else' },
    { status: 'completed' },
    { revision: 99 },
  ]) {
    const hostile = { ...(readingBlock() as unknown as Record<string, unknown>), ...smuggled };
    const before = draft();
    const snapshot = JSON.stringify(before);
    assert.equal(
      code(() => applyMaterial(before, job('r0', 'reading', 1), hostile)),
      'unknown_key',
      JSON.stringify(Object.keys(smuggled)),
    );
    assert.equal(JSON.stringify(before), snapshot);
  }
});

test('a rejected import leaves the attempt untouched', () => {
  const before = draft();
  const snapshot = JSON.stringify(before);
  const bad = readingBlock();
  bad.questions = bad.questions.slice(0, 3);
  assert.notEqual(code(() => applyMaterial(before, job('r0', 'reading', 1), bad)), 'NO_THROW');
  assert.equal(JSON.stringify(before), snapshot);
});

test('materialComplete is false until every job is prepared', () => {
  const t = draft();
  assert.equal(materialComplete(t), false);
  const one = applyMaterial(t, job('l0', 'listening', 1), listeningBlock());
  assert.equal(materialComplete(one), false);
});

test('applying the same job twice does not duplicate its prepared key', () => {
  let t = draft();
  t = applyMaterial(t, job('l0', 'listening', 1), listeningBlock());
  t = applyMaterial(t, job('l0', 'listening', 1), listeningBlock());
  assert.deepEqual(t.prepared, ['l0']);
});

// ─── Writing and Speaking via applyMaterial ───

type WritingPayload = {
  tasks: {
    title: string;
    prompt: string;
    minimum: number;
    visual: {
      type: 'table' | 'bar' | 'line' | 'process';
      caption: string;
      columns: string[];
      rows: string[][];
    } | null;
  }[];
};

const writingFull = (): WritingPayload => ({
  tasks: [
    {
      title: 'Chart task',
      prompt: 'Summarise the information by selecting and reporting the main features.',
      minimum: 150,
      visual: {
        type: 'bar',
        caption: 'Monthly visitors in thousands, 2024',
        columns: ['Month', 'North', 'South'],
        rows: [
          ['January', '120', '90'],
          ['February', '135', '95'],
          ['March', '150', '110'],
        ],
      },
    },
    {
      title: 'Essay task',
      prompt: 'To what extent do you agree that remote work benefits society?',
      minimum: 250,
      visual: null,
    },
  ],
});

test('a valid two-task Writing payload applies and records both tasks', () => {
  const t = applyMaterial(draft(), job('w', 'writing', 0), writingFull());
  assert.equal(t.writing.length, 2);
  assert.deepEqual(t.prepared, ['w']);
});

test('a Writing minimum of 160 is rejected; only exact 150 and 250 pass', () => {
  const bad = writingFull();
  bad.tasks[0]!.minimum = 160;
  assert.equal(code(() => applyMaterial(draft(), job('w', 'writing', 0), bad)), 'writing_minimum');
});

test('a Task 2 with a non-null visual is rejected', () => {
  const bad = writingFull();
  bad.tasks[1]!.visual = writingFull().tasks[0]!.visual;
  assert.equal(code(() => applyMaterial(draft(), job('w', 'writing', 0), bad)), 'writing_visual');
});

test('a non-rectangular visual is rejected', () => {
  const bad = writingFull();
  bad.tasks[0]!.visual!.rows = [['January', '120'], ['February', '135', '95', 'extra'], ['March', '150', '110']];
  assert.equal(code(() => applyMaterial(draft(), job('w', 'writing', 0), bad)), 'visual_rectangular');
});

test('a blank numeric cell is rejected rather than read as zero', () => {
  const bad = writingFull();
  bad.tasks[0]!.visual!.rows = [['January', '120', '  '], ['February', '135', '95'], ['March', '150', '110']];
  assert.equal(code(() => applyMaterial(draft(), job('w', 'writing', 0), bad)), 'visual_numeric');
});

test('a process visual must have exactly two columns', () => {
  const bad = writingFull();
  bad.tasks[0]!.visual = {
    type: 'process',
    caption: 'Stages of the process',
    columns: ['Stage', 'Description', 'Owner'],
    rows: [['One', 'Begin', 'Ann'], ['Two', 'Continue', 'Bo'], ['Three', 'Finish', 'Cy']],
  };
  assert.equal(code(() => applyMaterial(draft(), job('w', 'writing', 0), bad)), 'writing_visual');
});

test('focused Writing takes exactly one task', () => {
  assert.equal(code(() => applyMaterial(draft('writing', 1), job('w', 'writing', 1), writingFull())), 'writing_task_count');
  const one = { tasks: [writingFull().tasks[0]!] };
  assert.doesNotThrow(() => applyMaterial(draft('writing', 1), job('w', 'writing', 1), one));
});

const speakingFull = () => ({
  parts: [
    { part: 1, prompt: 'Your hometown', questions: Array.from({ length: 8 }, (_, i) => `Q${i + 1}?`), cue: [] },
    { part: 2, prompt: 'Describe a skill you learned', questions: ['F1?', 'F2?'], cue: ['A', 'B', 'C', 'D'] },
    { part: 3, prompt: 'Learning skills', questions: Array.from({ length: 6 }, (_, i) => `P${i + 1}?`), cue: [] },
  ],
});

test('a valid three-part Speaking payload applies', () => {
  const t = applyMaterial(draft(), job('s', 'speaking', 0), speakingFull());
  assert.equal(t.speaking.length, 3);
  assert.equal(t.speaking[1]?.cue?.length, 4);
});

test('the wrong Speaking question count is rejected for each part', () => {
  // Wrong counts: 7 instead of 8, 1 instead of 2, 5 instead of 6. Part 2 ships with
  // exactly 2 questions, so slicing cannot ADD a third — the list is replaced.
  const wrong: [number, string[]][] = [
    [0, Array.from({ length: 7 }, (_, i) => `Q${i}?`)],
    [1, ['only one']],
    [2, Array.from({ length: 5 }, (_, i) => `P${i}?`)],
  ];
  for (const [index, questions] of wrong) {
    const bad = speakingFull();
    bad.parts[index]!.questions = questions;
    assert.equal(
      code(() => applyMaterial(draft(), job('s', 'speaking', 0), bad)),
      'speaking_count',
      `part ${index + 1}`,
    );
  }
});

test('a wrong cue length is rejected in both directions', () => {
  const short = speakingFull();
  short.parts[1]!.cue = ['A', 'B'];
  assert.equal(code(() => applyMaterial(draft(), job('s', 'speaking', 0), short)), 'speaking_cue');

  const stray = speakingFull();
  stray.parts[0]!.cue = ['unexpected'];
  assert.equal(code(() => applyMaterial(draft(), job('s', 'speaking', 0), stray)), 'speaking_cue');
});

test('out-of-order or misnumbered Speaking parts are rejected', () => {
  const bad = speakingFull();
  bad.parts[0]!.part = 2;
  assert.equal(code(() => applyMaterial(draft(), job('s', 'speaking', 0), bad)), 'speaking_parts');
});

test('focused Speaking takes exactly its own part', () => {
  const only2 = { parts: [speakingFull().parts[1]!] };
  assert.doesNotThrow(() => applyMaterial(draft('speaking', 2), job('s', 'speaking', 2), only2));
  assert.equal(code(() => applyMaterial(draft('speaking', 3), job('s', 'speaking', 3), only2)), 'speaking_parts');
});

// ─── requirements brief is transport-neutral (§5.2) ───

test('the brief never mentions a tool, endpoint or submission mechanism', () => {
  for (const j of jobsFor('full', 1)) {
    const r = requirements(draft(), j);
    const text = `${r.brief} ${r.constraints.join(' ')} ${r.targets.join(' ')}`.toLowerCase();
    for (const banned of ['save_generated_part', 'mcp', 'oauth', 'plugin', 'endpoint', 'api key', 'curl']) {
      assert.equal(text.includes(banned), false, `${j.key} mentions ${banned}`);
    }
  }
});

test('the brief quotes the focus skill as data, not as an instruction', () => {
  const t = draft('full', 1, 'listening, note completion');
  const r = requirements(t, jobsFor('full', 1)[0]!);
  assert.ok(r.brief.includes(JSON.stringify('listening, note completion')));
});

test('the brief carries the seed and lists earlier topics to avoid', () => {
  let t = draft();
  t = applyMaterial(t, job('l0', 'listening', 1), listeningBlock());
  const r = requirements(t, jobsFor('full', 1)[1]!);
  assert.ok(r.brief.includes('12345'));
  assert.ok(r.brief.includes('Community centre booking'));
});

test('hard constraints and softer authoring targets are kept separate', () => {
  const r = requirements(draft(), jobsFor('full', 1)[0]!);
  assert.ok(r.constraints.some((c) => c.includes('620 and 950')));
  assert.ok(r.targets.some((t) => t.includes('750-850')));
  assert.equal(r.constraints.some((c) => c.includes('750-850')), false);
});
