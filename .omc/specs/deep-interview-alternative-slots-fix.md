# Deep Interview Spec: Fix Alternative Time Slot Recommendations

## Metadata
- Interview ID: alt-slots-fix-20260406
- Rounds: 1
- Final Ambiguity Score: 11.7%
- Type: brownfield
- Generated: 2026-04-06
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.35 | 0.315 |
| Constraint Clarity | 0.85 | 0.25 | 0.213 |
| Success Criteria | 0.85 | 0.25 | 0.213 |
| Context Clarity | 0.95 | 0.15 | 0.143 |
| **Total Clarity** | | | **0.883** |
| **Ambiguity** | | | **11.7%** |

## Goal
Replace the fixed ±30-minute offset approach in `findAlternativeSlots()` (`src/services/calendar.service.ts:75`) with a gap-finding algorithm that scans actual iCal events, finds conflict-free time windows of the requested duration, and ranks them by proximity to the originally requested time.

## Constraints
- **Data source**: iCal via `fetchEvents()` + `eventsOverlap()` — keep current data layer, do not switch to SQL projection
- **Algorithm**: Gap-finding (not fixed offsets). For each room, get sorted events for the day, find gaps between consecutive bookings (plus before-first and after-last), filter gaps where `gap.duration >= requestedDuration`
- **Both directions**: Return slots both before and after the originally requested time
- **Room boundaries**: Each slot must have the full requested duration available — no partial fits
- **Proximity ranking**: Rank results by absolute time distance from the originally requested start
- **Top N**: Return a reasonable number of alternatives (suggest top 3-5 across all rooms combined)
- **Past time guard**: Skip any alternative whose `altStart < now()`

## Non-Goals
- Switching the conflict-check data source to SQL projection (`getProjectedConflictingEvents`)
- Changes to the booking creation flow or `createConfirmedBooking()`
- Changes to the chat route or response format — only `findAlternativeSlots()` internals change
- Adding working-hours boundaries (not requested)

## Acceptance Criteria
- [ ] If a room has booking `19:00-20:00`, suggesting `18:30-19:30` is **REJECTED** (30-min overlap: `18:30 < 20:00 && 19:30 > 19:00`)
- [ ] If a room has booking `19:00-20:00`, suggesting `18:00-19:00` is **OK** (adjacent, no overlap: `18:00 < 20:00 && 19:00 > 19:00` → false)
- [ ] Back-to-back bookings with zero gap produce no alternatives between them
- [ ] Both a before-slot and an after-slot are returned when available
- [ ] Alternatives are ranked by proximity to the original requested time (nearest first)
- [ ] Requested duration of 60 min is not suggested in a 45-min gap
- [ ] Past slots (`altStart < now()`) are filtered out

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| Use SQL projection for conflict checking | Two sources exist: iCal and SQL projection | Keep iCal (`checkRoomAvailability`) — user confirmed |
| Fixed ±30 min offsets are sufficient | They can produce overlapping slots | Replace with gap-finding algorithm |
| Only check availability at offset times | Must find ALL available gaps on the day | Scan all inter-booking gaps for the requested date |

## Technical Context
### File to modify
- **`src/services/calendar.service.ts`** — `findAlternativeSlots()` function (lines 75–129)

### Current implementation
```typescript
export async function findAlternativeSlots(...): Promise<AlternativeSlot[]> {
  const offsets = [-30, 30];  // ← BUG: fixed offsets can overlap existing bookings
  for (const offset of offsets) {
    const altStart = new Date(originalStart + offset * 60 * 1000);
    const altEnd = new Date(altStart + duration * 60 * 1000);
    if (altStart < new Date()) continue;
    const results = await Promise.all(rooms.map(r => checkRoomAvailability(r, altStart, altEnd)));
    // ...
  }
}
```

### Key helpers available
- `fetchEvents(room.icalLink): Promise<CalendarEvent[]>` — returns all iCal events with `.start` and `.end` Date fields
- `eventsOverlap(eventStart, eventEnd, requestStart, requestEnd): boolean` — correct overlap predicate
- `checkRoomAvailability(room, start, end): Promise<RoomAvailability>` — wraps above two

### New algorithm design
```
For each room:
  1. Fetch all events for the day (filter by date)
  2. Sort events by startTime ascending
  3. Build candidate windows:
     a. [dayStart, firstEvent.start]  ← before first booking
     b. [events[i].end, events[i+1].start]  ← between consecutive bookings
     c. [lastEvent.end, dayEnd]  ← after last booking
  4. For each gap window:
     a. Try to fit [altStart, altStart + duration] within the gap
     b. altStart candidates: gap.start, and (originalStart snapped to fit within gap)
     c. Keep only those where altEnd <= gap.end AND altStart >= now()
  5. Deduplicate and rank by |altStart - originalStart|
  6. Return top N across all rooms
```

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Room | core domain | id, name, capacity, floor, icalLink | has many CalendarEvents |
| CalendarEvent | core domain | summary, start, end | belongs to Room (via iCal) |
| AlternativeSlot | supporting | startTime, endTime, availableRooms | aggregates RoomPublic[] |
| TimeGap | supporting (new) | start, end, duration | computed from CalendarEvent gaps |

## Interview Transcript
<details>
<summary>Full Q&A (1 round)</summary>

### Round 0 (pre-interview — user provided detailed spec)
**Input:** Detailed bug report with algorithm requirements, validation examples, and edge cases
**Ambiguity:** 13.9% (Goal: 0.90, Constraints: 0.85, Criteria: 0.85, Context: 0.80)

### Round 1
**Q:** Which data source for gap-finding — SQL projection or iCal?
**A:** iCal (keep current)
**Ambiguity:** 11.7% ✅ (Context raised to 0.95)
</details>
