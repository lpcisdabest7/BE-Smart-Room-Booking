import * as ical from 'node-ical';
import { RoomRecord, RoomPublic, CalendarEvent, RoomAvailability, AlternativeSlot } from '../types';
import { cacheService } from './cache.service';
import { config } from '../config';

async function fetchEvents(icalLink: string): Promise<CalendarEvent[]> {
  const cacheKey = `ical:${icalLink}`;
  const cached = cacheService.get<CalendarEvent[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const data = await ical.async.fromURL(icalLink);
    const events: CalendarEvent[] = [];

    for (const key of Object.keys(data)) {
      const component = data[key];
      if (!component || component.type !== 'VEVENT') continue;
      const vevent = component as ical.VEvent;
      if (vevent.start && vevent.end) {
        events.push({
          summary: (typeof vevent.summary === 'string' ? vevent.summary : 'Untitled') || 'Untitled',
          start: new Date(vevent.start as unknown as string),
          end: new Date(vevent.end as unknown as string),
        });
      }
    }

    cacheService.set(cacheKey, events, 120);
    return events;
  } catch (error) {
    console.error(`Failed to fetch iCal from ${icalLink}:`, error);
    return [];
  }
}

function eventsOverlap(
  eventStart: Date,
  eventEnd: Date,
  requestStart: Date,
  requestEnd: Date
): boolean {
  return eventStart < requestEnd && eventEnd > requestStart;
}

export async function checkRoomAvailability(
  room: RoomRecord,
  startTime: Date,
  endTime: Date
): Promise<RoomAvailability> {
  const events = await fetchEvents(room.icalLink);
  const conflictingEvents = events.filter((event) =>
    eventsOverlap(event.start, event.end, startTime, endTime)
  );

  return {
    room,
    available: conflictingEvents.length === 0,
    conflictingEvents,
    source: 'ical',
  };
}

export async function checkAllRooms(
  startTime: Date,
  endTime: Date
): Promise<RoomAvailability[]> {
  const results = await Promise.all(
    config.rooms.map((room) => checkRoomAvailability(room, startTime, endTime))
  );
  return results;
}

export async function findAlternativeSlots(
  rooms: RoomRecord[],
  originalStart: Date,
  durationMinutes: number
): Promise<AlternativeSlot[]> {
  const offsets = [-30, -15, 15, 30]; // minutes
  const alternatives: AlternativeSlot[] = [];

  for (const offset of offsets) {
    const altStart = new Date(originalStart.getTime() + offset * 60 * 1000);
    const altEnd = new Date(altStart.getTime() + durationMinutes * 60 * 1000);

    // Skip past times
    if (altStart < new Date()) continue;

    const results = await Promise.all(
      rooms.map((room) => checkRoomAvailability(room, altStart, altEnd))
    );

    const availableRooms: RoomPublic[] = results
      .filter((r) => r.available)
      .map((r) => ({
        id: r.room.id,
        name: r.room.name,
        capacity: r.room.capacity,
        floor: r.room.floor,
        description: r.room.description,
        equipment: r.room.equipment,
        image: r.room.image,
        color: r.room.color,
        features: r.room.features,
      }));

    if (availableRooms.length > 0) {
      alternatives.push({
        startTime: altStart,
        endTime: altEnd,
        availableRooms,
      });
    }
  }

  return alternatives;
}

export function generateBookingLink(
  room: RoomRecord,
  startTime: Date,
  endTime: Date,
  title: string
): string {
  const formatDate = (d: Date): string => {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  };

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${formatDate(startTime)}/${formatDate(endTime)}`,
    location: `Phòng ${room.name} - Apero`,
    details: `Đặt phòng qua Smart Room Booking`,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
