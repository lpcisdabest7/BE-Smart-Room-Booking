# Context Snapshot: mobile-api-integration-docs

- Task statement: Check backend hiện tại và tạo docs tích hợp API để dùng cho AI ghép app mobile.
- Desired outcome: 1 bộ tài liệu API integration-ready, mô tả endpoint, auth, payload, response, lỗi và flow tích hợp mobile.
- Stated solution: Rà code backend thực tế (`src/routes`, `src/middleware/auth.ts`, `src/services/public-api.service.ts`) rồi xuất docs chuẩn.
- Probable intent hypothesis: User muốn giảm sai lệch khi dùng AI generate code mobile bằng một nguồn contract API đáng tin cậy từ code thật.

## Known Facts / Evidence
- Backend dùng Express, base prefix `/api`.
- Auth bằng JWT Bearer, token sống 24h từ `POST /api/auth/login`.
- Mobile-facing routes chính: `auth`, `rooms`, `book`, `bookings`, `chat`, `sync`, `health`.
- Có webhook `POST /api/integrations/recall/webhook` dành cho server-to-server.
- Public response shape được chuẩn hóa bởi `formatPublicRoom` và `formatPublicBooking`.

## Constraints
- Không đổi behavior backend trong task này.
- Không thêm dependency mới.
- Docs phải bám đúng contract code hiện tại.

## Unknowns / Open Questions
- Mobile stack target cụ thể (Flutter, React Native, native) chưa được chỉ định.
- Mức độ dùng endpoint `/api/chat` (full AI flow hay chỉ booking truyền thống) chưa được chốt.

## Decision-Boundary Unknowns
- Mặc định OMX tự quyết định format docs markdown + ví dụ JSON theo contract hiện tại.
- Nếu cần thay đổi backend contract, phải tách task khác.

## Likely Codebase Touchpoints
- `src/app.ts`
- `src/routes/*.ts`
- `src/middleware/auth.ts`
- `src/services/public-api.service.ts`
- `src/services/sync-status.service.ts`
