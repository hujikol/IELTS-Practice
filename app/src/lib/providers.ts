// §11.3 Optional providers. Request construction, base URL normalization,
// credential management, and provider communication for OpenAI-compatible endpoints.

export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
  verified?: boolean;
  lastVerifiedAt?: number;
};

export type TokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type GenerationResult = {
  content: string;
  model: string;
  provider: string;
  usage?: TokenUsage;
};

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
  models?: string[];
};

export const EXPERIENTIAL_GATEWAY_URL = 'https://api.experientiallabs.ai/v1';

export function getExplabsApiKey(): string {
  try {
    if (typeof process !== 'undefined' && process.env?.EXPLABS_API_KEY) {
      return process.env.EXPLABS_API_KEY.trim();
    }
  } catch {
    // env not accessible
  }
  return '';
}

/**
 * Resolves routing for models. For "gpt-6-luna", default routes through Experiential gateway
 * and pulls EXPLABS_API_KEY if not explicitly specified.
 */
export function resolveProviderRouting(config: ProviderConfig): ProviderConfig {
  const model = config.model.trim();
  if (model === 'gpt-6-luna') {
    const isDefaultBase =
      !config.baseUrl.trim() ||
      config.baseUrl === 'https://api.openai.com/v1' ||
      config.baseUrl === DEFAULT_PROVIDER_CONFIG.baseUrl;

    const envKey = getExplabsApiKey();
    return {
      ...config,
      baseUrl: isDefaultBase ? EXPERIENTIAL_GATEWAY_URL : config.baseUrl,
      apiKey: config.apiKey.trim() || envKey,
      model: 'gpt-6-luna',
    };
  }
  return config;
}

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o',
  enabled: false,
  verified: false,
};

const STORAGE_KEY = 'ielts_studio_provider_config';

/**
 * Validates and normalizes an API base URL according to §11.3:
 * - Only http/https
 * - Insecure HTTP is allowed ONLY for local development endpoints (localhost, 127.0.0.1, [::1])
 * - Reject embedded credentials in the URL
 * - Strip trailing slashes
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Base URL cannot be empty.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid Base URL format. Must be a valid URL (e.g. https://api.openai.com/v1).');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must use HTTP or HTTPS protocol.');
  }

  // Reject embedded URL credentials (§11.3)
  if (parsed.username || parsed.password) {
    throw new Error('Embedded credentials in Base URL are not allowed.');
  }

  // HTTP allowed only for explicit local development endpoints (§11.3)
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname.toLowerCase();
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '[::1]' ||
      host === '::1' ||
      host.endsWith('.local');
    if (!isLocal) {
      throw new Error(
        'Insecure HTTP is only permitted for local development endpoints (e.g. localhost or 127.0.0.1). Use HTTPS for remote providers.',
      );
    }
  }

  // Strip trailing slashes from pathname
  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${cleanPath}`;
}

/**
 * Builds chat completions endpoint relative to already-versioned base (§11.3: do not append /v1 twice).
 */
export function buildChatCompletionsUrl(rawBaseUrl: string): string {
  const normalized = normalizeBaseUrl(rawBaseUrl);
  if (normalized.endsWith('/chat/completions')) {
    return normalized;
  }
  if (normalized.endsWith('/v1')) {
    return `${normalized}/chat/completions`;
  }
  const parsed = new URL(normalized);
  if (/\/v\d+$/i.test(parsed.pathname)) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

/**
 * Loads provider settings from local storage, with fallback to defaults.
 */
export function loadProviderConfig(): ProviderConfig {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim() ? parsed.baseUrl.trim() : DEFAULT_PROVIDER_CONFIG.baseUrl,
          apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '',
          model: typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : DEFAULT_PROVIDER_CONFIG.model,
          enabled: Boolean(parsed.enabled),
          verified: Boolean(parsed.verified),
          lastVerifiedAt: typeof parsed.lastVerifiedAt === 'number' ? parsed.lastVerifiedAt : undefined,
        };
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  return { ...DEFAULT_PROVIDER_CONFIG };
}

/**
 * Persists provider settings to local storage.
 */
export function saveProviderConfig(config: Partial<ProviderConfig>): ProviderConfig {
  const current = loadProviderConfig();
  const credentialsChanged =
    (typeof config.baseUrl === 'string' && config.baseUrl.trim() !== current.baseUrl) ||
    (typeof config.apiKey === 'string' && config.apiKey.trim() !== current.apiKey) ||
    (typeof config.model === 'string' && config.model.trim() !== current.model);

  const updated: ProviderConfig = {
    baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl.trim() : current.baseUrl,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey.trim() : current.apiKey,
    model: typeof config.model === 'string' && config.model.trim() ? config.model.trim() : current.model,
    enabled: typeof config.enabled === 'boolean' ? config.enabled : current.enabled,
    verified: typeof config.verified === 'boolean' ? config.verified : credentialsChanged ? false : (current.verified ?? false),
    lastVerifiedAt: typeof config.lastVerifiedAt === 'number' ? config.lastVerifiedAt : credentialsChanged ? undefined : current.lastVerifiedAt,
  };

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
  return updated;
}

/**
 * Tests connection to the provider by verifying URL format and pinging models endpoint or chat endpoint.
 */
export async function testProviderConnection(
  rawConfig: ProviderConfig,
  signal?: AbortSignal,
): Promise<ConnectionTestResult> {
  const config = resolveProviderRouting(rawConfig);
  let normalizedBase: string;
  try {
    normalizedBase = normalizeBaseUrl(config.baseUrl);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  }

  // First try GET /models
  const modelsUrl = normalizedBase.endsWith('/v1')
    ? `${normalizedBase}/models`
    : `${normalizedBase}/v1/models`;

  try {
    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: signal ?? AbortSignal.timeout(10000),
    });

    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { data?: { id: string }[] } | null;
      const modelIds = Array.isArray(data?.data) ? data.data.map((m) => m.id).filter(Boolean) : [];
      const origin = new URL(normalizedBase).origin;
      return {
        ok: true,
        message: `Connected successfully to ${origin}.${modelIds.length ? ` Found ${modelIds.length} models.` : ''}`,
        models: modelIds.slice(0, 30),
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: `Authentication failed (${res.status}). Please check your API key.`,
      };
    }

    // Some gateways do not expose /models. Fallback: test completions endpoint with an empty or minimal query
    const completionsUrl = buildChatCompletionsUrl(config.baseUrl);
    const probeRes = await fetch(completionsUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model.trim() || 'gpt-4o',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: signal ?? AbortSignal.timeout(12000),
    });

    if (probeRes.ok) {
      const origin = new URL(normalizedBase).origin;
      return { ok: true, message: `Connected successfully to ${origin} (chat endpoint verified).` };
    }

    let detail = `status ${probeRes.status} ${probeRes.statusText}`;
    try {
      const errJson = await probeRes.json();
      if (errJson?.error?.message) detail = errJson.error.message;
    } catch {
      // not json
    }
    return { ok: false, message: `Provider error: ${detail}` };
  } catch (err) {
    return {
      ok: false,
      message: `Could not connect to provider: ${(err as Error).message || 'Network request failed'}. Check the Base URL and ensure the endpoint is running.`,
    };
  }
}

/**
 * Initiates an AI chat completion request to generate IELTS material (§11.3).
 * Structured output is requested, and the returned content is verified.
 */
export async function callProviderChat(
  prompt: string,
  rawConfig: ProviderConfig,
  options?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<GenerationResult> {
  const config = resolveProviderRouting(rawConfig);
  if (config.model === 'gpt-6-luna' && !config.apiKey.trim()) {
    throw new Error(
      'EXPLABS_API_KEY is not set. Please create one under Settings -> API Keys and export EXPLABS_API_KEY.',
    );
  }

  const completionsUrl = buildChatCompletionsUrl(config.baseUrl);
  const timeoutMs = options?.timeoutMs ?? 120000; // 2 minutes default for generation

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  }

  const model = config.model.trim() || 'gpt-4o';
  const systemInstruction = `You are a Cambridge IELTS Chief Examiner and test item writer. You write original IELTS Academic
material that matches the format, difficulty, register and item-writing conventions of the
official Cambridge IELTS books. You never copy existing test content.

ABSOLUTE RULES
1. FORMAT FIDELITY & QUESTION-TYPE VARIETY: Follow the blueprint for the requested job exactly: counts, timings,
   question types, instructions wording, answer-length limits.
   - For Reading passages: strictly keep text between 740 and 880 words (NEVER exceed 910 words, as >910 is immediately rejected). Faithfully implement the assigned diverse question types (TFNG, YNNG, matching headings, matching information to paragraphs, matching features, matching sentence endings, summary completion, note/table/flow-chart completion, multiple choice).
   - For Listening scripts: strictly keep spoken script between 750 and 880 words (NEVER exceed 950 words). Faithfully implement the assigned varied question formats (form completion, table/note/sentence/flow-chart completion, matching features/opinions, multiple choice).
   - For Listening and Reading: strictly create between 2 and 4 distinct question groups (NEVER output only 1 group).
   - For Speaking: Follow the detailed blueprints for Part 1 (engaging, varied questions across two distinct topics with different inquiry styles), Part 2 (a vivid, relatable cue card with 4 cue bullets), and Part 3 (6 in-depth analytical discussion questions exploring broader societal, psychological, cultural, or historical implications; avoid simplistic yes/no stems).
   - For Writing: Faithfully implement the assigned Task 1 visual (table/bar/line/process) with plausible figures, and the specific Task 2 essay genre.
   Use official-style rubrics (e.g. "Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.").
2. ORIGINALITY, NOVELTY & DEPTH: Avoid cliché or repetitive topics (basic global warming, generic hobbies, school uniforms, "describe a book").
   Generate imaginative, authentic, engaging subject matter drawn from the brief. Questions must be engaging, varied, and thought-provoking while strictly adhering to Cambridge IELTS standards. Content must be factually plausible; never invent real people,
   institutions or statistics presented as real.
3. PARAPHRASE, DON'T ECHO: Question wording must paraphrase the source (synonyms, changed
   grammar, nominalisation). Answers themselves are exact verbatim substrings of the passage/script.
4. DISTRACTORS: Each wrong option must be tempting for a specific reason: partial truth, wrong
   qualifier ("predominantly", "invariably"), reversed cause/effect, wrong time frame, or a speaker
   self-correcting. Never use trivially false options. Exactly one unambiguously correct answer.
5. ORDER & DIFFICULTY: Listening and most Reading question groups follow the order of the source.
   Difficulty rises within the test (L1 easiest -> L4 hardest; R1 -> R3). Target band spread:
   easy 4-5.5, medium 6-7, hard 7.5-9, and tag every item with target_band.
6. SPECS NOT PICTURES: You never produce images, SVG, LaTeX or ASCII art. For any visual you output
   a structured \`visual_spec\` (schema provided) containing the actual numbers/coordinates, and every
   answer depending on it must be derivable from that data.
7. SELF-AUDIT: Before output, silently check counts, word limits, verbatim substrings, answer
   uniqueness, and that no answer is guessable without the source.
8. REVIEW FIELDS: For every question output evidence.quote (verbatim), explanation (2-4 sentences naming
   the exact paraphrase link between question and source), distractor_notes for every wrong option in
   MCQ/matching/TFNG, a skill tag, a common_mistake_tag, and a one-sentence strategy_tip. For TFNG/YNNG
   Not Given items, the explanation must state what information is missing, not merely "it is not mentioned".
   For Listening, explanation must also say what the trap was (self-correction, distractor number, similar-sounding word, speaker changing mind).
9. OUTPUT: Exactly one valid JSON envelope matching the schema. No markdown fences, no commentary.`;

  const buildBody = (includeResponseFormat: boolean) =>
    JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      ...(includeResponseFormat ? { response_format: { type: 'json_object' } } : {}),
    });

  const abortSignal = options?.signal
    ? options.signal
    : AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await fetch(completionsUrl, {
      method: 'POST',
      headers,
      body: buildBody(true),
      signal: abortSignal,
    });

    // If 400 Bad Request indicates response_format is unsupported, retry once without it
    if (response.status === 400) {
      const errText = await response.clone().text().catch(() => '');
      if (errText.toLowerCase().includes('response_format')) {
        response = await fetch(completionsUrl, {
          method: 'POST',
          headers,
          body: buildBody(false),
          signal: abortSignal,
        });
      }
    }
  } catch (err) {
    console.error('[IELTS Studio] AI Provider Fetch Failed:', {
      endpoint: completionsUrl,
      model,
      error: (err as Error).message,
      cause: err,
    });
    if ((err as Error).name === 'AbortError' || (err as Error).name === 'TimeoutError') {
      throw new Error(
        `The AI request timed out after ${Math.round(timeoutMs / 1000)} seconds. Try using a faster model or retrying.`,
        { cause: err },
      );
    }
    throw new Error(
      `Failed to reach the AI endpoint: ${(err as Error).message || 'Network error'}. Check your Base URL and network connection.`,
      { cause: err },
    );
  }

  if (!response.ok) {
    let errMsg = `AI request failed (${response.status} ${response.statusText})`;
    let errBody: unknown = null;
    try {
      const errData = await response.json();
      errBody = errData;
      if (errData?.error?.message) {
        errMsg = `AI provider error (${response.status}): ${errData.error.message}`;
      } else if (errData?.message) {
        errMsg = `AI provider error (${response.status}): ${errData.message}`;
      }
    } catch {
      // not JSON
    }
    console.error('[IELTS Studio] AI Provider HTTP Error:', {
      status: response.status,
      statusText: response.statusText,
      endpoint: completionsUrl,
      model,
      errorResponse: errBody,
    });
    throw new Error(errMsg);
  }

  const json = (await response.json()) as {
    model?: string;
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string };
    }>;
    usage?: TokenUsage;
  };

  const choice = json.choices?.[0];
  if (!choice) {
    throw new Error('The AI returned an empty response with no choices.');
  }

  if (choice.finish_reason === 'length') {
    throw new Error(
      'The AI generation was truncated because it exceeded the maximum token limit. Consider using a model with a larger context window.',
    );
  }

  const content = choice.message?.content;
  if (!content || typeof content !== 'string' || !content.trim()) {
    throw new Error('The AI returned an empty message content.');
  }

  return {
    content,
    model: json.model || model,
    provider: new URL(config.baseUrl).hostname,
    usage: json.usage,
  };
}

/**
 * Tolerant JSON extractor & parser for LLM responses:
 * - Strips ```json ... ``` or ``` ... ``` fences
 * - Extracts balanced JSON object or array
 * - Returns typed object or throws descriptive error
 */
export function parseTolerantJson<T = unknown>(raw: string): T {
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim();
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let startIdx = -1;
    let openChar = '{';
    let closeChar = '}';

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      startIdx = firstBrace;
      openChar = '{';
      closeChar = '}';
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
      openChar = '[';
      closeChar = ']';
    }

    if (startIdx !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      let endIdx = -1;

      for (let i = startIdx; i < text.length; i++) {
        const c = text[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (c === openChar) depth++;
          else if (c === closeChar) {
            depth--;
            if (depth === 0) {
              endIdx = i;
              break;
            }
          }
        }
      }

      if (endIdx !== -1) {
        const candidate = text.slice(startIdx, endIdx + 1);
        try {
          return JSON.parse(candidate) as T;
        } catch {
          // fall through
        }
      }
    }
    throw new Error(`Failed to parse AI response as valid JSON: ${raw.slice(0, 160)}...`);
  }
}

export type ScoringOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  systemInstruction?: string;
  temperature?: number;
  maxTokens?: number;
};

/**
 * Dedicated AI scoring call for Writing and Speaking.
 * - Uses scoring-specific system prompt (no item-generation constraints).
 * - Deterministic: temperature 0 by default.
 * - Tolerates non-standard markdown fences and retryable formats.
 */
export async function callProviderScoring(
  prompt: string,
  rawConfig: ProviderConfig,
  options?: ScoringOptions,
): Promise<GenerationResult> {
  const config = resolveProviderRouting(rawConfig);
  if (config.model === 'gpt-6-luna' && !config.apiKey.trim()) {
    throw new Error(
      'EXPLABS_API_KEY is not set. Please create one under Settings -> API Keys and export EXPLABS_API_KEY.',
    );
  }

  const completionsUrl = buildChatCompletionsUrl(config.baseUrl);
  const timeoutMs = options?.timeoutMs ?? 60000;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (config.apiKey.trim()) {
    headers.Authorization = `Bearer ${config.apiKey.trim()}`;
  }

  const model = config.model.trim() || 'gpt-4o';
  const systemInstruction =
    options?.systemInstruction ||
    `You are an official Cambridge IELTS Academic Examiner. You only SCORE candidate responses against official IELTS Band Descriptors (0.0 to 9.0 on 0.5 increments).
You judge criteria independently based on verified verbatim quotes. You never generate test items or practice passages.
Return JSON only matching the requested schema with no markdown wrapping or conversational commentary.`;

  const buildBody = (includeResponseFormat: boolean) =>
    JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      temperature: options?.temperature ?? 0,
      max_tokens: options?.maxTokens ?? 3000,
      ...(includeResponseFormat ? { response_format: { type: 'json_object' } } : {}),
    });

  const abortSignal = options?.signal ? options.signal : AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await fetch(completionsUrl, {
      method: 'POST',
      headers,
      body: buildBody(true),
      signal: abortSignal,
    });

    if (response.status === 400) {
      const errText = await response.clone().text().catch(() => '');
      if (errText.toLowerCase().includes('response_format')) {
        response = await fetch(completionsUrl, {
          method: 'POST',
          headers,
          body: buildBody(false),
          signal: abortSignal,
        });
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError' || (err as Error).name === 'TimeoutError') {
      throw new Error(`Scoring timed out after ${Math.round(timeoutMs / 1000)} seconds.`, { cause: err });
    }
    throw new Error(`Failed to reach scoring endpoint: ${(err as Error).message || 'Network error'}.`, {
      cause: err,
    });
  }

  if (!response.ok) {
    let errMsg = `Scoring request failed (${response.status} ${response.statusText})`;
    try {
      const errData = await response.json();
      if (errData?.error?.message) {
        errMsg = `Scoring error (${response.status}): ${errData.error.message}`;
      } else if (errData?.message) {
        errMsg = `Scoring error (${response.status}): ${errData.message}`;
      }
    } catch {
      // not JSON
    }
    throw new Error(errMsg);
  }

  const json = (await response.json()) as {
    model?: string;
    choices?: Array<{
      finish_reason?: string;
      message?: { content?: string };
    }>;
    usage?: TokenUsage;
  };

  const choice = json.choices?.[0];
  if (!choice) {
    throw new Error('Scoring provider returned an empty response.');
  }

  const content = choice.message?.content;
  if (!content || typeof content !== 'string' || !content.trim()) {
    throw new Error('Scoring provider returned empty content.');
  }

  return {
    content,
    model: json.model || model,
    provider: new URL(config.baseUrl).hostname,
    usage: json.usage,
  };
}

/**
 * Makes a test call to the Experiential gateway with model gpt-6-luna
 * to verify API connectivity and print token usage.
 */
export async function makeExperientialTestCall(apiKey?: string): Promise<{
  reply: string;
  model: string;
  usage?: TokenUsage;
}> {
  const key = apiKey?.trim() || getExplabsApiKey();
  if (!key) {
    throw new Error(
      'EXPLABS_API_KEY is not set. Please create one under Settings -> API Keys and export EXPLABS_API_KEY.',
    );
  }

  const res = await fetch(`${EXPERIENTIAL_GATEWAY_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-6-luna',
      messages: [{ role: 'user', content: 'Say hello in 5 words or less.' }],
      max_tokens: 20,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Experiential gateway test call failed (${res.status} ${res.statusText}): ${errText}`);
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: TokenUsage;
  };

  return {
    reply: data.choices?.[0]?.message?.content || '',
    model: data.model || 'gpt-6-luna',
    usage: data.usage,
  };
}
