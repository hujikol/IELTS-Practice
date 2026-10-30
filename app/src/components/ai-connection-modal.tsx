import { useState, useEffect } from 'react';
import {
  loadProviderConfig,
  saveProviderConfig,
  testProviderConnection,
  normalizeBaseUrl,
  type ProviderConfig,
} from '../lib/providers.ts';
import { Button } from './ui/button.tsx';
import { Switch } from './ui/switch.tsx';

interface AiConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigChanged?: (config: ProviderConfig) => void;
}

const PRESETS = [
  {
    name: 'Experiential Gateway',
    baseUrl: 'https://api.experientiallabs.ai/v1',
    model: 'gpt-6-luna',
    hint: 'Experiential Gateway for gpt-6-luna (reads EXPLABS_API_KEY)',
  },
  {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    hint: 'Requires OpenAI API Key (sk-...)',
  },
  {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.0-flash',
    hint: 'Requires Google AI Studio API Key',
  },
  {
    name: 'Local Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3:latest',
    hint: 'No API key needed for standard local Ollama',
  },
  {
    name: 'Local vLLM / LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: 'default',
    hint: 'Ensure local server is running on port 1234',
  },
];

export function AiConnectionModal({ isOpen, onClose, onConfigChanged }: AiConnectionModalProps) {
  const [config, setConfig] = useState<ProviderConfig>(loadProviderConfig);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; models?: string[] } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const current = loadProviderConfig();
      setConfig(current);
      setTestResult(null);
      setErrorMsg(null);
    }
  }, [isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePresetSelect = (preset: typeof PRESETS[0]) => {
    setConfig((prev) => ({
      ...prev,
      baseUrl: preset.baseUrl,
      model: preset.model,
      verified: false,
    }));
    setTestResult(null);
    setErrorMsg(null);
  };

  const handleTest = async () => {
    setErrorMsg(null);
    setTesting(true);
    setTestResult(null);

    try {
      normalizeBaseUrl(config.baseUrl);
    } catch (e) {
      setTesting(false);
      setErrorMsg((e as Error).message);
      return;
    }

    try {
      const result = await testProviderConnection(config);
      setTestResult(result);
      if (result.ok) {
        const updated = saveProviderConfig({
          ...config,
          verified: true,
          lastVerifiedAt: Date.now(),
        });
        setConfig(updated);
        onConfigChanged?.(updated);
      } else {
        const updated = saveProviderConfig({
          ...config,
          verified: false,
        });
        setConfig(updated);
        onConfigChanged?.(updated);
      }
    } catch (err) {
      setTestResult({
        ok: false,
        message: `Connection failed: ${(err as Error).message}`,
      });
      const updated = saveProviderConfig({ ...config, verified: false });
      setConfig(updated);
      onConfigChanged?.(updated);
    } finally {
      setTesting(false);
    }
  };

  const handleToggleSwitch = async (enabled: boolean) => {
    if (enabled && !config.verified) {
      // If turning on but not yet verified, attempt verification immediately
      setConfig((prev) => ({ ...prev, enabled: true }));
      setErrorMsg('Testing connection before enabling...');
      setTesting(true);
      try {
        const res = await testProviderConnection(config);
        setTestResult(res);
        if (res.ok) {
          setErrorMsg(null);
          const saved = saveProviderConfig({ ...config, enabled: true, verified: true, lastVerifiedAt: Date.now() });
          setConfig(saved);
          onConfigChanged?.(saved);
        } else {
          setErrorMsg(`Cannot enable API: connection test failed. ${res.message}`);
          const saved = saveProviderConfig({ ...config, enabled: false, verified: false });
          setConfig(saved);
          onConfigChanged?.(saved);
        }
      } catch (err) {
        setErrorMsg(`Verification failed: ${(err as Error).message}`);
        const saved = saveProviderConfig({ ...config, enabled: false, verified: false });
        setConfig(saved);
        onConfigChanged?.(saved);
      } finally {
        setTesting(false);
      }
      return;
    }

    const updated = saveProviderConfig({ ...config, enabled });
    setConfig(updated);
    onConfigChanged?.(updated);
  };

  const handleSave = () => {
    try {
      normalizeBaseUrl(config.baseUrl);
    } catch (e) {
      setErrorMsg((e as Error).message);
      return;
    }

    const saved = saveProviderConfig(config);
    setConfig(saved);
    onConfigChanged?.(saved);
    onClose();
  };

  const isConnected = config.enabled && config.verified;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        overflowY: 'auto',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#fafafa',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 id="ai-modal-title" style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                AI Connection Settings
              </h2>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  fontSize: '11px',
                  fontWeight: 600,
                  backgroundColor: isConnected ? '#ecfdf5' : '#f1f5f9',
                  color: isConnected ? '#065f46' : '#64748b',
                  border: isConnected ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: isConnected ? '#10b981' : '#94a3b8',
                  }}
                />
                {isConnected ? 'Connected' : config.enabled ? 'Unverified' : 'Disabled'}
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
              Connect your AI API key to automatically generate complete IELTS test suites.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              fontSize: '20px',
              padding: '6px',
              borderRadius: '8px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Switch Row */}
          <div
            style={{
              padding: '16px',
              backgroundColor: '#f8fafc',
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
            }}
          >
            <Switch
              checked={config.enabled}
              onChange={handleToggleSwitch}
              label="Enable Automated AI Generation"
              description="When enabled, test sections will be generated directly using this API endpoint."
            />
          </div>

          {/* Quick Preset Selector */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Quick Presets
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {PRESETS.map((p) => {
                const isSelected = config.baseUrl === p.baseUrl;
                return (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => handlePresetSelect(p)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: isSelected ? '2px solid #0f172a' : '1px solid #e2e8f0',
                      backgroundColor: isSelected ? '#f8fafc' : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{p.name}</div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{p.model}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configuration Form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Base URL */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '6px' }}>
                Base URL
              </label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(e) => {
                  setConfig((prev) => ({ ...prev, baseUrl: e.target.value, verified: false }));
                  setTestResult(null);
                }}
                placeholder="https://api.openai.com/v1"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                HTTP is only permitted for local hosts (localhost / 127.0.0.1).
              </span>
            </div>

            {/* API Key */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b' }}>
                  API Key
                </label>
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748b',
                    fontSize: '11px',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {showKey ? 'Hide key' : 'Show key'}
                </button>
              </div>
              <input
                type={showKey ? 'text' : 'password'}
                value={config.apiKey}
                onChange={(e) => {
                  setConfig((prev) => ({ ...prev, apiKey: e.target.value, verified: false }));
                  setTestResult(null);
                }}
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
              <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                Stored locally in browser storage. Never transmitted to external servers except your configured API.
              </span>
            </div>

            {/* Model Name */}
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#1e293b', marginBottom: '6px' }}>
                Model Identifier
              </label>
              <input
                type="text"
                value={config.model}
                onChange={(e) => {
                  setConfig((prev) => ({ ...prev, model: e.target.value, verified: false }));
                  setTestResult(null);
                }}
                placeholder="gpt-4o or gemini-2.0-flash"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Validation Feedback & Test Result */}
          {errorMsg && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                fontSize: '13px',
              }}
            >
              ⚠️ {errorMsg}
            </div>
          )}

          {testResult && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: testResult.ok ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${testResult.ok ? '#bbf7d0' : '#fecaca'}`,
                color: testResult.ok ? '#166534' : '#991b1b',
                fontSize: '13px',
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {testResult.ok ? '✓ Connection Verified & Ready' : '✕ Connection Check Failed'}
              </div>
              <div style={{ marginTop: '4px', fontSize: '12px' }}>{testResult.message}</div>
              {testResult.models && testResult.models.length > 0 && (
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#1e293b' }}>
                  Available models: {testResult.models.slice(0, 5).join(', ')}
                  {testResult.models.length > 5 ? ` +${testResult.models.length - 5} more` : ''}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #f1f5f9',
            backgroundColor: '#fafafa',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <Button
            variant="secondary"
            onClick={handleTest}
            loading={testing}
            title="Sends a test ping to verify endpoint and authorization"
          >
            {testing ? 'Testing...' : 'Verify Connection'}
          </Button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
            >
              Save Configuration
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
