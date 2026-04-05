export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'modified'
  | 'cancelled'
  | 'sync_error';

export type SyncSource = 'google_calendar' | 'recall' | 'ical';

export interface RoomConfig {
  id: string;
  name: string;
  icalLink: string;
  calendarId: string;
  capacity: number;
}

export interface Room {
  id: string;
  name: string;
  icalLink: string;
  calendarId: string;
  capacity: number;
  floor?: number | string;
  description?: string;
  equipment?: string[];
  image?: string | null;
  color?: string | null;
  features?: string[];
}

export interface RoomMetadata {
  floor: number | string;
  description: string;
  equipment: string[];
  image?: string | null;
  color?: string | null;
  features: string[];
}

export interface RoomRecord extends RoomConfig, RoomMetadata {}

export interface RoomPublic {
  id: string;
  name: string;
  capacity: number;
  floor?: number | string;
  description?: string;
  equipment?: string[];
  image?: string | null;
  color?: string | null;
  features?: string[];
}

export interface CalendarEvent {
  summary: string;
  start: Date;
  end: Date;
}

export interface CalendarEventProjection {
  id: string;
  externalEventId: string;
  calendarId: string;
  roomId: string;
  summary: string;
  organizer: string | null;
  startAt: string;
  endAt: string;
  updatedAt: string;
  isDeleted: boolean;
  source: SyncSource;
  rawPayload: string | null;
}

export interface RoomAvailability {
  room: Room;
  available: boolean;
  conflictingEvents: CalendarEvent[];
  source?: 'projection' | 'ical';
}

export interface AlternativeSlot {
  startTime: Date;
  endTime: Date;
  availableRooms: RoomPublic[];
}

export interface AISearchParams {
  numberOfPeople: number;
  date: string;
  startTime: string;
  duration: number;
}

export interface AISearchAction {
  action: 'search';
  params: AISearchParams;
}

export interface AIClarifyAction {
  action: 'clarify';
  message: string;
}

export interface AIInfoAction {
  action: 'info';
  message: string;
}

export interface AIListRoomsAction {
  action: 'list_rooms';
  message: string;
}

export interface AIBookAction {
  action: 'book';
  params: {
    roomName?: string;
    numberOfPeople: number;
    date: string;
    startTime: string;
    duration: number;
  };
}

export interface AICheckBookingAction {
  action: 'check_booking';
  message: string;
}

export interface AICheckRoomScheduleAction {
  action: 'check_room_schedule';
  params: {
    roomName?: string;
    month?: number;
    year?: number;
  };
  message?: string;
}

export type AIResponse =
  | AISearchAction
  | AIClarifyAction
  | AIInfoAction
  | AIListRoomsAction
  | AIBookAction
  | AICheckBookingAction
  | AICheckRoomScheduleAction;

export interface BookingRecord {
  id?: string;
  userEmail: string;
  userName?: string;
  roomId: string;
  roomName: string;
  title?: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  status?: BookingStatus;
  calendarEventId?: string | null;
  calendarLink?: string | null;
  syncSource?: SyncSource | null;
  lastSyncedAt?: string | null;
  bookedAt?: Date;
  createdAt?: string;
  updatedAt?: string;
}

export interface BookingWithRoom extends BookingRecord {
  room: RoomPublic;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface BookingRequest {
  roomId: string;
  date: string;
  startTime: string;
  duration: number;
  title?: string;
}

export interface CreateBookingInput extends BookingRequest {
  userEmail: string;
  userName: string;
}

export interface JwtPayload {
  email: string;
  name: string;
  iat?: number;
  exp?: number;
}

export interface RoomStatusSummary {
  state: 'available' | 'occupied' | 'upcoming';
  source: 'projection' | 'ical';
  currentEvent: {
    summary: string;
    startAt: string;
    endAt: string;
  } | null;
  nextEvent: {
    summary: string;
    startAt: string;
    endAt: string;
  } | null;
}

export interface RoomListItem extends RoomPublic {
  status: RoomStatusSummary;
}

export interface RoomDetail extends RoomPublic {
  status: RoomStatusSummary;
  upcomingBookings: Array<{
    id: string;
    title: string;
    startAt: string;
    endAt: string;
    status: BookingStatus;
  }>;
}

export interface SyncStatusSummary {
  lastWebhookAt: string | null;
  lastReconcileAt: string | null;
  pendingDeliveries: number;
  failedDeliveries: number;
  source: 'recall_hybrid';
}

export interface RecallWebhookPayload {
  event: string;
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  calendar?: Record<string, unknown>;
  last_updated_ts?: string;
  [key: string]: unknown;
}
