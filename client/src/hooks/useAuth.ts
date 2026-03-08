import { useMsal } from '@azure/msal-react';
import { useCallback } from 'react';
import { loginRequest, managementTokenRequest } from '../config/authConfig';

export function useAuth() {
  const { instance, accounts } = useMsal();
  const account = accounts[0] ?? null;

  const login = useCallback(async () => {
    await instance.loginPopup(loginRequest);
  }, [instance]);

  const logout = useCallback(async () => {
    await instance.logoutPopup({ account });
  }, [instance, account]);

  const getToken = useCallback(async (): Promise<string> => {
    if (!account) throw new Error('Not authenticated');
    const result = await instance.acquireTokenSilent({
      ...managementTokenRequest,
      account,
    });
    return result.accessToken;
  }, [instance, account]);

  return {
    account,
    isAuthenticated: !!account,
    login,
    logout,
    getToken,
  };
}
