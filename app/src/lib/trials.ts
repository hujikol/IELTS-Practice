// §9.1 real-generation trial harness.
//
// This does NOT generate material. It renders the guide for a real job, validates a
// real pasted response, and records what happened so the gate can be judged on
// evidence rather than optimism.
//
// The distinction matters: a fixture accepted by a validator proves the validator
// works. It proves nothing about what a model actually emits. Only a response that
// came back from a real chat counts toward the P1-08 gate.

import { emptyTest } from './material.ts';
import { guideRequirements } from './guide-requirements.ts';
import { renderGuide } from './guide.ts';
import { stageImport } from './import-pipeline.ts';
import { ValidationError, type PrepJob, type Scope, type TestData } from './types.ts';

export type TrialOutcome = {
  job_key: string;
  job_label: string;
  /** Model label as reported by the human, e.g. "ChatGPT GPT-5, 2026-10-02". */
  chat_label: string;
  prompt_contract_version: number;
  prompt_chars: number;
  response_chars: number;
  /** null when the response imported cleanly. */
  error_code: string | null;
  error_message: string | null;
  /** How many repair rounds this job consumed, counted by the human. */
  repair_rounds: number;
  imported: boolean;
  /** §9.1 human review is a separate gate from software acceptance. */
  human_reviewed: boolean;
  human_notes: string;
};

const GEN = { provider: 'manual-copy-paste', model: 'external-chat', createdAt: 0 };

export type TrialSession = {
  attemptId: string;
  generationId: string;
  test: TestData;
  outcomes: TrialOutcome[];
};

export function newTrialSession(attemptId: string, scope: Scope = 'full', part = 1): TrialSession {
  return {
    attemptId,
    generationId: 'set-by-the-app',
    test: emptyTest(scope, part, 'balanced', GEN, 1),
    outcomes: [],
  };
}

/** Render the exact prompt a human should paste into a chat. */
export function trialPrompt(session: TrialSession, job: PrepJob): string {
  return renderGuide(guideRequirements(session.test, job), {
    attempt_id: session.attemptId,
    generation_id: session.generationId,
  });
}

export type TrialResult =
  | { ok: true; outcome: TrialOutcome; next: TestData }
  | { ok: false; outcome: TrialOutcome };

/**
 * Validate one real response and record the outcome. Never throws: a trial exists to
 * capture failures, not to propagate them.
 */
export async function recordTrial(
  session: TrialSession,
  job: PrepJob,
  prompt: string,
  response: string,
  meta: { chat_label: string; repair_rounds: number },
): Promise<TrialResult> {
  const base: TrialOutcome = {
    job_key: job.key,
    job_label: job.label,
    chat_label: meta.chat_label,
    prompt_contract_version: 1,
    prompt_chars: prompt.length,
    response_chars: response.length,
    error_code: null,
    error_message: null,
    repair_rounds: meta.repair_rounds,
    imported: false,
    human_reviewed: false,
    human_notes: '',
  };

  try {
    const staged = await stageImport(session.test, response, {
      attemptId: session.attemptId,
      generationId: session.generationId,
    });
    const outcome: TrialOutcome = { ...base, imported: true };
    session.outcomes.push(outcome);
    return { ok: true, outcome, next: staged.next };
  } catch (e) {
    const code = e instanceof ValidationError ? e.code : String((e as { code?: string }).code ?? 'unknown');
    const message = e instanceof Error ? e.message : String(e);
    const outcome: TrialOutcome = { ...base, error_code: code, error_message: message };
    session.outcomes.push(outcome);
    return { ok: false, outcome };
  }
}

export type GateReport = {
  total: number;
  imported: number;
  failed: number;
  unverified: number;
  maxRepairs: number;
  ready: boolean;
  blockers: string[];
};

const MAX_REPAIRS = 2;

export function gateReport(session: TrialSession): GateReport {
  const outcomes = session.outcomes;
  const failed = outcomes.filter((o) => !o.imported);
  const unverified = outcomes.filter((o) => o.imported && !o.human_reviewed);
  const overBudget = failed.filter((o) => o.repair_rounds > MAX_REPAIRS);
  const blockers: string[] = [];

  if (outcomes.length === 0) blockers.push('No trials recorded. §9.1 requires real responses.');
  if (overBudget.length > 0) {
    blockers.push(`${overBudget.length} job(s) exceeded the ${MAX_REPAIRS}-repair evaluation budget.`);
  }
  if (unverified.length > 0) {
    blockers.push(`${unverified.length} imported job(s) still need human answer-key review.`);
  }
  if (failed.length > 0) {
    blockers.push(`${failed.length} job(s) failed to import: ${[...new Set(failed.map((f) => f.error_code))].join(', ')}.`);
  }

  return {
    total: outcomes.length,
    imported: outcomes.filter((o) => o.imported).length,
    failed: failed.length,
    unverified: unverified.length,
    maxRepairs: outcomes.reduce((n, o) => Math.max(n, o.repair_rounds), 0),
    ready: outcomes.length > 0 && failed.length === 0 && unverified.length === 0,
    blockers,
  };
}

/** Redacted summary safe to commit. Never contains student text or full responses. */
export function renderEvidence(session: TrialSession): string {
  const gate = gateReport(session);
  const rows = session.outcomes
    .map(
      (o) =>
        `| ${o.job_key} | ${o.chat_label} | ${o.prompt_chars} | ${o.response_chars} | ${o.error_code ?? 'imported'} | ${o.repair_rounds} | ${o.human_reviewed ? 'yes' : 'NO'} |`,
    )
    .join('\n');
  return [
    '# Phase 1 evidence — real generation trials',
    '',
    'Generated by the §9.1 harness. Contains no student text and no full model responses.',
    '',
    `- Trials: ${gate.total}`,
    `- Imported: ${gate.imported}`,
    `- Failed: ${gate.failed}`,
    `- Awaiting human review: ${gate.unverified}`,
    `- Gate ready: ${gate.ready ? 'yes' : 'no'}`,
    '',
    gate.blockers.length ? `## Blockers\n\n${gate.blockers.map((b) => `- ${b}`).join('\n')}\n` : 'No blockers.\n',
    '| job | chat/model | prompt chars | response chars | outcome | repairs | human reviewed |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    rows || '| _no trials yet_ | | | | | | |',
  ].join('\n');
}
