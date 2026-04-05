# Smart Room Booking Web App - Requirements & Implementation Plan

> **Version**: 1.0  
> **Date**: 2026-04-04  
> **Status**: Approved (Multi-Agent Review)  
> **Author**: Apero Engineering Team

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Solution Overview](#2-solution-overview)
3. [Functional Requirements](#3-functional-requirements)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [System Architecture](#5-system-architecture)
6. [Room Configuration](#6-room-configuration)
7. [UI/UX Design](#7-uiux-design)
8. [API Design](#8-api-design)
9. [Frontend Implementation Flow](#9-frontend-implementation-flow)
10. [Backend Implementation Flow](#10-backend-implementation-flow)
11. [AI Integration Flow](#11-ai-integration-flow)
12. [Implementation Steps](#12-implementation-steps)
13. [Decision Log](#13-decision-log)

---

## 1. Problem Statement

### Current Pain Points

- Hệ thống đặt phòng họp Apero dựa trên các Google Calendar riêng biệt, liên kết domain `@apero.vn`.
- Nhân viên dùng sub-domain (vd: `@talent.apero.vn`) **không thể xem** lịch phòng hoặc đặt phòng trực tiếp.
- Quy trình kiểm tra thủ công nhiều calendar **tốn thời gian** và dễ sai sót.
- Nhân viên mới không biết có bao nhiêu phòng, phòng nào ở đâu, sức chứa bao nhiêu.

### Target Audience

- Tất cả nhân viên Apero, đặc biệt nhân viên mới và người dùng email sub-domain.

---

## 2. Solution Overview

### Mô tả

Web app dạng **chat interface** tích hợp AI, cho phép nhân viên:

1. **Nhập yêu cầu bằng text** (natural language, tiếng Việt hoặc English)
   - Ví dụ: "Tìm phòng cho 5 người lúc 2h chiều hôm nay"
2. **AI phân tích** yêu cầu → extract: số người, thời gian, thời lượng
3. **Check real-time** tất cả room calendars
4. **Gợi ý top 3 phòng** phù hợp nhất (theo capacity + availability)
5. **Smart scheduling**: nếu không có phòng trống → đề xuất thời gian thay thế (±15-30 phút)
6. **User confirm** → tạo event trên Google Calendar

### Core Idea

```
Mỗi phòng = 1 Google Calendar → Calendar ID + capacity lưu trong env/config
User chat → BE parse intent → check tất cả calendars → rank → trả kết quả → user confirm → book
```

---

## 3. Functional Requirements

### FR-01: Authentication (Demo Mode)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01.1 | User nhập email + password trên form login đơn giản | P0 |
| FR-01.2 | **Demo logic**: chỉ cần email chứa "apero" (vd: `abc@apero.vn`, `test@talent.apero.vn`, `demo@apero.com`) → cho login, **bất kỳ password nào** | P0 |
| FR-01.3 | Nếu email không chứa "apero" → reject với message "Chỉ nhân viên Apero mới được sử dụng" | P0 |
| FR-01.4 | Session persist bằng JWT token | P0 |
| FR-01.5 | Auto-logout sau 8 giờ không hoạt động | P2 |

### FR-02: Chat Interface

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-02.1 | Input text box với placeholder hướng dẫn | P0 |
| FR-02.2 | Hiển thị chat history dạng bubble (user/bot) | P0 |
| FR-02.3 | Lưu chat history trong LocalStorage (per session) | P1 |
| FR-02.4 | Nút "New Chat" để reset conversation | P1 |
| FR-02.5 | Voice input (Web Speech API) | P2 - Phase 2 |
| FR-02.6 | Typing indicator khi AI đang xử lý | P0 |

### FR-03: AI Intent Parsing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-03.1 | Parse natural language (VI + EN) → extract: `numberOfPeople`, `date`, `startTime`, `duration` | P0 |
| FR-03.2 | Hỏi lại nếu thiếu thông tin bắt buộc (ít nhất cần: thời gian) | P0 |
| FR-03.3 | Hỗ trợ relative time: "hôm nay", "ngày mai", "thứ 5 tuần sau" | P0 |
| FR-03.4 | Default duration = 60 phút nếu không nói rõ | P1 |
| FR-03.5 | Default numberOfPeople = không filter nếu không nói rõ | P1 |

### FR-04: Room Search & Recommendation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-04.1 | Check availability tất cả room calendars trong khoảng thời gian yêu cầu | P0 |
| FR-04.2 | Filter phòng theo capacity >= numberOfPeople | P0 |
| FR-04.3 | Rank theo: (1) capacity fit tốt nhất, (2) tầng/vị trí | P0 |
| FR-04.4 | Trả về **top 3** phòng phù hợp nhất | P0 |
| FR-04.5 | Hiển thị room card: tên, tầng, capacity, thiết bị, trạng thái | P0 |
| FR-04.6 | Nếu không có phòng trống → suggest ±15, ±30 phút | P0 |

### FR-05: Booking

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-05.1 | User chọn 1 trong 3 phòng được suggest | P0 |
| FR-05.2 | Hiện confirmation dialog: phòng, thời gian, số người | P0 |
| FR-05.3 | **Re-check availability** trước khi tạo event (tránh race condition) | P0 |
| FR-05.4 | Tạo Google Calendar prefill link → user click để tự add event vào room calendar | P0 |
| FR-05.5 | Link prefill sẵn: title "[Meeting] {user_name}", time, calendar target | P0 |
| FR-05.6 | Hiện success message + link để user tạo event | P0 |
| FR-05.7 | Nếu phòng đã bị book (race condition) → thông báo + suggest lại | P0 |

### FR-06: Room Information

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-06.1 | User có thể hỏi "có những phòng nào?" → list tất cả phòng | P1 |
| FR-06.2 | User hỏi về phòng cụ thể → hiện chi tiết (capacity, tầng, thiết bị) | P1 |

---

## 4. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | Response time (search) | < 3 giây |
| NFR-02 | Calendar data cache TTL | 2 phút |
| NFR-03 | Concurrent users | 100+ |
| NFR-04 | Uptime | 99% (business hours) |
| NFR-05 | Mobile responsive | Yes |
| NFR-06 | Browser support | Chrome, Edge, Safari (latest 2 versions) |
| NFR-07 | Language | Vietnamese primary, English secondary |
| NFR-08 | Security | HTTPS, OpenAI key server-side only |
| NFR-09 | AI cost per request (OpenAI GPT-4o-mini) | < $0.01 |

---

## 5. System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (React)                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Chat UI  │  │ Auth     │  │ Room Cards        │  │
│  │ Component│  │ (Demo)   │  │ (Suggestion List) │  │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
│       │              │                 │             │
│       └──────────────┼─────────────────┘             │
│                      │                               │
│              ┌───────▼────────┐                      │
│              │  API Service   │                      │
│              │  (Axios/Fetch) │                      │
│              └───────┬────────┘                      │
└──────────────────────┼───────────────────────────────┘
                       │ HTTPS
┌──────────────────────┼───────────────────────────────┐
│                 BACKEND (Node.js + Express)           │
│                      │                               │
│  ┌───────────────────▼──────────────────────────┐    │
│  │              API Router                       │    │
│  │  POST /api/chat    POST /api/book             │    │
│  │  GET  /api/rooms   POST /api/auth/login       │    │
│  └──────┬────────────────────────┬───────────────┘    │
│         │                        │                   │
│  ┌──────▼──────┐   ┌────────────▼────────────┐      │
│  │  AI Service │   │  Calendar Service       │      │
│  │  (OpenAI)   │   │  (Fetch .ics public)   │      │
│  │             │   │  + Cache Layer (memory) │      │
│  └──────┬──────┘   └────────────┬────────────┘      │
│         │                        │                   │
│  ┌──────▼──────┐   ┌────────────▼────────────┐      │
│  │ Intent      │   │  Room Config            │      │
│  │ Parser      │   │  (from .env vars)       │      │
│  └─────────────┘   └─────────────────────────┘      │
└──────────────────────────────────────────────────────┘
                       │
                       ▼
          ┌─────────────────────────┐
          │  Google Calendar .ics   │
          │  (Public iCal links,   │
          │   no API key needed)    │
          └─────────────────────────┘
```

### Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Frontend | React + Vite | Fast dev, lightweight |
| UI Library | Tailwind CSS + shadcn/ui | Modern, responsive |
| Backend | Node.js + Express | Simple, JS ecosystem |
| AI | OpenAI API (GPT-4o-mini) | Cost-effective, multilingual, user có sẵn API key |
| Calendar | Public iCal (.ics) + node-ical | Không cần API key, fetch trực tiếp |
| Auth | Simple email check (demo) | Email chứa "apero" = pass, no OAuth needed |
| Cache | In-memory (node-cache) | Simple, sufficient for MVP |

---

## 6. Room Configuration

### Environment Variables (`.env`)

```env
# Room config (mỗi room = link + name + max capacity)
ROOM_1_LINK=https://calendar.google.com/calendar/ical/xxx/public/basic.ics
ROOM_1_NAME=France
ROOM_1_MAX=3

ROOM_2_LINK=https://calendar.google.com/calendar/ical/yyy/public/basic.ics
ROOM_2_NAME=Japan
ROOM_2_MAX=8

ROOM_3_LINK=https://calendar.google.com/calendar/ical/zzz/public/basic.ics
ROOM_3_NAME=Korea
ROOM_3_MAX=15

# AI (OpenAI)
OPENAI_API_KEY=sk-xxx
AI_MODEL=gpt-4o-mini

# App
PORT=3001
FRONTEND_URL=http://localhost:5173
JWT_SECRET=your-jwt-secret
```

### Room Config (từ `.env`)

Mỗi room có 3 biến env theo pattern `ROOM_{N}_LINK`, `ROOM_{N}_NAME`, `ROOM_{N}_MAX`:

```env
ROOM_1_LINK=https://calendar.google.com/calendar/ical/xxx/public/basic.ics
ROOM_1_NAME=France
ROOM_1_MAX=3

ROOM_2_LINK=https://calendar.google.com/calendar/ical/yyy/public/basic.ics
ROOM_2_NAME=Japan
ROOM_2_MAX=8

ROOM_3_LINK=https://calendar.google.com/calendar/ical/zzz/public/basic.ics
ROOM_3_NAME=Korea
ROOM_3_MAX=15
```

Backend lúc start sẽ scan env → tự build danh sách rooms:

```typescript
// Load rooms từ env
function loadRooms(): Room[] {
  const rooms: Room[] = [];
  let i = 1;
  while (process.env[`ROOM_${i}_LINK`]) {
    rooms.push({
      id: `room-${i}`,
      name: process.env[`ROOM_${i}_NAME`]!,
      icalLink: process.env[`ROOM_${i}_LINK`]!,
      capacity: parseInt(process.env[`ROOM_${i}_MAX`]!, 10),
    });
    i++;
  }
  return rooms;
}
```

> **Thêm phòng mới**: chỉ cần thêm `ROOM_4_LINK`, `ROOM_4_NAME`, `ROOM_4_MAX` vào `.env` → restart server.

---

## 7. UI/UX Design

### Screen Layout

```
┌──────────────────────────────────────────────────┐
│  🏢 Smart Room Booking          [User Avatar ▼]  │
│─────────────────────────────────────────────────│
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  🤖 Xin chào! Tôi giúp bạn đặt phòng họp │  │
│  │     Bạn cần phòng cho mấy người, lúc nào?  │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  👤 Tìm phòng cho 5 người lúc 2h chiều    │  │
│  │     hôm nay, họp khoảng 1 tiếng           │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  🤖 Tôi tìm thấy 3 phòng phù hợp:       │  │
│  │                                            │  │
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │ ✅ Phòng Alpha | Tầng 3 | 6 người   │  │  │
│  │  │ 📽️ projector, whiteboard, video-call │  │  │
│  │  │              [ Đặt phòng này ]        │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  │                                            │  │
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │ ✅ Phòng Beta | Tầng 3 | 12 người   │  │  │
│  │  │ 📽️ projector, whiteboard, video-call │  │  │
│  │  │              [ Đặt phòng này ]        │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  │                                            │  │
│  │  ┌──────────────────────────────────────┐  │  │
│  │  │ ✅ Phòng Gamma | Tầng 5 | 20 người  │  │  │
│  │  │ 📽️ all equipment                     │  │  │
│  │  │              [ Đặt phòng này ]        │  │  │
│  │  └──────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌──────────────────────────────────┐ [Send ➤]   │
│  │ Nhập yêu cầu đặt phòng...      │            │
│  └──────────────────────────────────┘            │
└──────────────────────────────────────────────────┘
```

### UX Flows

**Flow 1: Happy Path (Book thành công)**
```
User login (nhập email chứa "apero" + password bất kỳ)
  → Nhập "Tìm phòng cho 5 người lúc 2h chiều"
  → AI parse: {people: 5, time: "14:00", date: "today", duration: 60}
  → BE check all calendars
  → Return 3 available rooms (sorted by best fit)
  → User click "Đặt phòng này" on room 1
  → Confirmation dialog appears
  → User confirm
  → BE re-check availability → still available
  → BE generate Google Calendar prefill link
  → User click link → tự tạo event trên Google Calendar
```

**Flow 2: No Room Available**
```
User: "Tìm phòng cho 10 người lúc 3h chiều"
  → AI parse intent
  → BE check: tất cả phòng >= 10 người đều bận lúc 3h
  → AI response: "Không có phòng trống lúc 15:00. Gợi ý:"
    - 14:30 - Phòng Beta (12 người) trống
    - 15:30 - Phòng Beta (12 người) trống  
    - 15:00 - Phòng Gamma (20 người) trống ← nếu có
  → User chọn slot thay thế → book flow tiếp tục
```

**Flow 3: Race Condition**
```
User confirm đặt phòng
  → BE re-check: phòng đã bị book bởi người khác
  → Response: "Phòng Alpha đã được đặt rồi. Bạn muốn chọn phòng khác không?"
  → Suggest các phòng còn trống
```

---

## 8. API Design

### Endpoints

#### `POST /api/auth/login`
Login demo mode - chỉ check email chứa "apero".

**Request:**
```json
{
  "email": "user@apero.vn",
  "password": "anything"
}
```

**Response (success - email chứa "apero"):**
```json
{
  "token": "jwt-token",
  "user": {
    "email": "user@apero.vn",
    "name": "user"
  }
}
```

**Response (fail - email không chứa "apero"):**
```json
{
  "error": "UNAUTHORIZED",
  "message": "Chỉ nhân viên Apero mới được sử dụng hệ thống này."
}
```

---

#### `POST /api/chat`
Gửi message và nhận AI response.

**Headers:** `Authorization: Bearer <jwt-token>`

**Request:**
```json
{
  "message": "Tìm phòng cho 5 người lúc 2h chiều hôm nay",
  "conversationHistory": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

**Response:**
```json
{
  "type": "room_suggestions",
  "message": "Tôi tìm thấy 3 phòng phù hợp cho 5 người lúc 14:00 hôm nay:",
  "data": {
    "parsedIntent": {
      "numberOfPeople": 5,
      "date": "2026-04-04",
      "startTime": "14:00",
      "duration": 60
    },
    "suggestions": [
      {
        "room": {
          "id": "room-1",
          "name": "Phòng Alpha",
          "capacity": 6,
          "floor": 3,
          "equipment": ["projector", "whiteboard", "video-call"]
        },
        "available": true,
        "timeSlot": {
          "start": "2026-04-04T14:00:00+07:00",
          "end": "2026-04-04T15:00:00+07:00"
        }
      }
    ],
    "alternativeSlots": []
  }
}
```

**Response (no rooms available):**
```json
{
  "type": "no_rooms",
  "message": "Không có phòng trống cho 10 người lúc 15:00. Đây là các slot thay thế:",
  "data": {
    "suggestions": [],
    "alternativeSlots": [
      {
        "room": { "id": "room-2", "name": "Phòng Beta", "capacity": 12 },
        "timeSlot": {
          "start": "2026-04-04T14:30:00+07:00",
          "end": "2026-04-04T15:30:00+07:00"
        }
      }
    ]
  }
}
```

**Response (clarification needed):**
```json
{
  "type": "clarification",
  "message": "Bạn muốn đặt phòng lúc mấy giờ?",
  "data": {
    "missing": ["startTime"]
  }
}
```

---

#### `POST /api/book`
Đặt phòng sau khi user confirm.

**Headers:** `Authorization: Bearer <jwt-token>`

**Request:**
```json
{
  "roomId": "room-1",
  "date": "2026-04-04",
  "startTime": "14:00",
  "duration": 60,
  "title": "Team Meeting"
}
```

**Response (success):**
```json
{
  "success": true,
  "booking": {
    "calendarLink": "https://calendar.google.com/calendar/render?action=TEMPLATE&text=[Meeting]+User&dates=20260404T070000Z/20260404T080000Z&details=Booked+via+Smart+Room+Booking&location=Phòng+Alpha",
    "summary": "[Meeting] user@apero.vn",
    "start": "2026-04-04T14:00:00+07:00",
    "end": "2026-04-04T15:00:00+07:00",
    "room": "Phòng Alpha"
  }
}
```

**Response (conflict):**
```json
{
  "success": false,
  "error": "ROOM_ALREADY_BOOKED",
  "message": "Phòng Alpha đã được đặt trong khoảng thời gian này.",
  "alternativeSuggestions": [...]
}
```

---

#### `GET /api/rooms`
Lấy danh sách tất cả phòng.

**Headers:** `Authorization: Bearer <jwt-token>`

**Response:**
```json
{
  "rooms": [
    {
      "id": "room-1",
      "name": "Phòng Alpha",
      "capacity": 6,
      "floor": 3,
      "equipment": ["projector", "whiteboard", "video-call"],
      "description": "Phòng họp nhỏ tầng 3"
    }
  ]
}
```

---

## 9. Frontend Implementation Flow

### Project Structure

```
frontend/
├── public/
├── src/
│   ├── components/
│   │   ├── Chat/
│   │   │   ├── ChatContainer.tsx      # Main chat wrapper
│   │   │   ├── ChatMessage.tsx        # Single message bubble
│   │   │   ├── ChatInput.tsx          # Text input + send button
│   │   │   ├── TypingIndicator.tsx    # "AI đang suy nghĩ..."
│   │   │   └── RoomCard.tsx           # Room suggestion card
│   │   ├── Auth/
│   │   │   └── LoginForm.tsx          # Email + password form (demo)
│   │   ├── Layout/
│   │   │   ├── Header.tsx
│   │   │   └── Layout.tsx
│   │   └── Booking/
│   │       └── ConfirmDialog.tsx      # Booking confirmation modal
│   ├── hooks/
│   │   ├── useChat.ts                 # Chat state management
│   │   ├── useAuth.ts                 # Auth state + token
│   │   └── useBooking.ts             # Booking actions
│   ├── services/
│   │   └── api.ts                     # Axios instance + API calls
│   ├── types/
│   │   └── index.ts                   # TypeScript interfaces
│   ├── utils/
│   │   └── storage.ts                # LocalStorage helpers
│   ├── App.tsx
│   └── main.tsx
├── .env
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

### Implementation Steps (FE)

#### Step 1: Project Setup
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install tailwindcss @tailwindcss/vite axios
```

#### Step 2: Auth Flow (Demo)
1. `LoginForm.tsx`: Form đơn giản với 2 field: email + password
2. Submit → gửi `POST /api/auth/login`
3. BE check: `email.toLowerCase().includes('apero')` → pass, bất kỳ password
4. Nhận JWT → lưu vào `localStorage`
5. `useAuth` hook: quản lý auth state, redirect tới login nếu chưa đăng nhập

#### Step 3: Chat UI
1. `ChatContainer.tsx`: Render list messages + input
2. `ChatMessage.tsx`: Render bubble (user = right, bot = left)
3. `ChatInput.tsx`: Text input, Enter to send
4. `TypingIndicator.tsx`: Show khi waiting response

#### Step 4: Room Cards & Booking
1. Khi response type = `room_suggestions` → render `RoomCard` components
2. Mỗi card có nút "Đặt phòng này"
3. Click → mở `ConfirmDialog` với thông tin chi tiết
4. Confirm → gọi `POST /api/book`
5. Success → hiện thông báo + link Google Calendar

#### Step 5: Chat State Management
```typescript
// useChat.ts
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'room_suggestions' | 'no_rooms' | 'clarification' | 'booking_success';
  data?: any;
  timestamp: Date;
}
```
- Lưu `conversationHistory` trong state
- Gửi full history kèm mỗi request (cho AI context)
- Persist vào LocalStorage

---

## 10. Backend Implementation Flow

### Project Structure

```
backend/
├── src/
│   ├── config/
│   │   └── index.ts                  # Load env → build rooms list
│   ├── middleware/
│   │   └── auth.ts                   # JWT verification
│   ├── routes/
│   │   ├── auth.ts                   # Demo auth (email check "apero")
│   │   ├── chat.ts                   # Chat endpoint
│   │   ├── booking.ts               # Booking endpoint
│   │   └── rooms.ts                 # Room info endpoint
│   ├── services/
│   │   ├── ai.service.ts            # OpenAI API integration
│   │   ├── calendar.service.ts      # Google Calendar API
│   │   ├── booking.service.ts       # Booking logic
│   │   └── cache.service.ts         # In-memory cache
│   ├── utils/
│   │   ├── intentParser.ts          # Parse AI response → structured data
│   │   └── timeUtils.ts             # Timezone, date helpers
│   ├── types/
│   │   └── index.ts
│   └── app.ts                       # Express app setup
├── .env
├── package.json
└── tsconfig.json
```

### Implementation Steps (BE)

#### Step 1: Project Setup
```bash
mkdir backend && cd backend
npm init -y
npm install express cors dotenv jsonwebtoken
npm install openai node-ical node-cache
npm install -D typescript @types/express @types/cors @types/jsonwebtoken ts-node nodemon
```

#### Step 2: Google Calendar Service
```typescript
// calendar.service.ts - Core logic
class CalendarService {
  private cache: NodeCache; // cache parsed iCal data
  
  // Fetch .ics file từ public link → parse events (dùng node-ical)
  async fetchEvents(icalLink: string): Promise<CalendarEvent[]>
  
  // Check 1 room có trống trong khoảng thời gian không
  async checkRoomAvailability(room: Room, startTime: Date, endTime: Date): Promise<boolean>
  
  // Check tất cả rooms cùng lúc (Promise.all)
  async checkAllRooms(startTime: Date, endTime: Date): Promise<RoomAvailability[]>
  
  // Tạo Google Calendar prefill link (user click → tự tạo event)
  generateBookingLink(room: Room, startTime: string, endTime: string, title: string): string
  
  // Tìm alternative slots (±15, ±30 phút)
  async findAlternativeSlots(rooms: Room[], originalTime: string, duration: number): Promise<AlternativeSlot[]>
}
```

**Key Implementation Details:**
- Mỗi room calendar set **public** → có link `.ics` (iCal) miễn phí, không cần API key
- Fetch `.ics` link → parse bằng `node-ical` library → lấy danh sách events
- Lấy events trong khoảng ±1 tháng, check overlap với thời gian yêu cầu
- Cache parsed iCal data trong 2 phút (TTL) → tránh fetch lại mỗi request
- Booking: tạo **Google Calendar prefill link** → user click → tự tạo event

#### Step 3: AI Service (OpenAI)
```typescript
// ai.service.ts
import OpenAI from 'openai';

class AIService {
  private client: OpenAI;
  
  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  
  async processMessage(
    userMessage: string, 
    conversationHistory: Message[],
    roomsContext: Room[]
  ): Promise<AIResponse> {
    const response = await this.client.chat.completions.create({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory,
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });
    
    // Parse JSON response → structured intent
    // Returns type: "search" | "clarification" | "general"
  }
}
```

**System Prompt Design:**
```
Bạn là trợ lý đặt phòng họp tại Apero. Hôm nay là {date}.

Danh sách phòng:
{rooms_json}

Nhiệm vụ:
1. Phân tích yêu cầu người dùng → extract: numberOfPeople, date, startTime, duration
2. Nếu thiếu startTime → hỏi lại
3. Nếu đủ thông tin → trả JSON format:
   {"action": "search", "params": {"numberOfPeople": 5, "date": "2026-04-04", "startTime": "14:00", "duration": 60}}
4. Nếu câu hỏi chung → trả lời bình thường
5. Luôn trả lời bằng tiếng Việt
```

#### Step 4: Chat Route Logic
```
POST /api/chat
  → Verify JWT
  → Send message + history to AI Service
  → If AI returns action="search":
      → Call CalendarService.checkAllRooms()
      → Filter by capacity
      → Rank results
      → If no results → CalendarService.findAlternativeSlots()
      → Format response with room cards
  → If AI returns action="clarification":
      → Return clarification message
  → Return response to FE
```

#### Step 5: Booking Route Logic
```
POST /api/book
  → Verify JWT
  → Load room config by roomId
  → Re-check availability (đọc public calendar)
  → If available:
      → Generate Google Calendar prefill link
        (https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=...&location=...)
      → Return link cho user click để tự tạo event
  → If not available:
      → Return conflict error
      → Include alternative suggestions
```

#### Step 6: Auth Route (Demo)
```
POST /api/auth/login
  → Nhận { email, password }
  → Check: email.toLowerCase().includes('apero')
  → Nếu YES → Generate JWT (payload: email, name extracted from email)
  → Return JWT + user info
  → Nếu NO → Return 401 "Chỉ nhân viên Apero mới được sử dụng"
  → Password KHÔNG check (demo mode, accept bất kỳ giá trị)
```

---

## 11. AI Integration Flow

### Sequence Diagram

```
User          Frontend         Backend          AI (OpenAI)      Google Calendar
 │               │                │                 │                  │
 │  "5 người     │                │                 │                  │
 │   lúc 2h"     │                │                 │                  │
 │──────────────>│                │                 │                  │
 │               │  POST /chat    │                 │                  │
 │               │───────────────>│                 │                  │
 │               │                │  Parse intent   │                  │
 │               │                │────────────────>│                  │
 │               │                │  {action:search │                  │
 │               │                │   people:5,     │                  │
 │               │                │   time:14:00}   │                  │
 │               │                │<────────────────│                  │
 │               │                │                 │                  │
 │               │                │  freebusy.query (all rooms)        │
 │               │                │────────────────────────────────────>│
 │               │                │  busy/free slots                   │
 │               │                │<───────────────────────────────────│
 │               │                │                 │                  │
 │               │                │  Filter + Rank  │                  │
 │               │                │  (capacity>=5)  │                  │
 │               │                │                 │                  │
 │               │  3 room cards  │                 │                  │
 │               │<───────────────│                 │                  │
 │  Show cards   │                │                 │                  │
 │<──────────────│                │                 │                  │
 │               │                │                 │                  │
 │  Click "Book" │                │                 │                  │
 │──────────────>│                │                 │                  │
 │               │  POST /book    │                 │                  │
 │               │───────────────>│                 │                  │
 │               │                │  Re-check avail │                  │
 │               │                │────────────────────────────────────>│
 │               │                │  Still free     │                  │
 │               │                │<───────────────────────────────────│
 │               │                │  Generate       │                  │
 │               │                │  prefill link   │                  │
 │               │  Calendar link │                 │                  │
 │               │<───────────────│                 │                  │
 │  Click link → │                │                 │                  │
 │  tự tạo event │                │                 │                  │
 │  trên GCal    │                │                 │                  │
 │<──────────────│                │                 │                  │
```

---

## 12. Implementation Steps

### Phase 1: MVP (Week 1-2)

| Step | Task | Detail |
|------|------|--------|
| 1 | **Project scaffold** | Monorepo: `/frontend` (React+Vite) + `/backend` (Express+TS) |
| 2 | **Room config** | Tạo `rooms.json`, load vào backend |
| 3 | **Google Calendar Service** | Fetch public .ics links, parse bằng `node-ical`, cache 2 phút |
| 4 | **AI Service** | OpenAI API integration, system prompt, intent parsing |
| 5 | **Auth** | Demo login form FE + JWT BE, email check "apero" |
| 6 | **Chat API** | `POST /api/chat` - full flow: parse → check → rank → respond |
| 7 | **Book API** | `POST /api/book` - re-check + create event |
| 8 | **Chat UI** | Chat bubbles, input, typing indicator |
| 9 | **Room Cards** | Suggestion cards trong chat |
| 10 | **Confirmation** | Confirm dialog + success/error states |
| 11 | **Testing** | Manual test full flow với real Google Calendars |
| 12 | **Deploy** | Deploy BE (Render/Railway) + FE (Vercel/Netlify) |

### Phase 2: Enhancements (Week 3-4)

| Step | Task |
|------|------|
| 13 | Voice input (Web Speech API) |
| 14 | Cancel/modify booking trong app |
| 15 | Recurring meeting support |
| 16 | Room usage analytics dashboard |
| 17 | Slack integration (notify khi book thành công) |

---

## 13. Decision Log

| # | Decision | Alternatives Considered | Objections | Resolution |
|---|----------|------------------------|------------|------------|
| D1 | Web app thay vì browser extension | Browser extension, mobile app | Extension hạn chế UX, mobile app tốn thời gian dev | Web app responsive covers all devices |
| D2 | Fetch public .ics link (không cần API key) | Service account, API key, OAuth | Zero setup cost, chỉ cần calendar public | Fetch .ics → parse bằng node-ical → check trống/bận |
| D3 | Room config trong .env (ROOM_N_LINK/NAME/MAX) | JSON file, database | Env đơn giản, phù hợp demo | Thêm phòng = thêm 3 dòng env, restart server |
| D4 | OpenAI GPT-4o-mini cho AI | Claude Haiku, local LLM, regex parser | Cost concern, latency | GPT-4o-mini đủ cho intent parsing, ~$0.01/request, fast, user có sẵn API key |
| D5 | In-memory cache thay vì Redis | Redis, no cache | Single server = no shared cache needed | node-cache đủ cho MVP, migrate Redis nếu scale |
| D6 | MVP text-only, voice ở Phase 2 | Voice from day 1 | Voice tiếng Việt accuracy concerns | Giảm scope MVP, validate core flow trước |
| D7 | Re-check trước khi book (double-check pattern) | Optimistic booking, distributed lock | Thêm 1 API call / booking | Cần thiết để tránh race condition, latency acceptable |
| D8 | Demo auth (email check "apero") thay vì OAuth | Google OAuth, LDAP, SSO | Demo không cần auth phức tạp | Chỉ cần check email chứa "apero", password bất kỳ. Đủ cho demo/presentation |
| D9 | Fetch .ics + node-ical parse | Google Calendar API + API key | Không cần tạo Google Cloud project, zero cost | Fetch parallel tất cả rooms, cache parsed data 2 phút |
| D10 | Monorepo (FE+BE cùng repo) | Separate repos | Coupling concern | Internal tool, team nhỏ, deploy riêng nhưng dev chung |

---

## Appendix A: Google Calendar Public Setup

1. Với mỗi room calendar:
   - Mở Google Calendar settings → "Access permissions"
   - Check **"Make available to public"**
2. Lấy iCal link:
   - Settings → "Integrate calendar" → copy **"Public address in iCal format"**
   - Dạng: `https://calendar.google.com/calendar/ical/{calendarId}/public/basic.ics`
3. Thêm vào `.env`:
   ```
   ROOM_1_LINK=https://calendar.google.com/calendar/ical/xxx/public/basic.ics
   ROOM_1_NAME=France
   ROOM_1_MAX=3
   ```

> **Không cần** Google Cloud Project, API Key, hay Service Account. Chỉ cần calendar public là đủ.

## Appendix B: AI System Prompt Template

```
Bạn là trợ lý đặt phòng họp thông minh tại công ty Apero.
Ngày hôm nay: {{current_date}}
Giờ hiện tại: {{current_time}} (GMT+7)

Danh sách phòng họp:
{{rooms_list}}

RULES:
1. Luôn trả lời bằng tiếng Việt, thân thiện.
2. Khi user muốn đặt phòng, extract thông tin sau:
   - numberOfPeople (số người tham gia)
   - date (ngày họp, format YYYY-MM-DD)
   - startTime (giờ bắt đầu, format HH:mm)
   - duration (thời lượng phút, mặc định 60)
3. Nếu thiếu startTime hoặc date → hỏi lại.
4. Nếu thiếu numberOfPeople → vẫn tìm, không filter capacity.
5. Nếu thiếu duration → mặc định 60 phút.
6. Trả về JSON format cho system parse.

OUTPUT FORMAT (khi đủ thông tin):
{"action": "search", "params": {"numberOfPeople": N, "date": "YYYY-MM-DD", "startTime": "HH:mm", "duration": M}}

OUTPUT FORMAT (khi thiếu thông tin):
{"action": "clarify", "message": "Câu hỏi cho user..."}

OUTPUT FORMAT (câu hỏi chung):
{"action": "info", "message": "Câu trả lời..."}
```
