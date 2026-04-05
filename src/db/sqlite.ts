import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { INDEX_SQL, SCHEMA_SQL } from './schema';

let database: DatabaseSync | null = null;
let initialized = false;

export function resolveDatabasePath(): string {
  return process.env.SQLITE_DB_PATH
    ? path.resolve(process.cwd(), process.env.SQLITE_DB_PATH)
    : path.resolve(process.cwd(), 'data', 'smart-room-booking.sqlite');
}

export function openDatabase(): DatabaseSync {
  if (database) {
    return database;
  }

  const dbPath = resolveDatabasePath();
  mkdirSync(path.dirname(dbPath), { recursive: true });

  database = new DatabaseSync(dbPath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
  `);

  return database;
}

export function initializeSchema(): DatabaseSync {
  const db = openDatabase();

  if (!initialized) {
    db.exec(SCHEMA_SQL);
    db.exec(INDEX_SQL);
    initialized = true;
  }

  return db;
}

export function getDatabase(): DatabaseSync {
  return initializeSchema();
}

export function withTransaction<T>(work: (db: DatabaseSync) => T): T {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE TRANSACTION');

  try {
    const result = work(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function resetDatabase(): void {
  if (database) {
    database.close();
    database = null;
    initialized = false;
  }
}
