import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CommandError,
  createAttempt,
  issueRequest,
  commitImport,
  listAttempts,
  loadAttempt,
  startAttempt,
  type AttemptRecord,
  type AttemptSummary,
} from '../lib/attempts.ts';
import { emptyTest, materialComplete } from '../lib/material.ts';
import { guideRequirements } from '../lib/guide-requirements.ts';
import { renderGuide, renderRepair, type RepairError } from '../lib/guide.ts';
import { ActionCounter, stageImport, type ImportFailure, type StagedCandidate } from '../lib/import-pipeline.ts';
import { callProviderChat, loadProviderConfig, type ProviderConfig } from '../lib/providers.ts';
import { AiConnectionModal, AiConnectionStatusPill } from './ai-connection.tsx';
import { Button } from './ui/button.tsx';
import type { ErrorCode, PrepJob, Scope, TestData } from '../lib/types.ts';

const SCOPES: { value: Scope; label: string; part: number }[] = [
  { value: 'full', label: 'Full Mock Test (All 4 Modules)', part: 0 },
  { value: 'listening', label: 'Listening Focus', part: 4 },
  { value: 'reading', label: 'Reading Focus', part: 3 },
  { value: 'writing', label: 'Writing Focus', part: 2 },
  { value: 'speaking', label: 'Speaking Focus', part: 3 },
];


const MAX_AI_REPAIRS = 3;

async function generateAndStageWithRepair({
  testData,
  job,
  attemptId,
  generationId,
  providerConfig,
  promptText,
  onProgress,
}: {
  testData: TestData;
  job: PrepJob;
  attemptId: string;
  generationId: string;
  providerConfig: ProviderConfig;
  promptText: string;
  onProgress?: (msg: string) => void;
}): Promise<{ staged: StagedCandidate; rawOriginal: string }> {
  let currentPrompt = promptText;
  let lastRaw: string | undefined;

  for (let round = 0; round <= MAX_AI_REPAIRS; round++) {
    if (round > 0) {
      onProgress?.(`Repairing ${job.label} with AI (attempt ${round}/${MAX_AI_REPAIRS})...`);
    } else {
      onProgress?.(`Generating ${job.label} via ${providerConfig.model}...`);
    }

    const aiResult = await callProviderChat(currentPrompt, providerConfig);
    lastRaw = aiResult.content;
    onProgress?.(`Validating IELTS criteria for ${job.label}...`);

    try {
      const staged = await stageImport(testData, aiResult.content, {
        attemptId,
        generationId,
      });
      return { staged, rawOriginal: aiResult.content };
    } catch (err) {
      const isLastAttempt = round === MAX_AI_REPAIRS;
      const failureObj = err as ImportFailure;
      const errorMsg = failureObj.message || (err as Error).message || 'Validation failed';

      if (!isLastAttempt) {
        console.warn(`[IELTS Studio] ${job.label} validation error, initiating AI repair round ${round + 1}:`, errorMsg);
        currentPrompt = renderRepair({
          identity: { attempt_id: attemptId, generation_id: generationId },
          job_key: job.key,
          job_label: job.label,
          error: {
            code: (failureObj.code as ErrorCode) || 'parse_failed',
            message: errorMsg,
            path: failureObj.path,
          },
          snapshot: promptText,
          failed_response: lastRaw,
        });
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed to generate valid material for ${job.label} after ${MAX_AI_REPAIRS} repairs.`);
}

export function Preparation({
  initialAttemptId,
  initialRecord,
  onOpenPractice,
  onBack,
  onRecordChange,
}: {
  initialAttemptId?: string;
  initialRecord?: AttemptRecord;
  onOpenPractice?: (attempt: AttemptRecord) => void;
  onBack?: () => void;
  onRecordChange?: (record: AttemptRecord) => void;
} = {}) {
  const [, setSummaries] = useState<AttemptSummary[]>([]);
  const [record, setRecord] = useState<AttemptRecord | null>(initialRecord ?? null);
  const [selectedJobKey, setSelectedJobKey] = useState<string>(initialRecord?.data.jobs?.[0]?.key ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Manual generation/staging states
  const [pasted, setPasted] = useState('');
  const [candidate, setCandidate] = useState<StagedCandidate | null>(null);
  const [failure, setFailure] = useState<ImportFailure | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [manualModalJob, setManualModalJob] = useState<PrepJob | null>(null);
  const [modalCopiedPrompt, setModalCopiedPrompt] = useState(false);
  const [modalCopiedRepair, setModalCopiedRepair] = useState(false);

  // Automated & single pipeline states
  const [singleGeneratingJobKey, setSingleGeneratingJobKey] = useState<string | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [activePipelineJobKey, setActivePipelineJobKey] = useState<string | null>(null);
  const [pipelineStepMessage, setPipelineStepMessage] = useState<string>('');
  const [showAiModal, setShowAiModal] = useState(false);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(loadProviderConfig);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const actions = useRef(new ActionCounter());

  // Escape key handler for manual prompt modal
  useEffect(() => {
    if (!manualModalJob) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setManualModalJob(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [manualModalJob]);

  // Timer for active generation animation
  useEffect(() => {
    let interval: number | null = null;
    if (isGeneratingAll || busy === 'generate') {
      setElapsedSeconds(0);
      interval = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGeneratingAll, busy]);

  const test: TestData | null = record?.data ?? null;
  const jobs: PrepJob[] = useMemo(() => test?.jobs ?? [], [test]);
  const activeJob = jobs.find((j) => j.key === selectedJobKey) ?? jobs[0] ?? null;
  const prepared = test?.prepared ?? [];
  const isComplete = test ? materialComplete(test) : false;

  useEffect(() => {
    if (initialAttemptId && !record) {
      loadAttempt(initialAttemptId)
        .then((rec) => {
          setRecord(rec);
          setSelectedJobKey(rec.data.jobs?.[0]?.key ?? '');
        })
        .catch(() => {
          setError('Could not load requested test.');
        });
    }
  }, [initialAttemptId, record]);

  const lastReportedRef = useRef<{ id: string; revision: number } | null>(null);
  useEffect(() => {
    if (record) {
      if (
        !lastReportedRef.current ||
        lastReportedRef.current.id !== record.id ||
        lastReportedRef.current.revision !== record.revision
      ) {
        lastReportedRef.current = { id: record.id, revision: record.revision };
        onRecordChange?.(record);
      }
    }
  }, [record, onRecordChange]);

  const refresh = useCallback(async () => {
    try {
      setSummaries(await listAttempts());
    } catch {
      setSummaries([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reload = useCallback(async () => {
    if (!record) return;
    const fresh = await loadAttempt(record.id);
    setRecord(fresh);
  }, [record]);

  const guard = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof CommandError) {
        setError(e.isConflict ? 'This test changed elsewhere. Reloading the latest version.' : e.message);
        if (e.isConflict) await reload();
      } else {
        setError((e as Error).message || 'That action could not finish.');
      }
    } finally {
      setBusy(null);
    }
  };

  const create = (scope: Scope, part: number, mode: 'timed' | 'untimed') =>
    guard('create', async () => {
      const meta = providerConfig.enabled
        ? { provider: 'api', model: providerConfig.model || 'gpt-4o', createdAt: Date.now() }
        : { provider: 'manual-copy-paste', model: 'external-chat', createdAt: Date.now() };
      const data = emptyTest(scope, part, 'balanced', meta);
      const created = await createAttempt({ mode, scope, practice_part: part, data });
      setRecord(created);
      setSelectedJobKey(created.data.jobs?.[0]?.key ?? '');
      setCandidate(null);
      setFailure(null);
      setPasted('');
      await refresh();
    });

  // ─── Automated Multi-Step Pipeline: One Button to Generate All ───

  const handleGenerateAll = async () => {
    if (!record || !test || jobs.length === 0) return;

    if (!providerConfig.enabled || !providerConfig.verified) {
      setShowAiModal(true);
      setError('Please configure and verify your AI API connection before generating.');
      return;
    }

    setIsGeneratingAll(true);
    setError(null);
    setNotice(null);

    let currentRecord = record;

    try {
      for (let i = 0; i < jobs.length; i++) {
        const currentJob = jobs[i];
        if (!currentJob) continue;

        // Skip jobs already prepared unless specifically regenerating
        if (currentRecord.data.prepared?.includes(currentJob.key)) {
          continue;
        }

        setActivePipelineJobKey(currentJob.key);
        setPipelineStepMessage(`Preparing step ${i + 1} of ${jobs.length}: ${currentJob.label}...`);

        try {
          // 1. Ensure request snapshot exists
          let currentReq = currentRecord.requests[currentJob.key];
          if (!currentReq) {
            const snapshot = renderGuide(guideRequirements(currentRecord.data, currentJob), {
              attempt_id: currentRecord.id,
              generation_id: 'pending',
            });
            await issueRequest({
              attempt_id: currentRecord.id,
              expected_revision: currentRecord.revision,
              job_key: currentJob.key,
              rotate: false,
              snapshot,
              contract_version: 1,
            });
            currentRecord = await loadAttempt(currentRecord.id);
            currentReq = currentRecord.requests[currentJob.key];
          }

          if (!currentReq) {
            throw new Error(`Failed to issue request for ${currentJob.label}`);
          }

          const promptText = renderGuide(guideRequirements(currentRecord.data, currentJob), {
            attempt_id: currentRecord.id,
            generation_id: currentReq.generation_id,
          });

          // 2. Call AI API with auto-repair
          const { staged, rawOriginal } = await generateAndStageWithRepair({
            testData: currentRecord.data,
            job: currentJob,
            attemptId: currentRecord.id,
            generationId: currentReq.generation_id,
            providerConfig,
            promptText,
            onProgress: setPipelineStepMessage,
          });

          // 3. Commit to local storage DB
          const updated = await commitImport({
            attempt_id: currentRecord.id,
            expected_revision: currentRecord.revision,
            job_key: staged.job.key,
            generation_id: staged.envelope.generation_id,
            data: staged.next,
            sha256: staged.sha256,
            contract_version: 1,
            raw_original: rawOriginal,
            replace_confirmed: true,
          });

          currentRecord = updated;
          setRecord(updated);
          await refresh();
        } catch (jobErr) {
          console.group(`❌ [IELTS Studio] Batch Generation Error on Step ${i + 1}/${jobs.length}: ${currentJob.label} (${currentJob.key})`);
          console.error('Error message:', (jobErr as Error).message);
          console.error('Stack trace:', (jobErr as Error).stack);
          console.debug('Context Details:', {
            jobKey: currentJob.key,
            jobLabel: currentJob.label,
            section: currentJob.section,
            part: currentJob.part,
            attemptId: currentRecord.id,
            revision: currentRecord.revision,
            activeModel: providerConfig.model,
            baseUrl: providerConfig.baseUrl,
          });
          console.groupEnd();
          throw jobErr;
        }
      }

      setNotice('✓ All test materials generated and saved successfully to browser storage!');
    } catch (err) {
      console.error('[IELTS Studio] Batch Generation Pipeline Stopped:', {
        error: (err as Error).message,
        activeStep: activePipelineJobKey,
        provider: providerConfig.baseUrl,
        model: providerConfig.model,
      });
      setError(`Generation paused on ${activePipelineJobKey}: ${(err as Error).message}`);
    } finally {
      setIsGeneratingAll(false);
      setActivePipelineJobKey(null);
      setPipelineStepMessage('');
      await refresh();
    }
  };

  // ─── Single Job Generation ───

  const handleGenerateSingleJob = (targetJob: PrepJob) => {
    setSelectedJobKey(targetJob.key);
    setSingleGeneratingJobKey(targetJob.key);

    return guard('generate', async () => {
      if (!record || !test) return;

      if (!providerConfig.enabled || !providerConfig.verified) {
        setShowAiModal(true);
        setError('Please configure and verify your AI API connection first.');
        return;
      }

      try {
        let currentReq = record.requests[targetJob.key];
        if (!currentReq) {
          const snapshot = renderGuide(guideRequirements(test, targetJob), {
            attempt_id: record.id,
            generation_id: 'pending',
          });
          await issueRequest({
            attempt_id: record.id,
            expected_revision: record.revision,
            job_key: targetJob.key,
            rotate: false,
            snapshot,
            contract_version: 1,
          });
          const fresh = await loadAttempt(record.id);
          setRecord(fresh);
          currentReq = fresh.requests[targetJob.key];
        }

        if (!currentReq) throw new Error('Could not initialize job request.');

        const promptText = renderGuide(guideRequirements(test, targetJob), {
          attempt_id: record.id,
          generation_id: currentReq.generation_id,
        });

        setNotice(`Generating ${targetJob.label}...`);
        const { staged, rawOriginal } = await generateAndStageWithRepair({
          testData: test,
          job: targetJob,
          attemptId: record.id,
          generationId: currentReq.generation_id,
          providerConfig,
          promptText,
          onProgress: setNotice,
        });
        setPasted(rawOriginal);

        const updated = await commitImport({
          attempt_id: record.id,
          expected_revision: record.revision,
          job_key: staged.job.key,
          generation_id: staged.envelope.generation_id,
          data: staged.next,
          sha256: staged.sha256,
          contract_version: 1,
          raw_original: rawOriginal,
          replace_confirmed: true,
        });

        setRecord(updated);
        setNotice(`✓ Saved ${targetJob.label}.`);
        await refresh();
      } catch (err) {
        console.group(`❌ [IELTS Studio] Individual Part Generation Error: ${targetJob.label} (${targetJob.key})`);
        console.error('Failure message:', (err as Error).message);
        console.error('Stack trace:', (err as Error).stack);
        console.debug('Context Details:', {
          targetJob,
          attemptId: record.id,
          revision: record.revision,
          activeModel: providerConfig.model,
          baseUrl: providerConfig.baseUrl,
        });
        console.groupEnd();
        throw err;
      } finally {
        setSingleGeneratingJobKey(null);
      }
    });
  };

  const openManualModal = async (job: PrepJob) => {
    setSelectedJobKey(job.key);
    setManualModalJob(job);
    setCandidate(null);
    setFailure(null);
    setPasted('');
    setConfirmReplace(false);

    if (record && test && !record.requests[job.key]) {
      try {
        const snapshot = renderGuide(guideRequirements(test, job), {
          attempt_id: record.id,
          generation_id: 'pending',
        });
        await issueRequest({
          attempt_id: record.id,
          expected_revision: record.revision,
          job_key: job.key,
          rotate: false,
          snapshot,
          contract_version: 1,
        });
        const fresh = await loadAttempt(record.id);
        setRecord(fresh);
      } catch (err) {
        console.error('[IELTS Studio] Failed to initialize request for manual modal:', err);
      }
    }
  };

  const handleStartPracticeNow = () =>
    guard('start', async () => {
      if (!record || !onOpenPractice) return;
      const started = await startAttempt({
        attemptId: record.id,
        expectedRevision: record.revision,
      });
      const updated = await loadAttempt(record.id);
      onOpenPractice({ ...updated, revision: started.revision, data: started.data });
    });

  // ─── Manual Fallback Handlers ───

  const modalTargetJob = manualModalJob ?? activeJob;
  const modalTargetReq = modalTargetJob && record ? record.requests[modalTargetJob.key] : undefined;

  const handleStageManual = () =>
    guard('validate', async () => {
      if (!test || !modalTargetJob || !record || !modalTargetReq) return;
      const token = actions.current.next();
      setCandidate(null);
      setConfirmReplace(false);
      try {
        const staged = await stageImport(test, pasted, {
          attemptId: record.id,
          generationId: modalTargetReq.generation_id,
        });
        if (!actions.current.isCurrent(token)) return;
        setCandidate(staged);
        setFailure(null);
      } catch (e) {
        if (!actions.current.isCurrent(token)) return;
        console.group(`⚠️ [IELTS Studio] Manual Stage Validation Error for ${modalTargetJob.label}`);
        console.error('Validation failure details:', e);
        console.debug('Pasted input preview:', pasted.slice(0, 500));
        console.groupEnd();
        setCandidate(null);
        setFailure({
          code: (e as ImportFailure).code ?? 'parse_failed',
          message: (e as ImportFailure).message ?? 'Validation failed.',
          path: (e as ImportFailure).path,
          retryable: false,
        });
      }
    });

  const handleCommitManual = () =>
    guard('commit', async () => {
      if (!candidate || !record || !modalTargetJob) return;
      const updated = await commitImport({
        attempt_id: record.id,
        expected_revision: record.revision,
        job_key: candidate.job.key,
        generation_id: candidate.envelope.generation_id,
        data: candidate.next,
        sha256: candidate.sha256,
        contract_version: 1,
        raw_original: pasted,
        replace_confirmed: confirmReplace || prepared.includes(modalTargetJob.key),
      });
      setRecord(updated);
      setCandidate(null);
      setConfirmReplace(false);
      setPasted('');
      setNotice(`✓ Saved ${modalTargetJob.label}. This section is prepared.`);
      setManualModalJob(null);
      await refresh();
    });

  const guideText = useMemo(() => {
    if (!test || !modalTargetJob || !record || !modalTargetReq) return '';
    return renderGuide(guideRequirements(test, modalTargetJob), {
      attempt_id: record.id,
      generation_id: modalTargetReq.generation_id,
    });
  }, [test, modalTargetJob, record, modalTargetReq]);

  const repairText = useMemo(() => {
    if (!failure || !record || !modalTargetJob || !modalTargetReq) return '';
    const err: RepairError = { code: failure.code as RepairError['code'], message: failure.message, path: failure.path };
    return renderRepair({
      identity: { attempt_id: record.id, generation_id: modalTargetReq.generation_id },
      job_key: modalTargetJob.key,
      job_label: modalTargetJob.label,
      error: err,
      snapshot: guideText,
    });
  }, [failure, record, modalTargetJob, modalTargetReq, guideText]);

  // ─── If No Test Record Selected, Show Test Creator ───

  if (!record) {
    return (
      <main style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '32px 24px', maxWidth: '880px', margin: '0 auto' }}>
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack} style={{ marginBottom: '20px' }}>
            ← Back to Dashboard
          </Button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h1 style={{ margin: '0 0 6px 0', fontSize: '26px', fontWeight: 800, color: '#0f172a' }}>
              IELTS Test Preparation
            </h1>
            <p style={{ margin: 0, color: '#64748b', fontSize: '14px' }}>
              Create a new practice attempt and generate verified test suites.
            </p>
          </div>
          <AiConnectionStatusPill onClick={() => setShowAiModal(true)} config={providerConfig} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginTop: '20px' }}>
          {SCOPES.map((s) => (
            <div
              key={s.value}
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
              }}
            >
              <div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                  {s.label}
                </h3>
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }}>
                  {s.value === 'full' ? 'Complete exam simulation with 4 sections, 40 reading & 40 listening questions, 2 writing tasks, and 3 speaking parts.' : `Targeted single-skill training.`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button
                  variant="primary"
                  size="md"
                  disabled={busy !== null}
                  onClick={() => create(s.value, s.part, 'untimed')}
                  style={{ flex: 1 }}
                >
                  Create Test
                </Button>
              </div>
            </div>
          ))}
        </div>

        <AiConnectionModal
          isOpen={showAiModal}
          onClose={() => setShowAiModal(false)}
          onConfigChanged={setProviderConfig}
        />
      </main>
    );
  }

  // ─── Active Preparation with Multi-Step Progress Loading ───

  const completedCount = prepared.length;
  const totalCount = jobs.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <main style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '32px 24px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* Top Navigation Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack}>
            ← Back to Dashboard
          </Button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <AiConnectionStatusPill onClick={() => setShowAiModal(true)} config={providerConfig} />
          {isComplete && (
            <Button variant="success" size="sm" onClick={handleStartPracticeNow}>
              🚀 Start Practice Now
            </Button>
          )}
        </div>
      </div>

      {/* Header & Hero Info */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '24px 28px',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
          marginBottom: '24px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>
                Generating Test: {record.data.scope === 'full' ? 'Full Mock Examination' : `${record.data.scope?.toUpperCase()} Practice`}
              </h1>
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: '9999px',
                  fontSize: '11px',
                  fontWeight: 700,
                  backgroundColor: record.mode === 'timed' ? '#fef3c7' : '#f1f5f9',
                  color: record.mode === 'timed' ? '#92400e' : '#475569',
                }}
              >
                {record.mode === 'timed' ? 'Timed Exam' : 'Unlimited Practice'}
              </span>
            </div>
            <p style={{ margin: '6px 0 0 0', color: '#64748b', fontSize: '14px' }}>
              All generated sections are saved automatically to your local browser storage.
            </p>
          </div>

          {/* ONE BUTTON TO GENERATE ALL */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Button
              variant={isComplete ? 'secondary' : 'primary'}
              size="lg"
              loading={isGeneratingAll}
              disabled={isGeneratingAll || busy !== null}
              onClick={handleGenerateAll}
              title={
                !providerConfig.enabled || !providerConfig.verified
                  ? 'Connect AI API first'
                  : 'Automatically generates and verifies all test sections'
              }
            >
              {isGeneratingAll
                ? 'Generating Pipeline...'
                : isComplete
                  ? '↺ Regenerate All Materials'
                  : '⚡ Generate Complete Test (1-Click)'}
            </Button>

            {isComplete && (
              <Button variant="success" size="lg" onClick={handleStartPracticeNow}>
                Start Practice Now →
              </Button>
            )}
          </div>
        </div>

        {/* Progress Bar & Status */}
        <div style={{ marginTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
              Overall Preparation Progress: {completedCount} of {totalCount} sections ready ({progressPercent}%)
            </span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: progressPercent === 100 ? '#059669' : '#0284c7' }}>
              {isGeneratingAll ? pipelineStepMessage || 'Working...' : progressPercent === 100 ? '✓ Ready for Exam' : 'Waiting to generate'}
            </span>
          </div>

          {/* Track Bar with Shimmer Animation */}
          <div
            style={{
              width: '100%',
              height: '10px',
              backgroundColor: '#f1f5f9',
              borderRadius: '9999px',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                backgroundColor: progressPercent === 100 ? '#10b981' : '#2563eb',
                backgroundImage:
                  isGeneratingAll || busy === 'generate'
                    ? 'linear-gradient(90deg, #2563eb 0%, #60a5fa 50%, #2563eb 100%)'
                    : undefined,
                backgroundSize: isGeneratingAll || busy === 'generate' ? '200% 100%' : undefined,
                animation: isGeneratingAll || busy === 'generate' ? 'ielts-shimmer-track 1.8s linear infinite' : undefined,
                transition: 'width 0.4s ease-in-out',
              }}
            />
          </div>
        </div>

        {/* Dynamic Generation Animation Banner */}
        {(isGeneratingAll || busy === 'generate') && (
          <div
            style={{
              marginTop: '20px',
              padding: '18px 22px',
              borderRadius: '12px',
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '16px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Shimmer backdrop effect */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent)',
                animation: 'ielts-shimmer 2.2s infinite',
                pointerEvents: 'none',
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', zIndex: 1 }}>
              {/* Pulsing Beacon Circle */}
              <div
                style={{
                  position: 'relative',
                  width: '42px',
                  height: '42px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    backgroundColor: '#3b82f6',
                    animation: 'ielts-ripple 2s cubic-bezier(0, 0.2, 0.8, 1) infinite',
                    opacity: 0.6,
                  }}
                />
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#1d4ed8',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    fontWeight: 800,
                    boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                    zIndex: 2,
                  }}
                >
                  ⚡
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <strong style={{ fontSize: '14px', color: '#1e3a8a' }}>
                    {isGeneratingAll ? 'IELTS Test Material Generation in Progress' : 'Generating Section Material'}
                  </strong>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      backgroundColor: '#dbeafe',
                      color: '#1e40af',
                    }}
                  >
                    Elapsed: {elapsedSeconds}s
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#2563eb', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>
                    {pipelineStepMessage ||
                      (busy === 'generate' && singleGeneratingJobKey
                        ? `Synthesizing ${jobs.find((j) => j.key === singleGeneratingJobKey)?.label || 'section'} via ${providerConfig.model}...`
                        : `Synthesizing authentic Cambridge-standard content via ${providerConfig.model}...`)}
                  </span>
                  <span style={{ display: 'inline-flex', gap: '2px', fontWeight: 700 }}>
                    <span style={{ animation: 'ielts-bounce 1.4s infinite ease-in-out' }}>.</span>
                    <span style={{ animation: 'ielts-bounce 1.4s infinite ease-in-out 0.2s' }}>.</span>
                    <span style={{ animation: 'ielts-bounce 1.4s infinite ease-in-out 0.4s' }}>.</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Animated Equalizer Wave Bars */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '24px', zIndex: 1 }}>
              {[0, 0.15, 0.3, 0.45, 0.6].map((delay, idx) => (
                <div
                  key={idx}
                  style={{
                    width: '4px',
                    backgroundColor: '#2563eb',
                    borderRadius: '2px',
                    animation: 'ielts-wave-bar 1.2s ease-in-out infinite alternate',
                    animationDelay: `${delay}s`,
                    minHeight: '6px',
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Feedback banners */}
        {error && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 16px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              color: '#991b1b',
              fontSize: '13px',
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {notice && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 16px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              color: '#166534',
              fontSize: '13px',
            }}
          >
            {notice}
          </div>
        )}
      </div>

      {/* Multi-Step Pipeline Section List */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', marginBottom: '14px' }}>
          Test Section Pipeline
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {jobs.map((j, idx) => {
            const isJobPrepared = prepared.includes(j.key);
            const isCurrentlyGenerating =
              (isGeneratingAll && activePipelineJobKey === j.key) ||
              (busy === 'generate' && singleGeneratingJobKey === j.key);

            return (
              <div
                key={j.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  borderRadius: '12px',
                  backgroundColor: isCurrentlyGenerating ? '#f0f9ff' : isJobPrepared ? '#ffffff' : '#f8fafc',
                  border: isCurrentlyGenerating
                    ? '2px solid #2563eb'
                    : isJobPrepared
                      ? '1px solid #cbd5e1'
                      : '1px solid #e2e8f0',
                  boxShadow: isCurrentlyGenerating ? '0 4px 14px rgba(37, 99, 235, 0.16)' : '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
                  animation: isCurrentlyGenerating ? 'ielts-pulse-glow 1.8s infinite ease-in-out' : undefined,
                  cursor: 'default',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Step Info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  {/* Step status circle */}
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '13px',
                      fontWeight: 700,
                      backgroundColor: isJobPrepared ? '#dcfce7' : isCurrentlyGenerating ? '#2563eb' : '#e2e8f0',
                      color: isJobPrepared ? '#15803d' : isCurrentlyGenerating ? '#ffffff' : '#64748b',
                    }}
                  >
                    {isCurrentlyGenerating ? (
                      <span
                        style={{
                          width: '14px',
                          height: '14px',
                          border: '2px solid #ffffff',
                          borderRightColor: 'transparent',
                          borderRadius: '50%',
                          display: 'inline-block',
                          animation: 'btn-spin 0.6s linear infinite',
                        }}
                      />
                    ) : isJobPrepared ? (
                      '✓'
                    ) : (
                      idx + 1
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
                        {j.label}
                      </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                      {j.section === 'listening'
                        ? 'Dialogue script, timing & 10 questions'
                        : j.section === 'reading'
                          ? 'Academic passage (750-900 words) & 13-14 questions'
                          : j.section === 'writing'
                            ? 'Task 1 visual data report & Task 2 academic essay'
                            : 'Three speaking parts with cues & rubric'}
                    </div>
                  </div>
                </div>

                {/* Right Actions / Status */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: '9999px',
                      fontSize: '11px',
                      fontWeight: 600,
                      backgroundColor: isJobPrepared ? '#ecfdf5' : isCurrentlyGenerating ? '#dbeafe' : '#f1f5f9',
                      color: isJobPrepared ? '#065f46' : isCurrentlyGenerating ? '#1e40af' : '#64748b',
                    }}
                  >
                    {isCurrentlyGenerating ? 'Generating...' : isJobPrepared ? 'Saved to Browser DB' : 'Queued'}
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isGeneratingAll || (busy === 'generate' && singleGeneratingJobKey === j.key)}
                    onClick={() => void openManualModal(j)}
                    title={`View official prompt or paste response manually for ${j.label}`}
                  >
                    Manual Prompt
                  </Button>

                  <Button
                    variant={isJobPrepared ? 'outline' : 'primary'}
                    size="sm"
                    disabled={isGeneratingAll || busy !== null}
                    onClick={() => void handleGenerateSingleJob(j)}
                  >
                    {isCurrentlyGenerating ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <span
                          style={{
                            width: '12px',
                            height: '12px',
                            border: '2px solid currentColor',
                            borderRightColor: 'transparent',
                            borderRadius: '50%',
                            display: 'inline-block',
                            animation: 'btn-spin 0.6s linear infinite',
                          }}
                        />
                        Generating...
                      </span>
                    ) : isJobPrepared ? (
                      'Regenerate'
                    ) : (
                      'Generate'
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Advanced Manual Prompt & Validation Modal */}
      {manualModalJob && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            animation: 'fadeIn 0.15s ease-out',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setManualModalJob(null);
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              width: '100%',
              maxWidth: '740px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              animation: 'scaleIn 0.15s ease-out',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: '6px',
                    backgroundColor: '#eff6ff',
                    color: '#1d4ed8',
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {manualModalJob.section}
                </span>
                <h3
                  id="manual-modal-title"
                  style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}
                >
                  {manualModalJob.label}: Manual Prompt & Import
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setManualModalJob(null)}
                aria-label="Close modal"
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  color: '#64748b',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  borderRadius: '6px',
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <p style={{ margin: 0, fontSize: '13px', color: '#475569', lineHeight: 1.5 }}>
                Use this option to generate with any external AI chat interface (e.g. ChatGPT, Claude, Gemini web, DeepSeek). Copy the official item-writer prompt below, submit it to your AI model, and paste the exact JSON envelope response back here to validate and commit.
              </p>

              {/* Step 1: Prompt Box */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                    1. Official Cambridge-Format Generation Prompt
                  </label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (guideText) {
                        navigator.clipboard.writeText(guideText);
                        setModalCopiedPrompt(true);
                        setTimeout(() => setModalCopiedPrompt(false), 2200);
                      }
                    }}
                  >
                    {modalCopiedPrompt ? '✓ Copied to Clipboard!' : '📋 Copy Prompt'}
                  </Button>
                </div>
                <div
                  style={{
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '12px 14px',
                    maxHeight: '130px',
                    overflowY: 'auto',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: '11px',
                    lineHeight: 1.45,
                    color: '#334155',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {guideText || 'Preparing generation prompt specifications...'}
                </div>
              </div>

              {/* Step 2: Paste Area */}
              <div>
                <label
                  htmlFor="modal-pasted-json"
                  style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '8px' }}
                >
                  2. Paste Model Output (JSON Envelope)
                </label>
                <textarea
                  id="modal-pasted-json"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="Paste the raw JSON output here (must include attempt_id, generation_id, and data)..."
                  rows={7}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '12px',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    boxSizing: 'border-box',
                    lineHeight: 1.4,
                    color: '#0f172a',
                    backgroundColor: '#ffffff',
                  }}
                />
              </div>

              {/* Validation Feedback */}
              {failure && (
                <div
                  style={{
                    padding: '14px 16px',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    color: '#991b1b',
                    fontSize: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div>
                    <strong>❌ Validation Error:</strong> {failure.message} (<code>{failure.code}</code>)
                  </div>
                  {failure.path && (
                    <div>
                      Target field: <code>{failure.path}</code>
                    </div>
                  )}
                  {repairText && (
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(repairText);
                          setModalCopiedRepair(true);
                          setTimeout(() => setModalCopiedRepair(false), 2200);
                        }}
                      >
                        {modalCopiedRepair ? '✓ Repair Request Copied!' : 'Copy Repair Prompt for Model'}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {candidate && (
                <div
                  style={{
                    padding: '12px 16px',
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px',
                    color: '#166534',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  ✓ JSON envelope passed all Cambridge schema and answer validation tests. Click &quot;Commit &amp; Save Section&quot; below.
                </div>
              )}

              {prepared.includes(manualModalJob.key) && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '12px',
                    color: '#64748b',
                  }}
                >
                  <input
                    type="checkbox"
                    id="modal-confirm-replace"
                    checked={confirmReplace}
                    onChange={(e) => setConfirmReplace(e.target.checked)}
                  />
                  <label htmlFor="modal-confirm-replace">
                    This section already has saved content. Check to confirm overwriting it.
                  </label>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid #e2e8f0',
                backgroundColor: '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Button variant="ghost" size="sm" onClick={() => setManualModalJob(null)}>
                Close
              </Button>
              <div style={{ display: 'flex', gap: '10px' }}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null || !pasted.trim()}
                  onClick={handleStageManual}
                >
                  {busy === 'validate' ? 'Validating...' : 'Validate JSON'}
                </Button>
                {candidate && (
                  <Button
                    variant="success"
                    size="sm"
                    disabled={busy !== null || (prepared.includes(manualModalJob.key) && !confirmReplace)}
                    onClick={handleCommitManual}
                  >
                    {busy === 'commit' ? 'Saving...' : '✓ Commit & Save Section'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Connection Modal */}
      <AiConnectionModal
        isOpen={showAiModal}
        onClose={() => setShowAiModal(false)}
        onConfigChanged={setProviderConfig}
      />

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { transform: scale(0.96); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes ielts-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes ielts-shimmer-track {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes ielts-pulse-glow {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.4);
            border-color: #2563eb;
          }
          50% {
            box-shadow: 0 0 0 6px rgba(37, 99, 235, 0);
            border-color: #60a5fa;
          }
        }
        @keyframes ielts-ripple {
          0% {
            transform: scale(0.85);
            opacity: 0.8;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }
        @keyframes ielts-wave-bar {
          0% { height: 6px; }
          100% { height: 22px; }
        }
        @keyframes ielts-bounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-4px); }
        }
      `}</style>
    </main>
  );
}
