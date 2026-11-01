/**
 * Deterministic scoring cache for IELTS Writing and Speaking assessments (§5).
 * Caches scored results by sha256 or fast hash of:
 * (prompt, text, rubricVersion, model).
 *
 * Ensures: Same input + same rubric + same model => identical output.
 */

function fastHash(str: string): string {
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c64e6d ^ 0;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function computeScoreCacheKey(
  kind: 'writing' | 'speaking',
  prompt: string,
  text: string,
  rubricVersion: string,
  model: string,
): string {
  const normalizedPrompt = prompt.trim().toLowerCase();
  const normalizedText = text.trim();
  const raw = `${kind}::${rubricVersion}::${model}::${normalizedPrompt}::${normalizedText}`;
  return `score_cache_${kind}_${fastHash(raw)}`;
}

const memoryCache = new Map<string, unknown>();

export function getCachedScore<T>(key: string): T | null {
  if (memoryCache.has(key)) {
    return memoryCache.get(key) as T;
  }
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const stored = window.sessionStorage.getItem(key);
      if (stored) {
        const val = JSON.parse(stored) as T;
        memoryCache.set(key, val);
        return val;
      }
    } catch {
      // ignore storage errors
    }
  }
  return null;
}

export function setCachedScore<T>(key: string, value: T): void {
  memoryCache.set(key, value);
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore storage quota errors
    }
  }
}

export function clearScoreCache(): void {
  memoryCache.clear();
}

