// Cambridge IELTS Speaking Examiners Roster, Warmup Randomization, and Question De-duplication.
// Provides authentic Cambridge examiners with distinct UK accents (using Kokoro neural voices),
// randomized introductory ID checks, and strict filtering to prevent candidate identity or warmup
// repetition in Part 1 interview question sets.

export type ExaminerProfile = {
  id: string;
  name: string;
  title: string;
  gender: 'Male' | 'Female';
  voiceId: string;
  avatarSeed: string;
  accent: 'British';
  greetings: string[];
};

export const EXAMINER_PROFILES: readonly ExaminerProfile[] = [
  {
    id: 'dr_richard_evans',
    name: 'Dr. Richard Evans',
    title: 'Senior IELTS Examiner',
    gender: 'Male',
    voiceId: 'bm_george',
    avatarSeed: 'richard',
    accent: 'British',
    greetings: [
      'Good morning. My name is Dr. Richard Evans. Could you tell me your full name, please? And what shall I call you? Thank you. Can I check your identification, please?',
      'Good afternoon. My name is Dr. Richard Evans. Could you state your full name for the record? And what would you prefer me to call you? Thank you. May I see your identification?',
      'Hello. My name is Dr. Richard Evans. First of all, could you tell me your full name, please? And what should I address you as? That’s fine. Can I examine your identification?',
    ],
  },
  {
    id: 'mrs_victoria_sinclair',
    name: 'Mrs. Victoria Sinclair',
    title: 'Cambridge Certified Examiner',
    gender: 'Female',
    voiceId: 'bf_emma',
    avatarSeed: 'victoria',
    accent: 'British',
    greetings: [
      'Good morning. My name is Mrs. Victoria Sinclair. Could you tell me your full name, please? And what would you like me to call you? Thank you. May I see your identification, please?',
      'Good afternoon. My name is Mrs. Victoria Sinclair. To begin, could you please tell me your full name? And how should I refer to you? Thank you. Can I verify your identification?',
      'Hello and welcome. My name is Mrs. Victoria Sinclair. First, could you tell me your full name, please? And what shall I call you during the test? Thank you. May I check your ID?',
    ],
  },
  {
    id: 'mr_david_harrison',
    name: 'Mr. David Harrison',
    title: 'Senior IELTS Examiner',
    gender: 'Male',
    voiceId: 'bm_lewis',
    avatarSeed: 'david',
    accent: 'British',
    greetings: [
      'Good morning. My name is David Harrison. Could you tell me your complete name, please? And what shall I call you? That’s fine. Could I check your identification document, please?',
      'Good afternoon. My name is Mr. Harrison. To start with, could you please state your full name? And what should I call you? Thank you very much. May I inspect your ID?',
      'Hello. My name is David Harrison. First of all, could you tell me your name, please? And what do your friends call you? Thank you. Can I check your passport or ID?',
    ],
  },
  {
    id: 'dr_eleanor_campbell',
    name: 'Dr. Eleanor Campbell',
    title: 'Cambridge Certified Examiner',
    gender: 'Female',
    voiceId: 'bf_isabella',
    avatarSeed: 'eleanor',
    accent: 'British',
    greetings: [
      'Good morning. My name is Dr. Eleanor Campbell. Could you tell me your full name, please? And what name would you prefer me to use? Thank you. May I see your identification?',
      'Good afternoon. My name is Dr. Eleanor Campbell. Could you tell me your complete name for the test? And what should I call you? Thank you. Can I check your identification document, please?',
      'Hello and welcome. My name is Dr. Eleanor Campbell. To begin, could you please state your full name? And what shall I address you as? Thank you. May I verify your ID?',
    ],
  },
  {
    id: 'mr_oliver_bennett',
    name: 'Mr. Oliver Bennett',
    title: 'Senior IELTS Examiner',
    gender: 'Male',
    voiceId: 'bm_daniel',
    avatarSeed: 'oliver',
    accent: 'British',
    greetings: [
      'Good morning. My name is Oliver Bennett. Could you tell me your full name, please? And what shall I call you? Thank you. Can I check your identification, please?',
      'Good afternoon. My name is Oliver Bennett. Could you please state your full name? And what would you like me to call you? Thank you very much. May I see your ID, please?',
      'Hello. My name is Mr. Bennett. First, could you tell me your full name, please? And what should I call you during our conversation? Thank you. Can I inspect your identification?',
    ],
  },
  {
    id: 'ms_alice_gallagher',
    name: 'Ms. Alice Gallagher',
    title: 'Cambridge Certified Examiner',
    gender: 'Female',
    voiceId: 'bf_alice',
    avatarSeed: 'alice',
    accent: 'British',
    greetings: [
      'Good morning. My name is Alice Gallagher. Could you tell me your full name, please? And what would you like me to call you? Thank you. May I see your identification, please?',
      'Good afternoon. My name is Ms. Gallagher. To start with, could you please tell me your full name? And how should I address you? Thank you. Can I verify your ID?',
      'Hello and welcome. My name is Alice Gallagher. Could you tell me your complete name, please? And what shall I call you? Thank you very much. May I check your identification document?',
    ],
  },
];

/** Selects a deterministic examiner profile per attempt, or random if no attemptId provided */
export function getExaminerForAttempt(attemptId?: string): ExaminerProfile {
  if (!attemptId) {
    const rIdx = Math.floor(Math.random() * EXAMINER_PROFILES.length);
    return EXAMINER_PROFILES[rIdx]!;
  }
  let hash = 0;
  for (let i = 0; i < attemptId.length; i++) {
    hash = (hash << 5) - hash + attemptId.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % EXAMINER_PROFILES.length;
  return EXAMINER_PROFILES[idx]!;
}

/** Returns a randomized introductory greeting for the chosen examiner */
export function getRandomExaminerGreeting(examiner: ExaminerProfile, attemptId?: string): string {
  if (!attemptId) {
    const rIdx = Math.floor(Math.random() * examiner.greetings.length);
    return examiner.greetings[rIdx]!;
  }
  let hash = 0;
  for (let i = 0; i < attemptId.length; i++) {
    hash = (hash << 3) - hash + attemptId.charCodeAt(i);
    hash |= 0;
  }
  const gIdx = Math.abs(hash) % examiner.greetings.length;
  return examiner.greetings[gIdx]!;
}

/**
 * Detects whether a question string is an identity, name, or identification check
 * that belongs in the introductory phase rather than in Part 1 interview questions.
 */
export function isIntroOrIdentityQuestion(questionText: string): boolean {
  if (!questionText || typeof questionText !== 'string') return false;
  const q = questionText.toLowerCase().trim();

  // Full name checks
  if (/(what('?s|\s+is)\s+your\s+(full\s+)?name|tell\s+me\s+your\s+(full\s+)?name|state\s+your\s+(full\s+)?name)/i.test(q)) {
    return true;
  }
  // What shall I call you / preferred address / what to call candidate
  if (/(call\s+you|address\s+you|call\s+myself|what\s+name\s+(would|should|do)\s+you)/i.test(q)) {
    return true;
  }
  // Identification / passport / ID checks
  if (/(check\s+your\s+id|see\s+your\s+id|inspect\s+your\s+id|identification|passport|id\s+card|verify\s+your\s+id)/i.test(q)) {
    return true;
  }
  // Examiner check request
  if (/(can|may|could)\s+i\s+(check|see|verify|examine|inspect)\s+your/i.test(q)) {
    return true;
  }

  return false;
}

/** Clean question text removing "Examiner:", numbering, or prompt notes */
export function cleanSpeakingQuestion(text: string): string {
  return (text || '')
    .replace(/^(Examiner|Candidate):\s*/i, '')
    .replace(/^(\d+[\.\)]\s*)/i, '')
    .replace(/\(Ask the questions? below:?\)/gi, '')
    .replace(/\(Candidate answers?\)/gi, '')
    .trim();
}

const DEFAULT_CAMBRIDGE_PART1_FALLBACKS: readonly string[] = [
  'Do you work or are you a student?',
  'What do you enjoy most about your work or studies?',
  'Where is your hometown located?',
  'What do you like most about living in your area?',
  'How often do you spend time outdoors or in nature?',
  'Do you prefer spending your free time alone or with friends?',
  'Do you enjoy cooking or preparing meals at home?',
  'What kind of music do you like listening to when you relax?',
  'How do you usually organise your daily schedule?',
  'What is your favourite season of the year, and why?',
  'Do you prefer reading books or watching films in your leisure time?',
  'How has public transport improved in your city over recent years?',
  'Do you enjoy visiting historical museums or art galleries?',
  'What kind of photographs do you like taking on your phone?',
  'How often do you go for walks or exercise in parks?',
];

/**
 * Sanitizes and de-duplicates Part 1 questions:
 * 1. Cleans prompt prefixes.
 * 2. Filters out any candidate name or identification questions to prevent repetition.
 * 3. Ensures at least 4 authentic Cambridge topic questions.
 */
export function filterAndPreparePart1Questions(rawQuestions: string[]): string[] {
  const cleaned = (rawQuestions || [])
    .map(cleanSpeakingQuestion)
    .filter((q) => q.length > 0 && !isIntroOrIdentityQuestion(q));

  // Deduplicate against each other
  const uniqueQuestions: string[] = [];
  const seenLower = new Set<string>();

  for (const q of cleaned) {
    const key = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!seenLower.has(key)) {
      seenLower.add(key);
      uniqueQuestions.push(q);
    }
  }

  // If filtered pool is too small (< 4), fill from authentic Cambridge topics
  if (uniqueQuestions.length < 4) {
    for (const fallback of DEFAULT_CAMBRIDGE_PART1_FALLBACKS) {
      const key = fallback.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!seenLower.has(key)) {
        seenLower.add(key);
        uniqueQuestions.push(fallback);
      }
      if (uniqueQuestions.length >= 4) break;
    }
  }

  return uniqueQuestions;
}
