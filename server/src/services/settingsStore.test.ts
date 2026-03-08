import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceUserSettings, DEFAULT_SETTINGS } from './settingsStore';

test('coerceUserSettings backfills new LLM fields for legacy settings', () => {
  const legacy = coerceUserSettings({
    requireConfirmation: true,
    defaultResourceGroup: 'rg-legacy',
  });

  assert.equal(legacy.requireConfirmation, true);
  assert.equal(legacy.defaultResourceGroup, 'rg-legacy');
  assert.equal(legacy.llmProvider, DEFAULT_SETTINGS.llmProvider);
  assert.equal(legacy.llmModel, DEFAULT_SETTINGS.llmModel);
});

test('coerceUserSettings normalizes invalid model for provider', () => {
  const normalized = coerceUserSettings({
    llmProvider: 'openai',
    llmModel: 'claude-sonnet-4-6',
  });

  assert.equal(normalized.llmProvider, 'openai');
  assert.equal(normalized.llmModel, 'gpt-5.1');
});
