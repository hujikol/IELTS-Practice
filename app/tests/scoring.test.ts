import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rawToListeningBand,
  rawToReadingBand,
  roundIeltsOverallBand,
  calculateOverallBand,
  roundToHalfBand,
  calculateWritingBand,
  calculateSpeakingBand,
  ieltsBandToCefr,
} from '../src/lib/bands.ts';
import {
  normalizeAnswer,
  countWords,
  levenshteinDistance,
  verifyQuoteSubstring,
  scoreObjectiveItem,
  computeAggregates,
  rankWeaknesses,
  type KeyItem,
} from '../src/lib/scoring.ts';

// ─── 1. Band Table Tests (§5.1) ───

test('rawToListeningBand matches official academic table', () => {
  assert.equal(rawToListeningBand(40), 9.0);
  assert.equal(rawToListeningBand(39), 9.0);
  assert.equal(rawToListeningBand(38), 8.5);
  assert.equal(rawToListeningBand(37), 8.5);
  assert.equal(rawToListeningBand(36), 8.0);
  assert.equal(rawToListeningBand(35), 8.0);
  assert.equal(rawToListeningBand(34), 7.5);
  assert.equal(rawToListeningBand(32), 7.5);
  assert.equal(rawToListeningBand(31), 7.0);
  assert.equal(rawToListeningBand(30), 7.0);
  assert.equal(rawToListeningBand(29), 6.5);
  assert.equal(rawToListeningBand(26), 6.5);
  assert.equal(rawToListeningBand(25), 6.0);
  assert.equal(rawToListeningBand(23), 6.0);
  assert.equal(rawToListeningBand(22), 5.5);
  assert.equal(rawToListeningBand(18), 5.5);
  assert.equal(rawToListeningBand(17), 5.0);
  assert.equal(rawToListeningBand(16), 5.0);
  assert.equal(rawToListeningBand(15), 4.5);
  assert.equal(rawToListeningBand(13), 4.5);
  assert.equal(rawToListeningBand(12), 4.0);
  assert.equal(rawToListeningBand(10), 4.0);
  assert.equal(rawToListeningBand(0), 1.0);
});

test('rawToReadingBand matches official academic table', () => {
  assert.equal(rawToReadingBand(40), 9.0);
  assert.equal(rawToReadingBand(39), 9.0);
  assert.equal(rawToReadingBand(38), 8.5);
  assert.equal(rawToReadingBand(37), 8.5);
  assert.equal(rawToReadingBand(36), 8.0);
  assert.equal(rawToReadingBand(35), 8.0);
  assert.equal(rawToReadingBand(34), 7.5);
  assert.equal(rawToReadingBand(33), 7.5);
  assert.equal(rawToReadingBand(32), 7.0);
  assert.equal(rawToReadingBand(30), 7.0);
  assert.equal(rawToReadingBand(29), 6.5);
  assert.equal(rawToReadingBand(27), 6.5);
  assert.equal(rawToReadingBand(26), 6.0);
  assert.equal(rawToReadingBand(23), 6.0);
  assert.equal(rawToReadingBand(22), 5.5);
  assert.equal(rawToReadingBand(19), 5.5);
  assert.equal(rawToReadingBand(18), 5.0);
  assert.equal(rawToReadingBand(15), 5.0);
  assert.equal(rawToReadingBand(14), 4.5);
  assert.equal(rawToReadingBand(13), 4.5);
  assert.equal(rawToReadingBand(12), 4.0);
  assert.equal(rawToReadingBand(10), 4.0);
  assert.equal(rawToReadingBand(0), 1.0);
});

// ─── 2. IELTS Rounding Tests (§5.4 & §11) ───

test('roundIeltsOverallBand executes exact official rounding rules', () => {
  // Average ending in .25 rounds up to next half band
  assert.equal(roundIeltsOverallBand(6.25), 6.5);
  assert.equal(roundIeltsOverallBand(7.25), 7.5);

  // Average ending in .75 rounds up to next whole band
  assert.equal(roundIeltsOverallBand(6.75), 7.0);
  assert.equal(roundIeltsOverallBand(5.75), 6.0);

  // Exact whole and half bands stay unchanged
  assert.equal(roundIeltsOverallBand(6.0), 6.0);
  assert.equal(roundIeltsOverallBand(6.5), 6.5);

  // Boundary cases: .125 rounds down to .0; .25 rounds up to .5; .75 rounds up to 1.0
  assert.equal(roundIeltsOverallBand(6.125), 6.0);
  assert.equal(roundIeltsOverallBand(6.12), 6.0);
  assert.equal(roundIeltsOverallBand(6.375), 6.5);
  assert.equal(roundIeltsOverallBand(6.625), 6.5);
  assert.equal(roundIeltsOverallBand(6.875), 7.0);
});

test('calculateOverallBand returns null on incomplete modules and exact rounded band when complete', () => {
  // Incomplete
  assert.equal(calculateOverallBand({ listening: 6.5, reading: 6.0, writing: 6.0 }), null);
  assert.equal(calculateOverallBand({ listening: null, reading: 6.0, writing: 6.0, speaking: 6.5 }), null);

  // 6.5, 6.5, 6.0, 6.0 -> mean 6.25 -> rounds up to 6.5
  assert.equal(
    calculateOverallBand({ listening: 6.5, reading: 6.5, writing: 6.0, speaking: 6.0 }),
    6.5,
  );

  // 7.0, 7.0, 6.5, 6.5 -> mean 6.75 -> rounds up to 7.0
  assert.equal(
    calculateOverallBand({ listening: 7.0, reading: 7.0, writing: 6.5, speaking: 6.5 }),
    7.0,
  );
});

test('calculateWritingBand and calculateSpeakingBand adhere to criteria weighting', () => {
  // Writing Task 1 = 6.0, Task 2 = 7.0 -> (6 + 14)/3 = 6.666 -> rounds to 6.5
  assert.equal(calculateWritingBand(6.0, 7.0), 6.5);

  // Speaking mean of 4 criteria: (6.5 + 6.0 + 6.5 + 7.0)/4 = 6.5
  assert.equal(calculateSpeakingBand(6.5, 6.0, 6.5, 7.0), 6.5);
});

// ─── 3. Normalization Tests (§5.1) ───

test('normalizeAnswer collapses case, punctuation, articles, and handles numbers/spelling', () => {
  assert.equal(normalizeAnswer('  The Red, Car! '), 'red car');
  assert.equal(normalizeAnswer('An Apple'), 'apple');
  assert.equal(normalizeAnswer('A library book.'), 'library book');

  // Number mapping
  assert.equal(normalizeAnswer('three days'), '3 days');
  assert.equal(normalizeAnswer('twenty minutes'), '20 minutes');

  // US/UK spelling variants
  assert.equal(normalizeAnswer('theater center'), 'theatre centre');
  assert.equal(normalizeAnswer('color and flavor'), 'colour and flavour');
  assert.equal(normalizeAnswer('organize'), 'organise');
});

// ─── 4. Word-limit Logic & Error Flag Tests (§5.1) ───

test('scoreObjectiveItem flags over_word_limit when answer exceeds limit', () => {
  const item: KeyItem = {
    item_id: 'l1-1',
    q: 1,
    type: 'gap',
    skill: 'detail_matching',
    target_band: 5.5,
    correct_answer: 'water sample',
    accepted_alternatives: [],
    word_limit: 2,
    evidence: { source: 'transcript', quote: 'water sample' },
    explanation: 'Speaker explicitly requests a water sample.',
    common_mistake_tag: 'over_word_limit',
    strategy_tip: 'Count words before writing.',
  };

  // Exactly 2 words -> correct
  const resValid = scoreObjectiveItem(item, 'water sample');
  assert.equal(resValid.correct, true);
  assert.equal(resValid.error_flag, null);

  // 3 words with correct phrase -> flagged over_word_limit and marked wrong
  const resOver = scoreObjectiveItem(item, 'the water sample');
  assert.equal(resOver.correct, false);
  assert.equal(resOver.error_flag, 'over_word_limit');
  assert.equal(resOver.learner_mistake_tag, 'over_word_limit');

  const resOver3 = scoreObjectiveItem(item, 'fresh water sample');
  assert.equal(resOver3.correct, false);
  assert.equal(resOver3.error_flag, 'over_word_limit');
  assert.equal(resOver3.learner_mistake_tag, 'over_word_limit');
});

test('helper functions roundToHalfBand, countWords, levenshteinDistance behave correctly', () => {
  assert.equal(roundToHalfBand(6.2), 6.0);
  assert.equal(roundToHalfBand(6.3), 6.5);
  assert.equal(roundToHalfBand(6.75), 7.0);

  assert.equal(countWords('hello world'), 2);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   multi   space  test  '), 3);

  assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
  assert.equal(levenshteinDistance('accommodate', 'accomodate'), 1);
  assert.equal(levenshteinDistance('same', 'same'), 0);
});

test('scoreObjectiveItem flags spelling on edit distance 1-2 near misses', () => {
  const item: KeyItem = {
    item_id: 'r1-2',
    q: 2,
    type: 'gap',
    skill: 'scanning',
    target_band: 6.0,
    correct_answer: 'government',
    accepted_alternatives: [],
    word_limit: 1,
    evidence: { source: 'passage', quote: 'government' },
    explanation: 'Refer to paragraph B.',
    common_mistake_tag: 'spelling',
    strategy_tip: 'Double-check spelling from the passage.',
  };

  // Distance 1: "goverment" (missing 'n')
  const res1 = scoreObjectiveItem(item, 'goverment');
  assert.equal(res1.correct, false);
  assert.equal(res1.error_flag, 'spelling');
  assert.equal(res1.learner_mistake_tag, 'spelling');

  // Completely wrong answer -> no spelling flag
  const resWrong = scoreObjectiveItem(item, 'university');
  assert.equal(resWrong.correct, false);
  assert.equal(resWrong.error_flag, null);
});

// ─── 5. Quote-Substring Validator Tests (§2 Hard Rule 3) ───

test('verifyQuoteSubstring validates verbatim quotes under 15 words and rejects non-substrings', () => {
  const passage = `The accelerated melting of polar ice caps is primarily attributed to anthropogenic greenhouse gas emissions, causing significant shifts in sea level equilibrium.`;

  // Exact verbatim quote (< 15 words) passes
  const valid1 = verifyQuoteSubstring('accelerated melting of polar ice caps', passage);
  assert.equal(valid1.valid, true);

  // Non-substring fails
  const invalidFake = verifyQuoteSubstring('rapid decline in Arctic animals', passage);
  assert.equal(invalidFake.valid, false);
  assert.ok(invalidFake.reason?.includes('not an exact verbatim substring'));

  // Exceeding 15 words fails
  const longQuote = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
  const invalidLong = verifyQuoteSubstring(longQuote, longQuote);
  assert.equal(invalidLong.valid, false);
  assert.ok(invalidLong.reason?.includes('exceeds maximum limit'));
});

// ─── 6. Deterministic Aggregation & Weakness Ranking Tests (§8.1 & §8.2) ───

test('computeAggregates and rankWeaknesses rank weaknesses by impact score', () => {
  const items: KeyItem[] = [
    {
      item_id: 'r-1',
      q: 1,
      type: 'tfng',
      skill: 'inference',
      target_band: 6.5,
      correct_answer: 'TRUE',
      accepted_alternatives: [],
      evidence: { source: 'passage', quote: 'test' },
      explanation: 'test',
      common_mistake_tag: 'not_given_vs_false',
      strategy_tip: 'tip',
    },
    {
      item_id: 'r-2',
      q: 2,
      type: 'tfng',
      skill: 'inference',
      target_band: 6.5,
      correct_answer: 'FALSE',
      accepted_alternatives: [],
      evidence: { source: 'passage', quote: 'test' },
      explanation: 'test',
      common_mistake_tag: 'not_given_vs_false',
      strategy_tip: 'tip',
    },
    {
      item_id: 'r-3',
      q: 3,
      type: 'tfng',
      skill: 'inference',
      target_band: 6.5,
      correct_answer: 'NOT GIVEN',
      accepted_alternatives: [],
      evidence: { source: 'passage', quote: 'test' },
      explanation: 'test',
      common_mistake_tag: 'not_given_vs_false',
      strategy_tip: 'tip',
    },
    {
      item_id: 'r-4',
      q: 4,
      type: 'mcq',
      skill: 'scanning',
      target_band: 5.5,
      correct_answer: 'B',
      accepted_alternatives: [],
      evidence: { source: 'passage', quote: 'test' },
      explanation: 'test',
      common_mistake_tag: 'qualifier_missed',
      strategy_tip: 'tip',
    },
    {
      item_id: 'r-5',
      q: 5,
      type: 'mcq',
      skill: 'scanning',
      target_band: 5.5,
      correct_answer: 'A',
      accepted_alternatives: [],
      evidence: { source: 'passage', quote: 'test' },
      explanation: 'test',
      common_mistake_tag: 'qualifier_missed',
      strategy_tip: 'tip',
    },
    {
      item_id: 'r-6',
      q: 6,
      type: 'mcq',
      skill: 'scanning',
      target_band: 5.5,
      correct_answer: 'C',
      accepted_alternatives: [],
      evidence: { source: 'passage', quote: 'test' },
      explanation: 'test',
      common_mistake_tag: 'qualifier_missed',
      strategy_tip: 'tip',
    },
  ];

  // User answers:
  // Inference (TFNG): 0 / 3 correct (accuracy 0%)
  // Scanning (MCQ): 3 / 3 correct (accuracy 100%)
  const scored = [
    scoreObjectiveItem(items[0]!, 'FALSE'), // wrong
    scoreObjectiveItem(items[1]!, 'TRUE'),  // wrong
    scoreObjectiveItem(items[2]!, 'FALSE'), // wrong
    scoreObjectiveItem(items[3]!, 'B'),     // correct
    scoreObjectiveItem(items[4]!, 'A'),     // correct
    scoreObjectiveItem(items[5]!, 'C'),     // correct
  ];

  const aggregates = computeAggregates(scored);
  assert.equal(aggregates.by_skill.find((s) => s.skill === 'inference')?.accuracy, 0);
  assert.equal(aggregates.by_skill.find((s) => s.skill === 'scanning')?.accuracy, 1);

  const { weaknesses, strengths } = rankWeaknesses(aggregates, 7.0, 5.5);

  // Weakness in inference ranked #1
  assert.ok(weaknesses.length >= 1);
  assert.ok(weaknesses[0]!.title.includes('Inference'));
  assert.ok(weaknesses[0]!.drill.focus === 'inference' || weaknesses[0]!.drill.focus === 'tfng');

  // Strength in scanning recognized
  assert.ok(strengths.length >= 1);
  assert.ok(strengths[0]!.title.includes('Scanning'));
});

// ─── 8. CEFR Level Mapping Tests ───

test('ieltsBandToCefr maps IELTS bands to official CEFR levels', () => {
  // C2 Mastery (8.5 - 9.0)
  assert.equal(ieltsBandToCefr(9.0)?.level, 'C2');
  assert.equal(ieltsBandToCefr(8.5)?.level, 'C2');

  // C1 Advanced (7.0 - 8.0)
  assert.equal(ieltsBandToCefr(8.0)?.level, 'C1');
  assert.equal(ieltsBandToCefr(7.5)?.level, 'C1');
  assert.equal(ieltsBandToCefr(7.0)?.level, 'C1');

  // B2 Upper Intermediate (5.5 - 6.5)
  assert.equal(ieltsBandToCefr(6.5)?.level, 'B2');
  assert.equal(ieltsBandToCefr(6.0)?.level, 'B2');
  assert.equal(ieltsBandToCefr(5.5)?.level, 'B2');

  // B1 Intermediate (4.0 - 5.0)
  assert.equal(ieltsBandToCefr(5.0)?.level, 'B1');
  assert.equal(ieltsBandToCefr(4.5)?.level, 'B1');
  assert.equal(ieltsBandToCefr(4.0)?.level, 'B1');

  // A2 Elementary (3.0 - 3.5)
  assert.equal(ieltsBandToCefr(3.5)?.level, 'A2');
  assert.equal(ieltsBandToCefr(3.0)?.level, 'A2');

  // A1 Beginner (< 3.0)
  assert.equal(ieltsBandToCefr(2.5)?.level, 'A1');
  assert.equal(ieltsBandToCefr(1.0)?.level, 'A1');

  // Null/undefined/zero
  assert.equal(ieltsBandToCefr(null), null);
  assert.equal(ieltsBandToCefr(undefined), null);
  assert.equal(ieltsBandToCefr(0), null);
});
