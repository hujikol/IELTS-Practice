import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXAMINER_PROFILES,
  getExaminerForAttempt,
  getRandomExaminerGreeting,
  isIntroOrIdentityQuestion,
  cleanSpeakingQuestion,
  filterAndPreparePart1Questions,
} from '../src/lib/examiners.ts';
import {
  getAllSpeakingPrompts,
  checkTestAudioCacheStatus,
} from '../src/lib/audio-manager.ts';
import type { SpeakingPart } from '../src/lib/types.ts';

test('EXAMINER_PROFILES defines authentic Cambridge examiners with verified Kokoro British voices', () => {
  assert.ok(EXAMINER_PROFILES.length >= 6, 'Expected at least 6 examiner profiles');
  const validVoices = new Set(['bm_george', 'bf_emma', 'bm_lewis', 'bf_isabella', 'bm_daniel', 'bf_alice']);

  for (const ex of EXAMINER_PROFILES) {
    assert.ok(ex.name && ex.name.length > 0, 'Examiner must have a name');
    assert.ok(ex.title && ex.title.length > 0, 'Examiner must have a title');
    assert.equal(ex.accent, 'British');
    assert.ok(validVoices.has(ex.voiceId), `Examiner ${ex.name} uses unverified voice: ${ex.voiceId}`);
    assert.ok(ex.greetings.length >= 2, `Examiner ${ex.name} must have multiple greetings`);
    for (const g of ex.greetings) {
      assert.ok(g.includes(ex.name) || g.includes(ex.name.split(' ').pop()!), 'Greeting must mention examiner name');
    }
  }
});

test('getExaminerForAttempt resolves deterministically by attemptId and distributes across profiles', () => {
  const ex1 = getExaminerForAttempt('att_alpha_123');
  const ex1Repeat = getExaminerForAttempt('att_alpha_123');
  assert.equal(ex1.id, ex1Repeat.id, 'Same attemptId must resolve to the identical examiner');

  const ex2 = getExaminerForAttempt('att_beta_456');
  const ex3 = getExaminerForAttempt('att_gamma_789');
  const distinct = new Set([ex1.id, ex2.id, ex3.id]);
  assert.ok(distinct.size >= 2, 'Different attempts should rotate across examiner pool');
});

test('getRandomExaminerGreeting returns authentic intro and ID check', () => {
  const ex = EXAMINER_PROFILES[0]!;
  const greeting = getRandomExaminerGreeting(ex, 'att_test_1');
  assert.ok(greeting && greeting.length > 20);
  assert.ok(greeting.toLowerCase().includes('name') || greeting.toLowerCase().includes('identification'));
});

test('isIntroOrIdentityQuestion detects warmup and identity checks to prevent Part 1 repetition', () => {
  // Identity and warmup checks that MUST be detected and filtered out of Part 1
  assert.equal(isIntroOrIdentityQuestion('Could you tell me your full name, please?'), true);
  assert.equal(isIntroOrIdentityQuestion('What is your name?'), true);
  assert.equal(isIntroOrIdentityQuestion("What's your full name?"), true);
  assert.equal(isIntroOrIdentityQuestion('And what shall I call you?'), true);
  assert.equal(isIntroOrIdentityQuestion('What should I address you as?'), true);
  assert.equal(isIntroOrIdentityQuestion('Can I check your identification?'), true);
  assert.equal(isIntroOrIdentityQuestion('May I see your passport or ID?'), true);
  assert.equal(isIntroOrIdentityQuestion('Could you show me your ID card?'), true);

  // Substantive Part 1 questions that MUST NOT be filtered out
  assert.equal(isIntroOrIdentityQuestion('Do you work or are you a student?'), false);
  assert.equal(isIntroOrIdentityQuestion('What do you enjoy most about your studies?'), false);
  assert.equal(isIntroOrIdentityQuestion('Where is your hometown located?'), false);
  assert.equal(isIntroOrIdentityQuestion('What kind of weather do you prefer?'), false);
  assert.equal(isIntroOrIdentityQuestion('How often do you read books or magazines?'), false);
});

test('cleanSpeakingQuestion strips prefixes and annotations cleanly', () => {
  assert.equal(
    cleanSpeakingQuestion('Examiner: Do you work or are you a student? (Ask the questions below:)'),
    'Do you work or are you a student?',
  );
  assert.equal(
    cleanSpeakingQuestion('1. Where is your hometown?'),
    'Where is your hometown?',
  );
});

test('filterAndPreparePart1Questions removes duplicate warmup questions and ensures authentic set', () => {
  const rawPart1 = [
    'What is your full name?', // Should be removed
    'Can I see your identification?', // Should be removed
    'Do you work or are you a student?',
    'What do you enjoy most about your work or studies?',
  ];

  const prepared = filterAndPreparePart1Questions(rawPart1);

  // Must not contain any identity check
  for (const q of prepared) {
    assert.equal(isIntroOrIdentityQuestion(q), false, `Identity question leaked into Part 1: ${q}`);
  }

  // Must keep the substantive questions
  assert.ok(prepared.includes('Do you work or are you a student?'));
  assert.ok(prepared.includes('What do you enjoy most about your work or studies?'));

  // Must guarantee at least 4 questions by supplementing authentic Cambridge topics
  assert.ok(prepared.length >= 4, `Expected at least 4 questions, got ${prepared.length}`);
});

test('getAllSpeakingPrompts extracts complete examiner interview prompts across all 3 parts', () => {
  const sampleParts: SpeakingPart[] = [
    {
      part: 1,
      prompt: "Let's talk about where you live or what you do.",
      questions: [
        'Do you work or are you a student?',
        'What do you enjoy most about your work or studies?',
        'Where is your hometown located?',
        'What do you like most about living there?',
      ],
    },
    {
      part: 2,
      prompt: 'Describe a memorable journey you took by public transport.',
      cue: ['Where you went', 'What transport you used', 'Who was with you', 'Why memorable'],
      questions: ['Do you still make this journey?', 'Would you recommend this transport to others?'],
    },
    {
      part: 3,
      prompt: "We've been talking about travel, and now I'd like to discuss broader transportation issues.",
      questions: [
        'How has public transport changed in your country over recent decades?',
        'Do you think governments should invest more in trains rather than roads?',
      ],
    },
  ];

  const prompts = getAllSpeakingPrompts(sampleParts, 'Good morning. My name is Dr. Richard Evans. Can I check your ID?');

  assert.ok(prompts.length >= 10, `Expected at least 10 speaking prompts, got ${prompts.length}`);
  // Check intro greeting
  assert.ok(prompts[0]!.includes('Dr. Richard Evans'));
  // Check Part 1 transition
  assert.ok(prompts.some((p) => p.includes("Now, in this first part, I'd like to ask you some questions about yourself.")));
  // Check Part 2 transition
  assert.ok(prompts.some((p) => p.includes("Now, I am going to give you a topic, and I'd like you to talk about it for one to two minutes.")));
  // Check Part 2 cue announcement
  assert.ok(prompts.some((p) => p.includes("All right. Remember, you have one to two minutes for this")));
  // Check conclusion
  assert.ok(prompts.some((p) => p.includes('That is the end of the speaking test.')));
});

test('checkTestAudioCacheStatus includes speaking prompts in line counts and missing voices calculation', async () => {
  const speakingParts: SpeakingPart[] = [
    {
      part: 1,
      prompt: "Let's talk about yourself.",
      questions: ['Do you work or are you a student?', 'Where is your hometown located?'],
    },
  ];

  // Under webspeech -> never missing
  const wsStatus = await checkTestAudioCacheStatus([], {}, 'webspeech', speakingParts);
  assert.equal(wsStatus.missingVoices, false);

  // Under neural Kokoro -> totalLines must reflect both listening (0) and speaking (> 0)
  const neuralStatus = await checkTestAudioCacheStatus([], {}, 'kokoro-fp16', speakingParts, 'bm_george');
  assert.ok(neuralStatus.totalLines >= 8, `Expected at least 8 speaking prompts in totalLines, got ${neuralStatus.totalLines}`);
  assert.equal(neuralStatus.cachedLines, 0);
  assert.equal(neuralStatus.missingVoices, true);
});
