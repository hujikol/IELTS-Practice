// §3.1 typed calls into native commands. The UI never writes files or reads app data
// directly: every state change goes through an allowlisted command that re-checks
// revision, lifecycle and identity on the native side.

import { invoke } from '@tauri-apps/api/core';
import { isValidationError, type Envelope, type TestData } from './types.ts';

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
};

export type AttemptRecord = {
  id: string;
  owner_id: 'local';
  created_at: number;
  updated_at: number;
  revision: number;
  mode: string;
  status: 'preparing' | 'active' | 'completed';
  data: TestData;
  requests: Record<string, { generation_id: string; issued_at: number; snapshot: string }>;
  imports: Record<string, { sha256: string; original_path: string; generation_id: string }>;
  import_history: Record<string, unknown[]>;
};

export type IssuedRequest = { generationId: string; snapshot: string; rotated: boolean; revision: number };

export type CreateAttemptInput = {
  mode: 'timed' | 'untimed';
  scope: 'full' | 'listening' | 'reading' | 'writing' | 'speaking';
  practice_part: number;
  focus_skill?: string;
  /** App-built draft. Native overwrites id/owner/timestamps/revision. */
  data: TestData;
};

export class CommandError extends Error {
  /** Native codes (store/lifecycle/identity) are a wider set than the renderer's
   *  ErrorCode union, which covers only material and parse failures. */
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
  /** §19 a revision conflict means reload, never apply a stale snapshot. */
  get isConflict(): boolean {
    return this.code === 'revision_conflict';
  }
}

const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return (await invoke(cmd, args)) as T;
  } catch (e) {
    if (isValidationError(e)) throw new CommandError(e.toAppError());
    const raw = e as { code?: string; message?: string; retryable?: boolean };
    // A raw internal message must never reach the user. Anything that is not a
    // structured native error — including a missing IPC bridge — becomes plain text.
    const code = typeof raw.code === 'string' && raw.code.length > 0 ? raw.code : undefined;
    throw new CommandError({
      code: code ?? 'store_unavailable',
      message: code
        ? String(raw.message ?? 'That action could not finish.')
        : 'Local storage is unavailable. This action only works inside the desktop app.',
      retryable: code ? (raw.retryable ?? true) : false,
    });
  }
};

export const listAttempts = (): Promise<AttemptSummary[]> => call('list_attempts');

export const loadAttempt = (attemptId: string): Promise<AttemptRecord> =>
  call('load_attempt', { attemptId });

export const createAttempt = (input: CreateAttemptInput): Promise<AttemptRecord> =>
  call('create_attempt', { args: { attempt: { ...input, id: '', owner_id: 'local', created_at: 0, updated_at: 0, revision: 0, status: 'preparing', requests: {}, imports: {}, import_history: {} } } });

export const deleteAttempt = (attemptId: string): Promise<void> =>
  call('delete_attempt', { attemptId });

/** Copy and repair reuse the issued snapshot; only rotate replaces it. */
export const issueRequest = (args: {
  attempt_id: string;
  expected_revision: number;
  job_key: string;
  rotate: boolean;
  snapshot: string;
  contract_version: number;
}): Promise<IssuedRequest> => call('issue_request', { args });

export const commitImport = (args: {
  attempt_id: string;
  expected_revision: number;
  job_key: string;
  generation_id: string;
  data: unknown;
  sha256: string;
  contract_version: number;
  raw_original: string;
  replace_confirmed: boolean;
}): Promise<AttemptRecord> => call('commit_import', { args });

/** §18.3 canonical hashing happens before normalized application adds ids/defaults. */
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
