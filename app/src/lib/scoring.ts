// §5.1, §6, §8: Objective Scoring, Normalization, Deterministic Aggregates & Weakness Ranking
// Pure code logic with zero AI hallucination. Code computes every number (§2 Hard Rule 1).

// ─── Section 6 Taxonomies ───

export const SKILL_TAGS = [
  'scanning',
  'skimming_main_idea',
  'inference',
  'writer_view',
  'detail_matching',
  'paraphrase_recognition',
  'heading_matching',
  'numbers_spelling',
  'map_orientation',
  'diagram_reading',
  'lecture_note_taking',
  'speaker_attitude',
  'distractor_resistance',
  'grammar_structure',
  'vocabulary_range',
  'cohesion_devices',
] as const;

export type SkillTag = (typeof SKILL_TAGS)[number];

export const MISTAKE_TAGS = [
  'not_given_vs_false',
  'false_vs_not_given_confusion',
  'partial_truth_trap',
  'qualifier_missed',
  'self_correction_missed',
  'similar_sound',
  'spelling',
  'over_word_limit',
  'wrong_paragraph',
  'heading_main_idea_vs_detail',
  'map_direction_error',
  'number_format',
  'time_pressure_blank',
  'changed_correct_to_wrong',
  'grammar_agreement',
  'grammar_tense',
  'grammar_article',
  'grammar_preposition',
  'grammar_word_form',
] as const;

export type MistakeTag = (typeof MISTAKE_TAGS)[number];

// ─── Section 3 Answer Capture Schemas ───

export type ObjectiveAnswerRecord = {
  q: number;
  item_id: string;
  group_id: string;
  type: 'tfng' | 'ynng' | 'mcq' | 'gap' | 'matching' | 'map_label' | 'short' | 'flow' | 'grammar';
  user_answer: string | string[] | null;
  time_spent_ms?: number;
  changed_answer_count?: number;
  flagged?: boolean;
};

export type ObjectiveSection = {
  duration_s: number;
  answers: ObjectiveAnswerRecord[];
};

export type WritingTaskRecord = {
  task: 1 | 2;
  prompt_id: string;
  text: string;
  word_count: number;
  duration_s: number;
  revisions?: number;
};

export type WritingSection = {
  tasks: WritingTaskRecord[];
};

export type SpeechMetrics = {
  words_per_minute: number;
  mean_length_of_run: number;
  pause_count_over_1s: number;
  filler_rate: number;
  self_repair_count: number;
  speaking_time_vs_expected: number;
  type_token_ratio: number;
  complex_clause_count?: number;
};

export type SpeakingPartRecord = {
  part: 1 | 2 | 3;
  question_id: string;
  audio_url: string;
  transcript: string;
  words: { w: string; start: number; end: number; conf: number }[];
  duration_s: number;
  prep_s?: number;
  metrics?: SpeechMetrics;
};

export type SpeakingSection = {
  parts: SpeakingPartRecord[];
};

export type Attempt = {
  attempt_id: string;
  test_id: string;
  started_at: string;
  finished_at: string;
  mode?: 'timed' | 'untimed';
  sections: {
    listening?: ObjectiveSection;
    reading?: ObjectiveSection;
    grammar?: ObjectiveSection;
    writing?: WritingSection;
    speaking?: SpeakingSection;
  };
};

// ─── Section 4 Answer Key Schema (stored with generated material) ───

export type KeyItem = {
  item_id: string;
  q: number;
  type: string;
  skill: SkillTag;
  target_band: number;
  correct_answer: string | string[];
  accepted_alternatives: string[];
  word_limit?: number;
  evidence: {
    source: 'passage' | 'transcript';
    paragraph?: string;
    timestamp_s?: number;
    quote: string;
  };
  explanation: string;
  paraphrase_map?: { question_wording: string; source_wording: string }[];
  distractor_notes?: { option: string; why_tempting: string; why_wrong: string }[];
  common_mistake_tag: MistakeTag;
  strategy_tip: string;
};

// ─── Section 7 Review Types ───

export type ItemReview = {
  q: number;
  item_id: string;
  group_id?: string;
  type?: string;
  skill: SkillTag;
  target_band: number;
  correct: boolean;
  error_flag?: 'spelling' | 'over_word_limit' | null;
  user_answer: string | null;
  correct_answer: string;
  accepted_alternatives?: string[];
  evidence_quote: string;
  explanation: string;
  personal_note?: string;
  learner_mistake_tag?: MistakeTag;
  strategy_tip: string;
  paraphrase_map?: { question_wording: string; source_wording: string }[];
  distractor_notes?: { option: string; why_tempting: string; why_wrong: string }[];
  jump_to?: { source: 'passage' | 'transcript'; paragraph?: string; timestamp_s?: number };
};

// ─── Section 8 Aggregates & Weakness Types ───

export type Aggregates = {
  by_question_type: { type: string; correct: number; total: number; accuracy: number }[];
  by_skill: { skill: SkillTag; correct: number; total: number; accuracy: number }[];
  by_mistake_tag: { tag: MistakeTag; count: number; item_ids: string[] }[];
  by_difficulty: { band_range: string; accuracy: number }[];
  time: {
    section: string;
    planned_s: number;
    used_s: number;
    per_passage_s?: number[];
    blanks_in_last_quarter: number;
  };
  writing_error_categories: {
    category: string;
    count: number;
    severity_major: number;
    example_spans: string[];
  }[];
  criterion_bands: Record<string, number>;
  speech_metrics?: SpeechMetrics;
  history?: { attempt_id: string; date: string; module_bands: Record<string, number> }[];
};

export type DrillRequest = {
  job: 'r1' | 'r2' | 'r3' | 'l1' | 'l2' | 'l3' | 'l4' | 'w1' | 'w2' | 's1' | 's2' | 's3' | 'g';
  focus: SkillTag | MistakeTag | string;
  count: number;
};

export type WeaknessItem = {
  rank: number;
  title: string;
  module: 'listening' | 'reading' | 'writing' | 'speaking' | 'grammar';
  evidence: {
    stat: string;
    item_ids: string[];
    quotes: string[];
  };
  likely_cause: string;
  fixes: string[];
  drill: DrillRequest;
  impact_score: number;
  trend?: 'improving' | 'flat' | 'declining';
};

export type StrengthItem = {
  title: string;
  evidence: string;
};

export type SevenDayPlanDay = {
  day: number;
  minutes: number;
  tasks: {
    type: 'drill' | 'technique' | 'review';
    text: string;
    drill?: DrillRequest | null;
  }[];
};

export type WeaknessProfile = {
  summary: string;
  weaknesses: WeaknessItem[];
  strengths: StrengthItem[];
  seven_day_plan: SevenDayPlanDay[];
};

// ─── Section 9 Final Report Schema ───

export type FinalReport = {
  attempt_id: string;
  test_id: string;
  label: 'Estimated band, not an official IELTS result';
  overall: {
    band: number | null;
    method: 'mean of 4 modules, IELTS rounding' | 'partial results (incomplete modules)';
  };
  modules: {
    listening?: { raw: number; of: number; band: number | null };
    reading?: { raw: number; of: number; band: number | null };
    grammar?: { raw: number; of: number; accuracy: number; band: number };
    writing?: {
      band: number | null;
      task1?: number | null;
      task2?: number | null;
      criteria?: { TR_TA: number; CC: number; LR: number; GRA: number };
      confidence: 'high' | 'medium' | 'low';
      status?: 'assessed' | 'unattempted' | 'pending';
    };
    speaking?: {
      band: number | null;
      criteria?: { FC: number; LR: number; GRA: number; PR: number };
      confidence: 'high' | 'medium' | 'low';
      status?: 'assessed' | 'unattempted' | 'pending';
    };
  };
  aggregates: Aggregates;
  weakness_profile: WeaknessProfile;
  review: {
    listening: ItemReview[];
    reading: ItemReview[];
    grammar?: ItemReview[];
    writing: {
      tasks: {
        task: 1 | 2;
        band: number;
        criteria: Record<string, { band: number; evidence: { quote: string; comment: string }[]; next_band_gap: string }>;
        errors: {
          span: string;
          start: number;
          end: number;
          category: string;
          correction: string;
          explanation: string;
          severity: 'minor' | 'major';
        }[];
        upgrade_rewrite?: {
          original_paragraphs: string[];
          rewritten_paragraphs: string[];
          annotations: { original: string; improved: string; reason: string; criterion: string }[];
        };
        model_answer?: string;
        structure_comparison?: {
          learner_intro: string;
          model_intro: string;
          learner_body: string[];
          model_body: string[];
        };
        strengths: string[];
        priority_fixes: string[];
      }[];
    };
    speaking: {
      parts: {
        part: 1 | 2 | 3;
        transcript: string;
        highlights: { span: string; type: 'filler' | 'repair' | 'word_choice'; note: string }[];
        metrics?: {
          words_per_minute: number;
          mean_length_of_run: number;
          pause_count_over_1s: number;
          filler_rate: number;
          self_repair_count: number;
          speaking_time_vs_expected: number;
          type_token_ratio: number;
        };
        improved_answer?: string;
        vocab_upgrades: { original: string; upgraded: string; context: string }[];
        pronunciation_words?: { word: string; tip: string }[];
        cue_card_outline?: string[];
      }[];
    };
  };
  confidence_notes: string[];
  generated_at: string;
};

// ─── Normalization & Text Processing (§5.1) ───

const WORD_NUMBERS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
  thousand: '1000',
};

const US_UK_SPELLINGS: Record<string, string> = {
  color: 'colour',
  flavor: 'flavour',
  honor: 'honour',
  neighbor: 'neighbour',
  rumor: 'rumour',
  center: 'centre',
  theater: 'theatre',
  meter: 'metre',
  fiber: 'fibre',
  organize: 'organise',
  realize: 'realise',
  analyze: 'analyse',
  defense: 'defence',
  license: 'licence',
  traveling: 'travelling',
  program: 'programme',
};

/**
 * Normalizes text per §5.1:
 * - lowercase, trim, collapse whitespace
 * - remove standard punctuation (commas, periods, exclamation, question marks)
 * - strip leading articles (a, an, the)
 * - map written numbers to digits
 * - map common US/UK spelling variants
 */
export function normalizeAnswer(raw: string): string {
  if (!raw) return '';
  let s = raw.trim().toLowerCase();

  // Strip punctuation
  s = s.replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, ' ');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  // Strip leading articles
  s = s.replace(/^(a|an|the)\s+/i, '');

  // Map individual words
  const tokens = s.split(' ').map((word) => {
    const num = WORD_NUMBERS[word];
    if (num) return num;
    const uk = US_UK_SPELLINGS[word];
    if (uk) return uk;
    return word;
  });

  return tokens.join(' ').trim();
}

/**
 * Counts words in a string accurately.
 */
export function countWords(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Calculates Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 0; i <= m; i++) {
    const row = dp[i];
    if (row) row[0] = i;
  }
  const row0 = dp[0];
  if (row0) {
    for (let j = 0; j <= n; j++) row0[j] = j;
  }

  for (let i = 1; i <= m; i++) {
    const currRow = dp[i];
    const prevRow = dp[i - 1];
    if (!currRow || !prevRow) continue;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = (prevRow[j] ?? 0) + 1;
      const ins = (currRow[j - 1] ?? 0) + 1;
      const sub = (prevRow[j - 1] ?? 0) + cost;
      currRow[j] = Math.min(del, ins, sub);
    }
  }

  return dp[m]?.[n] ?? 0;
}

/**
 * Substring quote validator (§2 Hard Rule 3):
 * Verifies that the AI's claimed quote is a genuine verbatim substring of the source
 * and is under 15 words.
 */
export function verifyQuoteSubstring(
  quote: string,
  sourceText: string,
  maxWords = 15,
): { valid: boolean; reason?: string } {
  if (!quote || !quote.trim()) {
    return { valid: false, reason: 'Quote is empty.' };
  }

  const trimmedQuote = quote.trim();
  const wc = countWords(trimmedQuote);
  if (wc > maxWords) {
    return {
      valid: false,
      reason: `Quote exceeds maximum limit of ${maxWords} words (${wc} words).`,
    };
  }

  // Normalize internal whitespace for clean substring matching
  const cleanSource = sourceText.replace(/\s+/g, ' ').toLowerCase();
  const cleanQuote = trimmedQuote.replace(/\s+/g, ' ').toLowerCase();

  if (!cleanSource.includes(cleanQuote)) {
    return {
      valid: false,
      reason: `Quote "${trimmedQuote}" is not an exact verbatim substring of the text.`,
    };
  }

  return { valid: true };
}

// ─── Objective Scorer (§5.1 & §6.2) ───

export type ScoredObjectiveItem = {
  q: number;
  item_id: string;
  group_id?: string;
  type?: string;
  skill: SkillTag;
  target_band: number;
  correct: boolean;
  error_flag: 'spelling' | 'over_word_limit' | null;
  user_answer: string | null;
  correct_answer: string;
  accepted_alternatives: string[];
  evidence_quote: string;
  explanation: string;
  learner_mistake_tag?: MistakeTag;
  strategy_tip: string;
  paraphrase_map?: { question_wording: string; source_wording: string }[];
  distractor_notes?: { option: string; why_tempting: string; why_wrong: string }[];
  jump_to?: { source: 'passage' | 'transcript'; paragraph?: string; timestamp_s?: number };
};

/**
 * Scores an individual objective item deterministically using code rules (§5.1).
 */
export function scoreObjectiveItem(
  keyItem: KeyItem,
  userAnswer: string | string[] | null | undefined,
  options?: {
    groupId?: string;
    isLastQuarter?: boolean;
    changedCount?: number;
  },
): ScoredObjectiveItem {
  const normUser = typeof userAnswer === 'string' ? normalizeAnswer(userAnswer) : '';
  const isBlank = userAnswer === null || userAnswer === undefined || normUser === '';

  const correctAnswersList = Array.isArray(keyItem.correct_answer)
    ? keyItem.correct_answer
    : [keyItem.correct_answer];
  const allAccepted = [...correctAnswersList, ...(keyItem.accepted_alternatives || [])];
  const normAccepted = allAccepted.map(normalizeAnswer).filter(Boolean);

  let isCorrect = false;
  let errorFlag: 'spelling' | 'over_word_limit' | null = null;

  if (isBlank) {
    isCorrect = false;
  } else {
    // Check word limit (§5.1 step 2)
    if (keyItem.word_limit && typeof userAnswer === 'string') {
      const wc = countWords(userAnswer);
      if (wc > keyItem.word_limit) {
        isCorrect = false;
        errorFlag = 'over_word_limit';
      }
    }

    if (!errorFlag) {
      // Check exact normalized match
      isCorrect = normAccepted.some((accepted) => accepted === normUser);

      // Check for spelling error flag (§5.1 step 3):
      // If incorrect, check if normalized answer is within edit distance 1-2 of any accepted answer
      if (!isCorrect && normUser.length >= 3) {
        const isNearMiss = normAccepted.some((accepted) => {
          if (accepted.length < 3) return false;
          const dist = levenshteinDistance(normUser, accepted);
          return dist >= 1 && dist <= 2;
        });
        if (isNearMiss) {
          errorFlag = 'spelling';
        }
      }
    }
  }

  // Derive actual mistake tag (§6.2)
  let learnerMistakeTag: MistakeTag | undefined = undefined;
  if (!isCorrect) {
    if (errorFlag === 'over_word_limit') {
      learnerMistakeTag = 'over_word_limit';
    } else if (errorFlag === 'spelling') {
      learnerMistakeTag = 'spelling';
    } else if (isBlank && options?.isLastQuarter) {
      learnerMistakeTag = 'time_pressure_blank';
    } else if (options?.changedCount && options.changedCount > 0) {
      learnerMistakeTag = 'changed_correct_to_wrong';
    } else {
      learnerMistakeTag = keyItem.common_mistake_tag || 'qualifier_missed';
    }
  }

  const primaryCorrect = Array.isArray(keyItem.correct_answer)
    ? keyItem.correct_answer.join(' / ')
    : keyItem.correct_answer;

  return {
    q: keyItem.q,
    item_id: keyItem.item_id,
    group_id: options?.groupId,
    type: keyItem.type,
    skill: keyItem.skill,
    target_band: keyItem.target_band,
    correct: isCorrect,
    error_flag: errorFlag,
    user_answer: isBlank ? null : typeof userAnswer === 'string' ? userAnswer : JSON.stringify(userAnswer),
    correct_answer: primaryCorrect,
    accepted_alternatives: keyItem.accepted_alternatives || [],
    evidence_quote: keyItem.evidence?.quote || '',
    explanation: keyItem.explanation,
    learner_mistake_tag: learnerMistakeTag,
    strategy_tip: keyItem.strategy_tip,
    paraphrase_map: keyItem.paraphrase_map,
    distractor_notes: keyItem.distractor_notes,
    jump_to: keyItem.evidence
      ? {
          source: keyItem.evidence.source,
          paragraph: keyItem.evidence.paragraph,
          timestamp_s: keyItem.evidence.timestamp_s,
        }
      : undefined,
  };
}

// ─── Aggregates (§8.1) ───

export function computeAggregates(
  scoredItems: ScoredObjectiveItem[],
  options?: {
    durationS?: number;
    plannedS?: number;
    writingErrorCategories?: { category: string; count: number; severity_major: number; example_spans: string[] }[];
    criterionBands?: Record<string, number>;
    speechMetrics?: SpeechMetrics;
    history?: { attempt_id: string; date: string; module_bands: Record<string, number> }[];
  },
): Aggregates {
  // 1. By Question Type
  const typeMap = new Map<string, { correct: number; total: number }>();
  for (const item of scoredItems) {
    const t = item.type || 'unknown';
    const curr = typeMap.get(t) || { correct: 0, total: 0 };
    curr.total += 1;
    if (item.correct) curr.correct += 1;
    typeMap.set(t, curr);
  }
  const by_question_type = Array.from(typeMap.entries()).map(([type, stats]) => ({
    type,
    correct: stats.correct,
    total: stats.total,
    accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
  }));

  // 2. By Skill
  const skillMap = new Map<SkillTag, { correct: number; total: number }>();
  for (const item of scoredItems) {
    const s = item.skill;
    const curr = skillMap.get(s) || { correct: 0, total: 0 };
    curr.total += 1;
    if (item.correct) curr.correct += 1;
    skillMap.set(s, curr);
  }
  const by_skill = Array.from(skillMap.entries()).map(([skill, stats]) => ({
    skill,
    correct: stats.correct,
    total: stats.total,
    accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
  }));

  // 3. By Mistake Tag
  const mistakeMap = new Map<MistakeTag, { count: number; item_ids: string[] }>();
  for (const item of scoredItems) {
    if (!item.correct && item.learner_mistake_tag) {
      const tag = item.learner_mistake_tag;
      const curr = mistakeMap.get(tag) || { count: 0, item_ids: [] };
      curr.count += 1;
      curr.item_ids.push(item.item_id);
      mistakeMap.set(tag, curr);
    }
  }
  const by_mistake_tag = Array.from(mistakeMap.entries()).map(([tag, data]) => ({
    tag,
    count: data.count,
    item_ids: data.item_ids,
  }));

  // 4. By Difficulty
  const diffBuckets = [
    { label: 'Band 4.0 - 5.5 (Easy)', min: 4.0, max: 5.5, correct: 0, total: 0 },
    { label: 'Band 6.0 - 7.0 (Medium)', min: 6.0, max: 7.0, correct: 0, total: 0 },
    { label: 'Band 7.5 - 9.0 (Hard)', min: 7.5, max: 9.0, correct: 0, total: 0 },
  ];
  for (const item of scoredItems) {
    const tb = item.target_band || 6.0;
    const defaultBucket = diffBuckets[1]!;
    const bucket = diffBuckets.find((b) => tb >= b.min && tb <= b.max) ?? defaultBucket;
    bucket.total += 1;
    if (item.correct) bucket.correct += 1;
  }
  const by_difficulty = diffBuckets.map((b) => ({
    band_range: b.label,
    accuracy: b.total > 0 ? b.correct / b.total : 0,
  }));

  // 5. Time & Blanks in last quarter
  const totalItems = scoredItems.length;
  const quarterThreshold = Math.floor(totalItems * 0.75);
  const blanks_in_last_quarter = scoredItems
    .slice(quarterThreshold)
    .filter((it) => it.user_answer === null).length;

  return {
    by_question_type,
    by_skill,
    by_mistake_tag,
    by_difficulty,
    time: {
      section: 'overall',
      planned_s: options?.plannedS ?? 3600,
      used_s: options?.durationS ?? 0,
      blanks_in_last_quarter,
    },
    writing_error_categories: options?.writingErrorCategories ?? [],
    criterion_bands: options?.criterionBands ?? {},
    speech_metrics: options?.speechMetrics,
    history: options?.history ?? [],
  };
}

// ─── Weakness Ranking (§8.2) ───

const FREQUENCY_WEIGHTS: Record<string, number> = {
  // Question types frequency
  gap: 12,
  mcq: 10,
  tfng: 8,
  ynng: 6,
  matching: 8,
  map_label: 5,
  short: 4,
  flow: 4,
  grammar: 6,
  // Skills frequency
  scanning: 10,
  detail_matching: 10,
  paraphrase_recognition: 12,
  inference: 8,
  writer_view: 6,
  skimming_main_idea: 8,
  numbers_spelling: 6,
  map_orientation: 5,
  lecture_note_taking: 10,
  distractor_resistance: 10,
  cohesion_devices: 8,
  vocabulary_range: 8,
  grammar_structure: 8,
};

export function rankWeaknesses(
  aggregates: Aggregates,
  targetBand = 7.0,
  currentBand = 6.0,
): { weaknesses: WeaknessItem[]; strengths: StrengthItem[] } {
  const gapToTarget = Math.max(0.5, targetBand - currentBand);
  const candidateWeaknesses: WeaknessItem[] = [];
  const candidateStrengths: StrengthItem[] = [];

  // Analyze skills
  for (const s of aggregates.by_skill) {
    if (s.total >= 3) {
      if (s.accuracy < 0.65) {
        const freq = FREQUENCY_WEIGHTS[s.skill] || 6;
        const impact = (1 - s.accuracy) * freq * gapToTarget;
        const countWrong = Math.round(s.total * (1 - s.accuracy));

        candidateWeaknesses.push({
          rank: 0,
          title: `Skill Gap: ${formatSkillName(s.skill)}`,
          module: 'reading',
          evidence: {
            stat: `${formatSkillName(s.skill)} accuracy ${s.total - countWrong}/${s.total} (${Math.round(s.accuracy * 100)}%)`,
            item_ids: [],
            quotes: [],
          },
          likely_cause: `Learner struggles to decode paraphrasing or traps related to ${formatSkillName(s.skill)}.`,
          fixes: [
            `Scan for contextual synonyms before reading detail sentences.`,
            `Identify qualifying adverbs that reverse or restrict meaning.`,
          ],
          drill: {
            job: 'r1',
            focus: s.skill,
            count: 8,
          },
          impact_score: impact,
        });
      } else if (s.accuracy >= 0.85) {
        candidateStrengths.push({
          title: `Strong Mastery of ${formatSkillName(s.skill)}`,
          evidence: `Achieved ${Math.round(s.accuracy * 100)}% accuracy across ${s.total} test items.`,
        });
      }
    }
  }

  // Analyze question types
  for (const qt of aggregates.by_question_type) {
    if (qt.total >= 3) {
      if (qt.accuracy < 0.65) {
        const freq = FREQUENCY_WEIGHTS[qt.type] || 6;
        const impact = (1 - qt.accuracy) * freq * gapToTarget;
        const countWrong = Math.round(qt.total * (1 - qt.accuracy));

        candidateWeaknesses.push({
          rank: 0,
          title: `Question Type Vulnerability: ${qt.type.toUpperCase()}`,
          module: qt.type === 'map_label' ? 'listening' : 'reading',
          evidence: {
            stat: `${qt.type.toUpperCase()} accuracy ${qt.total - countWrong}/${qt.total} (${Math.round(qt.accuracy * 100)}%)`,
            item_ids: [],
            quotes: [],
          },
          likely_cause: `Fell for distractor options or misaligned boundary conditions.`,
          fixes: [
            `Read rubrics strictly and verify exact word counts and grammar fit.`,
            `Eliminate options with unstated claims for Not Given questions.`,
          ],
          drill: {
            job: qt.type === 'map_label' ? 'l2' : 'r2',
            focus: qt.type,
            count: 10,
          },
          impact_score: impact,
        });
      } else if (qt.accuracy >= 0.85) {
        candidateStrengths.push({
          title: `High Precision in ${qt.type.toUpperCase()}`,
          evidence: `Scored ${Math.round(qt.accuracy * 100)}% on ${qt.total} questions.`,
        });
      }
    }
  }

  // Analyze mistake tags
  for (const mt of aggregates.by_mistake_tag) {
    if (mt.count >= 2) {
      const impact = mt.count * 2.5 * gapToTarget;
      candidateWeaknesses.push({
        rank: 0,
        title: `Persistent Habit: ${formatMistakeName(mt.tag)}`,
        module: 'reading',
        evidence: {
          stat: `${mt.count} questions missed due to ${formatMistakeName(mt.tag)}`,
          item_ids: mt.item_ids.slice(0, 3),
          quotes: [],
        },
        likely_cause: `Repeatedly triggered by ${formatMistakeName(mt.tag)}.`,
        fixes: [
          `Double-check source evidence before locking in an answer.`,
          `Keep a personal mistake log targeting this specific pitfall.`,
        ],
        drill: {
          job: 'r1',
          focus: mt.tag,
          count: 8,
        },
        impact_score: impact,
      });
    }
  }

  // Sort weaknesses by impact score descending
  candidateWeaknesses.sort((a, b) => b.impact_score - a.impact_score);

  // Take top 5 weaknesses
  const topWeaknesses = candidateWeaknesses.slice(0, 5).map((w, index) => ({
    ...w,
    rank: index + 1,
  }));

  // Take top 3 strengths
  const topStrengths = candidateStrengths.slice(0, 3);

  return { weaknesses: topWeaknesses, strengths: topStrengths };
}

function formatSkillName(s: string): string {
  return s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatMistakeName(m: string): string {
  return m
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
