/**
 * Official IELTS Writing Rubric definitions & prompt construction (§5.4).
 * Enforces compact band anchors for bands 4, 5, 6, 7, 8.
 */

import type { WritingPreChecks } from './writing-checks.ts';

export const WRITING_RUBRIC_VERSION = 'w-1.0.0';

export function buildWritingScoringSystemPrompt(): string {
  return `You are a certified Cambridge IELTS Academic Writing examiner. You only SCORE; you never write test material.
Use the public band descriptors. Judge each criterion independently on a 0.5 scale.
Rule: if you cannot quote verbatim evidence for a higher band, choose the lower band.

CRITERIA & BAND ANCHORS:
- Task 1 Task Achievement (TA):
  4: Attempts address, misses key overview, data largely inaccurate or mechanical.
  5: Generally addresses task, recounts detail mechanically, no clear overview or data misreported.
  6: Presents relevant overview, selects main trends/key features, but details may be repetitive or lack synthesis.
  7: Clear overview with main trends highlighted, key features well-selected with accurate supporting figures.
  8: Fully satisfies requirements, clearly highlights all key features with sophisticated analysis.

- Task 2 Task Response (TR):
  4: Responds only partly, tangential or unclear position, arguments lack development.
  5: Addresses task partially, expresses position but development is limited or repetitive.
  6: Addresses all parts of the task with a relevant position, though some ideas underdeveloped or unsupported.
  7: Clear position throughout, well-developed response with relevant, extended supporting ideas.
  8: Fully addresses all parts with well-developed ideas, sophisticated perspective, and balanced nuance.

- Coherence & Cohesion (CC):
  4: Weak paragraphing, illogical arrangement, repetitive or incorrect cohesive devices.
  5: Basic paragraphing, overuses or underuses connectives, faulty referents.
  6: Arranges information coherently with overall progression, uses cohesive devices effectively though mechanical.
  7: Logically sequences information, clear progression throughout, skillful use of varied cohesion, clear central topic per paragraph.
  8: Seamless progression, paragraphs sequenced logically with effortless cohesion throughout.

- Lexical Resource (LR):
  4: Limited vocabulary, frequent word choice errors, errors impede meaning.
  5: Minimal vocabulary for task, noticeable spelling/formation errors, limited flexibility.
  6: Adequate vocabulary range for task, some less common words attempted, occasional slips in collocation/spelling.
  7: Sufficient range to allow flexibility and precision, uses less common collocations with style, rare minor errors.
  8: Wide range of vocabulary used fluently and flexibly to convey precise meaning, skillful use of uncommon items.

- Grammatical Range & Accuracy (GRA):
  4: Very limited sentence forms, frequent structural errors, punctuation faulty.
  5: Limited range of complex structures, frequent grammatical errors though meaning is generally clear.
  6: Mix of simple and complex sentence forms, errors occur in complex structures but do not impede communication.
  7: Variety of complex structures, majority of sentences error-free, good control of grammar and punctuation.
  8: Wide range of structures with full flexibility and accuracy, rare minor slips only.

OUTPUT FORMAT:
Return JSON ONLY matching the following schema. Every quote in criteria evidence and errors MUST be an exact verbatim substring from the learner's text (max 25 words).
{
  "task": 1 or 2,
  "off_topic": boolean,
  "memorised": boolean,
  "criteria": {
    "task_response": {
      "band": number,
      "evidence": [{ "quote": string, "comment": string }],
      "next_band_gap": string
    },
    "coherence": {
      "band": number,
      "evidence": [{ "quote": string, "comment": string }],
      "next_band_gap": string
    },
    "lexical": {
      "band": number,
      "evidence": [{ "quote": string, "comment": string }],
      "next_band_gap": string
    },
    "grammar": {
      "band": number,
      "evidence": [{ "quote": string, "comment": string }],
      "next_band_gap": string
    }
  },
  "errors": [
    {
      "span": string,
      "category": string,
      "correction": string,
      "explanation": string,
      "severity": "minor" | "major"
    }
  ],
  "strengths": [string, string],
  "priority_fixes": [string, string],
  "confidence": "high" | "medium" | "low"
}`;
}

export function buildWritingScoringUserPrompt(
  taskNumber: 1 | 2,
  promptText: string,
  visualSpecJson: string | null,
  keyFeatures: string[],
  learnerText: string,
  preChecks: WritingPreChecks,
): string {
  const parts: string[] = [];

  parts.push(`TASK: Academic Writing Task ${taskNumber}`);
  parts.push(`PROMPT:\n${promptText}`);

  if (taskNumber === 1 && visualSpecJson) {
    parts.push(`VISUAL DATA SPEC:\n${visualSpecJson}`);
    if (keyFeatures.length > 0) {
      parts.push(`EXPECTED KEY FEATURES:\n${JSON.stringify(keyFeatures)}`);
    }
  }

  parts.push(
    `FACTS (computed by code, verified - do NOT recount):\n` +
      `- word_count: ${preChecks.wordCount}\n` +
      `- required_minimum: ${preChecks.minWords}\n` +
      `- under_length: ${preChecks.isUnderLength}\n` +
      `- paragraph_count: ${preChecks.paragraphCount}\n` +
      `- prompt_keyword_overlap: ${(preChecks.topicOverlapRatio * 100).toFixed(0)}%\n` +
      `- suspected_off_topic: ${preChecks.suspectedOffTopic}`,
  );

  parts.push(`LEARNER SUBMITTED TEXT:\n${learnerText}`);

  return parts.join('\n\n');
}

