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

router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, date, startTime, duration, title } = req.body;

    if (!roomId || !date || !startTime || !duration) {
      res.status(400).json({ error: 'Thiếu thông tin đặt phòng (roomId, date, startTime, duration).' });
      return;
    }

    const booking = await createConfirmedBooking({
      roomId,
      date,
      startTime,
      duration: Number(duration),
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

