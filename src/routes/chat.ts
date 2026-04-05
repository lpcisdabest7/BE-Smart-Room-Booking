import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { processChat } from '../services/ai.service';
import { BOOKING_ERROR_CODES, createConfirmedBooking, getUserBookings, reconcileUserBookingsWithCalendar } from '../services/booking.service';
import { findAlternativeSlots } from '../services/calendar.service';
import { bootstrapRoomProjection } from '../services/calendar-sync.service';
import { getRoomDetail, listCandidateRooms, listRoomsWithStatus } from '../services/room-status.service';
import { formatPublicBooking, formatPublicRoom } from '../services/public-api.service';
import { listRoomCatalogEntries } from '../services/room-catalog.service';
import { AIBookAction, RoomAvailability } from '../types';

const router = Router();

function buildDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+07:00`);
}

function resolveBookingErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN_ERROR';
  return (error as Error & { code?: string }).code || error.name || error.message;
}

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gu, 'd')
    .toLowerCase()
    .trim();
}

function findRoomByName(roomName?: string): { id: string; name: string } | undefined {
  if (!roomName) return undefined;
  const normalized = normalizeText(roomName);
  return listRoomCatalogEntries().find((room) => normalizeText(room.name) === normalized);
}

function parseMonthYearFallback(message?: string): { month: number; year: number } {
  const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
  if (!message) {
    return { month: now.getMonth() + 1, year: now.getFullYear() };
  }
  const normalized = normalizeText(message);
  const month = Number(normalized.match(/thang\s*(\d{1,2})/)?.[1] ?? now.getMonth() + 1);
  const year = Number(normalized.match(/(20\d{2})/)?.[1] ?? now.getFullYear());
  return {
    month: month >= 1 && month <= 12 ? month : now.getMonth() + 1,
    year: Number.isFinite(year) ? year : now.getFullYear(),
  };
}

function durationFromSlot(startAt: string, endAt: string): number {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 60000);
}

function toAsiaBangkokParts(isoValue: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(isoValue));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${pick('year')}-${pick('month')}-${pick('day')}`,
    time: `${pick('hour')}:${pick('minute')}`,
  };
}

router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, conversationHistory = [] } = req.body;
    const userEmail = req.user?.email || 'unknown';
    const userName = req.user?.name || 'Unknown';

    if (!message) {
      res.status(400).json({ error: 'Message là bắt buộc.' });
      return;
    }

    const aiResponse = await processChat(message, conversationHistory);

    if (aiResponse.action === 'clarify' || aiResponse.action === 'info') {
      res.json({ type: aiResponse.action, message: aiResponse.message, panelHint: 'none' });
      return;
    }

    if (aiResponse.action === 'list_rooms') {
      const rooms = await listRoomsWithStatus();
      res.json({
        type: 'list_rooms',
        message: aiResponse.message,
        rooms: rooms.map((room) => formatPublicRoom(room)),
        panelHint: 'none',
      });
      return;
    }

    if (aiResponse.action === 'check_booking') {
      await reconcileUserBookingsWithCalendar(userEmail, 200);
      const bookings = getUserBookings(userEmail, 200);
      if (!bookings.length) {
        res.json({ type: 'info', message: 'Bạn chưa có booking nào trong hệ thống.', panelHint: 'none' });
        return;
      }

      const latest = bookings[0];
      res.json({
        type: 'history_summary',
        message: `Đã kiểm tra lịch của bạn. Hiện có ${bookings.length} booking.`,
        bookings: bookings.map((booking) => formatPublicBooking(booking)),
        bookingId: latest.id,
        roomId: latest.roomId,
        status: latest.status,
        panelHint: 'none',
      });
      return;
    }

    if (aiResponse.action === 'check_room_schedule') {
      const scheduleParams = aiResponse.params ?? {};
      const fallback = parseMonthYearFallback(message);
      const month = scheduleParams.month ?? fallback.month;
      const year = scheduleParams.year ?? fallback.year;

      const targetRooms = scheduleParams.roomName
        ? [findRoomByName(scheduleParams.roomName)].filter(Boolean) as Array<{ id: string; name: string }>
        : listRoomCatalogEntries().map((room) => ({ id: room.id, name: room.name }));

      if (!targetRooms.length) {
        res.json({
          type: 'clarify',
          message: 'Tôi chưa xác định được phòng bạn muốn kiểm tra. Bạn vui lòng nói rõ tên phòng.',
          panelHint: 'none',
        });
        return;
      }

      const bookings: Array<Record<string, unknown>> = [];
      for (const room of targetRooms) {
        try {
          await bootstrapRoomProjection(room.id);
        } catch {
          // Continue with local projection data if sync fails.
        }

        const roomDetail = await getRoomDetail(room.id);
        if (!roomDetail) continue;
        const slots = (roomDetail.bookedSlots ?? []).filter((slot) => {
          const [slotYear, slotMonth] = toAsiaBangkokParts(slot.startAt).date
            .split('-')
            .map((value) => Number(value));
          return slotYear === year && slotMonth === month;
        });

        for (const slot of slots) {
          const start = toAsiaBangkokParts(slot.startAt);
          const end = toAsiaBangkokParts(slot.endAt);
          bookings.push({
            id: `slot:${roomDetail.id}:${slot.externalEventId}`,
            userEmail: 'calendar@system.local',
            roomId: roomDetail.id,
            roomName: roomDetail.name,
            date: start.date,
            startTime: start.time,
            endTime: end.time,
            startAt: slot.startAt,
            endAt: slot.endAt,
            duration: durationFromSlot(slot.startAt, slot.endAt),
            title: slot.summary || `Lịch phòng ${roomDetail.name}`,
            status: slot.status === 'cancelled' ? 'cancelled' : 'confirmed',
            createdAt: slot.startAt,
            updatedAt: slot.endAt,
            calendarLink: null,
            calendarEventId: slot.externalEventId,
            source: slot.source,
            notes: null,
            room: formatPublicRoom(roomDetail, { includeBookings: false }),
          });
        }
      }

      if (!bookings.length) {
        const roomText = scheduleParams.roomName ? `phòng ${scheduleParams.roomName}` : 'các phòng';
        res.json({
          type: 'info',
          message: `${roomText} chưa có lịch đặt trong tháng ${month}/${year}.`,
          panelHint: 'none',
        });
        return;
      }

      res.json({
        type: 'history_summary',
        message: `Tìm thấy ${bookings.length} lịch đã đặt trong tháng ${month}/${year}.`,
        bookings,
        roomId: scheduleParams.roomName ? targetRooms[0]?.id : undefined,
        panelHint: 'none',
      });
      return;
    }

    if (aiResponse.action === 'book') {
      const { roomName, numberOfPeople, date, startTime, duration } = (aiResponse as AIBookAction).params;
      const startDateTime = buildDateTime(date, startTime);
      const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);
      const candidates = await listCandidateRooms(numberOfPeople, startDateTime.toISOString(), endDateTime.toISOString());

      let selectedRoom: RoomAvailability | undefined;
      if (roomName) {
        selectedRoom = candidates.find(
          (item) => item.available && item.room.name.toLowerCase() === roomName.toLowerCase()
        );
      } else {
        const availableRooms = candidates
          .filter((item) => item.available)
          .sort((a, b) => a.room.capacity - b.room.capacity)
          .slice(0, 3);

        if (availableRooms.length) {
          res.json({
            type: 'rooms_available',
            message: `Tôi tìm thấy ${availableRooms.length} phòng phù hợp. Hãy chọn một phòng để đặt.`,
            rooms: availableRooms.map((item) => formatPublicRoom(item.room)),
            searchParams: { numberOfPeople, date, startTime, duration },
            panelHint: 'none',
          });
          return;
        }
      }

      if (!selectedRoom) {
        const alternatives = await findAlternativeSlots(
          listRoomCatalogEntries().filter((room) => room.capacity >= numberOfPeople),
          startDateTime,
          duration
        );

        res.json({
          type: 'no_availability',
          message: `Không có phòng trống đúng yêu cầu vào ${startTime} ngày ${date}. Đây là một số khung giờ thay thế.`,
          alternatives: alternatives.map((alt) => ({
            startTime: alt.startTime.toISOString(),
            endTime: alt.endTime.toISOString(),
            rooms: alt.availableRooms.map((room) => formatPublicRoom(room)),
          })),
          panelHint: 'none',
        });
        return;
      }

      const booking = await createConfirmedBooking({
        roomId: selectedRoom.room.id,
        date,
        startTime,
        duration,
        userEmail,
        userName,
        title: `Họp - ${userName}`,
      });

      res.json({
        type: 'booking_confirmed',
        message: `Đã đặt phòng ${selectedRoom.room.name} thành công.`,
        booking: formatPublicBooking(booking),
        bookingId: booking.id,
        roomId: booking.roomId,
        roomSnapshot: formatPublicRoom(selectedRoom.room),
        status: booking.status,
        panelHint: 'none',
      });
      return;
    }

    if (aiResponse.action === 'search') {
      const { numberOfPeople, date, startTime, duration } = aiResponse.params;
      const startDateTime = buildDateTime(date, startTime);
      const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);
      const results = await listCandidateRooms(numberOfPeople, startDateTime.toISOString(), endDateTime.toISOString());
      const availableRooms = results
        .filter((item) => item.available)
        .sort((a, b) => a.room.capacity - b.room.capacity)
        .slice(0, 3);

      if (availableRooms.length) {
        res.json({
          type: 'rooms_available',
          message: `Tìm thấy ${availableRooms.length} phòng phù hợp cho ${numberOfPeople} người.`,
          rooms: availableRooms.map((item) => formatPublicRoom(item.room)),
          searchParams: { numberOfPeople, date, startTime, duration },
          panelHint: 'none',
        });
        return;
      }

      const alternatives = await findAlternativeSlots(
        listRoomCatalogEntries().filter((room) => room.capacity >= numberOfPeople),
        startDateTime,
        duration
      );

      res.json({
        type: 'no_availability',
        message: `Chưa có phòng trống vào ${startTime} ngày ${date}.`,
        alternatives: alternatives.map((alt) => ({
          startTime: alt.startTime.toISOString(),
          endTime: alt.endTime.toISOString(),
          rooms: alt.availableRooms.map((room) => formatPublicRoom(room)),
        })),
        panelHint: 'none',
      });
      return;
    }

    res.json({ type: 'info', message: 'Tôi chưa hiểu rõ yêu cầu. Bạn có thể nói rõ hơn không?', panelHint: 'none' });
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

    console.error('Chat route error:', error);
    res.status(500).json({ error: 'Lỗi hệ thống. Vui lòng thử lại sau.' });
  }
});

export default router;
