import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/index';
import { runAgentLoop } from '../services/agent';
import { getSession } from '../services/sessionStore';
import { shellRateLimit } from '../middleware/rateLimit';

const router = Router();

router.post('/run', shellRateLimit, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { goal } = req.body as { goal?: string };

  if (!goal?.trim()) {
    res.status(400).json({ error: 'goal is required' });
    return;
  }

  const userId = req.user!.oid;
  const session = getSession(userId);
  if (!session) {
    res.status(400).json({ error: 'No active session. Please refresh the page.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const abort = new AbortController();
  req.on('close', () => abort.abort());

  try {
    for await (const event of runAgentLoop(goal, session, req.user!.accessToken, abort.signal)) {
      send(event);
      if (event.type === 'done' || event.type === 'error' || event.type === 'clarify') break;
    }
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
  } finally {
    res.end();
  }
});

export default router;
