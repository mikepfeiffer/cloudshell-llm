import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  message: string;
  isStreaming?: boolean;
  results: Array<{ command: string; output: string }>;
}

export function SynthesisView({ message, isStreaming, results }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="space-y-2">
      {/* Conversational response */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3">
        <div className="prose prose-sm prose-invert max-w-none
          prose-p:text-slate-200 prose-p:leading-relaxed prose-p:my-1
          prose-strong:text-white
          prose-ul:text-slate-200 prose-ul:my-1 prose-ul:pl-4
          prose-ol:text-slate-200 prose-ol:my-1 prose-ol:pl-4
          prose-li:my-0.5
          prose-code:text-blue-300 prose-code:bg-slate-900 prose-code:px-1 prose-code:rounded prose-code:text-xs
          prose-headings:text-white prose-headings:font-semibold">
          {message ? (
            <Markdown remarkPlugins={[remarkGfm]}>{message}</Markdown>
          ) : (
            <span className="text-slate-500 text-sm animate-pulse">Thinking...</span>
          )}
          {isStreaming && message && (
            <span className="inline-block w-0.5 h-4 bg-blue-400 animate-pulse ml-0.5 align-middle" />
          )}
        </div>
      </div>

      {/* Raw data toggle — hidden while streaming */}
      {!isStreaming && (
        <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <span>Raw data ({results.length} {results.length === 1 ? 'call' : 'calls'})</span>
            <span>{expanded ? '▲' : '▼'}</span>
          </button>

          {expanded && (
            <>
              {/* Tabs — only show if multiple steps */}
              {results.length > 1 && (
                <div className="flex border-t border-slate-800">
                  {results.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveTab(i)}
                      className={`px-4 py-2 text-xs font-medium transition-colors truncate max-w-[200px] ${
                        activeTab === i
                          ? 'text-white border-b-2 border-blue-500 bg-slate-900'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                      title={r.command}
                    >
                      Step {i + 1}
                    </button>
                  ))}
                </div>
              )}

              {/* Command label */}
              <div className="border-t border-slate-800 px-4 pt-2 pb-1">
                <code className="text-xs text-slate-500 font-mono">{results[activeTab]?.command}</code>
              </div>

              {/* JSON output */}
              <div className="px-4 pb-4">
                <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap overflow-x-auto">
                  {results[activeTab]?.output || '(no output)'}
                </pre>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
