import { ValidationError } from './types.ts';
import type { Envelope, ErrorCode } from './types.ts';

/** §7.1 encoded-byte ceiling, enforced before anything is parsed. */
export const MAX_INPUT_BYTES = 1024 * 1024;

/** §7.1 nesting bound, enforced inside the parser and never by walking the result. */
export const MAX_DEPTH = 32;

/** §6.1 rejected recursively, before any application. */
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** §4.1 exactly these five keys. No aliases, no extras, no partial envelope. */
const ENVELOPE_KEYS: readonly string[] = [
  'format_version',
  'attempt_id',
  'job_key',
  'generation_id',
  'data',
];

const at = (s: string, i: number): string => (i < s.length ? s.charAt(i) : '');
const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const child = (path: string, key: string): string => (path ? `${path}.${key}` : key);
const FENCE_LINE = /^[ \t]*`{3,}/;
const FENCE_OPEN = /^[ \t]*`{3,}[ \t]*$/;
const LITERALS = ['true', 'false', 'null'] as const;

/**
 * §7.1 byte/encoding precheck, exported so it is independently testable.
 * Extension is a UI hint; only the bytes decide.
 */
export function precheckInput(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new ValidationError(
      'too_large',
      `Input is ${bytes.byteLength} encoded bytes; the limit is ${MAX_INPUT_BYTES}.`,
    );
  }
  let text: string;
  if (typeof input === 'string') {
    text = input;
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new ValidationError('bad_encoding', 'Input is not valid UTF-8 text.');
    }
  }
  // §7.1 binary/NUL content is rejected even when it is otherwise well-formed text.
  if (text.includes('\u0000')) {
    throw new ValidationError('nul_byte', 'Input contains a NUL byte and is not JSON text.');
  }
  // §7.1 strip a leading UTF-8 BOM and surrounding whitespace only. Order matters:
  // a BOM after leading whitespace still has to go, otherwise it survives as a stray
  // first character and the parse fails on an input the author considers clean.
  const trimmed = text.trim();
  return trimmed.charAt(0) === '\uFEFF' ? trimmed.slice(1).trimStart() : trimmed;
}

/**
 * §7.1 accepted grammar: one complete raw JSON object, or the entire input as ONE
 * fence labelled `json` whose closing fence stands alone. No brace searching, no
 * "last fence wins", no trailing garbage, no partial parse.
 */
export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const lines = trimmed.split('\n');
  const marks: number[] = [];
  lines.forEach((line, n) => {
    if (FENCE_LINE.test(line)) marks.push(n);
  });
  if (marks.length === 0) return trimmed;
  if (marks.length > 2) {
    throw new ValidationError(
      'multiple_fences',
      'Return either raw JSON or exactly one whole fenced JSON block; more than one fenced block was found.',
    );
  }
  const open = marks[0] ?? -1;
  if (marks.length === 1) {
    throw new ValidationError(
      'parse_failed',
      'A fenced block must be closed by a closing fence on its own line.',
    );
  }
  const close = marks[1] ?? -1;
  if ((lines[open] ?? '').trim() !== '```json') {
    throw new ValidationError(
      'not_json',
      'A fenced block is only accepted when the opening fence is labelled json.',
    );
  }
  if (!FENCE_OPEN.test(lines[close] ?? '')) {
    throw new ValidationError(
      'parse_failed',
      'The closing fence must stand on its own line with nothing else on it.',
    );
  }
  const outside = (from: number, to: number): boolean => lines.slice(from, to).some((l) => l.trim() !== '');
  if (outside(0, open) || outside(close + 1, lines.length)) {
    throw new ValidationError(
      'fence_prose',
      'No text is allowed before or after the fenced JSON block.',
    );
  }
  return lines.slice(open + 1, close).join('\n');
}

/**
 * §7.1 small duplicate-aware scanner. JSON.parse is not usable here: it silently
 * keeps the last duplicate key, so a crafted envelope could smuggle a second
 * `job_key` past every later check. Nothing is salvaged — every failure throws.
 */
export function parseBoundedJson(text: string): unknown {
  let i = 0;
  let depth = 0;
  const fail = (detail: string): never => {
    throw new ValidationError('parse_failed', `${detail} (at position ${i}).`);
  };
  const ws = (): void => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i += 1;
      else break;
    }
  };
  const readString = (): string => {
    i += 1;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('Unterminated string');
      const ch = at(text, i);
      if (ch === '"') {
        i += 1;
        return out;
      }
      if (ch < ' ') fail('Unescaped control character in string');
      if (ch !== '\\') {
        out += ch;
        i += 1;
        continue;
      }
      i += 1;
      const esc = at(text, i);
      i += 1;
      if (esc === 'u') {
        const hex = text.slice(i, i + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid unicode escape');
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 4;
        continue;
      }
      const simple: Record<string, string> = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: '\b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t',
      };
      if (!Object.hasOwn(simple, esc)) fail('Invalid escape sequence');
      out += simple[esc] ?? '';
    }
  };
  const readNumber = (path: string): number => {
    const start = i;
    if (at(text, i) === '-') i += 1;
    if (at(text, i) === '0') i += 1;
    else if (isDigit(at(text, i))) while (isDigit(at(text, i))) i += 1;
    else fail('Invalid number');
    if (at(text, i) === '.') {
      i += 1;
      if (!isDigit(at(text, i))) fail('Invalid number');
      while (isDigit(at(text, i))) i += 1;
    }
    const exp = at(text, i);
    if (exp === 'e' || exp === 'E') {
      i += 1;
      if (at(text, i) === '+' || at(text, i) === '-') i += 1;
      if (!isDigit(at(text, i))) fail('Invalid number');
      while (isDigit(at(text, i))) i += 1;
    }
    const value = Number(text.slice(start, i));
    // §18.3 rejects non-finite values; bare literals (NaN/Infinity) never parse.
    if (!Number.isFinite(value)) {
      throw new ValidationError('bad_number', 'Number is not finite.', path);
    }
    return value;
  };
  const enter = (path: string): void => {
    depth += 1;
    if (depth > MAX_DEPTH) {
      throw new ValidationError(
        'depth_exceeded',
        `JSON nesting is limited to ${MAX_DEPTH} levels.`,
        path,
      );
    }
  };
  const readObject = (path: string): Record<string, unknown> => {
    enter(path);
    i += 1;
    const out: Record<string, unknown> = {};
    const seen = new Set<string>();
    ws();
    if (at(text, i) === '}') {
      i += 1;
      depth -= 1;
      return out;
    }
    for (;;) {
      ws();
      if (at(text, i) !== '"') fail('Expected an object key');
      const key = readString();
      if (UNSAFE_KEYS.has(key)) {
        throw new ValidationError(
          'unsafe_key',
          `Key ${JSON.stringify(key)} is not allowed in imported JSON.`,
          child(path, key),
        );
      }
      // Compared after decoding: "job_key" and "job\u005fkey" are one key.
      if (seen.has(key)) {
        throw new ValidationError(
          'duplicate_key',
          `Key ${JSON.stringify(key)} appears more than once in this object.`,
          child(path, key),
        );
      }
      seen.add(key);
      ws();
      if (at(text, i) !== ':') fail('Expected ":"');
      i += 1;
      ws();
      out[key] = readValue(child(path, key));
      ws();
      if (at(text, i) === ',') {
        i += 1;
        continue;
      }
      if (at(text, i) === '}') {
        i += 1;
        depth -= 1;
        return out;
      }
      fail('Expected "," or "}"');
    }
  };
  const readArray = (path: string): unknown[] => {
    enter(path);
    i += 1;
    const out: unknown[] = [];
    ws();
    if (at(text, i) === ']') {
      i += 1;
      depth -= 1;
      return out;
    }
    for (;;) {
      ws();
      out.push(readValue(`${path}[${out.length}]`));
      ws();
      if (at(text, i) === ',') {
        i += 1;
        continue;
      }
      if (at(text, i) === ']') {
        i += 1;
        depth -= 1;
        return out;
      }
      fail('Expected "," or "]"');
    }
  };
  const readValue = (path: string): unknown => {
    if (i >= text.length) fail('Unexpected end of input');
    const c = at(text, i);
    if (c === '{') return readObject(path);
    if (c === '[') return readArray(path);
    if (c === '"') return readString();
    if (c === '-' || isDigit(c)) return readNumber(path);
    // Strict JSON has no bare NaN/Infinity: only these three literals exist.
    const word = LITERALS.find((l) => text.startsWith(l, i));
    if (word === undefined) fail(`Unexpected ${JSON.stringify(c)}`);
    // Non-null only because the guard above is `never`-returning.
    i += word!.length;
    return word === 'true' ? true : word === 'false' ? false : null;
  };

  ws();
  const value = readValue('');
  ws();
  if (i < text.length) fail('Unexpected trailing content after the JSON value');
  return value;
}

const requireEnvelope = (value: unknown): Envelope => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('not_json', 'The response must be one complete JSON object.');
  }
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!ENVELOPE_KEYS.includes(key)) {
      throw new ValidationError(
        'unknown_key',
        `${key} is not an envelope key. Emit exactly format_version, attempt_id, job_key, generation_id and data.`,
        key,
      );
    }
  }
  for (const key of ENVELOPE_KEYS) {
    if (!Object.hasOwn(raw, key)) {
      throw new ValidationError('missing_key', `${key} is required.`, key);
    }
  }
  if (raw.format_version !== 1) {
    throw new ValidationError(
      'bad_envelope_version',
      'format_version must be exactly 1. Echo the values the app issued.',
      'format_version',
    );
  }
  for (const key of ['attempt_id', 'job_key', 'generation_id'] as const) {
    if (typeof raw[key] !== 'string' || raw[key] === '') {
      throw new ValidationError('bad_type', `${key} must be a non-empty string.`, key);
    }
  }
  const data = raw.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ValidationError('bad_type', 'data must be an object.', 'data');
  }
  return {
    format_version: 1,
    attempt_id: raw.attempt_id as string,
    job_key: raw.job_key as string,
    generation_id: raw.generation_id as string,
    data,
  };
};

/**
 * §7.2 step 2: bounded parse plus envelope identity. Material rules against `data`
 * belong to the material core (P0-04); this module never interprets the payload.
 */
export function parseEnvelopeInput(input: string | Uint8Array): Envelope {
  return requireEnvelope(parseBoundedJson(extractJsonText(precheckInput(input))));
}

export type { ErrorCode };