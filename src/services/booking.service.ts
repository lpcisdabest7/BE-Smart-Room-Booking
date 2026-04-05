import { randomUUID } from 'crypto';
import {
  buildRoomBookingLink,
  cancelRoomCalendarEvent,
  createRoomCalendarEvent,
  getRoomCalendarEvent,
  resolveCalendarIdForRoom,
  updateRoomCalendarEvent,
} from './google-calendar.service';
import { all, get, nowIso, run } from './database.service';
import { bootstrapRoomProjection, getProjectedConflictingEvents, listProjectedCalendarEvents, upsertCalendarEventProjection } from './calendar-sync.service';
import { getRoomCatalogEntry, seedRoomCatalog } from './room-catalog.service';
import type { BookingCreateInput, BookingCreateResult, BookingRecordV2, BookingStatus, RoomCatalogEntry, SyncSource } from './sync.types';

export const BOOKING_ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_NOT_AVAILABLE: 'ROOM_NOT_AVAILABLE',
  INVALID_TIME_RANGE: 'INVALID_TIME_RANGE',
  BOOKING_IN_PAST: 'BOOKING_IN_PAST',
} as const;

function createBookingError(code: (typeof BOOKING_ERROR_CODES)[keyof typeof BOOKING_ERROR_CODES], message: string) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  error.name = code;
  return error;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function resolveBookingWindow(input: BookingCreateInput): { startAt: string; endAt: string } {
  if (input.startAt && input.endAt) {
    const startAt = toIso(input.startAt);
    const endAt = toIso(input.endAt);
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      throw createBookingError(BOOKING_ERROR_CODES.INVALID_TIME_RANGE, 'End time must be after start time');
    }
    return { startAt, endAt };
  }

  if (input.date && input.startTime) {
    if (!input.duration || input.duration <= 0) {
      throw createBookingError(BOOKING_ERROR_CODES.INVALID_TIME_RANGE, 'Duration must be greater than zero');
    }
    const startAt = toIso(new Date(`${input.date}T${input.startTime}:00+07:00`));
    const endAt = toIso(new Date(new Date(startAt).getTime() + input.duration * 60 * 1000));
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      throw createBookingError(BOOKING_ERROR_CODES.INVALID_TIME_RANGE, 'End time must be after start time');
    }
    return { startAt, endAt };
  }

  throw new Error('Booking input must include either startAt/endAt or date/startTime');
}

function serializeRoomSnapshot(room: RoomCatalogEntry): string {
  return JSON.stringify({
    id: room.id,
    name: room.name,
    calendarId: room.calendarId,
    capacity: room.capacity,
    floor: room.floor,
    equipment: room.equipment,
    description: room.description,
    image: room.image,
    color: room.color,
    features: room.features,
    timezone: room.timezone,
  });
}

function deserializeBookingRow(row: Record<string, unknown>): BookingRecordV2 {
  return {
    id: String(row.id),
    userEmail: String(row.userEmail),
    roomId: String(row.roomId),
    roomName: String(row.roomName),
    calendarId: String(row.calendarId),
    externalEventId: row.externalEventId == null ? null : String(row.externalEventId),
    title: String(row.title),
    startAt: String(row.startAt),
    endAt: String(row.endAt),
    duration: Number(row.duration),
    status: row.status as BookingStatus,
    syncState: String(row.syncState) as BookingRecordV2['syncState'],
    calendarLink: row.calendarLink == null ? null : String(row.calendarLink),
    notes: row.notes == null ? null : String(row.notes),
    roomSnapshotJson: String(row.roomSnapshotJson),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    confirmedAt: row.confirmedAt == null ? null : String(row.confirmedAt),
    cancelledAt: row.cancelledAt == null ? null : String(row.cancelledAt),
    source: String(row.source) as SyncSource,
    rawCalendarJson: row.rawCalendarJson == null ? null : String(row.rawCalendarJson),
  };
}

function insertBookingRow(record: BookingRecordV2): BookingRecordV2 {
  run(
    `
      INSERT INTO bookings (
        id, userEmail, roomId, roomName, calendarId, externalEventId, title,
        startAt, endAt, duration, status, syncState, calendarLink, notes,
        roomSnapshotJson, source, rawCalendarJson, createdAt, updatedAt,
        confirmedAt, cancelledAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      record.id,
      record.userEmail,
      record.roomId,
      record.roomName,
      record.calendarId,
      record.externalEventId,
      record.title,
      record.startAt,
      record.endAt,
      record.duration,
      record.status,
      record.syncState,
      record.calendarLink,
      record.notes,
      record.roomSnapshotJson,
      record.source,
      record.rawCalendarJson,
      record.createdAt,
      record.updatedAt,
      record.confirmedAt,
      record.cancelledAt,
    ]
  );

  return record;
}

function normalizeBookingId(id: string | string[]): string {
  return Array.isArray(id) ? id[0] ?? '' : id;
}

export function getBookingById(id: string | string[]): BookingRecordV2 | undefined {
  const row = get<Record<string, unknown>>('SELECT * FROM bookings WHERE id = ?', [normalizeBookingId(id)]);
  return row ? deserializeBookingRow(row) : undefined;
}

export function getRecentBookingByUser(userEmail: string): BookingRecordV2 | undefined {
  const row = get<Record<string, unknown>>(
    'SELECT * FROM bookings WHERE userEmail = ? ORDER BY updatedAt DESC, startAt DESC LIMIT 1',
    [userEmail]
  );
  return row ? deserializeBookingRow(row) : undefined;
}

export function getBookingsByUser(userEmail: string, options?: { status?: BookingStatus; limit?: number }): BookingRecordV2[] {
  const conditions = ['userEmail = ?'];
  const params: unknown[] = [userEmail];

  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const rows = all<Record<string, unknown>>(
    `SELECT * FROM bookings WHERE ${conditions.join(' AND ')} ORDER BY createdAt DESC, startAt DESC LIMIT ?`,
    [...params, options?.limit ?? 50]
  );

  return rows.map(deserializeBookingRow);
}

export function listBookingsForRoom(roomId: string, options?: { limit?: number }): BookingRecordV2[] {
  const rows = all<Record<string, unknown>>(
    'SELECT * FROM bookings WHERE roomId = ? ORDER BY startAt ASC, createdAt DESC LIMIT ?',
    [roomId, options?.limit ?? 50]
  );
  return rows.map(deserializeBookingRow);
}

export function getAllBookings(limit = 100): BookingRecordV2[] {
  return all<Record<string, unknown>>('SELECT * FROM bookings ORDER BY createdAt DESC LIMIT ?', [limit]).map(deserializeBookingRow);
}

export function listBookings(options: { userEmail: string; status?: BookingStatus; limit?: number }): BookingRecordV2[] {
  return getBookingsByUser(options.userEmail, { status: options.status, limit: options.limit });
}

function normalizeCalendarEventDate(input?: { dateTime?: string; date?: string }): string | null {
  if (!input) {
    return null;
  }
  if (typeof input.dateTime === 'string' && input.dateTime) {
    return new Date(input.dateTime).toISOString();
  }
  if (typeof input.date === 'string' && input.date) {
    return new Date(`${input.date}T00:00:00.000Z`).toISOString();
  }
  return null;
}

export async function reconcileUserBookingsWithCalendar(userEmail: string, limit = 120): Promise<number> {
  const bookings = getBookingsByUser(userEmail, { limit }).filter(
    (booking) =>
      Boolean(booking.externalEventId) &&
      (booking.status === 'pending' || booking.status === 'confirmed' || booking.status === 'modified' || booking.status === 'sync_error')
  );

  let changed = 0;
  const fallbackSyncedRooms = new Set<string>();

  for (const booking of bookings) {
    if (!booking.externalEventId) {
      continue;
    }

    try {
      const event = await getRoomCalendarEvent({
        calendarId: booking.calendarId,
        eventId: booking.externalEventId,
      });

      const now = nowIso();
      const cancelledOutside = !event || event.status === 'cancelled';

      if (cancelledOutside) {
        if (booking.status !== 'cancelled') {
          run(
            `
              UPDATE bookings
              SET status = 'cancelled',
                  syncState = 'synced',
                  updatedAt = ?,
                  cancelledAt = COALESCE(cancelledAt, ?)
              WHERE id = ?
            `,
            [now, now, booking.id]
          );
          changed += 1;
        }

        upsertCalendarEventProjection({
          externalEventId: booking.externalEventId,
          calendarId: booking.calendarId,
          roomId: booking.roomId,
          startAt: booking.startAt,
          endAt: booking.endAt,
          summary: booking.title,
          organizer: null,
          updatedAt: event?.updated ? new Date(event.updated).toISOString() : now,
          source: 'google_calendar',
          isDeleted: true,
          rawJson: event?.rawJson ?? JSON.stringify({ id: booking.externalEventId, status: 'cancelled' }),
          syncedAt: now,
        });
        continue;
      }

      const nextStartAt = normalizeCalendarEventDate(event.start) ?? booking.startAt;
      const nextEndAt = normalizeCalendarEventDate(event.end) ?? booking.endAt;
      const nextTitle = (event.summary || booking.title || '').trim() || booking.title;
      const nextDuration = Math.max(1, Math.round((new Date(nextEndAt).getTime() - new Date(nextStartAt).getTime()) / 60000));
      const hasScheduleChanged =
        nextTitle !== booking.title ||
        nextStartAt !== booking.startAt ||
        nextEndAt !== booking.endAt ||
        nextDuration !== booking.duration;

      const nextStatus: BookingStatus = hasScheduleChanged
        ? 'modified'
        : booking.status === 'pending' || booking.status === 'sync_error' || booking.status === 'cancelled'
          ? 'confirmed'
          : booking.status;

      if (
        hasScheduleChanged ||
        booking.status !== nextStatus ||
        booking.syncState !== 'synced' ||
        booking.cancelledAt !== null ||
        (event.htmlLink ?? booking.calendarLink) !== booking.calendarLink
      ) {
        run(
          `
            UPDATE bookings
            SET title = ?,
                startAt = ?,
                endAt = ?,
                duration = ?,
                status = ?,
                syncState = 'synced',
                calendarLink = ?,
                rawCalendarJson = ?,
                updatedAt = ?,
                confirmedAt = COALESCE(confirmedAt, ?),
                cancelledAt = NULL
            WHERE id = ?
          `,
          [
            nextTitle,
            nextStartAt,
            nextEndAt,
            nextDuration,
            nextStatus,
            event.htmlLink ?? booking.calendarLink,
            event.rawJson,
            now,
            now,
            booking.id,
          ]
        );
        changed += 1;
      }

      upsertCalendarEventProjection({
        externalEventId: booking.externalEventId,
        calendarId: booking.calendarId,
        roomId: booking.roomId,
        startAt: nextStartAt,
        endAt: nextEndAt,
        summary: nextTitle,
        organizer: null,
        updatedAt: event.updated ? new Date(event.updated).toISOString() : now,
        source: 'google_calendar',
        isDeleted: false,
        rawJson: event.rawJson,
        syncedAt: now,
      });
    } catch {
      if (fallbackSyncedRooms.has(booking.roomId)) {
        continue;
      }
      fallbackSyncedRooms.add(booking.roomId);
      try {
        await bootstrapRoomProjection(booking.roomId);
      } catch {
        // Ignore fallback errors to keep read APIs responsive.
      }
    }
  }

  return changed;
}

export function createBookingRecord(input: BookingCreateInput & {
  externalEventId?: string | null;
  calendarLink?: string | null;
  rawCalendarJson?: string | null;
  status?: BookingStatus;
  syncState?: BookingRecordV2['syncState'];
  roomSnapshot?: RoomCatalogEntry;
}): BookingRecordV2 {
  seedRoomCatalog();
  const room = getRoomCatalogEntry(input.roomId);
  if (!room) {
    throw createBookingError(BOOKING_ERROR_CODES.ROOM_NOT_FOUND, `Unknown roomId: ${input.roomId}`);
  }

  const bookingWindow = resolveBookingWindow(input);
  const bookingTitle = input.title ?? `Booking at ${room.name}`;

  const record: BookingRecordV2 = {
    id: randomUUID(),
    userEmail: input.userEmail,
    roomId: input.roomId,
    roomName: room.name ?? input.roomId,
    calendarId: room.calendarId ?? resolveCalendarIdForRoom(room),
    externalEventId: input.externalEventId ?? null,
    title: bookingTitle,
    startAt: bookingWindow.startAt,
    endAt: bookingWindow.endAt,
    duration: input.duration,
    status: input.status ?? 'pending',
    syncState: input.syncState ?? 'pending',
    calendarLink: input.calendarLink ?? null,
    notes: input.notes ?? null,
    roomSnapshotJson: serializeRoomSnapshot(input.roomSnapshot ?? room),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    confirmedAt: (input.status ?? 'pending') === 'confirmed' ? nowIso() : null,
    cancelledAt: null,
    source: input.source ?? 'system',
    rawCalendarJson: input.rawCalendarJson ?? null,
  };

  return insertBookingRow(record);
}

export function updateBookingStatus(args: {
  bookingId: string;
  status: BookingStatus;
  syncState?: BookingRecordV2['syncState'];
  externalEventId?: string | null;
  calendarLink?: string | null;
  rawCalendarJson?: string | null;
  confirmedAt?: string | null;
  cancelledAt?: string | null;
}): BookingRecordV2 | undefined {
  const existing = getBookingById(args.bookingId);
  if (!existing) {
    return undefined;
  }

  const updated: BookingRecordV2 = {
    ...existing,
    status: args.status,
    syncState: args.syncState ?? existing.syncState,
    externalEventId: args.externalEventId ?? existing.externalEventId,
    calendarLink: args.calendarLink ?? existing.calendarLink,
    rawCalendarJson: args.rawCalendarJson ?? existing.rawCalendarJson,
    updatedAt: nowIso(),
    confirmedAt: args.confirmedAt ?? existing.confirmedAt,
    cancelledAt: args.cancelledAt ?? existing.cancelledAt,
  };

  run(
    `
      UPDATE bookings
      SET status = ?, syncState = ?, externalEventId = ?, calendarLink = ?, rawCalendarJson = ?,
          updatedAt = ?, confirmedAt = ?, cancelledAt = ?
      WHERE id = ?
    `,
    [
      updated.status,
      updated.syncState,
      updated.externalEventId,
      updated.calendarLink,
      updated.rawCalendarJson,
      updated.updatedAt,
      updated.confirmedAt,
      updated.cancelledAt,
      updated.id,
    ]
  );

  return updated;
}

export async function createConfirmedBooking(input: BookingCreateInput): Promise<BookingCreateResult> {
  seedRoomCatalog();
  const room = getRoomCatalogEntry(input.roomId);
  if (!room) {
    throw createBookingError(BOOKING_ERROR_CODES.ROOM_NOT_FOUND, `Unknown roomId: ${input.roomId}`);
  }

  if (listProjectedCalendarEvents(room.id).length === 0) {
    await bootstrapRoomProjection(room.id);
  }

  const { startAt, endAt } = resolveBookingWindow(input);
  if (new Date(startAt).getTime() < Date.now()) {
    throw createBookingError(BOOKING_ERROR_CODES.BOOKING_IN_PAST, 'Cannot create booking in the past');
  }
  const conflicts = getProjectedConflictingEvents(room.id, startAt, endAt);
  if (conflicts.length > 0) {
    throw createBookingError(
      BOOKING_ERROR_CODES.ROOM_NOT_AVAILABLE,
      `Room ${room.name} is not available for the requested slot`
    );
  }

  const bookingTitle = input.title ?? `Họp tại phòng ${room.name ?? input.roomId}`;

  const calendarEvent = await createRoomCalendarEvent({
    calendarId: resolveCalendarIdForRoom(room),
    input: {
      summary: bookingTitle,
      description: input.notes,
      location: `Phong ${room.name} - Apero`,
      startAt,
      endAt,
      timeZone: room.timezone,
      extendedProperties: {
        private: {
          roomId: room.id,
          bookingSource: input.source ?? 'system',
        },
      },
      visibility: 'private',
      transparency: 'opaque',
    },
  });

  const booking = createBookingRecord({
    ...input,
    title: bookingTitle,
    roomSnapshot: room,
    startAt,
    endAt,
    externalEventId: calendarEvent.id || randomUUID(),
    calendarLink:
      calendarEvent.htmlLink || buildRoomBookingLink(room as Required<Pick<typeof room, 'name'>>, startAt, endAt, bookingTitle),
    rawCalendarJson: calendarEvent.rawJson,
    status: 'confirmed',
    syncState: 'synced',
    source: input.source ?? 'system',
  });

  upsertCalendarEventProjection({
    externalEventId: calendarEvent.id || randomUUID(),
    calendarId: room.calendarId,
    roomId: room.id,
    startAt,
    endAt,
    summary: bookingTitle,
    organizer: null,
    updatedAt: new Date().toISOString(),
    source: 'google_calendar',
    isDeleted: false,
    rawJson: calendarEvent.rawJson,
    syncedAt: nowIso(),
  });

  return { ...booking, booking, calendarEvent };
}

export async function updateBookingEvent(args: {
  bookingId: string;
  title?: string;
  startAt?: string | Date;
  endAt?: string | Date;
  notes?: string;
}): Promise<BookingRecordV2> {
  const booking = getBookingById(args.bookingId);
  if (!booking) {
    throw new Error(`Booking not found: ${args.bookingId}`);
  }

  const room = getRoomCatalogEntry(booking.roomId);
  if (!room) {
    throw new Error(`Unknown roomId: ${booking.roomId}`);
  }

  if (!booking.externalEventId) {
    throw new Error(`Booking ${booking.id} does not have an external calendar event`);
  }

  const updatedEvent = await updateRoomCalendarEvent({
    calendarId: booking.calendarId,
    eventId: booking.externalEventId,
    input: {
      summary: args.title ?? booking.title,
      description: args.notes ?? booking.notes ?? undefined,
      startAt: args.startAt ?? booking.startAt,
      endAt: args.endAt ?? booking.endAt,
      timeZone: room.timezone,
    },
  });

  const updated = updateBookingStatus({
    bookingId: booking.id,
    status: 'modified',
    syncState: 'pending',
    externalEventId: updatedEvent.id || booking.externalEventId || null,
    calendarLink: updatedEvent.htmlLink ?? booking.calendarLink,
    rawCalendarJson: updatedEvent.rawJson,
  });

  if (!updated) {
    throw new Error(`Failed to update booking ${booking.id}`);
  }

  return updated;
}

export async function cancelBookingEvent(bookingId: string): Promise<BookingRecordV2> {
  const booking = getBookingById(bookingId);
  if (!booking) {
    throw new Error(`Booking not found: ${bookingId}`);
  }

  if (!booking.externalEventId) {
    throw new Error(`Booking ${booking.id} does not have an external calendar event`);
  }

  await cancelRoomCalendarEvent({
    calendarId: booking.calendarId,
    eventId: booking.externalEventId,
  });

  upsertCalendarEventProjection({
    externalEventId: booking.externalEventId,
    calendarId: booking.calendarId,
    roomId: booking.roomId,
    startAt: booking.startAt,
    endAt: booking.endAt,
    summary: booking.title,
    organizer: null,
    updatedAt: nowIso(),
    source: 'google_calendar',
    isDeleted: true,
    rawJson: booking.rawCalendarJson ?? JSON.stringify({ bookingId: booking.id, status: 'cancelled' }),
    syncedAt: nowIso(),
  });

  const updated = updateBookingStatus({
    bookingId: booking.id,
    status: 'cancelled',
    syncState: 'synced',
    cancelledAt: nowIso(),
  });

  if (!updated) {
    throw new Error(`Failed to cancel booking ${booking.id}`);
  }

  return updated;
}

export function findBookingByExternalEvent(calendarId: string, externalEventId: string): BookingRecordV2 | undefined {
  const row = get<Record<string, unknown>>(
    'SELECT * FROM bookings WHERE calendarId = ? AND externalEventId = ? ORDER BY createdAt DESC LIMIT 1',
    [calendarId, externalEventId]
  );
  return row ? deserializeBookingRow(row) : undefined;
}

export function getUserBookings(userEmail: string, limit = 30): BookingRecordV2[] {
  return getBookingsByUser(userEmail, { limit });
}

export function getUserBookingDetail(bookingId: string | string[], userEmail: string): BookingRecordV2 | null {
  const booking = getBookingById(bookingId);
  if (!booking || booking.userEmail !== userEmail) {
    return null;
  }

  return booking;
}

export function getLatestUserBooking(userEmail: string): BookingRecordV2 | null {
  return getRecentBookingByUser(userEmail) ?? null;
}
