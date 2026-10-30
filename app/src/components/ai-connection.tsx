import { useState, useEffect } from 'react';
import { loadProviderConfig, type ProviderConfig } from '../lib/providers.ts';
import { AiConnectionModal } from './ai-connection-modal.tsx';

export { AiConnectionModal };

export function AiConnectionStatusPill({
  onClick,
  config: externalConfig,
}: {
  onClick: () => void;
  config?: ProviderConfig;
}) {
  const [config, setConfig] = useState<ProviderConfig>(externalConfig ?? loadProviderConfig);

  useEffect(() => {
    if (externalConfig) setConfig(externalConfig);
  }, [externalConfig]);

  const isConnected = config.enabled && config.verified;

  const modelName = (config?.model || '').trim();
  const shortModel = modelName ? modelName.split('/')[0] : 'Connected';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: isConnected ? '#ecfdf5' : '#f8fafc',
        color: isConnected ? '#065f46' : '#64748b',
        border: isConnected ? '1px solid #a7f3d0' : '1px solid #cbd5e1',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
      title={
        isConnected
          ? `Connected to ${modelName || 'AI'} (${config?.baseUrl || ''})`
          : config?.enabled
            ? 'API is enabled but not verified. Click to verify.'
            : 'AI API connection disabled. Click to configure.'
      }
    >
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          backgroundColor: isConnected ? '#10b981' : config?.enabled ? '#f59e0b' : '#94a3b8',
        }}
      />
      <span>
        {isConnected
          ? `AI: ${shortModel}`
          : config?.enabled
            ? 'AI: Needs Verify'
            : 'AI: Offline / Disconnected'}
      </span>
    </button>
  );
}

// Retain backwards-compatible export if needed
export function AiConnectionSettings({
  onChange,
}: {
  onChange?: (config: ProviderConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<ProviderConfig>(loadProviderConfig);

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <AiConnectionStatusPill onClick={() => setOpen(true)} config={config} />
        <span style={{ fontSize: '12px', color: '#64748b' }}>
          Click to configure or test your API key and endpoint.
        </span>
      </div>
      <AiConnectionModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onConfigChanged={(updated) => {
          setConfig(updated);
          onChange?.(updated);
        }}
      />
    </div>
  );
}
