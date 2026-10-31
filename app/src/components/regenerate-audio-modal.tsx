import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button.tsx';
import {
  TTS_MODELS,
  getTtsModelPreference,
  setTtsModelPreference,
  downloadAndRegenerateAllVoices,
  type TtsModelType,
} from '../lib/audio-manager.ts';
import type { VoiceMapEntry } from '../lib/voices.ts';

export interface RegenerateAudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  listeningBlocks: { script?: { speaker?: string; text?: string }[] }[];
  voiceMap: Record<string, VoiceMapEntry>;
  cachedLines: number;
  totalLines: number;
  isModelCached: boolean;
}

/**
 * Modal shown when starting a practice test but local neural voices and/or model
 * weights have been deleted or cleared from the browser cache.
 * Prompts the learner to re-download the model and synthesize all audio tracks locally,
 * or switch to native Web Speech API for instant playback.
 */
export function RegenerateAudioModal({
  isOpen,
  onClose,
  onComplete,
  listeningBlocks,
  voiceMap,
  cachedLines,
  totalLines,
  isModelCached,
}: RegenerateAudioModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const actionBtnRef = useRef<HTMLButtonElement | null>(null);

  const [selectedModel, setSelectedModel] = useState<TtsModelType>(getTtsModelPreference);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stage, setStage] = useState<'idle' | 'downloading' | 'synthesizing' | 'done' | 'error'>('idle');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedModel(getTtsModelPreference());
      setStage('idle');
      setProgressPercent(0);
      setProgressMessage('');
      setErrorMessage(null);
      setIsGenerating(false);
    }
  }, [isOpen]);

  // Focus management and keyboard dismiss
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      actionBtnRef.current?.focus();
    }, 60);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isGenerating) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose, isGenerating]);

  if (!isOpen) return null;

  const currentInfo = TTS_MODELS[selectedModel];
  const modelKeys = (Object.keys(TTS_MODELS) as TtsModelType[]).filter((k) => k !== 'webspeech');

  const handleStartRegeneration = async () => {
    setIsGenerating(true);
    setErrorMessage(null);
    setTtsModelPreference(selectedModel);

    try {
      await downloadAndRegenerateAllVoices(
        listeningBlocks,
        voiceMap,
        (currentStage, progress, message) => {
          setStage(currentStage);
          setProgressPercent(progress);
          setProgressMessage(message);
        },
        selectedModel,
      );

      setStage('done');
      setProgressPercent(100);
      setProgressMessage('✓ Audio synthesis complete! Launching exam session...');

      // Short delay so the user sees the 100% completion badge before transition
      setTimeout(() => {
        setIsGenerating(false);
        onComplete();
      }, 750);
    } catch (err) {
      console.error('[IELTS Studio] Audio regeneration error:', err);
      setStage('error');
      setIsGenerating(false);
      setErrorMessage((err as Error).message || 'Failed to download model or synthesize audio.');
    }
  };

  const handleUseWebSpeech = () => {
    setTtsModelPreference('webspeech');
    onComplete();
  };

  return (
    <div
      role="presentation"
      onClick={() => {
        if (!isGenerating) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(5px)',
        WebkitBackdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        padding: '16px',
        animation: 'modalFadeIn 0.18s ease-out',
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="regen-audio-title"
        aria-describedby="regen-audio-desc"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '28px 30px',
          maxWidth: '580px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.14), 0 10px 10px -5px rgba(15, 23, 42, 0.05)',
          border: '1px solid #e2e8f0',
          position: 'relative',
          maxHeight: '92vh',
          overflowY: 'auto',
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          color: '#0f172a',
        }}
      >
        {/* Header Alert Pill */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#fffbeb',
              color: '#b45309',
              border: '1px solid #fde68a',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
            }}
          >
            <span>⚠️</span>
            <span>Local Audio Cache Missing</span>
          </span>

          {!isGenerating && (
            <button
              type="button"
              aria-label="Cancel and close"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '20px',
                color: '#64748b',
                cursor: 'pointer',
                lineHeight: 1,
                padding: '4px',
              }}
            >
              ✕
            </button>
          )}
        </div>

        <h2
          id="regen-audio-title"
          style={{
            margin: '0 0 8px',
            fontSize: '1.35rem',
            fontWeight: 800,
            color: '#0f172a',
            letterSpacing: '-0.015em',
          }}
        >
          Generate Local Voice Tracks
        </h2>

        <p
          id="regen-audio-desc"
          style={{
            margin: '0 0 18px',
            fontSize: '0.9rem',
            color: '#475569',
            lineHeight: 1.5,
          }}
        >
          You are starting a test with listening audio, but the neural voice audio clips or model weights were deleted or cleared from your browser cache.
          Download the model and generate the audio clips now to ensure smooth playback during your practice exam.
        </p>

        {/* Missing Cache Diagnostic Card */}
        <div
          style={{
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '14px 16px',
            marginBottom: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Neural TTS Model:</span>
            <span style={{ fontWeight: 700, color: isModelCached ? '#15803d' : '#b45309' }}>
              {isModelCached ? '✓ Cached in Browser' : '❌ Missing from Cache (Needs Download)'}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Listening Audio Clips:</span>
            <span style={{ fontWeight: 700, color: cachedLines === totalLines && totalLines > 0 ? '#15803d' : '#b45309' }}>
              {cachedLines} of {totalLines} clips ready ({totalLines - cachedLines} missing)
            </span>
          </div>
        </div>

        {/* Model Selection Dropdown (Only shown when not generating) */}
        {!isGenerating && stage !== 'done' && (
          <div style={{ marginBottom: '22px' }}>
            <label
              htmlFor="regen-model-select"
              style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}
            >
              Choose Neural TTS Model to Download &amp; Use:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
              {modelKeys.map((key) => {
                const info = TTS_MODELS[key];
                const isSelected = selectedModel === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedModel(key)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                      backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                      textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    <span style={{ fontSize: '12px', fontWeight: 700, color: isSelected ? '#1e40af' : '#0f172a' }}>
                      {info.badge}
                    </span>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>
                      📦 {info.downloadSize}
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: '11.5px', color: '#64748b', marginTop: '6px' }}>
              Selected: <strong>{currentInfo.name}</strong> ({currentInfo.downloadSize}). {currentInfo.bestFor}
            </div>
          </div>
        )}

        {/* Live Progress Bar & Status (Shown when generating) */}
        {isGenerating && (
          <div style={{ marginBottom: '22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#1e40af' }}>
                {stage === 'downloading' ? '1/2 Downloading Model Weights' : '2/2 Synthesizing Audio Tracks'}
              </span>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#2563eb' }}>
                {progressPercent}%
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
                marginBottom: '8px',
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  backgroundColor: progressPercent === 100 ? '#10b981' : '#2563eb',
                  backgroundImage:
                    progressPercent < 100
                      ? 'linear-gradient(90deg, #2563eb 0%, #60a5fa 50%, #2563eb 100%)'
                      : undefined,
                  backgroundSize: '200% 100%',
                  animation: progressPercent < 100 ? 'ielts-shimmer-track 1.8s linear infinite' : undefined,
                  transition: 'width 0.3s ease-out',
                }}
              />
            </div>

            <p style={{ margin: 0, fontSize: '12px', color: '#475569', fontStyle: 'italic' }}>
              {progressMessage || 'Working...'}
            </p>
          </div>
        )}

        {/* Error Notice */}
        {errorMessage && (
          <div
            role="alert"
            style={{
              padding: '10px 14px',
              backgroundColor: '#fff1f2',
              border: '1px solid #fecdd3',
              borderRadius: '8px',
              color: '#be123c',
              fontSize: '12.5px',
              marginBottom: '18px',
            }}
          >
            ⚠️ {errorMessage}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '10px' }}>
          <Button
            ref={actionBtnRef}
            variant="primary"
            size="lg"
            loading={isGenerating}
            onClick={handleStartRegeneration}
            icon="🎙️"
          >
            {isGenerating
              ? 'Synthesizing Voices...'
              : `Download Model & Generate Voices (${currentInfo.downloadSize}) →`}
          </Button>

          {!isGenerating && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={handleUseWebSpeech}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#475569',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'underline',
                }}
              >
                Instant Start: Use Native Web Speech (0 MB download) →
              </button>

              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes ielts-shimmer-track {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}

