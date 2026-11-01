// Seeded variety blueprints for generated material.
//
// Without these, the model sees nearly the same request every time and answers with the
// same handful of question types and topics. Each attempt already carries a random seed,
// so every pick here is derived from (seed, job) — a fresh mix per attempt, but the SAME
// mix when a request is re-rendered for a repair, so a repair never contradicts the
// original request. Every type listed maps onto a question kind the validator accepts.

// ─── Seeded PRNG ───

const hashSalt = (salt: string): number => {
  let h = 2166136261;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** mulberry32 — tiny, fast, good enough for picking prompt ingredients. */
export function seededRandom(seed: number, salt: string): () => number {
  let a = ((seed >>> 0) ^ hashSalt(salt)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;

const shuffle = <T>(rand: () => number, items: readonly T[]): T[] => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

const sample = <T>(rand: () => number, items: readonly T[], n: number): T[] => shuffle(rand, items).slice(0, n);

/** Split `total` questions into `groups` sizes, each at least `min`. */
const splitCount = (rand: () => number, total: number, groups: number, min = 3): number[] => {
  const sizes = Array.from({ length: groups }, () => min);
  for (let left = total - min * groups; left > 0; left--) sizes[Math.floor(rand() * groups)]! += 1;
  return sizes;
};

const ranges = (sizes: number[]): string[] => {
  let start = 1;
  return sizes.map((n) => {
    const r = `Questions ${start}-${start + n - 1}`;
    start += n;
    return r;
  });
};

const WORD_LIMITS = [
  'ONE WORD ONLY',
  'ONE WORD AND/OR A NUMBER',
  'NO MORE THAN TWO WORDS',
  'NO MORE THAN TWO WORDS AND/OR A NUMBER',
  'NO MORE THAN THREE WORDS',
] as const;

/** maxWords counts every token, so "a number" adds one to the word allowance. */
const MAX_WORDS: Record<string, number> = {
  'ONE WORD ONLY': 1,
  'ONE WORD AND/OR A NUMBER': 2,
  'NO MORE THAN TWO WORDS': 2,
  'NO MORE THAN TWO WORDS AND/OR A NUMBER': 3,
  'NO MORE THAN THREE WORDS': 3,
};

// ─── Listening ───

type ItemType = { name: string; kind: 'gap' | 'choice' | 'match' | 'tfng' | 'ynng'; note: string };

const L_TYPES: Record<string, ItemType> = {
  form: { name: 'form completion', kind: 'gap', note: 'details such as names, dates, prices, addresses or reference numbers, with at least one spelled-out name or number correction' },
  notes: { name: 'note completion', kind: 'gap', note: 'notes under short sub-headings' },
  table: { name: 'table completion', kind: 'gap', note: 'gaps inside a described table of categories' },
  sentence: { name: 'sentence completion', kind: 'gap', note: 'each stem paraphrases the script' },
  summary: { name: 'summary completion', kind: 'gap', note: 'a short paraphrased summary with gaps' },
  flow: { name: 'flow-chart completion', kind: 'gap', note: 'stages of a process or sequence of steps' },
  mcq: { name: 'multiple choice', kind: 'choice', note: '3 options A-C, distractors are mentioned but rejected or corrected in the script' },
  matchFeatures: { name: 'matching', kind: 'match', note: 'match each item (people, places, days or facilities) to one option from a shared lettered bank with extra unused options' },
  matchOpinions: { name: 'matching opinions', kind: 'match', note: 'match each item to the speaker view or evaluation in a shared bank' },
  flowBank: { name: 'flow-chart completion from a box of options', kind: 'match', note: 'each step is completed by choosing a lettered option from a shared bank' },
};

/** Valid IELTS-style combinations per Listening part. Sizes are filled in at random. */
const L_PLANS: Record<number, string[][]> = {
  1: [
    ['form', 'notes'],
    ['form', 'mcq'],
    ['notes', 'table'],
    ['table', 'sentence'],
    ['form', 'matchFeatures'],
    ['notes', 'mcq'],
    ['form', 'table'],
    ['notes', 'sentence', 'mcq'],
  ],
  2: [
    ['mcq', 'matchFeatures'],
    ['notes', 'mcq'],
    ['matchFeatures', 'sentence'],
    ['mcq', 'table'],
    ['flowBank', 'mcq'],
    ['sentence', 'matchFeatures', 'mcq'],
    ['mcq', 'notes'],
    ['table', 'matchFeatures'],
  ],
  3: [
    ['mcq', 'matchOpinions'],
    ['matchOpinions', 'sentence'],
    ['mcq', 'flowBank'],
    ['flow', 'mcq'],
    ['mcq', 'summary'],
    ['table', 'mcq'],
    ['sentence', 'mcq', 'matchOpinions'],
    ['matchFeatures', 'mcq'],
  ],
  4: [
    ['notes', 'sentence'],
    ['notes', 'mcq'],
    ['table', 'notes'],
    ['flow', 'notes'],
    ['summary', 'sentence'],
    ['mcq', 'notes'],
    ['sentence', 'table'],
    ['notes', 'flowBank'],
  ],
};

const L_CONTEXTS: Record<number, readonly string[]> = {
  1: [
    'booking a holiday cottage', 'joining a community sports club', 'reporting a lost item on a train', 'renting a furnished flat',
    'enrolling on an evening pottery course', 'hiring camping equipment', 'arranging a home-cleaning service', 'registering as a festival volunteer',
    'enquiring about a part-time job at a garden centre', 'planning a child\'s birthday party venue', 'signing up for a car-share scheme',
    'buying a museum family membership', 'booking a conference room for a small business', 'getting a bicycle repaired', 'registering at a new dental practice',
    'arranging pet-sitting during a holiday', 'ordering catering for a work event', 'applying for a homestay placement', 'booking a wildlife boat trip',
    'applying for a stall at a weekend market', 'arranging a removal van', 'joining a choir', 'booking driving lessons', 'enquiring about allotment rental',
    'organising a school reunion dinner', 'booking a guided cycling holiday', 'requesting a broadband installation', 'renting a bicycle for a city tour',
  ],
  2: [
    'a guided tour of a restored country estate', 'a radio announcement about a riverside festival', 'an orientation talk for new conservation volunteers',
    'an introduction to a new leisure centre', 'a council talk about redeveloping a city park', 'a museum audio guide to a maritime gallery',
    'a safety briefing at a wildlife park', 'a welcome talk for new hotel staff', 'a podcast about a regional food trail', 'a library service update for members',
    'a tour of a recycling plant', 'a talk on a new city cycling scheme', 'a presentation about a community gardening project', 'a briefing for a charity fun run',
    'a talk about local walking routes', 'an introduction to an adult education centre', 'a guide to a historic town centre', 'a talk about a theatre renovation',
    'a radio feature on a farm open day', 'a tour of a science discovery centre', 'an induction for new members of a rowing club', 'a talk about a ferry service timetable change',
  ],
  3: [
    'two students planning a seminar presentation', 'a tutor giving feedback on a student\'s dissertation proposal', 'two students reviewing a geography field trip',
    'students discussing a marketing case study', 'two students comparing results from a psychology experiment', 'a student and tutor discussing a work placement',
    'two students preparing a report on urban noise', 'students evaluating sources for a history assignment', 'two students designing a survey questionnaire',
    'a tutor and two students discussing a business start-up project', 'students discussing a biology lab report', 'two students planning a documentary on local industry',
  ],
  4: [
    'marine biology', 'urban planning', 'archaeology', 'the psychology of decision-making', 'materials science', 'the history of a household technology',
    'linguistics', 'ecology', 'behavioural economics', 'astronomy', 'architecture', 'agricultural innovation', 'the history of medicine', 'anthropology',
    'music cognition', 'sports science', 'textile history', 'glaciology', 'animal behaviour', 'sleep research', 'industrial design', 'cartography',
    'food science', 'the history of printing', 'renewable materials', 'bird migration', 'coastal engineering', 'child language development',
  ],
};

export type ListeningBlueprint = { context: string; groups: { range: string; type: ItemType; limit?: string }[] };

export function listeningBlueprint(seed: number, part: number): ListeningBlueprint {
  const rand = seededRandom(seed, `listening-${part}`);
  const plan = pick(rand, L_PLANS[part] ?? L_PLANS[1]!);
  const sizes = splitCount(rand, 10, plan.length, 3);
  const labels = ranges(sizes);
  return {
    context: pick(rand, L_CONTEXTS[part] ?? L_CONTEXTS[1]!),
    groups: plan.map((key, i) => {
      const type = L_TYPES[key]!;
      return { range: labels[i]!, type, ...(type.kind === 'gap' ? { limit: pick(rand, WORD_LIMITS) } : {}) };
    }),
  };
}

// ─── Reading ───

const R_TYPES: ItemType[] = [
  { name: 'TRUE/FALSE/NOT GIVEN', kind: 'tfng', note: 'statements about factual information, with a realistic balance of all three answers' },
  { name: 'YES/NO/NOT GIVEN', kind: 'ynng', note: 'statements about the writer\'s views or claims, with a realistic balance of all three answers' },
  { name: 'matching headings', kind: 'match', note: 'label the passage paragraphs with letters A, B, C and so on; the shared bank is a list of 5-8 headings written as roman numerals i-viii with extra unused headings' },
  { name: 'matching information to paragraphs', kind: 'match', note: 'label the passage paragraphs with letters A, B, C and so on; each stem names a detail, the shared bank is the paragraph letters' },
  { name: 'matching features', kind: 'match', note: 'match statements to researchers, places, periods or theories in a shared bank of 5-8 names, including unused ones' },
  { name: 'matching sentence endings', kind: 'match', note: 'each stem is a sentence beginning, the shared bank holds 5-8 possible endings' },
  { name: 'multiple choice', kind: 'choice', note: '4 options A-D testing detail, inference or the writer\'s purpose' },
  { name: 'summary completion', kind: 'gap', note: 'a paraphrased summary of one section, gaps filled with words from the passage' },
  { name: 'summary completion from a word bank', kind: 'match', note: 'a paraphrased summary whose gaps are filled from a shared bank of 5-8 words' },
  { name: 'sentence completion', kind: 'gap', note: 'paraphrased sentences completed with words from the passage' },
  { name: 'note completion', kind: 'gap', note: 'notes under sub-headings completed with words from the passage' },
  { name: 'table completion', kind: 'gap', note: 'a described comparison table completed with words from the passage' },
  { name: 'flow-chart completion', kind: 'gap', note: 'stages of a process or historical sequence completed with words from the passage' },
  { name: 'short-answer questions', kind: 'gap', note: 'direct wh- questions answered with words from the passage' },
];

const R_STRUCTURES = [
  'A narrative structure with an unexpected research finding',
  'A comparison of competing explanations',
  'Historical development with disputed interpretations',
  'Problem-solution analysis with qualified conclusions',
  'A case study of a single project and what it revealed',
  'An argumentative piece where the writer takes and defends a position',
  'A description of a process or phenomenon followed by its practical applications',
  'A review of how scientific thinking on one question has changed over time',
  'A profile of an unusual organism, material or place and why it matters to researchers',
] as const;

const R_DOMAINS = [
  'zoology', 'botany', 'archaeology', 'urban history', 'cognitive psychology', 'materials engineering', 'oceanography', 'economics of everyday goods',
  'linguistics', 'art history', 'agricultural history', 'astronomy', 'public health history', 'transport engineering', 'anthropology', 'geology',
  'architecture', 'food science', 'musicology', 'ecology', 'sociology of work', 'the history of an invention', 'meteorology', 'education research',
  'child development', 'entomology', 'textile and fashion history', 'cartography and navigation', 'acoustics', 'water management', 'sports science',
] as const;

export type ReadingBlueprint = { structure: string; domain: string; groups: { range: string; type: ItemType; limit?: string }[] };

export function readingBlueprint(seed: number, part: number, count: number): ReadingBlueprint {
  // One shuffled order per attempt, sliced per passage, so passages in one test never share a type.
  const order = shuffle(seededRandom(seed, 'reading-types'), R_TYPES);
  const rand = seededRandom(seed, `reading-${part}`);
  const groupCount = rand() < 0.65 ? 3 : 2;
  const chosen: ItemType[] = [];
  let usedTfLike = false;
  for (let i = (part - 1) * 3; chosen.length < groupCount && i < (part - 1) * 3 + R_TYPES.length; i++) {
    const t = order[i % order.length]!;
    const tfLike = t.kind === 'tfng' || t.kind === 'ynng';
    if (tfLike && usedTfLike) continue; // never TFNG and YNNG in the same passage
    if (chosen.includes(t)) continue;
    usedTfLike ||= tfLike;
    chosen.push(t);
  }
  const sizes = splitCount(rand, count, chosen.length, 3);
  const labels = ranges(sizes);
  return {
    structure: pick(rand, R_STRUCTURES),
    domain: pick(rand, R_DOMAINS),
    groups: chosen.map((type, i) => ({
      range: labels[i]!,
      type,
      ...(type.kind === 'gap' ? { limit: pick(rand, WORD_LIMITS.slice(0, 4)) } : {}),
    })),
  };
}

const describeGroups = (groups: { range: string; type: ItemType; limit?: string }[]): string =>
  groups
    .map(
      (g) =>
        `${g.range}: ${g.type.name} (kind "${g.type.kind}"${g.limit ? `, rubric "Write ${g.limit} for each answer", maxWords ${MAX_WORDS[g.limit]}` : ''}; ${g.type.note})`,
    )
    .join('; ');

export function listeningBrief(seed: number, part: number): string[] {
  const bp = listeningBlueprint(seed, part);
  return [
    part === 4 ? `Lecture subject area: ${bp.context}, pick a specific, lesser-known angle` : `Situation: ${bp.context}, with fresh names, places and details`,
    `Question-type blueprint (follow exactly): ${describeGroups(bp.groups)}`,
  ];
}

export function readingBrief(seed: number, part: number, count: number): string[] {
  const bp = readingBlueprint(seed, part, count);
  return [
    `Passage ${part}: ${bp.structure}`,
    `Subject area: ${bp.domain}, choose a specific, lesser-known topic within it`,
    `Question-type blueprint (follow exactly): ${describeGroups(bp.groups)}`,
  ];
}

// ─── Writing ───

const W1_TOPICS: Record<'table' | 'bar' | 'line', readonly string[]> = {
  table: [
    'household spending categories in four countries', 'visitor numbers at five museums across two years', 'water use by sector in several regions',
    'library loans by type of material', 'average commuting times in different cities', 'energy sources used for electricity in three countries',
    'student enrolment by subject at a university', 'international tourist arrivals by purpose of visit', 'average working hours in several professions',
  ],
  bar: [
    'participation in leisure activities by age group', 'waste recycled by material type in several countries', 'internet access by device in different years',
    'sales of fair-trade products in several countries', 'cinema attendance by age group', 'employment in different sectors in two countries',
    'consumption of fast food types over three years', 'reasons for travel among UK residents', 'number of foreign students by region of origin',
  ],
  line: [
    'consumption of three types of fuel over several decades', 'passengers using different forms of urban transport', 'average house prices in several cities',
    'birth rates in four countries', 'coffee and tea imports over time', 'visits to three types of websites over a decade',
    'proportion of people aged over 65 in several countries', 'carbon dioxide emissions per person in four countries', 'sales of music formats over time',
  ],
};

const W1_PROCESSES = [
  'how glass bottles are recycled', 'how chocolate is produced from cocoa beans', 'how bricks are manufactured', 'how instant noodles are made',
  'the life cycle of the salmon', 'how a desalination plant produces drinking water', 'how honey is produced and packaged', 'how cement is made',
  'how silk is produced', 'how olive oil is produced', 'how paper is recycled', 'the life cycle of a frog', 'how electricity is generated from waves',
  'how tea is produced', 'how leather is tanned', 'how rainwater is collected and treated for household use', 'how wool is turned into fabric',
] as const;

const W2_TYPES = [
  { name: 'opinion (agree/disagree)', question: 'To what extent do you agree or disagree?' },
  { name: 'discussion of two views', question: 'Discuss both these views and give your own opinion.' },
  { name: 'advantages and disadvantages', question: 'Do the advantages of this outweigh the disadvantages?' },
  { name: 'problem and solution', question: 'What problems does this cause, and what measures could be taken to address them?' },
  { name: 'causes and solutions', question: 'Why is this happening, and what can be done about it?' },
  { name: 'positive or negative development', question: 'Is this a positive or negative development?' },
  { name: 'two-part direct question', question: 'two related direct questions on the issue' },
] as const;

const W2_DOMAINS = [
  'education', 'technology and daily life', 'environment', 'public health', 'work and careers', 'cities and housing', 'crime and punishment',
  'advertising and consumerism', 'globalisation', 'family and generations', 'government spending', 'arts and culture', 'tourism',
  'science and research funding', 'food and diet', 'sport', 'transport', 'ageing populations', 'languages', 'space exploration', 'animals and wildlife',
  'media and news', 'tradition and modernity', 'children and parenting', 'remote and flexible work', 'museums and heritage', 'water and natural resources',
] as const;

export function writingBrief(seed: number, includeTask1: boolean, includeTask2: boolean): string[] {
  const rand = seededRandom(seed, 'writing');
  const out: string[] = [];
  if (includeTask1) {
    const visual = pick(rand, ['table', 'bar', 'line', 'process', 'bar', 'line'] as const);
    const topic = visual === 'process' ? pick(rand, W1_PROCESSES) : pick(rand, W1_TOPICS[visual]);
    out.push(`Task 1 blueprint: visual type "${visual}" showing ${topic}, with invented but plausible figures and a fresh angle`);
  }
  if (includeTask2) {
    const type = pick(rand, W2_TYPES);
    const domain = pick(rand, W2_DOMAINS);
    out.push(`Task 2 blueprint: ${type.name} essay about ${domain}, ending with "${type.question}", on a specific, debatable issue rather than a generic one`);
  }
  return out;
}

// ─── Speaking ───

const S1_OPENERS = ['work or studies', 'hometown', 'home or accommodation', 'the area you live in'] as const;

const S1_TOPICS = [
  'weather', 'music', 'reading', 'sport', 'being on time', 'handwriting', 'mobile phones', 'giving gifts', 'shopping', 'cooking', 'colours',
  'the sky and stars', 'museums', 'parks', 'public transport', 'birthdays', 'friends', 'photographs', 'taking naps', 'noise', 'art', 'flowers',
  'swimming', 'bicycles', 'hats', 'mirrors', 'chocolate', 'boredom', 'patience', 'daily routine', 'films', 'newspapers', 'neighbours', 'laughing',
  'singing', 'time management', 'taking breaks', 'teachers', 'walking', 'haircuts', 'shoes', 'puzzles', 'water', 'maps', 'plants', 'collecting things',
  'emails and messages', 'borrowing and lending', 'concerts', 'rain', 'mornings', 'snacks', 'learning languages', 'public holidays', 'fast food',
  'crowded places', 'scenery', 'advertisements', 'robots', 'history', 'dancing', 'picnics', 'trees', 'wild animals', 'social media', 'the internet',
  'clothes', 'sleep', 'staying at hotels', 'jewellery', 'markets', 'video games', 'science', 'cars', 'the sea', 'keeping fit', 'magazines', 'apps',
] as const;

const S2_CARDS = [
  'a person who inspired you to learn something', 'an older person you admire', 'a neighbour you know well', 'a friend who is good at something unusual',
  'a famous person you would like to meet', 'a creative person whose work you like', 'a person who helped you solve a problem',
  'a quiet place you like to go to', 'a building you find interesting', 'a city you visited and would like to return to', 'a crowded place you have been to',
  'a café or restaurant you enjoy', 'a place near water that you remember', 'a historical site you visited', 'a park or garden you like',
  'a gift you gave that took a long time to choose', 'something you bought but rarely use', 'a piece of technology you find useful', 'a photograph you treasure',
  'an item of clothing you wear often', 'a book that changed how you think', 'a toy you had as a child', 'something you made by hand',
  'a time you were late for something important', 'a time you helped a stranger', 'an unusual meal you had', 'a time you changed your mind',
  'a celebration you enjoyed', 'a time you lost something valuable', 'a pleasant surprise you received', 'an important decision you made',
  'a journey that did not go as planned', 'a time you learned a new skill quickly', 'a time you got lost', 'a disagreement you resolved',
  'a time you had to wait a long time', 'a sport you would like to try', 'a hobby you took up recently', 'a healthy habit you have',
  'an outdoor activity you enjoyed', 'a film that made you think', 'a website or app you use a lot', 'an advertisement you remember',
  'a song with a special meaning for you', 'a news story that interested you', 'a piece of art you saw', 'a goal you want to achieve',
  'a job you would like to do in the future', 'a place you would like to visit', 'something you would like to learn', 'a rule you think is unfair',
  'a piece of good advice you received', 'an interesting conversation you had', 'a time you had to be patient', 'a positive change in your life',
  'a smell that brings back memories', 'a time you were very busy', 'a time you felt proud of a family member', 'a time you saved money for something',
  'a game you enjoyed as a child', 'a time you used a foreign language', 'a time the electricity or internet went off', 'an invention that changed daily life',
] as const;

const S3_FUNCTIONS = [
  'comparing the past with the present', 'predicting future change', 'weighing advantages and disadvantages', 'speculating about causes',
  'suggesting solutions to a problem', 'comparing different groups (young and old, city and countryside, or different countries)',
  'justifying an opinion on a statement', 'evaluating the role of government, schools or businesses', 'discussing the effect on society',
] as const;

const S1_STYLES = [
  'frequency (how often)', 'preference with reason', 'childhood memory (when you were younger)', 'change over time',
  'future intention', 'description', 'opinion (do you think)', 'hypothetical (would you ever)',
] as const;

export function speakingBrief(seed: number, parts: number[]): string[] {
  const rand = seededRandom(seed, 'speaking');
  const out: string[] = [];
  const opener = pick(rand, S1_OPENERS);
  const [topicA, topicB] = sample(rand, S1_TOPICS, 2);
  const card = pick(rand, S2_CARDS);
  const functions = sample(rand, S3_FUNCTIONS, 5);
  const styles = sample(rand, S1_STYLES, 5);
  if (parts.includes(1)) {
    out.push(
      `Part 1 blueprint: 2 questions on ${opener}, then 3 questions on ${topicA}, then 3 questions on ${topicB}; the prompt introduces these topics; vary question forms using ${styles.join(', ')}; never ask for the candidate's name or ID`,
    );
  }
  if (parts.includes(2)) {
    out.push(
      `Part 2 blueprint: cue card "Describe ${card}" with the 3 "You should say" points as the first 3 cue items and an "and explain" item last; the 2 follow-up questions are short and personal`,
    );
  }
  if (parts.includes(3)) {
    out.push(
      `Part 3 blueprint: 6 abstract discussion questions developing two broader themes ${parts.includes(2) ? `drawn from "${card}"` : `related to ${topicA}`}, covering ${functions.join(', ')}; avoid yes/no questions`,
    );
  }
  return out;
}

export type FallbackSpeakingPart = {
  part: number;
  prompt: string;
  questions: string[];
  cue?: string[];
};

const DEFAULT_SPEAKING_SETS: readonly {
  p1: { prompt: string; questions: string[] };
  p2: { prompt: string; cue: string[]; questions: string[] };
  p3: { prompt: string; questions: string[] };
}[] = [
  {
    p1: {
      prompt: "Let's begin by discussing where you live and your daily activities.",
      questions: [
        'Do you work or are you currently studying?',
        'What aspect of your work or studies do you find most rewarding?',
        'Do you prefer to study or work early in the morning or later in the evening?',
        'How often do you listen to music during your daily routine?',
        'What genre of music do you find most relaxing when you want to unwind?',
        'Do you prefer cooking meals at home or eating out at restaurants?',
        'What is a traditional dish from your region that you particularly enjoy?',
        'How do you usually like to spend your free weekends?',
      ],
    },
    p2: {
      prompt: 'Describe a memorable journey or trip you took that did not go as planned.',
      cue: [
        'Where you were travelling to and what mode of transport you used',
        'Who was travelling with you',
        'What unexpected challenge or disruption occurred during the trip',
        'And explain what you learned from this experience and why it remains memorable',
      ],
      questions: [
        'Do you still enjoy travelling despite occasional unexpected events?',
        'Would you consider visiting that destination again in the future?',
      ],
    },
    p3: {
      prompt: "We've been talking about travel and unexpected experiences. Now I'd like to ask you some broader questions related to tourism and transport.",
      questions: [
        'How has international travel changed in your country compared to several decades ago?',
        'Do you think modern navigation and smartphone apps have made travelling too predictable?',
        'What measures should local governments take to prevent over-tourism in popular cultural destinations?',
        'Some people argue that tourism causes more harm than good to local communities. What is your view?',
        'How might emerging technologies such as autonomous vehicles impact the way people commute in cities?',
        'Why do many people feel that experiencing unexpected setbacks is a valuable part of personal development?',
      ],
    },
  },
  {
    p1: {
      prompt: "Let's start by talking about your hometown and your personal interests.",
      questions: [
        'Where is your hometown located, and what kind of place is it?',
        'What is the most interesting landmark or attraction in your hometown?',
        'Has your hometown changed very much since you were a child?',
        'Do you enjoy reading books or articles in your spare time?',
        'Do you prefer reading physical printed paper or digital screens, and why?',
        'How important is it for people to spend time outdoors in nature?',
        'What kind of outdoor activities are popular among people in your country?',
        'Do you enjoy taking photographs of everyday moments or special celebrations?',
      ],
    },
    p2: {
      prompt: 'Describe an older person you know who has had a significant positive influence on you.',
      cue: [
        'Who this person is and how you first met them',
        'What qualities, skills, or life experiences they have',
        'What important lessons, advice, or perspective they shared with you',
        'And explain why their guidance has been so meaningful in your life',
      ],
      questions: [
        'Do you still communicate regularly with this person?',
        'Do you share similar interests or views with them today?',
      ],
    },
    p3: {
      prompt: "We've been discussing influential individuals and personal guidance. Let's explore some broader questions about generational knowledge and community roles.",
      questions: [
        'What role do elderly people traditionally play in families and communities in your culture?',
        'In what ways has rapid technological progress affected the relationship between older and younger generations?',
        'Do you believe formal education or personal mentorship from experienced mentors is more valuable for young professionals?',
        'How can societies ensure that retired individuals remain socially connected and mentally active?',
        'Should governments raise the retirement age as life expectancy continues to increase globally?',
        'What traditional skills or cultural practices are in danger of being lost if older generations do not pass them on?',
      ],
    },
  },
  {
    p1: {
      prompt: "Let's talk about where you currently live and how you manage your time.",
      questions: [
        'Do you live in a house or an apartment, and what do you like about it?',
        'Which room in your residence do you spend the most time in?',
        'Are there good public facilities, such as parks or sports centres, in your neighbourhood?',
        'How do you typically organise your daily schedule or tasks?',
        'Do you find it easy or difficult to be punctual for appointments?',
        'How has the way you communicate with friends changed with modern technology?',
        'Do you prefer phone calls, text messages, or meeting in person?',
        'What is your favourite season of the year, and what makes it special to you?',
      ],
    },
    p2: {
      prompt: 'Describe a challenging skill or subject you learned successfully.',
      cue: [
        'What skill or subject it was',
        'How and where you learned it, and who helped you',
        'What difficulties or obstacles you encountered while learning it',
        'And explain how mastering this skill has benefited you in your personal or professional life',
      ],
      questions: [
        'Do you still practice or use this skill on a regular basis?',
        'Would you recommend other people try learning this subject?',
      ],
    },
    p3: {
      prompt: "We've been discussing learning new abilities. Now let's explore broader questions concerning education and lifelong learning.",
      questions: [
        'How has the widespread availability of online learning platforms transformed traditional education?',
        'Do you think practical hands-on skills are valued as highly as academic degrees in today\'s job market?',
        'Why do many adults find it more challenging to acquire new skills compared to young children?',
        'To what extent should employers be responsible for funding continuous training and reskilling for their staff?',
        'How might artificial intelligence change the types of skills that will be essential for workers in the next decade?',
        'Do you agree that self-discipline is more critical for academic success than natural talent?',
      ],
    },
  },
  {
    p1: {
      prompt: "Let's begin by discussing your daily routine and some of your habits.",
      questions: [
        'What is your favourite part of your daily routine, and why?',
        'Do you like having a structured routine, or do you prefer spontaneity?',
        'What is the weather usually like in your region during this time of year?',
        'Does rainy or cold weather influence your mood or productivity?',
        'How often do you visit art galleries, museums, or cultural exhibitions?',
        'Did you participate in art or music classes when you were in primary school?',
        'Do you prefer watching films at home or in a cinema with a large audience?',
        'What types of movies or documentaries do you find most thought-provoking?',
      ],
    },
    p2: {
      prompt: 'Describe a creative project or handcrafted object you made or contributed to.',
      cue: [
        'What the project or object was',
        'When you created it and what materials or tools you used',
        'Why you decided to undertake this creative task',
        'And explain what you felt when you saw the final completed result',
      ],
      questions: [
        'Do you still have this object or evidence of this project?',
        'Are you planning to undertake any other creative projects in the near future?',
      ],
    },
    p3: {
      prompt: "We've been discussing creative work. Let's now examine broader questions on creativity and the arts in society.",
      questions: [
        'Why is fostering creativity important for economic innovation and problem-solving?',
        'Should national governments provide public subsidies to support artists, theatres, and cultural institutions?',
        'Do you think schools spend too much time on standardised testing at the expense of creative arts?',
        'How has digital software and generative technology influenced the way artists produce visual art and music?',
        'Some people believe that mass manufacturing has diminished the public appreciation for handcrafted goods. Do you agree?',
        'In what ways can exposure to the arts enhance the overall mental well-being of a community?',
      ],
    },
  },
];

/** Return diverse, authentic fallback speaking parts based on attempt seed. */
export function getDefaultSpeakingParts(seed: number): FallbackSpeakingPart[] {
  const rand = seededRandom(seed, 'default-speaking');
  const setIndex = Math.floor(rand() * DEFAULT_SPEAKING_SETS.length);
  const selected = DEFAULT_SPEAKING_SETS[setIndex] ?? DEFAULT_SPEAKING_SETS[0]!;

  return [
    {
      part: 1,
      prompt: selected.p1.prompt,
      questions: [...selected.p1.questions],
    },
    {
      part: 2,
      prompt: selected.p2.prompt,
      cue: [...selected.p2.cue],
      questions: [...selected.p2.questions],
    },
    {
      part: 3,
      prompt: selected.p3.prompt,
      questions: [...selected.p3.questions],
    },
  ];
}
