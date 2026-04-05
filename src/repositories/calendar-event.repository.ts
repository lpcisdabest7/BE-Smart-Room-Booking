import crypto from 'crypto';
import { getDb } from '../db/database';
import { CalendarEventProjection, SyncSource } from '../types';

type CalendarEventRow = {
  id: string;
  external_event_id: string;
  calendar_id: string;
  room_id: string;
  summary: string;
  organizer: string | null;
  start_at: string;
  end_at: string;
  updated_at: string;
  is_deleted: number;
  source: SyncSource;
  raw_payload: string | null;
};

function mapRow(row: CalendarEventRow): CalendarEventProjection {
  return {
    id: row.id,
    externalEventId: row.external_event_id,
    calendarId: row.calendar_id,
    roomId: row.room_id,
    summary: row.summary,
    organizer: row.organizer,
    startAt: row.start_at,
    endAt: row.end_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
    source: row.source,
    rawPayload: row.raw_payload,
  };
}

export function upsertCalendarEvent(input: Omit<CalendarEventProjection, 'id'> & { id?: string }) {
  const id = input.id ?? crypto.randomUUID();
  getDb()
    .prepare(`
      INSERT INTO calendar_events (
        id, external_event_id, calendar_id, room_id, summary, organizer, start_at, end_at,
        updated_at, is_deleted, source, raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_event_id, calendar_id) DO UPDATE SET
        room_id = excluded.room_id,
        summary = excluded.summary,
        organizer = excluded.organizer,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        updated_at = excluded.updated_at,
        is_deleted = excluded.is_deleted,
        source = excluded.source,
        raw_payload = excluded.raw_payload
    `)
    .run(
      id,
      input.externalEventId,
      input.calendarId,
      input.roomId,
      input.summary,
      input.organizer,
      input.startAt,
      input.endAt,
      input.updatedAt,
      input.isDeleted ? 1 : 0,
      input.source,
      input.rawPayload
    );

  return getCalendarEventByExternalId(input.externalEventId, input.calendarId);
}

export function getCalendarEventByExternalId(externalEventId: string, calendarId: string) {
  const row = getDb()
    .prepare('SELECT * FROM calendar_events WHERE external_event_id = ? AND calendar_id = ?')
    .get(externalEventId, calendarId) as CalendarEventRow | undefined;
  return row ? mapRow(row) : null;
}

export function findConflictingEvents(roomId: string, startAt: string, endAt: string) {
  const rows = getDb()
    .prepare(`
      SELECT * FROM calendar_events
      WHERE room_id = ?
        AND is_deleted = 0
        AND start_at < ?
        AND end_at > ?
      ORDER BY start_at ASC
    `)
    .all(roomId, endAt, startAt) as CalendarEventRow[];

  return rows.map(mapRow);
}

export function getCurrentAndNextEvents(roomId: string, nowIso: string) {
  const current = getDb()
    .prepare(`
      SELECT * FROM calendar_events
      WHERE room_id = ? AND is_deleted = 0 AND start_at <= ? AND end_at > ?
      ORDER BY start_at ASC
      LIMIT 1
    `)
    .get(roomId, nowIso, nowIso) as CalendarEventRow | undefined;

  const next = getDb()
    .prepare(`
      SELECT * FROM calendar_events
      WHERE room_id = ? AND is_deleted = 0 AND start_at > ?
      ORDER BY start_at ASC
      LIMIT 1
    `)
    .get(roomId, nowIso) as CalendarEventRow | undefined;

  return {
    current: current ? mapRow(current) : null,
    next: next ? mapRow(next) : null,
  };
}

export function listRoomEvents(roomId: string, limit: number) {
  const rows = getDb()
    .prepare(`
      SELECT * FROM calendar_events
      WHERE room_id = ? AND is_deleted = 0
      ORDER BY start_at ASC
      LIMIT ?
    `)
    .all(roomId, limit) as CalendarEventRow[];

  return rows.map(mapRow);
}
