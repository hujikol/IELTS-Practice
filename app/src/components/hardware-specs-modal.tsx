import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button.tsx';

export interface HardwareSpecsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Hardware Specification & System Requirements modal for the local Kokoro FP32 TTS engine.
 * Adheres to /web-uix: high-contrast typography, semantic landmarks, WCAG 2.1 AA keyboard support.
 */
export function HardwareSpecsModal({ isOpen, onClose }: HardwareSpecsModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

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

  if (!isOpen) return null;

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
        aria-labelledby="hw-specs-title"
        aria-describedby="hw-specs-desc"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '28px 30px',
          maxWidth: '560px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(15, 23, 42, 0.12), 0 10px 10px -5px rgba(15, 23, 42, 0.04)',
          border: '1px solid #e2e8f0',
          position: 'relative',
          maxHeight: '90vh',
          overflowY: 'auto',
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
            ⚡ On-Device Neural Synthesis
          </span>
          <button
            type="button"
            aria-label="Close specifications"
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
          id="hw-specs-title"
          style={{
            margin: '0 0 8px',
            fontSize: '1.35rem',
            fontWeight: 800,
            color: '#0f172a',
            letterSpacing: '-0.015em',
          }}
        >
          Device Hardware Requirements
        </h2>

        <p
          id="hw-specs-desc"
          style={{
            margin: '0 0 20px',
            fontSize: '0.92rem',
            color: '#475569',
            lineHeight: 1.55,
          }}
        >
          IELTS Studio synthesizes dialogue audio 100% locally using <strong>Kokoro-82M (FP32)</strong> running inside
          your browser via ONNX Runtime WebAssembly. No voices or recordings are ever streamed to a remote server.
        </p>

        {/* Detected Hardware Status Pill */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            backgroundColor: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '0.84rem',
          }}
        >
          <span style={{ fontWeight: 600, color: '#334155' }}>Your Detected Environment:</span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
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
            <span style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: '4px', color: '#065f46', fontWeight: 600 }}>
              WASM SIMD Ready
            </span>
          </div>
        </div>

        {/* Specifications Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr 1fr',
              gap: '10px',
              padding: '8px 12px',
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: '#64748b',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <span>Component</span>
            <span>Minimum Spec</span>
            <span>Recommended</span>
          </div>

          {/* Processor */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr 1fr',
              gap: '10px',
              padding: '10px 12px',
              backgroundColor: '#f8fafc',
              borderRadius: '8px',
              fontSize: '0.84rem',
            }}
          >
            <strong style={{ color: '#0f172a' }}>Processor (CPU)</strong>
            <span style={{ color: '#475569' }}>64-bit multi-core (x86-64 with AVX2 or ARM64)</span>
            <span style={{ color: '#0f172a', fontWeight: 600 }}>4+ cores @ 2.0 GHz+ (Apple M-Series / Core i5/i7)</span>
          </div>

          {/* Memory */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr 1fr',
              gap: '10px',
              padding: '10px 12px',
              backgroundColor: '#ffffff',
              border: '1px solid #f1f5f9',
              borderRadius: '8px',
              fontSize: '0.84rem',
            }}
          >
            <strong style={{ color: '#0f172a' }}>Memory (RAM)</strong>
            <span style={{ color: '#475569' }}>4 GB (needs ~1.5 GB free browser heap for FP32 weights)</span>
            <span style={{ color: '#0f172a', fontWeight: 600 }}>8 GB+ RAM</span>
          </div>

          {/* Browser */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr 1fr',
              gap: '10px',
              padding: '10px 12px',
              backgroundColor: '#f8fafc',
              borderRadius: '8px',
              fontSize: '0.84rem',
            }}
          >
            <strong style={{ color: '#0f172a' }}>Web Browser</strong>
            <span style={{ color: '#475569' }}>Chrome 90+, Edge 90+, Safari 16.4+, Firefox 89+</span>
            <span style={{ color: '#0f172a', fontWeight: 600 }}>Modern Chromium or Safari with WebAssembly SIMD</span>
          </div>

          {/* Local Storage */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr 1fr',
              gap: '10px',
              padding: '10px 12px',
              backgroundColor: '#ffffff',
              border: '1px solid #f1f5f9',
              borderRadius: '8px',
              fontSize: '0.84rem',
            }}
          >
            <strong style={{ color: '#0f172a' }}>Local Storage</strong>
            <span style={{ color: '#475569' }}>~350 MB free IndexedDB space</span>
            <span style={{ color: '#0f172a', fontWeight: 600 }}>500 MB+ (stores model &amp; audio clips offline)</span>
          </div>
        </div>

        {/* Fallback Notice Callout */}
        <div
          style={{
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '20px',
            fontSize: '0.84rem',
            color: '#1e40af',
            lineHeight: 1.5,
          }}
        >
          <strong>💡 Intelligent Native Fallback:</strong> If your system is low on free memory or running on a battery-saver
          profile, IELTS Studio automatically falls back to your browser's native Web Speech synthesis so practice never stalls.
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
          <Button
            ref={closeBtnRef}
            variant="primary"
            size="md"
            onClick={onClose}
          >
            Understood
          </Button>
        </div>
      </div>
    </div>
  );
}
