import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/button.tsx';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[IELTS Studio] Uncaught React render error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      try {
        window.location.hash = '#dashboard';
        localStorage.setItem('ielts_active_route', JSON.stringify({ stage: 'dashboard' }));
      } catch {}
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          style={{
            maxWidth: 720,
            margin: '40px auto',
            padding: '28px',
            backgroundColor: '#ffffff',
            border: '1px solid #fecaca',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            color: '#1e293b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <span style={{ fontSize: '28px' }}>⚠️</span>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#991b1b' }}>
                {this.props.fallbackTitle || 'Something went wrong rendering this view'}
              </h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: '#64748b' }}>
                Your saved progress and test data are safely stored in your browser local storage.
              </p>
            </div>
          </div>

          <div
            style={{
              padding: '12px 16px',
              backgroundColor: '#fef2f2',
              borderRadius: '8px',
              border: '1px solid #fee2e2',
              marginBottom: '20px',
              color: '#b91c1c',
              fontSize: '0.9rem',
              fontWeight: 500,
              wordBreak: 'break-word',
            }}
          >
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary" size="md" onClick={this.handleReset}>
              Return to Dashboard
            </Button>
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                this.setState((prev) => ({ showDetails: !prev.showDetails }));
              }}
            >
              {this.state.showDetails ? 'Hide Technical Details' : 'Show Technical Details'}
            </Button>
          </div>

          {this.state.showDetails && (
            <div style={{ marginTop: '20px' }}>
              <pre
                style={{
                  padding: '12px',
                  backgroundColor: '#0f172a',
                  color: '#f8fafc',
                  borderRadius: '8px',
                  fontSize: '0.78rem',
                  overflowX: 'auto',
                  lineHeight: 1.5,
                  maxHeight: '260px',
                }}
              >
                {this.state.error?.stack || 'No stack trace available.'}
                {'\n\nComponent Stack:'}
                {this.state.errorInfo?.componentStack || 'No component stack available.'}
              </pre>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

