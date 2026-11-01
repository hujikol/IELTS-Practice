/**
 * IELTS Writing Scoring Orchestrator (§5.5).
 * Enforces:
 * 1. Pre-checks (deterministic code facts, length caps, off-topic detection).
 * 2. Deterministic cache (prompt + text + rubric + model).
 * 3. Temperature: 0 via callProviderScoring.
 * 4. Tolerant JSON parsing.
 * 5. Strict band validation (finite, 0-9, 0.5 increments).
 * 6. Verified verbatim evidence quotes (up to 25 words).
 * 7. Explicit unscored states with zero fabricated numbers.
 */

import { callProviderScoring, parseTolerantJson, type ProviderConfig } from './providers.ts';
import { roundToHalfBand } from './bands.ts';
import { verifyQuoteSubstring } from './scoring.ts';
import { runWritingPreChecks, type WritingPreChecks } from './writing-checks.ts';
import {
  WRITING_RUBRIC_VERSION,
  buildWritingScoringSystemPrompt,
  buildWritingScoringUserPrompt,
} from './writing-rubric.ts';
import { computeScoreCacheKey, getCachedScore, setCachedScore } from './score-cache.ts';

export type WritingScoringResult = {
  task: 1 | 2;
  status: 'scored' | 'unscored';
  unscored_reason?: 'ai_disabled' | 'ai_error' | 'too_short' | 'not_attempted';
  unscored_detail?: string;
  band: number | null;
  criteria: {
    task_response?: { band: number; evidence: { quote: string; comment: string }[]; next_band_gap: string };
    coherence?: { band: number; evidence: { quote: string; comment: string }[]; next_band_gap: string };
    lexical?: { band: number; evidence: { quote: string; comment: string }[]; next_band_gap: string };
    grammar?: { band: number; evidence: { quote: string; comment: string }[]; next_band_gap: string };
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
  pre_checks?: WritingPreChecks;
  rubric_version?: string;
};

export function validateIeltsBand(val: unknown): number | null {
  if (typeof val !== 'number' || !Number.isFinite(val)) return null;
  if (val < 0 || val > 9) return null;
  return Math.round(val * 2) / 2;
}

export async function scoreWritingTask(
  taskNumber: 1 | 2,
  promptText: string,
  visualSpecJson: string | null,
  keyFeatures: string[],
  learnerText: string,
  durationS: number,
  config: ProviderConfig,
): Promise<WritingScoringResult> {
  const trimmed = learnerText.trim();
  if (!trimmed) {
    return {
      task: taskNumber,
      status: 'unscored',
      unscored_reason: 'not_attempted',
      unscored_detail: 'No response was submitted for this task.',
      band: null,
      criteria: {},
      errors: [],
      strengths: [],
      priority_fixes: [],
      confidence: 'low',
    };
  }

  const preChecks = runWritingPreChecks(taskNumber, promptText, trimmed);
  if (preChecks.wordCount < 25) {
    return {
      task: taskNumber,
      status: 'unscored',
      unscored_reason: 'too_short',
      unscored_detail: `Response has only ${preChecks.wordCount} words (minimum scorable length is 25 words).`,
      band: null,
      criteria: {},
      errors: [],
      strengths: [],
      priority_fixes: [`Write at least ${preChecks.minWords} words to fulfill task requirements.`],
      confidence: 'low',
      pre_checks: preChecks,
    };
  }

  // Cache lookup
  const cacheKey = computeScoreCacheKey(
    'writing',
    promptText,
    trimmed,
    WRITING_RUBRIC_VERSION,
    config.model || 'default',
  );
  const cached = getCachedScore<WritingScoringResult>(cacheKey);
  if (cached && cached.status === 'scored') {
    return cached;
  }

  if (!config.enabled) {
    return {
      task: taskNumber,
      status: 'unscored',
      unscored_reason: 'ai_disabled',
      unscored_detail: 'AI scoring is not configured or disabled.',
      band: null,
      criteria: {},
      errors: [],
      strengths: [],
      priority_fixes: [],
      confidence: 'low',
      pre_checks: preChecks,
    };
  }

  const systemPrompt = buildWritingScoringSystemPrompt();
  const userPrompt = buildWritingScoringUserPrompt(
    taskNumber,
    promptText,
    visualSpecJson,
    keyFeatures,
    trimmed,
    preChecks,
  );

  try {
    const res = await callProviderScoring(userPrompt, config, {
      systemInstruction: systemPrompt,
      temperature: 0,
      timeoutMs: 60000,
    });

    const parsed = parseTolerantJson<Record<string, unknown>>(res.content);
    const rawCrit = (parsed.criteria as Record<string, Record<string, unknown>>) || {};

    let tr = validateIeltsBand(
      rawCrit.task_response?.band ?? rawCrit.task_achievement?.band,
    );
    let cc = validateIeltsBand(rawCrit.coherence?.band);
    let lr = validateIeltsBand(rawCrit.lexical?.band);
    let gra = validateIeltsBand(rawCrit.grammar?.band);

    // If critical bands failed to parse, fail explicitly to unscored (do NOT fabricate)
    if (tr === null || cc === null || lr === null || gra === null) {
      throw new Error('AI response did not contain valid 0.0-9.0 bands for all 4 criteria.');
    }

    // Enforce code-level caps per IELTS descriptors
    if (preChecks.lengthCap !== null && tr > preChecks.lengthCap) {
      tr = preChecks.lengthCap;
    }
    if ((parsed.off_topic === true || preChecks.suspectedOffTopic) && tr > 4.0) {
      tr = 4.0;
    }

    // Verify evidence quotes (up to 25 words)
    const verifyEvidenceList = (items: unknown) => {
      if (!Array.isArray(items)) return [];
      const verified: { quote: string; comment: string }[] = [];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const q = String((item as { quote?: string }).quote || '').trim();
        const c = String((item as { comment?: string }).comment || '').trim();
        if (q && verifyQuoteSubstring(q, trimmed, 25).valid) {
          verified.push({ quote: q, comment: c });
        }
      }
      return verified;
    };

    const trEvidence = verifyEvidenceList(rawCrit.task_response?.evidence || rawCrit.task_achievement?.evidence);
    const ccEvidence = verifyEvidenceList(rawCrit.coherence?.evidence);
    const lrEvidence = verifyEvidenceList(rawCrit.lexical?.evidence);
    const graEvidence = verifyEvidenceList(rawCrit.grammar?.evidence);

    // Penalty for claiming band >= 7.0 without any verified quote
    if (tr >= 7.0 && trEvidence.length === 0) tr = Math.max(0, tr - 0.5);
    if (cc >= 7.0 && ccEvidence.length === 0) cc = Math.max(0, cc - 0.5);
    if (lr >= 7.0 && lrEvidence.length === 0) lr = Math.max(0, lr - 0.5);
    if (gra >= 7.0 && graEvidence.length === 0) gra = Math.max(0, gra - 0.5);

    // Verify and re-compute exact offsets for errors
    const verifiedErrors: WritingScoringResult['errors'] = [];
    if (Array.isArray(parsed.errors)) {
      for (const err of parsed.errors) {
        if (!err || typeof err !== 'object') continue;
        const span = String((err as { span?: string }).span || '').trim();
        if (!span) continue;
        const check = verifyQuoteSubstring(span, trimmed, 20);
        if (check.valid) {
          const lowerTrimmed = trimmed.toLowerCase();
          const lowerSpan = span.toLowerCase();
          const start = lowerTrimmed.indexOf(lowerSpan);
          const end = start !== -1 ? start + span.length : 0;
          verifiedErrors.push({
            span,
            start: Math.max(0, start),
            end: Math.max(0, end),
            category: String((err as { category?: string }).category || 'General'),
            correction: String((err as { correction?: string }).correction || ''),
            explanation: String((err as { explanation?: string }).explanation || ''),
            severity: (err as { severity?: string }).severity === 'major' ? 'major' : 'minor',
          });
        }
      }
    }

    const calculatedTaskBand = roundToHalfBand((tr + cc + lr + gra) / 4);

    const result: WritingScoringResult = {
      task: taskNumber,
      status: 'scored',
      band: calculatedTaskBand,
      criteria: {
        task_response: {
          band: tr,
          evidence: trEvidence,
          next_band_gap: String(rawCrit.task_response?.next_band_gap || rawCrit.task_achievement?.next_band_gap || ''),
        },
        coherence: {
          band: cc,
          evidence: ccEvidence,
          next_band_gap: String(rawCrit.coherence?.next_band_gap || ''),
        },
        lexical: {
          band: lr,
          evidence: lrEvidence,
          next_band_gap: String(rawCrit.lexical?.next_band_gap || ''),
        },
        grammar: {
          band: gra,
          evidence: graEvidence,
          next_band_gap: String(rawCrit.grammar?.next_band_gap || ''),
        },
      },
      errors: verifiedErrors,
      missing_key_features: Array.isArray(parsed.missing_key_features)
        ? (parsed.missing_key_features as string[]).map(String)
        : [],
      factual_misreads: Array.isArray(parsed.factual_misreads)
        ? (parsed.factual_misreads as { learner_claim: string; actual: string }[])
        : [],
      strengths: Array.isArray(parsed.strengths) ? (parsed.strengths as string[]).map(String) : [],
      priority_fixes: Array.isArray(parsed.priority_fixes) ? (parsed.priority_fixes as string[]).map(String) : [],
      confidence: parsed.confidence === 'high' ? 'high' : parsed.confidence === 'medium' ? 'medium' : 'low',
      pre_checks: preChecks,
      rubric_version: WRITING_RUBRIC_VERSION,
    };

    setCachedScore(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('[IELTS Studio] Writing assessment AI error:', (err as Error).message);
    return {
      task: taskNumber,
      status: 'unscored',
      unscored_reason: 'ai_error',
      unscored_detail: (err as Error).message || 'Scoring request failed or returned invalid response.',
      band: null,
      criteria: {},
      errors: [],
      strengths: [],
      priority_fixes: [],
      confidence: 'low',
      pre_checks: preChecks,
    };
  }
}

