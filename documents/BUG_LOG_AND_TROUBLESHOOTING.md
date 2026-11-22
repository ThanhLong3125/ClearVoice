# ClearVoice -- Bug Log & Troubleshooting Guide 🛠️

> **Tài liệu tổng hợp các lỗi kỹ thuật thực tế đã được kiểm chứng bằng Chromium Headless Probe trong quá trình xây dựng ClearVoice, phân tích nguyên nhân gốc rễ (Root Cause), cách phát hiện (Detection) và giải pháp xử lý (Resolution).**

---

## 📑 Bảng Tra Cứu Nhanh Lỗi Kỹ Thuật

| Mã Bug | Triệu chứng | Nguyên nhân gốc rễ (Đã kiểm chứng) | Cách xử lý | Trạng thái |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | TypeScript báo lỗi biên dịch tại `getMediaStreamId` | API `chrome.tabCapture` dùng callback, không trả về Promise | Wrap callback vào `new Promise<string>` | ✅ Đã sửa |
| **BUG-002** | Bị chặn CORS/CSP khi tải mô hình từ Hugging Face & AWS CDN | Hugging Face redirect (HTTP 302/307) sang các domain CDN đa cấp | Khai báo `host_permissions: ["<all_urls>"]` và `connect-src *` trong `manifest.json` | ✅ Đã sửa |
| **BUG-003** | Mở lại Popup thì trạng thái bị reset về mặc định | Popup là ephemeral context, bị hủy mỗi khi đóng | Lưu `lastModelStatus` và `lastTranscript` trong Service Worker, trả về qua `GET_STATUS` | ✅ Đã sửa |
| **BUG-004** | Lỗi `Unsupported device: "cpu". Should be one of: webgpu, wasm.` | `@huggingface/transformers` v4.3.2 trên trình duyệt chỉ nhận `device: "wasm"` hoặc `"webgpu"` | Đặt `device: "wasm"` trong `pipeline()` | ✅ Đã sửa |
| **BUG-005** | Lỗi `SharedArrayBuffer is not defined` trong Extension | Extension pages không có COOP/COEP headers cho WASM đa luồng | Cấu hình `numThreads = 1` và `proxy = false` cho ONNX Runtime | ✅ Đã sửa |
| **BUG-006** | Lỗi `no available backend found` do CSP chặn nạp `.mjs` từ CDN hoặc thiếu `.mjs` local | ONNX Runtime dùng `import()` nạp `ort-wasm-simd-threaded.asyncify.mjs`; MV3 `script-src 'self'` chặn CDN và `public/wasm/` thiếu file `.mjs` | Copy cặp `.mjs` + `.wasm` vào `public/wasm/`, tắt `env.useWasmCache = false` và cấu hình `wasmPaths` object trỏ tới local extension URL | ✅ Đã sửa |
| **BUG-007** | Không bật nhạc mà Hàng đợi Queue vẫn bị dâng lên `5/5` | Âm thanh im lặng (Silence) trong PCM là chuỗi số 0 liên tục | Tích hợp bộ lọc năng lượng `EnergyVad` chặn chunk im lặng | ✅ Đã sửa |
| **BUG-008** | Chunk âm thanh bị rơi mất khi AI đang bận suy luận | Gọi inference trực tiếp trong event `onChunkReady` gây race condition | Xây dựng vòng lặp tiêu thụ độc lập `runAsrConsumerLoop()` (FIFO) | ✅ Đã sửa |
| **BUG-009** | Nhận diện tiếng Việt bị chậm hoặc sai ngôn ngữ | Không chỉ định ngôn ngữ khiến Whisper phải chạy bước đoán ngôn ngữ | Thêm dropdown chọn ngôn ngữ, truyền trực tiếp `language: "vietnamese"` | ✅ Đã sửa |
| **BUG-010** | Content Script (`content.js`) không chạy, không hiện phụ đề hay badge trên trang | Vite tách `messages.ts` thành shared ES module chunk khiến `dist/content.js` có câu lệnh `import`, nhưng Chrome chạy content script ở chế độ classic script | Chuyển `MessageType` sang `const enum` để inline hoàn toàn lúc compile và thêm chốt chống inject trùng lặp | ✅ Đã sửa |
| **BUG-011** | Giao diện Popup che mất lỗi khởi tạo AI, kẹt mãi ở dòng `Tải ... (0%)` | `pipeline()` tải nhiều file song song (`Promise.all`); khi model ném lỗi, các file config vẫn bắn sự kiện `loading` ghi đè trạng thái `error` | Chặn mọi sự kiện progress khi `state !== "loading"` và cho phép retry khi khởi tạo thất bại | ✅ Đã sửa |

---

## 🔍 Phân Tích Kỹ Thuật Chi Tiết Các Lỗi Cốt Lõi

### 1. BUG-004 & BUG-006: Khởi tạo ONNX Runtime Web (WASM) trong Chrome Extension Manifest V3
* **Triệu chứng:** Quá trình nạp model thất bại ngay lập tức tại bước tạo `InferenceSession`.
* **Nguyên nhân gốc rễ (Xác nhận qua Chromium 158 Headless Probe):**
  1. Dự án sử dụng `@huggingface/transformers` **v4.3.2** (kèm `onnxruntime-web` `1.31.0-dev`). Trên môi trường Web, tham số `device` hợp lệ là `"wasm"` hoặc `"webgpu"`. Truyền `device: "cpu"` gây ngoại lệ `Unsupported device: "cpu". Should be one of: webgpu, wasm.`.
  2. Để khởi tạo backend WASM, ONNX Runtime Web bắt buộc phải nạp **2 tệp**: tệp binary `ort-wasm-simd-threaded.asyncify.wasm` (qua `fetch`) và tệp glue module `ort-wasm-simd-threaded.asyncify.mjs` (qua dynamic `import()`).
  3. Mặc định, thư viện trỏ `wasmPaths` tới `https://cdn.jsdelivr.net/...`. Chính sách bảo mật Manifest V3 (`script-src 'self' 'wasm-unsafe-eval'`) cấm tuyệt đối việc `import()` script từ CDN bên ngoài (`connect-src *` chỉ có tác dụng với `fetch`/`XHR`, không có tác dụng với `script-src`).
  4. Khi trỏ về thư mục nội bộ `public/wasm/`, thư mục này trước đó chỉ chứa các tệp `.wasm` mà thiếu các tệp `.mjs`, đồng thời `chrome.runtime.getURL("wasm/") + "/"` sinh ra đường dẫn thừa dấu gạch chéo (`wasm//`), dẫn tới `net::ERR_FILE_NOT_FOUND`.
* **Cách xử lý:**
  1. Sao chép đầy đủ cả `.mjs` và `.wasm` từ `node_modules/onnxruntime-web/dist/` vào `public/wasm/`.
  2. Đặt `env.useWasmCache = false` (tránh việc tạo `blob:` URL cho `.mjs`) và cấu hình trực tiếp:
     ```typescript
     env.backends.onnx.wasm.wasmPaths = {
       mjs: chrome.runtime.getURL("wasm/ort-wasm-simd-threaded.asyncify.mjs"),
       wasm: chrome.runtime.getURL("wasm/ort-wasm-simd-threaded.asyncify.wasm"),
     };
     ```
  3. Khởi tạo pipeline với `device: "wasm"`, `dtype: "q4"` (tổng dung lượng thực tế ~96MB gồm encoder ~9MB và decoder_merged ~86.7MB).

---

### 2. BUG-010: Lỗi `SyntaxError: Cannot use import statement outside a module` trong Content Script
* **Triệu chứng:** Không có khung phụ đề hoặc biểu tượng âm lượng nào xuất hiện trên trang YouTube dù luồng thu âm vẫn hoạt động.
* **Nguyên nhân gốc rễ:**
  - Khi nhiều entry (`popup`, `offscreen`, `background`, `content`) cùng import `enum MessageType` từ `src/types/messages.ts`, Rollup/Vite tách `messages.ts` thành một shared chunk (`assets/messages-[hash].js`) và chèn câu lệnh `import { M as o } from "./assets/messages-..."` ở đầu `dist/content.js`.
  - Chrome thực thi `content_scripts` dưới dạng **classic script** (không phải ES module), dẫn đến lỗi cú pháp ngay dòng đầu tiên của `content.js`.
* **Cách xử lý:**
  - Khai báo `export const enum MessageType` trong `src/types/messages.ts` để trình biên dịch TypeScript/Vite inline toàn bộ hằng số chuỗi ngay tại thời điểm build. Kết quả `dist/content.js` trở thành một tệp độc lập hoàn toàn (0 câu lệnh `import`).
  - Bổ sung cờ bảo vệ `window.__clearVoiceOverlayLoaded` trong `src/content/overlay.ts` để đảm bảo không bị nhân đôi sự kiện khi `service-worker.ts` gọi `chrome.scripting.executeScript`.

---

### 3. BUG-011: Hiện tượng Race Condition trong `progress_callback` che khuất lỗi khởi tạo AI
* **Triệu chứng:** Giao diện Popup hiển thị `Tải generation_config.json (0%)` hoặc `Tải tokenizer_config.json (100%)` và đứng yên thay vì hiển thị thông báo lỗi đỏ.
* **Nguyên nhân gốc rễ:**
  - Hàm `pipeline()` của Transformers.js tải song song các tệp JSON cấu hình và tệp trọng số ONNX qua `Promise.all()`.
  - Khi nhánh nạp mô hình ONNX ném lỗi và chuyển trạng thái sang `"error"`, các nhánh tải tệp JSON nhỏ vẫn tiếp tục hoàn tất và gọi `progress_callback`, gửi bản tin `MODEL_STATUS: { status: "loading" }` đè lên trạng thái `"error"` trước đó.
* **Cách xử lý:**
  - Kiểm tra chặt điều kiện `if (this.state !== "loading" || typeof data.progress !== "number") return;` trước khi phát sự kiện tiến trình.
  - Tại `service-worker.ts` và `offscreen.ts`, chặn các bản tin `loading` trễ nếu trạng thái đã chuyển sang `error`, đồng thời cho phép tự động khởi tạo lại (`retry`) ở lần bấm thu âm tiếp theo.
