import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getRoomDetail, listRoomsWithStatus } from '../services/room-status.service';
import { formatPublicRoom } from '../services/public-api.service';

const router = Router();

router.get('/', authMiddleware, async (_req: Request, res: Response): Promise<void> => {
  const rooms = await listRoomsWithStatus();
  res.json({ rooms: rooms.map((room) => formatPublicRoom(room)) });
});

router.get('/:roomId', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const room = await getRoomDetail(req.params.roomId);

  if (!room) {
    res.status(404).json({ error: 'Không tìm thấy phòng.' });
    return;
  }

  res.json({ room: formatPublicRoom(room) });
});

export default router;

