import fs from 'fs';
import path from 'path';

const SETTINGS_FILE =
  process.env.SETTINGS_FILE ?? path.resolve(__dirname, '../../data/settings.json');

export interface UserSettings {
  requireConfirmation: boolean;
  defaultResourceGroup: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  requireConfirmation: false,
  defaultResourceGroup: '',
};

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
  return { ...DEFAULT_SETTINGS, ...(all[userId] ?? {}) };
}

export function saveUserSettings(userId: string, updates: Partial<UserSettings>): UserSettings {
  const all = loadAll();
  all[userId] = { ...DEFAULT_SETTINGS, ...(all[userId] ?? {}), ...updates };
  saveAll(all);
  return all[userId];
}
