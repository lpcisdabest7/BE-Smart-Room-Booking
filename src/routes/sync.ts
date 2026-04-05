import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getSyncStatus } from '../services/sync-status.service';

const router = Router();

router.get('/status', authMiddleware, (_req: Request, res: Response): void => {
  res.json({ sync: getSyncStatus() });
});

export default router;
