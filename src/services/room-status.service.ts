import { checkRoomAvailability } from './calendar.service';
import {
  bootstrapRoomProjection,
  getProjectedConflictingEvents,
  listProjectedCalendarEvents,
  upsertCalendarEventProjection,
} from './calendar-sync.service';
import { getBookingById, listBookingsForRoom } from './booking.service';
import { getRoomCatalogEntry, listRoomCatalogEntries, seedRoomCatalog } from './room-catalog.service';
import { get } from './database.service';
import type { BookingRecordV2, CalendarEventProjection, RoomCatalogEntry, RoomStatusSnapshot } from './sync.types';
import type { CalendarEvent, RoomAvailability } from '../types';

interface BookingRowRef {
  id: string;
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

function toSyntheticBooking(room: RoomCatalogEntry, projection: CalendarEventProjection): BookingRecordV2 {
  const duration = Math.max(
    15,
    Math.round((new Date(projection.endAt).getTime() - new Date(projection.startAt).getTime()) / 60000)
  );

  return {
    id: `projection:${projection.calendarId}:${projection.externalEventId}`,
    userEmail: projection.organizer ?? 'calendar@system.local',
    roomId: room.id,
    roomName: room.name,
    calendarId: room.calendarId,
    externalEventId: projection.externalEventId,
    title: projection.summary || `Lịch tại phòng ${room.name}`,
    startAt: projection.startAt,
    endAt: projection.endAt,
    duration,
    status: 'confirmed',
    syncState: 'synced',
    calendarLink: null,
    notes: null,
    roomSnapshotJson: serializeRoomSnapshot(room),
    createdAt: projection.updatedAt,
    updatedAt: projection.updatedAt,
    confirmedAt: projection.updatedAt,
    cancelledAt: null,
    source: projection.source,
    rawCalendarJson: projection.rawJson,
  };
}

function getCurrentRoomBookingRef(roomId: string): BookingRowRef | null {
  const nowIso = new Date().toISOString();
  return (
    get<BookingRowRef>(
      `
        SELECT id
        FROM bookings
        WHERE roomId = ?
          AND status IN ('pending', 'confirmed', 'modified')
          AND startAt <= ?
          AND endAt > ?
        ORDER BY updatedAt DESC
        LIMIT 1
      `,
      [roomId, nowIso, nowIso]
    ) ?? null
  );
}

function getNextRoomBookingRef(roomId: string): BookingRowRef | null {
  const nowIso = new Date().toISOString();
  return (
    get<BookingRowRef>(
      `
        SELECT id
        FROM bookings
        WHERE roomId = ?
          AND status IN ('pending', 'confirmed', 'modified')
          AND startAt > ?
        ORDER BY startAt ASC
        LIMIT 1
      `,
      [roomId, nowIso]
    ) ?? null
  );
}

function getProjectionCurrentBooking(room: RoomCatalogEntry): BookingRecordV2 | null {
  const now = new Date();
  const projection = getProjectedConflictingEvents(room.id, now, now)[0];
  return projection ? toSyntheticBooking(room, projection) : null;
}

function getProjectionNextBooking(room: RoomCatalogEntry): BookingRecordV2 | null {
  const nowIso = new Date().toISOString();
  const projection = listProjectedCalendarEvents(room.id)
    .filter((event) => !event.isDeleted && event.startAt > nowIso)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];

  return projection ? toSyntheticBooking(room, projection) : null;
}

function listRoomBookedSlots(room: RoomCatalogEntry, limit = 80): Array<{
  externalEventId: string;
  summary: string;
  startAt: string;
  endAt: string;
  source: string;
  status: string;
}> {
  const projections = listProjectedCalendarEvents(room.id)
    .filter((event) => !event.isDeleted)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .slice(0, limit);

  return projections.map((event) => ({
    externalEventId: event.externalEventId,
    summary: event.summary || `Sự kiện phòng ${room.name}`,
    startAt: event.startAt,
    endAt: event.endAt,
    source: event.source,
    status: 'confirmed',
  }));
}

async function ensureProjectionLoaded(roomId: string): Promise<void> {
  if (listProjectedCalendarEvents(roomId).length === 0) {
    await bootstrapRoomProjection(roomId);
  }
}

export async function getRoomStatusSnapshot(roomId: string): Promise<RoomStatusSnapshot | undefined> {
  seedRoomCatalog();
  const room = getRoomCatalogEntry(roomId);
  if (!room) {
    return undefined;
  }

  await ensureProjectionLoaded(roomId);

  const currentBookingRef = getCurrentRoomBookingRef(roomId);
  const nextBookingRef = getNextRoomBookingRef(roomId);
  const currentBooking = currentBookingRef
    ? getBookingById(currentBookingRef.id) ?? null
    : getProjectionCurrentBooking(room);
  const nextBooking = nextBookingRef ? getBookingById(nextBookingRef.id) ?? null : getProjectionNextBooking(room);
  const now = new Date();
  const activeProjection = getProjectedConflictingEvents(roomId, now, now);
  const syncState = get<{ syncState: string; lastSyncedAt: string | null }>(
    'SELECT syncState, lastSyncedAt FROM room_sync_state WHERE roomId = ?',
    [roomId]
  );

  let status: RoomStatusSnapshot['status'] = 'unknown';
  let source: RoomStatusSnapshot['source'] = 'system';

  if (currentBooking || activeProjection.length > 0) {
    status = 'busy';
    source = currentBooking?.source ?? activeProjection[0]?.source ?? 'google_calendar';
  } else if (nextBooking) {
    status = 'reserved';
    source = 'google_calendar';
  } else if (listProjectedCalendarEvents(roomId).length > 0) {
    status = 'available';
    source = listProjectedCalendarEvents(roomId)[0]?.source ?? 'recall';
  } else {
    status = 'syncing';
    source = 'ical_fallback';
  }

  return {
    roomId: room.id,
    roomName: room.name,
    calendarId: room.calendarId,
    syncState: (syncState?.syncState as RoomStatusSnapshot['syncState']) || room.syncState,
    status,
    currentBooking,
    nextBooking,
    lastSyncedAt: syncState?.lastSyncedAt ?? room.lastSyncedAt ?? null,
    source,
  };
}

export async function listRoomStatusSnapshots(): Promise<RoomStatusSnapshot[]> {
  const snapshots = await Promise.all(listRoomCatalogEntries().map((room) => getRoomStatusSnapshot(room.id)));
  return snapshots.filter((snapshot): snapshot is RoomStatusSnapshot => Boolean(snapshot));
}

export async function listCandidateRooms(numberOfPeople: number, startAt: string, endAt: string) {
  seedRoomCatalog();
  const rooms = listRoomCatalogEntries().filter((room) => room.capacity >= numberOfPeople);
  return Promise.all(
    rooms.map(async (room) => {
      const availability = await checkManagedRoomAvailability(room, startAt, endAt);
      return {
        room,
        available: availability.available,
        conflictingEvents: availability.conflictingEvents,
      };
    })
  );
}

export async function ensureRoomAvailabilitySnapshot(roomId: string, startAt: string | Date, endAt: string | Date) {
  const room = getRoomCatalogEntry(roomId);
  if (!room) {
    return undefined;
  }

  await ensureProjectionLoaded(roomId);

  const conflictingEvents = getProjectedConflictingEvents(roomId, startAt, endAt);
  if (conflictingEvents.length > 0) {
    return {
      available: false,
      room,
      conflictingEvents: conflictingEvents.map((event) => ({
        summary: event.summary,
        start: new Date(event.startAt),
        end: new Date(event.endAt),
      })),
    };
  }

  return checkRoomAvailability(
    room,
    startAt instanceof Date ? startAt : new Date(startAt),
    endAt instanceof Date ? endAt : new Date(endAt)
  );
}

function toCalendarEventsFromProjection(roomId: string, startAt: string | Date, endAt: string | Date): CalendarEvent[] {
  return getProjectedConflictingEvents(roomId, startAt, endAt).map((event) => ({
    summary: event.summary,
    start: new Date(event.startAt),
    end: new Date(event.endAt),
  }));
}

export async function checkManagedRoomAvailability(
  room: {
    id: string;
    name: string;
    icalLink: string;
    calendarId: string;
    capacity: number;
    floor: string;
    description: string;
    equipment: string[];
    image?: string | null;
    color?: string | null;
    features: string[];
  },
  startAt: string | Date,
  endAt: string | Date
): Promise<RoomAvailability> {
  const roomRecord = getRoomCatalogEntry(room.id);
  if (roomRecord) {
    await ensureProjectionLoaded(room.id);
  }

  const projectionConflicts = toCalendarEventsFromProjection(room.id, startAt, endAt);
  if (projectionConflicts.length > 0 && roomRecord) {
    return {
      room: roomRecord as never,
      available: false,
      conflictingEvents: projectionConflicts,
    } as RoomAvailability;
  }

  const fallback = await checkRoomAvailability(
    (roomRecord ?? room) as never,
    startAt instanceof Date ? startAt : new Date(startAt),
    endAt instanceof Date ? endAt : new Date(endAt)
  );

  return fallback as RoomAvailability;
}

export async function listRoomsWithStatus() {
  seedRoomCatalog();
  const rooms = listRoomCatalogEntries();

  return Promise.all(
    rooms.map(async (room) => ({
      ...room,
      status: await getRoomStatusSnapshot(room.id),
    }))
  );
}

function normalizeRoomId(roomId: string | string[]): string {
  return Array.isArray(roomId) ? roomId[0] ?? '' : roomId;
}

export async function getRoomDetail(roomId: string | string[]) {
  seedRoomCatalog();
  const room = getRoomCatalogEntry(normalizeRoomId(roomId));
  if (!room) {
    return null;
  }

  await ensureProjectionLoaded(room.id);

  const status = await getRoomStatusSnapshot(room.id);
  const upcomingBookings = listBookingsForRoom(room.id, { limit: 30 }).map((booking) => ({
    id: booking.id,
    title: booking.title,
    startAt: booking.startAt,
    endAt: booking.endAt,
    status: booking.status,
  }));

  return {
    ...room,
    status,
    upcomingBookings,
    bookedSlots: listRoomBookedSlots(room),
  };
}

export async function importCalendarProjection(
  roomId: string,
  calendarId: string,
  events: Array<{
    externalEventId: string;
    summary: string;
    organizer: string | null;
    startAt: string;
    endAt: string;
    updatedAt: string;
    isDeleted?: boolean;
    source: 'google_calendar' | 'recall' | 'ical' | 'ical_fallback';
    rawPayload?: string | null;
  }>
) {
  seedRoomCatalog();

  for (const event of events) {
    upsertCalendarEventProjection({
      externalEventId: event.externalEventId,
      calendarId,
      roomId,
      startAt: event.startAt,
      endAt: event.endAt,
      summary: event.summary,
      organizer: event.organizer,
      updatedAt: event.updatedAt,
      source: event.source === 'ical' ? 'ical_fallback' : event.source,
      isDeleted: Boolean(event.isDeleted),
      rawJson: event.rawPayload ?? JSON.stringify(event),
      syncedAt: new Date().toISOString(),
    });
  }
}

