---
phase: implementation
title: Implementation Guide
description: Technical implementation notes, patterns, and code guidelines
---

# Backend API Integration Reference

## Development Setup
**How do we get started?**

### Base conventions

- Base URL: `http://<host>:<port>/api`
- Default port: `3001` (`PORT`, fallback trong `src/config/index.ts`)
- Content type: `application/json`
- Auth scheme: `Bearer <jwt>`
- Token source: `POST /api/auth/login`
- Token TTL: `24h`
- Timestamp convention:
- Request nên gửi `startAt` và `endAt` ở dạng ISO 8601 để tránh lệch múi giờ.
- Response luôn có `startAt` và `endAt` làm source of truth.
- `date`, `startTime`, `endTime` là field đã format theo timezone của phòng, mặc định `Asia/Bangkok`.

### Required headers

- Public endpoints:
  - `Content-Type: application/json`
- Protected endpoints:
  - `Content-Type: application/json`
  - `Authorization: Bearer <token>`

### Seed assumptions useful for local integration

- Room IDs được tạo theo pattern `room-<index>`.
- `.env.example` minh họa 3 phòng: `room-1` (`France`), `room-2` (`Japan`), `room-3` (`Korea`).
- Ở runtime thật, danh sách phòng phụ thuộc biến môi trường `ROOM_<n>_*`.

## Code Structure
**How is the code organized?**

- Route inventory: `src/app.ts`
- Auth contract: `src/routes/auth.ts`, `src/middleware/auth.ts`
- Room endpoints: `src/routes/rooms.ts`
- Booking endpoints: `src/routes/booking.ts`, `src/routes/bookings.ts`
- Chat endpoint: `src/routes/chat.ts`
- Sync endpoint: `src/routes/sync.ts`
- Webhook endpoint: `src/routes/integrations.ts`
- Canonical output DTOs: `src/services/public-api.service.ts`
- Booking business rules: `src/services/booking.service.ts`
- Room live status: `src/services/room-status.service.ts`
- Sync health summary: `src/services/sync-status.service.ts`

## Implementation Notes
**Key technical details to remember:**

### Shared schemas

```ts
type ErrorResponse = {
  error: string
}

type BookingStatus = 'pending' | 'confirmed' | 'modified' | 'cancelled' | 'sync_error'
type SyncSource = 'google_calendar' | 'recall' | 'ical_fallback' | 'system'
type SyncHealth = 'healthy' | 'degraded' | 'offline' | 'unknown'

type LoginRequest = {
  email: string
}

type LoginResponse = {
  token: string
  user: {
    email: string
    name: string
  }
}

type PublicRoomSlot = {
  externalEventId: string
  title: string
  startAt: string
  endAt: string
  date: string
  startTime: string
  endTime: string
  status: string
  source: string
}

type PublicBooking = {
  id: string
  userEmail: string
  roomId: string
  roomName: string
  date: string
  startTime: string
  endTime: string
  startAt: string
  endAt: string
  duration: number
  title: string
  status: BookingStatus
  createdAt: string
  updatedAt: string
  calendarLink: string | null
  calendarEventId: string | null
  source: SyncSource
  notes: string | null
  room?: PublicRoom
}

type PublicRoom = {
  id: string
  name: string
  capacity: number
  floor?: string | number
  description?: string
  image: string | null
  color: string | null
  equipment: string[]
  features: string[]
  timezone: string
  liveStatus: 'busy' | 'reserved' | 'available' | 'syncing' | 'unknown' | string
  currentBooking: PublicBooking | null
  nextBooking: PublicBooking | null
  bookedSlots: PublicRoomSlot[]
}

type SyncStatusView = {
  state: SyncHealth
  lastSuccessfulSyncAt: string | null
  lastAttemptAt: string | null
  pendingChanges: number
  roomsSynced: number
  message: string | null
}
```

### Consumer-side parsing rules

- Luôn parse `startAt` và `endAt`; không suy ngược lại từ `date/startTime/endTime`.
- Handle an toàn cho `null` ở `calendarLink`, `calendarEventId`, `notes`, `currentBooking`, `nextBooking`.
- `room` trong `PublicBooking` thường có mặt ở booking APIs, nhưng nested booking trong room payload sẽ không lồng `room` lần nữa.
- `GET /api/bookings` chỉ hỗ trợ `scope=mine`; mọi giá trị khác trả `400`.
- Query `status` invalid ở `GET /api/bookings` hiện bị fallback thành không filter, không trả lỗi.
- `POST /api/chat` là endpoint tư vấn/search/summarize. Nó không tạo booking; app phải gọi `POST /api/bookings` sau khi user xác nhận.

## Integration Points
**How do pieces connect?**

## 1) Endpoint matrix

| Method | Path | Auth | Consumer | Purpose |
|---|---|---|---|---|
| GET | `/api/health` | No | Public | Health check nhanh của backend |
| POST | `/api/auth/login` | No | App client | Lấy JWT từ email |
| GET | `/api/rooms` | Yes | App client | Danh sách phòng + live status |
| GET | `/api/rooms/:roomId` | Yes | App client | Chi tiết một phòng |
| POST | `/api/book` | Yes | Legacy app/client | Tạo booking theo contract cũ |
| GET | `/api/bookings` | Yes | App client | Danh sách booking của user hiện tại |
| GET | `/api/bookings/:bookingId` | Yes | App client | Chi tiết booking của user hiện tại |
| POST | `/api/bookings` | Yes | App client | Tạo booking mới |
| POST | `/api/bookings/:bookingId/cancel` | Yes | App client | Hủy booking |
| POST | `/api/chat` | Yes | App client | Search room / booking summary / schedule summary |
| GET | `/api/sync/status` | Yes | Admin/debug client | Trạng thái sync vận hành |
| POST | `/api/integrations/recall/webhook` | Signature | Recall only | Webhook sync từ Recall |

## 2) Auth contract

### `POST /api/auth/login`

Purpose: tạo JWT từ email, không có password flow trong backend hiện tại.

Request body:

```json
{
  "email": "member@apero.vn"
}
```

Success `200`:

```json
{
  "token": "<jwt>",
  "user": {
    "email": "member@apero.vn",
    "name": "member"
  }
}
```

Errors:

- `400` thiếu email:

```json
{ "error": "Email là bắt buộc." }
```

- `400` email invalid:

```json
{ "error": "Email không hợp lệ." }
```

Protected endpoint auth failures:

- `401` thiếu token hoặc sai format:

```json
{ "error": "Token không hợp lệ hoặc không được cung cấp" }
```

- `401` token invalid/expired:

```json
{ "error": "Token hết hạn hoặc không hợp lệ" }
```

## 3) Health endpoint

### `GET /api/health`

Success `200`:

```json
{
  "status": "ok",
  "rooms": 3,
  "timestamp": "2026-04-06T08:00:00.000Z"
}
```

Notes:

- `rooms` phản ánh số phòng load được từ config tại thời điểm boot.
- Endpoint này không yêu cầu auth và không trả business data chi tiết.

## 4) Room endpoints

### `GET /api/rooms`

Purpose: lấy toàn bộ room catalog đã chuẩn hóa thành `PublicRoom[]`.

Success `200`:

```json
{
  "rooms": [
    {
      "id": "room-2",
      "name": "Japan",
      "capacity": 8,
      "floor": "1",
      "description": "Japan là phòng họp cho tối đa 8 người tại Apero.",
      "image": null,
      "color": "#1D4ED8",
      "equipment": ["display", "whiteboard"],
      "features": ["Focus room"],
      "timezone": "Asia/Bangkok",
      "liveStatus": "available",
      "currentBooking": null,
      "nextBooking": {
        "id": "4b89263d-3f09-48b3-a216-7cf28cfcf7d4",
        "userEmail": "member@apero.vn",
        "roomId": "room-2",
        "roomName": "Japan",
        "date": "2026-04-07",
        "startTime": "15:00",
        "endTime": "16:00",
        "startAt": "2026-04-07T08:00:00.000Z",
        "endAt": "2026-04-07T09:00:00.000Z",
        "duration": 60,
        "title": "Sprint Planning",
        "status": "confirmed",
        "createdAt": "2026-04-06T09:00:00.000Z",
        "updatedAt": "2026-04-06T09:00:00.000Z",
        "calendarLink": null,
        "calendarEventId": "evt_123",
        "source": "google_calendar",
        "notes": null
      },
      "bookedSlots": [
        {
          "externalEventId": "evt_123",
          "title": "Sprint Planning",
          "startAt": "2026-04-07T08:00:00.000Z",
          "endAt": "2026-04-07T09:00:00.000Z",
          "date": "2026-04-07",
          "startTime": "15:00",
          "endTime": "16:00",
          "status": "confirmed",
          "source": "google_calendar"
        }
      ]
    }
  ]
}
```

Notes:

- `currentBooking` và `nextBooking` có thể `null`.
- `liveStatus` hiện được suy ra từ projection và có thể là `busy`, `reserved`, `available`, `syncing` hoặc `unknown`.
- `bookedSlots` là projection của lịch phòng; có thể rỗng nếu chưa có data hoặc chưa sync.

### `GET /api/rooms/:roomId`

Purpose: lấy chi tiết một phòng theo cùng schema `PublicRoom`.

Success `200`:

```json
{
  "room": {
    "id": "room-2",
    "name": "Japan",
    "capacity": 8,
    "floor": "1",
    "description": "Japan là phòng họp cho tối đa 8 người tại Apero.",
    "image": null,
    "color": "#1D4ED8",
    "equipment": ["display", "whiteboard"],
    "features": ["Focus room"],
    "timezone": "Asia/Bangkok",
    "liveStatus": "busy",
    "currentBooking": {
      "id": "4b89263d-3f09-48b3-a216-7cf28cfcf7d4",
      "userEmail": "member@apero.vn",
      "roomId": "room-2",
      "roomName": "Japan",
      "date": "2026-04-07",
      "startTime": "15:00",
      "endTime": "16:00",
      "startAt": "2026-04-07T08:00:00.000Z",
      "endAt": "2026-04-07T09:00:00.000Z",
      "duration": 60,
      "title": "Sprint Planning",
      "status": "confirmed",
      "createdAt": "2026-04-06T09:00:00.000Z",
      "updatedAt": "2026-04-06T09:00:00.000Z",
      "calendarLink": null,
      "calendarEventId": "evt_123",
      "source": "google_calendar",
      "notes": null
    },
    "nextBooking": null,
    "bookedSlots": []
  }
}
```

Error `404`:

```json
{ "error": "Không tìm thấy phòng." }
```

Important: route này vẫn trả `PublicRoom`, không expose `upcomingBookings` dù service nội bộ có tính sẵn.

## 5) Booking endpoints

### `POST /api/bookings`

Purpose: tạo booking mới. Đây là endpoint nên dùng cho integration mới.

Request body:

```json
{
  "roomId": "room-2",
  "title": "Sprint Planning",
  "startAt": "2026-04-07T08:00:00.000Z",
  "endAt": "2026-04-07T09:00:00.000Z"
}
```

Validation notes:

- `roomId`, `startAt`, `endAt` là bắt buộc.
- Backend parse thời gian bằng `new Date(...)`, sau đó normalize về ISO.
- `endAt` phải lớn hơn `startAt`.
- Không được đặt trong quá khứ.
- Conflict được kiểm bằng room projection trước khi tạo Google Calendar event.

Success `201`:

```json
{
  "booking": {
    "id": "4b89263d-3f09-48b3-a216-7cf28cfcf7d4",
    "userEmail": "member@apero.vn",
    "roomId": "room-2",
    "roomName": "Japan",
    "date": "2026-04-07",
    "startTime": "15:00",
    "endTime": "16:00",
    "startAt": "2026-04-07T08:00:00.000Z",
    "endAt": "2026-04-07T09:00:00.000Z",
    "duration": 60,
    "title": "Sprint Planning",
    "status": "confirmed",
    "createdAt": "2026-04-06T09:00:00.000Z",
    "updatedAt": "2026-04-06T09:00:00.000Z",
    "calendarLink": "https://calendar.google.com/calendar/event?eid=...",
    "calendarEventId": "evt_123",
    "source": "system",
    "notes": null,
    "room": {
      "id": "room-2",
      "name": "Japan",
      "capacity": 8,
      "floor": "1",
      "description": "Japan là phòng họp cho tối đa 8 người tại Apero.",
      "image": null,
      "color": "#1D4ED8",
      "equipment": ["display", "whiteboard"],
      "features": ["Focus room"],
      "timezone": "Asia/Bangkok",
      "liveStatus": "available",
      "currentBooking": null,
      "nextBooking": null,
      "bookedSlots": []
    }
  }
}
```

Errors:

- `400` thiếu field:

```json
{ "error": "Thiếu thông tin đặt phòng (roomId, startAt, endAt)." }
```

- `400` time range sai:

```json
{ "error": "Khung giờ không hợp lệ: endAt phải lớn hơn startAt." }
```

hoặc

```json
{ "error": "Khung giờ không hợp lệ." }
```

- `400` đặt trong quá khứ:

```json
{ "error": "Không thể đặt lịch trong quá khứ." }
```

- `404` room không tồn tại:

```json
{ "error": "Không tìm thấy phòng." }
```

- `409` room đã bận:

```json
{ "error": "Phòng không còn trống trong khung giờ này." }
```

- `500` lỗi hệ thống:

```json
{ "error": "Lỗi hệ thống. Vui lòng thử lại sau." }
```

### `POST /api/book`

Purpose: legacy alias cho create booking.

Request body: giống hệt `POST /api/bookings`.

Success `201`:

```json
{
  "message": "Đặt phòng thành công.",
  "booking": {
    "id": "4b89263d-3f09-48b3-a216-7cf28cfcf7d4"
  }
}
```

Notes:

- Nghiệp vụ và error mapping giống `POST /api/bookings`.
- Chỉ khác response success có thêm field `message`.
- Integration mới nên dùng `POST /api/bookings`.

### `GET /api/bookings`

Purpose: liệt kê booking của chính user trong JWT.

Query params:

- `scope`: chỉ chấp nhận `mine`; default là `mine`
- `status`: `pending | confirmed | modified | cancelled | sync_error | all`
- `limit`: số nguyên dương; default `30`; max `200`; giá trị invalid fallback về default

Success `200`:

```json
{
  "bookings": [
    {
      "id": "4b89263d-3f09-48b3-a216-7cf28cfcf7d4",
      "userEmail": "member@apero.vn",
      "roomId": "room-2",
      "roomName": "Japan",
      "date": "2026-04-07",
      "startTime": "15:00",
      "endTime": "16:00",
      "startAt": "2026-04-07T08:00:00.000Z",
      "endAt": "2026-04-07T09:00:00.000Z",
      "duration": 60,
      "title": "Sprint Planning",
      "status": "confirmed",
      "createdAt": "2026-04-06T09:00:00.000Z",
      "updatedAt": "2026-04-06T09:00:00.000Z",
      "calendarLink": "https://calendar.google.com/calendar/event?eid=...",
      "calendarEventId": "evt_123",
      "source": "system",
      "notes": null,
      "room": {
        "id": "room-2",
        "name": "Japan",
        "capacity": 8,
        "floor": "1",
        "description": "Japan là phòng họp cho tối đa 8 người tại Apero.",
        "image": null,
        "color": "#1D4ED8",
        "equipment": ["display", "whiteboard"],
        "features": ["Focus room"],
        "timezone": "Asia/Bangkok",
        "liveStatus": "available",
        "currentBooking": null,
        "nextBooking": null,
        "bookedSlots": []
      }
    }
  ]
}
```

Notes:

- Route sẽ reconcile booking với Google Calendar trước khi trả response cuối.
- Nếu `scope != mine`, backend trả `400`:

```json
{ "error": "Chỉ hỗ trợ scope=mine ở phiên bản hiện tại." }
```

### `GET /api/bookings/:bookingId`

Purpose: lấy chi tiết một booking thuộc về user hiện tại.

Success `200`:

```json
{
  "booking": {
    "id": "4b89263d-3f09-48b3-a216-7cf28cfcf7d4",
    "status": "confirmed"
  }
}
```

Notes:

- Nếu booking tồn tại, route sẽ reconcile lại calendar trước khi trả kết quả cuối.
- Nếu booking không thuộc user trong JWT, route trả như not found.

Error `404`:

```json
{ "error": "Không tìm thấy booking." }
```

### `POST /api/bookings/:bookingId/cancel`

Purpose: hủy booking hiện có.

Success `200`:

```json
{
  "booking": {
    "id": "4b89263d-3f09-48b3-a216-7cf28cfcf7d4",
    "status": "cancelled"
  }
}
```

Notes:

- Nếu booking đã ở trạng thái `cancelled`, route trả lại booking hiện tại và không báo lỗi.
- Cancel sẽ gọi Google Calendar trước, sau đó update local status và projection.

Errors:

- `404` booking không tồn tại hoặc không thuộc user:

```json
{ "error": "Không tìm thấy booking để hủy." }
```

- `500` lỗi cancel hệ thống:

```json
{ "error": "Không thể hủy booking lúc này. Vui lòng thử lại." }
```

## 6) Chat endpoint

### `POST /api/chat`

Purpose: intent endpoint cho search, availability suggestion, booking summary và room schedule summary.

Request body:

```json
{
  "message": "Tìm phòng 6 người lúc 3 giờ chiều mai",
  "conversationHistory": [
    { "role": "user", "content": "Mình cần phòng họp" },
    { "role": "assistant", "content": "Bạn cần cho bao nhiêu người?" }
  ]
}
```

Request notes:

- `message` là bắt buộc.
- `conversationHistory` là optional.
- Mỗi item history chỉ giữ lại `role` thuộc `user | assistant | system`; role lạ sẽ bị normalize thành `user`.
- History item có `content` rỗng sẽ bị bỏ qua.

Validation error `400`:

```json
{ "error": "Message là bắt buộc." }
```

### Chat response union

```ts
type ChatResponse =
  | {
      type: 'clarify' | 'info'
      message: string
      panelHint: 'none'
    }
  | {
      type: 'list_rooms'
      message: string
      rooms: PublicRoom[]
      panelHint: 'none'
    }
  | {
      type: 'rooms_available'
      message: string
      rooms: PublicRoom[]
      searchParams: {
        numberOfPeople: number
        date: string
        startTime: string
        duration: number
      }
      panelHint: 'none'
    }
  | {
      type: 'no_availability'
      message: string
      alternatives: Array<{
        startTime: string
        endTime: string
        rooms: PublicRoom[]
      }>
      panelHint: 'none'
    }
  | {
      type: 'history_summary'
      message: string
      bookings: Array<PublicBooking | ScheduleBookingSummary>
      bookingId?: string
      roomId?: string
      status?: BookingStatus
      panelHint: 'none'
    }
```

Trong đó `ScheduleBookingSummary` là object gần giống `PublicBooking`, nhưng được tạo từ room projection khi hỏi lịch phòng theo tháng:

```ts
type ScheduleBookingSummary = {
  id: `slot:${string}:${string}`
  userEmail: 'calendar@system.local'
  roomId: string
  roomName: string
  date: string
  startTime: string
  endTime: string
  startAt: string
  endAt: string
  duration: number
  title: string
  status: 'confirmed'
  createdAt: string
  updatedAt: string
  calendarLink: null
  calendarEventId: string
  source: string
  notes: null
  room: PublicRoom
}
```

### Representative success examples

`type=clarify`:

```json
{
  "type": "clarify",
  "message": "Mình đã có ngày và giờ bắt đầu. Bạn cho mình thêm thời lượng hoặc giờ kết thúc...",
  "panelHint": "none"
}
```

`type=list_rooms`:

```json
{
  "type": "list_rooms",
  "message": "Đây là danh sách phòng hiện có.",
  "rooms": [],
  "panelHint": "none"
}
```

`type=rooms_available`:

```json
{
  "type": "rooms_available",
  "message": "Tôi tìm thấy 3 phòng phù hợp. Hãy chọn một phòng để xác nhận booking.",
  "rooms": [],
  "searchParams": {
    "numberOfPeople": 6,
    "date": "2026-04-07",
    "startTime": "15:00",
    "duration": 60
  },
  "panelHint": "none"
}
```

`type=no_availability`:

```json
{
  "type": "no_availability",
  "message": "Không có phòng trống đúng yêu cầu vào 15:00 ngày 2026-04-07. Đây là các lựa chọn trước/sau 30 phút.",
  "alternatives": [
    {
      "startTime": "2026-04-07T07:30:00.000Z",
      "endTime": "2026-04-07T08:30:00.000Z",
      "rooms": []
    }
  ],
  "panelHint": "none"
}
```

`type=history_summary` khi hỏi booking của user:

```json
{
  "type": "history_summary",
  "message": "Đã kiểm tra lịch của bạn. Hiện có 2 booking.",
  "bookings": [],
  "bookingId": "4b89263d-3f09-48b3-a216-7cf28cfcf7d4",
  "roomId": "room-2",
  "status": "confirmed",
  "panelHint": "none"
}
```

`type=history_summary` khi hỏi lịch phòng theo tháng:

```json
{
  "type": "history_summary",
  "message": "Tìm thấy 5 lịch đã đặt trong tháng 4/2026.",
  "bookings": [],
  "roomId": "room-2",
  "panelHint": "none"
}
```

Chat business/system errors dùng cùng error envelope với booking routes:

- `404` room không tồn tại
- `409` room không còn trống
- `400` time range invalid hoặc booking in past
- `500` lỗi hệ thống

## 7) Sync endpoint

### `GET /api/sync/status`

Purpose: cung cấp health summary cho sync subsystem.

Success `200`:

```json
{
  "sync": {
    "state": "healthy",
    "lastSuccessfulSyncAt": "2026-04-06T08:00:00.000Z",
    "lastAttemptAt": "2026-04-06T08:05:00.000Z",
    "pendingChanges": 0,
    "roomsSynced": 3,
    "message": "Đồng bộ lịch phòng đang ổn định."
  }
}
```

State semantics:

- `healthy`: tất cả phòng đã sync ổn định.
- `degraded`: có pending room, failure hoặc chưa sync đủ toàn bộ.
- `offline`: chưa có phòng nào có `lastSyncedAt`.
- `unknown`: không có room nào trong catalog.

## 8) Recall webhook reference

### `POST /api/integrations/recall/webhook`

Purpose: nhận webhook từ Recall để cập nhật room projection. Endpoint này không dành cho mobile/client app.

Minimal payload được parser chấp nhận:

```json
{
  "event": "calendar.updated",
  "data": {
    "calendar_id": "japan@apero.vn",
    "last_updated_ts": "2026-04-06T08:00:00.000Z"
  }
}
```

Signature behavior:

- Nếu `RECALL_WEBHOOK_SECRET` bắt đầu bằng `whsec_`, endpoint verify theo cặp header `webhook-id/webhook-timestamp/webhook-signature` hoặc `svix-id/svix-timestamp/svix-signature`.
- Nếu secret không có prefix `whsec_`, endpoint chấp nhận HMAC hex qua một trong các header `x-recall-signature`, `x-recall-signature-sha256`, `x-signature`.
- Nếu không cấu hình secret, request vẫn được nhận mà không verify chữ ký.

Success `200` khi sync được:

```json
{
  "ok": true,
  "event": "calendar.updated",
  "calendarId": "japan@apero.vn",
  "roomId": "room-2",
  "sync": {
    "calendarId": "japan@apero.vn",
    "roomId": "room-2",
    "fetched": 4,
    "upserted": 4,
    "deleted": 0,
    "lastUpdatedTs": "2026-04-06T08:00:00.000Z",
    "status": "synced",
    "error": null
  }
}
```

Accepted-but-ignored `202` nếu không map được room hoặc thiếu Recall API key:

```json
{
  "ok": true,
  "ignored": true,
  "reason": "No room mapped for this calendarId",
  "calendarId": "unknown@apero.vn"
}
```

Auth/processing errors:

- `401` invalid signature:

```json
{ "error": "Invalid webhook signature" }
```

- `500` processing failure:

```json
{ "error": "Webhook processing failed" }
```

## Error Handling
**How do we handle failures?**

### HTTP status matrix

| Status | Where it appears | Meaning |
|---|---|---|
| `200` | Read endpoints, login, cancel, chat, sync, webhook sync success | Request xử lý thành công |
| `201` | `POST /api/book`, `POST /api/bookings` | Booking đã được tạo |
| `202` | Recall webhook ignored | Request hợp lệ nhưng bị bỏ qua có chủ đích |
| `400` | Login, booking, chat, bookings scope | Input thiếu/sai hoặc time range invalid |
| `401` | Protected endpoints, webhook signature | Token/signature invalid hoặc thiếu |
| `404` | Room/booking lookup | Resource không tồn tại hoặc không thuộc user |
| `409` | Booking/chat conflict | Slot đã bị chiếm |
| `500` | Booking/chat/cancel/webhook | Lỗi hệ thống hoặc external dependency |

### Integration guardrails

- Nếu app đang dùng chat để hỗ trợ booking flow, luôn chờ user xác nhận rồi mới gọi `POST /api/bookings`.
- Không hardcode assumption rằng `calendarLink` luôn có; service chỉ cố gắng suy ra link nếu Google trả dữ liệu.
- Không dùng `/api/book` cho integration mới.
- Không gọi `/api/integrations/recall/webhook` từ mobile app.

## Performance Considerations
**How do we keep it fast?**

- `GET /api/bookings` và `GET /api/bookings/:bookingId` có thể trigger reconcile với Google Calendar trước khi trả kết quả cuối.
- `GET /api/rooms`/`GET /api/rooms/:roomId` có thể bootstrap room projection nếu projection chưa có.
- `POST /api/chat` có thể gọi AI service hoặc room availability logic; client nên có loading state và retry UX hợp lý.

## Security Notes
**What security measures are in place?**

- JWT currently được issue chỉ từ email, không có password/SSO step trong backend hiện tại.
- Protected endpoints chỉ tin payload trong JWT đã verify bằng `JWT_SECRET`.
- Recall webhook có signature verification khi secret được cấu hình.
- Không đưa secret hoặc service account info vào client app; mobile chỉ cần base URL và JWT token runtime.

## Integration Checklist
**What should a consuming team do first?**

1. Implement login và lưu JWT an toàn.
2. Tạo HTTP client mặc định với `Content-Type: application/json` và Bearer token interceptor.
3. Tạo model/parser cho `PublicRoom`, `PublicBooking`, `SyncStatusView`, `ChatResponse`.
4. Parse `startAt/endAt` làm source of truth; chỉ dùng `date/startTime/endTime` để hiển thị.
5. Handle đầy đủ error body `{ error }` và status `400/401/404/409/500`.
6. Dùng `POST /api/bookings` cho create flow; không dùng `POST /api/book` nếu không cần backward compatibility.
7. Nếu dùng chat, render UI theo `type`, không parse `message` để suy logic.
8. Xác minh smoke flow: login -> rooms -> create booking -> list booking -> cancel booking.
