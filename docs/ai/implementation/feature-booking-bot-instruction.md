---
phase: implementation
title: Implementation Guide
description: Technical implementation notes, patterns, and code guidelines
---

# Implementation Guide

## Development Setup
**How do we get started?**

- Dùng môi trường Node/TypeScript hiện có trong repo.
- Chạy `npm run build` để xác thực compile sau khi sửa.

## Code Structure
**How is the code organized?**

- Tất cả thay đổi nằm trong `src/services/ai.service.ts`.
- Không đổi routes, types, hay contract response.

## Implementation Notes
**Key technical details to remember:**

### Core Features
- Feature 1: `resolveWeekday()` nhận diện weekday tiếng Việt dạng chữ và tiếng Anh.
- Feature 2: `hasSearchIntent()` nhận diện thêm nhóm câu gợi ý phòng.
- Feature 3: `parseCommonCommand()` trả `clarify` theo đúng field thiếu, có gợi ý nhanh khi intent recommendation.
- Feature 4: `buildSystemPrompt()` được viết lại với quy tắc cứng cho luồng booking.

### Patterns & Best Practices
- Prompt steering + code coercion cùng tồn tại để tăng độ tin cậy.
- Ưu tiên fail-safe (`clarify`) thay vì đoán ngày/giờ.

## Integration Points
**How do pieces connect?**

- `processChat` vẫn tạo `fallback` từ parser trước khi gọi OpenAI.
- `coerceAiResponse` tiếp tục normalize output từ model.

## Error Handling
**How do we handle failures?**

- Nếu model trả response không hợp lệ hoặc thiếu params bắt buộc, fallback sang parser/clarify.

## Performance Considerations
**How do we keep it fast?**

- Chỉ thêm regex/string processing cục bộ, không thêm network/database call.

## Security Notes
**What security measures are in place?**

- Không mở rộng phạm vi dữ liệu truy cập.
- Không thêm log dữ liệu nhạy cảm mới.
