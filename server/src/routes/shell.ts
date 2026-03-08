import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/index';
import { getSubscriptionInfo, executeRestCall, pollAsyncOperation } from '../services/cloudShell';
import { getSession, setSession, deleteSession } from '../services/sessionStore';
import { getUserSettings } from '../services/settingsStore';
import { shellRateLimit } from '../middleware/rateLimit';

const router = Router();

// POST /api/shell/provision — fetch subscription context and mark session active
router.post('/provision', shellRateLimit, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.oid;
  const accessToken = req.user!.accessToken;

  const existing = getSession(userId);
  if (existing) {
    res.json({ status: 'connected', ...existing });
    return;
  }

  try {
    const subInfo = await getSubscriptionInfo(accessToken);
    const settings = getUserSettings(userId);
    setSession(userId, {
      subscriptionId: subInfo?.subscriptionId,
      subscriptionName: subInfo?.subscriptionName,
      defaultResourceGroup: settings.defaultResourceGroup || undefined,
    });
    res.json({
      status: 'connected',
      subscriptionId: subInfo?.subscriptionId,
      subscriptionName: subInfo?.subscriptionName,
      defaultResourceGroup: settings.defaultResourceGroup || undefined,
    });
  } catch (err) {
    console.error('Provision error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/shell/execute — execute an Azure REST API call with the user's token
router.post('/execute', shellRateLimit, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = req.user!.oid;
  const accessToken = req.user!.accessToken;
  const { rest_method, rest_url, rest_body } = req.body as {
    rest_method: string;
    rest_url: string;
    rest_body?: Record<string, unknown>;
  };

  if (!rest_method || !rest_url) {
    res.status(400).json({ error: 'rest_method and rest_url are required' });
    return;
  }

  const session = getSession(userId);
  if (!session) {
    res.status(400).json({ error: 'No active session. Please refresh the page.' });
    return;
  }

  try {
    const result = await executeRestCall(
      accessToken,
      rest_method,
      rest_url,
      session.subscriptionId,
      session.defaultResourceGroup,
      rest_body
    );
    res.json({ output: result.output, pollUrl: result.pollUrl ?? null, executedAt: Date.now() });
  } catch (err) {
    console.error('Execute error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/shell/poll — proxy an Azure async operation poll with the user's token
router.get('/poll', shellRateLimit, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { url } = req.query as { url?: string };
  if (!url) {
    res.status(400).json({ error: 'url query parameter is required' });
    return;
  }

  // Only allow polling management.azure.com URLs
  if (!url.startsWith('https://management.azure.com/')) {
    res.status(400).json({ error: 'Invalid poll URL' });
    return;
  }

  try {
    const result = await pollAsyncOperation(req.user!.accessToken, url);
    res.json(result);
  } catch (err) {
    console.error('Poll error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/shell/status
router.get('/status', (req: AuthenticatedRequest, res: Response): void => {
  const session = getSession(req.user!.oid);
  res.json({
    isConnected: !!session,
    subscriptionId: session?.subscriptionId,
    subscriptionName: session?.subscriptionName,
    defaultResourceGroup: session?.defaultResourceGroup,
  });
});

// DELETE /api/shell/session
router.delete('/session', (req: AuthenticatedRequest, res: Response): void => {
  deleteSession(req.user!.oid);
  res.json({ status: 'disconnected' });
});

export default router;
