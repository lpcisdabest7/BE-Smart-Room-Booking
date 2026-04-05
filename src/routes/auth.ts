import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

const router = Router();

router.post('/login', (req: Request, res: Response): void => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'Email là bắt buộc.' });
    return;
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) {
    res.status(400).json({ error: 'Email không hợp lệ.' });
    return;
  }

  const name = normalized.split('@')[0] || 'user';
  const token = jwt.sign({ email: normalized, name }, config.jwtSecret, { expiresIn: '24h' });

  res.json({
    token,
    user: { email: normalized, name },
  });
});

export default router;

