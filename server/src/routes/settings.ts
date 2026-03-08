import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types/index';
import { getUserSettings, saveUserSettings, UserSettings } from '../services/settingsStore';
import { updateSession } from '../services/sessionStore';

const router = Router();

router.get('/', (req: AuthenticatedRequest, res: Response): void => {
  res.json(getUserSettings(req.user!.oid));
});

router.post('/', (req: AuthenticatedRequest, res: Response): void => {
  const userId = req.user!.oid;
  const updated = saveUserSettings(userId, req.body as Partial<UserSettings>);

  // Sync defaultResourceGroup into the live session immediately
  if ('defaultResourceGroup' in req.body) {
    updateSession(userId, { defaultResourceGroup: updated.defaultResourceGroup || undefined });
  }

  res.json(updated);
});

export default router;
