import { SessionState } from '../types/index';

interface Props {
  session: SessionState;
  provisioning: boolean;
}

export function SessionStatus({ session, provisioning }: Props) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`w-2 h-2 rounded-full ${
          session.isConnected ? 'bg-green-400' : provisioning ? 'bg-yellow-400 animate-pulse' : 'bg-slate-500'
        }`}
      />
      <span className="text-slate-400">
        {provisioning
          ? 'Initializing...'
          : session.isConnected
          ? (session.subscriptionName ?? session.subscriptionId ?? 'Ready')
          : 'Not connected'}
      </span>
    </div>
  );
}
