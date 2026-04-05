import * as ical from 'node-ical';
import { cacheService } from './cache.service';
import { all, get, nowIso, run, transaction } from './database.service';
import { fetchRecallCalendarEventsSince, normalizeRecallCalendarEvent } from './recall.service';
import { listRoomCalendarEvents, resolveCalendarIdForRoom } from './google-calendar.service';
import { getRoomCatalogEntry, listRoomCatalogEntries, seedRoomCatalog, updateRoomSyncState } from './room-catalog.service';
import type {
  CalendarEventProjection,
  CalendarSyncOutcome,
  RoomCatalogEntry,
  SyncSource,
} from './sync.types';

interface ICalEventRecord {
  externalEventId: string;
  calendarId: string;
  roomId: string;
  startAt: string;
  endAt: string;
  summary: string;
  organizer: string | null;
  updatedAt: string;
  source: SyncSource;
  isDeleted: boolean;
  rawJson: string;
  syncedAt: string;
}

async function fetchIcalEvents(
  icalLink: string
): Promise<Array<{ uid: string; summary: string; start: Date; end: Date; organizer: string | null; updatedAt: string }>> {
  const cacheKey = `ical:${icalLink}`;
  const cached = cacheService.get<Array<{ uid: string; summary: string; start: Date; end: Date; organizer: string | null; updatedAt: string }>>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const data = await ical.async.fromURL(icalLink);
    const events: Array<{ uid: string; summary: string; start: Date; end: Date; organizer: string | null; updatedAt: string }> = [];

    for (const key of Object.keys(data)) {
      const component = data[key];
      if (!component || component.type !== 'VEVENT') continue;
      const vevent = component as ical.VEvent & { uid?: string; organizer?: { params?: { CN?: string }; val?: string } | string; created?: Date; dtstamp?: Date };

      if (vevent.start && vevent.end) {
        const organizer =
          typeof vevent.organizer === 'string'
            ? vevent.organizer
            : vevent.organizer && typeof vevent.organizer === 'object'
              ? vevent.organizer.val ?? vevent.organizer.params?.CN ?? null
              : null;

        events.push({
          uid: typeof vevent.uid === 'string' && vevent.uid ? vevent.uid : `${key}`,
          summary: (typeof vevent.summary === 'string' ? vevent.summary : 'Untitled') || 'Untitled',
          start: new Date(vevent.start as unknown as string),
          end: new Date(vevent.end as unknown as string),
          organizer,
          updatedAt: (vevent.dtstamp || vevent.created || new Date()).toISOString(),
        });
      }
    }

    cacheService.set(cacheKey, events, 120);
    return events;
  } catch (error) {
    console.error(`Failed to fetch iCal from ${icalLink}:`, error);
    return [];
  }
}

function upsertProjection(event: ICalEventRecord): void {
  run(
    `
      INSERT INTO calendar_events (
        externalEventId, calendarId, roomId, startAt, endAt, summary,
        organizer, updatedAt, source, isDeleted, rawJson, syncedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(externalEventId, calendarId) DO UPDATE SET
        roomId = excluded.roomId,
        startAt = excluded.startAt,
        endAt = excluded.endAt,
        summary = excluded.summary,
        organizer = excluded.organizer,
        updatedAt = excluded.updatedAt,
        source = excluded.source,
        isDeleted = excluded.isDeleted,
        rawJson = excluded.rawJson,
        syncedAt = excluded.syncedAt
    `,
    [
      event.externalEventId,
      event.calendarId,
      event.roomId,
      event.startAt,
      event.endAt,
      event.summary,
      event.organizer,
      event.updatedAt,
      event.source,
      event.isDeleted ? 1 : 0,
      event.rawJson,
      event.syncedAt,
    ]
  );
}

function reconcileBookingsFromProjection(args: {
  calendarId: string;
  externalEventId: string;
  isDeleted: boolean;
}): void {
  const booking = get<{ id: string; status: string }>(
    'SELECT id, status FROM bookings WHERE calendarId = ? AND externalEventId = ? ORDER BY createdAt DESC LIMIT 1',
    [args.calendarId, args.externalEventId]
  );

  if (!booking) {
    return;
  }

  if (args.isDeleted) {
    run(
      `
        UPDATE bookings
        SET status = 'cancelled',
            syncState = 'synced',
            cancelledAt = ?,
            updatedAt = ?
        WHERE id = ?
      `,
      [nowIso(), nowIso(), booking.id]
    );
    return;
  }

  if (booking.status === 'pending' || booking.status === 'modified' || booking.status === 'sync_error') {
    run(
      `
        UPDATE bookings
        SET status = 'confirmed',
            syncState = 'synced',
            confirmedAt = COALESCE(confirmedAt, ?),
            updatedAt = ?
        WHERE id = ?
      `,
      [nowIso(), nowIso(), booking.id]
    );
  }
}

export function listProjectedCalendarEvents(roomId: string, includeDeleted = false): CalendarEventProjection[] {
  const rows = all<CalendarEventProjection>(
    `
      SELECT
        id, externalEventId, calendarId, roomId, startAt, endAt, summary,
        organizer, updatedAt, source, isDeleted, rawJson, syncedAt
      FROM calendar_events
      WHERE roomId = ?
      ${includeDeleted ? '' : 'AND isDeleted = 0'}
      ORDER BY startAt ASC
    `,
    [roomId]
  );

  return rows.map((row) => ({
    ...row,
    isDeleted: Boolean(row.isDeleted),
  }));
}

export function getProjectedConflictingEvents(
  roomId: string,
  startAt: string | Date,
  endAt: string | Date
): CalendarEventProjection[] {
  const startIso = startAt instanceof Date ? startAt.toISOString() : new Date(startAt).toISOString();
  const endIso = endAt instanceof Date ? endAt.toISOString() : new Date(endAt).toISOString();

  return all<CalendarEventProjection>(
    `
      SELECT
        id, externalEventId, calendarId, roomId, startAt, endAt, summary,
        organizer, updatedAt, source, isDeleted, rawJson, syncedAt
      FROM calendar_events
      WHERE roomId = ?
        AND isDeleted = 0
        AND startAt < ?
        AND endAt > ?
      ORDER BY startAt ASC
    `,
    [roomId, endIso, startIso]
  ).map((row) => ({
    ...row,
    isDeleted: Boolean(row.isDeleted),
  }));
}

export function getLatestProjectionUpdatedAt(calendarId: string): string | null {
  const row = get<{ updatedAt: string | null }>(
    'SELECT MAX(updatedAt) AS updatedAt FROM calendar_events WHERE calendarId = ?',
    [calendarId]
  );
  return row?.updatedAt ?? null;
}

export function upsertCalendarEventProjection(event: ICalEventRecord): CalendarEventProjection {
  upsertProjection(event);

  if (event.source === 'recall' || event.source === 'google_calendar') {
    reconcileBookingsFromProjection({
      calendarId: event.calendarId,
      externalEventId: event.externalEventId,
      isDeleted: event.isDeleted,
    });
  }

  return {
    id: undefined,
    externalEventId: event.externalEventId,
    calendarId: event.calendarId,
    roomId: event.roomId,
    startAt: event.startAt,
    endAt: event.endAt,
    summary: event.summary,
    organizer: event.organizer,
    updatedAt: event.updatedAt,
    source: event.source,
    isDeleted: event.isDeleted,
    rawJson: event.rawJson,
    syncedAt: event.syncedAt,
  };
}

function normalizeGoogleDateTime(input?: { dateTime?: string; date?: string }): string | null {
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

async function syncRoomProjectionFromGoogleApi(args: {
  roomId: string;
  calendarId: string;
  syncedAt: string;
  updatedAtGte?: string;
  syncMode: 'google_api_fallback' | 'google_webhook_fallback';
}): Promise<CalendarSyncOutcome> {
  let pageToken: string | undefined;
  let fetched = 0;
  let upserted = 0;
  let deleted = 0;

  do {
    const page = await listRoomCalendarEvents({
      calendarId: args.calendarId,
      updatedMin: args.updatedAtGte,
      singleEvents: true,
      showDeleted: true,
      maxResults: 250,
      pageToken,
    });
    const items = Array.isArray(page.items) ? page.items : [];
    fetched += items.length;

    transaction(() => {
      for (const event of items) {
        if (!event.id) {
          continue;
        }

        const startAt = normalizeGoogleDateTime(event.start) ?? event.updated ?? args.syncedAt;
        const endAt = normalizeGoogleDateTime(event.end) ?? startAt;
        const isDeleted = event.status === 'cancelled';

        upsertCalendarEventProjection({
          externalEventId: event.id,
          calendarId: args.calendarId,
          roomId: args.roomId,
          startAt,
          endAt,
          summary: event.summary || 'Untitled',
          organizer: event.organizer?.email ?? null,
          updatedAt: event.updated ? new Date(event.updated).toISOString() : args.syncedAt,
          source: 'google_calendar',
          isDeleted,
          rawJson: JSON.stringify(event),
          syncedAt: args.syncedAt,
        });

        upserted += 1;
        if (isDeleted) {
          deleted += 1;
        }
      }
    });

    pageToken = page.nextPageToken || undefined;
  } while (pageToken);

  updateRoomSyncState(args.roomId, {
    syncState: 'synced',
    lastSyncedAt: args.syncedAt,
    lastUpdatedTs: getLatestProjectionUpdatedAt(args.calendarId),
    lastSyncMode: args.syncMode,
    lastError: null,
  });

  return {
    calendarId: args.calendarId,
    roomId: args.roomId,
    fetched,
    upserted,
    deleted,
    lastUpdatedTs: getLatestProjectionUpdatedAt(args.calendarId),
    status: 'synced',
  };
}

export async function bootstrapRoomProjection(roomId: string): Promise<CalendarSyncOutcome> {
  seedRoomCatalog();
  const room = getRoomCatalogEntry(roomId);
  if (!room) {
    throw new Error(`Unknown roomId: ${roomId}`);
  }

  const calendarId = resolveCalendarIdForRoom(room);
  const syncedAt = nowIso();
  let recallError: string | null = null;
  let googleFallbackError: string | null = null;
  const updatedAtGte = getLatestProjectionUpdatedAt(calendarId) ?? undefined;

  try {
    if (process.env.RECALL_API_KEY) {
      try {
        const events = await fetchRecallCalendarEventsSince({ calendarId, pageSize: 250 });
        let upserted = 0;
        let deleted = 0;

        transaction(() => {
          for (const event of events) {
            const normalized = normalizeRecallCalendarEvent(event, calendarId);
            upsertCalendarEventProjection({
              externalEventId: normalized.externalEventId,
              calendarId: normalized.calendarId,
              roomId,
              startAt: normalized.startAt,
              endAt: normalized.endAt,
              summary: normalized.summary,
              organizer: normalized.organizer,
              updatedAt: normalized.updatedAt,
              source: 'recall',
              isDeleted: normalized.isDeleted,
              rawJson: normalized.rawJson,
              syncedAt,
            });
            upserted += 1;
            if (normalized.isDeleted) {
              deleted += 1;
            }
          }
        });

        updateRoomSyncState(roomId, {
          syncState: 'synced',
          lastSyncedAt: syncedAt,
          lastUpdatedTs: getLatestProjectionUpdatedAt(calendarId),
          lastSyncMode: 'recall',
          lastError: null,
        });

        return {
          calendarId,
          roomId,
          fetched: events.length,
          upserted,
          deleted,
          lastUpdatedTs: getLatestProjectionUpdatedAt(calendarId),
          status: 'synced',
        };
      } catch (error) {
        recallError = error instanceof Error ? error.message : String(error);
      }
    }

    try {
      return await syncRoomProjectionFromGoogleApi({
        roomId,
        calendarId,
        syncedAt,
        updatedAtGte,
        syncMode: 'google_api_fallback',
      });
    } catch (error) {
      googleFallbackError = error instanceof Error ? error.message : String(error);
    }

    const events = await fetchIcalEvents(room.icalLink);
    let upserted = 0;

    transaction(() => {
      run(
        `
          UPDATE calendar_events
          SET isDeleted = 1,
              syncedAt = ?,
              source = 'ical_fallback'
          WHERE roomId = ?
            AND calendarId = ?
            AND source = 'ical_fallback'
        `,
        [syncedAt, roomId, calendarId]
      );

      for (const event of events) {
        upsertCalendarEventProjection({
          externalEventId: event.uid,
          calendarId,
          roomId,
          startAt: event.start.toISOString(),
          endAt: event.end.toISOString(),
          summary: event.summary,
          organizer: event.organizer,
          updatedAt: event.updatedAt,
          source: 'ical_fallback',
          isDeleted: false,
          rawJson: JSON.stringify(event),
          syncedAt,
        });
        upserted += 1;
      }
    });

    updateRoomSyncState(roomId, {
      syncState: 'stale',
      lastSyncedAt: syncedAt,
      lastUpdatedTs: getLatestProjectionUpdatedAt(calendarId),
      lastSyncMode: 'ical_fallback',
      lastError: [recallError, googleFallbackError].filter(Boolean).join(' | ') || null,
    });

    return {
      calendarId,
      roomId,
      fetched: events.length,
      upserted,
      deleted: 0,
      lastUpdatedTs: getLatestProjectionUpdatedAt(calendarId),
      status: 'partial',
      error: [recallError, googleFallbackError].filter(Boolean).join(' | ') || null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateRoomSyncState(roomId, {
      syncState: 'error',
      lastSyncedAt: syncedAt,
      lastUpdatedTs: getLatestProjectionUpdatedAt(calendarId),
      lastSyncMode: 'error',
      lastError: message,
    });

    return {
      calendarId,
      roomId,
      fetched: 0,
      upserted: 0,
      deleted: 0,
      lastUpdatedTs: getLatestProjectionUpdatedAt(calendarId),
      status: 'error',
      error: message,
    };
  }
}

export async function syncRoomProjectionFromRecallWebhook(args: {
  roomId: string;
  calendarId: string;
  lastUpdatedTs?: string | null;
}): Promise<CalendarSyncOutcome> {
  const syncedAt = nowIso();
  let events: Awaited<ReturnType<typeof fetchRecallCalendarEventsSince>>;
  try {
    events = await fetchRecallCalendarEventsSince({
      calendarId: args.calendarId,
      updatedAtGte: args.lastUpdatedTs ?? undefined,
      pageSize: 250,
    });
  } catch {
    return syncRoomProjectionFromGoogleApi({
      roomId: args.roomId,
      calendarId: args.calendarId,
      syncedAt,
      updatedAtGte: args.lastUpdatedTs ?? undefined,
      syncMode: 'google_webhook_fallback',
    });
  }

  let upserted = 0;
  let deleted = 0;

  transaction(() => {
    for (const event of events) {
      const normalized = normalizeRecallCalendarEvent(event, args.calendarId);
      upsertCalendarEventProjection({
        externalEventId: normalized.externalEventId,
        calendarId: normalized.calendarId,
        roomId: args.roomId,
        startAt: normalized.startAt,
        endAt: normalized.endAt,
        summary: normalized.summary,
        organizer: normalized.organizer,
        updatedAt: normalized.updatedAt,
        source: 'recall',
        isDeleted: normalized.isDeleted,
        rawJson: normalized.rawJson,
        syncedAt,
      });
      upserted += 1;
      if (normalized.isDeleted) {
        deleted += 1;
      }
    }
  });

  updateRoomSyncState(args.roomId, {
    syncState: 'synced',
    lastSyncedAt: syncedAt,
    lastUpdatedTs: getLatestProjectionUpdatedAt(args.calendarId),
    lastSyncMode: 'recall_webhook',
    lastError: null,
  });

  return {
    calendarId: args.calendarId,
    roomId: args.roomId,
    fetched: events.length,
    upserted,
    deleted,
    lastUpdatedTs: getLatestProjectionUpdatedAt(args.calendarId),
    status: 'synced',
  };
}

export async function reconcileAllRooms(): Promise<CalendarSyncOutcome[]> {
  seedRoomCatalog();
  const rooms = listRoomCatalogEntries();
  const results: CalendarSyncOutcome[] = [];

  for (const room of rooms) {
    results.push(await bootstrapRoomProjection(room.id));
  }

  return results;
}

export async function reconcileRoomAvailability(roomId: string): Promise<CalendarSyncOutcome> {
  seedRoomCatalog();
  return bootstrapRoomProjection(roomId);
}

export function ensureRoomProjection(roomId: string): RoomCatalogEntry | undefined {
  seedRoomCatalog();
  return getRoomCatalogEntry(roomId);
}
