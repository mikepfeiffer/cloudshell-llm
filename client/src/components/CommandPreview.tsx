import { useState } from 'react';
import { RiskBadge } from './RiskBadge';

interface Props {
  command: string;
  description: string;
  risk_level: 'read' | 'modify' | 'destructive';
  onApprove: () => void;
  onReject: () => void;
  executing?: boolean;
}

export function CommandPreview({ command, description, risk_level, onApprove, onReject, executing }: Props) {
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

      <pre className="bg-slate-900 rounded p-3 text-sm text-green-400 font-mono overflow-x-auto">
        {command}
      </pre>

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
