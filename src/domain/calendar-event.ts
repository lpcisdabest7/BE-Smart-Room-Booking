export type CalendarEventSource =
  | 'google_calendar'
  | 'recall_ai'
  | 'ical_backfill'
  | 'manual';

export type CalendarEventStatus = 'confirmed' | 'tentative' | 'cancelled';

export interface CalendarEventProjection {
  externalEventId: string;
  calendarId: string;
  roomId: string;
  startAt: string;
  endAt: string;
  summary: string;
  organizer: string | null;
  updatedAt: string;
  source: CalendarEventSource;
  status: CalendarEventStatus;
  payload: Record<string, unknown>;
  createdAt: string;
  syncedAt: string;
}

export interface CalendarConflict {
  externalEventId: string;
  roomId: string;
  calendarId: string;
  startAt: string;
  endAt: string;
  summary: string;
  organizer: string | null;
  source: CalendarEventSource;
  status: CalendarEventStatus;
}

export interface CalendarSyncSnapshot {
  roomId: string;
  calendarId: string;
  lastSyncedAt: string | null;
  projectionCount: number;
  stale: boolean;
}

export function isCalendarEventActive(status: CalendarEventStatus): boolean {
  return status !== 'cancelled';
}
