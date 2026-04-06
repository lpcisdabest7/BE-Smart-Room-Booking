import { Request, Response, Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { processChat } from '../services/ai.service';
import {
  BOOKING_ERROR_CODES,
  getUserBookings,
  reconcileUserBookingsWithCalendar,
} from '../services/booking.service';
import { findAlternativeSlots } from '../services/calendar.service';
import { bootstrapRoomProjection } from '../services/calendar-sync.service';
import { listRoomCatalogEntries } from '../services/room-catalog.service';
import { formatPublicBooking, formatPublicRoom } from '../services/public-api.service';
import { getRoomDetail, listCandidateRooms, listRoomsWithStatus } from '../services/room-status.service';
import { AIBookAction, ChatMessage } from '../types';

const router = Router();

type ConversationItem = {
  role?: string;
  content?: string;
};

function buildDateTime(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+07:00`);
}

function toMinuteValue(hour: number, minute: number, period?: string): number | null {
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  let normalizedHour = hour;
  if ((period === 'pm' || period === 'chieu' || period === 'toi') && normalizedHour < 12) {
    normalizedHour += 12;
  }
  if ((period === 'am' || period === 'sang') && normalizedHour === 12) {
    normalizedHour = 0;
  }

  if (normalizedHour < 0 || normalizedHour > 23) {
    return null;
  }

  return normalizedHour * 60 + minute;
}

function hasExplicitStartEndWindow(message: string): boolean {
  const normalized = normalizeText(message);
  const match = normalized.match(
    /(?:^|\b)(\d{1,2})(?:[:h.](\d{1,2}))?\s*(sang|chieu|toi|dem|am|pm)?\s*(?:-|den|toi|to)\s*(\d{1,2})(?:[:h.](\d{1,2}))?\s*(sang|chieu|toi|dem|am|pm)?(?:\b|$)/
  );

  if (!match) {
    return false;
  }

  const startHour = Number(match[1] ?? '');
  const startMinute = Number(match[2] ?? '00');
  const startPeriod = match[3] ?? undefined;

  const endHour = Number(match[4] ?? '');
  const endMinute = Number(match[5] ?? '00');
  const endPeriod = match[6] ?? startPeriod;

  const startMinutes = toMinuteValue(startHour, startMinute, startPeriod);
  const endMinutes = toMinuteValue(endHour, endMinute, endPeriod);
  if (startMinutes == null || endMinutes == null) {
    return false;
  }

  return endMinutes > startMinutes;
}

function hasExplicitDurationHint(message: string): boolean {
  const normalized = normalizeText(message);

  if (/(?:trong vong|trong|keo dai|duration|hop trong|for)\s*(\d+)\s*(gio|tieng|phut|m|p|h)\b/.test(normalized)) {
    return true;
  }

  if (/(\d+)\s*(phut|minutes|minute|mins|min)\b/.test(normalized)) {
    return true;
  }

  if (/(\d+)\s*(gio|tieng|hours|hour)\b/.test(normalized)) {
    const looksLikeClockTime = /\b(luc|vao|at)\s*(\d+)\s*(gio|tieng)\b/.test(normalized);
    return !looksLikeClockTime;
  }

  return false;
}

function resolveBookingErrorCode(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN_ERROR';
  return (error as Error & { code?: string }).code || error.name || error.message;
}

function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim();
}

function hasExplicitBookingIntent(message: string): boolean {
  const normalized = normalizeText(message);
  return /(dat phong|dat lich|book phong|book lich|tao booking|tao lich|len lich)/.test(normalized);
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasExplicitRoomMention(message: string, roomName?: string): boolean {
  if (!roomName) {
    return false;
  }

  const normalizedMessage = normalizeText(message);
  const normalizedRoomName = normalizeText(roomName);
  if (!normalizedRoomName) {
    return false;
  }

  const mentionPattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(normalizedRoomName)}(?:$|[^a-z0-9])`);
  return mentionPattern.test(normalizedMessage);
}

function sortAvailableRoomsByFit<T extends { room: { name: string; capacity: number }; available: boolean }>(
  candidates: T[],
  targetPeople: number
): T[] {
  return candidates
    .filter((item) => item.available)
    .sort((a, b) => {
      const capacityDistance = Math.abs(a.room.capacity - targetPeople) - Math.abs(b.room.capacity - targetPeople);
      if (capacityDistance !== 0) {
        return capacityDistance;
      }

      if (a.room.capacity !== b.room.capacity) {
        return a.room.capacity - b.room.capacity;
      }

      return a.room.name.localeCompare(b.room.name);
    });
}

function buildNoAvailabilityAlternatives(
  alternatives: Awaited<ReturnType<typeof findAlternativeSlots>>
): Array<{ startTime: string; endTime: string; rooms: ReturnType<typeof formatPublicRoom>[] }> {
  return alternatives.map((alt) => ({
    startTime: alt.startTime.toISOString(),
    endTime: alt.endTime.toISOString(),
    rooms: alt.availableRooms.map((room) => formatPublicRoom(room)),
  }));
}

function sanitizeConversationHistory(rawHistory: unknown): ChatMessage[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }
  return rawHistory
    .filter((item): item is ConversationItem => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const role: ChatMessage['role'] = item.role === 'assistant' || item.role === 'system' ? item.role : 'user';
      return {
        role,
        content: typeof item.content === 'string' ? item.content : '',
      };
    })
    .filter((item) => item.content.trim().length > 0);
}

router.post('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, conversationHistory = [] } = req.body as { message?: string; conversationHistory?: ConversationItem[] };
    const userEmail = req.user?.email || 'unknown';

    if (!message) {
      res.status(400).json({ error: 'Message là bắt buộc.' });
      return;
    }

    const normalizedHistory = sanitizeConversationHistory(conversationHistory);
    const aiResponse = await processChat(message, normalizedHistory);

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
      const bookings = getUserBookings(userEmail, 200).filter((booking) => booking.status !== 'cancelled');
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
          if (slot.status === 'cancelled') {
            continue;
          }

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
            status: 'confirmed',
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
      const shouldAskForDuration =
        hasExplicitBookingIntent(message) &&
        !hasExplicitStartEndWindow(message) &&
        !hasExplicitDurationHint(message) &&
        duration === 60;

      if (shouldAskForDuration) {
        res.json({
          type: 'clarify',
          message:
            'Mình đã có ngày và giờ bắt đầu. Bạn cho mình thêm thời lượng hoặc giờ kết thúc (ví dụ: 60 phút hoặc 11:00 - 12:00) để mình gợi ý chính xác nhé.',
          panelHint: 'none',
        });
        return;
      }

      const startDateTime = buildDateTime(date, startTime);
      const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);
      const candidates = await listCandidateRooms(numberOfPeople, startDateTime.toISOString(), endDateTime.toISOString());

      const availableRooms = sortAvailableRoomsByFit(candidates, numberOfPeople);
      const hasExplicitRoom = hasExplicitRoomMention(message, roomName);

      if (hasExplicitRoom && roomName) {
        const requestedRoom = availableRooms.find((item) => normalizeText(item.room.name) === normalizeText(roomName));
        if (requestedRoom) {
          res.json({
            type: 'rooms_available',
            message: `Phòng ${requestedRoom.room.name} đang trống. Bạn hãy xác nhận để tạo booking.`,
            rooms: [formatPublicRoom(requestedRoom.room)],
            searchParams: { numberOfPeople, date, startTime, duration },
            panelHint: 'none',
          });
          return;
        }
      } else if (availableRooms.length > 0) {
        const topRooms = availableRooms.slice(0, 3);
        res.json({
          type: 'rooms_available',
          message: `Tôi tìm thấy ${topRooms.length} phòng phù hợp. Hãy chọn một phòng để xác nhận booking.`,
          rooms: topRooms.map((item) => formatPublicRoom(item.room)),
          searchParams: { numberOfPeople, date, startTime, duration },
          panelHint: 'none',
        });
        return;
      }

      const alternatives = await findAlternativeSlots(
        listRoomCatalogEntries().filter((room) => room.capacity >= numberOfPeople),
        startDateTime,
        duration,
        numberOfPeople
      );

      res.json({
        type: 'no_availability',
        message: hasExplicitRoom && roomName
          ? `Phòng ${roomName} chưa trống vào ${startTime} ngày ${date}. Đây là các lựa chọn trước/sau 30 phút.`
          : `Không có phòng trống đúng yêu cầu vào ${startTime} ngày ${date}. Đây là các lựa chọn trước/sau 30 phút.`,
        alternatives: buildNoAvailabilityAlternatives(alternatives),
        panelHint: 'none',
      });
      return;
    }

    if (aiResponse.action === 'search') {
      const { numberOfPeople, date, startTime, duration } = aiResponse.params;
      const startDateTime = buildDateTime(date, startTime);
      const endDateTime = new Date(startDateTime.getTime() + duration * 60 * 1000);
      const results = await listCandidateRooms(numberOfPeople, startDateTime.toISOString(), endDateTime.toISOString());
      const availableRooms = sortAvailableRoomsByFit(results, numberOfPeople).slice(0, 3);

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
        duration,
        numberOfPeople
      );

      res.json({
        type: 'no_availability',
        message: `Chưa có phòng trống vào ${startTime} ngày ${date}.`,
        alternatives: buildNoAvailabilityAlternatives(alternatives),
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
