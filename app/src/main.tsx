import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/error-boundary.tsx';

const el = document.getElementById('root');
if (!el) throw new Error('#root missing from index.html');
createRoot(el).render(
  <StrictMode>
    <ErrorBoundary fallbackTitle="IELTS Studio encountered an issue">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
