import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBaseUrl,
  buildChatCompletionsUrl,
  loadProviderConfig,
  saveProviderConfig,
  callProviderChat,
  testProviderConnection,
  resolveProviderRouting,
  makeExperientialTestCall,
  EXPERIENTIAL_GATEWAY_URL,
  DEFAULT_PROVIDER_CONFIG,
  type ProviderConfig,
} from '../src/lib/providers.ts';

test('normalizeBaseUrl validates and normalizes correctly', () => {
  // Valid https
  assert.equal(normalizeBaseUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1');
  assert.equal(normalizeBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1');
  assert.equal(normalizeBaseUrl('  https://openrouter.ai/api/v1  '), 'https://openrouter.ai/api/v1');

  // Valid local http
  assert.equal(normalizeBaseUrl('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:8000/v1'), 'http://127.0.0.1:8000/v1');
  assert.equal(normalizeBaseUrl('http://[::1]:11434'), 'http://[::1]:11434');
  assert.equal(normalizeBaseUrl('http://myserver.local:8080/v1'), 'http://myserver.local:8080/v1');

  // Insecure remote HTTP rejected (§11.3)
  assert.throws(() => normalizeBaseUrl('http://api.openai.com/v1'), /Insecure HTTP is only permitted for local/);
  assert.throws(() => normalizeBaseUrl('http://remote-server.com/api'), /Insecure HTTP is only permitted for local/);

  // Embedded credentials rejected (§11.3)
  assert.throws(() => normalizeBaseUrl('https://user:pass@api.openai.com/v1'), /Embedded credentials/);
  assert.throws(() => normalizeBaseUrl('https://user@api.openai.com/v1'), /Embedded credentials/);

  // Invalid protocol
  assert.throws(() => normalizeBaseUrl('ftp://api.openai.com/v1'), /HTTP or HTTPS/);

  // Empty string or garbage
  assert.throws(() => normalizeBaseUrl(''), /cannot be empty/);
  assert.throws(() => normalizeBaseUrl('not-a-url'), /Invalid Base URL/);
});

test('buildChatCompletionsUrl avoids double /v1 and builds correct endpoint', () => {
  assert.equal(
    buildChatCompletionsUrl('https://api.openai.com/v1'),
    'https://api.openai.com/v1/chat/completions',
  );
  assert.equal(
    buildChatCompletionsUrl('https://api.openai.com/v1/'),
    'https://api.openai.com/v1/chat/completions',
  );
  assert.equal(
    buildChatCompletionsUrl('https://api.openai.com'),
    'https://api.openai.com/v1/chat/completions',
  );
  assert.equal(
    buildChatCompletionsUrl('http://localhost:11434/v1'),
    'http://localhost:11434/v1/chat/completions',
  );
  assert.equal(
    buildChatCompletionsUrl('http://localhost:11434'),
    'http://localhost:11434/v1/chat/completions',
  );
  assert.equal(
    buildChatCompletionsUrl('https://openrouter.ai/api/v1'),
    'https://openrouter.ai/api/v1/chat/completions',
  );
  assert.equal(
    buildChatCompletionsUrl('https://api.openai.com/v1/chat/completions'),
    'https://api.openai.com/v1/chat/completions',
  );
});

test('config storage round-trips in localStorage if available or returns defaults', () => {
  // In Node environment without localStorage, loadProviderConfig returns default
  const config = loadProviderConfig();
  assert.equal(config.baseUrl, DEFAULT_PROVIDER_CONFIG.baseUrl);
  assert.equal(config.model, DEFAULT_PROVIDER_CONFIG.model);

  // Mock localStorage
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, val);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    length: store.size,
  };

  const custom: ProviderConfig = {
    baseUrl: 'http://localhost:11434/v1',
    apiKey: 'secret-test-key',
    model: 'llama3:8b',
    enabled: true,
  };
  saveProviderConfig(custom);
  const loaded = loadProviderConfig();
  assert.equal(loaded.baseUrl, 'http://localhost:11434/v1');
  assert.equal(loaded.apiKey, 'secret-test-key');
  assert.equal(loaded.model, 'llama3:8b');
  assert.equal(loaded.enabled, true);

  delete (globalThis as Record<string, unknown>).localStorage;
});

test('callProviderChat sends request and parses choice content', async () => {
  const originalFetch = globalThis.fetch;
  let receivedUrl = '';
  let receivedHeaders: Record<string, string> = {};
  let receivedBody: Record<string, unknown> = {};

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    receivedUrl = String(url);
    receivedHeaders = (init?.headers as Record<string, string>) || {};
    receivedBody = JSON.parse(String(init?.body || '{}'));
    return new Response(
      JSON.stringify({
        model: 'gpt-4o-2024-08-06',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: '{"format_version":1,"data":{}}',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const config: ProviderConfig = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-my-secret-key-1234',
      model: 'gpt-4o',
      enabled: true,
    };
    const res = await callProviderChat('Please generate IELTS test', config);
    assert.equal(receivedUrl, 'https://api.openai.com/v1/chat/completions');
    assert.equal(receivedHeaders['Authorization'], 'Bearer sk-my-secret-key-1234');
    assert.equal(receivedBody.model, 'gpt-4o');
    assert.equal(res.content, '{"format_version":1,"data":{}}');
    assert.equal(res.model, 'gpt-4o-2024-08-06');
    assert.equal(res.provider, 'api.openai.com');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callProviderChat handles authentication error without leaking API key in error message', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        error: { message: 'Incorrect API key provided' },
      }),
      { status: 401, statusText: 'Unauthorized', headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const config: ProviderConfig = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-super-secret-do-not-leak',
      model: 'gpt-4o',
      enabled: true,
    };
    await assert.rejects(
      async () => {
        await callProviderChat('test', config);
      },
      (err: Error) => {
        assert.ok(err.message.includes('Incorrect API key provided'));
        assert.ok(!err.message.includes('sk-super-secret-do-not-leak'));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callProviderChat throws error when output is truncated due to length', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'length',
            message: { content: '{"incomplete' },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const config: ProviderConfig = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o',
      enabled: true,
    };
    await assert.rejects(
      async () => {
        await callProviderChat('test', config);
      },
      /maximum token limit/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('testProviderConnection tests models endpoint and returns success', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/models')) {
      return new Response(
        JSON.stringify({
          data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  try {
    const config: ProviderConfig = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      enabled: true,
    };
    const res = await testProviderConnection(config);
    assert.equal(res.ok, true);
    assert.ok(res.message.includes('Connected successfully'));
    assert.deepEqual(res.models, ['gpt-4o', 'gpt-4o-mini']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveProviderRouting routes gpt-6-luna through Experiential gateway by default', () => {
  process.env.EXPLABS_API_KEY = 'test-exp-key-123';

  try {
    // Default base URL routes to Experiential gateway
    const defaultLuna = resolveProviderRouting({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-6-luna',
      enabled: true,
    });
    assert.equal(defaultLuna.baseUrl, EXPERIENTIAL_GATEWAY_URL);
    assert.equal(defaultLuna.apiKey, 'test-exp-key-123');
    assert.equal(defaultLuna.model, 'gpt-6-luna');

    // Custom user base URL is preserved
    const customLuna = resolveProviderRouting({
      baseUrl: 'https://custom-gateway.local/v1',
      apiKey: 'custom-key',
      model: 'gpt-6-luna',
      enabled: true,
    });
    assert.equal(customLuna.baseUrl, 'https://custom-gateway.local/v1');
    assert.equal(customLuna.apiKey, 'custom-key');

    // Other models are untouched
    const standard = resolveProviderRouting({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'standard-key',
      model: 'gpt-4o',
      enabled: true,
    });
    assert.equal(standard.baseUrl, 'https://api.openai.com/v1');
    assert.equal(standard.apiKey, 'standard-key');
  } finally {
    delete process.env.EXPLABS_API_KEY;
  }
});

test('makeExperientialTestCall executes with gpt-6-luna and returns reply + token usage', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: unknown = null;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = url.toString();
    capturedHeaders = (init?.headers as Record<string, string>) || {};
    capturedBody = init?.body ? JSON.parse(init.body as string) : null;

    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test-exp',
        model: 'gpt-6-luna',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Hello from Experiential Labs!' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 6,
          total_tokens: 18,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    const result = await makeExperientialTestCall('mock-explabs-token');
    assert.equal(capturedUrl, 'https://api.experientiallabs.ai/v1/chat/completions');
    assert.equal(capturedHeaders.Authorization, 'Bearer mock-explabs-token');
    assert.equal((capturedBody as { model: string }).model, 'gpt-6-luna');
    assert.equal(result.reply, 'Hello from Experiential Labs!');
    assert.equal(result.model, 'gpt-6-luna');
    assert.deepEqual(result.usage, {
      prompt_tokens: 12,
      completion_tokens: 6,
      total_tokens: 18,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});


