import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'success' | 'accent';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    icon,
    disabled,
    children,
    style,
    className = '',
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.45rem',
    fontWeight: 600,
    fontFamily: 'inherit',
    borderRadius: '8px',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.6 : 1,
    transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
    userSelect: 'none',
    border: '1px solid transparent',
    outline: 'none',
    textDecoration: 'none',
    boxSizing: 'border-box',
    whiteSpace: 'nowrap',
    ...style,
  };

  const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
    sm: {
      height: '32px',
      padding: '0 12px',
      fontSize: '12.5px',
      lineHeight: '16px',
    },
    md: {
      height: '38px',
      padding: '0 16px',
      fontSize: '13.5px',
      lineHeight: '20px',
    },
    lg: {
      height: '46px',
      padding: '0 22px',
      fontSize: '15px',
      lineHeight: '22px',
    },
  };

  const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      backgroundColor: '#2563eb',
      color: '#ffffff',
      borderColor: '#1d4ed8',
      boxShadow: '0 2px 6px rgba(37, 99, 235, 0.22)',
    },
    secondary: {
      backgroundColor: '#eff6ff',
      color: '#1d4ed8',
      borderColor: '#bfdbfe',
      boxShadow: '0 1px 2px rgba(37, 99, 235, 0.05)',
    },
    outline: {
      backgroundColor: '#ffffff',
      color: '#334155',
      borderColor: '#cbd5e1',
      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
    },
    danger: {
      backgroundColor: '#fff1f2',
      color: '#be123c',
      borderColor: '#fecdd3',
      boxShadow: '0 1px 2px rgba(190, 18, 60, 0.05)',
    },
    ghost: {
      backgroundColor: 'transparent',
      color: '#475569',
      borderColor: 'transparent',
    },
    success: {
      backgroundColor: '#059669',
      color: '#ffffff',
      borderColor: '#047857',
      boxShadow: '0 2px 6px rgba(5, 150, 105, 0.22)',
    },
    accent: {
      backgroundColor: '#fffbeb',
      color: '#92400e',
      borderColor: '#fde68a',
      boxShadow: '0 1px 3px rgba(180, 83, 9, 0.08)',
    },
  };

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={`ui-btn ui-btn-${variant} ui-btn-${size} ${className}`}
      style={{
        ...baseStyle,
        ...sizeStyles[size],
        ...variantStyles[variant],
      }}
      {...props}
    >
      {loading ? (
        <span
          style={{
            display: 'inline-block',
            width: size === 'sm' ? '12px' : '15px',
            height: size === 'sm' ? '12px' : '15px',
            border: '2px solid currentColor',
            borderRightColor: 'transparent',
            borderRadius: '50%',
            animation: 'btn-spin 0.6s linear infinite',
          }}
        />
      ) : icon ? (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: size === 'sm' ? '13px' : '15px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
      <style>{`
        @keyframes btn-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .ui-btn {
          cursor: pointer;
        }
        .ui-btn:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }
        .ui-btn:not(:disabled):hover {
          transform: translateY(-1px);
        }
        .ui-btn:not(:disabled):active {
          transform: translateY(0);
        }
        .ui-btn:focus-visible {
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.35) !important;
        }
        .ui-btn-primary:not(:disabled):hover {
          background-color: #1d4ed8 !important;
          border-color: #1e40af !important;
          box-shadow: 0 4px 10px rgba(37, 99, 235, 0.3) !important;
        }
        .ui-btn-secondary:not(:disabled):hover {
          background-color: #dbeafe !important;
          border-color: #93c5fd !important;
        }
        .ui-btn-outline:not(:disabled):hover {
          background-color: #f8fafc !important;
          border-color: #94a3b8 !important;
          color: #0f172a !important;
        }
        .ui-btn-danger:not(:disabled):hover {
          background-color: #ffe4e6 !important;
          border-color: #fda4af !important;
          color: #9f1239 !important;
        }
        .ui-btn-ghost:not(:disabled):hover {
          background-color: #f1f5f9 !important;
          color: #0f172a !important;
        }
        .ui-btn-delete:not(:disabled):hover {
          background-color: #fff1f2 !important;
          border-color: #fecdd3 !important;
          color: #be123c !important;
        }
        .ui-btn-success:not(:disabled):hover {
          background-color: #047857 !important;
          border-color: #065f46 !important;
          box-shadow: 0 4px 10px rgba(5, 150, 105, 0.3) !important;
        }
        .ui-btn-accent:not(:disabled):hover {
          background-color: #fef3c7 !important;
          border-color: #f59e0b !important;
        }
      `}</style>
    </button>
  );
});

