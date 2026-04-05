declare module '../services/booking.service' {
  import type { BookingCreateInput, BookingCreateResult, BookingRecordV2 } from '../services/sync.types';

  export function getUserBookings(userEmail: string | string[], limit?: number): BookingRecordV2[];
  export function getUserBookingDetail(bookingId: string | string[], userEmail: string | string[]): BookingRecordV2 | null;
  export function getLatestUserBooking(userEmail: string | string[]): BookingRecordV2 | null;
  export function createConfirmedBooking(input: BookingCreateInput): Promise<BookingCreateResult>;
}

declare module '../services/room-status.service' {
  import type { RoomDetail, RoomListItem, RoomStatusSummary } from './index';

  export function getRoomDetail(roomId: string | string[]): Promise<RoomDetail | null>;
  export function listRoomsWithStatus(): Promise<RoomListItem[]>;
  export function getRoomStatusSnapshot(roomId: string | string[]): RoomStatusSummary | undefined;
}
