import { mkdirSync } from 'fs';
import path from 'path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const DEFAULT_DB_PATH = process.env.SMART_ROOM_DB_PATH || path.resolve(process.cwd(), 'data', 'smart-room-booking.sqlite');

let db: DatabaseSync | null = null;

function ensureParentDirectory(filePath: string): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
}

function initializeSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icalLink TEXT NOT NULL,
      calendarId TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      floor TEXT NOT NULL,
      equipmentJson TEXT NOT NULL,
      description TEXT NOT NULL,
      image TEXT,
      color TEXT,
      featuresJson TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Bangkok',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_sync_state (
      roomId TEXT PRIMARY KEY,
      calendarId TEXT NOT NULL,
      syncState TEXT NOT NULL DEFAULT 'idle',
      lastSyncedAt TEXT,
      lastUpdatedTs TEXT,
      lastSyncMode TEXT NOT NULL DEFAULT 'bootstrap',
      lastError TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (roomId) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      externalEventId TEXT NOT NULL,
      calendarId TEXT NOT NULL,
      roomId TEXT NOT NULL,
      startAt TEXT NOT NULL,
      endAt TEXT NOT NULL,
      summary TEXT NOT NULL,
      organizer TEXT,
      updatedAt TEXT NOT NULL,
      source TEXT NOT NULL,
      isDeleted INTEGER NOT NULL DEFAULT 0,
      rawJson TEXT NOT NULL,
      syncedAt TEXT NOT NULL,
      UNIQUE(externalEventId, calendarId)
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_room_time
      ON calendar_events(roomId, startAt, endAt);

    CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar_updated
      ON calendar_events(calendarId, updatedAt);

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      userEmail TEXT NOT NULL,
      roomId TEXT NOT NULL,
      roomName TEXT NOT NULL,
      calendarId TEXT NOT NULL,
      externalEventId TEXT,
      title TEXT NOT NULL,
      startAt TEXT NOT NULL,
      endAt TEXT NOT NULL,
      duration INTEGER NOT NULL,
      status TEXT NOT NULL,
      syncState TEXT NOT NULL,
      calendarLink TEXT,
      notes TEXT,
      roomSnapshotJson TEXT NOT NULL,
      source TEXT NOT NULL,
      rawCalendarJson TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      confirmedAt TEXT,
      cancelledAt TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_user_created
      ON bookings(userEmail, createdAt DESC);

    CREATE INDEX IF NOT EXISTS idx_bookings_room_time
      ON bookings(roomId, startAt, endAt);

    CREATE TABLE IF NOT EXISTS sync_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      eventType TEXT NOT NULL,
      calendarId TEXT,
      deliveryId TEXT,
      webhookId TEXT,
      payloadJson TEXT NOT NULL,
      receivedAt TEXT NOT NULL,
      processedAt TEXT,
      status TEXT NOT NULL,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_deliveries_webhook
      ON sync_deliveries(provider, webhookId, receivedAt DESC);
  `);
}

export function getDatabase(): DatabaseSync {
  if (!db) {
    ensureParentDirectory(DEFAULT_DB_PATH);
    db = new DatabaseSync(DEFAULT_DB_PATH);
    initializeSchema(db);
  }

  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function run(sql: string, params: unknown[] = []): DatabaseSync {
  const database = getDatabase();
  const statement = database.prepare(sql);
  statement.run(...(params as SQLInputValue[]));
  return database;
}

export function all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const database = getDatabase();
  return database.prepare(sql).all(...(params as SQLInputValue[])) as T[];
}

export function get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | undefined {
  const database = getDatabase();
  return database.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined;
}

export function transaction<T>(work: () => T): T {
  const database = getDatabase();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
