import { useState } from 'react';
import Markdown from 'react-markdown';
import { AgentStep } from '../../../shared/types';

interface Props {
  description: string;
  steps: AgentStep[];
  summary?: string;
  clarify?: string;
  error?: string;
}

const SpinnerIcon = () => (
  <svg className="animate-spin h-3.5 w-3.5 text-blue-400 shrink-0" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="h-3.5 w-3.5 text-green-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  </svg>
);

const ErrorIcon = () => (
  <svg className="h-3.5 w-3.5 text-red-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
  </svg>
);

export function AgentView({ description, steps, summary, clarify, error }: Props) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (idx: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const hasTerminalState = !!summary || !!clarify || !!error;
  const isRunning = !hasTerminalState;

  return (
    <div className="space-y-3 max-w-2xl">
      {/* Summary card when done */}
      {summary && (
        <div className="bg-slate-800 border border-green-800/40 rounded-lg px-4 py-3
          prose prose-sm prose-invert
          prose-p:text-slate-300 prose-p:my-0.5
          prose-strong:text-white
          prose-ul:text-slate-300 prose-li:my-0">
          <Markdown>{summary}</Markdown>
        </div>
      )}

      {/* Clarification needed */}
      {clarify && (
        <div className="bg-slate-800 border border-blue-800/40 rounded-lg px-4 py-3 text-slate-300 text-sm">
          {clarify}
        </div>
      )}

      {/* Fatal error */}
      {error && (
        <div className="bg-red-950/30 border border-red-800 rounded-lg px-4 py-2 text-red-400 text-sm">
          Agent stopped: {error}
        </div>
      )}

      {/* Step list — always visible */}
      {steps.length > 0 && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-700 flex items-center gap-2">
            {isRunning && <SpinnerIcon />}
            <span className="text-slate-400 text-xs">{description}</span>
          </div>

          <div className="divide-y divide-slate-800">
            {steps.map((step) => (
              <div key={step.stepIndex} className="px-4 py-2.5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {step.status === 'running' && <SpinnerIcon />}
                    {step.status === 'done' && <CheckIcon />}
                    {step.status === 'error' && <ErrorIcon />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-slate-200 text-sm">{step.description}</p>
                    <p className="text-slate-500 text-xs font-mono mt-0.5 truncate">{step.command}</p>

                    {step.status === 'error' && step.error && (
                      <p className="text-red-400 text-xs mt-1">{step.error}</p>
                    )}

                    {step.status === 'done' && step.output && (
                      <>
                        <button
                          onClick={() => toggleStep(step.stepIndex)}
                          className="text-xs text-slate-500 hover:text-slate-300 mt-1 transition-colors"
                        >
                          {expandedSteps.has(step.stepIndex) ? 'Hide output ↑' : 'Show output ↓'}
                        </button>
                        {expandedSteps.has(step.stepIndex) && (
                          <pre className="mt-2 text-xs text-slate-400 bg-slate-950 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
                            {step.output}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waiting for first step */}
      {isRunning && steps.length === 0 && (
        <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3">
          <SpinnerIcon />
          <span className="text-slate-400 text-sm">{description}</span>
        </div>
      )}
    </div>
  );
}
