import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

interface Props {
  output: string;
}

export function TerminalOutput({ output }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#0f172a',
        foreground: '#94a3b8',
        cursor: '#94a3b8',
      },
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      disableStdin: true,
      scrollback: 1000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    return () => {
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (!termRef.current || !output) return;
    termRef.current.clear();
    termRef.current.write(output.replace(/\n/g, '\r\n'));
    fitRef.current?.fit();
  }, [output]);

  return <div ref={containerRef} className="w-full h-full min-h-[120px]" />;
}
