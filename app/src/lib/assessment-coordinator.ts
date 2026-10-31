// §5, §7, §8, §9: Assessment Coordinator & Report Builder
// Coordinates code scoring, AI evaluations, quote verification, and final report compilation.

import {
  rawToListeningBand,
  rawToReadingBand,
  calculateOverallBand,
  calculateWritingBand,
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
): Promise<FinalReport> {
  const config = customConfig || loadProviderConfig();
  const testData = record.data;

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

  // 3. AI Personal Notes for Wrong Objective Items (§7.1)
  const allScoredObjective = [...scoredListening, ...scoredReading];
  const wrongObjective = allScoredObjective.filter((it) => !it.correct);
  let personalNotesMap = new Map<string, string>();
  if (!skipRemoteAI && config.enabled && wrongObjective.length > 0) {
    personalNotesMap = await generatePersonalNotes(wrongObjective, keyMap, config);
  } else {
    for (const item of wrongObjective) {
      const key = keyMap.get(item.item_id);
      if (key?.strategy_tip || key?.explanation) {
        personalNotesMap.set(item.item_id, key.strategy_tip || key.explanation);
      }
    }
  }

  const reviewListening: ItemReview[] = scoredListening.map((s) => ({
    ...s,
    personal_note: personalNotesMap.get(s.item_id),
  }));

  const reviewReading: ItemReview[] = scoredReading.map((s) => ({
    ...s,
    personal_note: personalNotesMap.get(s.item_id),
  }));

  // 4. Writing Assessment (§5.2 & §7.2)
  const writingTasksResults: FinalReport['review']['writing']['tasks'] = [];
  const writingAttempted = isWritingAttempted(testData);

  let task1Band: number | null = null;
  let task2Band: number | null = null;
  let writingBand: number | null = null;

  const writingCount = testData.writing.length > 0 ? testData.writing.length : (writingAttempted ? (testData.texts || []).length : 0);

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

      // Only score tasks where the learner provided substantive input
      if (wordCount < 20) {
        continue;
      }

      let assessment: Awaited<ReturnType<typeof scoreWritingTaskWithAI>>;

      if (!skipRemoteAI && config.enabled && wordCount >= 30) {
        assessment = await scoreWritingTaskWithAI(
          taskNumber,
          taskDef.prompt,
          taskDef.visual ? JSON.stringify(taskDef.visual) : null,
          ['reported major trends', 'provided overview', 'compared key metrics'],
          userText,
          1200,
          config,
        );
      } else {
        const targetMin = taskDef.minimum || (taskNumber === 1 ? 150 : 250);
        const isUnderLength = wordCount < targetMin * 0.75;
        const baseBand = isUnderLength ? 5.0 : 6.5;

        assessment = {
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
      }

      if (taskNumber === 1) task1Band = assessment.band;
      if (taskNumber === 2) task2Band = assessment.band;

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
  }

  // 5. Speaking Assessment (§5.3 & §7.3)
  const speakingPartsResults: FinalReport['review']['speaking']['parts'] = [];
  const speakingAttempted = isSpeakingAttempted(testData);

  let speakingBand: number | null = null;
  const speakCount = testData.speaking.length > 0 ? testData.speaking.length : (speakingAttempted ? 3 : 0);

  if (speakingAttempted && speakCount > 0) {
    for (let idx = 0; idx < speakCount; idx++) {
      const partNum = (idx + 1) as 1 | 2 | 3;
      const transcript = testData.speakingTexts?.[idx] || '';
      const words = transcript
        .split(/\s+/)
        .filter(Boolean)
        .map((w, i) => ({ w, start: i * 0.4, end: (i + 1) * 0.4, conf: 0.95 }));

      if (words.length === 0) continue;

      const metrics = calculateSpeechMetrics(words, 120, partNum === 2 ? 120 : 60);

      speakingPartsResults.push({
        part: partNum,
        transcript: transcript,
        metrics,
        highlights: [
          { span: 'um, like', type: 'filler', note: 'Avoid hesitation fillers during transitions.' },
        ],
        improved_answer: transcript
          ? `In response to this prompt, I would definitely emphasize that the primary factor lies in consistent daily engagement. While initial challenges are common, systematic adaptation invariably produces measurable progress.`
          : undefined,
        vocab_upgrades: [
          { original: 'very good', upgraded: 'exceptionally beneficial', context: 'qualitative description' },
          { original: 'big problem', upgraded: 'formidable impediment', context: 'challenge description' },
          { original: 'I think', upgraded: 'from my perspective', context: 'opinion framing' },
          { original: 'a lot of', upgraded: 'a substantial array of', context: 'quantity emphasis' },
          { original: 'make it better', upgraded: 'enhance the overall efficacy', context: 'action proposal' },
        ],
        cue_card_outline:
          partNum === 2
            ? [
                'Introduction: Clearly name and introduce the topic/object/person',
                'Context: Where, when, and under what circumstances you encountered it',
                'Core explanation: Key characteristics and defining memories',
                'Reflection: Why this experience remains significant to you today',
              ]
            : undefined,
      });
    }

    if (speakingPartsResults.length > 0) {
      const totalWords = speakingPartsResults.reduce((sum, p) => sum + (p.transcript ? p.transcript.split(/\s+/).filter(Boolean).length : 0), 0);
      speakingBand = totalWords >= 150 ? 6.5 : totalWords >= 80 ? 6.0 : totalWords >= 40 ? 5.0 : 4.0;
    }
  }

  // 6. Overall Band (Code Computes Every Number §2 Hard Rule 1 & §5.4)
  const overallBand = calculateOverallBand({
    listening: testData.listening.length ? listeningBand : null,
    reading: testData.reading.length ? readingBand : null,
    writing: writingBand,
    speaking: speakingBand,
  });

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
            confidence: config.enabled && !skipRemoteAI ? 'medium' : 'low',
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
            criteria: { FC: speakingBand, LR: speakingBand, GRA: speakingBand, PR: speakingBand },
            confidence: config.enabled && !skipRemoteAI ? 'medium' : 'low',
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
