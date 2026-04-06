---
phase: testing
title: Testing Strategy
description: Define testing approach, test cases, and quality assurance
---

# Testing Strategy

## Test Coverage Goals
**What level of testing do we aim for?**

- Mục tiêu chính của task này là correctness của tài liệu so với code hiện tại, không phải coverage của runtime feature mới.
- Cần verify ba lớp:
- Endpoint inventory khớp route mount thật.
- Shared schema trong docs khớp DTO formatter và route output.
- Smoke flow mô tả trong docs có thể được team khác thực hiện lại mà không phải đoán contract.

## Unit Tests
**What individual components need testing?**

### Documentation consistency checks

- [x] Kiểm tra `src/app.ts` để xác nhận toàn bộ endpoint prefix xuất hiện trong docs.
- [x] Kiểm tra `src/routes/*.ts` để xác nhận method/path/auth requirement.
- [x] Kiểm tra `src/middleware/auth.ts` để xác nhận `401` behavior và Bearer format.
- [x] Kiểm tra `src/services/public-api.service.ts` để xác nhận field của `PublicRoom` và `PublicBooking`.
- [x] Kiểm tra `src/routes/chat.ts` để xác nhận đầy đủ response union `clarify/info/list_rooms/rooms_available/no_availability/history_summary`.
- [x] Kiểm tra `src/services/sync-status.service.ts` để xác nhận `SyncStatusView` schema.

## Integration Tests
**How do we test component interactions?**

### Required contract validations

- [x] `POST /api/bookings` và `POST /api/book` có cùng business rules, khác response success envelope.
- [x] `GET /api/bookings` chỉ hỗ trợ `scope=mine`.
- [x] `GET /api/bookings/:bookingId` và cancel endpoint chỉ nhìn thấy booking thuộc user trong JWT.
- [x] `POST /api/chat` không trực tiếp tạo booking, chỉ trả suggestion/summary payload.
- [x] `POST /api/integrations/recall/webhook` được phân loại là server-to-server reference, không phải mobile API.

### Command-level verification

- [x] Chạy `apero prompt-kit lint` để xác nhận docs structure nếu command tồn tại trong môi trường.
- [x] Chạy `npm run build` để xác nhận repo build vẫn ổn sau thay đổi tài liệu.
- [ ] Chưa có automated API test suite trong repo để replay contract ở runtime.

## End-to-End Tests
**What user flows need validation?**

### Smoke flow 1: login + rooms

1. Gọi `POST /api/auth/login` với email hợp lệ.
2. Lấy `token` từ response.
3. Gọi `GET /api/rooms` với `Authorization: Bearer <token>`.
4. Xác minh response có `rooms[]` và mỗi room có `id`, `name`, `capacity`, `timezone`, `liveStatus`.

### Smoke flow 2: create + list + detail booking

1. Dùng token hợp lệ gọi `POST /api/bookings` với slot trong tương lai.
2. Xác minh response `201` và `booking.status = confirmed`.
3. Gọi `GET /api/bookings` và xác minh booking mới xuất hiện.
4. Gọi `GET /api/bookings/:bookingId` và xác minh detail trả đúng booking.

### Smoke flow 3: cancel booking

1. Dùng `bookingId` vừa tạo gọi `POST /api/bookings/:bookingId/cancel`.
2. Xác minh response `200` và `booking.status = cancelled`.
3. Gọi lại `GET /api/bookings/:bookingId` để xác minh status đã đổi.

### Smoke flow 4: chat intent parsing

1. Gọi `POST /api/chat` với message tìm phòng.
2. Xác minh response có `type` machine-readable.
3. Nếu `type=rooms_available`, xác minh có `searchParams` và `rooms[]`.
4. Nếu `type=no_availability`, xác minh có `alternatives[]`.
5. Nếu `type=history_summary`, xác minh `bookings[]` parse được an toàn.

## Test Data
**What data do we use for testing?**

- Email hợp lệ bất kỳ có chứa `@`, ví dụ `member@apero.vn`.
- `roomId` thật từ seed config, ví dụ `room-1`, `room-2`, `room-3` trong local setup mẫu.
- Slot thời gian tương lai, tránh xung đột với projection hiện có.
- Message chat đại diện:
- `Tìm phòng 6 người lúc 3 giờ chiều mai`
- `Tôi có booking nào không?`
- `Lịch phòng Japan tháng 4/2026`

## Test Reporting & Coverage
**How do we verify and communicate test results?**

- Báo cáo verification nên ghi rõ:
- Command đã chạy (`apero prompt-kit lint`, `npm run build` nếu khả dụng).
- Inventory đã đối chiếu (`src/app.ts`, `src/routes/*.ts`).
- Gaps còn lại, đặc biệt là runtime API test chưa có automation.
- Nếu command không tồn tại trong môi trường, phải ghi rõ là verification bị giới hạn bởi tool availability.

## Manual Testing
**What requires human validation?**

- Đối chiếu ví dụ JSON với response thật từ môi trường dev/staging.
- Kiểm tra client parser handle đúng các field nullable.
- Kiểm tra UI render theo `chat.type` thay vì parse free-text message.
- Kiểm tra hiển thị timezone đúng với `date/startTime/endTime` và không lệch so với `startAt/endAt`.

## Performance Testing
**How do we validate performance?**

- Không có thay đổi runtime code, nên không cần benchmark mới cho task tài liệu.
- Nếu consumer thấy chậm, ưu tiên đo `GET /api/bookings` và `POST /api/chat` vì hai route này có bước reconcile/AI processing.

## Bug Tracking
**How do we manage issues?**

- Nếu runtime response lệch docs, code là source of truth trong ngắn hạn; cần cập nhật docs ngay sau khi xác nhận.
- Track riêng các mismatch sau:
- Thiếu field nullable trong parser client.
- Timezone hiển thị sai do consumer bỏ qua `startAt/endAt`.
- Chat consumer giả định response shape cố định thay vì switch theo `type`.
