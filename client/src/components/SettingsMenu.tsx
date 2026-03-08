import { useState } from 'react';
import { UserSettings } from '../../../shared/types';

interface Props {
  settings: UserSettings;
  onSave: (updates: Partial<UserSettings>) => Promise<void>;
}

function GearIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
    </svg>
  );
}

export function SettingsMenu({ settings, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [saving, setSaving] = useState(false);

  const handleOpen = () => {
    setDraft(settings); // reset draft to current saved settings
    setOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="text-slate-500 hover:text-slate-300 transition-colors"
        title="Settings"
      >
        <GearIcon />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />

          {/* Modal */}
          <div className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-5">
            <h2 className="text-white font-semibold text-base">Settings</h2>

            {/* Require confirmation */}
            <label className="flex items-start justify-between gap-4 cursor-pointer group">
              <div>
                <p className="text-slate-200 text-sm font-medium">Require confirmation</p>
                <p className="text-slate-500 text-xs mt-0.5">Show an approval prompt before running any command. Destructive operations always require confirmation regardless of this setting.</p>
              </div>
              <button
                role="switch"
                aria-checked={draft.requireConfirmation}
                onClick={() => setDraft((d) => ({ ...d, requireConfirmation: !d.requireConfirmation }))}
                className={`shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors ${
                  draft.requireConfirmation ? 'bg-blue-500' : 'bg-slate-700'
                }`}
              >
                <span className={`block w-3.5 h-3.5 bg-white rounded-full shadow transition-transform mx-0.5 ${
                  draft.requireConfirmation ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
            </label>

            {/* Default resource group */}
            <div className="space-y-1.5">
              <label className="text-slate-200 text-sm font-medium block">Default resource group</label>
              <p className="text-slate-500 text-xs">Used as the <code className="text-blue-400 bg-slate-800 px-1 rounded text-xs">{'{resourceGroup}'}</code> placeholder in all API calls when no resource group is specified in your request.</p>
              <input
                type="text"
                value={draft.defaultResourceGroup}
                onChange={(e) => setDraft((d) => ({ ...d, defaultResourceGroup: e.target.value }))}
                placeholder="e.g. my-resource-group"
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-1.5 text-slate-400 hover:text-slate-200 text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
