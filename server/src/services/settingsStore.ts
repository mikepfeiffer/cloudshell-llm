import fs from 'fs';
import path from 'path';
import {
  DEFAULT_LLM_MODEL_BY_PROVIDER,
  DEFAULT_LLM_PROVIDER,
  LLM_PROVIDER_MODELS,
  LlmProvider,
  UserSettings as SharedUserSettings,
} from '../../../shared/types';

export type UserSettings = SharedUserSettings;

const SETTINGS_FILE =
  process.env.SETTINGS_FILE ?? path.resolve(__dirname, '../../data/settings.json');

export const DEFAULT_SETTINGS: UserSettings = {
  requireConfirmation: false,
  defaultResourceGroup: '',
  llmProvider: DEFAULT_LLM_PROVIDER,
  llmModel: DEFAULT_LLM_MODEL_BY_PROVIDER[DEFAULT_LLM_PROVIDER],
};

export function coerceUserSettings(settings?: Partial<UserSettings>): UserSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
  const provider = (Object.keys(LLM_PROVIDER_MODELS) as LlmProvider[]).includes(
    merged.llmProvider as LlmProvider
  )
    ? (merged.llmProvider as LlmProvider)
    : DEFAULT_LLM_PROVIDER;
  const model = LLM_PROVIDER_MODELS[provider].includes(merged.llmModel)
    ? merged.llmModel
    : DEFAULT_LLM_MODEL_BY_PROVIDER[provider];

  return {
    ...merged,
    llmProvider: provider,
    llmModel: model,
  };
}

function loadAll(): Record<string, UserSettings> {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) as Record<string, UserSettings>;
  } catch {
    return {};
  }
}

function saveAll(data: Record<string, UserSettings>): void {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

export function getUserSettings(userId: string): UserSettings {
  const all = loadAll();
  return coerceUserSettings(all[userId]);
}

export function saveUserSettings(userId: string, updates: Partial<UserSettings>): UserSettings {
  const all = loadAll();
  all[userId] = coerceUserSettings({ ...(all[userId] ?? {}), ...updates });
  saveAll(all);
  return all[userId];
}
