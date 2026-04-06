# Deep Interview Spec: mobile-api-integration-docs

## Metadata
- Profile: standard
- Rounds: 3
- Final ambiguity: 0.18
- Threshold: 0.20
- Context type: brownfield
- Context snapshot: `.omx/context/mobile-api-integration-docs-20260406T081720Z.md`
- Transcript: `.omx/interviews/mobile-api-integration-docs-20260406T081720Z.md`

## Intent (Why)
Tạo một tài liệu API integration đáng tin cậy từ code backend thực tế để AI có thể generate phần mobile client mà không lệch contract.

## Desired Outcome
Một bộ docs có thể đưa trực tiếp cho AI/mobile dev gồm:
- auth flow
- endpoint matrix
- request/response schema
- status/error mapping
- integration checklist cho mobile

## In-Scope
- Rà toàn bộ API public dưới `/api`.
- Ghi rõ endpoint dành cho mobile vs server-to-server.
- Chuẩn hóa ví dụ payload/response theo output formatter hiện tại.
- Đặt docs theo convention `docs/ai/*/feature-mobile-api-integration.md`.

## Out-of-Scope / Non-goals
- Không thay đổi code backend.
- Không triển khai app mobile trong task này.
- Không thay đổi auth mechanism/token lifecycle.

## Decision Boundaries (OMX can decide without further confirmation)
- Chọn cấu trúc markdown phù hợp cho AI codegen (table + JSON examples + checklist).
- Chọn endpoint chính ưu tiên dùng trên mobile (ví dụ `bookings` thay cho `book` legacy) nhưng vẫn document đầy đủ.
- Chọn naming docs theo `feature-mobile-api-integration`.

## Constraints
- No new dependencies.
- Diffs nhỏ, chỉ thêm docs/artifacts.
- Contract phải khớp code hiện tại trong `src/routes` và formatter public API.

## Testable Acceptance Criteria
- Có file `docs/ai/implementation/feature-mobile-api-integration.md` mô tả đầy đủ endpoint mobile-facing.
- Có mapping auth + error + status codes rõ ràng.
- Có ví dụ request/response khả dụng cho AI tạo mobile integration layer.
- `apero prompt-kit lint` pass sau khi cập nhật docs.

## Assumptions Exposed + Resolution
- Assumption: User cần full API docs, không chỉ booking.
  - Resolution: Chấp nhận, cover toàn bộ public API.
- Assumption: Webhook integrations không phải endpoint mobile call.
  - Resolution: Mark explicit server-to-server only.

## Pressure-pass Findings
- Revisited assumption: scope bao gồm integrations.
- Refinement: integrations được giữ trong docs như reference nhưng gắn nhãn non-mobile.

## Brownfield Evidence vs Inference
- Evidence-backed: route definitions, middleware auth, formatter public DTO.
- Inference: mobile stack cụ thể chưa chốt; docs giữ framework-agnostic.

## Handoff
- Chosen execution lane: `dev-lifecycle` (documentation-focused execution) với output chính ở phase implementation.
