import { useState, useCallback } from 'react';
import {
  DEFAULT_LLM_MODEL_BY_PROVIDER,
  DEFAULT_LLM_PROVIDER,
} from '../../../shared/types';
import { UserSettings } from '../../../shared/types';
import { getSettings, updateSettings } from '../services/api';

const DEFAULT_SETTINGS: UserSettings = {
  requireConfirmation: false,
  defaultResourceGroup: '',
  llmProvider: DEFAULT_LLM_PROVIDER,
  llmModel: DEFAULT_LLM_MODEL_BY_PROVIDER[DEFAULT_LLM_PROVIDER],
};

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const loadSettings = useCallback(async (token: string) => {
    try {
      const s = await getSettings(token);
      setSettings(s);
    } catch {
      // Use defaults if load fails
    } finally {
      setLoaded(true);
    }
  }, []);

  const saveSettings = useCallback(async (token: string, updates: Partial<UserSettings>) => {
    const updated = await updateSettings(token, updates);
    setSettings(updated);
    return updated;
  }, []);

  return { settings, loaded, loadSettings, saveSettings };
}
