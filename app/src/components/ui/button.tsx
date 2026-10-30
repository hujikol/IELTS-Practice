import React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'success';
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
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    fontWeight: 600,
    fontFamily: 'inherit',
    borderRadius: '8px',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.6 : 1,
    transition: 'all 0.15s ease-in-out',
    userSelect: 'none',
    border: '1px solid transparent',
    outline: 'none',
    textDecoration: 'none',
    boxSizing: 'border-box',
    ...style,
  };

  const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
    sm: {
      height: '32px',
      padding: '0 12px',
      fontSize: '12px',
      lineHeight: '16px',
    },
    md: {
      height: '40px',
      padding: '0 16px',
      fontSize: '14px',
      lineHeight: '20px',
    },
    lg: {
      height: '48px',
      padding: '0 22px',
      fontSize: '15px',
      lineHeight: '22px',
    },
  };

  const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      backgroundColor: '#0f172a',
      color: '#ffffff',
      borderColor: '#0f172a',
      boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    },
    secondary: {
      backgroundColor: '#f1f5f9',
      color: '#1e293b',
      borderColor: '#e2e8f0',
    },
    outline: {
      backgroundColor: '#ffffff',
      color: '#334155',
      borderColor: '#cbd5e1',
      boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
    },
    danger: {
      backgroundColor: '#fef2f2',
      color: '#b91c1c',
      borderColor: '#fecaca',
    },
    ghost: {
      backgroundColor: 'transparent',
      color: '#475569',
      borderColor: 'transparent',
    },
    success: {
      backgroundColor: '#059669',
      color: '#ffffff',
      borderColor: '#059669',
      boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    },
  };

  return (
    <button
      ref={ref}
      disabled={isDisabled}
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
            width: size === 'sm' ? '12px' : '16px',
            height: size === 'sm' ? '12px' : '16px',
            border: '2px solid currentColor',
            borderRightColor: 'transparent',
            borderRadius: '50%',
            animation: 'btn-spin 0.6s linear infinite',
          }}
        />
      ) : (
        icon
      )}
      {children}
      <style>{`
        @keyframes btn-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  );
});

