---
phase: testing
title: Testing Strategy
description: Define testing approach, test cases, and quality assurance
---

# Testing Strategy

## Test Coverage Goals
**What level of testing do we aim for?**

- Unit: ưu tiên parser weekday + intent + clarify.
- Integration: xác nhận `/chat` vẫn xử lý đúng action cũ.

## Unit Tests
**What individual components need testing?**

### ai.service.ts
- [ ] Test case 1: parse `thứ 5` -> đúng weekday/date theo UTC+7.
- [ ] Test case 2: parse `thứ năm tuần sau` -> cộng đúng tuần.
- [ ] Test case 3: parse `thursday` -> đúng weekday/date.
- [ ] Test case 4: câu recommendation thiếu ngày/giờ -> `clarify` + suggestion snippet.
- [ ] Test case 5: booking intent có cả từ search -> vẫn ưu tiên `book`.

## Integration Tests
**How do we test component interactions?**

- [ ] `/chat` với action `search` giữ schema cũ.
- [ ] `/chat` với action `book` giữ schema cũ.
- [ ] `/chat` với fallback clarify không làm lỗi route.

## End-to-End Tests
**What user flows need validation?**

- [ ] User flow 1: “Đặt phòng thứ 5 lúc 9h” không bị chuyển sang ngày khác.
- [ ] User flow 2: “Gợi ý phòng họp cho 8 người” có gợi ý đúng trọng tâm.

## Test Reporting & Coverage
**How do we verify and communicate test results?**

- Đã chạy: `npm run build` (compile pass).
- Chưa có test harness tự động trong repo tại thời điểm cập nhật.

## Manual Testing
**What requires human validation?**

- Kiểm tra sample prompts tiếng Việt có dấu/không dấu cho weekday.
- Kiểm tra chất lượng message trả về không lan man, hỏi đúng field thiếu.
