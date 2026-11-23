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
| **BUG-010** | Content Script (`content.js`) không chạy, không hiện phụ đề hay badge trên trang | Vite tách `messages.ts` thành shared ES module chunk khiến `dist/content.js` có câu lệnh `import`, nhưng Chrome chạy content script ở chế độ classic script | Loại bỏ runtime import trong `overlay.ts` và thêm chốt chống inject trùng lặp | ✅ Đã sửa |
| **BUG-011** | Giao diện Popup che mất lỗi khởi tạo AI, kẹt mãi ở dòng `Tải ... (0%)` | `pipeline()` tải nhiều file song song (`Promise.all`); khi model ném lỗi, các file config vẫn bắn sự kiện `loading` ghi đè trạng thái `error` | Chặn mọi sự kiện progress khi `state !== "loading"` và cho phép retry khi khởi tạo thất bại | ✅ Đã sửa |
| **BUG-012** | Giao diện Popup bị khựng/đơ khi bấm vào icon Extension lúc AI đang chạy & chọn Tiếng Anh vẫn dịch ra Tiếng Việt | `offscreen.html` và `popup/index.html` dùng chung Main UI Thread của Extension Process; `modeling_whisper.js` chưa cài đặt auto language detection | Tách toàn bộ Whisper WASM sang Web Worker (`asr-worker.ts`) và viết `WhisperAutoLangLogitsProcessor` tự nhận diện đa ngôn ngữ 1 bước | ✅ Đã sửa |
| **BUG-013** | Phụ đề bị trễ 2–3 câu so với video, turn đầu bịa chữ ở cuối câu rồi turn sau mới chuẩn | Cửa sổ trượt cố định (`window 3s, hop 1s`) cắt đứt ngang âm tiết và chồng lấp 2s (bắt AI dịch lặp 3 lần) kết hợp hàng đợi FIFO `5/5` | Thay bằng `Dynamic VAD-Pause & Minimum-Energy Valley Chunker` (0% chồng lấp, cắt tại điểm ngắt hơi/năng lượng cực tiểu) và hàng đợi `Coalesce & Drop-Stale` | ✅ Đã sửa |
| **BUG-014** | Tiện ích không nhận được âm thanh (`AbortError: Error starting tab capture` hoặc Volume Meter = 0%) | COEP `require-corp` trong `manifest.json` chặn quyền nạp luồng media từ tab khác vào Extension; AudioContext trong offscreen document bị rơi vào trạng thái `"suspended"` khi khởi tạo bất đồng bộ | Gỡ bỏ COOP/COEP khỏi `manifest.json` và bổ sung `audioContext.resume()` ngay sau khi khởi tạo cùng vòng lặp bảo vệ trong `volumeInterval` | ✅ Đã sửa |
| **BUG-015** | Đột ngột crash hoặc không thể khởi động AI khi gán cứng `device: "webgpu"` trên các môi trường thiếu GPU adapter (Linux headless, Docker, driver cũ) | API WebGPU (`navigator.gpu`) có thể trả về `undefined` hoặc `requestAdapter()` trả về `null` nếu trình duyệt không có phần cứng/driver đồ họa tương thích | Xây dựng cơ chế thăm dò và chuyển đổi thích ứng (`checkWebGpuSupport()`), ưu tiên WebGPU và tự động lùi về WASM SIMD (Zero-crash Adaptive Multi-Backend) | ✅ Đã sửa |

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

---

### 4. BUG-012: Nghẽn luồng giao diện chính (Main UI Thread Blocking) & Thiếu cơ chế Tự nhận diện ngôn ngữ trong Transformers.js v4
* **Triệu chứng:**
  1. Khi AI đang nạp mô hình hoặc đang dịch phụ đề, người dùng click vào biểu tượng ClearVoice trên thanh công cụ Chrome bị khựng/đơ từ 1–2 giây mới mở được Popup.
  2. Khi người dùng chọn ngôn ngữ `English`, hệ thống vẫn phiên âm ra Tiếng Việt; hoặc nếu bỏ trống `language`, thư viện mặc định ép về `'en'`.
* **Nguyên nhân gốc rễ:**
  1. Trong Chromium, mọi trang thuộc cùng một Extension Origin (`chrome-extension://<id>/...`, bao gồm `offscreen.html` và `popup/index.html`) chạy chung trong **cùng một tiến trình Renderer và chia sẻ chung Main UI Thread**. Khi ONNX Runtime Web chạy suy luận WASM trực tiếp trên luồng chính của `offscreen.html`, nó khóa cứng luồng giao diện của toàn bộ Extension trong suốt thời gian suy luận (500ms – 1500ms).
  2. Trong mã nguồn `@huggingface/transformers` v4 (`src/models/whisper/modeling_whisper.js`, hàm `_retrieve_init_tokens`), khi không truyền `language`, thư viện chưa cài đặt nhận diện ngôn ngữ tự động (`// TODO: Implement language detection`) mà gán cứng `language = 'en'`.
* **Cách xử lý:**
  1. **Tách AI sang Dedicated Web Worker (`src/offscreen/asr-worker.ts`):** Toàn bộ quá trình tải mô hình, khởi tạo session ONNX và suy luận WASM được đẩy sang luồng OS Worker độc lập. File `offscreen.js` trên luồng chính giảm từ 574 KB xuống chỉ còn **9.7 KB**, giúp giao diện Popup mở tức thì (< 16ms) ở mọi thời điểm.
  2. **Cài đặt `WhisperAutoLangLogitsProcessor` (`src/ai/asr-engine.ts`):** Khởi tạo giải mã từ token `[<|startoftranscript|>]` (`50258`) và dùng `LogitsProcessor` tại bước 1 để mạng cross-attention của Whisper tự động chọn token ngôn ngữ có xác suất cao nhất từ âm thanh (`<|vi|>`, `<|en|>`, `<|zh|>`, `<|ja|>`, `<|ko|>`, v.v.), sau đó ép `<|transcribe|>` ở bước 2 và `<|notimestamps|>` ở bước 3 ngay trong cùng một lượt chạy.

---

### 5. BUG-013: Trễ phụ đề dây chuyền 2–3 câu & Hiện tượng "Turn đầu bịa chữ, turn sau mới chuẩn"
* **Triệu chứng:** Khi nghe podcast hoặc hội thoại liên tục, phụ đề hiển thị chậm hơn tiếng nói thật từ 2 đến 3 câu (7–12 giây). Ngoài ra, ở cuối mỗi câu phụ đề thường xuất hiện chữ bịa/sai, phải đợi lượt cập nhật tiếp theo chữ đó mới chuẩn.
* **Nguyên nhân gốc rễ:**
  1. **Cắt đứt ngang âm tiết (Mid-word Slicing):** Bộ cắt `SlidingWindowChunker` cũ cắt cứng theo đồng hồ (`window = 3.0s`, `hop = 1.0s`). Khi vết cắt rơi trúng giữa một chữ đang phát âm dở (ví dụ `"phỏng v-"`), mô hình ngôn ngữ của Whisper sẽ tự suy diễn (hallucinate) để lấp đầy âm tiết bị cụt. Đến lượt tiếp theo (1 giây sau), nhờ có 2 giây chồng lấp nên chữ đó mới nằm trọn trong khung và được dịch đúng.
  2. **Chồng lấp 66% (2.0s Overlap) + Hàng đợi FIFO `5/5`:** Cứ 1 giây thực tế lại sinh ra 1 chunk dài 3 giây (bắt AI dịch đi dịch lại mỗi câu 3 lần). Tốc độ sinh chunk (1 chunk/1s) nhanh gấp đôi tốc độ giải mã của WASM (~2s/chunk), làm hàng đợi FIFO luôn đầy `5/5` và bắt AI luôn phải dịch các chunk cũ từ 5 bước trước.
* **Cách xử lý:**
  1. **Nâng cấp lên `Dynamic VAD-Pause & Minimum-Energy Valley Chunker` (`src/audio/chunker.ts`) với 0% chồng lấp:**
     - Quét năng lượng âm thanh theo từng khung `32ms` (`512 samples` @ 16kHz) và tự động cắt gọn khoảng lặng thừa trước khi người nói bắt đầu (chỉ giữ `160ms` pre-roll để không mất phụ âm đầu).
     - Ngay khi phát hiện người nói ngắt nhịp/lấy hơi tự nhiên (`>= 260ms` im lặng sau ít nhất `1.2s` tiếng nói), lập tức cắt thành một chunk câu hoàn chỉnh với **0% chồng lấp**.
     - Nếu người nói phát âm nhanh liên tục chạm ngưỡng `3.2s` mà không nghỉ, thuật toán tự động quét ngược `0.75s` cuối để tìm đúng khung `32ms` có **năng lượng RMS cực tiểu** (điểm chuyển tiếp giữa hai âm tiết) để đặt vết cắt, tuyệt đối không cắt ngang nguyên âm đang phát âm.
  2. **Cơ chế Hàng đợi `Coalesce & Drop-Stale` (`src/audio/pipeline.ts` & `src/audio/queue.ts`):**
     - Khi AI Worker vừa rảnh, nếu có 2 cụm từ ngắn đang chờ mà tổng thời lượng `<= 3.5s`, hệ thống tự động nối (`coalesce`) chúng thành 1 lần dịch duy nhất để không mất chữ mà vẫn bắt kịp thời gian thực.
     - Nếu tổng âm thanh chờ vượt quá `3.5s`, tự động xả bỏ (`drop-stale`) các chunk cũ quá hạn để phụ đề luôn bám sát câu đang nói hiện tại.

---

### 6. BUG-014: Luồng thu âm tab bị chặn bởi COEP (`require-corp`) và AudioContext bị treo (`suspended`)
* **Triệu chứng:** Người dùng bấm "Bắt đầu thu âm", nhưng thanh âm lượng hiển thị `0%`, không có âm thanh nào truyền đến bộ tách từ hay AI, và console xuất hiện lỗi `DOMException: AbortError: Error starting tab capture`.
* **Nguyên nhân gốc rễ:**
  1. Trong kiến trúc bảo mật Chromium Manifest V3, khi khai báo `cross_origin_embedder_policy: "require-corp"` trong `manifest.json` (nhằm kích hoạt `SharedArrayBuffer` cho WASM đa luồng), mọi tài nguyên nhúng chéo nguồn (cross-origin resources) đều bắt buộc phải có header `Cross-Origin-Resource-Policy: cross-origin`. Do luồng âm thanh tab (`chrome.tabCapture` / `getUserMedia`) bắt nguồn từ trang web bên ngoài (YouTube, podcast, v.v.) không mang header CORP này, Chromium chủ động từ chối cấp luồng media với mã ngoại lệ `AbortError: Error starting tab capture`.
  2. Ngoài ra, trong môi trường Offscreen Document, `new AudioContext()` được tạo bên trong trình lắng nghe tin nhắn (không gắn trực tiếp với thao tác click người dùng trên trang HTML đó), khiến cơ chế autoplay của trình duyệt đưa `AudioContext` về trạng thái `"suspended"`. Khi ở trạng thái `"suspended"`, AudioNode không xử lý buffer PCM, dẫn tới RMS = 0 (0% volume).
* **Cách xử lý:**
  1. **Gỡ bỏ hoàn toàn `cross_origin_opener_policy` và `cross_origin_embedder_policy` khỏi `manifest.json`:** ONNX Runtime Web hoạt động hoàn toàn ổn định và tốc độ cao ở chế độ đơn luồng tăng tốc SIMD (`numThreads = 1`, `device: "wasm"`), giải mã các chunk câu 1–2s trong ~350–500ms mà không hề gây xung đột với API `tabCapture`.
  2. **Bảo đảm trạng thái `AudioContext` luôn là `running`:** Ngay sau khi khởi tạo `audioContext = new AudioContext()`, kiểm tra `if (audioContext.state === "suspended") await audioContext.resume();`. Đồng thời trong hàm định kỳ `volumeInterval`, tự động đánh thức nếu context bị tạm dừng.

---

### 7. BUG-015: Khởi tạo WebGPU thất bại do thiếu Adapter và Giải pháp Đa Backend Tự Thích Ứng (Adaptive Multi-Backend)
* **Triệu chứng:** Nếu cấu hình gán cứng `device: "webgpu"`, ứng dụng ném ngoại lệ `Error: WebGPU is not supported in current environment` hoặc `Failed to get GPU adapter`, khiến ASR Engine chuyển sang trạng thái `"error"` và đứng im.
* **Nguyên nhân gốc rễ (Kiểm chứng qua Chromium Probe):**
  1. API WebGPU (`navigator.gpu.requestAdapter()`) phụ thuộc trực tiếp vào tầng driver đồ họa hệ điều hành (Vulkan trên Linux, Direct3D 12 trên Windows, Metal trên macOS). Trên máy ảo, Linux headless, hoặc các thiết bị văn phòng không có card đồ họa tương thích, `navigator.gpu` có thể không tồn tại hoặc `requestAdapter()` trả về `null`.
  2. Gán cứng `device: "webgpu"` sẽ làm mất đi khả năng chạy phổ quát (portable) của Chrome Extension.
* **Cách xử lý:**
  1. **Hàm thăm dò an toàn `checkWebGpuSupport()` (`src/ai/asr-engine.ts`):** Kiểm tra sự tồn tại của `navigator.gpu` và thử xin cấp phát adapter trước khi nạp model.
  2. **Chiến lược Đa Backend Tự Thích Ứng (Adaptive Multi-Backend):**
     - **Bước 1 (Ưu tiên):** Nếu máy có GPU hỗ trợ WebGPU, nạp Whisper Q4 trên WebGPU (`device: "webgpu"`), suy luận siêu tốc 80–150ms/câu, không cần COOP/COEP và hoàn toàn không xung đột với `tabCapture`.
     - **Bước 2 (Dự phòng tự động):** Nếu không có WebGPU hoặc shader compile thất bại, lập tức tự động lùi về WASM SIMD (`device: "wasm"`) mà không làm gián đoạn hay báo lỗi cho người dùng.
     - **Giao diện Popup:** Tự động phát hiện và hiển thị huy hiệu `Sẵn sàng (WEBGPU ⚡)` hoặc `Sẵn sàng (WASM SIMD)`.


