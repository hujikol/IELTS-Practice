// Standard authentic sample IELTS materials including 2-way conversational listening sections.
// All materials are strictly validated against validateBlock (§6.2).

import type { RawBlock, RawQuestion, RawScriptLine } from './types.ts';
import { validateBlock } from './material.ts';
import { createAttempt, type AttemptRecord } from './attempts.ts';

const gap = (
  stem: string,
  answer: string,
  group: number,
  maxWords = 3,
): RawQuestion => ({
  stem,
  kind: 'gap',
  choices: [],
  correct: 0,
  answerText: answer,
  accepted: [answer],
  maxWords,
  explanation: 'Stated directly in the dialogue transcript.',
  evidence: answer,
  skill: 'form completion',
  group,
});

export const CONVERSATIONAL_LISTENING_SCRIPT: RawScriptLine[] = [
  // Group 0: Personal Details & Booking (Turns 1-14)
  { speaker: 'man', group: 0, text: 'Good morning, Oakridge Community Sports and Aquatic Centre. Mark speaking. How can I assist you today?' },
  { speaker: 'woman', group: 0, text: 'Hello Mark. I recently relocated to the local district and I would like some information about joining your sports centre and signing up for courses.' },
  { speaker: 'man', group: 0, text: 'Welcome to the neighbourhood! We offer a wide range of facilities for both casual recreation and structured training. I can take down your initial registration details right now over the telephone if that suits you.' },
  { speaker: 'woman', group: 0, text: 'Yes, that would be wonderful. I would really appreciate that. Thank you.' },
  { speaker: 'man', group: 0, text: 'Splendid. First of all, could I have your full name please, including the spelling of your family name?' },
  { speaker: 'woman', group: 0, text: 'Yes, of course. My first name is Helen, and my surname is Baxter. That is spelled B-A-X-T-E-R.' },
  { speaker: 'man', group: 0, text: 'Thank you, Helen. And what is your current residential address here in the town so we can verify local residency?' },
  { speaker: 'woman', group: 0, text: 'I am currently living at 48 Highbury Crescent. Some postal delivery drivers mistake it for number 46, but my front entrance is definitely forty-eight.' },
  { speaker: 'man', group: 0, text: 'Got it, 48 Highbury Crescent. And a reliable contact telephone number where we can send confirmation text messages or urgent schedule updates?' },
  { speaker: 'woman', group: 0, text: 'My daytime mobile number is 07941 623880.' },
  { speaker: 'man', group: 0, text: 'Let me double check that to ensure accuracy: 07941 623880. Perfect. Next, our fitness instructors always ask new members to self-assess their baseline conditioning. Would you categorize yourself as a beginner, intermediate, or advanced fitness participant?' },
  { speaker: 'woman', group: 0, text: 'Well, I regularly jog three mornings a week and used to swim in university competitions, so I would describe myself as intermediate rather than a total novice.' },
  { speaker: 'man', group: 0, text: 'Excellent, intermediate conditioning gives you immediate access to our lane swimming and intermediate circuit classes without requiring an introductory appraisal. And when would you like your active membership period to begin?' },
  { speaker: 'woman', group: 0, text: 'I am travelling away on business early next week, so I would like to officially start on the 14th October if that is feasible.' },
  { speaker: 'man', group: 0, text: 'The 14th October falls on a Monday, which is ideal because our new instructional timetable commences that exact morning.' },

  // Group 1: Facilities, Timings & Fees (Turns 15-28)
  { speaker: 'woman', group: 1, text: 'That sounds very convenient indeed. Could you tell me more about the racquet courts and sports activities included in the standard package?' },
  { speaker: 'man', group: 1, text: 'Certainly. Aside from our Olympic swimming pool and multi-gym floor, our main indoor sports arena is set up for squash, tennis, and badminton. Which specific sport are you most keen on practicing?' },
  { speaker: 'woman', group: 1, text: 'I am particularly enthusiastic about playing badminton. Do I need to book the courts in advance, or can I just walk in?' },
  { speaker: 'man', group: 1, text: 'Because demand is high, badminton court reservations can be booked up to six days ahead through our member mobile application. Now regarding operational hours, our peak hours are from 6:30 am until 9:30 pm on weekdays. On weekends we operate reduced hours from 8:00 am until 7:00 pm.' },
  { speaker: 'woman', group: 1, text: 'Until 9:30 pm is very generous for people finishing late office shifts. What about the changing rooms and locker arrangements?' },
  { speaker: 'man', group: 1, text: 'We have newly renovated heated changing facilities with electronic digital lockers. To obtain a personal electronic locker key card from reception, members pay a refundable deposit of 15 pounds, which is returned whenever you return the card.' },
  { speaker: 'woman', group: 1, text: 'That is very reasonable. Are there any particular rules or dress codes for the swimming pool area that I should know beforehand?' },
  { speaker: 'man', group: 1, text: 'Good question. Standard swimwear is required, and for hygiene regulations, wearing a swimming cap is mandatory for all swimmers in the deep-water competition pool. We supply disposable earplugs if needed, but the cap is strictly enforced.' },
  { speaker: 'woman', group: 1, text: 'I always bring my own silicone cap, so that won\'t be an issue at all. And lastly, what are the membership pricing tiers?' },
  { speaker: 'man', group: 1, text: 'Our standard monthly rolling subscription is 35 pounds per month. However, if you choose to pay for the complete year upfront, we offer a discounted annual fee of 320 pounds, saving you a substantial sum over twelve months.' },
  { speaker: 'woman', group: 1, text: 'An annual rate of 320 pounds represents tremendous value for full facility access. Let us proceed with the upfront annual option, please.' },
  { speaker: 'man', group: 1, text: 'Brilliant. I will set up your digital profile right now and email you the orientation guide and receipt. We look forward to seeing you at the centre.' },
  { speaker: 'woman', group: 1, text: 'Thank you very much for all your assistance, Mark. Have a pleasant day. Goodbye.' },
  { speaker: 'man', group: 1, text: 'Goodbye, Helen. Have a great day.' },
];

export const CONVERSATIONAL_LISTENING_BLOCK: RawBlock = {
  title: 'Oakridge Sports Centre Membership Inquiry',
  description: 'A 2-way conversation between Helen Baxter and club receptionist Mark regarding membership registration, facilities, rules, and fees.',
  text: CONVERSATIONAL_LISTENING_SCRIPT.map((l) => l.text).join(' '),
  groups: [
    {
      title: 'Personal Details & Registration',
      instructions: 'Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.',
      start: 1,
      end: 5,
    },
    {
      title: 'Facilities, Hours & Fee Options',
      instructions: 'Write NO MORE THAN THREE WORDS AND/OR A NUMBER for each answer.',
      start: 6,
      end: 10,
    },
  ],
  questions: [
    gap('Caller family surname: Baxter', 'Baxter', 0),
    gap('Residential street address: 48 Highbury Crescent', '48 Highbury Crescent', 0),
    gap('Contact mobile telephone: 07941 623880', '07941 623880', 0),
    gap('Current self-assessed fitness tier: intermediate', 'intermediate', 0),
    gap('Requested official start date: 14th October', '14th October', 0),
    gap('Preferred racquet sport chosen: badminton', 'badminton', 1),
    gap('Weekday peak hours access ends at: 9:30 pm', '9:30 pm', 1),
    gap('Electronic locker key card refundable deposit: 15 pounds', '15 pounds', 1),
    gap('Mandatory item for pool swimmers: swimming cap', 'swimming cap', 1),
    gap('Discounted upfront annual membership fee: 320 pounds', '320 pounds', 1),
  ],
  script: CONVERSATIONAL_LISTENING_SCRIPT,
};

// Validate at module load time to guarantee adherence
validateBlock(CONVERSATIONAL_LISTENING_BLOCK, 'listening', 1);

/**
 * Creates a ready-to-play IELTS test populated with the 2-Way Conversational Listening section.
 */
export async function createConversationalListeningAttempt(
  mode: 'timed' | 'untimed' = 'untimed',
): Promise<AttemptRecord> {
  const block = CONVERSATIONAL_LISTENING_BLOCK;
  const now = Date.now();

  const attempt = await createAttempt({
    mode,
    scope: 'listening',
    practice_part: 1,
    data: {
      version: 2,
      seed: Math.floor(Math.random() * 10000),
      scope: 'listening',
      practicePart: 1,
      focusSkill: 'form completion',
      jobs: [
        {
          key: 'l0',
          section: 'listening',
          part: 1,
          label: 'Listening · Part 1 (2-Way Conversation)',
        },
      ],
      prepared: ['l0'],
      listening: [
        {
          title: block.title,
          description: block.description || block.title,
          text: block.text,
          groups: block.groups.map((g) => ({ ...g })),
          questions: block.questions.map((q, idx) => ({
            id: `l-p1-q${idx + 1}`,
            stem: q.stem,
            kind: q.kind,
            choices: [...q.choices],
            correct: q.correct,
            answerText: q.answerText,
            accepted: [...q.accepted],
            maxWords: q.maxWords,
            explanation: q.explanation,
            evidence: q.evidence,
            skill: q.skill,
            topic: 'sports centre membership',
            section: 'listening' as const,
            part: 1,
            group: q.group,
            number: idx + 1,
          })),
          script: block.script?.map((s) => ({ ...s })),
        },
      ],
      reading: [],
      writing: [],
      speaking: [],
      answers: {},
      phase: 0,
      part: 0,
      group: 0,
      responses: {},
      texts: ['', ''],
      speakingTexts: ['', '', ''],
      times: [1920, 3600, 3600, 840],
      notes: ['', '', '', ''],
      marked: [],
      audioPlayed: [],
      privacyWarnings: 0,
      recordings: {},
      generation: {
        provider: 'built-in-verified',
        model: 'kokoro-fp32',
        createdAt: now,
      },
    },
  });

  return attempt;
}
