import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { pollOperation } from '../services/api';

interface Props {
  description: string;
  pollUrl: string;
}

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 75; // ~5 minutes

export function ProvisioningTracker({ description, pollUrl }: Props) {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<'InProgress' | 'Succeeded' | 'Failed' | 'Canceled' | 'TimedOut'>('InProgress');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0); // seconds

  useEffect(() => {
    let cancelled = false;
    let pollCount = 0;

    const tick = setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);

    const doPoll = async () => {
      while (!cancelled && pollCount < MAX_POLLS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (cancelled) break;

        pollCount++;
        try {
          const token = await getToken();
          const result = await pollOperation(token, pollUrl);

          if (result.status === 'Succeeded') {
            setStatus('Succeeded');
            break;
          }
          if (result.status === 'Failed' || result.status === 'Canceled') {
            setStatus(result.status);
            setErrorMessage(result.error ?? null);
            break;
          }
          // InProgress — keep polling
        } catch {
          // Transient network error — keep trying
        }
      }

      if (pollCount >= MAX_POLLS && !cancelled) {
        setStatus('TimedOut');
      }
      clearInterval(tick);
    };

    doPoll();
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [pollUrl]);

  const formatElapsed = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  if (status === 'InProgress') {
    return (
      <div className="flex items-center gap-3 bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
        <svg className="animate-spin h-4 w-4 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        <div className="min-w-0">
          <p className="text-slate-200 text-sm">{description}</p>
          <p className="text-slate-500 text-xs mt-0.5">Provisioning… {formatElapsed(elapsed)}</p>
        </div>
      </div>
    );
  }

  if (status === 'Succeeded') {
    return (
      <div className="flex items-center gap-3 bg-slate-800 border border-green-800/50 rounded-lg px-4 py-3">
        <svg className="h-4 w-4 text-green-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <div>
          <p className="text-slate-200 text-sm">{description}</p>
          <p className="text-green-400 text-xs mt-0.5">Provisioned successfully in {formatElapsed(elapsed)}</p>
        </div>
      </div>
    );
  }

  if (status === 'TimedOut') {
    return (
      <div className="flex items-center gap-3 bg-slate-800 border border-yellow-800/50 rounded-lg px-4 py-3">
        <svg className="h-4 w-4 text-yellow-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <div>
          <p className="text-slate-200 text-sm">{description}</p>
          <p className="text-yellow-400 text-xs mt-0.5">Still provisioning after {formatElapsed(elapsed)} — check the Azure portal for status</p>
        </div>
      </div>
    );
  }

  // Failed or Canceled
  return (
    <div className="flex items-center gap-3 bg-slate-800 border border-red-800/50 rounded-lg px-4 py-3">
      <svg className="h-4 w-4 text-red-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
      <div>
        <p className="text-slate-200 text-sm">{description}</p>
        <p className="text-red-400 text-xs mt-0.5">
          {status === 'Canceled' ? 'Operation was canceled' : `Failed${errorMessage ? `: ${errorMessage}` : ''}`}
        </p>
      </div>
    </div>
  );
}
