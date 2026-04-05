import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  BOOKING_ERROR_CODES,
  cancelBookingEvent,
  createConfirmedBooking,
  getUserBookingDetail,
  listBookings,
  reconcileUserBookingsWithCalendar,
} from '../services/booking.service';
import { formatPublicBooking } from '../services/public-api.service';
import type { BookingStatus } from '../services/sync.types';

const router = Router();

router.use(authMiddleware);

function normalizeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function parseLimit(input: unknown, fallback = 30): number {
  const value = Number.parseInt(String(input ?? fallback), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, 200);
}

function parseStatus(value: unknown): BookingStatus | undefined {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === 'all') {
    return undefined;
  }
  if (raw === 'pending' || raw === 'confirmed' || raw === 'modified' || raw === 'cancelled' || raw === 'sync_error') {
    return raw;
  }
  return undefined;
}

function resolveBookingErrorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'UNKNOWN_ERROR';
  }
  return (error as Error & { code?: string }).code || error.name || error.message;
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const scope = String(req.query.scope ?? 'mine').toLowerCase();
  if (scope !== 'mine') {
    res.status(400).json({ error: 'Chỉ hỗ trợ scope=mine ở phiên bản hiện tại.' });
    return;
  }

  const userEmail = req.user?.email || 'unknown';
  let bookings = listBookings({
    userEmail,
    status: parseStatus(req.query.status),
    limit: parseLimit(req.query.limit, 30),
  });
  await reconcileUserBookingsWithCalendar(userEmail, parseLimit(req.query.limit, 120));

  bookings = listBookings({
    userEmail,
    status: parseStatus(req.query.status),
    limit: parseLimit(req.query.limit, 30),
  });
  res.json({ bookings: bookings.map((booking) => formatPublicBooking(booking)) });
});

router.get('/:bookingId', async (req: Request, res: Response): Promise<void> => {
  const bookingId = normalizeParam(req.params.bookingId);
  let booking = getUserBookingDetail(bookingId, req.user?.email || 'unknown');

  if (booking) {
    await reconcileUserBookingsWithCalendar(req.user?.email || 'unknown', 120);
    booking = getUserBookingDetail(bookingId, req.user?.email || 'unknown');
  }

  if (!booking) {
    res.status(404).json({ error: 'Không tìm thấy booking.' });
    return;
  }

  res.json({ booking: formatPublicBooking(booking) });
});

router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { roomId, date, startTime, duration, title } = req.body;
    if (!roomId || !date || !startTime || !duration) {
      res.status(400).json({ error: 'Thiếu thông tin đặt phòng.' });
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

    res.status(201).json({ booking: formatPublicBooking(booking) });
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

    console.error('Bookings route error:', error);
    res.status(500).json({ error: 'Lỗi hệ thống. Vui lòng thử lại sau.' });
  }
});

router.post('/:bookingId/cancel', async (req: Request, res: Response): Promise<void> => {
  try {
    const bookingId = normalizeParam(req.params.bookingId);
    const booking = getUserBookingDetail(bookingId, req.user?.email || 'unknown');

    if (!booking) {
      res.status(404).json({ error: 'Không tìm thấy booking để hủy.' });
      return;
    }

    if (booking.status === 'cancelled') {
      res.json({ booking: formatPublicBooking(booking) });
      return;
    }

    const cancelled = await cancelBookingEvent(booking.id);
    res.json({ booking: formatPublicBooking(cancelled) });
  } catch (error) {
    console.error('Bookings cancel route error:', error);
    res.status(500).json({ error: 'Không thể hủy booking lúc này. Vui lòng thử lại.' });
  }
});

export default router;
