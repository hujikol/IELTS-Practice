// Official IELTS Academic band conversion tables and exact rounding rules.
// §5.1 / §5.4: Code computes every number. The AI never computes an overall band.

export const LISTENING_BAND_TABLE: [number, number][] = [
  [39, 9.0],
  [37, 8.5],
  [35, 8.0],
  [32, 7.5],
  [30, 7.0],
  [26, 6.5],
  [23, 6.0],
  [18, 5.5],
  [16, 5.0],
  [13, 4.5],
  [10, 4.0],
  [8, 3.5],
  [6, 3.0],
  [4, 2.5],
  [2, 2.0],
  [1, 1.5],
  [0, 1.0],
];

export const READING_ACADEMIC_BAND_TABLE: [number, number][] = [
  [39, 9.0],
  [37, 8.5],
  [35, 8.0],
  [33, 7.5],
  [30, 7.0],
  [27, 6.5],
  [23, 6.0],
  [19, 5.5],
  [15, 5.0],
  [13, 4.5],
  [10, 4.0],
  [8, 3.5],
  [6, 3.0],
  [4, 2.5],
  [2, 2.0],
  [1, 1.5],
  [0, 1.0],
];

/**
 * Maps raw score /40 to IELTS Listening Band (1.0 - 9.0).
 */
export function rawToListeningBand(raw: number): number {
  const bounded = Math.max(0, Math.min(40, Math.round(raw)));
  for (const [threshold, band] of LISTENING_BAND_TABLE) {
    if (bounded >= threshold) return band;
  }
  return 1.0;
}

/**
 * Maps raw score /40 to IELTS Reading Academic Band (1.0 - 9.0).
 */
export function rawToReadingBand(raw: number): number {
  const bounded = Math.max(0, Math.min(40, Math.round(raw)));
  for (const [threshold, band] of READING_ACADEMIC_BAND_TABLE) {
    if (bounded >= threshold) return band;
  }
  return 1.0;
}

/**
 * Maps grammar drill accuracy (0 to 1) to an indicative band for feedback.
 * Grammar drills do not feed the official overall band (§5.1).
 */
export function rawToGrammarBand(accuracy: number): number {
  const pct = Math.max(0, Math.min(1, accuracy));
  if (pct >= 0.95) return 9.0;
  if (pct >= 0.90) return 8.5;
  if (pct >= 0.85) return 8.0;
  if (pct >= 0.80) return 7.5;
  if (pct >= 0.75) return 7.0;
  if (pct >= 0.65) return 6.5;
  if (pct >= 0.55) return 6.0;
  if (pct >= 0.45) return 5.5;
  if (pct >= 0.35) return 5.0;
  if (pct >= 0.25) return 4.5;
  return 4.0;
}

/**
 * Rounds a single module or task band to the nearest half-band (0.5).
 */
export function roundToHalfBand(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * Official IELTS overall band rounding (§5.4):
 * - Average ending in .25 rounds UP to the next half band (e.g. 6.25 -> 6.5).
 * - Average ending in .75 rounds UP to the next whole band (e.g. 6.75 -> 7.0).
 * - Exact boundary rules:
 *   Fraction < 0.125 -> floor (e.g. 6.124 -> 6.0)
 *   Fraction >= 0.125 and < 0.625 (with .25 rounding up to .5) -> floor + 0.5 (e.g. 6.25 -> 6.5, 6.375 -> 6.5)
 *   Fraction >= 0.625 (with .75 rounding up to 1.0) -> ceil (e.g. 6.75 -> 7.0, 6.875 -> 7.0)
 */
export function roundIeltsOverallBand(mean: number): number {
  const base = Math.floor(mean);
  const frac = mean - base;
  const eps = 1e-6;

  // Fractions in IELTS four-module averages:
  // .000 and .125 -> base (e.g. 6.0, 6.125 -> 6.0)
  // .250, .375, .500, .625 -> base + 0.5 (e.g. 6.25 -> 6.5, 6.375 -> 6.5, 6.5 -> 6.5, 6.625 -> 6.5)
  // .750 and .875 -> base + 1.0 (e.g. 6.75 -> 7.0, 6.875 -> 7.0)
  if (frac < 0.25 - eps) {
    return base;
  }
  if (frac < 0.75 - eps) {
    return base + 0.5;
  }
  return base + 1.0;
}

/**
 * Computes overall IELTS band from module bands according to §5.4.
 * Returns null if any required module is missing or not taken.
 */
export function calculateOverallBand(modules: {
  listening?: number | null;
  reading?: number | null;
  writing?: number | null;
  speaking?: number | null;
}): number | null {
  const { listening, reading, writing, speaking } = modules;
  if (
    listening === undefined || listening === null ||
    reading === undefined || reading === null ||
    writing === undefined || writing === null ||
    speaking === undefined || speaking === null
  ) {
    return null;
  }

  const mean = (listening + reading + writing + speaking) / 4;
  return roundIeltsOverallBand(mean);
}

/**
 * Computes Writing module band from Task 1 and Task 2:
 * Writing band = (Task 1 + 2 * Task 2) / 3 rounded to nearest 0.5 (§5.2).
 */
export function calculateWritingBand(task1Band: number, task2Band: number): number {
  const weighted = (task1Band + 2 * task2Band) / 3;
  return roundToHalfBand(weighted);
}

/**
 * Computes Speaking module band from 4 criteria:
 * Speaking band = mean of FC, LR, GRA, PR rounded to nearest 0.5 (§5.3).
 */
export function calculateSpeakingBand(fc: number, lr: number, gra: number, pr: number): number {
  const mean = (fc + lr + gra + pr) / 4;
  return roundToHalfBand(mean);
}

export type CefrLevel = 'C2' | 'C1' | 'B2' | 'B1' | 'A2' | 'A1';

export interface CefrInfo {
  level: CefrLevel;
  name: string;
  summary: string;
  badgeStyle: {
    bg: string;
    text: string;
    border: string;
  };
}

/**
 * Official IELTS to CEFR (Common European Framework of Reference) concordance:
 * - 8.5 - 9.0: C2 (Proficient User - Mastery)
 * - 7.0 - 8.0: C1 (Proficient User - Effective Operational Proficiency)
 * - 5.5 - 6.5: B2 (Independent User - Vantage)
 * - 4.0 - 5.0: B1 (Independent User - Threshold)
 * - 3.0 - 3.5: A2 (Basic User - Waystage)
 * - Below 3.0: A1 (Basic User - Breakthrough)
 */
export function ieltsBandToCefr(band: number | null | undefined): CefrInfo | null {
  if (band === null || band === undefined || isNaN(band) || band <= 0) return null;
  if (band >= 8.5) {
    return {
      level: 'C2',
      name: 'Proficient (Mastery)',
      summary: 'Can understand with ease virtually everything heard or read.',
      badgeStyle: { bg: '#fdf2f8', text: '#9d174d', border: '#fbcfe8' },
    };
  }
  if (band >= 7.0) {
    return {
      level: 'C1',
      name: 'Advanced (Operational)',
      summary: 'Can express ideas fluently and spontaneously for academic and professional purposes.',
      badgeStyle: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
    };
  }
  if (band >= 5.5) {
    return {
      level: 'B2',
      name: 'Upper Intermediate (Vantage)',
      summary: 'Can understand complex text and interact with spontaneous fluency.',
      badgeStyle: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
    };
  }
  if (band >= 4.0) {
    return {
      level: 'B1',
      name: 'Intermediate (Threshold)',
      summary: 'Can understand main points of standard input on familiar matters.',
      badgeStyle: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
    };
  }
  if (band >= 3.0) {
    return {
      level: 'A2',
      name: 'Elementary (Waystage)',
      summary: 'Can communicate in routine tasks and familiar topics.',
      badgeStyle: { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
    };
  }
  return {
    level: 'A1',
    name: 'Beginner (Breakthrough)',
    summary: 'Can understand and use familiar everyday expressions.',
    badgeStyle: { bg: '#f8fafc', text: '#475569', border: '#cbd5e1' },
  };
}
