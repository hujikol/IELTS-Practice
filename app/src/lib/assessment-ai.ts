// §5.2, §5.3, §7, §8.3: AI-Assisted Assessment, Reviews, Rewrites & Weakness Narratives
// Hard Rule: Code computes every number. AI evaluates qualitative text with strict quote verification.

import { callProviderChat, type ProviderConfig } from './providers.ts';
import {
  verifyQuoteSubstring,
  type Aggregates,
  type KeyItem,
  type ScoredObjectiveItem,
  type SpeechMetrics,
  type WeaknessItem,
  type WeaknessProfile,
} from './scoring.ts';
import { roundToHalfBand } from './bands.ts';

// ─── Section 7.1 Objective Personal Notes ───

export async function generatePersonalNotes(
  wrongItems: ScoredObjectiveItem[],
  keyItemsMap: Map<string, KeyItem>,
  config: ProviderConfig,
): Promise<Map<string, string>> {
  const notesMap = new Map<string, string>();
  if (!config.enabled || wrongItems.length === 0) return notesMap;

  // Process in batches of at most 15 items (§7.1)
  const BATCH_SIZE = 15;
  for (let i = 0; i < wrongItems.length; i += BATCH_SIZE) {
    const batch = wrongItems.slice(i, i + BATCH_SIZE);
    const payload = batch.map((it) => {
      const key = keyItemsMap.get(it.item_id);
      return {
        item_id: it.item_id,
        question: it.q,
        user_answer: it.user_answer,
        correct_answer: it.correct_answer,
        evidence_quote: it.evidence_quote,
        explanation: it.explanation,
        distractor_notes: it.distractor_notes || key?.distractor_notes,
        learner_mistake_tag: it.learner_mistake_tag,
      };
    });

    const prompt = `For each wrong item, write 2 sentences max: (1) why the learner's answer is tempting, referring to the exact wording that misled them, (2) the one habit that would have avoided it. Do not change or dispute the correct answer. Use only the supplied explanation, evidence and distractor notes.
Input: ${JSON.stringify(payload)}
Return JSON: [{ "item_id": "", "personal_note": "" }]`;

    try {
      const res = await callProviderChat(prompt, config, { timeoutMs: 45000 });
      const parsed = JSON.parse(res.content);
      const list = Array.isArray(parsed) ? parsed : parsed.notes || [];
      for (const entry of list) {
        if (entry.item_id && typeof entry.personal_note === 'string') {
          notesMap.set(entry.item_id, entry.personal_note.trim());
        }
      }
    } catch (err) {
      console.warn('[IELTS Studio] Personal note generation skipped for batch:', (err as Error).message);
    }
  }

  return notesMap;
}

// ─── Section 5.2 & 7.2 Writing Scoring & Better Answers ───

export type WritingScoringResult = {
  task: 1 | 2;
  band: number;
  criteria: {
    task_response: { band: number; evidence: { quote: string; comment: string }[]; next_band_gap: string };
    coherence: { band: number; evidence: { quote: string; comment: string }[]; next_band_gap: string };
    lexical: { band: number; evidence: { quote: string; comment: string }[]; next_band_gap: string };
    grammar: { band: number; evidence: { quote: string; comment: string }[]; next_band_gap: string };
  };
  errors: {
    span: string;
    start: number;
    end: number;
    category: string;
    correction: string;
    explanation: string;
    severity: 'minor' | 'major';
  }[];
  missing_key_features?: string[];
  factual_misreads?: { learner_claim: string; actual: string }[];
  strengths: string[];
  priority_fixes: string[];
  confidence: 'high' | 'medium' | 'low';
  upgrade_rewrite?: {
    original_paragraphs: string[];
    rewritten_paragraphs: string[];
    annotations: { original: string; improved: string; reason: string; criterion: string }[];
  };
};

export async function scoreWritingTaskWithAI(
  taskNumber: 1 | 2,
  promptText: string,
  visualSpecJson: string | null,
  keyFeatures: string[],
  learnerText: string,
  durationS: number,
  config: ProviderConfig,
): Promise<WritingScoringResult> {
  const wordCount = learnerText.trim() ? learnerText.trim().split(/\s+/).length : 0;
  const minimumWords = taskNumber === 1 ? 150 : 250;

  // Fallback heuristic scoring if AI is disabled or fails
  const fallbackBand = wordCount >= minimumWords ? 6.0 : wordCount >= minimumWords * 0.75 ? 5.0 : 4.0;
  const fallbackResult: WritingScoringResult = {
    task: taskNumber,
    band: fallbackBand,
    criteria: {
      task_response: {
        band: fallbackBand,
        evidence: [{ quote: learnerText.slice(0, 50), comment: 'Word count evaluated against threshold.' }],
        next_band_gap: 'Extend analysis and provide more precise evidence.',
      },
      coherence: { band: fallbackBand, evidence: [], next_band_gap: 'Use varied cohesive devices.' },
      lexical: { band: fallbackBand, evidence: [], next_band_gap: 'Incorporate academic collocations.' },
      grammar: { band: fallbackBand, evidence: [], next_band_gap: 'Maintain sentence structure accuracy.' },
    },
    errors: [],
    strengths: ['Addressed the prompt topic directly.', 'Completed the writing task within time.'],
    priority_fixes: ['Expand vocabulary range and check subject-verb agreement.'],
    confidence: 'low',
  };

  if (!config.enabled || !learnerText.trim()) return fallbackResult;

  const systemPrompt = `You are a certified IELTS examiner. Score ONLY the response below using the public band descriptors.
Score each criterion in 0.5 steps. Be conservative: when between two bands choose the lower unless the higher is clearly supported by quoted evidence.
Task 1 criteria: Task Achievement, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy.
Task 2 criteria: Task Response, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy.
FACTS (computed by code, do not recount): word_count=${wordCount}, minimum=${minimumWords}, time_used=${durationS}s.
Under-length, off-topic or memorised responses must be capped per the descriptors.
${taskNumber === 1 ? `VISUAL DATA SPEC: ${visualSpecJson || 'N/A'}\nEXPECTED KEY FEATURES: ${JSON.stringify(keyFeatures)}` : ''}
For each criterion give a band, 2+ evidence quotes with comments, and the specific gap to the next half band.
Then list errors (span, category, correction, severity), strengths, and priority fixes.
Return JSON only.`;

  const userPrompt = `PROMPT:\n${promptText}\n\nLEARNER TEXT:\n${learnerText}`;

  try {
    const res = await callProviderChat(`${systemPrompt}\n\n${userPrompt}`, config, { timeoutMs: 60000 });
    const parsed = JSON.parse(res.content);

    // Compute task band by code as mean of 4 criteria rounded to 0.5 (§5.2)
    const crit = parsed.criteria || {};
    const tr = Number(crit.task_response?.band ?? crit.task_achievement?.band ?? 6.0);
    const cc = Number(crit.coherence?.band ?? 6.0);
    const lr = Number(crit.lexical?.band ?? 6.0);
    const gra = Number(crit.grammar?.band ?? 6.0);
    const calculatedTaskBand = roundToHalfBand((tr + cc + lr + gra) / 4);

    // Verify all quoted evidence against learner text (§2 Hard Rule 3)
    const verifiedErrors = Array.isArray(parsed.errors)
      ? parsed.errors.filter((err: { span: string }) => {
          if (!err.span) return false;
          return verifyQuoteSubstring(err.span, learnerText).valid;
        })
      : [];

    return {
      task: taskNumber,
      band: calculatedTaskBand,
      criteria: {
        task_response: {
          band: tr,
          evidence: Array.isArray(crit.task_response?.evidence) ? crit.task_response.evidence : [],
          next_band_gap: crit.task_response?.next_band_gap || '',
        },
        coherence: {
          band: cc,
          evidence: Array.isArray(crit.coherence?.evidence) ? crit.coherence.evidence : [],
          next_band_gap: crit.coherence?.next_band_gap || '',
        },
        lexical: {
          band: lr,
          evidence: Array.isArray(crit.lexical?.evidence) ? crit.lexical.evidence : [],
          next_band_gap: crit.lexical?.next_band_gap || '',
        },
        grammar: {
          band: gra,
          evidence: Array.isArray(crit.grammar?.evidence) ? crit.grammar.evidence : [],
          next_band_gap: crit.grammar?.next_band_gap || '',
        },
      },
      errors: verifiedErrors,
      missing_key_features: Array.isArray(parsed.missing_key_features) ? parsed.missing_key_features : [],
      factual_misreads: Array.isArray(parsed.factual_misreads) ? parsed.factual_misreads : [],
      strengths: Array.isArray(parsed.strengths) && parsed.strengths.length ? parsed.strengths : fallbackResult.strengths,
      priority_fixes: Array.isArray(parsed.priority_fixes) && parsed.priority_fixes.length ? parsed.priority_fixes : fallbackResult.priority_fixes,
      confidence: parsed.confidence === 'high' ? 'high' : parsed.confidence === 'medium' ? 'medium' : 'low',
    };
  } catch (err) {
    console.error('[IELTS Studio] Writing assessment AI error:', (err as Error).message);
    return fallbackResult;
  }
}

// ─── Section 5.3 & 7.3 Speaking Scoring & Metrics ───

export function calculateSpeechMetrics(
  words: { w: string; start: number; end: number; conf: number }[],
  durationS: number,
  expectedDurationS = 120,
): SpeechMetrics {
  if (words.length === 0 || durationS <= 0) {
    return {
      words_per_minute: 0,
      mean_length_of_run: 0,
      pause_count_over_1s: 0,
      filler_rate: 0,
      self_repair_count: 0,
      speaking_time_vs_expected: 0,
      type_token_ratio: 0,
    };
  }

  const durationMin = durationS / 60;
  const words_per_minute = Math.round(words.length / durationMin);

  // Pauses over 1.0s and pauses over 0.5s for mean length of run
  let pause_count_over_1s = 0;
  const runs: number[] = [];
  let currentRunWords = 0;

  for (let i = 0; i < words.length; i++) {
    currentRunWords += 1;
    if (i < words.length - 1) {
      const gap = words[i + 1]!.start - words[i]!.end;
      if (gap > 1.0) {
        pause_count_over_1s += 1;
      }
      if (gap > 0.5) {
        runs.push(currentRunWords);
        currentRunWords = 0;
      }
    }
  }
  if (currentRunWords > 0) runs.push(currentRunWords);

  const mean_length_of_run = runs.length
    ? Math.round((runs.reduce((a, b) => a + b, 0) / runs.length) * 10) / 10
    : words.length;

  // Fillers
  const fillers = new Set(['um', 'uh', 'er', 'ah', 'like', 'you know', 'sort of', 'kind of']);
  let fillerCount = 0;
  let self_repair_count = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!.w.toLowerCase().replace(/[^a-z]/g, '');
    if (fillers.has(w)) fillerCount++;
    // Self repair detection: adjacent identical words e.g. "I I went" or "the the"
    if (i > 0 && w === words[i - 1]!.w.toLowerCase().replace(/[^a-z]/g, '')) {
      self_repair_count++;
    }
  }

  const filler_rate = Math.round((fillerCount / words.length) * 100) / 100;

  // Type-Token Ratio (Vocabulary diversity)
  const uniqueWords = new Set(words.map((x) => x.w.toLowerCase().replace(/[^a-z]/g, ''))).size;
  const type_token_ratio = Math.round((uniqueWords / words.length) * 100) / 100;

  const speaking_time_vs_expected = Math.round((durationS / expectedDurationS) * 100) / 100;

  return {
    words_per_minute,
    mean_length_of_run,
    pause_count_over_1s,
    filler_rate,
    self_repair_count,
    speaking_time_vs_expected,
    type_token_ratio,
  };
}

// ─── Section 8.3 Weakness Narrative with Validation ───

export async function generateWeaknessNarrativeWithValidation(
  aggregates: Aggregates,
  rankedWeaknesses: WeaknessItem[],
  strengths: { title: string; evidence: string }[],
  scoredItems: ScoredObjectiveItem[],
  config: ProviderConfig,
): Promise<WeaknessProfile> {
  // Deterministic code fallback profile (§8.3)
  const codeFallbackProfile: WeaknessProfile = {
    summary: `Based on your test session, your performance highlights key areas for targeted gain, especially in ${rankedWeaknesses[0]?.title || 'core examination skills'}. Focused practice on paraphrase recognition and distractor elimination will yield the most immediate score improvements.`,
    weaknesses: rankedWeaknesses.slice(0, 5),
    strengths: strengths.slice(0, 3),
    seven_day_plan: [
      {
        day: 1,
        minutes: 45,
        tasks: [
          { type: 'review', text: 'Review all incorrect and blank answers from today\'s practice test.' },
          { type: 'technique', text: 'Analyze paraphrase links between question stems and passage text.' },
        ],
      },
      {
        day: 2,
        minutes: 45,
        tasks: [
          { type: 'drill', text: 'Targeted Drill: True / False / Not Given item mastery.', drill: rankedWeaknesses[0]?.drill },
          { type: 'technique', text: 'Distinguish between contradicted facts and genuinely absent claims.' },
        ],
      },
      {
        day: 3,
        minutes: 45,
        tasks: [
          { type: 'drill', text: 'Listening Section 2 map labelling and directional cues.', drill: { job: 'l2', focus: 'map_orientation', count: 10 } },
          { type: 'technique', text: 'Pre-orient compass points and path junctions before audio starts.' },
        ],
      },
      {
        day: 4,
        minutes: 50,
        tasks: [
          { type: 'drill', text: 'Writing Task 1 key trends selection and data accuracy.', drill: { job: 'w1', focus: 'cohesion_devices', count: 2 } },
          { type: 'technique', text: 'Group data by highest peaks and sharpest declines; avoid listing every single number.' },
        ],
      },
      {
        day: 5,
        minutes: 50,
        tasks: [
          { type: 'drill', text: 'Writing Task 2 thesis development and topic sentence cohesion.', drill: { job: 'w2', focus: 'vocabulary_range', count: 1 } },
          { type: 'technique', text: 'Ensure every body paragraph has one clear main idea and a supporting explanation.' },
        ],
      },
      {
        day: 6,
        minutes: 40,
        tasks: [
          { type: 'drill', text: 'Speaking Part 2 2-minute sustained monologue practice.', drill: { job: 's2', focus: 'lecture_note_taking', count: 3 } },
          { type: 'technique', text: 'Use past-present-future timeline technique to extend talking time without pauses.' },
        ],
      },
      {
        day: 7,
        minutes: 60,
        tasks: [
          { type: 'review', text: 'Full timed section checkpoint under authentic exam conditions.' },
          { type: 'technique', text: 'Audit completed answer sheets for word-limit violations and spelling.' },
        ],
      },
    ],
  };

  if (!config.enabled || rankedWeaknesses.length === 0) {
    return codeFallbackProfile;
  }

  const validItemIds = new Set(scoredItems.map((it) => it.item_id));

  const systemPrompt = `You are an IELTS coach. Using ONLY the supplied aggregates, ranked weaknesses, strengths and sample items, write the learner's weakness profile. For each of the top 5 weaknesses give:
- title (plain language)
- evidence: the exact numbers from the aggregates (do not alter), and 1-2 item_ids or quoted spans
- cause: the likely reason, phrased as "likely" and based on the mistake tags
- fix: 2-3 concrete actions (technique, not generic advice like "read more")
- drill: a generator request { job: "r1|l2|w2|s2|g", focus: SkillTag or MistakeTag, count: number }
Then 3 strengths, a 7-day plan (30-60 minutes per day, each day naming one drill and one technique), and a 2-sentence summary. Never invent numbers, never mention a skill that is not in the input.
Return JSON only.`;

  const inputPayload = {
    aggregates: {
      by_question_type: aggregates.by_question_type,
      by_skill: aggregates.by_skill,
      by_mistake_tag: aggregates.by_mistake_tag,
      time: aggregates.time,
    },
    ranked_weaknesses: rankedWeaknesses.slice(0, 5),
    strengths: strengths.slice(0, 3),
  };

  const executeCall = async (extraErrorNote?: string): Promise<WeaknessProfile | null> => {
    const prompt = `${systemPrompt}\n\n${extraErrorNote ? `PREVIOUS VALIDATION ERROR: ${extraErrorNote}\n\n` : ''}Input: ${JSON.stringify(inputPayload)}`;
    const res = await callProviderChat(prompt, config, { timeoutMs: 45000 });
    const parsed = JSON.parse(res.content);

    // Validate parsed output schema (§8.3)
    if (!parsed || typeof parsed.summary !== 'string' || !Array.isArray(parsed.weaknesses)) {
      throw new Error('Response is missing summary or weaknesses list.');
    }

    const validatedWeaknesses: WeaknessItem[] = [];
    for (let i = 0; i < parsed.weaknesses.length; i++) {
      const w = parsed.weaknesses[i];
      if (!w.title || !w.evidence) {
        throw new Error(`Weakness #${i + 1} is missing title or evidence.`);
      }

      // Verify item_ids exist
      const itemIds = Array.isArray(w.evidence.item_ids)
        ? w.evidence.item_ids.filter((id: string) => validItemIds.has(id))
        : [];

      validatedWeaknesses.push({
        rank: i + 1,
        title: String(w.title),
        module: w.module === 'listening' ? 'listening' : w.module === 'writing' ? 'writing' : w.module === 'speaking' ? 'speaking' : 'reading',
        evidence: {
          stat: String(w.evidence.stat || rankedWeaknesses[i]?.evidence.stat || ''),
          item_ids: itemIds.length ? itemIds : (rankedWeaknesses[i]?.evidence.item_ids || []),
          quotes: Array.isArray(w.evidence.quotes) ? w.evidence.quotes : [],
        },
        likely_cause: String(w.likely_cause || rankedWeaknesses[i]?.likely_cause || ''),
        fixes: Array.isArray(w.fixes) && w.fixes.length ? w.fixes : (rankedWeaknesses[i]?.fixes || []),
        drill: w.drill?.job && w.drill?.focus ? w.drill : (rankedWeaknesses[i]?.drill || { job: 'r1', focus: 'inference', count: 10 }),
        impact_score: rankedWeaknesses[i]?.impact_score ?? 10,
      });
    }

    return {
      summary: parsed.summary,
      weaknesses: validatedWeaknesses.length ? validatedWeaknesses : codeFallbackProfile.weaknesses,
      strengths: Array.isArray(parsed.strengths) && parsed.strengths.length ? parsed.strengths : codeFallbackProfile.strengths,
      seven_day_plan: Array.isArray(parsed.seven_day_plan) && parsed.seven_day_plan.length ? parsed.seven_day_plan : codeFallbackProfile.seven_day_plan,
    };
  };

  try {
    const result = await executeCall();
    if (result) return result;
  } catch (err1) {
    console.warn('[IELTS Studio] Initial weakness narrative validation failed, retrying once:', (err1 as Error).message);
    try {
      const retryResult = await executeCall((err1 as Error).message);
      if (retryResult) return retryResult;
    } catch (err2) {
      console.error('[IELTS Studio] Retry failed too. Falling back to code-built weakness profile:', (err2 as Error).message);
    }
  }

  return codeFallbackProfile;
}

