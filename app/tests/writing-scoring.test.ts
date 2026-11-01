import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWritingPreChecks } from '../src/lib/writing-checks.ts';
import { scoreWritingTask, validateIeltsBand } from '../src/lib/writing-score.ts';
import { computeScoreCacheKey, getCachedScore, setCachedScore, clearScoreCache } from '../src/lib/score-cache.ts';
import { DEFAULT_PROVIDER_CONFIG } from '../src/lib/providers.ts';

test('validateIeltsBand: accepts valid bands and rejects invalid values', () => {
  assert.equal(validateIeltsBand(6.0), 6.0);
  assert.equal(validateIeltsBand(6.25), 6.5);
  assert.equal(validateIeltsBand(6.74), 6.5);
  assert.equal(validateIeltsBand(0), 0);
  assert.equal(validateIeltsBand(9), 9);
  assert.equal(validateIeltsBand(-1), null);
  assert.equal(validateIeltsBand(10), null);
  assert.equal(validateIeltsBand(NaN), null);
  assert.equal(validateIeltsBand('6.5'), null);
  assert.equal(validateIeltsBand(undefined), null);
  assert.equal(validateIeltsBand(null), null);
});

test('runWritingPreChecks: correctly identifies under-length thresholds and length caps', () => {
  const prompt = 'Discuss the advantages and disadvantages of remote working for employees and employers.';

  // Short essay (< 40% of 250 words = < 100 words)
  const shortText = 'Remote working has advantages like saving commute time. However it also has disadvantages.';
  const checksShort = runWritingPreChecks(2, prompt, shortText);
  assert.equal(checksShort.isUnderLength, true);
  assert.equal(checksShort.lengthCap, 4.0);

  // Moderate under-length (175 words = 70% of 250 words; between 60% and 80%)
  const midWords = Array(175).fill('word').join(' ');
  const checksMid = runWritingPreChecks(2, prompt, midWords);
  assert.equal(checksMid.isUnderLength, true);
  assert.equal(checksMid.lengthCap, 5.0);

  // Full length (260 words: > 250)
  const fullWords = Array(260).fill('word').join(' ');
  const checksFull = runWritingPreChecks(2, prompt, fullWords);
  assert.equal(checksFull.isUnderLength, false);
  assert.equal(checksFull.lengthCap, null);
});

test('runWritingPreChecks: detects off-topic text when keywords do not overlap', () => {
  const prompt = 'Some people believe that university education should be free for all students. Discuss.';
  const offTopicText =
    'The recipe for chocolate cake requires flour, sugar, butter and cocoa powder. Mix thoroughly and bake at 180 degrees celsius for forty minutes until the sponge has risen beautifully.';
  const checks = runWritingPreChecks(2, prompt, offTopicText);
  assert.equal(checks.suspectedOffTopic, true);
});

test('scoreWritingTask: returns unscored when AI is disabled or text is too short', async () => {
  const prompt = 'Describe the bar chart illustrating renewable energy generation.';

  // Text too short (< 25 words)
  const tooShort = await scoreWritingTask(1, prompt, null, [], 'The chart shows energy.', 100, {
    ...DEFAULT_PROVIDER_CONFIG,
    enabled: true,
  });
  assert.equal(tooShort.status, 'unscored');
  assert.equal(tooShort.unscored_reason, 'too_short');
  assert.equal(tooShort.band, null);

  // AI disabled
  const essay = 'The provided bar chart depicts the proportion of electricity generated from various renewable resources including wind, solar, and hydroelectric power between 2000 and 2020. Overall, substantial gains were recorded in wind power while hydroelectric output stabilized.';
  const disabled = await scoreWritingTask(1, prompt, null, [], essay, 600, {
    ...DEFAULT_PROVIDER_CONFIG,
    enabled: false,
  });
  assert.equal(disabled.status, 'unscored');
  assert.equal(disabled.unscored_reason, 'ai_disabled');
  assert.equal(disabled.band, null);
});

test('score-cache: caches and retrieves deterministic scored results', () => {
  clearScoreCache();
  const key = computeScoreCacheKey('writing', 'prompt text', 'learner text', 'w-1.0.0', 'gpt-4o');
  assert.equal(getCachedScore(key), null);

  const mockResult = {
    task: 1 as const,
    status: 'scored' as const,
    band: 7.0,
    criteria: {},
    errors: [],
    strengths: ['Clear overview'],
    priority_fixes: [],
    confidence: 'high' as const,
  };
  setCachedScore(key, mockResult);
  assert.deepEqual(getCachedScore(key), mockResult);
});

test('zero-fabrication audit: scoring source files do not contain fabricated fallback bands', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  const filesToCheck = [
    'src/lib/assessment-ai.ts',
    'src/lib/assessment-coordinator.ts',
    'src/lib/writing-score.ts',
  ];

  for (const relPath of filesToCheck) {
    const fullPath = path.resolve(process.cwd(), relPath);
    const content = await fs.readFile(fullPath, 'utf-8');

    // Reject fabricated word-count fallback ternary patterns: ? 6.0 : ... 4.0
    assert.equal(
      content.includes('? 6.0 :') && content.includes('? 5.0 : 4.0'),
      false,
      `${relPath} must not contain fabricated word-count ternary band fallbacks`,
    );

    // Reject isUnderLength ? 5.0 : 6.5 fallback
    assert.equal(
      content.includes('isUnderLength ? 5.0 : 6.5'),
      false,
      `${relPath} must not contain isUnderLength ? 5.0 : 6.5 fallback`,
    );

    // Reject canned fallback phrases
    assert.equal(
      content.includes("'um, like'"),
      false,
      `${relPath} must not contain canned 'um, like' filler highlight`,
    );
  }
});

test('off-topic discrimination: same text across different tasks produces different relevance flags', () => {
  const t1Prompt = 'Summarise the information by selecting and reporting the main features of the electricity production chart.';
  const t2Prompt = 'Some people argue that government investment in public transport is more important than road building. Discuss both views and give your opinion.';

  const publicTransportEssay =
    'Government funding for public transport networks is essential in modern metropolises. Efficient trains and buses reduce carbon emissions, alleviate road congestion, and provide equitable transit for all citizens. In contrast, expanding highways merely induces traffic demand. Therefore, priority must be given to sustainable mass transit.';

  const check1 = runWritingPreChecks(1, t1Prompt, publicTransportEssay);
  const check2 = runWritingPreChecks(2, t2Prompt, publicTransportEssay);

  // The transport essay is relevant to Task 2, but completely off-topic for Task 1 electricity chart
  assert.equal(check1.suspectedOffTopic, true, 'Essay should be flagged off-topic for Task 1 chart');
  assert.equal(check2.suspectedOffTopic, false, 'Essay should NOT be flagged off-topic for Task 2 transport');
});
