import { useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { sendChatMessage, runAgent, streamSynthesis } from '../services/api';
import { ChatMessage } from '../types/index';
import { AgentStep } from '../../../shared/types';

export type { AgentStep };

export interface PlanStep {
  command: string;
  description: string;
  rest_method: string;
  rest_url: string;
  rest_body?: Record<string, unknown>;
}

export interface ChatEntry {
  id: string;
  type: 'user' | 'clarification' | 'command' | 'plan' | 'synthesis' | 'output' | 'provisioning' | 'error' | 'agent';
  content: string;
  pollUrl?: string; // For provisioning entries
  pendingCommand?: {
    command: string;
    description: string;
    risk_level: 'read' | 'modify' | 'destructive';
    rest_method: string;
    rest_url: string;
    rest_body?: Record<string, unknown>;
    synthesize?: boolean;
  };
  pendingPlan?: {
    description: string;
    risk_level: 'read' | 'modify' | 'destructive';
    steps: PlanStep[];
  };
  // For synthesis entries
  synthesisMessage?: string;
  isStreaming?: boolean;
  results?: Array<{ command: string; output: string }>;
  // For agent entries
  agentSteps?: AgentStep[];
  agentSummary?: string;
  agentClarify?: string;
  agentError?: string;
  timestamp: number;
}

export function useChat() {
  const { getToken } = useAuth();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const addEntry = (entry: Omit<ChatEntry, 'id' | 'timestamp'>) => {
    const full: ChatEntry = { ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
    setEntries((prev) => [...prev, full]);
    return full;
  };

  const updateEntry = (id: string, updater: (e: ChatEntry) => ChatEntry) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? updater(e) : e)));
  };

  const sendMessage = useCallback(async (message: string) => {
    addEntry({ type: 'user', content: message });
    setLoading(true);

    const updatedHistory: ChatMessage[] = [
      ...history,
      { role: 'user', content: message, timestamp: Date.now() },
    ];

    try {
      const token = await getToken();
      const result = await sendChatMessage(token, message, history);

      if (result.type === 'clarification') {
        addEntry({ type: 'clarification', content: result.message });
        setHistory([
          ...updatedHistory,
          { role: 'assistant', content: result.message, timestamp: Date.now() },
        ]);
      } else if (result.type === 'agent') {
        // Create the agent entry immediately so the user sees it start
        const entryId = crypto.randomUUID();
        const agentEntry: ChatEntry = {
          id: entryId,
          type: 'agent',
          content: result.description,
          agentSteps: [],
          timestamp: Date.now(),
        };
        setEntries((prev) => [...prev, agentEntry]);
        setHistory([
          ...updatedHistory,
          { role: 'assistant', content: `Agent: ${result.description}`, timestamp: Date.now() },
        ]);

        // Stream the agent loop — loading stays true until complete
        await runAgent(token, result.goal, (event) => {
          if (event.type === 'step_start') {
            updateEntry(entryId, (e) => ({
              ...e,
              agentSteps: [
                ...(e.agentSteps ?? []).filter((s) => s.stepIndex !== event.stepIndex),
                { stepIndex: event.stepIndex, description: event.description, command: event.command, status: 'running' },
              ].sort((a, b) => a.stepIndex - b.stepIndex),
            }));
          } else if (event.type === 'step_done') {
            updateEntry(entryId, (e) => ({
              ...e,
              agentSteps: (e.agentSteps ?? []).map((s) =>
                s.stepIndex === event.stepIndex ? { ...s, status: 'done', output: event.output } : s
              ),
            }));
          } else if (event.type === 'step_error') {
            updateEntry(entryId, (e) => ({
              ...e,
              agentSteps: (e.agentSteps ?? []).map((s) =>
                s.stepIndex === event.stepIndex ? { ...s, status: 'error', error: event.error } : s
              ),
            }));
          } else if (event.type === 'done') {
            updateEntry(entryId, (e) => ({ ...e, agentSummary: event.summary }));
            setHistory((prev) => [
              ...prev,
              { role: 'assistant', content: event.summary, timestamp: Date.now() },
            ]);
          } else if (event.type === 'clarify') {
            updateEntry(entryId, (e) => ({ ...e, agentClarify: event.message }));
          } else if (event.type === 'error') {
            updateEntry(entryId, (e) => ({ ...e, agentError: event.message }));
          }
        });
      } else if (result.type === 'plan') {
        addEntry({
          type: 'plan',
          content: result.description,
          pendingPlan: {
            description: result.description,
            risk_level: result.risk_level,
            steps: result.steps,
          },
        });
        setHistory([
          ...updatedHistory,
          { role: 'assistant', content: `Plan: ${result.description}`, timestamp: Date.now() },
        ]);
      } else {
        addEntry({
          type: 'command',
          content: result.description,
          pendingCommand: {
            command: result.command,
            description: result.description,
            risk_level: result.risk_level,
            rest_method: result.rest_method,
            rest_url: result.rest_url,
            rest_body: result.rest_body,
            synthesize: result.synthesize,
          },
        });
        setHistory([
          ...updatedHistory,
          { role: 'assistant', content: `Command: ${result.command}`, timestamp: Date.now() },
        ]);
      }
    } catch {
      addEntry({ type: 'error', content: 'Failed to get a response. Please try again.' });
    } finally {
      setLoading(false);
    }
  }, [getToken, history]);

  const addOutput = useCallback((command: string, output: string) => {
    addEntry({ type: 'output', content: output });
    setHistory((prev) => [
      ...prev,
      { role: 'user', content: `Result of \`${command}\`:\n${output.slice(0, 500)}`, timestamp: Date.now() },
    ]);
  }, []);

  const addProvisioning = useCallback((description: string, pollUrl: string) => {
    addEntry({ type: 'provisioning', content: description, pollUrl });
  }, []);

  const addStreamingSynthesis = useCallback(async (
    question: string,
    results: Array<{ command: string; output: string }>
  ) => {
    const entryId = crypto.randomUUID();
    setEntries((prev) => [...prev, {
      id: entryId,
      type: 'synthesis',
      content: '',
      synthesisMessage: '',
      isStreaming: true,
      results,
      timestamp: Date.now(),
    }]);

    const token = await getToken();
    let fullMessage = '';
    try {
      for await (const tok of streamSynthesis(token, question, results)) {
        fullMessage += tok;
        setEntries((prev) => prev.map((e) =>
          e.id === entryId ? { ...e, synthesisMessage: fullMessage, content: fullMessage } : e
        ));
      }
    } finally {
      setEntries((prev) => prev.map((e) =>
        e.id === entryId ? { ...e, isStreaming: false } : e
      ));
      if (fullMessage) {
        setHistory((prev) => [...prev, { role: 'assistant', content: fullMessage, timestamp: Date.now() }]);
      }
    }
  }, [getToken]);

  const addError = useCallback((msg: string) => {
    addEntry({ type: 'error', content: msg });
  }, []);

  const clearHistory = useCallback(() => {
    setEntries([]);
    setHistory([]);
  }, []);

  return { entries, loading, sendMessage, addOutput, addProvisioning, addStreamingSynthesis, addError, clearHistory };
}
