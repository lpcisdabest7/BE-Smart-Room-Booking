---
phase: planning
title: Project Planning & Task Breakdown
description: Break down work into actionable tasks and estimate timeline
---

# Project Planning & Task Breakdown

## Milestones
**What are the major checkpoints?**

- [x] Milestone 1: Inventory toàn bộ endpoint đang mount trong backend.
- [x] Milestone 2: Audit auth/error/DTO contract từ route + service.
- [x] Milestone 3: Viết API reference đủ cho handoff self-service.
- [x] Milestone 4: Thêm integration checklist và verification checklist.

## Task Breakdown
**What specific work needs to be done?**

### Phase 1: Inventory
- [x] Task 1.1: Đọc `src/app.ts` để chốt danh sách endpoint prefix.
- [x] Task 1.2: Đọc `src/routes/*.ts` để liệt kê path, method, auth requirement.
- [x] Task 1.3: Đánh dấu endpoint nào là app/mobile, endpoint nào là internal integration.

### Phase 2: Contract Extraction
- [x] Task 2.1: Trích xuất shared auth behavior từ `src/middleware/auth.ts`.
- [x] Task 2.2: Trích xuất canonical room/booking DTO từ `src/services/public-api.service.ts`.
- [x] Task 2.3: Trích xuất booking error/status mapping từ `src/services/booking.service.ts` và route handlers.
- [x] Task 2.4: Trích xuất chat response union và sync status contract.

### Phase 3: Documentation Output
- [x] Task 3.1: Viết requirements doc ở mức audience, scope, success criteria.
- [x] Task 3.2: Viết design doc mô tả kiến trúc API surface và schema chuẩn.
- [x] Task 3.3: Viết implementation doc làm API reference chính cho consumer.
- [x] Task 3.4: Viết testing doc cho smoke test và contract verification.

### Phase 4: Verification
- [x] Task 4.1: Chạy `apero prompt-kit lint` nếu command có trong môi trường.
- [x] Task 4.2: Chạy `npm run build` để bảo đảm thay đổi docs không đi kèm lỗi dự án đang tồn tại.
- [x] Task 4.3: Review diff/status để chắc docs bám đúng code source hiện hành.

## Dependencies
**What needs to happen in what order?**

- Route inventory phải hoàn tất trước khi viết endpoint matrix.
- DTO extraction phải hoàn tất trước khi chốt schema mẫu trong docs implementation.
- Verification chỉ có ý nghĩa sau khi toàn bộ docs đã được cập nhật.

## Timeline & Estimates
**When will things be done?**

- Inventory + contract extraction: ~30-40 phút.
- Viết API reference: ~45-60 phút.
- Verification và polish: ~10-20 phút.
- Tất cả nằm trong một phiên làm việc, không cần phụ thuộc team khác.

## Risks & Mitigation
**What could go wrong?**

- Technical risks
- Route/service contract đổi sau khi tài liệu đã được handoff.
- Chat response có nhiều nhánh và dễ bị tài liệu hóa thiếu field.
- Timezone display fields dễ bị hiểu nhầm là source of truth.
- Mitigation strategies
- Luôn coi code route/service là source of truth.
- Viết shared schema + notes cho field nullable/timezone.
- Tách rõ legacy endpoint và internal integration endpoint trong matrix.

## Resources Needed
**What do we need to succeed?**

- Quyền đọc đầy đủ source backend.
- Command-line verification cho docs/build nếu tool tồn tại.
- Không cần thêm dependency hay service ngoài để hoàn tất task tài liệu.
