import dotenv from 'dotenv';
import path from 'path';
import roomMetadata from '../data/rooms.metadata.json';
import { RoomConfig, RoomMetadata, RoomRecord } from '../types';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getMetadata(roomId: string, roomName: string, capacity: number): RoomMetadata {
  const metadataMap = roomMetadata as Record<string, Partial<RoomMetadata>>;
  const found = metadataMap[roomId] ?? metadataMap[roomName.toLowerCase()];

  return {
    floor: found?.floor ?? 1,
    description: found?.description ?? `${roomName} là phòng họp cho tối đa ${capacity} người tại Apero.`,
    equipment: found?.equipment ?? ['display', 'whiteboard'],
    image: found?.image ?? '',
    color: found?.color ?? '#1D4ED8',
    features: found?.features ?? ['Focus room'],
  };
}

function loadRooms(): RoomRecord[] {
  const rooms: RoomRecord[] = [];
  let i = 1;

  while (process.env[`ROOM_${i}_LINK`]) {
    const id = `room-${i}`;
    const name = process.env[`ROOM_${i}_NAME`] ?? `Room ${i}`;
    const capacity = parseNumber(process.env[`ROOM_${i}_MAX`], 4);
    const base: RoomConfig = {
      id,
      name,
      icalLink: process.env[`ROOM_${i}_LINK`]!,
      calendarId: process.env[`ROOM_${i}_CALENDAR_ID`] ?? process.env[`ROOM_${i}_LINK`]!,
      capacity,
    };

    rooms.push({
      ...base,
      ...getMetadata(id, name, capacity),
    });
    i += 1;
  }

  return rooms;
}

const googlePrivateKey = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const frontendOrigins = Array.from(new Set([frontendUrl, ...parseCsv(process.env.FRONTEND_ORIGINS)]));

export const config = {
  port: parseNumber(process.env.PORT, 3001),
  frontendUrl,
  frontendOrigins,
  jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  aiModel: process.env.AI_MODEL || 'gpt-4o-mini',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../../data/app.db'),
  timezone: process.env.APP_TIMEZONE || 'Asia/Bangkok',
  reconcileIntervalMs: parseNumber(process.env.RECONCILE_INTERVAL_MS, 5 * 60 * 1000),
  recall: {
    apiKey: process.env.RECALL_API_KEY || '',
    webhookSecret: process.env.RECALL_WEBHOOK_SECRET || '',
    baseUrl: process.env.RECALL_BASE_URL || 'https://us-east-1.recall.ai/api/v1',
  },
  google: {
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: googlePrivateKey,
    delegatedUser: process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT || '',
  },
  rooms: loadRooms(),
};
