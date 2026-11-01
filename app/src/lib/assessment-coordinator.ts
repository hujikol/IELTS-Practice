// §5, §7, §8, §9: Assessment Coordinator & Report Builder
// Coordinates code scoring, AI evaluations, quote verification, and final report compilation.

import {
  rawToListeningBand,
  rawToReadingBand,
  calculateOverallBand,
  calculateWritingBand,
  roundToHalfBand,
  roundIeltsOverallBand,
} from './bands.ts';
import {
  computeAggregates,
  rankWeaknesses,
  scoreObjectiveItem,
  type Attempt,
  type FinalReport,
  type ItemReview,
  type KeyItem,
  type ScoredObjectiveItem,
  type SkillTag,
  type MistakeTag,
} from './scoring.ts';
import {
  generatePersonalNotes,
  scoreWritingTaskWithAI,
  scoreSpeakingWithAI,
  generateWeaknessNarrativeWithValidation,
  calculateSpeechMetrics,
} from './assessment-ai.ts';
import { loadProviderConfig, type ProviderConfig } from './providers.ts';
import { isWritingAttempted, isSpeakingAttempted } from './attempts.ts';
import { getSpeakingAudioBlob } from './speaking-recorder.ts';
import { transcribeAudioBlobWithApi, type WordTimestamp } from './stt-engine.ts';
import type { AttemptRecord, Question } from './types.ts';

/**
 * Converts a material Question into a standard KeyItem for scoring.
 */
function questionToKeyItem(q: Question): KeyItem {
  const choices = q.choices || [];
  const correctChoice = choices[q.correct] || '';
  const correctAnswer = q.kind === 'gap' ? q.answerText || correctChoice : correctChoice;

  return {
    item_id: q.id,
    q: q.number ?? 1,
    type: q.kind || 'mcq',
    skill: (q.skill as SkillTag) || 'detail_matching',
    target_band: q.target_band ?? 6.0,
    correct_answer: correctAnswer,
    accepted_alternatives: q.accepted || [],
    word_limit: q.maxWords,
    evidence: {
      source: q.section === 'listening' ? 'transcript' : 'passage',
      quote: q.evidence || '',
    },
    explanation: q.explanation || 'Refer to the source passage.',
    paraphrase_map: q.paraphrase_map,
    distractor_notes: q.distractor_notes,
    common_mistake_tag: (q.common_mistake_tag as MistakeTag) || 'qualifier_missed',
    strategy_tip: q.strategy_tip || 'Verify synonyms and keywords in the question against the passage.',
  };
}

function mapQuestionKind(kind?: string): 'tfng' | 'ynng' | 'mcq' | 'gap' | 'matching' | 'map_label' | 'short' | 'flow' | 'grammar' {
  if (kind === 'gap') return 'gap';
  if (kind === 'match') return 'matching';
  if (kind === 'tfng') return 'tfng';
  if (kind === 'ynng') return 'ynng';
  return 'mcq';
}

/**
 * Builds an Attempt capture structure (§3) from the record's current state.
 */
export function buildAttemptCapture(record: AttemptRecord): Attempt {
  const t = record.data;
  const startedAt = new Date(record.created_at).toISOString();
  const finishedAt = new Date(record.updated_at || Date.now()).toISOString();

  // Listening
  const listeningAnswers = t.listening.flatMap((b) => b.questions).map((q) => {
    const val = t.responses[q.id];
    return {
      q: q.number ?? 1,
      item_id: q.id,
      group_id: `l-g${q.group ?? 1}`,
      type: mapQuestionKind(q.kind),
      user_answer: val === undefined ? null : q.kind === 'gap' ? String(val) : q.choices[Number(val)] ?? String(val),
    };
  });

  // Reading
  const readingAnswers = t.reading.flatMap((b) => b.questions).map((q) => {
    const val = t.responses[q.id];
    return {
      q: q.number ?? 1,
      item_id: q.id,
      group_id: `r-g${q.group ?? 1}`,
      type: mapQuestionKind(q.kind),
      user_answer: val === undefined ? null : q.kind === 'gap' ? String(val) : q.choices[Number(val)] ?? String(val),
    };
  });

  // Writing
  const writingTasks = t.writing.map((w, idx) => ({
    task: (idx + 1) as 1 | 2,
    prompt_id: `w-task-${idx + 1}`,
    text: t.texts[idx] || '',
    word_count: t.texts[idx]?.trim() ? t.texts[idx]!.trim().split(/\s+/).length : 0,
    duration_s: 0,
  }));

  // Speaking
  const speakingParts = t.speaking.map((s, idx) => {
    const partPrefix = `p${idx + 1}_`;
    const partRecordings = Object.entries(t.recordings || {}).filter(([k]) => k.startsWith(partPrefix));
    const totalDuration = partRecordings.reduce((sum, [, r]) => sum + (r.duration || 0), 0);
    return {
      part: (idx + 1) as 1 | 2 | 3,
      question_id: `s-part-${idx + 1}`,
      audio_url: '',
      transcript: t.speakingTexts[idx] || '',
      words: [],
      duration_s: Math.round(totalDuration),
    };
  });

  return {
    attempt_id: record.id,
    test_id: `test-${record.id}`,
    started_at: startedAt,
    finished_at: finishedAt,
    mode: record.mode === 'timed' ? 'timed' : 'untimed',
    sections: {
      listening: { duration_s: 1800, answers: listeningAnswers },
      reading: { duration_s: 3600, answers: readingAnswers },
      writing: { tasks: writingTasks },
      speaking: { parts: speakingParts },
    },
  };
}

/**
 * Produces the complete FinalReport (§9) by scoring objective sections with code,
 * evaluating writing & speaking, computing aggregates and ranking weaknesses.
 */
export async function generateFinalReport(
  record: AttemptRecord,
  customConfig?: ProviderConfig,
  skipRemoteAI: boolean = false,
  onProgress?: (status: string) => void,
): Promise<FinalReport> {
  const config = customConfig || loadProviderConfig();
  const testData = record.data;

  onProgress?.('Evaluating objective answers...');

  // 1. Objective Scoring: Listening
  const listeningKeyItems = testData.listening.flatMap((b) => b.questions).map(questionToKeyItem);
  const keyMap = new Map<string, KeyItem>();
  listeningKeyItems.forEach((k) => keyMap.set(k.item_id, k));

  const scoredListening: ScoredObjectiveItem[] = listeningKeyItems.map((k) => {
    const rawVal = testData.responses[k.item_id];
    const userVal =
      rawVal === undefined
        ? null
        : k.type === 'gap'
          ? String(rawVal)
          : Array.isArray(rawVal)
            ? rawVal
            : typeof rawVal === 'number'
              ? (testData.listening.flatMap((b) => b.questions).find((q) => q.id === k.item_id)?.choices[rawVal] ?? String(rawVal))
              : String(rawVal);
    return scoreObjectiveItem(k, userVal);
  });

  const listeningRaw = scoredListening.filter((s) => s.correct).length;
  const listeningBand = testData.listening.length > 0 ? rawToListeningBand(listeningRaw) : null;

  // 2. Objective Scoring: Reading
  const readingKeyItems = testData.reading.flatMap((b) => b.questions).map(questionToKeyItem);
  readingKeyItems.forEach((k) => keyMap.set(k.item_id, k));

  const scoredReading: ScoredObjectiveItem[] = readingKeyItems.map((k) => {
    const rawVal = testData.responses[k.item_id];
    const userVal =
      rawVal === undefined
        ? null
        : k.type === 'gap'
          ? String(rawVal)
          : Array.isArray(rawVal)
            ? rawVal
            : typeof rawVal === 'number'
              ? (testData.reading.flatMap((b) => b.questions).find((q) => q.id === k.item_id)?.choices[rawVal] ?? String(rawVal))
              : String(rawVal);
    return scoreObjectiveItem(k, userVal);
  });

  const readingRaw = scoredReading.filter((s) => s.correct).length;
  const readingBand = testData.reading.length > 0 ? rawToReadingBand(readingRaw) : null;

  const allScoredObjective = [...scoredListening, ...scoredReading];
  const wrongObjective = allScoredObjective.filter((it) => !it.correct);

  onProgress?.('Scoring Writing & Speaking simultaneously with AI...');

  // 3. AI Personal Notes Promise (Parallelized)
  const personalNotesPromise = (async () => {
    if (!skipRemoteAI && config.enabled && wrongObjective.length > 0) {
      return await generatePersonalNotes(wrongObjective, keyMap, config);
    }
    const notesMap = new Map<string, string>();
    for (const item of wrongObjective) {
      const key = keyMap.get(item.item_id);
      if (key?.strategy_tip || key?.explanation) {
        notesMap.set(item.item_id, key.strategy_tip || key.explanation);
      }
    }
    return notesMap;
  })();

  // 4. Writing Assessment Promises (Parallelized)
  const writingAttempted = isWritingAttempted(testData);
  const writingCount = testData.writing.length > 0 ? testData.writing.length : (writingAttempted ? (testData.texts || []).length : 0);
  const writingPromises: Promise<{
    taskNumber: 1 | 2;
    taskDef: { title: string; prompt: string; minimum?: number; visual?: unknown };
    userText: string;
    assessment: Awaited<ReturnType<typeof scoreWritingTaskWithAI>>;
  } | null>[] = [];

  if (writingAttempted && writingCount > 0) {
    for (let idx = 0; idx < writingCount; idx++) {
      const taskNumber = (idx + 1) as 1 | 2;
      const taskDef = testData.writing[idx] || {
        title: `Task ${taskNumber}`,
        prompt: `Writing Task ${taskNumber}`,
        minimum: taskNumber === 1 ? 150 : 250,
      };
      const userText = testData.texts[idx] || '';
      const wordCount = userText.trim().split(/\s+/).filter(Boolean).length;

      if (wordCount < 20) {
        continue;
      }

      writingPromises.push(
        (async () => {
          const effectiveConfig = skipRemoteAI ? { ...config, enabled: false } : config;
          const assessment = await scoreWritingTaskWithAI(
            taskNumber,
            taskDef.prompt,
            taskDef.visual ? JSON.stringify(taskDef.visual) : null,
            ['reported major trends', 'provided overview', 'compared key metrics'],
            userText,
            0,
            effectiveConfig,
          );
          return { taskNumber, taskDef, userText, assessment };
        })(),
      );
    }
  }

  // 5. Speaking Assessment Promises (Parallelized)
  const speakingAttempted = isSpeakingAttempted(testData);
  const speakCount = testData.speaking.length > 0 ? testData.speaking.length : (speakingAttempted ? (testData.speakingTexts || []).length || 3 : 0);
  const speakingPromises: Promise<{
    partNum: 1 | 2 | 3;
    transcript: string;
    realWords?: WordTimestamp[];
    unscoredReason?: string;
    assessment: Awaited<ReturnType<typeof scoreSpeakingWithAI>>;
  } | null>[] = [];

  if (speakingAttempted && speakCount > 0) {
    for (let idx = 0; idx < speakCount; idx++) {
      const partNum = (idx + 1) as 1 | 2 | 3;
      const initialTranscript = testData.speakingTexts?.[idx] || '';
      const partRecordings = Object.entries(testData.recordings || {}).filter(([k]) => k.startsWith(`p${partNum}_`));

      const partDef = testData.speaking[idx];
      const partPrompt =
        partDef?.prompt ||
        (partDef?.cue ? partDef.cue.join('\n') : '') ||
        (partDef?.questions ? partDef.questions.join('\n') : '') ||
        `Speaking Part ${partNum} interview questions`;

      speakingPromises.push(
        (async () => {
          let transcript = initialTranscript;
          const realWords: WordTimestamp[] = [];
          const effectiveConfig = skipRemoteAI ? { ...config, enabled: false } : config;
          const duration = Math.round(partRecordings.reduce((sum, [, r]) => sum + (r.duration || 0), 0)) || (partNum === 2 ? 120 : 60);

          // If transcript is missing/empty but recordings exist, attempt audio transcription if AI is enabled in browser
          if (transcript.trim().split(/\s+/).filter(Boolean).length < 5 && partRecordings.length > 0 && !skipRemoteAI && config.enabled && typeof window !== 'undefined') {
            try {
              const transcribedParts: string[] = [];
              for (const [, rec] of partRecordings) {
                if (rec.key) {
                  const blob = await getSpeakingAudioBlob(rec.key);
                  if (blob) {
                    const sttRes = await transcribeAudioBlobWithApi(blob, config);
                    if (sttRes.text) transcribedParts.push(sttRes.text);
                    if (sttRes.words?.length) realWords.push(...sttRes.words);
                  }
                }
              }
              if (transcribedParts.length > 0) {
                transcript = transcribedParts.join(' ');
              }
            } catch (err) {
              console.warn(`[IELTS Studio] Audio transcription failed for Part ${partNum}:`, err);
            }
          }

          const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
          if (wordCount < 5) {
            return {
              partNum,
              transcript,
              realWords,
              unscoredReason: partRecordings.length > 0 ? 'no_transcript' : 'not_attempted',
              assessment: {
                part: partNum,
                band: null,
                status: 'unscored' as const,
                unscored_reason: partRecordings.length > 0 ? 'no_transcript' : 'not_attempted',
                criteria: {},
                highlights: [],
                vocab_upgrades: [],
                strengths: [],
                priority_fixes: [],
                confidence: 'low' as const,
                notes: partRecordings.length > 0
                  ? 'Audio recordings were captured, but no speech transcript was generated.'
                  : 'Speaking part was not attempted or had fewer than 5 words.',
              },
            };
          }

          const assessment = await scoreSpeakingWithAI(
            partNum,
            partPrompt,
            transcript,
            duration,
            effectiveConfig,
          );
          return { partNum, transcript, realWords, assessment };
        })(),
      );
    }
  }

  // Await all AI tasks concurrently
  const [personalNotesMap, writingResolved, speakingResolved] = await Promise.all([
    personalNotesPromise,
    Promise.all(writingPromises),
    Promise.all(speakingPromises),
  ]);

  const reviewListening: ItemReview[] = scoredListening.map((s) => ({
    ...s,
    personal_note: personalNotesMap.get(s.item_id),
  }));

  const reviewReading: ItemReview[] = scoredReading.map((s) => ({
    ...s,
    personal_note: personalNotesMap.get(s.item_id),
  }));

  // Assemble Writing Results
  const writingTasksResults: FinalReport['review']['writing']['tasks'] = [];
  let task1Band: number | null = null;
  let task2Band: number | null = null;
  let writingBand: number | null = null;
  let hasAiWritingAssessment = false;

  for (const item of writingResolved) {
    if (!item) continue;
    const { taskNumber, assessment } = item;
    if (assessment.status === 'scored' && assessment.band !== null) {
      if (taskNumber === 1) task1Band = assessment.band;
      if (taskNumber === 2) task2Band = assessment.band;
      if (assessment.confidence !== 'low') hasAiWritingAssessment = true;
    }

    writingTasksResults.push({
      task: taskNumber,
      band: assessment.band,
      status: assessment.status,
      unscored_reason: assessment.unscored_reason,
      criteria: assessment.criteria as Record<string, { band: number; evidence: { quote: string; comment: string }[]; next_band_gap: string }>,
      errors: assessment.errors,
      strengths: assessment.strengths,
      priority_fixes: assessment.priority_fixes,
    });
  }

  if (task1Band !== null && task2Band !== null) {
    writingBand = calculateWritingBand(task1Band, task2Band);
  } else if (testData.scope === 'writing') {
    writingBand = task1Band ?? task2Band ?? null;
  } else {
    writingBand = null;
  }

  // Assemble Speaking Results
  const speakingPartsResults: FinalReport['review']['speaking']['parts'] = [];
  let speakingBand: number | null = null;
  let hasAiSpeakingAssessment = false;
  const validSpeakingBands: number[] = [];
  let sumFC = 0;
  let sumLR = 0;
  let sumGRA = 0;
  let sumPR = 0;

  for (const item of speakingResolved) {
    if (!item) continue;
    const { partNum, transcript, assessment } = item;
    if (assessment.status === 'scored' && assessment.band !== null) {
      validSpeakingBands.push(assessment.band);
      if (assessment.confidence !== 'low') hasAiSpeakingAssessment = true;

      if (assessment.criteria.FC?.band !== undefined) sumFC += assessment.criteria.FC.band;
      if (assessment.criteria.LR?.band !== undefined) sumLR += assessment.criteria.LR.band;
      if (assessment.criteria.GRA?.band !== undefined) sumGRA += assessment.criteria.GRA.band;
      if (assessment.criteria.PR?.band !== undefined) sumPR += assessment.criteria.PR.band;
    }

    const partRecordings = Object.entries(testData.recordings || {}).filter(([k]) => k.startsWith(`p${partNum}_`));
    const realDuration = Math.round(partRecordings.reduce((sum, [, r]) => sum + (r.duration || 0), 0)) || (partNum === 2 ? 120 : 60);
    // Real word timestamps from Whisper/STT; null if not yet measured
    const metrics = calculateSpeechMetrics(item.realWords || [], realDuration, partNum === 2 ? 120 : 60);

    speakingPartsResults.push({
      part: partNum,
      transcript: transcript,
      status: assessment.band !== null ? 'scored' : 'unscored',
      unscored_reason: item.unscoredReason || (assessment.band === null ? 'ai_disabled' : undefined),
      metrics: metrics ?? undefined,
      highlights: assessment.highlights,
      improved_answer: assessment.improved_answer,
      vocab_upgrades: assessment.vocab_upgrades,
      cue_card_outline: assessment.cue_card_outline,
      strengths: assessment.strengths,
      priority_fixes: assessment.priority_fixes,
    });
  }

  if (validSpeakingBands.length > 0) {
    speakingBand = roundToHalfBand(validSpeakingBands.reduce((a, b) => a + b, 0) / validSpeakingBands.length);
  }

  const spCount = validSpeakingBands.length || 1;
  const speakingCriteria = {
    FC: roundToHalfBand(sumFC / spCount),
    LR: roundToHalfBand(sumLR / spCount),
    GRA: roundToHalfBand(sumGRA / spCount),
    PR: roundToHalfBand(sumPR / spCount),
  };

  // 6. Overall Band Calculation
  let overallBand: number | null = null;
  if (testData.scope === 'writing') {
    overallBand = writingBand;
  } else if (testData.scope === 'speaking') {
    overallBand = speakingBand;
  } else if (testData.scope === 'listening') {
    overallBand = listeningBand;
  } else if (testData.scope === 'reading') {
    overallBand = readingBand;
  } else {
    const validBands = [listeningBand, readingBand, writingBand, speakingBand].filter(
      (b): b is number => typeof b === 'number' && b > 0,
    );
    if (validBands.length === 4) {
      overallBand = calculateOverallBand({
        listening: listeningBand,
        reading: readingBand,
        writing: writingBand,
        speaking: speakingBand,
      });
    } else if (validBands.length > 0) {
      overallBand = roundIeltsOverallBand(validBands.reduce((a, b) => a + b, 0) / validBands.length);
    }
  }

  // 7. Aggregates & Weaknesses
  const aggregates = computeAggregates(allScoredObjective, {
    durationS: 5400,
    plannedS: 7200,
    criterionBands: {
      ...(task1Band !== null ? { 'writing.TR_TA': task1Band } : {}),
      ...(task2Band !== null ? { 'writing.TR_Task2': task2Band } : {}),
      ...(writingBand !== null ? { 'writing.overall': writingBand } : {}),
      ...(speakingBand !== null ? { 'speaking.overall': speakingBand } : {}),
    },
  });

  const { weaknesses, strengths } = rankWeaknesses(aggregates, 7.0, overallBand ?? 6.0);

  // 8. Weakness Narrative & 7-Day Plan (§8.3)
  onProgress?.('Generating diagnostic weakness profile & 7-day action drills...');
  let weaknessProfile: FinalReport['weakness_profile'];
  if (!skipRemoteAI && config.enabled) {
    weaknessProfile = await generateWeaknessNarrativeWithValidation(
      aggregates,
      weaknesses,
      strengths,
      allScoredObjective,
      config,
    );
  } else {
    weaknessProfile = {
      summary: overallBand
        ? `You achieved an estimated overall band of ${overallBand}. Focus on addressing your top error patterns in the 7-day drill plan below.`
        : 'Review your objective section results and focus on high-impact mistake tags.',
      weaknesses: weaknesses.slice(0, 5),
      strengths: strengths.slice(0, 3),
      seven_day_plan: [
        {
          day: 1,
          minutes: 30,
          tasks: [
            { type: 'drill', text: 'Inference practice', drill: { job: 'r1', focus: 'inference', count: 5 } },
            { type: 'technique', text: 'Underline qualifying words in stems (always, usually, some).' },
          ],
        },
        {
          day: 2,
          minutes: 30,
          tasks: [
            { type: 'drill', text: 'Audio distractor notes drill', drill: { job: 'l2', focus: 'distractor_notes', count: 5 } },
            { type: 'technique', text: 'Listen for audio signpost transitions (however, in fact, actually).' },
          ],
        },
        {
          day: 3,
          minutes: 30,
          tasks: [
            { type: 'drill', text: 'Paraphrase matching drill', drill: { job: 'r2', focus: 'paraphrase_matching', count: 5 } },
            { type: 'technique', text: 'Map question synonyms to passage text before answering.' },
          ],
        },
        {
          day: 4,
          minutes: 30,
          tasks: [
            { type: 'drill', text: 'Task 1 overview practice', drill: { job: 'w1', focus: 'task1_overview', count: 1 } },
            { type: 'technique', text: 'Write a dedicated 2-sentence overview identifying main trends.' },
          ],
        },
        {
          day: 5,
          minutes: 30,
          tasks: [
            { type: 'drill', text: 'Spelling audit drill', drill: { job: 'l1', focus: 'spelling_accuracy', count: 5 } },
            { type: 'technique', text: 'Audit final answer transcriptions for singular vs plural nouns.' },
          ],
        },
        {
          day: 6,
          minutes: 30,
          tasks: [
            { type: 'drill', text: 'Task 2 structure drill', drill: { job: 'w2', focus: 'task2_structure', count: 1 } },
            { type: 'technique', text: 'Use topic sentences at the start of each supporting body paragraph.' },
          ],
        },
        {
          day: 7,
          minutes: 45,
          tasks: [
            { type: 'drill', text: 'Timed simulation drill', drill: { job: 'r3', focus: 'timed_simulation', count: 13 } },
            { type: 'technique', text: 'Practice pacing with strict 20-minute section limit.' },
          ],
        },
      ],
    };
  }

  // 9. Assemble Final Report (§9)
  const report: FinalReport = {
    attempt_id: record.id,
    test_id: `test-${record.id}`,
    label: 'Estimated band, not an official IELTS result',
    overall: {
      band: overallBand,
      method: overallBand !== null ? 'mean of 4 modules, IELTS rounding' : 'partial results (incomplete modules)',
    },
    modules: {
      listening: { raw: listeningRaw, of: listeningKeyItems.length || 40, band: listeningBand },
      reading: { raw: readingRaw, of: readingKeyItems.length || 40, band: readingBand },
      writing: writingAttempted
        ? {
            band: writingBand,
            task1: task1Band,
            task2: task2Band,
            criteria: (() => {
              const t1 = writingTasksResults.find((t) => t.task === 1)?.criteria;
              const t2 = writingTasksResults.find((t) => t.task === 2)?.criteria;
              const tr1 = t1?.task_response?.band;
              const tr2 = t2?.task_response?.band;
              const cc1 = t1?.coherence?.band;
              const cc2 = t2?.coherence?.band;
              const lr1 = t1?.lexical?.band;
              const lr2 = t2?.lexical?.band;
              const gra1 = t1?.grammar?.band;
              const gra2 = t2?.grammar?.band;

              const avg = (v1?: number, v2?: number) => {
                if (v1 !== undefined && v2 !== undefined) return roundToHalfBand((v1 + v2 * 2) / 3);
                return v1 ?? v2;
              };

              const tr = avg(tr1, tr2);
              const cc = avg(cc1, cc2);
              const lr = avg(lr1, lr2);
              const gra = avg(gra1, gra2);

              if (tr !== undefined && cc !== undefined && lr !== undefined && gra !== undefined) {
                return { TR_TA: tr, CC: cc, LR: lr, GRA: gra };
              }
              return undefined;
            })(),
            confidence: config.enabled && !skipRemoteAI && hasAiWritingAssessment ? 'medium' : 'low',
            status: writingBand !== null ? 'assessed' : 'pending',
          }
        : {
            band: null,
            task1: null,
            task2: null,
            confidence: 'low',
            status: 'unattempted',
          },
      speaking: speakingAttempted
        ? {
            band: speakingBand,
            criteria: validSpeakingBands.length > 0 ? speakingCriteria : undefined,
            confidence: config.enabled && !skipRemoteAI && hasAiSpeakingAssessment ? 'medium' : 'low',
            status: speakingBand !== null ? 'assessed' : 'pending',
          }
        : {
            band: null,
            confidence: 'low',
            status: 'unattempted',
          },
    },
    aggregates,
    weakness_profile: weaknessProfile,
    rubric_version: 'w-1.0.0',
    review: {
      listening: reviewListening,
      reading: reviewReading,
      writing: { tasks: writingTasksResults },
      speaking: { parts: speakingPartsResults },
    },
    confidence_notes: [
      'Speaking pronunciation and phoneme accuracy estimated without hardware audio-level DSP.',
      'Generated tests are unstandardised academic simulations; results are indicative estimates.',
    ],
    generated_at: new Date().toISOString(),
  };

  return report;
}
