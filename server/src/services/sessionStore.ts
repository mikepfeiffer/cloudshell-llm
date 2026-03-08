export interface ShellSession {
  subscriptionId?: string;
  subscriptionName?: string;
  defaultResourceGroup?: string;
}

const sessions = new Map<string, ShellSession>();

export function getSession(userId: string): ShellSession | undefined {
  return sessions.get(userId);
}

export function setSession(userId: string, session: ShellSession): void {
  sessions.set(userId, session);
}

export function updateSession(userId: string, updates: Partial<ShellSession>): void {
  sessions.set(userId, { ...(sessions.get(userId) ?? {}), ...updates });
}

export function deleteSession(userId: string): void {
  sessions.delete(userId);
}
