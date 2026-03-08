import { useState } from 'react';
import { RiskBadge } from './RiskBadge';

interface Props {
  command: string;
  description: string;
  risk_level: 'read' | 'modify' | 'destructive';
  rest_method?: string;
  rest_url?: string;
  onApprove: () => void;
  onReject: () => void;
  executing?: boolean;
  [key: string]: unknown;
}

export function CommandPreview({ command, description, risk_level, rest_method, rest_url, onApprove, onReject, executing }: Props) {
  const [confirmText, setConfirmText] = useState('');
  const requiresTypedConfirm = risk_level === 'destructive';
  const confirmPhrase = 'confirm';

  const canExecute = requiresTypedConfirm
    ? confirmText.toLowerCase() === confirmPhrase
    : true;

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${
      risk_level === 'destructive'
        ? 'border-red-800 bg-red-950/30'
        : risk_level === 'modify'
        ? 'border-yellow-800 bg-yellow-950/20'
        : 'border-slate-700 bg-slate-800/50'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-slate-300 text-sm">{description}</p>
        <RiskBadge level={risk_level} />
      </div>

      {rest_method && rest_url && (
        <div className="flex items-start gap-2 bg-slate-900 rounded px-3 py-2 overflow-hidden">
          <span className={`shrink-0 text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${
            rest_method === 'GET' ? 'text-green-400 bg-green-950/60' :
            rest_method === 'DELETE' ? 'text-red-400 bg-red-950/60' :
            'text-yellow-400 bg-yellow-950/60'
          }`}>{rest_method}</span>
          <code className="text-xs text-slate-400 font-mono break-all leading-relaxed">{rest_url}</code>
        </div>
      )}

      {requiresTypedConfirm && (
        <div className="space-y-1">
          <p className="text-red-400 text-xs">
            This is a destructive operation. Type <strong>{confirmPhrase}</strong> to proceed.
          </p>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={`Type "${confirmPhrase}" to confirm`}
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-red-500"
          />
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          disabled={!canExecute || executing}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm rounded transition-colors"
        >
          {executing ? 'Running...' : 'Run'}
        </button>
        <button
          onClick={onReject}
          disabled={executing}
          className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
