import { createSign } from 'crypto';
import { Room } from '../types';
import {
  GoogleCalendarEventInput,
  GoogleCalendarEventRecord,
  GoogleCalendarServiceAccountCredentials,
} from './sync.types';

const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar';

interface AccessTokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: AccessTokenCache | null = null;

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizePrivateKey(privateKey: string): string {
  return privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
}

function parseServiceAccountCredentials(): GoogleCalendarServiceAccountCredentials {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (json) {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const clientEmail = String(parsed.client_email || '');
    const privateKey = String(parsed.private_key || '');

    if (!clientEmail || !privateKey) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key');
    }

    return {
      clientEmail,
      privateKey: normalizePrivateKey(privateKey),
      subject: process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT || undefined,
      tokenUri: process.env.GOOGLE_SERVICE_ACCOUNT_TOKEN_URI || GOOGLE_TOKEN_URI,
      scopes: [GOOGLE_SCOPE],
    };
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';

  if (!clientEmail || !privateKey) {
    throw new Error(
      'Google service account credentials are missing. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.'
    );
  }

  return {
    clientEmail,
    privateKey: normalizePrivateKey(privateKey),
    subject: process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT || undefined,
    tokenUri: process.env.GOOGLE_SERVICE_ACCOUNT_TOKEN_URI || GOOGLE_TOKEN_URI,
    scopes: [GOOGLE_SCOPE],
  };
}

function buildJwtAssertion(credentials: GoogleCalendarServiceAccountCredentials): string {
  const tokenUri = credentials.tokenUri || GOOGLE_TOKEN_URI;
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: credentials.clientEmail,
    scope: (credentials.scopes || [GOOGLE_SCOPE]).join(' '),
    aud: tokenUri,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };

  if (credentials.subject) {
    payload.sub = credentials.subject;
  }

  const unsignedToken = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(credentials.privateKey));

  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

async function fetchAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.accessToken;
  }

  const credentials = parseServiceAccountCredentials();
  const assertion = buildJwtAssertion(credentials);
  const tokenUri = credentials.tokenUri || GOOGLE_TOKEN_URI;

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to exchange Google service account token: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error('Google token exchange returned no access_token');
  }

  tokenCache = {
    accessToken: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600) * 1000,
  };

  return tokenCache.accessToken;
}

function roomCalendarId(room: Pick<Room, 'icalLink'> & { calendarId?: string }): string {
  if (room.calendarId) {
    return room.calendarId;
  }

  const match = room.icalLink.match(/\/ical\/([^/]+)\/public\//i);
  return match?.[1] ? decodeURIComponent(match[1]) : room.icalLink;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function buildCalendarEventPayload(input: GoogleCalendarEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: {
      dateTime: toIso(input.startAt),
      timeZone: input.timeZone || 'Asia/Bangkok',
    },
    end: {
      dateTime: toIso(input.endAt),
      timeZone: input.timeZone || 'Asia/Bangkok',
    },
    visibility: input.visibility || 'private',
    transparency: input.transparency || 'opaque',
    extendedProperties: input.extendedProperties,
  };
}

async function requestCalendarApi<T>(
  method: string,
  calendarId: string,
  path: string,
  body?: unknown,
  query?: Record<string, string | boolean | number | undefined>
): Promise<T> {
  const accessToken = await fetchAccessToken();
  const url = new URL(`${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Google Calendar API ${method} ${path} failed: ${response.status} ${text}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

export function resolveCalendarIdForRoom(room: Pick<Room, 'icalLink'> & { calendarId?: string }): string {
  return roomCalendarId(room);
}

export function buildRoomBookingLink(room: Pick<Room, 'name'>, startAt: string | Date, endAt: string | Date, title: string): string {
  const formatDate = (value: string | Date): string =>
    toIso(value).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${formatDate(startAt)}/${formatDate(endAt)}`,
    location: `Phong ${room.name} - Apero`,
    details: 'Dat phong qua Smart Room Booking',
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export async function createRoomCalendarEvent(args: {
  calendarId: string;
  input: GoogleCalendarEventInput;
}): Promise<GoogleCalendarEventRecord> {
  const payload = buildCalendarEventPayload(args.input);
  const response = await requestCalendarApi<{
    id: string;
    htmlLink?: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    updated?: string;
  }>('POST', args.calendarId, '/events', payload);

  return {
    id: response.id,
    calendarId: args.calendarId,
    status: response.status,
    htmlLink: response.htmlLink,
    summary: response.summary,
    description: response.description,
    location: response.location,
    start: response.start,
    end: response.end,
    updated: response.updated,
    rawJson: JSON.stringify(response),
  };
}

export async function updateRoomCalendarEvent(args: {
  calendarId: string;
  eventId: string;
  input: Partial<GoogleCalendarEventInput>;
}): Promise<GoogleCalendarEventRecord> {
  const payload: Record<string, unknown> = {};

  if (args.input.summary !== undefined) payload.summary = args.input.summary;
  if (args.input.description !== undefined) payload.description = args.input.description;
  if (args.input.location !== undefined) payload.location = args.input.location;
  if (args.input.startAt !== undefined) {
    payload.start = {
      dateTime: toIso(args.input.startAt),
      timeZone: args.input.timeZone || 'Asia/Bangkok',
    };
  }
  if (args.input.endAt !== undefined) {
    payload.end = {
      dateTime: toIso(args.input.endAt),
      timeZone: args.input.timeZone || 'Asia/Bangkok',
    };
  }
  if (args.input.extendedProperties !== undefined) {
    payload.extendedProperties = args.input.extendedProperties;
  }
  if (args.input.visibility !== undefined) payload.visibility = args.input.visibility;
  if (args.input.transparency !== undefined) payload.transparency = args.input.transparency;

  const response = await requestCalendarApi<{
    id: string;
    htmlLink?: string;
    status?: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    updated?: string;
  }>('PATCH', args.calendarId, `/events/${encodeURIComponent(args.eventId)}`, payload);

  return {
    id: response.id,
    calendarId: args.calendarId,
    status: response.status,
    htmlLink: response.htmlLink,
    summary: response.summary,
    description: response.description,
    location: response.location,
    start: response.start,
    end: response.end,
    updated: response.updated,
    rawJson: JSON.stringify(response),
  };
}

export async function cancelRoomCalendarEvent(args: {
  calendarId: string;
  eventId: string;
}): Promise<void> {
  await requestCalendarApi<void>('DELETE', args.calendarId, `/events/${encodeURIComponent(args.eventId)}`);
}

export async function listRoomCalendarEvents(args: {
  calendarId: string;
  timeMin?: string;
  timeMax?: string;
  updatedMin?: string;
  singleEvents?: boolean;
  showDeleted?: boolean;
  maxResults?: number;
  pageToken?: string;
}): Promise<{
  items: Array<{
    id?: string;
    status?: string;
    summary?: string;
    updated?: string;
    organizer?: { email?: string };
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    extendedProperties?: Record<string, Record<string, string>>;
  }>;
  nextPageToken?: string;
}> {
  return requestCalendarApi('GET', args.calendarId, '/events', undefined, {
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    updatedMin: args.updatedMin,
    singleEvents: args.singleEvents ?? true,
    showDeleted: args.showDeleted ?? true,
    maxResults: args.maxResults ?? 250,
    pageToken: args.pageToken,
  });
}

export async function getRoomCalendarEvent(args: {
  calendarId: string;
  eventId: string;
}): Promise<GoogleCalendarEventRecord | null> {
  try {
    const response = await requestCalendarApi<{
      id: string;
      htmlLink?: string;
      status?: string;
      summary?: string;
      description?: string;
      location?: string;
      start?: { dateTime?: string; date?: string; timeZone?: string };
      end?: { dateTime?: string; date?: string; timeZone?: string };
      updated?: string;
    }>('GET', args.calendarId, `/events/${encodeURIComponent(args.eventId)}`, undefined, {
      showDeleted: true,
    });

    return {
      id: response.id,
      calendarId: args.calendarId,
      status: response.status,
      htmlLink: response.htmlLink,
      summary: response.summary,
      description: response.description,
      location: response.location,
      start: response.start,
      end: response.end,
      updated: response.updated,
      rawJson: JSON.stringify(response),
    };
  } catch (error) {
    const status = (error as { status?: number } | undefined)?.status;
    if (status === 404) {
      return null;
    }
    throw error;
  }
}

export async function createManagedCalendarEvent(args: {
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  startAt: string | Date;
  endAt: string | Date;
  attendees?: Array<{ email: string; displayName?: string }>;
  timeZone?: string;
}): Promise<GoogleCalendarEventRecord & { eventId: string; updatedAt: string }> {
  const record = await createRoomCalendarEvent({
    calendarId: args.calendarId,
    input: {
      summary: args.summary,
      description: args.description,
      location: args.location,
      startAt: args.startAt,
      endAt: args.endAt,
      timeZone: args.timeZone,
      extendedProperties: args.attendees
        ? {
            private: {
              attendees: JSON.stringify(args.attendees),
            },
          }
        : undefined,
    },
  });

  return {
    ...record,
    eventId: record.id,
    updatedAt: record.updated || new Date().toISOString(),
  };
}

export const updateManagedCalendarEvent = updateRoomCalendarEvent;
export const cancelManagedCalendarEvent = cancelRoomCalendarEvent;
export const buildGoogleCalendarLink = buildRoomBookingLink;
