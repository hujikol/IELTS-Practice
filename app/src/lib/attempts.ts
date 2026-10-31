// Browser-native persistent storage for IELTS attempts, requests, imports, and history.
// Replaces Tauri native commands with pure browser localStorage / memory store.

import { score, type Envelope, type TestData, type AttemptRecord } from './types.ts';
import { buildAttemptCapture, generateFinalReport } from './assessment-coordinator.ts';
import { roundIeltsOverallBand, ieltsBandToCefr, type CefrLevel } from './bands.ts';

export type { AttemptRecord };

export type AttemptSummary = {
  id: string;
  mode: string;
  status: string;
  scope: string | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
  preparedCount: number;
  jobCount: number;
  overallBand?: number | null;
  cefr?: CefrLevel | null;
  bands?: {
    listening?: number | null;
    reading?: number | null;
    writing?: number | null;
    speaking?: number | null;
  };
};

export type IssuedRequest = { generationId: string; snapshot: string; rotated: boolean; revision: number };

export type CreateAttemptInput = {
  mode: 'timed' | 'untimed';
  scope: 'full' | 'listening' | 'reading' | 'writing' | 'speaking';
  practice_part: number;
  focus_skill?: string;
  data: TestData;
};

export class CommandError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly currentRevision: number | undefined;
  constructor(e: { code: string; message: string; retryable: boolean; current_revision?: number }) {
    super(e.message);
    this.name = 'CommandError';
    this.code = e.code;
    this.retryable = e.retryable;
    this.currentRevision = e.current_revision;
  }
  get isConflict(): boolean {
    return this.code === 'revision_conflict';
  }
}

// Memory fallback store for non-browser/test environments
const memoryStore = new Map<string, string>();

const getStorageItem = (key: string): string | null => {
  if (typeof localStorage !== 'undefined') {
    try {
      return localStorage.getItem(key);
    } catch {
      // Fallback to memory
    }
  }
  return memoryStore.get(key) ?? null;
};

const setStorageItem = (key: string, value: string): void => {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, value);
      return;
    } catch {
      // Fallback to memory
    }
  }
  memoryStore.set(key, value);
};

const removeStorageItem = (key: string): void => {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(key);
      return;
    } catch {
      // Fallback to memory
    }
  }
  memoryStore.delete(key);
};

const INDEX_KEY = 'ielts_studio_attempts_index';
const ATTEMPT_PREFIX = 'ielts_studio_attempt:';

const readIndex = (): string[] => {
  const raw = getStorageItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const writeIndex = (ids: string[]): void => {
  setStorageItem(INDEX_KEY, JSON.stringify(ids));
};

export function isWritingAttempted(data?: TestData | null): boolean {
  if (!data || !Array.isArray(data.texts)) return false;
  if (data.scope !== undefined && data.scope !== 'full' && data.scope !== 'writing') return false;
  return data.texts.some((t) => typeof t === 'string' && t.trim().split(/\s+/).filter(Boolean).length >= 20);
}

export function isSpeakingAttempted(data?: TestData | null): boolean {
  if (!data) return false;
  if (data.scope !== undefined && data.scope !== 'full' && data.scope !== 'speaking') return false;
  const hasTexts =
    Array.isArray(data.speakingTexts) &&
    data.speakingTexts.some((t) => typeof t === 'string' && t.trim().split(/\s+/).filter(Boolean).length >= 15);
  const hasRecordings = Boolean(data.recordings && Object.keys(data.recordings).length > 0);
  return hasTexts || hasRecordings;
}

export function sanitizeAttemptRecord(record: AttemptRecord): AttemptRecord {
  if (!record.data) return record;

  const writingAttempted = isWritingAttempted(record.data);
  const speakingAttempted = isSpeakingAttempted(record.data);
  let changed = false;

  // Sanitize finalReport if present
  if (record.data.finalReport) {
    const report = record.data.finalReport;
    if (report.modules) {
      if (!writingAttempted && (report.modules.writing?.band !== null || report.modules.writing?.status !== 'unattempted')) {
        report.modules.writing = {
          band: null,
          task1: null,
          task2: null,
          confidence: 'low',
          status: 'unattempted',
        };
        if (report.review?.writing) {
          report.review.writing.tasks = [];
        }
        changed = true;
      }
      if (!speakingAttempted && (report.modules.speaking?.band !== null || report.modules.speaking?.status !== 'unattempted')) {
        report.modules.speaking = {
          band: null,
          confidence: 'low',
          status: 'unattempted',
        };
        if (report.review?.speaking) {
          report.review.speaking.parts = [];
        }
        changed = true;
      }
    }

    // Overall band cannot be computed if any module in a full test is unattempted
    if ((!writingAttempted || !speakingAttempted) && report.overall?.band !== null) {
      report.overall = {
        band: null,
        method: 'partial results (incomplete modules)',
      };
      changed = true;
    }
  }

  // Sanitize record.data.result (legacy score) if present
  if (record.data.result) {
    if (!writingAttempted && record.data.result.writing) {
      record.data.result.writing.band = null;
    }
    if (!speakingAttempted && record.data.result.speaking) {
      record.data.result.speaking.band = null;
    }
    if (!writingAttempted || !speakingAttempted) {
      record.data.result.overall = null;
    }
  }

  if (changed) {
    try {
      writeRecord(record);
    } catch {
      // ignore in read-only or quota-limited contexts
    }
  }

  return record;
}

const readRecord = (id: string): AttemptRecord | null => {
  const raw = getStorageItem(`${ATTEMPT_PREFIX}${id}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AttemptRecord;
    return sanitizeAttemptRecord(parsed);
  } catch {
    return null;
  }
};

export const writeRecord = (record: AttemptRecord): void => {
  setStorageItem(`${ATTEMPT_PREFIX}${record.id}`, JSON.stringify(record));
  const ids = readIndex();
  if (!ids.includes(record.id)) {
    writeIndex([record.id, ...ids]);
  }
};

export const listAttempts = async (): Promise<AttemptSummary[]> => {
  const ids = readIndex();
  const summaries: AttemptSummary[] = [];

  for (const id of ids) {
    const record = readRecord(id);
    if (!record) continue;
    const preparedCount = record.data?.prepared?.length ?? 0;
    const jobCount = record.data?.jobs?.length ?? 0;

    let listeningBand: number | null = null;
    let readingBand: number | null = null;
    let writingBand: number | null = null;
    let speakingBand: number | null = null;
    let overallBand: number | null = null;

    if (record.status === 'completed' && record.data) {
      const report = record.data.finalReport;
      const res = record.data.result ?? (typeof score === 'function' ? score(record.data) : null);

      listeningBand = report?.modules?.listening?.band ?? res?.listening?.band ?? null;
      readingBand = report?.modules?.reading?.band ?? res?.reading?.band ?? null;
      writingBand = report?.modules?.writing?.band ?? res?.writing?.band ?? null;
      speakingBand = report?.modules?.speaking?.band ?? res?.speaking?.band ?? null;
      overallBand = report?.overall?.band ?? res?.overall ?? null;

      if (overallBand === null) {
        const valid = [listeningBand, readingBand, writingBand, speakingBand].filter(
          (b): b is number => typeof b === 'number' && b > 0,
        );
        if (valid.length === 4) {
          overallBand = roundIeltsOverallBand(valid.reduce((a, b) => a + b, 0) / 4);
        } else if (valid.length === 1 && record.data.scope !== 'full') {
          overallBand = valid[0]!;
        }
      }
    }

    const cefr = ieltsBandToCefr(overallBand)?.level ?? null;

    summaries.push({
      id: record.id,
      mode: record.mode,
      status: record.status,
      scope: record.data?.scope ?? null,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      revision: record.revision,
      preparedCount,
      jobCount,
      overallBand,
      cefr,
      bands: {
        listening: listeningBand,
        reading: readingBand,
        writing: writingBand,
        speaking: speakingBand,
      },
    });
  }

  // Sort descending by updated timestamp
  summaries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return summaries;
};

export const loadAttempt = async (attemptId: string): Promise<AttemptRecord> => {
  const record = readRecord(attemptId);
  if (!record) {
    throw new CommandError({
      code: 'not_found',
      message: 'That test could not be found.',
      retryable: false,
    });
  }
  return record;
};

export const createAttempt = async (input: CreateAttemptInput): Promise<AttemptRecord> => {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `att_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();

  const record: AttemptRecord = {
    id,
    owner_id: 'local',
    created_at: now,
    updated_at: now,
    revision: 1,
    mode: input.mode,
    status: 'preparing',
    data: {
      ...input.data,
    },
    requests: {},
    imports: {},
    import_history: {},
  };

  writeRecord(record);
  return record;
};

export const deleteAttempt = async (attemptId: string): Promise<void> => {
  removeStorageItem(`${ATTEMPT_PREFIX}${attemptId}`);
  const ids = readIndex().filter((id) => id !== attemptId);
  writeIndex(ids);
};

export const issueRequest = async (args: {
  attempt_id: string;
  expected_revision: number;
  job_key: string;
  rotate: boolean;
  snapshot: string;
  contract_version: number;
}): Promise<IssuedRequest> => {
  const record = await loadAttempt(args.attempt_id);
  if (record.revision !== args.expected_revision) {
    throw new CommandError({
      code: 'revision_conflict',
      message: 'This test changed elsewhere. Reloading the latest version.',
      retryable: false,
      current_revision: record.revision,
    });
  }

  const existing = record.requests[args.job_key];
  const generationId =
    !args.rotate && existing
      ? existing.generation_id
      : (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `gen_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

  record.requests[args.job_key] = {
    generation_id: generationId,
    issued_at: Date.now(),
    snapshot: args.snapshot,
  };
  record.revision += 1;
  record.updated_at = Date.now();

  writeRecord(record);
  return {
    generationId,
    snapshot: args.snapshot,
    rotated: args.rotate,
    revision: record.revision,
  };
};

export const commitImport = async (args: {
  attempt_id: string;
  expected_revision: number;
  job_key: string;
  generation_id: string;
  data: unknown;
  sha256: string;
  contract_version: number;
  raw_original: string;
  replace_confirmed: boolean;
}): Promise<AttemptRecord> => {
  const record = await loadAttempt(args.attempt_id);
  if (record.revision !== args.expected_revision) {
    throw new CommandError({
      code: 'revision_conflict',
      message: 'This test changed elsewhere. Reloading the latest version.',
      retryable: false,
      current_revision: record.revision,
    });
  }

  const alreadyPrepared = record.data.prepared?.includes(args.job_key);
  if (alreadyPrepared && !args.replace_confirmed) {
    throw new CommandError({
      code: 'replace_unconfirmed',
      message: 'This part already has accepted material. Confirm replacement to proceed.',
      retryable: false,
    });
  }

  // Merge the new data
  const updatedData = args.data as TestData;
  record.data = {
    ...record.data,
    ...updatedData,
    prepared: Array.from(new Set([...(record.data.prepared ?? []), args.job_key])),
  };

  const history = record.import_history[args.job_key] ?? [];
  record.import_history[args.job_key] = [
    ...history,
    {
      sha256: args.sha256,
      generation_id: args.generation_id,
      imported_at: Date.now(),
    },
  ];

  record.imports[args.job_key] = {
    sha256: args.sha256,
    original_path: `in-memory:${args.sha256.slice(0, 12)}`,
    generation_id: args.generation_id,
  };

  record.revision += 1;
  record.updated_at = Date.now();

  writeRecord(record);
  return record;
};

export const startAttempt = async (args: {
  attemptId: string;
  expectedRevision: number;
  timerMs?: number;
}): Promise<{ revision: number; data: TestData }> => {
  const record = await loadAttempt(args.attemptId);
  if (record.revision !== args.expectedRevision) {
    throw new CommandError({
      code: 'revision_conflict',
      message: 'This test changed elsewhere.',
      retryable: false,
      current_revision: record.revision,
    });
  }

  record.status = 'active';
  if (record.mode === 'timed' && typeof args.timerMs === 'number') {
    record.timer = {
      remaining: args.timerMs,
      running: true,
      checkpoint: Date.now(),
    };
  }
  record.revision += 1;
  record.updated_at = Date.now();
  writeRecord(record);
  return { revision: record.revision, data: record.data };
};

export const savePatch = async (args: {
  attemptId: string;
  expectedRevision: number;
  patch: {
    responses?: Record<string, string | number>;
    texts?: string[];
    speakingTexts?: string[];
    notes?: string[];
    marked?: string[];
    audioPlayed?: boolean[];
    audioDurations?: number[];
    timer?: { remaining: number; running: boolean; checkpoint: number };
  };
}): Promise<{ revision: number; data?: TestData }> => {
  const record = await loadAttempt(args.attemptId);
  if (record.revision !== args.expectedRevision) {
    throw new CommandError({
      code: 'revision_conflict',
      message: 'This test changed elsewhere.',
      retryable: false,
      current_revision: record.revision,
    });
  }

  const data = record.data;
  if (args.patch.responses) {
    data.responses = { ...data.responses, ...args.patch.responses };
  }
  if (args.patch.texts) {
    data.texts = [...args.patch.texts];
  }
  if (args.patch.speakingTexts) {
    data.speakingTexts = [...args.patch.speakingTexts];
  }
  if (args.patch.notes) {
    data.notes = [...args.patch.notes];
  }
  if (args.patch.marked) {
    data.marked = [...args.patch.marked];
  }
  if (args.patch.audioPlayed) {
    data.audioPlayed = [...args.patch.audioPlayed];
  }
  if (args.patch.audioDurations) {
    data.audioDurations = [...args.patch.audioDurations];
  }
  if (args.patch.timer) {
    record.timer = args.patch.timer;
  }

  record.revision += 1;
  record.updated_at = Date.now();
  writeRecord(record);

  return { revision: record.revision, data: record.data };
};

export const finishAttempt = async (args: {
  attemptId: string;
  expectedRevision: number;
}): Promise<{ revision: number; data?: TestData }> => {
  const record = await loadAttempt(args.attemptId);
  if (record.revision !== args.expectedRevision) {
    throw new CommandError({
      code: 'revision_conflict',
      message: 'This test changed elsewhere.',
      retryable: false,
      current_revision: record.revision,
    });
  }

  record.status = 'completed';
  try {
    record.data.result = score(record.data);
    record.data.attemptCapture = buildAttemptCapture(record);
    // Generate instant deterministic report without blocking on external LLM calls
    record.data.finalReport = await generateFinalReport(record, undefined, true);
    sanitizeAttemptRecord(record);
  } catch (err) {
    console.warn('[IELTS Studio] Warning during assessment generation:', err);
  }

  record.revision += 1;
  record.updated_at = Date.now();
  writeRecord(record);

  return { revision: record.revision, data: record.data };
};

/** Canonical SHA-256 for envelopes. */
export async function canonicalSha256(envelope: Envelope): Promise<string> {
  const canonical = canonicalize(envelope);
  const bytes = new TextEncoder().encode(JSON.stringify(canonical));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Recursively sort object keys, preserve array order, reject non-finite numbers. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new CommandError({ code: 'bad_number', message: 'Envelope contains a non-finite number.', retryable: false });
  }
  return value;
}
