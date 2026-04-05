import type { BookingRecordV2, RoomCatalogEntry, RoomStatusSnapshot } from './sync.types';
import type { Room } from '../types';

const DISPLAY_TIMEZONE = 'Asia/Bangkok';

type RoomSlot = {
  externalEventId: string;
  startAt: string;
  endAt: string;
  summary: string;
  status?: string;
  source?: string;
};

type RoomLike = {
  id?: string;
  name?: string;
  capacity?: number;
  floor?: RoomCatalogEntry['floor'] | Room['floor'];
  description?: string;
  image?: string | null;
  color?: string | null;
  equipment?: string[];
  features?: string[];
  timezone?: string;
  liveStatus?: string;
  currentBooking?: BookingRecordV2 | null;
  nextBooking?: BookingRecordV2 | null;
  status?: RoomStatusSnapshot | null;
  bookedSlots?: RoomSlot[];
};

export interface PublicRoomSlot {
  externalEventId: string;
  title: string;
  startAt: string;
  endAt: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  source: string;
}

export interface PublicRoom {
  id: string;
  name: string;
  capacity: number;
  floor?: RoomLike['floor'];
  description?: string;
  image: string | null;
  color: string | null;
  equipment: string[];
  features: string[];
  timezone: string;
  liveStatus: string;
  currentBooking: PublicBooking | null;
  nextBooking: PublicBooking | null;
  bookedSlots: PublicRoomSlot[];
}

export interface PublicBooking {
  id: string;
  userEmail: string;
  roomId: string;
  roomName: string;
  date: string;
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  duration: number;
  title: string;
  status: BookingRecordV2['status'];
  createdAt: string;
  updatedAt: string;
  calendarLink: string | null;
  calendarEventId: string | null;
  source: BookingRecordV2['source'];
  notes: string | null;
  room?: PublicRoom;
}

function getZonedParts(isoValue: string, timeZone = DISPLAY_TIMEZONE) {
  const date = new Date(isoValue);
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';

  return {
    date: `${lookup('year')}-${lookup('month')}-${lookup('day')}`,
    time: `${lookup('hour')}:${lookup('minute')}`,
  };
}

function parseRoomSnapshot(roomSnapshotJson?: string | null): RoomLike | null {
  if (!roomSnapshotJson) {
    return null;
  }

  try {
    return JSON.parse(roomSnapshotJson) as RoomLike;
  } catch {
    return null;
  }
}

function formatPublicRoomSlot(slot: RoomSlot, timezone: string): PublicRoomSlot {
  const start = getZonedParts(slot.startAt, timezone);
  const end = getZonedParts(slot.endAt, timezone);

  return {
    externalEventId: slot.externalEventId,
    title: slot.summary || 'Sự kiện phòng',
    startAt: slot.startAt,
    endAt: slot.endAt,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    status: slot.status ?? 'confirmed',
    source: slot.source ?? 'calendar',
  };
}

export function formatPublicBooking(
  booking?: BookingRecordV2 | null,
  options: { includeRoom?: boolean } = {}
): PublicBooking | null {
  if (!booking) {
    return null;
  }

  const includeRoom = options.includeRoom ?? true;
  const roomSnapshot = parseRoomSnapshot(booking.roomSnapshotJson);
  const roomTimeZone = roomSnapshot?.timezone || DISPLAY_TIMEZONE;
  const start = getZonedParts(booking.startAt, roomTimeZone);
  const end = getZonedParts(booking.endAt, roomTimeZone);

  return {
    id: booking.id,
    userEmail: booking.userEmail,
    roomId: booking.roomId,
    roomName: booking.roomName,
    date: start.date,
    startTime: start.time,
    endTime: end.time,
    startAt: booking.startAt,
    endAt: booking.endAt,
    duration: booking.duration,
    title: booking.title,
    status: booking.status,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    calendarLink: booking.calendarLink ?? null,
    calendarEventId: booking.externalEventId ?? null,
    source: booking.source,
    notes: booking.notes ?? null,
    room: includeRoom && roomSnapshot ? formatPublicRoom(roomSnapshot, { includeBookings: false }) : undefined,
  };
}

export function formatPublicRoom(room: RoomLike, options: { includeBookings?: boolean } = {}): PublicRoom {
  const includeBookings = options.includeBookings ?? true;
  const status = room.status ?? null;
  const currentBooking = room.currentBooking ?? status?.currentBooking ?? null;
  const nextBooking = room.nextBooking ?? status?.nextBooking ?? null;
  const timezone = room.timezone ?? DISPLAY_TIMEZONE;
  const liveStatus =
    room.liveStatus ??
    (currentBooking ? 'busy' : nextBooking ? 'reserved' : status?.status ?? 'unknown');

  return {
    id: room.id ?? 'unknown-room',
    name: room.name ?? 'Unknown room',
    capacity: room.capacity ?? 0,
    floor: room.floor,
    description: room.description,
    image: room.image ?? null,
    color: room.color ?? null,
    equipment: room.equipment ?? [],
    features: room.features ?? [],
    timezone,
    liveStatus,
    currentBooking: includeBookings ? formatPublicBooking(currentBooking, { includeRoom: false }) : null,
    nextBooking: includeBookings ? formatPublicBooking(nextBooking, { includeRoom: false }) : null,
    bookedSlots: (room.bookedSlots ?? []).map((slot) => formatPublicRoomSlot(slot, timezone)),
  };
}

