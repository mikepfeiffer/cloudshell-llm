import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSupportedModel,
  getDefaultModel,
  isSupportedModel,
  InvalidProviderModelError,
} from './llmProvider';

test('provider defaults resolve to expected curated models', () => {
  assert.equal(getDefaultModel('claude'), 'claude-sonnet-4-6');
  assert.equal(getDefaultModel('openai'), 'gpt-5.1');
});

test('isSupportedModel validates provider-specific allowlist', () => {
  assert.equal(isSupportedModel('claude', 'claude-sonnet-4-6'), true);
  assert.equal(isSupportedModel('openai', 'gpt-5.1'), true);
  assert.equal(isSupportedModel('claude', 'gpt-5.1'), false);
});

test('assertSupportedModel throws for invalid provider/model combo', () => {
  assert.throws(
    () => assertSupportedModel('openai', 'claude-sonnet-4-6'),
    InvalidProviderModelError
  );
});
