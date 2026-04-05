import crypto from 'crypto';
import { Buffer } from 'buffer';
import {
  RecallCalendarEvent,
  RecallCalendarEventsQuery,
  RecallCalendarEventsResponse,
  RecallCalendarSyncWebhook,
  RecallWebhookHeaders,
} from './sync.types';

const DEFAULT_RECALL_BASE_URL =
  process.env.RECALL_API_BASE_URL ||
  process.env.RECALL_BASE_URL ||
  'https://us-east-1.recall.ai/api/v2';

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function normalizeWebhookSecret(secret: string): Buffer {
  const clean = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  return Buffer.from(clean, 'base64');
}

function buildRecallApiUrl(baseUrl: string, pathName: string): URL {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(pathName, normalizedBase);
}

export function verifyRecallRequest(args: {
  secret: string;
  headers: Record<string, string> | RecallWebhookHeaders;
  payload: string | null;
}): void {
  const headers = normalizeHeaders(args.headers as Record<string, string>);
  const msgId = headers['webhook-id'] ?? headers['svix-id'];
  const msgTimestamp = headers['webhook-timestamp'] ?? headers['svix-timestamp'];
  const msgSignature = headers['webhook-signature'] ?? headers['svix-signature'];

  if (!args.secret || !args.secret.startsWith('whsec_')) {
    throw new Error('Verification secret is missing or invalid');
  }

  if (!msgId || !msgTimestamp || !msgSignature) {
    throw new Error('Missing webhook ID, timestamp, or signature');
  }

  const key = normalizeWebhookSecret(args.secret);
  const payloadStr = args.payload ?? '';
  const toSign = `${msgId}.${msgTimestamp}.${payloadStr}`;
  const expectedSig = crypto.createHmac('sha256', key).update(toSign).digest('base64');
  const expectedSigBytes = Buffer.from(expectedSig, 'base64');

  for (const versionedSig of msgSignature.split(' ')) {
    const [version, signature] = versionedSig.split(',');
    if (version !== 'v1' || !signature) {
      continue;
    }

    const sigBytes = Buffer.from(signature, 'base64');
    if (
      expectedSigBytes.length === sigBytes.length &&
      crypto.timingSafeEqual(expectedSigBytes, sigBytes)
    ) {
      return;
    }
  }

  throw new Error('No matching Recall signature found');
}

function extractCalendarId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const direct = record.calendar_id ?? record.calendarId ?? record.calendar ?? record.id;
  if (typeof direct === 'string' && direct) {
    return direct;
  }

  if (record.calendar && typeof record.calendar === 'object') {
    return extractCalendarId(record.calendar);
  }

  return undefined;
}

function extractLastUpdatedTs(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const direct = record.last_updated_ts ?? record.lastUpdatedTs ?? record.lastUpdatedAt;
  if (typeof direct === 'string' && direct) {
    return direct;
  }

  if (record.data && typeof record.data === 'object') {
    return extractLastUpdatedTs(record.data);
  }

  return undefined;
}

export function parseRecallCalendarSyncWebhook(payload: unknown): RecallCalendarSyncWebhook {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Recall webhook payload is not an object');
  }

  const record = payload as Record<string, unknown>;
  const event = record.event;
  const eventName = typeof event === 'string' ? event : '';

  if (!eventName || !eventName.startsWith('calendar.')) {
    throw new Error(`Unsupported Recall webhook event: ${eventName || 'unknown'}`);
  }

  const calendarId = extractCalendarId(record.data ?? record) ?? extractCalendarId(record) ?? '';
  const lastUpdatedTs = extractLastUpdatedTs(record.data ?? record) ?? extractLastUpdatedTs(record) ?? undefined;

  if (!calendarId) {
    throw new Error('Recall webhook payload is missing calendar_id');
  }

  return {
    event: eventName as RecallCalendarSyncWebhook['event'],
    data: {
      calendar_id: calendarId,
      last_updated_ts: lastUpdatedTs,
    },
  };
}

export function verifyRecallWebhook(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = process.env.RECALL_WEBHOOK_SECRET || '';
  if (!secret) {
    return true;
  }

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = (signatureHeader || '').trim();
  return received.length > 0 && received === expected;
}

export async function listRecallCalendarEvents(args: RecallCalendarEventsQuery): Promise<RecallCalendarEventsResponse> {
  const apiKey = process.env.RECALL_API_KEY || '';
  if (!apiKey) {
    throw new Error('RECALL_API_KEY is not configured');
  }

  const authScheme = process.env.RECALL_AUTH_SCHEME || 'Bearer';
  const baseUrl =
    process.env.RECALL_API_BASE_URL ||
    process.env.RECALL_BASE_URL ||
    DEFAULT_RECALL_BASE_URL;
  const url = args.nextUrl
    ? new URL(args.nextUrl)
    : buildRecallApiUrl(baseUrl, 'calendar-events/');

  if (!args.nextUrl) {
    url.searchParams.set('calendar_id', args.calendarId);
    if (args.updatedAtGte) {
      url.searchParams.set('updated_at__gte', args.updatedAtGte);
    }
    if (args.pageSize) {
      url.searchParams.set('page_size', String(args.pageSize));
    }
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `${authScheme} ${apiKey}`.trim(),
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Recall calendar-events list failed: ${response.status} ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const text = await response.text();
    throw new Error(`Recall calendar-events list returned non-JSON payload: ${text.slice(0, 200)}`);
  }

  return (await response.json()) as RecallCalendarEventsResponse;
}

export async function fetchRecallCalendarEventsSince(args: {
  calendarId: string;
  updatedAtGte?: string;
  pageSize?: number;
}): Promise<RecallCalendarEvent[]> {
  const events: RecallCalendarEvent[] = [];
  let nextUrl: string | undefined;
  let page: RecallCalendarEventsResponse | undefined;

  do {
    page = await listRecallCalendarEvents({
      calendarId: args.calendarId,
      updatedAtGte: args.updatedAtGte,
      pageSize: args.pageSize,
      nextUrl,
    });

    if (Array.isArray(page.results)) {
      events.push(...page.results);
    }

    nextUrl = page.next || undefined;
  } while (nextUrl);

  return events;
}

export async function processRecallWebhook(payload: unknown, rawBody: string) {
  const parsed = parseRecallCalendarSyncWebhook(payload);
  const calendarId = parsed.data.calendar_id;
  const result = await fetchRecallCalendarEventsSince({
    calendarId,
    updatedAtGte: parsed.data.last_updated_ts,
    pageSize: 250,
  });

  return {
    event: parsed.event,
    calendarId,
    lastUpdatedTs: parsed.data.last_updated_ts ?? null,
    rawBody,
    duplicate: false,
    events: result,
  };
}

export function normalizeRecallCalendarEvent(
  event: RecallCalendarEvent,
  fallbackCalendarId: string
): {
  externalEventId: string;
  calendarId: string;
  summary: string;
  startAt: string;
  endAt: string;
  updatedAt: string;
  organizer: string | null;
  isDeleted: boolean;
  rawJson: string;
} {
  const eventId = typeof event.id === 'string' && event.id ? event.id : crypto.randomUUID();
  const calendarId = typeof event.calendar_id === 'string' && event.calendar_id ? event.calendar_id : fallbackCalendarId;
  const startValue = event.start;
  const endValue = event.end;

  const toIso = (value: unknown): string => {
    if (typeof value === 'string') {
      return new Date(value).toISOString();
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const nested = record.date_time ?? record.dateTime ?? record.date;
      if (typeof nested === 'string') {
        return new Date(nested).toISOString();
      }
    }

    return new Date().toISOString();
  };

  const organizer =
    typeof event.organizer === 'string'
      ? event.organizer
      : event.organizer && typeof event.organizer === 'object'
        ? (event.organizer as { email?: string | null }).email ?? null
        : null;

  return {
    externalEventId: eventId,
    calendarId,
    summary: typeof event.summary === 'string' ? event.summary : 'Untitled',
    startAt: toIso(startValue),
    endAt: toIso(endValue),
    updatedAt:
      typeof event.updated_at === 'string'
        ? new Date(event.updated_at).toISOString()
        : new Date().toISOString(),
    organizer,
    isDeleted: Boolean(event.is_deleted),
    rawJson: JSON.stringify(event),
  };
}
