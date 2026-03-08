import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/index';
import { getUserSettings, saveUserSettings, UserSettings } from '../services/settingsStore';
import { updateSession } from '../services/sessionStore';
import { LLM_PROVIDER_MODELS, LlmProvider } from '../../../shared/types';
import { getDefaultModel, isSupportedModel } from '../services/llmProvider';

const router = Router();

router.get('/', (req: AuthenticatedRequest, res: Response): void => {
  res.json(getUserSettings(req.user!.oid));
});

router.post('/', (req: AuthenticatedRequest, res: Response): void => {
  const userId = req.user!.oid;
  const current = getUserSettings(userId);
  const updates = req.body as Partial<UserSettings>;

  if (updates.llmProvider && !(updates.llmProvider in LLM_PROVIDER_MODELS)) {
    res.status(400).json({ error: `Unsupported provider "${updates.llmProvider}"` });
    return;
  }

  const nextProvider = (updates.llmProvider ?? current.llmProvider) as LlmProvider;
  const normalized: Partial<UserSettings> = { ...updates };

  if (updates.llmProvider && !('llmModel' in updates)) {
    normalized.llmModel = getDefaultModel(nextProvider);
  }

  if (updates.llmModel) {
    if (!isSupportedModel(nextProvider, updates.llmModel)) {
      res.status(400).json({
        error: `Model "${updates.llmModel}" is not valid for provider "${nextProvider}"`,
      });
      return;
    }
  }

  const updated = saveUserSettings(userId, normalized);

  // Sync defaultResourceGroup into the live session immediately
  if ('defaultResourceGroup' in req.body) {
    updateSession(userId, { defaultResourceGroup: updated.defaultResourceGroup || undefined });
  }

  res.json(updated);
});

export default router;
