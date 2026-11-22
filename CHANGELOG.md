# Changelog

Tất cả các thay đổi đáng chú ý của dự án **ClearVoice** sẽ được ghi chép tại tài liệu này.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) và dự án tuân thủ [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]
*Các thay đổi đang phát triển và chưa đóng gói thành phiên bản mới sẽ nằm ở đây.*

---

## [0.2.0] - 2026-11-23
### Added
- **Web Worker ASR Engine (`src/offscreen/asr-worker.ts`):** Tách toàn bộ quá trình tải mô hình, biên dịch WASM và suy luận Whisper sang luồng Web Worker riêng biệt, giải phóng 100% luồng giao diện chính (Main UI Thread) của Extension.
- **Tự động nhận diện đa ngôn ngữ 1 bước (`WhisperAutoLangLogitsProcessor`):** Can thiệp trực tiếp vào logits bước giải mã đầu tiên của Whisper để tự động nhận diện ngôn ngữ (`vi`, `en`, `zh`, `ja`, `ko`, `fr`, `de`, `es`, `ru`) trên từng đoạn âm thanh mà không cần người dùng chọn thủ công.
- **Cắt đoạn thông minh theo nhịp nghỉ câu & thung lũng năng lượng (`Dynamic VAD-Pause & Minimum-Energy Valley Chunker`):**
  - Tự động cắt chunk tại các khoảng ngắt hơi tự nhiên (`>= 260ms` im lặng sau `>= 1.2s` tiếng nói) với **0% chồng lấp (Zero Overlap)**.
  - Khi gặp câu nói nhanh liên tục đạt ngưỡng `3.2s`, tự động quét ngược `0.75s` cuối để tìm cửa sổ `32ms` có năng lượng RMS thấp nhất (ranh giới giữa hai âm tiết) để cắt, tránh cắt đứt ngang từ gây hiện tượng Whisper đoán mò/bịa chữ.
- **Hàng đợi thời gian thực Gộp câu ngắn & Xả bỏ mẫu trễ (`Coalesce & Drop-Stale Queue`):** Tự động gộp các cụm từ ngắn liên tiếp (tối đa `3.5s`) và loại bỏ ngay các chunk cũ quá hạn khi AI đang bận, triệt tiêu độ trễ tích lũy 2–3 câu.
- **Bộ lọc hậu xử lý chống lặp từ (`cleanHallucinatedText`):** Tự động loại bỏ các nhãn nhiễu âm thanh (`[Music]`, `(nhạc)`) và thu gọn các chuỗi từ bị lặp lại liên tiếp.
- **Khung xem trước Phụ đề trực tiếp (`Live ASR`) trong Popup & Tự động tiêm Content Script (`chrome.scripting.executeScript`).**
- Thiết lập pipeline GitHub Actions CI/CD tự động kiểm tra Typecheck, Build và phát hành Release.

### Fixed
- Sửa lỗi `Unsupported device: "cpu"` trên `@huggingface/transformers` v4.3.2 bằng cách chuyển sang `device: "wasm"` (**BUG-004**).
- Sửa lỗi CSP Manifest V3 chặn nạp tệp `.mjs` của ONNX Runtime từ CDN bằng cách đóng gói cặp tệp `ort-wasm-simd-threaded*.{mjs,wasm}` nội bộ trong `public/wasm/` (**BUG-006**).
- Sửa lỗi `SyntaxError: Cannot use import statement outside a module` trong `dist/content.js` giúp khung phụ đề nổi hoạt động ổn định trên mọi tab (**BUG-010**).
- Sửa lỗi Race Condition trong `progress_callback` ghi đè trạng thái lỗi khởi tạo AI (**BUG-011**).
- Khắc phục hiện tượng đơ/khựng giao diện Popup khi bấm vào biểu tượng tiện ích trong lúc AI đang suy luận (**BUG-012**).
- Khắc phục hiện tượng trễ phụ đề 2–3 câu và bịa chữ ở ranh giới chunk do cửa sổ trượt cố định chồng lấp 2 giây (**BUG-013**).

---

## [0.1.0] - 2026-11-19
### Added
- Khởi tạo kiến trúc Chrome Extension Manifest V3 với Vite và TypeScript.
- Tích hợp thu âm trực tiếp từ tab trình duyệt qua Chrome Offscreen Document và `chrome.tabCapture`.
- Tích hợp mô hình AI Whisper (ONNX Web / Transformers.js) chạy hoàn toàn cục bộ trên trình duyệt (Local-first).
- Xây dựng giao diện Popup theo dõi tiến trình tải mô hình, trạng thái kết nối và phụ đề thời gian thực.
- Tích hợp thuật toán Energy VAD (Voice Activity Detection) lọc bỏ âm thanh im lặng trước khi đưa vào hàng đợi suy luận.
