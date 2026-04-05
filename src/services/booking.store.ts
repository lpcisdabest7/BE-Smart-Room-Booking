import { BookingRecord } from '../types';

// In-memory booking store (per session, resets on server restart)
const bookings: BookingRecord[] = [];

export function addBooking(record: BookingRecord): void {
  bookings.push(record);
}

export function getBookingsByUser(userEmail: string): BookingRecord[] {
  return bookings.filter((b) => b.userEmail === userEmail);
}

export function getRecentBookingByUser(userEmail: string): BookingRecord | undefined {
  const userBookings = getBookingsByUser(userEmail);
  return userBookings[userBookings.length - 1];
}

export function getAllBookings(): BookingRecord[] {
  return [...bookings];
}
