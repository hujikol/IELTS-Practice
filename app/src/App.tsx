// IELTS Studio Academic Web Application.
// Full persistent browser local storage, AI API integration, and comprehensive dashboard.

import { useCallback, useEffect, useState } from 'react';
import { Dashboard } from './components/dashboard.tsx';
import { Preparation } from './components/preparation.tsx';
import { Player } from './components/player.tsx';
import { Review } from './components/review.tsx';
import { ErrorBoundary } from './components/error-boundary.tsx';
import { loadAttempt, type AttemptRecord } from './lib/attempts.ts';

type View =
  | { stage: 'dashboard' }
  | { stage: 'prepare'; attempt?: AttemptRecord; attemptId?: string }
  | { stage: 'practice'; attempt: AttemptRecord }
  | { stage: 'review'; attempt: AttemptRecord };

type SavedRoute = {
  stage: 'dashboard' | 'prepare' | 'practice' | 'review';
  attemptId?: string;
};

const STORAGE_ROUTE_KEY = 'ielts_active_route';

function parseRoute(): SavedRoute {
  const hash = window.location.hash.replace(/^#\/?/, '').trim();
  if (hash) {
    const [stageName, attemptId] = hash.split('/');
    if (stageName === 'prepare') return { stage: 'prepare', attemptId: attemptId || undefined };
    if (stageName === 'practice' && attemptId) return { stage: 'practice', attemptId };
    if (stageName === 'review' && attemptId) return { stage: 'review', attemptId };
    if (stageName === 'dashboard') return { stage: 'dashboard' };
  }

  try {
    const raw = localStorage.getItem(STORAGE_ROUTE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedRoute;
      if (parsed && typeof parsed.stage === 'string') {
        return parsed;
      }
    }
  } catch {
    // ignore storage parsing errors
  }

  return { stage: 'dashboard' };
}

function updateBrowserUrl(view: View) {
  let targetHash = '#dashboard';
  let savedRoute: SavedRoute = { stage: 'dashboard' };

  if (view.stage === 'dashboard') {
    targetHash = '#dashboard';
    savedRoute = { stage: 'dashboard' };
  } else if (view.stage === 'prepare') {
    const id = view.attemptId || view.attempt?.id;
    targetHash = id ? `#prepare/${id}` : '#prepare';
    savedRoute = { stage: 'prepare', attemptId: id };
  } else if (view.stage === 'practice') {
    targetHash = `#practice/${view.attempt.id}`;
    savedRoute = { stage: 'practice', attemptId: view.attempt.id };
  } else if (view.stage === 'review') {
    targetHash = `#review/${view.attempt.id}`;
    savedRoute = { stage: 'review', attemptId: view.attempt.id };
  }

  if (window.location.hash !== targetHash) {
    window.history.replaceState(null, '', targetHash);
  }
  try {
    localStorage.setItem(STORAGE_ROUTE_KEY, JSON.stringify(savedRoute));
  } catch {
    // ignore
  }
}

export function App() {
  const [view, setView] = useState<View>({ stage: 'dashboard' });
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Restore on initial load and handle browser back/forward (hashchange)
  useEffect(() => {
    let active = true;

    const restore = async () => {
      const route = parseRoute();
      if (route.stage === 'dashboard' || !route.attemptId) {
        if (active) {
          if (route.stage === 'prepare') {
            setView({ stage: 'prepare' });
          } else {
            setView({ stage: 'dashboard' });
          }
          setLoadingRoute(false);
        }
        return;
      }

      try {
        const attempt = await loadAttempt(route.attemptId);
        if (!active) return;

        if (route.stage === 'practice') {
          if (attempt.status === 'completed') {
            setView({ stage: 'review', attempt });
          } else {
            setView({ stage: 'practice', attempt });
          }
        } else if (route.stage === 'review') {
          setView({ stage: 'review', attempt });
        } else {
          setView({ stage: 'prepare', attempt, attemptId: attempt.id });
        }
      } catch {
        if (!active) return;
        setError('Could not restore previous test session. Returning to dashboard.');
        setView({ stage: 'dashboard' });
        window.history.replaceState(null, '', '#dashboard');
        try {
          localStorage.removeItem(STORAGE_ROUTE_KEY);
        } catch {
          // ignore
        }
      } finally {
        if (active) setLoadingRoute(false);
      }
    };

    void restore();

    const handleHashChange = () => {
      void restore();
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => {
      active = false;
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  // Update URL hash and localStorage whenever view state changes
  useEffect(() => {
    if (!loadingRoute) {
      updateBrowserUrl(view);
    }
  }, [view, loadingRoute]);

  const openAttempt = useCallback(async (id: string) => {
    setError(null);
    try {
      const attempt = await loadAttempt(id);
      if (attempt.status === 'completed') {
        setView({ stage: 'review', attempt });
      } else if (attempt.status === 'active') {
        setView({ stage: 'practice', attempt });
      } else {
        setView({ stage: 'prepare', attempt, attemptId: attempt.id });
      }
    } catch {
      setError('That test could not be opened. Your saved work is safe in local storage.');
    }
  }, []);

  const startPreparation = useCallback((attempt: AttemptRecord) => {
    setView({ stage: 'prepare', attempt, attemptId: attempt.id });
  }, []);

  const startPractice = useCallback((attempt: AttemptRecord) => {
    setView({ stage: 'practice', attempt });
  }, []);

  const finishedPractice = useCallback((attempt: AttemptRecord) => {
    setView({ stage: 'review', attempt });
  }, []);

  const handlePreparationRecordChange = useCallback((updated: AttemptRecord) => {
    setView((prev) => {
      if (
        prev.stage === 'prepare' &&
        prev.attempt?.id === updated.id &&
        prev.attempt?.revision === updated.revision
      ) {
        return prev;
      }
      return prev.stage === 'prepare' ? { ...prev, attempt: updated, attemptId: updated.id } : prev;
    });
  }, []);

  if (loadingRoute) {
    return (
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#64748b' }}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 36,
              height: 36,
              border: '3px solid #e2e8f0',
              borderTopColor: '#2563eb',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 14px',
            }}
          />
          <p style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: '#334155' }}>Restoring test session…</p>
          <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
        </div>
      </main>
    );
  }

  if (view.stage === 'practice') {
    return (
      <ErrorBoundary fallbackTitle="Practice Session encountered an error" onReset={() => setView({ stage: 'dashboard' })}>
        <Player
          attempt={view.attempt}
          phase={view.attempt.data.phase ?? 0}
          onExit={() => setView({ stage: 'dashboard' })}
          onFinish={finishedPractice}
        />
      </ErrorBoundary>
    );
  }

  if (view.stage === 'review') {
    return (
      <ErrorBoundary fallbackTitle="Review Screen encountered an error" onReset={() => setView({ stage: 'dashboard' })}>
        <Review
          data={view.attempt.data}
          attempt={view.attempt}
          onAttemptChange={(updated) => setView({ stage: 'review', attempt: updated })}
          onPractiseDrill={() => setView({ stage: 'prepare' })}
          onBackToDashboard={() => setView({ stage: 'dashboard' })}
        />
      </ErrorBoundary>
    );
  }

  if (view.stage === 'prepare') {
    return (
      <ErrorBoundary fallbackTitle="Preparation Screen encountered an error" onReset={() => setView({ stage: 'dashboard' })}>
        <Preparation
          initialAttemptId={view.attemptId}
          initialRecord={view.attempt}
          onOpenPractice={startPractice}
          onBack={() => setView({ stage: 'dashboard' })}
          onRecordChange={handlePreparationRecordChange}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary fallbackTitle="Dashboard encountered an error">
      {error && (
        <div style={{ maxWidth: 1100, margin: '16px auto', padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 6 }}>
          {error}
        </div>
      )}
      <Dashboard
        onOpenAttempt={openAttempt}
        onStartPreparation={startPreparation}
      />
    </ErrorBoundary>
  );
}
