import crypto from 'crypto';
import { getDb } from '../db/database';
import { BookingRecord, BookingStatus, BookingWithRoom, SyncSource } from '../types';

type BookingRow = {
  id: string;
  user_email: string;
  user_name: string;
  room_id: string;
  room_name: string;
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  duration: number;
  status: BookingStatus;
  calendar_event_id: string | null;
  calendar_link: string | null;
  sync_source: SyncSource | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: BookingRow): BookingRecord {
  return {
    id: row.id,
    userEmail: row.user_email,
    userName: row.user_name,
    roomId: row.room_id,
    roomName: row.room_name,
    title: row.title,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    duration: row.duration,
    status: row.status,
    calendarEventId: row.calendar_event_id,
    calendarLink: row.calendar_link,
    syncSource: row.sync_source,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBooking(
  input: Omit<BookingRecord, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
) {
  const nowIso = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();

  getDb()
    .prepare(`
      INSERT INTO bookings (
        id, user_email, user_name, room_id, room_name, title, date, start_time, end_time, duration,
        status, calendar_event_id, calendar_link, sync_source, last_synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      input.userEmail,
      input.userName ?? '',
      input.roomId,
      input.roomName,
      input.title ?? '',
      input.date,
      input.startTime,
      input.endTime,
      input.duration,
      input.status ?? 'pending',
      input.calendarEventId ?? null,
      input.calendarLink ?? null,
      input.syncSource ?? null,
      input.lastSyncedAt ?? null,
      nowIso,
      nowIso
    );

  return getBookingById(id);
}

export function updateBookingStatus(
  bookingId: string,
  status: BookingStatus,
  calendarEventId?: string | null,
  syncSource?: SyncSource | null
) {
  getDb()
    .prepare(`
      UPDATE bookings
      SET status = ?,
          calendar_event_id = COALESCE(?, calendar_event_id),
          sync_source = COALESCE(?, sync_source),
          last_synced_at = ?,
          updated_at = ?
      WHERE id = ?
    `)
    .run(status, calendarEventId ?? null, syncSource ?? null, new Date().toISOString(), new Date().toISOString(), bookingId);

  return getBookingById(bookingId);
}

export function listBookingsByUser(userEmail: string, limit = 50, status?: BookingStatus) {
  const db = getDb();
  const rows = status
    ? (db
        .prepare(`
          SELECT * FROM bookings
          WHERE user_email = ? AND status = ?
          ORDER BY start_time DESC, created_at DESC
          LIMIT ?
        `)
        .all(userEmail, status, limit) as BookingRow[])
    : (db
        .prepare(`
          SELECT * FROM bookings
          WHERE user_email = ?
          ORDER BY start_time DESC, created_at DESC
          LIMIT ?
        `)
        .all(userEmail, limit) as BookingRow[]);

  return rows.map(mapRow);
}

export function getRecentBookingByUser(userEmail: string) {
  const row = getDb()
    .prepare(`
      SELECT * FROM bookings
      WHERE user_email = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(userEmail) as BookingRow | undefined;

  return row ? mapRow(row) : null;
}

export function getBookingById(bookingId: string) {
  const row = getDb()
    .prepare('SELECT * FROM bookings WHERE id = ?')
    .get(bookingId) as BookingRow | undefined;
  return row ? mapRow(row) : null;
}

export function findBookingByCalendarEventId(calendarEventId: string) {
  const row = getDb()
    .prepare('SELECT * FROM bookings WHERE calendar_event_id = ?')
    .get(calendarEventId) as BookingRow | undefined;
  return row ? mapRow(row) : null;
}

export function listBookingsWithRoomsByUser(userEmail: string, limit = 50): BookingWithRoom[] {
  const rows = getDb()
    .prepare(`
      SELECT
        b.*,
        r.capacity,
        r.floor,
        r.description,
        r.equipment,
        r.image,
        r.color,
        r.features
      FROM bookings b
      JOIN rooms r ON r.id = b.room_id
      WHERE b.user_email = ?
      ORDER BY b.start_time DESC, b.created_at DESC
      LIMIT ?
    `)
    .all(userEmail, limit) as Array<
    BookingRow & {
      capacity: number;
      floor: number;
      description: string;
      equipment: string;
      image: string;
      color: string;
      features: string;
    }
  >;

  return rows.map((row) => ({
    ...mapRow(row),
    room: {
      id: row.room_id,
      name: row.room_name,
      capacity: row.capacity,
      floor: row.floor,
      description: row.description,
      equipment: JSON.parse(row.equipment) as string[],
      image: row.image,
      color: row.color,
      features: JSON.parse(row.features) as string[],
    },
  }));
}
