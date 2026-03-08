import { useState, KeyboardEvent } from 'react';

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ onSend, disabled, placeholder }: Props) {
  const [value, setValue] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
  };

  return (
    <div className="flex gap-2 items-end">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder ?? 'Describe what you want to do in Azure...'}
        rows={2}
        className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder:text-slate-500 resize-none focus:outline-none focus:border-blue-500 disabled:opacity-50 text-sm"
      />
      <button
        onClick={submit}
        disabled={disabled || !value.trim()}
        className="px-5 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg transition-colors text-sm font-medium"
      >
        Send
      </button>
    </div>
  );
}
