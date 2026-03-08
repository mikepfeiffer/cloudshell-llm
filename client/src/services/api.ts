import axios from 'axios';
import { ChatMessage } from '../types/index';

export type AgentEvent =
  | { type: 'step_start'; stepIndex: number; description: string; command: string }
  | { type: 'step_done'; stepIndex: number; output: string }
  | { type: 'step_error'; stepIndex: number; error: string }
  | { type: 'done'; summary: string }
  | { type: 'clarify'; message: string }
  | { type: 'error'; message: string };

export async function* streamSynthesis(
  token: string,
  question: string,
  results: Array<{ command: string; output: string }>
): AsyncGenerator<string> {
  const response = await fetch('/api/chat/synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question, results }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Synthesis request failed: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6)) as { token?: string; done?: boolean; error?: string };
          if (data.token) yield data.token;
          if (data.done || data.error) return;
        } catch { /* skip malformed */ }
      }
    }
  }
}

const BASE = '/api';

function makeClient(token: string) {
  return axios.create({
    baseURL: BASE,
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function sendChatMessage(
  token: string,
  message: string,
  history: ChatMessage[]
) {
  const { data } = await makeClient(token).post('/chat', { message, history });
  return data as
    | {
        type: 'command';
        command: string;
        description: string;
        risk_level: 'read' | 'modify' | 'destructive';
        rest_method: string;
        rest_url: string;
        rest_body?: Record<string, unknown>;
        synthesize?: boolean;
      }
    | {
        type: 'plan';
        description: string;
        risk_level: 'read' | 'modify' | 'destructive';
        steps: Array<{
          command: string;
          description: string;
          rest_method: string;
          rest_url: string;
          rest_body?: Record<string, unknown>;
        }>;
        synthesize: true;
      }
    | { type: 'clarification'; message: string }
    | { type: 'agent'; goal: string; description: string };
}

export async function runAgent(
  token: string,
  goal: string,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch('/api/agent/run', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ goal }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Agent request failed: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6)) as AgentEvent;
          onEvent(event);
        } catch { /* skip malformed */ }
      }
    }
  }
}

export async function provisionShell(token: string) {
  const { data } = await makeClient(token).post('/shell/provision');
  return data as {
    status: string;
    subscriptionId?: string;
    subscriptionName?: string;
  };
}

export async function executeCommand(
  token: string,
  rest_method: string,
  rest_url: string,
  rest_body?: Record<string, unknown>
) {
  const { data } = await makeClient(token).post('/shell/execute', { rest_method, rest_url, rest_body });
  return data as { output: string; pollUrl: string | null; executedAt: number };
}

export async function getShellStatus(token: string) {
  const { data } = await makeClient(token).get('/shell/status');
  return data as {
    isConnected: boolean;
    subscriptionId?: string;
    subscriptionName?: string;
    defaultResourceGroup?: string;
  };
}

export async function deleteShellSession(token: string) {
  await makeClient(token).delete('/shell/session');
}

export async function pollOperation(token: string, url: string) {
  const { data } = await makeClient(token).get('/shell/poll', { params: { url } });
  return data as {
    status: 'InProgress' | 'Succeeded' | 'Failed' | 'Canceled';
    error?: string;
  };
}

