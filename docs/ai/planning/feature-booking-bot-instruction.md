---
phase: planning
title: Project Planning & Task Breakdown
description: Break down work into actionable tasks and estimate timeline
---

# Project Planning & Task Breakdown

## Milestones
**What are the major checkpoints?**

- [x] Milestone 1: Hoàn tất requirement + design review cho booking prompt.
- [x] Milestone 2: Implement parser/prompt guardrails trong `ai.service.ts`.
- [ ] Milestone 3: Hoàn tất regression test tự động (khi có test harness).

## Task Breakdown
**What specific work needs to be done?**

### Phase 1: Foundation
- [x] Task 1.1: Review flow parse intent/date/time hiện tại.
- [x] Task 1.2: Chốt decision log qua multi-agent review.

### Phase 2: Core Features
- [x] Task 2.1: Mở rộng parse weekday (`thứ năm`, `thursday`, ...).
- [x] Task 2.2: Tăng chất lượng instruction trong `buildSystemPrompt()`.
- [x] Task 2.3: Mở rộng search/recommendation intent + clarify message tập trung.

### Phase 3: Integration & Polish
- [x] Task 3.1: Build compile verification (`npm run build`).
- [ ] Task 3.2: Bổ sung test tự động cho parser + intent precedence.

## Dependencies
**What needs to happen in what order?**

- Phải hoàn tất requirement/design trước khi sửa code.
- Parser mở rộng trước prompt tuning để có guardrail cứng.
- Build verification sau cùng để chốt tính hợp lệ TypeScript.

## Timeline & Estimates
**When will things be done?**

- Parser + prompt update: trong 1 lượt chỉnh sửa.
- Regression test tự động: phụ thuộc việc setup test framework.

## Risks & Mitigation
**What could go wrong?**

- Risk: regex intent mở rộng gây false positive.
- Mitigation: giữ pattern recommendation hẹp, ưu tiên `book` trước `search`.

- Risk: model vẫn trả lời lệch.
- Mitigation: tăng ràng buộc prompt + giữ coerce/fallback phía code.

## Resources Needed
**What do we need to succeed?**

- Code context `src/services/ai.service.ts`.
- Dữ liệu `config.rooms` để gợi ý phòng.
- Build pipeline TypeScript hiện tại.
