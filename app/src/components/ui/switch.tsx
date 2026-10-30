import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
  description?: string;
}

export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  id,
  description,
}: SwitchProps) {
  const switchId = id || `switch-${Math.random().toString(36).slice(2, 7)}`;

  const handleClick = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
      {(label || description) && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {label && (
            <label
              htmlFor={switchId}
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: disabled ? '#94a3b8' : '#0f172a',
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
              onClick={handleClick}
            >
              {label}
            </label>
          )}
          {description && (
            <span style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              {description}
            </span>
          )}
        </div>
      )}
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        style={{
          position: 'relative',
          display: 'inline-flex',
          flexShrink: 0,
          width: '46px',
          height: '26px',
          border: '2px solid transparent',
          borderRadius: '9999px',
          backgroundColor: checked ? '#059669' : '#cbd5e1',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          outline: 'none',
          padding: 0,
        }}
      >
        <span
          style={{
            pointerEvents: 'none',
            display: 'inline-block',
            width: '22px',
            height: '22px',
            borderRadius: '9999px',
            backgroundColor: '#ffffff',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.2), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
            transform: checked ? 'translateX(20px)' : 'translateX(0px)',
            transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </button>
    </div>
  );
}

