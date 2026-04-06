import { readFileSync } from 'fs';
import path from 'path';
import { config } from '../config';
import { Room } from '../types';
import { all, get, nowIso, run, transaction } from './database.service';
import type { RoomCatalogEntry, RoomCatalogSeed, RoomMetadata } from './sync.types';

interface RoomMetadataFileEntry extends RoomMetadata {
  roomId: string;
}

const METADATA_FILE = process.env.ROOM_METADATA_PATH || path.resolve(__dirname, '../../data/rooms.metadata.json');

function readMetadataFile(): RoomMetadataFileEntry[] {
  try {
    const raw = readFileSync(METADATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.filter(
        (entry): entry is RoomMetadataFileEntry =>
          typeof entry === 'object' && entry !== null && typeof entry.roomId === 'string'
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      return [];
    }

    return Object.entries(parsed).flatMap(([roomId, metadata]) => {
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return [];
      }

      return [{ roomId, ...(metadata as Omit<RoomMetadataFileEntry, 'roomId'>) }];
    });
  } catch {
    return [];
  }
}

function normalizeMetadata(roomId: string, roomName: string, metadata?: Partial<RoomMetadata>): RoomMetadata {
  const fallback: RoomMetadata = {
    roomId,
    floor: 'Chưa rõ',
    equipment: [],
    description: `${roomName} - phòng họp Apero`,
    image: null,
    color: '#0f172a',
    features: [],
    timezone: 'Asia/Bangkok',
  };

  return {
    ...fallback,
    ...metadata,
    roomId,
    equipment: metadata?.equipment ?? fallback.equipment,
    features: metadata?.features ?? fallback.features,
    image: metadata?.image ?? fallback.image,
    color: metadata?.color ?? fallback.color,
    timezone: metadata?.timezone ?? fallback.timezone,
    description: metadata?.description ?? fallback.description,
  };
}

function deriveCalendarIdFromIcalLink(icalLink: string): string {
  const match = icalLink.match(/\/ical\/([^/]+)\/public\//i);
  if (match?.[1]) {
    return decodeURIComponent(match[1]);
  }

  return icalLink;
}

function serializeList(value: string[]): string {
  return JSON.stringify(value);
}

function deserializeList(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function loadSeedRows(): RoomCatalogSeed[] {
  const metadataByRoomId = new Map(readMetadataFile().map((entry) => [entry.roomId, entry]));

  return config.rooms.map((room: Room) => {
    const metadata = normalizeMetadata(room.id, room.name, metadataByRoomId.get(room.id));
    const calendarId = room.calendarId || deriveCalendarIdFromIcalLink(room.icalLink);

    return {
      roomId: room.id,
      name: room.name,
      icalLink: room.icalLink,
      capacity: room.capacity,
      metadata,
      calendarId,
    };
  });
}

export function seedRoomCatalog(): RoomCatalogEntry[] {
  const seededAt = nowIso();
  const rows = loadSeedRows();

  transaction(() => {
    for (const row of rows) {
      run(
        `
          INSERT INTO rooms (
            id, name, icalLink, calendarId, capacity, floor, equipmentJson,
            description, image, color, featuresJson, timezone, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            icalLink = excluded.icalLink,
            calendarId = excluded.calendarId,
            capacity = excluded.capacity,
            floor = excluded.floor,
            equipmentJson = excluded.equipmentJson,
            description = excluded.description,
            image = excluded.image,
            color = excluded.color,
            featuresJson = excluded.featuresJson,
            timezone = excluded.timezone,
            updatedAt = excluded.updatedAt
        `,
        [
          row.roomId,
          row.name,
          row.icalLink,
          row.calendarId,
          row.capacity,
          row.metadata.floor,
          serializeList(row.metadata.equipment),
          row.metadata.description,
          row.metadata.image ?? null,
          row.metadata.color ?? null,
          serializeList(row.metadata.features),
          row.metadata.timezone ?? 'Asia/Bangkok',
          seededAt,
          seededAt,
        ]
      );

      run(
        `
          INSERT INTO room_sync_state (
            roomId, calendarId, syncState, lastSyncedAt, lastUpdatedTs,
            lastSyncMode, lastError, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(roomId) DO UPDATE SET
            calendarId = excluded.calendarId,
            updatedAt = excluded.updatedAt
        `,
        [
          row.roomId,
          row.calendarId,
          'idle',
          null,
          null,
          'bootstrap',
          null,
          seededAt,
          seededAt,
        ]
      );
    }
  });

  return rows.map((row) => ({
    id: row.roomId,
    name: row.name,
    icalLink: row.icalLink,
    capacity: row.capacity,
    calendarId: row.calendarId,
    floor: row.metadata.floor,
    equipment: row.metadata.equipment,
    description: row.metadata.description,
    image: row.metadata.image ?? null,
    color: row.metadata.color ?? null,
    features: row.metadata.features,
    timezone: row.metadata.timezone ?? 'Asia/Bangkok',
    syncState: 'idle',
    lastSyncedAt: seededAt,
    lastSyncError: null,
    currentBookingId: null,
    nextBookingId: null,
  }));
}

export function getRoomCatalogEntry(roomId: string): RoomCatalogEntry | undefined {
  const room = get<{
    id: string;
    name: string;
    icalLink: string;
    calendarId: string;
    capacity: number;
    floor: string;
    equipmentJson: string;
    description: string;
    image: string | null;
    color: string | null;
    featuresJson: string;
    timezone: string;
  }>('SELECT * FROM rooms WHERE id = ?', [roomId]);

  if (!room) {
    return undefined;
  }

  const syncState = get<{
    syncState: RoomCatalogEntry['syncState'];
    lastSyncedAt: string | null;
    lastError: string | null;
  }>('SELECT syncState, lastSyncedAt, lastError FROM room_sync_state WHERE roomId = ?', [roomId]);

  return {
    id: room.id,
    name: room.name,
    icalLink: room.icalLink,
    calendarId: room.calendarId,
    capacity: room.capacity,
    floor: room.floor,
    equipment: deserializeList(room.equipmentJson),
    description: room.description,
    image: room.image,
    color: room.color,
    features: deserializeList(room.featuresJson),
    timezone: room.timezone,
    syncState: syncState?.syncState ?? 'idle',
    lastSyncedAt: syncState?.lastSyncedAt ?? null,
    lastSyncError: syncState?.lastError ?? null,
    currentBookingId: null,
    nextBookingId: null,
  };
}

export function listRoomCatalogEntries(): RoomCatalogEntry[] {
  const rooms = all<{
    id: string;
    name: string;
    icalLink: string;
    calendarId: string;
    capacity: number;
    floor: string;
    equipmentJson: string;
    description: string;
    image: string | null;
    color: string | null;
    featuresJson: string;
    timezone: string;
  }>('SELECT * FROM rooms ORDER BY capacity ASC, name ASC');

  const syncRows = all<{
    roomId: string;
    syncState: RoomCatalogEntry['syncState'];
    lastSyncedAt: string | null;
    lastError: string | null;
  }>('SELECT roomId, syncState, lastSyncedAt, lastError FROM room_sync_state');

  const syncMap = new Map(syncRows.map((row) => [row.roomId, row]));

  return rooms.map((room) => {
    const syncState = syncMap.get(room.id);

    return {
      id: room.id,
      name: room.name,
      icalLink: room.icalLink,
      calendarId: room.calendarId,
      capacity: room.capacity,
      floor: room.floor,
      equipment: deserializeList(room.equipmentJson),
      description: room.description,
      image: room.image,
      color: room.color,
      features: deserializeList(room.featuresJson),
      timezone: room.timezone,
      syncState: syncState?.syncState ?? 'idle',
      lastSyncedAt: syncState?.lastSyncedAt ?? null,
      lastSyncError: syncState?.lastError ?? null,
      currentBookingId: null,
      nextBookingId: null,
    };
  });
}

export function updateRoomSyncState(
  roomId: string,
  patch: Partial<{
    syncState: RoomCatalogEntry['syncState'];
    lastSyncedAt: string | null;
    lastUpdatedTs: string | null;
    lastSyncMode: string;
    lastError: string | null;
  }>
): void {
  const current = get<{ roomId: string }>('SELECT roomId FROM room_sync_state WHERE roomId = ?', [roomId]);
  if (!current) {
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (patch.syncState !== undefined) {
    updates.push('syncState = ?');
    params.push(patch.syncState);
  }
  if (patch.lastSyncedAt !== undefined) {
    updates.push('lastSyncedAt = ?');
    params.push(patch.lastSyncedAt);
  }
  if (patch.lastUpdatedTs !== undefined) {
    updates.push('lastUpdatedTs = ?');
    params.push(patch.lastUpdatedTs);
  }
  if (patch.lastSyncMode !== undefined) {
    updates.push('lastSyncMode = ?');
    params.push(patch.lastSyncMode);
  }
  if (patch.lastError !== undefined) {
    updates.push('lastError = ?');
    params.push(patch.lastError);
  }

  if (updates.length === 0) {
    return;
  }

  updates.push('updatedAt = ?');
  params.push(nowIso());
  params.push(roomId);

  run(`UPDATE room_sync_state SET ${updates.join(', ')} WHERE roomId = ?`, params);
}
