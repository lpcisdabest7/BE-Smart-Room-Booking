export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  calendar_id TEXT NOT NULL UNIQUE,
  ical_link TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  floor INTEGER NOT NULL DEFAULT 0,
  equipment_json TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  image TEXT,
  color TEXT NOT NULL DEFAULT '#1d4ed8',
  features_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  external_event_id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  organizer TEXT,
  updated_at TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_name TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  external_event_id TEXT,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  sync_state TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  confirmed_at TEXT,
  cancelled_at TEXT,
  room_snapshot_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sync_deliveries (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  delivery_key TEXT NOT NULL,
  room_id TEXT,
  external_event_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  received_at TEXT NOT NULL,
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  UNIQUE(provider, delivery_key)
);
`;

export const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(active);
CREATE INDEX IF NOT EXISTS idx_calendar_events_room_start ON calendar_events(room_id, start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar_updated ON calendar_events(calendar_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_bookings_user_start ON bookings(user_email, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_room_start ON bookings(room_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_external_event ON bookings(external_event_id);
CREATE INDEX IF NOT EXISTS idx_sync_deliveries_provider_key ON sync_deliveries(provider, delivery_key);
`;
