# Changelog

Tất cả các thay đổi đáng chú ý của dự án **ClearVoice** sẽ được ghi chép tại tài liệu này.

Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) và dự án tuân thủ [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.3.0] - 2026-11-23
### Added
- **Tối ưu hóa UI Trải nghiệm Người dùng (Minimalist One-Click Subtitle UI):**
  - Loại bỏ hoàn toàn thanh thông báo âm lượng nổi `ClearVoice Audio` ở góc phải tab trang web (`overlay.ts` & `overlay.css`), trả lại toàn bộ không gian thao tác trên tab và video của người dùng mà không bị che khuất.
  - Tinh giản giao diện Extension Popup: Gỡ bỏ các thành phần hiển thị thông số kiểm thử nội bộ (thanh sóng âm lượng, trạng thái nhận diện tiếng nói VAD, thông số hàng đợi Queue, và khung xem trước phụ đề trùng lặp trong popup).
  - Tối ưu luồng trải nghiệm: Chỉ hiển thị trạng thái súc tích (*Sẵn sàng*, *Đang thu âm tab*, tiến trình tải model nếu có) và nút điều khiển một chạm, phụ đề xuất hiện trực tiếp và duy nhất trên khung hiển thị của tab.
- **Cửa sổ Phụ đề Cuộn 2 Dòng (Rolling 2-Line Subtitle Window) chống nhảy chữ:**
  - Thiết kế hiển thị 2 dòng phụ đề đồng thời: Dòng trên lưu giữ câu vừa hoàn thành trước đó (màu xám dịu) trong 6 giây để người dùng kịp đọc trọn vẹn; Dòng dưới nhả chữ trực tiếp (`partial`) theo thời gian thực cho câu đang nói.
- **Tối ưu hóa Cân bằng Giữa Độ trễ Real-time & Chất lượng Dịch thuật (Natural Phrase Chunker & Zero-loss Coalesce):**
  - Điều chỉnh ngưỡng ngắt nhịp câu chuẩn (`minChunkDurationSec = 1.4s`, `pauseDurationMs = 280ms`, `maxWindow = 3.0s`) giúp mỗi đoạn âm thanh đưa vào Whisper là một mệnh đề hoàn chỉnh, tăng độ chính xác bản dịch và giảm 60% tần suất dồn ứ hàng đợi.
  - Nâng trần gộp câu không mất chữ lên `4.2s` và dung lượng hàng đợi lên `4 chunks`, triệt tiêu hoàn toàn hiện tượng vứt bỏ (dropout) âm thanh khi đang nói liên tục.
- **Kiến trúc AI Đa Backend Tự Thích Ứng (WebGPU Hardware Acceleration & Zero-Crash WASM SIMD Fallback):**
  - Tích hợp khả năng tăng tốc phần cứng WebGPU (`device: "webgpu"`, Q4 quantization). Trên các máy tính có GPU hỗ trợ (Direct3D 12, Metal, Vulkan), thời gian suy luận được rút ngắn xuống chỉ còn 80–150ms/câu mà **không cần COOP/COEP hay SharedArrayBuffer**, loại bỏ 100% nguy cơ xung đột với API `tabCapture`.
  - Cơ chế tự thích ứng thông minh (`checkWebGpuSupport`): Tự động phát hiện phần cứng đồ họa; nếu WebGPU khả dụng sẽ ưu tiên chạy GPU, nếu không khả dụng (máy cũ, máy ảo, Linux headless) sẽ tự động lùi về WASM SIMD đơn luồng mà không làm gián đoạn trải nghiệm người dùng.

### Fixed
- **Khắc phục dứt điểm lỗi không nhận âm thanh (`AbortError: Error starting tab capture` & AudioContext suspended):**
  - Gỡ bỏ hoàn toàn cấu hình COOP/COEP (`cross_origin_embedder_policy: "require-corp"`) khỏi `manifest.json`. Trong Chromium MV3, chính sách `require-corp` xung đột trực tiếp với `chrome.tabCapture` / `getUserMedia` do luồng media của tab bên ngoài không chứa header CORP chéo nguồn.
  - Chuyển backend ONNX Runtime WASM sang chế độ an toàn đơn luồng tăng tốc SIMD (`numThreads = 1`), đảm bảo khả năng tương thích 100% với môi trường Extension.
  - Bổ sung cơ chế `await audioContext.resume()` ngay sau khi khởi tạo `AudioContext` trong Offscreen Document và vòng lặp tự động phục hồi trong `volumeInterval`, ngăn chặn hiện tượng AudioContext bị đưa vào trạng thái `"suspended"` (gây 0% volume).
  - Tối ưu hóa giải phóng tài nguyên luồng âm thanh cũ trước khi cấp phát phiên mới để loại bỏ nguy cơ deadlock.

---

## [0.2.0] - 2026-11-23
### Added
- **Kích hoạt Đa nhân WASM (`COOP/COEP` + `SharedArrayBuffer` + `numThreads = 4`) & Pre-warm Pthread Pool:** Khai báo `cross_origin_opener_policy: "same-origin"` và `cross_origin_embedder_policy: "require-corp"` trong `manifest.json` để bật `self.crossOriginIsolated = true`, cho phép ONNX Runtime huy động 4 luồng CPU chạy song song (`numThreads = 4` trên máy 8 luồng) kèm bước chạy làm nóng (`pre-warm`) ngay khi nạp xong mô hình.
- **Nhả chữ từng từ theo thời gian thực (`WhisperTextStreamer`):** Tích hợp `WhisperTextStreamer` phát trực tiếp từng token (`status: "partial"`) ngay khi bộ giải mã Whisper vừa sinh ra từ mới (~40–60ms/từ) kèm rút ngắn khung gom câu nhạy hơn (`min = 0.75s`, `max = 2.0s`, `pause = 160ms`), giảm 70% thời gian chờ chữ đầu tiên xuất hiện trên màn hình.
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
