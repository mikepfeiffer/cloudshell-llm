import { useState, useEffect, useRef } from 'react';
import { useIsAuthenticated } from '@azure/msal-react';
import { LoginButton } from './components/LoginButton';
import { ChatInput } from './components/ChatInput';
import { CommandPreview } from './components/CommandPreview';
import { OutputView } from './components/OutputView';
import { PlanPreview } from './components/PlanPreview';
import { SynthesisView } from './components/SynthesisView';
import { ProvisioningTracker } from './components/ProvisioningTracker';
import { AgentView } from './components/AgentView';
import { SessionStatus } from './components/SessionStatus';
import { SettingsMenu } from './components/SettingsMenu';
import { useAuth } from './hooks/useAuth';
import { useChat, ChatEntry } from './hooks/useChat';
import { useCloudShell } from './hooks/useCloudShell';
import { useSettings } from './hooks/useSettings';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 75;

// Block until an async Azure operation completes. Used by plan steps so that
// dependent steps (e.g. create VM after NIC) don't start before prerequisites finish.
async function waitForOperation(
  token: string,
  pollUrl: string,
  getTokenFn: () => Promise<string>
): Promise<void> {
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const freshToken = await getTokenFn();
    const { pollOperation } = await import('./services/api');
    const result = await pollOperation(freshToken, pollUrl);
    if (result.status === 'Succeeded') return;
    if (result.status === 'Failed' || result.status === 'Canceled') {
      throw new Error(`Step ${result.status.toLowerCase()}${result.error ? `: ${result.error}` : ''}`);
    }
  }
  throw new Error('Operation timed out after waiting ~5 minutes');
}

// Extract the most useful error message from an axios or generic error
function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
    const serverMsg = axiosErr.response?.data?.error;
    if (serverMsg) return serverMsg;
    if (axiosErr.message) return axiosErr.message;
  }
  return 'Unknown error';
}

export default function App() {
  const isAuthenticated = useIsAuthenticated();
  const { account, logout, getToken } = useAuth();
  const { entries, loading, sendMessage, addOutput, addProvisioning, addStreamingSynthesis, addError, clearHistory } = useChat();
  const { sessionState, provisioning, error: shellError, provision, execute } = useCloudShell();
  const { settings, loadSettings, saveSettings } = useSettings();
  const [executingId, setExecutingId] = useState<string | null>(null);
  const autoExecutedRef = useRef<Set<string>>(new Set());

  // Auto-initialize session and load settings as soon as the user is authenticated
  useEffect(() => {
    if (isAuthenticated && !sessionState.isConnected && !provisioning) {
      provision();
      getToken().then(loadSettings).catch(() => {});
    }
  }, [isAuthenticated]);

  // Auto-approve commands/plans when confirmation is disabled.
  // Destructive commands always require explicit confirmation.
  useEffect(() => {
    if (settings.requireConfirmation) return;
    if (executingId) return;

    const last = entries[entries.length - 1];
    if (!last || autoExecutedRef.current.has(last.id)) return;

    if (last.type === 'command' && last.pendingCommand) {
      if (last.pendingCommand.risk_level === 'destructive') return;
      autoExecutedRef.current.add(last.id);
      handleApprove(last);
    } else if (last.type === 'plan' && last.pendingPlan) {
      if (last.pendingPlan.risk_level === 'destructive') return;
      autoExecutedRef.current.add(last.id);
      handleApprovePlan(last);
    }
  }, [entries, executingId]);

  if (!isAuthenticated) {
    return <LoginButton />;
  }

  // Single command — optionally synthesize after execution
  const handleApprove = async (entry: ChatEntry) => {
    if (!entry.pendingCommand) return;
    setExecutingId(entry.id);
    const { rest_method, rest_url, rest_body, command, description } = entry.pendingCommand;
    const synthesize = entry.pendingCommand.synthesize;

    try {
      const { output, pollUrl } = await execute(rest_method, rest_url, rest_body);

      // Async provisioning operation — hand off to ProvisioningTracker
      if (pollUrl) {
        addProvisioning(description || command, pollUrl);
        return;
      }

      if (synthesize) {
        const entryIndex = entries.findIndex((e) => e.id === entry.id);
        const questionEntry = entries.slice(0, entryIndex).reverse().find((e) => e.type === 'user');
        const question = questionEntry?.content ?? command;

        try {
          await addStreamingSynthesis(question, [{ command, output }]);
        } catch {
          addOutput(command, output);
        }
      } else {
        addOutput(command, output);
      }
    } catch (err) {
      addError(`Execution failed: ${getErrorMessage(err)}`);
    } finally {
      setExecutingId(null);
    }
  };

  // Multi-step plan — execute all steps sequentially, then synthesize
  const handleApprovePlan = async (entry: ChatEntry) => {
    if (!entry.pendingPlan) return;
    setExecutingId(entry.id);
    const { steps } = entry.pendingPlan;

    // Find original question
    const entryIndex = entries.findIndex((e) => e.id === entry.id);
    const questionEntry = entries.slice(0, entryIndex).reverse().find((e) => e.type === 'user');
    const question = questionEntry?.content ?? entry.content;

    const results: Array<{ command: string; output: string }> = [];

    try {
      for (const step of steps) {
        const { output, pollUrl } = await execute(step.rest_method, step.rest_url, step.rest_body);
        if (pollUrl) {
          // Block here — the next step may depend on this resource existing
          await waitForOperation(await getToken(), pollUrl, getToken);
          // Azure ARM can report "Succeeded" before the resource is reachable by subsequent calls.
          // A short stabilization wait avoids 404s on dependent steps.
          await new Promise((r) => setTimeout(r, 8000));
        }
        results.push({ command: step.command, output });
      }

      try {
        await addStreamingSynthesis(question, results);
      } catch {
        // Synthesis failed — show each step's raw output
        for (const r of results) {
          addOutput(r.command, r.output);
        }
      }
    } catch (err) {
      addError(`Plan execution failed: ${getErrorMessage(err)}`);
    } finally {
      setExecutingId(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-900">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-slate-800">
        <h1 className="text-white font-semibold">CloudShell LLM</h1>
        <div className="flex items-center gap-5">
          <SessionStatus
            session={sessionState}
            provisioning={provisioning}
          />
          <span className="text-slate-400 text-sm">{account?.name ?? account?.username}</span>
          <SettingsMenu
            settings={settings}
            onSave={async (updates) => {
              const token = await getToken();
              await saveSettings(token, updates);
            }}
          />
          <button
            onClick={logout}
            className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Shell error banner */}
      {shellError && (
        <div className="bg-red-900/40 border-b border-red-800 px-6 py-2 text-red-300 text-sm">
          {shellError}
        </div>
      )}

      {/* Chat area */}
      <main className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-w-4xl mx-auto w-full">
        {entries.length === 0 && (
          <div className="text-center mt-16 space-y-2">
            <p className="text-slate-400">
              Describe what you want to do in Azure — no commands needed.
            </p>
            <p className="text-slate-600 text-sm">
              e.g. "show me what's in my webservers resource group" · "how many VMs do I have and where are they?" · "create an Ubuntu VM in webservers"
            </p>
          </div>
        )}

        {entries.map((entry) => (
          <EntryView
            key={entry.id}
            entry={entry}
            executing={executingId === entry.id}
            requireConfirmation={settings.requireConfirmation}
            onApprove={() => handleApprove(entry)}
            onApprovePlan={() => handleApprovePlan(entry)}
            onReject={() => {/* dismissed silently */}}
          />
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <span className="animate-pulse">Thinking...</span>
          </div>
        )}
      </main>

      {/* Input */}
      <footer className="border-t border-slate-800 px-6 py-4 max-w-4xl mx-auto w-full">
        <ChatInput
          onSend={sendMessage}
          disabled={loading || !!executingId}
        />
        {entries.length > 0 && (
          <button
            onClick={clearHistory}
            className="mt-2 text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            Clear conversation
          </button>
        )}
      </footer>
    </div>
  );
}

function EntryView({
  entry,
  executing,
  requireConfirmation,
  onApprove,
  onApprovePlan,
  onReject,
}: {
  entry: ChatEntry;
  executing: boolean;
  requireConfirmation: boolean;
  onApprove: () => void;
  onApprovePlan: () => void;
  onReject: () => void;
}) {
  if (entry.type === 'user') {
    return (
      <div className="flex justify-end">
        <div className="bg-blue-700 text-white rounded-lg px-4 py-2 max-w-xl text-sm">
          {entry.content}
        </div>
      </div>
    );
  }

  if (entry.type === 'clarification') {
    return (
      <div className="flex justify-start">
        <div className="bg-slate-800 text-slate-300 rounded-lg px-4 py-2 max-w-xl text-sm
          prose prose-sm prose-invert
          prose-p:text-slate-300 prose-p:my-0.5
          prose-strong:text-white
          prose-code:text-blue-300 prose-code:bg-slate-900 prose-code:px-1 prose-code:rounded prose-code:text-xs">
          <Markdown remarkPlugins={[remarkGfm]}>{entry.content}</Markdown>
        </div>
      </div>
    );
  }

  if (entry.type === 'agent') {
    return (
      <AgentView
        description={entry.content}
        steps={entry.agentSteps ?? []}
        summary={entry.agentSummary}
        clarify={entry.agentClarify}
        error={entry.agentError}
      />
    );
  }

  if (entry.type === 'command' && entry.pendingCommand) {
    // Always show the preview for destructive commands; respect config for others
    if (!requireConfirmation && entry.pendingCommand.risk_level !== 'destructive') {
      return executing ? (
        <div className="text-slate-500 text-xs font-mono animate-pulse">
          Running: {entry.pendingCommand.command}
        </div>
      ) : null;
    }
    return (
      <div className="max-w-2xl">
        <CommandPreview
          {...entry.pendingCommand}
          onApprove={onApprove}
          onReject={onReject}
          executing={executing}
        />
      </div>
    );
  }

  if (entry.type === 'plan' && entry.pendingPlan) {
    if (!requireConfirmation && entry.pendingPlan.risk_level !== 'destructive') {
      return executing ? (
        <div className="text-slate-500 text-xs animate-pulse">
          Running plan: {entry.pendingPlan.description}
        </div>
      ) : null;
    }
    return (
      <div className="max-w-2xl">
        <PlanPreview
          {...entry.pendingPlan}
          onApprove={onApprovePlan}
          onReject={onReject}
          executing={executing}
        />
      </div>
    );
  }

  if (entry.type === 'provisioning' && entry.pollUrl) {
    return (
      <div className="max-w-2xl">
        <ProvisioningTracker description={entry.content} pollUrl={entry.pollUrl} />
      </div>
    );
  }

  if (entry.type === 'synthesis' && entry.results) {
    return (
      <div className="max-w-2xl">
        <SynthesisView
          message={entry.synthesisMessage ?? ''}
          isStreaming={entry.isStreaming}
          results={entry.results}
        />
      </div>
    );
  }

  if (entry.type === 'output') {
    return <OutputView content={entry.content} />;
  }

  if (entry.type === 'error') {
    return (
      <div className="bg-red-950/30 border border-red-800 rounded-lg px-4 py-2 text-red-400 text-sm">
        {entry.content}
      </div>
    );
  }

  return null;
}
