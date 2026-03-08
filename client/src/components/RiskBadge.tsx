interface Props {
  level: 'read' | 'modify' | 'destructive';
}

const styles = {
  read: 'bg-green-900 text-green-300 border border-green-700',
  modify: 'bg-yellow-900 text-yellow-300 border border-yellow-700',
  destructive: 'bg-red-900 text-red-300 border border-red-700',
} as const;

const labels = {
  read: 'Read-only',
  modify: 'Modifying',
  destructive: 'Destructive',
} as const;

export function RiskBadge({ level }: Props) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide ${styles[level]}`}>
      {labels[level]}
    </span>
  );
}
