---
phase: requirements
title: Requirements & Problem Understanding
description: Clarify the problem space, gather requirements, and define success criteria
---

# Requirements & Problem Understanding

## Problem Statement
**What problem are we solving?**

- AI booking bot đang trả lời thiếu trọng tâm trong một số câu hỏi booking room.
- Lỗi tiêu biểu: người dùng yêu cầu theo `thứ 5` nhưng bot có thể gợi ý `chủ nhật`.
- Với câu hỏi dạng “gợi ý phòng”, bot chưa đưa gợi ý cụ thể hoặc trả lời quá chung chung.

## Goals & Objectives
**What do we want to achieve?**

- Đảm bảo bot giữ đúng ngữ cảnh ngày/thứ mà người dùng yêu cầu.
- Tăng chất lượng trả lời cho intent gợi ý phòng (phải có gợi ý cụ thể).
- Giữ tương thích API/action hiện tại để không ảnh hưởng FE và route xử lý.

- Non-goals:
- Không thêm action mới ngoài `search|book|check_booking|check_room_schedule|list_rooms|clarify|info`.
- Không thay đổi contract response ở route `/chat`.

## User Stories & Use Cases
**How will users interact with the solution?**

- As a user, I want bot hiểu đúng “thứ năm/Thursday/thứ 5” để booking đúng ngày.
- As a user, I want khi hỏi gợi ý phòng, bot đưa phòng cụ thể thay vì trả lời mơ hồ.
- As a user, I want bot chỉ hỏi bổ sung phần còn thiếu (ngày hoặc giờ), không hỏi lan man.

- Edge cases:
- Câu có “tuần sau” phải dịch đúng sang tuần kế tiếp.
- Câu có weekday tiếng Việt dạng chữ (`thứ năm`) hoặc tiếng Anh (`thursday`) phải parse được.

## Success Criteria
**How will we know when we're done?**

- Bot không tự đổi sang thứ/ngày khác khi input đã nêu rõ weekday.
- Intent “gợi ý phòng” được route đúng vào luồng search/clarify với message có gợi ý.
- Build TypeScript pass sau thay đổi (`npm run build`).

## Constraints & Assumptions
**What limitations do we need to work within?**

- Technical constraints:
- Dựa trên parser regex + LLM coercion hiện có, không thay stack.
- Duy trì timezone logic UTC+7 như hiện tại.

- Business constraints:
- Hành vi phải ưu tiên đúng trọng tâm booking, tránh trả lời lan man.

- Assumptions:
- Danh sách phòng trong `config.rooms` là nguồn dữ liệu gợi ý hợp lệ.

## Questions & Open Items
**What do we still need to clarify?**

- Hiện chưa có test framework tự động cho parser, tạm xác thực bằng build + test thủ công.
