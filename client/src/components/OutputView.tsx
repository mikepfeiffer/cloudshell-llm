import { useState } from 'react';

interface Props {
  content: string;
}

// Azure properties to surface in summary view, in priority order
const SUMMARY_KEYS = ['name', 'type', 'location', 'kind', 'provisioningState'];

function extractSummaryFields(obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const key of SUMMARY_KEYS) {
    if (obj[key] != null) {
      result[key] = String(obj[key]);
    }
  }

  // Pull provisioningState from nested properties if not at top level
  if (!result.provisioningState && obj.properties && typeof obj.properties === 'object') {
    const props = obj.properties as Record<string, unknown>;
    if (props.provisioningState != null) {
      result.provisioningState = String(props.provisioningState);
    }
  }

  return result;
}

function formatLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase());
}

function formatType(type: string): string {
  // "Microsoft.Network/networkSecurityGroups" → "Network Security Groups"
  const parts = type.split('/');
  const resource = parts[parts.length - 1];
  return resource.replace(/([A-Z])/g, ' $1').trim();
}

function provisioningStateColor(state: string): string {
  switch (state.toLowerCase()) {
    case 'succeeded': return 'text-green-400';
    case 'failed': return 'text-red-400';
    case 'running':
    case 'creating':
    case 'updating': return 'text-yellow-400';
    default: return 'text-slate-400';
  }
}

function SummaryTable({ items }: { items: Record<string, unknown>[] }) {
  // Determine which columns are present across all items
  const columns = SUMMARY_KEYS.filter((key) =>
    items.some((item) => {
      if (item[key] != null) return true;
      if (key === 'provisioningState' && item.properties && typeof item.properties === 'object') {
        return (item.properties as Record<string, unknown>).provisioningState != null;
      }
      return false;
    })
  );

  if (columns.length === 0) {
    return <p className="text-slate-500 text-sm">No summary fields available.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="border-b border-slate-700">
            {columns.map((col) => (
              <th key={col} className="pb-2 pr-6 text-slate-400 font-medium whitespace-nowrap">
                {formatLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const fields = extractSummaryFields(item);
            return (
              <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                {columns.map((col) => {
                  const val = fields[col] ?? '—';
                  return (
                    <td key={col} className="py-2 pr-6 text-slate-300 whitespace-nowrap">
                      {col === 'type' ? (
                        <span className="text-slate-400 text-xs">{formatType(val)}</span>
                      ) : col === 'provisioningState' ? (
                        <span className={`text-xs font-medium ${provisioningStateColor(val)}`}>{val}</span>
                      ) : (
                        val
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-slate-600 text-xs">{items.length} result{items.length !== 1 ? 's' : ''}</p>
    </div>
  );
}

function SummaryCard({ item }: { item: Record<string, unknown> }) {
  const fields = extractSummaryFields(item);
  const entries = Object.entries(fields);

  if (entries.length === 0) {
    return <p className="text-slate-500 text-sm">No summary fields available.</p>;
  }

  return (
    <dl className="space-y-2">
      {entries.map(([key, val]) => (
        <div key={key} className="flex gap-4">
          <dt className="text-slate-500 text-sm w-36 shrink-0">{formatLabel(key)}</dt>
          <dd className={`text-sm ${key === 'provisioningState' ? provisioningStateColor(val) : 'text-slate-300'}`}>
            {key === 'type' ? formatType(val) : val}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function OutputView({ content }: Props) {
  const [tab, setTab] = useState<'summary' | 'json'>('summary');

  let parsed: unknown = null;
  let parseError = false;
  try {
    parsed = JSON.parse(content);
  } catch {
    parseError = true;
  }

  const isArray = Array.isArray(parsed);
  const isObject = !isArray && parsed !== null && typeof parsed === 'object';
  const canSummarize = !parseError && (isArray || isObject);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden max-w-full">
      {/* Tab bar */}
      {canSummarize && (
        <div className="flex border-b border-slate-800">
          <button
            onClick={() => setTab('summary')}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              tab === 'summary'
                ? 'text-white border-b-2 border-blue-500 bg-slate-900'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Summary
          </button>
          <button
            onClick={() => setTab('json')}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              tab === 'json'
                ? 'text-white border-b-2 border-blue-500 bg-slate-900'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            JSON
          </button>
        </div>
      )}

      <div className="p-4">
        {!canSummarize || tab === 'json' ? (
          <pre className="font-mono text-xs text-green-400 whitespace-pre-wrap overflow-x-auto">
            {content || '(no output)'}
          </pre>
        ) : isArray ? (
          <SummaryTable items={(parsed as unknown[]).filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)} />
        ) : (
          <SummaryCard item={parsed as Record<string, unknown>} />
        )}
      </div>
    </div>
  );
}
