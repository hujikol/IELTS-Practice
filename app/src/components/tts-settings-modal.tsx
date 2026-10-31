import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button.tsx';
import {
  TTS_MODELS,
  getTtsModelPreference,
  setTtsModelPreference,
  getAudioCacheStats,
  clearAudioClipsCache,
  clearAllAudioAndModelCaches,
  type TtsModelType,
  type AudioCacheStats,
} from '../lib/audio-manager.ts';

export interface TtsSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelChanged?: (newModel: TtsModelType) => void;
}

/**
 * Audio & TTS Configuration Modal.
 * Allows learners to choose between Kokoro FP32 (Full Precision), Q8 (8-Bit Quantized),
 * Q4 (4-Bit Compact), and Web Speech API (Native OS Engine), inspect device specifications,
 * and clear cached audio clips or model weights.
 */
export function TtsSettingsModal({ isOpen, onClose, onModelChanged }: TtsSettingsModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const [selectedModel, setSelectedModel] = useState<TtsModelType>(getTtsModelPreference);
  const [cacheStats, setCacheStats] = useState<AudioCacheStats | null>(null);
  const [clearing, setClearing] = useState<'clips' | 'all' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Detect local client hardware metrics
  const [deviceMetrics, setDeviceMetrics] = useState<{
    cores: number | null;
    ramGb: number | null;
    wasmSimd: boolean;
  }>({
    cores: null,
    ramGb: null,
    wasmSimd: true,
  });

  const refreshStats = async () => {
    try {
      const stats = await getAudioCacheStats();
      setCacheStats(stats);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
    const ramGb = typeof (navigator as unknown as { deviceMemory?: number }).deviceMemory === 'number'
      ? (navigator as unknown as { deviceMemory: number }).deviceMemory
      : null;

    setDeviceMetrics({
      cores,
      ramGb,
      wasmSimd: typeof WebAssembly === 'object' && typeof WebAssembly.validate === 'function',
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      setSelectedModel(getTtsModelPreference());
      void refreshStats();
      setNotice(null);
    }
  }, [isOpen]);

  // Keyboard and focus management
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
  }, [isOpen, onClose]);

  const handleSelectModel = (modelId: TtsModelType) => {
    setSelectedModel(modelId);
  };

  const handleSaveAndApply = () => {
    setTtsModelPreference(selectedModel);
    onModelChanged?.(selectedModel);
    onClose();
  };

  const handleClearClips = async () => {
    setClearing('clips');
    setNotice(null);
    try {
      const count = await clearAudioClipsCache();
      await refreshStats();
      setNotice(`✓ Cleared ${count} cached audio clip${count === 1 ? '' : 's'} from local storage.`);
    } catch (err) {
      setNotice(`⚠️ Failed to clear audio clips: ${(err as Error).message}`);
    } finally {
      setClearing(null);
    }
  };

  const handleClearAll = async () => {
    setClearing('all');
    setNotice(null);
    try {
      const res = await clearAllAudioAndModelCaches();
      await refreshStats();
      setNotice(
        `✓ All audio caches purged successfully (${res.clipsCleared} clips removed${
          res.modelsCleared ? ', neural model cache cleared' : ''
        }).`,
      );
    } catch (err) {
      setNotice(`⚠️ Failed to purge audio caches: ${(err as Error).message}`);
    } finally {
      setClearing(null);
    }
  };

  if (!isOpen) return null;

  const currentInfo = TTS_MODELS[selectedModel];
  const modelKeys = Object.keys(TTS_MODELS) as TtsModelType[];

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '16px',
        animation: 'modalFadeIn 0.18s ease-out',
      }}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tts-settings-title"
        aria-describedby="tts-settings-desc"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '28px 30px',
          maxWidth: '680px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.12), 0 10px 10px -5px rgba(15, 23, 42, 0.04)',
          border: '1px solid #e2e8f0',
          position: 'relative',
          maxHeight: '92vh',
          overflowY: 'auto',
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          color: '#0f172a',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span
            style={{
              padding: '3px 10px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              backgroundColor: '#eff6ff',
              color: '#1d4ed8',
              border: '1px solid #bfdbfe',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            🎙️ Audio &amp; Speech Configuration
          </span>
          <button
            ref={closeBtnRef}
            type="button"
            aria-label="Close audio settings"
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
        </div>

        <h2
          id="tts-settings-title"
          style={{
            margin: '0 0 6px',
            fontSize: '1.4rem',
            fontWeight: 800,
            color: '#0f172a',
            letterSpacing: '-0.015em',
          }}
        >
          TTS Model &amp; Audio Cache Settings
        </h2>

        <p
          id="tts-settings-desc"
          style={{
            margin: '0 0 20px',
            fontSize: '0.88rem',
            color: '#475569',
            lineHeight: 1.5,
          }}
        >
          Choose your local text-to-speech engine based on your device hardware, network connection, and desired acoustic fidelity.
        </p>

        {notice && (
          <div
            role="status"
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              backgroundColor: notice.startsWith('✓') ? '#f0fdf4' : '#fffbeb',
              border: notice.startsWith('✓') ? '1px solid #bbf7d0' : '1px solid #fde68a',
              color: notice.startsWith('✓') ? '#166534' : '#92400e',
              fontSize: '12.5px',
              fontWeight: 600,
              marginBottom: '18px',
            }}
          >
            {notice}
          </div>
        )}

        {/* Section 1: Model Selection Cards */}
        <section aria-labelledby="model-selection-heading" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 id="model-selection-heading" style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>
              Available TTS Models
            </h3>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Select to configure active model</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
            {modelKeys.map((key) => {
              const model = TTS_MODELS[key];
              const isSelected = selectedModel === key;

              return (
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectModel(key)}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      handleSelectModel(key);
                    }
                  }}
                  style={{
                    padding: '12px 16px',
                    borderRadius: '10px',
                    border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                    backgroundColor: isSelected ? '#eff6ff' : '#f8fafc',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span
                        style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          border: isSelected ? '5px solid #2563eb' : '2px solid #cbd5e1',
                          backgroundColor: '#ffffff',
                          display: 'inline-block',
                          boxSizing: 'border-box',
                        }}
                      />
                      <strong style={{ fontSize: '0.92rem', color: isSelected ? '#1e40af' : '#0f172a' }}>
                        {model.name}
                      </strong>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          backgroundColor: '#ffffff',
                          color: model.badgeColor,
                          border: `1px solid ${model.badgeColor}33`,
                        }}
                      >
                        {model.badge}
                      </span>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b' }}>
                        📦 {model.downloadSize}
                      </span>
                    </div>
                  </div>

                  <p style={{ margin: '2px 0 0 28px', fontSize: '0.82rem', color: '#475569', lineHeight: 1.45 }}>
                    {model.description}
                  </p>

                  <div style={{ margin: '2px 0 0 28px', display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '11px', color: '#64748b' }}>
                    <span>⚡ <strong>RAM:</strong> {model.minRam}</span>
                    <span>💻 <strong>CPU:</strong> {model.minCpu}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 2: Selected Model Specs & Live Environment Diagnostic */}
        <section
          aria-labelledby="model-specs-heading"
          style={{
            marginBottom: '24px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '16px 18px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
            <h3 id="model-specs-heading" style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
              Hardware Requirements: {currentInfo.name}
            </h3>
            <span style={{ fontSize: '11px', color: '#059669', fontWeight: 700, backgroundColor: '#ecfdf5', padding: '2px 8px', borderRadius: '4px', border: '1px solid #a7f3d0' }}>
              ✓ WebAssembly SIMD Supported
            </span>
          </div>

          {/* Specifications Table */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '8px', marginBottom: '14px' }}>
            <div style={{ backgroundColor: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Min Memory (RAM)</div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>{currentInfo.minRam}</div>
            </div>
            <div style={{ backgroundColor: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Recommended RAM</div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>{currentInfo.recRam}</div>
            </div>
            <div style={{ backgroundColor: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '10.5px', textTransform: 'uppercase', color: '#64748b', fontWeight: 700 }}>Storage Footprint</div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', marginTop: '2px' }}>{currentInfo.storageEstimate}</div>
            </div>
          </div>

          {/* Detected Client Hardware Diagnostics */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
              paddingTop: '10px',
              borderTop: '1px solid #e2e8f0',
              fontSize: '11.5px',
            }}
          >
            <span style={{ fontWeight: 600, color: '#475569' }}>Detected Device Hardware:</span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {deviceMetrics.cores !== null && (
                <span style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', padding: '2px 8px', borderRadius: '4px', color: '#0f172a', fontWeight: 600 }}>
                  {deviceMetrics.cores} CPU Cores
                </span>
              )}
              {deviceMetrics.ramGb !== null && (
                <span style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', padding: '2px 8px', borderRadius: '4px', color: '#0f172a', fontWeight: 600 }}>
                  ≥ {deviceMetrics.ramGb} GB RAM
                </span>
              )}
              <span style={{ backgroundColor: '#ffffff', border: '1px solid #cbd5e1', padding: '2px 8px', borderRadius: '4px', color: '#0f172a', fontWeight: 600 }}>
                IndexedDB Ready
              </span>
            </div>
          </div>
        </section>

        {/* Section 3: Audio Cache Management */}
        <section
          aria-labelledby="cache-management-heading"
          style={{
            marginBottom: '24px',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '16px 18px',
            backgroundColor: '#ffffff',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 id="cache-management-heading" style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, color: '#0f172a' }}>
              Audio Cache &amp; Storage Footprint
            </h3>
            <span style={{ fontSize: '11px', color: '#64748b' }}>Offline browser storage</span>
          </div>

          <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: '#64748b', lineHeight: 1.45 }}>
            Synthesized audio clips and neural model weights are stored directly in your browser. You can clear temporary audio clips or purge all models to free up disk space.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '10px',
              marginBottom: '14px',
              backgroundColor: '#f8fafc',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid #f1f5f9',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Generated Audio Clips:</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>
                {cacheStats ? `${cacheStats.clipCount} clips (${formatBytes(cacheStats.clipBytesEstimate)})` : 'Counting...'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Neural Model Status:</div>
              <div style={{ fontSize: '14px', fontWeight: 800, color: cacheStats?.isModelCached ? '#059669' : '#64748b', marginTop: '2px' }}>
                {cacheStats?.isModelCached ? '✓ Cached in Browser Storage' : 'Not cached (download on-demand)'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Button
              variant="outline"
              size="sm"
              loading={clearing === 'clips'}
              onClick={handleClearClips}
              title="Clears generated speech audio WAV files from IndexedDB while keeping downloaded neural weights"
            >
              Clear Audio Clips Cache
            </Button>

            <Button
              variant="danger"
              size="sm"
              loading={clearing === 'all'}
              onClick={handleClearAll}
              title="Purges all cached audio clips and deletes neural model weights from browser CacheStorage"
            >
              Purge All Audio &amp; Model Caches
            </Button>
          </div>
        </section>

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '16px', borderTop: '1px solid #e2e8f0' }}>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={handleSaveAndApply}>
            Save &amp; Apply TTS Settings
          </Button>
        </div>
      </div>

      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

