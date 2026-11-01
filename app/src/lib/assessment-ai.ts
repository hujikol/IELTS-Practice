// §5.2, §5.3, §7, §8.3: AI-Assisted Assessment, Reviews, Rewrites & Weakness Narratives
// Hard Rule: Code computes every number. AI evaluates qualitative text with strict quote verification.

import {
  callProviderChat,
  callProviderScoring,
  parseTolerantJson,
  type ProviderConfig,
} from './providers.ts';
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
import { scoreWritingTask, type WritingScoringResult, validateIeltsBand } from './writing-score.ts';

export type { WritingScoringResult };
export { validateIeltsBand };

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
      const res = await callProviderChat(prompt, config, { timeoutMs: 20000 });
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

export async function scoreWritingTaskWithAI(
  taskNumber: 1 | 2,
  promptText: string,
  visualSpecJson: string | null,
  keyFeatures: string[],
  learnerText: string,
  durationS: number,
  config: ProviderConfig,
): Promise<WritingScoringResult> {
  return scoreWritingTask(
    taskNumber,
    promptText,
    visualSpecJson,
    keyFeatures,
    learnerText,
    durationS,
    config,
  );
}

// ─── Section 5.3 & 7.3 Speaking Scoring & Metrics ───

export function areWordTimingsReal(words: { w: string; start: number; end: number; conf: number }[]): boolean {
  if (!words || words.length === 0) return false;
  if (words.length >= 2) {
    const isSynthetic = words.every(
      (w, i) =>
        Math.abs(w.end - w.start - 0.4) < 0.001 &&
        Math.abs(w.conf - 0.95) < 0.001 &&
        Math.abs(w.start - i * 0.4) < 0.001,
    );
    if (isSynthetic) return false;
  }
  return true;
}

export function calculateSpeechMetrics(
  words: { w: string; start: number; end: number; conf: number }[],
  durationS: number,
  expectedDurationS = 120,
): SpeechMetrics | null {
  if (!words || words.length === 0 || durationS <= 0 || !areWordTimingsReal(words)) {
    return null;
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

export type SpeakingScoringResult = {
  part: 1 | 2 | 3;
  status: 'scored' | 'unscored';
  unscored_reason?: 'ai_disabled' | 'ai_error' | 'too_short' | 'not_attempted' | 'no_transcript';
  unscored_detail?: string;
  band: number | null;
  criteria: {
    FC?: { band: number; comment?: string; next_band_gap: string };
    LR?: { band: number; comment?: string; next_band_gap: string };
    GRA?: { band: number; comment?: string; next_band_gap: string };
    PR?: { band: number; comment?: string; next_band_gap: string };
  };
  highlights: { span: string; type: 'filler' | 'repair' | 'word_choice'; note: string }[];
  improved_answer?: string;
  vocab_upgrades: { original: string; upgraded: string; context: string }[];
  cue_card_outline?: string[];
  strengths: string[];
  priority_fixes: string[];
  confidence: 'high' | 'medium' | 'low';
};

export async function scoreSpeakingWithAI(
  partNum: 1 | 2 | 3,
  promptText: string,
  transcript: string,
  durationS: number,
  config: ProviderConfig,
): Promise<SpeakingScoringResult> {
  const trimmed = transcript.trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;

  if (wordCount === 0) {
    return {
      part: partNum,
      status: 'unscored',
      unscored_reason: 'no_transcript',
      unscored_detail: 'No spoken transcript available for this part.',
      band: null,
      criteria: {},
      highlights: [],
      vocab_upgrades: [],
      strengths: [],
      priority_fixes: [],
      confidence: 'low',
    };
  }

  if (wordCount < 10) {
    return {
      part: partNum,
      status: 'unscored',
      unscored_reason: 'too_short',
      unscored_detail: `Spoken response too short (${wordCount} words; at least 10 words required).`,
      band: null,
      criteria: {},
      highlights: [],
      vocab_upgrades: [],
      strengths: [],
      priority_fixes: ['Speak at greater length with more detailed responses.'],
      confidence: 'low',
    };
  }

  if (!config.enabled) {
    return {
      part: partNum,
      status: 'unscored',
      unscored_reason: 'ai_disabled',
      unscored_detail: 'AI scoring is not configured or disabled.',
      band: null,
      criteria: {},
      highlights: [],
      vocab_upgrades: [],
      strengths: [],
      priority_fixes: [],
      confidence: 'low',
    };
  }

  const systemPrompt = `You are a certified IELTS Speaking examiner.
Score ONLY the candidate transcript below using authentic Cambridge IELTS band descriptors across 4 criteria:
1. Fluency & Coherence (FC)
2. Lexical Resource (LR)
3. Grammatical Range & Accuracy (GRA)
4. Pronunciation (PR) (estimated from natural rhythm, word links, and discourse markers; note that audio acoustic model is unavailable)

FACTS: part=${partNum}, word_count=${wordCount}, duration_seconds=${durationS}.
Score each criterion in 0.5 increments (e.g. 5.5, 6.0, 6.5, 7.0).
Return JSON matching this schema with no markdown wrapping:
{
  "criteria": {
    "FC": { "band": number, "comment": string, "next_band_gap": string },
    "LR": { "band": number, "comment": string, "next_band_gap": string },
    "GRA": { "band": number, "comment": string, "next_band_gap": string },
    "PR": { "band": number, "comment": string, "next_band_gap": string }
  },
  "improved_answer": string,
  "vocab_upgrades": [{ "original": string, "upgraded": string, "context": string }],
  "highlights": [{ "span": string, "type": "filler"|"repair"|"word_choice", "note": string }],
  "strengths": [string, string],
  "priority_fixes": [string, string]${partNum === 2 ? ',\n  "cue_card_outline": [string, string, string, string]' : ''}
}`;

  const userPrompt = `INTERVIEW PROMPT:\n${promptText}\n\nCANDIDATE SPOKEN TRANSCRIPT:\n${trimmed}`;

  try {
    const res = await callProviderScoring(userPrompt, config, {
      systemInstruction: systemPrompt,
      temperature: 0,
      timeoutMs: 45000,
    });
    const parsed = parseTolerantJson<Record<string, unknown>>(res.content);

    const rawCrit = (parsed.criteria as Record<string, Record<string, unknown>>) || {};
    const fc = validateIeltsBand(rawCrit.FC?.band ?? rawCrit.fluency?.band);
    const lr = validateIeltsBand(rawCrit.LR?.band ?? rawCrit.lexical?.band);
    const gra = validateIeltsBand(rawCrit.GRA?.band ?? rawCrit.grammar?.band);
    const pr = validateIeltsBand(rawCrit.PR?.band ?? rawCrit.pronunciation?.band);

    if (fc === null || lr === null || gra === null || pr === null) {
      throw new Error('AI response did not contain valid 0.0-9.0 bands for speaking criteria.');
    }

    const calculatedBand = roundToHalfBand((fc + lr + gra + pr) / 4);

    const verifiedHighlights = Array.isArray(parsed.highlights)
      ? (parsed.highlights as { span?: string; type?: string; note?: string }[])
          .filter((h) => {
            if (!h || !h.span) return false;
            return verifyQuoteSubstring(h.span, trimmed).valid;
          })
          .map((h) => ({
            span: String(h.span),
            type: (h.type === 'repair' || h.type === 'word_choice' ? h.type : 'filler') as 'filler' | 'repair' | 'word_choice',
            note: String(h.note || ''),
          }))
      : [];

    return {
      part: partNum,
      status: 'scored',
      band: calculatedBand,
      criteria: {
        FC: {
          band: fc,
          comment: String(rawCrit.FC?.comment || rawCrit.fluency?.comment || ''),
          next_band_gap: String(rawCrit.FC?.next_band_gap || rawCrit.fluency?.next_band_gap || ''),
        },
        LR: {
          band: lr,
          comment: String(rawCrit.LR?.comment || rawCrit.lexical?.comment || ''),
          next_band_gap: String(rawCrit.LR?.next_band_gap || rawCrit.lexical?.next_band_gap || ''),
        },
        GRA: {
          band: gra,
          comment: String(rawCrit.GRA?.comment || rawCrit.grammar?.comment || ''),
          next_band_gap: String(rawCrit.GRA?.next_band_gap || rawCrit.grammar?.next_band_gap || ''),
        },
        PR: {
          band: pr,
          comment: String(rawCrit.PR?.comment || rawCrit.pronunciation?.comment || 'Estimated from transcript discourse rhythm.'),
          next_band_gap: String(rawCrit.PR?.next_band_gap || rawCrit.pronunciation?.next_band_gap || ''),
        },
      },
      highlights: verifiedHighlights,
      improved_answer:
        typeof parsed.improved_answer === 'string' && parsed.improved_answer.trim()
          ? parsed.improved_answer.trim()
          : undefined,
      vocab_upgrades: Array.isArray(parsed.vocab_upgrades)
        ? (parsed.vocab_upgrades as { original: string; upgraded: string; context: string }[])
        : [],
      cue_card_outline:
        partNum === 2 && Array.isArray(parsed.cue_card_outline)
          ? (parsed.cue_card_outline as string[])
          : undefined,
      strengths: Array.isArray(parsed.strengths) ? (parsed.strengths as string[]) : [],
      priority_fixes: Array.isArray(parsed.priority_fixes) ? (parsed.priority_fixes as string[]) : [],
      confidence: wordCount >= 60 ? 'high' : 'medium',
    };
  } catch (err) {
    console.warn('[IELTS Studio] Speaking AI evaluation error:', (err as Error).message);
    return {
      part: partNum,
      status: 'unscored',
      unscored_reason: 'ai_error',
      unscored_detail: (err as Error).message || 'Speaking evaluation failed.',
      band: null,
      criteria: {},
      highlights: [],
      vocab_upgrades: [],
      strengths: [],
      priority_fixes: [],
      confidence: 'low',
    };
  }
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
    const res = await callProviderChat(prompt, config, { timeoutMs: 20000 });
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

