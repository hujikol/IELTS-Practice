import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button.tsx';
import {
  getTtsModelPreference,
  setTtsModelPreference,
  getTtsDevicePreference,
  setTtsDevicePreference,
  getAudioCacheStats,
  isAudioModelCached,
  downloadAudioModelOnce,
  clearAudioClipsCache,
  clearAllAudioAndModelCaches,
  type TtsModelType,
  type TtsDeviceType,
  type AudioCacheStats,
} from '../lib/audio-manager.ts';

export interface TtsSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onModelChanged?: (newModel: TtsModelType) => void;
  onDeviceChanged?: (newDevice: TtsDeviceType) => void;
}

interface FriendlyModelMeta {
  title: string;
  subtitle: string;
  size: string;
  badge?: string;
  recommended?: boolean;
}

const MODEL_DETAILS: Record<TtsModelType, FriendlyModelMeta> = {
  'kokoro-fp16': {
    title: 'Studio Quality (Kokoro FP16)',
    subtitle: 'Authentic examiner voices with 50% lower download size. Perfect balance.',
    size: '163 MB',
    badge: 'Recommended',
    recommended: true,
  },
  'kokoro-q8': {
    title: 'Fast & Balanced (Kokoro Q8)',
    subtitle: 'Smallest download with clear neural pronunciation for everyday study.',
    size: '92 MB',
    badge: 'Fast',
  },
  'kokoro-fp32': {
    title: 'Studio Master (Kokoro FP32)',
    subtitle: 'Uncompressed full precision audio with maximum phonetic fidelity.',
    size: '326 MB',
    badge: 'Lossless',
  },
  webspeech: {
    title: 'Device Built-in Voice (Web Speech)',
    subtitle: 'Instant playback using your browser engine with zero downloads.',
    size: '0 MB',
    badge: 'Zero Download',
  },
  'kokoro-q4f16': {
    title: 'Mixed Precision (Kokoro Q4F16)',
    subtitle: 'Accelerated neural inference for reduced memory pressure.',
    size: '154 MB',
    badge: 'Alternative',
  },
  'kokoro-q4': {
    title: 'Low Compute (Kokoro Q4)',
    subtitle: 'Optimized for devices with limited CPU processing speed.',
    size: '305 MB',
    badge: 'Alternative',
  },
};

const PRIMARY_MODEL_KEYS: TtsModelType[] = [
  'kokoro-fp16',
  'kokoro-q8',
  'kokoro-fp32',
  'webspeech',
];

const SECONDARY_MODEL_KEYS: TtsModelType[] = [
  'kokoro-q4f16',
  'kokoro-q4',
];

/**
 * Accessible SVG Radial Progress Indicator with live percentage text.
 */
export function RadialProgress({
  progress,
  size = 40,
  strokeWidth = 3.5,
  color = '#2563eb',
  trackColor = '#e2e8f0',
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, progress));
  const strokeDashoffset = circumference - (clamped / 100) * circumference;

  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Download progress: ${Math.round(clamped)}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.15s ease' }}
        />
      </svg>
      <span
        style={{
          position: 'absolute',
          fontSize: size >= 40 ? '10px' : '9px',
          fontWeight: 700,
          color: '#1e40af',
          lineHeight: 1,
        }}
      >
        {Math.round(clamped)}%
      </span>
    </div>
  );
}

/**
 * Streamlined Audio & Voice Settings Modal with interactive model download,
 * WebGPU / CPU compute acceleration toggle, and radial progress cues.
 */
export function TtsSettingsModal({ isOpen, onClose, onModelChanged, onDeviceChanged }: TtsSettingsModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  const [selectedModel, setSelectedModel] = useState<TtsModelType>(getTtsModelPreference);
  const [selectedDevice, setSelectedDevice] = useState<TtsDeviceType>(getTtsDevicePreference);

  const [cachedMap, setCachedMap] = useState<Record<TtsModelType, boolean>>({
    'kokoro-fp16': false,
    'kokoro-q8': false,
    'kokoro-fp32': false,
    webspeech: true,
    'kokoro-q4f16': false,
    'kokoro-q4': false,
  });
  const [downloadingModel, setDownloadingModel] = useState<TtsModelType | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadMessage, setDownloadMessage] = useState<string>('');

  const [cacheStats, setCacheStats] = useState<AudioCacheStats | null>(null);
  const [clearing, setClearing] = useState<'clips' | 'all' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdvancedModels, setShowAdvancedModels] = useState<boolean>(false);

  // Client hardware metrics for diagnostics
  const [deviceMetrics, setDeviceMetrics] = useState<{
    cores: number | null;
    ramGb: number | null;
    wasmSimd: boolean;
    hasWebGpu: boolean;
  }>({
    cores: null,
    ramGb: null,
    wasmSimd: true,
    hasWebGpu: false,
  });

  const refreshStatsAndCaches = async () => {
    try {
      const stats = await getAudioCacheStats();
      setCacheStats(stats);
    } catch {
      // ignore
    }

    const allKeys: TtsModelType[] = [
      'kokoro-fp16',
      'kokoro-q8',
      'kokoro-fp32',
      'webspeech',
      'kokoro-q4f16',
      'kokoro-q4',
    ];

    const map: Partial<Record<TtsModelType, boolean>> = {};
    for (const key of allKeys) {
      if (key === 'webspeech') {
        map[key] = true;
      } else {
        map[key] = await isAudioModelCached(key);
      }
    }
    setCachedMap(map as Record<TtsModelType, boolean>);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
    const ramGb =
      typeof (navigator as unknown as { deviceMemory?: number }).deviceMemory === 'number'
        ? (navigator as unknown as { deviceMemory: number }).deviceMemory
        : null;

    const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;

    setDeviceMetrics({
      cores,
      ramGb,
      wasmSimd: typeof WebAssembly === 'object' && typeof WebAssembly.validate === 'function',
      hasWebGpu: Boolean(hasGpu),
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      const current = getTtsModelPreference();
      setSelectedModel(current);
      setSelectedDevice(getTtsDevicePreference());
      if (SECONDARY_MODEL_KEYS.includes(current)) {
        setShowAdvancedModels(true);
      }
      void refreshStatsAndCaches();
      setNotice(null);
      setDownloadingModel(null);
      setDownloadProgress(0);
      setDownloadMessage('');
    }
  }, [isOpen]);

  // Keyboard navigation & body scroll locking
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !downloadingModel) {
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
  }, [isOpen, onClose, downloadingModel]);

  const handleDownload = async (modelToDownload: TtsModelType, autoApplyAfter = false) => {
    if (modelToDownload === 'webspeech') return;
    setDownloadingModel(modelToDownload);
    setDownloadProgress(0);
    setDownloadMessage('Starting download...');
    setNotice(null);

    try {
      await downloadAudioModelOnce(
        (pct, msg) => {
          setDownloadProgress(pct);
          setDownloadMessage(msg);
        },
        modelToDownload,
        selectedDevice,
      );

      // Verify cached status
      const cached = await isAudioModelCached(modelToDownload);
      setCachedMap((prev) => ({ ...prev, [modelToDownload]: cached || true }));
      await refreshStatsAndCaches();

      setNotice(`✓ ${MODEL_DETAILS[modelToDownload]?.title || modelToDownload} downloaded and ready to use!`);

      if (autoApplyAfter) {
        setTtsModelPreference(modelToDownload);
        setTtsDevicePreference(selectedDevice);
        onModelChanged?.(modelToDownload);
        onDeviceChanged?.(selectedDevice);
        onClose();
      }
    } catch (err) {
      setNotice(`⚠️ Failed to download model: ${(err as Error).message}`);
    } finally {
      setDownloadingModel(null);
    }
  };

  const handleSelectModel = (key: TtsModelType) => {
    if (downloadingModel) return;
    setSelectedModel(key);
  };

  const handleSaveAndApply = async () => {
    if (downloadingModel) return;

    // Save device compute preference
    setTtsDevicePreference(selectedDevice);
    onDeviceChanged?.(selectedDevice);

    // Check if the chosen model requires downloading first
    const isCached = cachedMap[selectedModel] || selectedModel === 'webspeech';
    if (!isCached) {
      await handleDownload(selectedModel, true);
      return;
    }

    setTtsModelPreference(selectedModel);
    onModelChanged?.(selectedModel);
    onClose();
  };

  const handleClearClips = async () => {
    setClearing('clips');
    setNotice(null);
    try {
      const count = await clearAudioClipsCache();
      await refreshStatsAndCaches();
      setNotice(`✓ Cleared ${count} temporary audio clip${count === 1 ? '' : 's'}.`);
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
      await refreshStatsAndCaches();
      setNotice(
        `✓ Reset audio cache (${res.clipsCleared} clips removed${
          res.modelsCleared ? ', neural models cleared' : ''
        }).`,
      );
    } catch (err) {
      setNotice(`⚠️ Failed to reset audio cache: ${(err as Error).message}`);
    } finally {
      setClearing(null);
    }
  };

  if (!isOpen) return null;

  const visibleModelKeys = showAdvancedModels
    ? [...PRIMARY_MODEL_KEYS, ...SECONDARY_MODEL_KEYS]
    : PRIMARY_MODEL_KEYS;

  const isCurrentModelCached = cachedMap[selectedModel] || selectedModel === 'webspeech';

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div
      role="presentation"
      onClick={() => {
        if (!downloadingModel) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '16px',
        animation: 'modalFadeIn 0.15s ease-out',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tts-settings-title"
        aria-describedby="tts-settings-desc"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          maxWidth: '560px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.05)',
          border: '1px solid #e2e8f0',
          position: 'relative',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          color: '#0f172a',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div>
            <h2
              id="tts-settings-title"
              style={{
                margin: '0 0 4px',
                fontSize: '1.25rem',
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.015em',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>🎙️ Voice &amp; Audio Settings</span>
            </h2>
            <p
              id="tts-settings-desc"
              style={{
                margin: 0,
                fontSize: '0.85rem',
                color: '#64748b',
                lineHeight: 1.4,
              }}
            >
              Configure the speech engine and hardware acceleration for IELTS audio.
            </p>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            aria-label="Close audio settings"
            disabled={downloadingModel !== null}
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: '18px',
              color: downloadingModel !== null ? '#cbd5e1' : '#94a3b8',
              cursor: downloadingModel !== null ? 'not-allowed' : 'pointer',
              lineHeight: 1,
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (!downloadingModel) e.currentTarget.style.color = '#0f172a';
            }}
            onMouseLeave={(e) => {
              if (!downloadingModel) e.currentTarget.style.color = '#94a3b8';
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div
          style={{
            padding: '20px 24px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
          }}
        >
          {/* Status Notice */}
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
              }}
            >
              {notice}
            </div>
          )}

          {/* Active Download Radial Progress Banner */}
          {downloadingModel && (
            <div
              style={{
                padding: '14px 16px',
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                animation: 'modalFadeIn 0.2s ease-out',
              }}
            >
              <RadialProgress progress={downloadProgress} size={46} strokeWidth={4} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e40af' }}>
                  Downloading {MODEL_DETAILS[downloadingModel]?.title || downloadingModel}...
                </div>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#3b82f6',
                    marginTop: '2px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {downloadMessage || `${Math.round(downloadProgress)}% completed. Please keep this open.`}
                </div>
              </div>
            </div>
          )}

          {/* Compute Acceleration Mode: WebGPU vs CPU */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Compute Acceleration
              </span>
              {deviceMetrics.hasWebGpu ? (
                <span style={{ fontSize: '11px', color: '#059669', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span>✓</span> WebGPU Hardware Acceleration Available
                </span>
              ) : (
                <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span>⚠️</span> WebGPU Not Detected (CPU Fallback)
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {/* WebGPU Option */}
              <button
                type="button"
                onClick={() => setSelectedDevice('webgpu')}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: selectedDevice === 'webgpu' ? '2px solid #2563eb' : '1px solid #e2e8f0',
                  backgroundColor: selectedDevice === 'webgpu' ? '#eff6ff' : '#ffffff',
                  cursor: downloadingModel ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: selectedDevice === 'webgpu' ? 700 : 600,
                      color: selectedDevice === 'webgpu' ? '#1e40af' : '#0f172a',
                    }}
                  >
                    ⚡ WebGPU (Default)
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: '#059669',
                      backgroundColor: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    Fastest
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.35 }}>
                  Accelerated on your graphics card for near-instant speech generation.
                </div>
              </button>

              {/* CPU (WASM) Option */}
              <button
                type="button"
                onClick={() => setSelectedDevice('cpu')}
                style={{
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: selectedDevice === 'cpu' ? '2px solid #2563eb' : '1px solid #e2e8f0',
                  backgroundColor: selectedDevice === 'cpu' ? '#eff6ff' : '#ffffff',
                  cursor: downloadingModel ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: selectedDevice === 'cpu' ? 700 : 600,
                      color: selectedDevice === 'cpu' ? '#1e40af' : '#0f172a',
                    }}
                  >
                    💻 CPU (WebAssembly)
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#475569',
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #e2e8f0',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    Universal
                  </span>
                </div>
                <div style={{ fontSize: '11.5px', color: '#64748b', lineHeight: 1.35 }}>
                  Multi-threaded processor compute (WASM SIMD). Universal compatibility.
                </div>
              </button>
            </div>
          </div>

          {/* Voice Models List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Select Voice Engine
            </span>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {visibleModelKeys.map((key) => {
                const isSelected = selectedModel === key;
                const info = MODEL_DETAILS[key];
                const isCached = cachedMap[key] || key === 'webspeech';
                const isThisDownloading = downloadingModel === key;

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
                      padding: '12px 14px',
                      borderRadius: '10px',
                      border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                      cursor: downloadingModel ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      opacity: downloadingModel && !isThisDownloading ? 0.7 : 1,
                    }}
                  >
                    {/* Radio Indicator */}
                    <span
                      style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '50%',
                        border: isSelected ? '5px solid #2563eb' : '2px solid #cbd5e1',
                        backgroundColor: '#ffffff',
                        display: 'inline-block',
                        flexShrink: 0,
                        boxSizing: 'border-box',
                      }}
                    />

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontSize: '0.92rem',
                            fontWeight: isSelected ? 700 : 600,
                            color: isSelected ? '#1e40af' : '#0f172a',
                          }}
                        >
                          {info.title}
                        </span>

                        {info.recommended && (
                          <span
                            style={{
                              fontSize: '10.5px',
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: '9999px',
                              backgroundColor: '#ecfdf5',
                              color: '#059669',
                              border: '1px solid #a7f3d0',
                            }}
                          >
                            Recommended
                          </span>
                        )}
                      </div>

                      <p
                        style={{
                          margin: '2px 0 0',
                          fontSize: '0.8rem',
                          color: '#64748b',
                          lineHeight: 1.35,
                        }}
                      >
                        {info.subtitle}
                      </p>
                    </div>

                    {/* Right-hand Status & Radial Progress Cue */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      {isThisDownloading ? (
                        <RadialProgress progress={downloadProgress} size={36} strokeWidth={3.5} />
                      ) : isCached ? (
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: '6px',
                            backgroundColor: '#ecfdf5',
                            color: '#059669',
                            border: '1px solid #a7f3d0',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ✓ Ready
                        </span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#64748b',
                              backgroundColor: '#f1f5f9',
                              padding: '3px 8px',
                              borderRadius: '6px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {info.size}
                          </span>
                          <button
                            type="button"
                            disabled={downloadingModel !== null}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectModel(key);
                              void handleDownload(key, false);
                            }}
                            title={`Download ${info.title} to browser storage`}
                            style={{
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#2563eb',
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: '6px',
                              cursor: downloadingModel ? 'not-allowed' : 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <span>⬇️</span>
                            <span>Download</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {!showAdvancedModels && (
              <button
                type="button"
                onClick={() => setShowAdvancedModels(true)}
                style={{
                  alignSelf: 'flex-start',
                  background: 'none',
                  border: 'none',
                  color: '#475569',
                  fontSize: '12px',
                  cursor: 'pointer',
                  padding: '4px 0',
                  marginTop: '2px',
                  textDecoration: 'underline',
                }}
              >
                + Show more precision formats (Q4, Q4F16)
              </button>
            )}
          </div>

          {/* Download Required Prompt Cue (When current selection is un-downloaded) */}
          {!isCurrentModelCached && !downloadingModel && (
            <div
              style={{
                padding: '12px 14px',
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>📥 Download Required First</span>
                </div>
                <div style={{ fontSize: '12px', color: '#b45309', marginTop: '2px' }}>
                  {MODEL_DETAILS[selectedModel]?.title} must be downloaded ({MODEL_DETAILS[selectedModel]?.size}) before it can be applied.
                </div>
              </div>

              <Button
                variant="primary"
                size="sm"
                icon="⬇️"
                onClick={() => void handleDownload(selectedModel, false)}
              >
                Download Now
              </Button>
            </div>
          )}

          {/* Offline Cache & Storage Management */}
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                Offline Voice Cache
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                {cacheStats
                  ? `${cacheStats.clipCount} audio clips stored (${formatBytes(cacheStats.clipBytesEstimate)})`
                  : 'Calculating storage footprint...'}
                {cacheStats?.isModelCached ? ' • Neural model saved' : ''}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Button
                variant="outline"
                size="sm"
                loading={clearing === 'clips'}
                disabled={downloadingModel !== null}
                onClick={handleClearClips}
                title="Clears temporary audio clips from local storage while preserving model weights"
              >
                Clear Audio
              </Button>

              <Button
                variant="outline"
                size="sm"
                loading={clearing === 'all'}
                disabled={downloadingModel !== null}
                onClick={handleClearAll}
                title="Purges all cached audio recordings and downloaded voice weights"
                style={{ color: '#b91c1c' }}
              >
                Reset All
              </Button>
            </div>
          </div>

          {/* Subtle Device Info Accordion */}
          <details
            style={{
              fontSize: '12px',
              color: '#64748b',
              border: '1px solid #f1f5f9',
              borderRadius: '8px',
              padding: '8px 12px',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontWeight: 600,
                color: '#475569',
                userSelect: 'none',
              }}
            >
              Device Compatibility &amp; Diagnostics ▾
            </summary>
            <div
              style={{
                marginTop: '8px',
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                paddingTop: '6px',
                borderTop: '1px dashed #e2e8f0',
              }}
            >
              <span
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  color: deviceMetrics.hasWebGpu ? '#059669' : '#d97706',
                  fontWeight: 600,
                }}
              >
                WebGPU: {deviceMetrics.hasWebGpu ? '✓ Available' : 'Not supported'}
              </span>
              {deviceMetrics.cores !== null && (
                <span
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    color: '#0f172a',
                    fontWeight: 600,
                  }}
                >
                  {deviceMetrics.cores} CPU Cores
                </span>
              )}
              {deviceMetrics.ramGb !== null && (
                <span
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    color: '#0f172a',
                    fontWeight: 600,
                  }}
                >
                  ≥ {deviceMetrics.ramGb} GB RAM
                </span>
              )}
              <span
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  color: deviceMetrics.wasmSimd ? '#059669' : '#d97706',
                  fontWeight: 600,
                }}
              >
                WASM SIMD: {deviceMetrics.wasmSimd ? '✓ Active' : 'Fallback'}
              </span>
            </div>
          </details>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: '1px solid #f1f5f9',
            backgroundColor: '#fafafa',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
          }}
        >
          <Button variant="outline" size="md" disabled={downloadingModel !== null} onClick={onClose}>
            Cancel
          </Button>

          {downloadingModel ? (
            <Button variant="primary" size="md" disabled loading>
              Downloading ({Math.round(downloadProgress)}%)...
            </Button>
          ) : !isCurrentModelCached ? (
            <Button
              variant="primary"
              size="md"
              icon="⬇️"
              onClick={handleSaveAndApply}
            >
              Download &amp; Apply
            </Button>
          ) : (
            <Button variant="primary" size="md" icon="✓" onClick={handleSaveAndApply}>
              Save &amp; Apply
            </Button>
          )}
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
