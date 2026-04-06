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
  durationMinutes: number,
  targetPeople = 1
): Promise<AlternativeSlot[]> {
  const now = new Date();
  const durationMs = durationMinutes * 60 * 1000;

  // Search window: same day as originalStart, from now (or day start) to end of day
  const dayStart = new Date(originalStart);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(originalStart);
  dayEnd.setHours(24, 0, 0, 0); // exclusive midnight — use full day without off-by-1ms
  const searchFrom = now > dayStart ? now : dayStart;

  // For each room, find free gaps and extract candidate start times
  const roomResults = await Promise.all(
    rooms.map(async (room) => {
      const events = await fetchEvents(room.icalLink);

      // Keep only events that intersect the search window
      const dayEvents = events
        .filter((e) => e.end > searchFrom && e.start < dayEnd)
        .sort((a, b) => a.start.getTime() - b.start.getTime());

      // Build free gaps by scanning through sorted events
      const gaps: { start: Date; end: Date }[] = [];
      let cursor = searchFrom;
      for (const event of dayEvents) {
        if (event.start > cursor) {
          gaps.push({ start: new Date(cursor), end: event.start });
        }
        if (event.end > cursor) {
          cursor = event.end;
        }
      }
      if (cursor < dayEnd) {
        gaps.push({ start: new Date(cursor), end: dayEnd });
      }

      // From each gap wide enough to fit the duration, pick candidate start times
      const candidates: Date[] = [];
      for (const gap of gaps) {
        const gapMs = gap.end.getTime() - gap.start.getTime();
        if (gapMs < durationMs) continue;

        // Latest possible start so the slot still fits inside the gap
        const latestStart = new Date(gap.end.getTime() - durationMs);

        // Closest start to originalStart that fits within [gap.start, latestStart]
        const clamped = new Date(
          Math.max(gap.start.getTime(), Math.min(originalStart.getTime(), latestStart.getTime()))
        );
        if (clamped >= now) candidates.push(clamped);

        // Gap start (gives a "before" alternative when gap precedes originalStart)
        if (gap.start >= now && gap.start.getTime() !== clamped.getTime()) {
          candidates.push(gap.start);
        }

        // Latest start in gap (gives an "after" alternative when gap follows originalStart)
        if (
          latestStart >= now &&
          latestStart.getTime() !== clamped.getTime() &&
          latestStart.getTime() !== gap.start.getTime()
        ) {
          candidates.push(latestStart);
        }

        // "Ends exactly at originalStart" — nearest before slot
        const endsAtOriginal = new Date(originalStart.getTime() - durationMs);
        if (
          endsAtOriginal >= gap.start &&
          endsAtOriginal <= latestStart &&
          endsAtOriginal >= now &&
          endsAtOriginal.getTime() !== clamped.getTime()
        ) {
          candidates.push(endsAtOriginal);
        }

        // "Starts exactly at originalStart" — nearest after slot
        if (
          originalStart >= gap.start &&
          originalStart <= latestStart &&
          originalStart >= now &&
          originalStart.getTime() !== clamped.getTime()
        ) {
          candidates.push(new Date(originalStart));
        }
      }

      const roomPublic: RoomPublic = {
        id: room.id,
        name: room.name,
        capacity: room.capacity,
        floor: room.floor,
        description: room.description,
        equipment: room.equipment,
        image: room.image,
        color: room.color,
        features: room.features,
      };

      return { roomPublic, candidates };
    })
  );

  // Aggregate candidates: group by start time, collect all available rooms per slot
  const slotMap = new Map<number, { altStart: Date; altEnd: Date; rooms: RoomPublic[] }>();
  for (const { roomPublic, candidates } of roomResults) {
    for (const altStart of candidates) {
      const key = altStart.getTime();
      if (!slotMap.has(key)) {
        slotMap.set(key, { altStart, altEnd: new Date(altStart.getTime() + durationMs), rooms: [] });
      }
      slotMap.get(key)!.rooms.push(roomPublic);
    }
  }

  // Sort slots by proximity to originalStart, sort rooms within each slot by capacity fit
  return Array.from(slotMap.values())
    .map((slot) => ({
      ...slot,
      rooms: slot.rooms.sort((a, b) => {
        const capacityDistance = Math.abs(a.capacity - targetPeople) - Math.abs(b.capacity - targetPeople);
        if (capacityDistance !== 0) return capacityDistance;
        if (a.capacity !== b.capacity) return a.capacity - b.capacity;
        return a.name.localeCompare(b.name);
      }),
    }))
    .sort(
      (a, b) =>
        Math.abs(a.altStart.getTime() - originalStart.getTime()) -
        Math.abs(b.altStart.getTime() - originalStart.getTime())
    )
    .slice(0, 5)
    .map((slot) => ({
      startTime: slot.altStart,
      endTime: slot.altEnd,
      availableRooms: slot.rooms,
    }));
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
