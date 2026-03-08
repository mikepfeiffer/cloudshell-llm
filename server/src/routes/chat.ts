import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/index';
import { generateCommand, streamSynthesisTokens } from '../services/llm';
import { getSession } from '../services/sessionStore';
import { chatRateLimit } from '../middleware/rateLimit';
import { ChatMessage } from '../../../shared/types';
import { getUserSettings } from '../services/settingsStore';
import { InvalidProviderModelError, MissingProviderApiKeyError } from '../services/llmProvider';

const router = Router();

router.post('/', chatRateLimit, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { message, history = [] } = req.body as { message: string; history: ChatMessage[] };

  if (!message?.trim()) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  const userId = req.user!.oid;
  const session = getSession(userId);
  const settings = getUserSettings(userId);
  const providerConfig = { provider: settings.llmProvider, model: settings.llmModel } as const;

  try {
    const result = await generateCommand(message, history, session ?? undefined, providerConfig);

    if ('clarification' in result) {
      res.json({ type: 'clarification', message: result.clarification });
    } else if ('type' in result && result.type === 'agent') {
      res.json({ type: 'agent', goal: result.goal, description: result.description });
    } else if ('type' in result && result.type === 'plan') {
      res.json({
        type: 'plan',
        description: result.description,
        risk_level: result.risk_level,
        steps: result.steps,
        synthesize: true,
      });
    } else if ('command' in result) {
      res.json({
        type: 'command',
        command: result.command,
        description: result.description,
        risk_level: result.risk_level,
        rest_method: result.rest_method,
        rest_url: result.rest_url,
        rest_body: result.rest_body,
        synthesize: result.synthesize ?? false,
      });
    }
  } catch (err) {
    if (err instanceof InvalidProviderModelError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof MissingProviderApiKeyError) {
      res.status(500).json({ error: err.message });
      return;
    }
    console.error('LLM error:', err);
    res.status(500).json({ error: 'Failed to generate command. Please try again.' });
  }
});

router.post('/synthesize', chatRateLimit, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { question, results } = req.body as {
    question: string;
    results: Array<{ command: string; output: string }>;
  };

  if (!question || !Array.isArray(results) || results.length === 0) {
    res.status(400).json({ error: 'question and results are required' });
    return;
  }
  const settings = getUserSettings(req.user!.oid);
  const providerConfig = { provider: settings.llmProvider, model: settings.llmModel } as const;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    for await (const token of streamSynthesisTokens(question, results, providerConfig)) {
      send({ token });
    }
    send({ done: true });
  } catch (err) {
    if (err instanceof InvalidProviderModelError || err instanceof MissingProviderApiKeyError) {
      send({ error: err.message });
      res.end();
      return;
    }
    console.error('Synthesis error:', err);
    send({ error: (err as Error).message });
  } finally {
    res.end();
  }
});

export default router;
