import type { Room } from '../types';

export type BookingStatus = 'pending' | 'confirmed' | 'modified' | 'cancelled' | 'sync_error';

export type SyncSource = 'google_calendar' | 'recall' | 'ical_fallback' | 'system';

export type SyncState = 'idle' | 'pending' | 'synced' | 'stale' | 'error';

export interface RoomMetadata {
  roomId: string;
  floor: string;
  equipment: string[];
  description: string;
  image?: string | null;
  color?: string | null;
  features: string[];
  timezone?: string;
}

export interface RoomCatalogEntry extends Room {
  calendarId: string;
  floor: string;
  equipment: string[];
  description: string;
  image?: string | null;
  color?: string | null;
  features: string[];
  timezone: string;
  syncState: SyncState;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
  currentBookingId?: string | null;
  nextBookingId?: string | null;
}

export interface CalendarEventProjection {
  id?: number;
  externalEventId: string;
  calendarId: string;
  roomId: string;
  startAt: string;
  endAt: string;
  summary: string;
  organizer?: string | null;
  updatedAt: string;
  source: SyncSource;
  isDeleted: boolean;
  rawJson: string;
  syncedAt: string;
}

export interface BookingRecordV2 {
  id: string;
  userEmail: string;
  roomId: string;
  roomName: string;
  calendarId: string;
  externalEventId?: string | null;
  title: string;
  startAt: string;
  endAt: string;
  duration: number;
  status: BookingStatus;
  syncState: SyncState;
  calendarLink?: string | null;
  notes?: string | null;
  roomSnapshotJson: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string | null;
  cancelledAt?: string | null;
  source: SyncSource;
  rawCalendarJson?: string | null;
}

export interface SyncDeliveryRecord {
  id?: number;
  provider: 'recall';
  eventType: string;
  calendarId?: string | null;
  deliveryId?: string | null;
  webhookId?: string | null;
  payloadJson: string;
  receivedAt: string;
  processedAt?: string | null;
  status: 'received' | 'verified' | 'processed' | 'ignored' | 'error';
  error?: string | null;
}

export interface RoomStatusSnapshot {
  roomId: string;
  roomName: string;
  calendarId: string;
  syncState: SyncState;
  status: 'available' | 'busy' | 'reserved' | 'unknown' | 'syncing';
  currentBooking?: BookingRecordV2 | null;
  nextBooking?: BookingRecordV2 | null;
  lastSyncedAt?: string | null;
  source: SyncSource;
}

export interface RecallWebhookHeaders {
  'webhook-id'?: string;
  'webhook-timestamp'?: string;
  'webhook-signature'?: string;
  'svix-id'?: string;
  'svix-timestamp'?: string;
  'svix-signature'?: string;
}

export interface RecallCalendarSyncWebhook {
  event: string;
  data: {
    calendar_id: string;
    last_updated_ts?: string;
  };
}

export interface RecallCalendarEvent {
  id?: string;
  calendar_id?: string;
  summary?: string;
  updated_at?: string;
  is_deleted?: boolean;
  organizer?: string | { email?: string | null } | null;
  start?: string | { date_time?: string; dateTime?: string; date?: string };
  end?: string | { date_time?: string; dateTime?: string; date?: string };
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RecallCalendarEventsResponse {
  results?: RecallCalendarEvent[];
  next?: string | null;
  count?: number;
  [key: string]: unknown;
}

export interface RecallCalendarEventsQuery {
  calendarId: string;
  updatedAtGte?: string;
  pageSize?: number;
  nextUrl?: string;
}

export interface GoogleCalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  startAt: string | Date;
  endAt: string | Date;
  timeZone?: string;
  extendedProperties?: Record<string, Record<string, string>>;
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  transparency?: 'opaque' | 'transparent';
}

export interface GoogleCalendarEventRecord {
  id: string;
  calendarId: string;
  status?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  updated?: string;
  rawJson: string;
}

export interface GoogleCalendarServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
  subject?: string;
  tokenUri?: string;
  scopes?: string[];
}

export interface CalendarSyncOutcome {
  calendarId: string;
  roomId: string;
  fetched: number;
  upserted: number;
  deleted: number;
  lastUpdatedTs?: string | null;
  status: 'synced' | 'partial' | 'error';
  error?: string | null;
}

export interface BookingCreateInput {
  userEmail: string;
  userName?: string;
  roomId: string;
  title?: string;
  date?: string;
  startTime?: string;
  startAt?: string | Date;
  endAt?: string | Date;
  duration: number;
  notes?: string;
  source?: SyncSource;
}

export interface BookingCreateResult extends BookingRecordV2 {
  booking: BookingRecordV2;
  calendarEvent: GoogleCalendarEventRecord;
}

export interface RoomCatalogSeed {
  roomId: string;
  name: string;
  icalLink: string;
  capacity: number;
  metadata: RoomMetadata;
  calendarId: string;
}
