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
    duration_s: 1200,
  }));

  // Speaking
  const speakingParts = t.speaking.map((s, idx) => ({
    part: (idx + 1) as 1 | 2 | 3,
    question_id: `s-part-${idx + 1}`,
    audio_url: '',
    transcript: t.speakingTexts[idx] || '',
    words: (t.speakingTexts[idx] || '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w, i) => ({ w, start: i * 0.4, end: (i + 1) * 0.4, conf: 0.95 })),
    duration_s: 180,
  }));

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
          if (!skipRemoteAI && config.enabled && wordCount >= 30) {
            const assessment = await scoreWritingTaskWithAI(
              taskNumber,
              taskDef.prompt,
              taskDef.visual ? JSON.stringify(taskDef.visual) : null,
              ['reported major trends', 'provided overview', 'compared key metrics'],
              userText,
              1200,
              config,
            );
            return { taskNumber, taskDef, userText, assessment };
          } else {
            const targetMin = taskDef.minimum || (taskNumber === 1 ? 150 : 250);
            const isUnderLength = wordCount < targetMin * 0.75;
            const baseBand = isUnderLength ? 5.0 : 6.5;

            const assessment = {
              task: taskNumber as 1 | 2,
              confidence: 'low' as const,
              band: baseBand,
              criteria: {
                task_response: {
                  band: baseBand,
                  evidence: [],
                  next_band_gap: isUnderLength ? `Write at least ${targetMin} words to fulfill task requirements.` : 'Develop supporting details further.',
                },
                coherence: {
                  band: baseBand,
                  evidence: [],
                  next_band_gap: 'Use a wider range of cohesive devices between paragraphs.',
                },
                lexical: {
                  band: baseBand,
                  evidence: [],
                  next_band_gap: 'Incorporate less common lexical items and collocations.',
                },
                grammar: {
                  band: baseBand,
                  evidence: [],
                  next_band_gap: 'Use a variety of complex sentence structures with grammatical accuracy.',
                },
              },
              strengths: wordCount >= targetMin ? [`Sufficient length (${wordCount} words) meeting the required minimum.`] : [],
              priority_fixes: isUnderLength ? [`Increase essay length to meet the ${targetMin}-word minimum.`] : [],
              errors: [],
            };
            return { taskNumber, taskDef, userText, assessment };
          }
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
    assessment: Awaited<ReturnType<typeof scoreSpeakingWithAI>>;
  } | null>[] = [];

  if (speakingAttempted && speakCount > 0) {
    for (let idx = 0; idx < speakCount; idx++) {
      const partNum = (idx + 1) as 1 | 2 | 3;
      const transcript = testData.speakingTexts?.[idx] || '';
      const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;

      if (wordCount < 5) continue;

      const partDef = testData.speaking[idx];
      const partPrompt =
        partDef?.prompt ||
        (partDef?.cue ? partDef.cue.join('\n') : '') ||
        (partDef?.questions ? partDef.questions.join('\n') : '') ||
        `Speaking Part ${partNum} interview questions`;

      speakingPromises.push(
        (async () => {
          if (!skipRemoteAI && config.enabled && wordCount >= 10) {
            const assessment = await scoreSpeakingWithAI(
              partNum,
              partPrompt,
              transcript,
              partNum === 2 ? 120 : 60,
              config,
            );
            return { partNum, transcript, assessment };
          } else {
            const targetWords = partNum === 2 ? 140 : 60;
            const baseBand = wordCount >= targetWords ? 6.5 : wordCount >= 30 ? 6.0 : wordCount >= 15 ? 5.0 : 4.0;
            const assessment = {
              part: partNum,
              band: baseBand,
              confidence: 'low' as const,
              criteria: {
                FC: { band: baseBand, comment: `Spoke ${wordCount} words.`, next_band_gap: 'Maintain fluency with fewer pauses.' },
                LR: { band: baseBand, comment: 'Basic range of lexical items used.', next_band_gap: 'Incorporate idiomatic collocations.' },
                GRA: { band: baseBand, comment: 'Adequate sentence construction.', next_band_gap: 'Introduce more complex structures.' },
                PR: { band: baseBand, comment: 'Generally intelligible rhythm.', next_band_gap: 'Focus on syllable stress and sentence intonation.' },
              },
              highlights: [
                { span: 'um, like', type: 'filler' as const, note: 'Avoid hesitation fillers during transitions.' },
              ],
              improved_answer: transcript
                ? `In response to this prompt, I would emphasize that consistent practice and clear structural organization are paramount for fluent communication.`
                : undefined,
              vocab_upgrades: [
                { original: 'very good', upgraded: 'exceptionally beneficial', context: 'qualitative description' },
                { original: 'big problem', upgraded: 'formidable impediment', context: 'challenge description' },
                { original: 'I think', upgraded: 'from my perspective', context: 'opinion framing' },
              ],
              cue_card_outline: partNum === 2 ? [
                'Introduction: Clearly introduce the topic/experience',
                'Context: When, where, and with whom',
                'Key details: What happened and why it mattered',
                'Personal reflection: The lasting impact on you',
              ] : undefined,
              strengths: wordCount >= 30 ? [`Spoke ${wordCount} words addressing the prompt.`] : ['Attempted the interview topic.'],
              priority_fixes: ['Expand detail and vocabulary diversity.'],
            };
            return { partNum, transcript, assessment };
          }
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
    const { taskNumber, userText, assessment } = item;
    if (taskNumber === 1) task1Band = assessment.band;
    if (taskNumber === 2) task2Band = assessment.band;
    if (assessment.confidence !== 'low') hasAiWritingAssessment = true;

    writingTasksResults.push({
      task: taskNumber,
      band: assessment.band,
      criteria: assessment.criteria,
      errors: assessment.errors,
      strengths: assessment.strengths,
      priority_fixes: assessment.priority_fixes,
      model_answer:
        taskNumber === 1
          ? 'The provided visual illustrates significant transformations over the measured period. Notably, the primary category experienced an initial surge, culminating at a peak before plateauing. In contrast, subsidiary elements remained relatively stable, displaying minor oscillations without significant deviation.'
          : 'In modern society, the debate regarding this subject has garnered substantial attention. Proponents argue that strategic implementation yields tangible benefits, whereas critics caution against unintended repercussions. On balance, a balanced framework offers the most viable path forward.',
      structure_comparison: {
        learner_intro: userText.split('\n\n')[0] || userText.slice(0, 120),
        model_intro: 'Paraphrased the original prompt and articulated a clear overview/thesis statement.',
        learner_body: userText.split('\n\n').slice(1),
        model_body: ['Detailed comparative analysis with relevant statistical evidence.', 'Secondary trends highlighted with clear cohesive devices.'],
      },
    });
  }

  if (task1Band !== null && task2Band !== null) {
    writingBand = calculateWritingBand(task1Band, task2Band);
  } else {
    writingBand = task1Band ?? task2Band ?? null;
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
    validSpeakingBands.push(assessment.band);
    if (assessment.confidence !== 'low') hasAiSpeakingAssessment = true;

    sumFC += assessment.criteria.FC?.band ?? assessment.band;
    sumLR += assessment.criteria.LR?.band ?? assessment.band;
    sumGRA += assessment.criteria.GRA?.band ?? assessment.band;
    sumPR += assessment.criteria.PR?.band ?? assessment.band;

    const words = transcript
      .split(/\s+/)
      .filter(Boolean)
      .map((w, i) => ({ w, start: i * 0.4, end: (i + 1) * 0.4, conf: 0.95 }));
    const metrics = calculateSpeechMetrics(words, 120, partNum === 2 ? 120 : 60);

    speakingPartsResults.push({
      part: partNum,
      transcript: transcript,
      metrics,
      highlights: assessment.highlights,
      improved_answer: assessment.improved_answer,
      vocab_upgrades: assessment.vocab_upgrades,
      cue_card_outline: assessment.cue_card_outline,
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
      writing: writingAttempted && writingBand !== null
        ? {
            band: writingBand,
            task1: task1Band,
            task2: task2Band,
            criteria: {
              TR_TA: writingTasksResults[0]?.criteria?.task_response?.band ?? 6.0,
              CC: writingTasksResults[0]?.criteria?.coherence?.band ?? 6.0,
              LR: writingTasksResults[0]?.criteria?.lexical?.band ?? 6.0,
              GRA: writingTasksResults[0]?.criteria?.grammar?.band ?? 6.0,
            },
            confidence: config.enabled && !skipRemoteAI && hasAiWritingAssessment ? 'medium' : 'low',
            status: 'assessed',
          }
        : {
            band: null,
            task1: null,
            task2: null,
            confidence: 'low',
            status: 'unattempted',
          },
      speaking: speakingAttempted && speakingBand !== null
        ? {
            band: speakingBand,
            criteria: speakingCriteria,
            confidence: config.enabled && !skipRemoteAI && hasAiSpeakingAssessment ? 'medium' : 'low',
            status: 'assessed',
          }
        : {
            band: null,
            confidence: 'low',
            status: 'unattempted',
          },
    },
    aggregates,
    weakness_profile: weaknessProfile,
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
