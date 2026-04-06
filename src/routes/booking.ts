import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { BOOKING_ERROR_CODES, createConfirmedBooking } from '../services/booking.service';
import { formatPublicBooking } from '../services/public-api.service';

const router = Router();

function resolveBookingErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'UNKNOWN_ERROR';
  }
  return (error as Error & { code?: string }).code || error.name || error.message;
}

function toIsoValue(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const normalized = new Date(value);
  if (Number.isNaN(normalized.getTime())) {
    return null;
  }

  return normalized.toISOString();
}

router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, title } = req.body as {
      roomId?: string;
      title?: string;
      startAt?: unknown;
      endAt?: unknown;
    };
    const startAt = toIsoValue((req.body as { startAt?: unknown }).startAt);
    const endAt = toIsoValue((req.body as { endAt?: unknown }).endAt);

    if (!roomId || !startAt || !endAt) {
      res.status(400).json({ error: 'Thiếu thông tin đặt phòng (roomId, startAt, endAt).' });
      return;
    }

    const duration = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60000);
    if (!Number.isFinite(duration) || duration <= 0) {
      res.status(400).json({ error: 'Khung giờ không hợp lệ: endAt phải lớn hơn startAt.' });
      return;
    }

    const booking = await createConfirmedBooking({
      roomId,
      startAt,
      endAt,
      duration,
      title,
      userEmail: req.user?.email || 'unknown',
      userName: req.user?.name || 'Unknown',
    });

    res.status(201).json({
      message: 'Đặt phòng thành công.',
      booking: formatPublicBooking(booking),
    });
  } catch (error) {
    const code = resolveBookingErrorCode(error);
    if (code === BOOKING_ERROR_CODES.ROOM_NOT_FOUND) {
      res.status(404).json({ error: 'Không tìm thấy phòng.' });
      return;
    }

    if (code === BOOKING_ERROR_CODES.ROOM_NOT_AVAILABLE) {
      res.status(409).json({ error: 'Phòng không còn trống trong khung giờ này.' });
      return;
    }

    if (code === BOOKING_ERROR_CODES.INVALID_TIME_RANGE) {
      res.status(400).json({ error: 'Khung giờ không hợp lệ.' });
      return;
    }

    if (code === BOOKING_ERROR_CODES.BOOKING_IN_PAST) {
      res.status(400).json({ error: 'Không thể đặt lịch trong quá khứ.' });
      return;
    }

    console.error('Booking route error:', error);
    res.status(500).json({ error: 'Lỗi hệ thống. Vui lòng thử lại sau.' });
  }
});

export default router;
