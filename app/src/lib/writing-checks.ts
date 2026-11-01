/**
 * Deterministic pre-checks for IELTS Writing submissions (§5.3).
 * Computed in code, passed to LLM as verified FACTS, and used to enforce
 * strict IELTS rule caps (under-length, off-topic, memorised templates).
 */

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'could', 'did',
  'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have',
  'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off',
  'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same',
  'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you',
  'your', 'yours', 'yourself', 'yourselves',
]);

export type WritingPreChecks = {
  wordCount: number;
  minWords: number;
  isUnderLength: boolean;
  lengthRatio: number;
  paragraphCount: number;
  uniqueWordRatio: number;
  repetitionScore: number;
  topicOverlapRatio: number;
  promptCopyRatio: number;
  suspectedOffTopic: boolean;
  lengthCap: number | null;
};

export function extractContentKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Computes deterministic statistics on a writing submission.
 */
export function runWritingPreChecks(
  taskNumber: 1 | 2,
  promptText: string,
  userText: string,
  minWordsOverride?: number,
): WritingPreChecks {
  const minWords = minWordsOverride || (taskNumber === 1 ? 150 : 250);
  const words = userText.trim() ? userText.trim().split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const lengthRatio = minWords > 0 ? wordCount / minWords : 1.0;
  const isUnderLength = wordCount < minWords;

  // Length caps per IELTS descriptors:
  // e.g. < 40% of min words => TR/TA capped at 4.0
  //      < 60% of min words => TR/TA capped at 4.5
  //      < 80% of min words => TR/TA capped at 5.0
  let lengthCap: number | null = null;
  if (wordCount < minWords * 0.4) {
    lengthCap = 4.0;
  } else if (wordCount < minWords * 0.6) {
    lengthCap = 4.5;
  } else if (wordCount < minWords * 0.8) {
    lengthCap = 5.0;
  }

  // Paragraph structure
  const paragraphs = userText
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const paragraphCount = paragraphs.length;

  // Vocabulary variety & repetition
  const normalizedWords = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean);
  const uniqueWords = new Set(normalizedWords);
  const uniqueWordRatio = normalizedWords.length > 0 ? uniqueWords.size / normalizedWords.length : 0;
  const repetitionScore = Math.max(0, 1 - uniqueWordRatio);

  // Topic overlap with prompt keywords
  const promptKeywords = extractContentKeywords(promptText);
  const userKeywords = new Set(extractContentKeywords(userText));

  let matchedKeywords = 0;
  for (const kw of promptKeywords) {
    if (userKeywords.has(kw)) matchedKeywords++;
  }
  const topicOverlapRatio = promptKeywords.length > 0 ? matchedKeywords / promptKeywords.length : 1.0;

  // Suspected off-topic if prompt has specific keywords and fewer than 10% match (and wordCount >= 25)
  const suspectedOffTopic = promptKeywords.length >= 4 && topicOverlapRatio < 0.1 && wordCount >= 25;

  // Prompt copying (direct n-grams from prompt)
  const promptWords = promptText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  let promptTrigramHits = 0;
  if (promptWords.length >= 3 && normalizedWords.length >= 3) {
    const promptTrigrams = new Set<string>();
    for (let i = 0; i <= promptWords.length - 3; i++) {
      promptTrigrams.add(`${promptWords[i]} ${promptWords[i + 1]} ${promptWords[i + 2]}`);
    }
    for (let i = 0; i <= normalizedWords.length - 3; i++) {
      const tri = `${normalizedWords[i]} ${normalizedWords[i + 1]} ${normalizedWords[i + 2]}`;
      if (promptTrigrams.has(tri)) promptTrigramHits++;
    }
  }
  const promptCopyRatio = normalizedWords.length > 0 ? Math.min(1.0, (promptTrigramHits * 3) / normalizedWords.length) : 0;

  return {
    wordCount,
    minWords,
    isUnderLength,
    lengthRatio,
    paragraphCount,
    uniqueWordRatio,
    repetitionScore,
    topicOverlapRatio,
    promptCopyRatio,
    suspectedOffTopic,
    lengthCap,
  };
}
