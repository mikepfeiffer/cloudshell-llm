import { RiskBadge } from './RiskBadge';
import { PlanStep } from '../hooks/useChat';

interface Props {
  description: string;
  risk_level: 'read' | 'modify' | 'destructive';
  steps: PlanStep[];
  onApprove: () => void;
  onReject: () => void;
  executing: boolean;
}

export function PlanPreview({ description, risk_level, steps, onApprove, onReject, executing }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-xs font-medium uppercase tracking-wide">Multi-step plan</span>
          <RiskBadge risk_level={risk_level} />
        </div>
      </div>

      {/* Description */}
      <div className="px-4 pt-3 pb-2">
        <p className="text-slate-300 text-sm">{description}</p>
      </div>

      {/* Steps */}
      <ol className="px-4 pb-3 space-y-3">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-700 text-slate-400 text-xs flex items-center justify-center font-medium mt-0.5">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-slate-300 text-sm">{step.description}</p>
            </div>
          </li>
        ))}
      </ol>

      {/* Actions */}
      <div className="flex gap-2 px-4 py-3 border-t border-slate-700 bg-slate-900/40">
        <button
          onClick={onApprove}
          disabled={executing}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
        >
          {executing ? 'Running…' : `Run ${steps.length} steps`}
        </button>
        <button
          onClick={onReject}
          disabled={executing}
          className="px-4 py-1.5 text-slate-400 hover:text-slate-200 text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
