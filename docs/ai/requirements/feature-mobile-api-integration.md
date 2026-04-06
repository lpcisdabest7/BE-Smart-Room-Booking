---
phase: requirements
title: Requirements & Problem Understanding
description: Clarify the problem space, gather requirements, and define success criteria
---

# Requirements & Problem Understanding

## Problem Statement
**What problem are we solving?**

- Project hiện có đầy đủ API cho auth, room catalog, booking, chat, sync và webhook integration, nhưng contract chưa được chuẩn hóa thành một tài liệu handoff.
- Khi người tích hợp phải tự đọc source để đoán payload, nullable fields, status code hoặc auth flow, xác suất ghép sai rất cao, đặc biệt với mobile app và AI-generated client.
- Mục tiêu của task này là biến toàn bộ API surface dưới `/api` thành tài liệu có thể dùng ngay cho đội mobile, frontend, QA hoặc integration consumer khác.

## Goals & Objectives
**What do we want to achieve?**

- Primary goals
- Bao phủ đầy đủ tất cả endpoint hiện được mount trong `src/app.ts`.
- Tách rõ endpoint nào dành cho app client và endpoint nào chỉ là server-to-server reference.
- Ghi rõ auth requirement, query/body contract, response schema, status code và ví dụ JSON sát code hiện tại.
- Chỉ ra những điểm dễ sai khi tích hợp: timezone hiển thị, field nullable, legacy endpoint, chat response theo union type.
- Secondary goals
- Tạo checklist tích hợp nhanh để bên khác có thể tự ghép mà không cần hỏi lại BE team.
- Tạo checklist smoke test/manual verification sau khi consumer hoàn thành integration.
- Làm đầu vào tốt cho AI/mobile code generation.
- Non-goals (what's explicitly out of scope)
- Không thay đổi logic backend, không thêm endpoint mới.
- Không thiết kế API versioning mới.
- Không triển khai SDK/mobile app/client code trong task này.

## User Stories & Use Cases
**How will users interact with the solution?**

- As a mobile developer, I want one canonical API reference so that I can build models, services và error handling mà không reverse-engineer source.
- As a frontend/QA engineer, I want request/response examples and smoke flows so that I can test integration độc lập với BE team.
- As an AI coding assistant, I want precise schema and enum values so that generated client code đúng ngay ở lần đầu.
- Key workflows
- Login để lấy JWT và gắn Bearer token cho mọi protected endpoint.
- Lấy danh sách phòng và room detail để hiển thị availability.
- Tạo booking, xem booking của user, xem chi tiết booking, hủy booking.
- Gọi chat API để tìm phòng, xem lịch, hoặc lấy booking summary.
- Đọc health/sync endpoint cho diagnostics hoặc admin/debug UI.
- Tham chiếu webhook integration contract để phân biệt rõ endpoint nội bộ và endpoint consumer-facing.

## Success Criteria
**How will we know when we're done?**

- Có bộ docs `feature-mobile-api-integration` hoàn chỉnh trong `docs/ai/{requirements,design,planning,implementation,testing}`.
- Implementation doc bao phủ toàn bộ endpoint hiện có trong project BE:
  - `GET /api/health`
  - `POST /api/auth/login`
  - `GET /api/rooms`
  - `GET /api/rooms/:roomId`
  - `POST /api/book`
  - `GET /api/bookings`
  - `GET /api/bookings/:bookingId`
  - `POST /api/bookings`
  - `POST /api/bookings/:bookingId/cancel`
  - `POST /api/chat`
  - `GET /api/sync/status`
  - `POST /api/integrations/recall/webhook`
- Có shared schema đủ chi tiết để bên khác map model/parser mà không đoán kiểu dữ liệu.
- Có error/status matrix và integration checklist đủ để tự verify luồng chính.
- `apero prompt-kit lint` pass cho cấu trúc docs nếu command khả dụng trong môi trường.

## Constraints & Assumptions
**What limitations do we need to work within?**

- Technical constraints
- Source of truth phải lấy từ code hiện tại trong `src/app.ts`, `src/routes/*.ts`, `src/middleware/auth.ts`, `src/services/public-api.service.ts`, `src/services/booking.service.ts`, `src/services/room-status.service.ts`, `src/services/sync-status.service.ts`.
- Không thêm dependencies, không sửa runtime code, không thay đổi database schema.
- Business constraints
- Tài liệu phải ưu tiên tính thực dụng cho integration thay vì viết ở mức kiến trúc chung chung.
- Phải phân loại rõ mobile/app-consumable vs server-to-server.
- Assumptions we're making
- Consumer chính vẫn là mobile/client app, nhưng tài liệu cần đủ rõ để team khác tự đọc và tích hợp.
- Người tích hợp có thể gửi/nhận JSON và tự quản lý Bearer token.
- Webhook Recall là tài liệu tham chiếu vận hành, không phải endpoint mobile gọi trực tiếp.

## Questions & Open Items
**What do we still need to clarify?**

- Có cần thêm tài liệu client-specific sau bước này hay không, ví dụ Flutter/React Native snippets.
- Có muốn public API versioning (`/api/v1`) ở roadmap sau này hay tiếp tục giữ prefix `/api`.
- Có muốn tách docs thành public-consumer docs và ops/integration docs ở bước tiếp theo hay giữ một tài liệu tổng hợp.
