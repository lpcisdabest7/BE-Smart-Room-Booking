export interface RoomMetadata {
  roomId: string;
  roomName: string;
  floor: number;
  equipment: string[];
  description: string;
  image: string | null;
  color: string;
  features: string[];
}

export interface RoomRecord extends RoomMetadata {
  id: string;
  name: string;
  calendarId: string;
  icalLink: string;
  capacity: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoomSeedRecord {
  id: string;
  name: string;
  calendarId: string;
  icalLink: string;
  capacity: number;
  metadata: RoomMetadata;
}

export interface BookingSummary {
  id: string;
  roomId: string;
  roomName: string;
  title: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  syncState: BookingSyncState;
  calendarId: string;
  externalEventId: string | null;
  requestedBy: string;
}

export interface RoomStatusSnapshot {
  roomId: string;
  available: boolean;
  currentEventCount: number;
  nextBookingAt: string | null;
  nextBookingId: string | null;
  stale: boolean;
  lastSyncedAt: string | null;
}

export interface RoomProfile extends RoomRecord {
  status: RoomStatusSnapshot;
  nextBooking: BookingSummary | null;
  recentBookings: BookingSummary[];
}

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'modified'
  | 'cancelled'
  | 'sync_error';

export type BookingSyncState =
  | 'pending'
  | 'confirmed'
  | 'modified'
  | 'cancelled'
  | 'sync_error';

export type BookingSource = 'assistant' | 'manual' | 'room_card' | 'webhook';

export interface BookingRecord {
  id: string;
  userEmail: string;
  roomId: string;
  roomName: string;
  calendarId: string;
  externalEventId: string | null;
  title: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  status: BookingStatus;
  source: BookingSource;
  syncState: BookingSyncState;
  requestedAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  roomSnapshot: RoomMetadata;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function createRoomSnapshot(room: RoomRecord): RoomMetadata {
  return {
    roomId: room.roomId,
    roomName: room.roomName,
    floor: room.floor,
    equipment: [...room.equipment],
    description: room.description,
    image: room.image,
    color: room.color,
    features: [...room.features],
  };
}
