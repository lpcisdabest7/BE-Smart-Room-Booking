import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config';

let database: DatabaseSync | null = null;

function ensureDirectory(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function runMigrations(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ical_link TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      floor INTEGER NOT NULL,
      description TEXT NOT NULL,
      equipment TEXT NOT NULL,
      image TEXT NOT NULL,
      color TEXT NOT NULL,
      features TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      external_event_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      organizer TEXT,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      is_deleted INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      raw_payload TEXT,
      UNIQUE(external_event_id, calendar_id)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      user_name TEXT NOT NULL,
      room_id TEXT NOT NULL,
      room_name TEXT NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      status TEXT NOT NULL,
      calendar_event_id TEXT,
      calendar_link TEXT,
      sync_source TEXT,
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_deliveries (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      event_type TEXT NOT NULL,
      delivery_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_room_time
      ON calendar_events(room_id, start_at, end_at);

    CREATE INDEX IF NOT EXISTS idx_bookings_user_created
      ON bookings(user_email, created_at DESC);
  `);
}

export function getDb(): DatabaseSync {
  if (database) {
    return database;
  }

  ensureDirectory(config.dbPath);
  database = new DatabaseSync(config.dbPath);
  runMigrations(database);
  return database;
}
