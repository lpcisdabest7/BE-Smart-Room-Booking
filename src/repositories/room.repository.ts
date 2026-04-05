import { getDb } from '../db/database';
import { RoomRecord } from '../types';

type RoomRow = {
  id: string;
  name: string;
  ical_link: string;
  calendar_id: string;
  capacity: number;
  floor: number;
  description: string;
  equipment: string;
  image: string;
  color: string;
  features: string;
};

function mapRow(row: RoomRow): RoomRecord {
  return {
    id: row.id,
    name: row.name,
    icalLink: row.ical_link,
    calendarId: row.calendar_id,
    capacity: row.capacity,
    floor: row.floor,
    description: row.description,
    equipment: JSON.parse(row.equipment) as string[],
    image: row.image,
    color: row.color,
    features: JSON.parse(row.features) as string[],
  };
}

export function seedRooms(rooms: RoomRecord[]) {
  const db = getDb();
  const statement = db.prepare(`
    INSERT INTO rooms (
      id, name, ical_link, calendar_id, capacity, floor, description, equipment, image, color, features
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      ical_link = excluded.ical_link,
      calendar_id = excluded.calendar_id,
      capacity = excluded.capacity,
      floor = excluded.floor,
      description = excluded.description,
      equipment = excluded.equipment,
      image = excluded.image,
      color = excluded.color,
      features = excluded.features
  `);

  for (const room of rooms) {
    statement.run(
      room.id,
      room.name,
      room.icalLink,
      room.calendarId,
      room.capacity,
      room.floor,
      room.description,
      JSON.stringify(room.equipment),
      room.image ?? null,
      room.color ?? null,
      JSON.stringify(room.features)
    );
  }
}

export function listRooms(): RoomRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM rooms ORDER BY capacity ASC, name ASC')
    .all() as RoomRow[];
  return rows.map(mapRow);
}

export function getRoomById(roomId: string): RoomRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM rooms WHERE id = ?')
    .get(roomId) as RoomRow | undefined;
  return row ? mapRow(row) : null;
}

export function getRoomByName(roomName: string): RoomRecord | null {
  const row = getDb()
    .prepare('SELECT * FROM rooms WHERE lower(name) = lower(?)')
    .get(roomName) as RoomRow | undefined;
  return row ? mapRow(row) : null;
}
