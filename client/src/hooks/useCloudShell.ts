import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { provisionShell, executeCommand, deleteShellSession, getShellStatus } from '../services/api';
import { SessionState } from '../types/index';

export function useCloudShell() {
  const { getToken } = useAuth();
  const [sessionState, setSessionState] = useState<SessionState>({ isConnected: false });
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provision = useCallback(async () => {
    setProvisioning(true);
    setError(null);
    try {
      const token = await getToken();
      const result = await provisionShell(token);
      setSessionState({
        isConnected: result.status === 'connected',
        subscriptionId: result.subscriptionId,
        subscriptionName: result.subscriptionName,
      });
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { error?: string } }; message?: string };
      const msg = axiosError.response?.data?.error ?? axiosError.message ?? 'Failed to initialize session';
      setError(msg);
    } finally {
      setProvisioning(false);
    }
  }, [getToken]);

  const execute = useCallback(async (
    rest_method: string,
    rest_url: string,
    rest_body?: Record<string, unknown>
  ): Promise<{ output: string; pollUrl: string | null }> => {
    const token = await getToken();
    const result = await executeCommand(token, rest_method, rest_url, rest_body);
    return { output: result.output, pollUrl: result.pollUrl };
  }, [getToken]);

  const disconnect = useCallback(async () => {
    try {
      const token = await getToken();
      await deleteShellSession(token);
    } finally {
      setSessionState({ isConnected: false });
    }
  }, [getToken]);

  const refreshStatus = useCallback(async () => {
    try {
      const token = await getToken();
      const status = await getShellStatus(token);
      setSessionState(status);
    } catch {
      // Non-fatal
    }
  }, [getToken]);

  return { sessionState, provisioning, error, provision, execute, disconnect, refreshStatus };
}
