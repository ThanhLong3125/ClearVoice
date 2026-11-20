# Changelog

Tất cả các thay đổi đáng chú ý của dự án **ClearVoice** sẽ được ghi chép tại tài liệu này.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) và dự án tuân thủ [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]
*Các thay đổi đang phát triển và chưa đóng gói thành phiên bản mới sẽ nằm ở đây.*

### Added
- Thiết lập pipeline GitHub Actions CI tự động kiểm tra Typecheck, Build và lưu trữ Artifact.
- Thêm tài liệu theo dõi `CHANGELOG.md`.

---

## [0.1.0] - 2026-11-19
### Added
- Khởi tạo kiến trúc Chrome Extension Manifest V3 với Vite và TypeScript.
- Tích hợp thu âm trực tiếp từ tab trình duyệt qua Chrome Offscreen Document và `chrome.tabCapture`.
- Tích hợp mô hình AI Whisper (ONNX Web / Transformers.js v3) chạy hoàn toàn cục bộ trên trình duyệt (Local-first).
- Xây dựng giao diện Popup theo dõi tiến trình tải mô hình, trạng thái kết nối và phụ đề thời gian thực.
- Tích hợp thuật toán Energy VAD (Voice Activity Detection) lọc bỏ âm thanh im lặng trước khi đưa vào hàng đợi suy luận.
