import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  DEFAULT_LLM_MODEL_BY_PROVIDER,
  LLM_PROVIDER_MODELS,
  LlmProvider,
} from '../../../shared/types';

export interface ProviderConfig {
  provider: LlmProvider;
  model: string;
}

export interface ProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class InvalidProviderModelError extends Error {
  constructor(provider: string, model: string) {
    super(`Model "${model}" is not supported for provider "${provider}".`);
  }
}

export class MissingProviderApiKeyError extends Error {
  constructor(provider: LlmProvider) {
    const envName = provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
    super(`Missing API key for ${provider}. Set ${envName} on the server.`);
  }
}

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

export function getDefaultModel(provider: LlmProvider): string {
  return DEFAULT_LLM_MODEL_BY_PROVIDER[provider];
}

export function isSupportedModel(provider: LlmProvider, model: string): boolean {
  return LLM_PROVIDER_MODELS[provider].includes(model);
}

export function assertSupportedModel(provider: LlmProvider, model: string): void {
  if (!isSupportedModel(provider, model)) {
    throw new InvalidProviderModelError(provider, model);
  }
}

function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new MissingProviderApiKeyError('claude');
  }
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

function getOpenAiClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new MissingProviderApiKeyError('openai');
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

export async function completeText(
  config: ProviderConfig,
  systemPrompt: string,
  messages: ProviderMessage[],
  maxTokens: number
): Promise<string> {
  assertSupportedModel(config.provider, config.model);

  if (config.provider === 'claude') {
    const response = await getAnthropicClient().messages.create({
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });
    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  const response = await getOpenAiClient().chat.completions.create({
    model: config.model,
    max_completion_tokens: maxTokens,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });
  return response.choices[0]?.message?.content ?? '';
}

export async function* streamText(
  config: ProviderConfig,
  systemPrompt: string,
  messages: ProviderMessage[],
  maxTokens: number
): AsyncGenerator<string> {
  assertSupportedModel(config.provider, config.model);

  if (config.provider === 'claude') {
    const stream = getAnthropicClient().messages.stream({
      model: config.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
    return;
  }

  const stream = await getOpenAiClient().chat.completions.create({
    model: config.model,
    max_completion_tokens: maxTokens,
    temperature: 0,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) yield token;
  }
}
