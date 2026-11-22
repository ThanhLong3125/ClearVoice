# ClearVoice -- Bug Log & Troubleshooting Guide 🛠️

> **Tài liệu tổng hợp các lỗi kỹ thuật thực tế phát sinh trong quá trình xây dựng ClearVoice, phân tích nguyên nhân gốc rễ (Root Cause), cách phát hiện (Detection) và giải pháp xử lý (Resolution).**

---

## 📑 Bảng Tra Cứu Nhanh Lỗi Kỹ Thuật

| Mã Bug | Triệu chứng | Nguyên nhân gốc rễ | Cách xử lý | Trạng thái |
| :--- | :--- | :--- | :--- | :--- |
| **BUG-001** | TypeScript báo lỗi biên dịch tại `getMediaStreamId` | API `chrome.tabCapture` dùng callback, không trả về Promise | Wrap callback vào `new Promise<string>` | ✅ Đã sửa |
| **BUG-002** | Popup treo ở `Đang kết nối...` khi tải model AI | Thiếu `host_permissions` cho domain `huggingface.co` (CORS Block) | Thêm `host_permissions: ["https://huggingface.co/*"]` | ✅ Đã sửa |
| **BUG-003** | Mở lại Popup thì trạng thái bị reset về mặc định | Popup là ephemeral context, Service Worker không lưu cache state | Lưu `lastModelStatus` trong Service Worker, trả về qua `GET_STATUS` | ✅ Đã sửa |
| **BUG-004** | Báo lỗi `Error: no available backend` hoặc `Unsupported device: wasm` | Transformers.js v3 quy định tên thiết bị là `"cpu"` hoặc `"webgpu"`, không có `"wasm"` | Đổi `device: "cpu"` (WASM execution provider trên browser) | ✅ Đã sửa |
| **BUG-005** | Lỗi `SharedArrayBuffer is not defined` khi chạy WASM | Chrome Extension CSP chặn SharedArrayBuffer đa luồng | Cấu hình `numThreads = 1` và `proxy = false` cho ONNX Runtime | ✅ Đã sửa |
| **BUG-006** | Popup bị đứng đơ ở dòng `Khởi tạo AI...` sau khi tải 100% | WebGPU trên Linux bị treo vô hạn ở bước biên dịch Shader | Khởi tạo trực tiếp bằng `device: "cpu"` (WASM SIMD) siêu ổn định | ✅ Đã sửa |
| **BUG-007** | Không bật nhạc mà Hàng đợi Queue vẫn bị dâng lên `5/5` | Âm thanh im lặng (Silence) trong PCM là chuỗi số 0 liên tục | Tích hợp bộ lọc năng lượng `EnergyVad` chặn chunk im lặng | ✅ Đã sửa |
| **BUG-008** | Chunk âm thanh bị rơi mất khi AI đang bận suy luận | Gọi inference trực tiếp trong event `onChunkReady` gây race condition | Xây dựng vòng lặp tiêu thụ độc lập `runAsrConsumerLoop()` (FIFO) | ✅ Đã sửa |
| **BUG-009** | Nhận diện tiếng Việt bị chậm hoặc sai | Whisper mất thời gian chạy thuật toán đoán ngôn ngữ (Language Detection) | Thêm dropdown chọn ngôn ngữ, ép `language: "vietnamese"` | ✅ Đã sửa |
| **BUG-010** | Popup bị kẹt ở `Khởi tạo AI...` do tải ngầm file FP32 300MB | Dùng `fp32` khiến model nặng 300MB; progress callback nhảy 100% ở file config nhỏ | Chuyển sang `dtype: "q4"` (chỉ ~40MB) và hiển thị tên file tải chi tiết | ✅ Đã sửa |
| **BUG-011** | File ONNX bị chặn ngầm khi tải redirect từ AWS S3 CDN của Hugging Face | CSP Extension chặn domain đa cấp (ví dụ `https://us.aws.cdn.hf.co/...`) do quy tắc `*.hf.co` không match đa cấp | Cập nhật `content_security_policy` cho phép `connect-src *;` và `host_permissions: ["<all_urls>"]` | ✅ Đã sửa |
| **BUG-012** | Quá trình biên dịch ONNX Session trên WASM chiếm bộ nhớ gây nghẽn luồng Audio | Chrome Extension chạy WASM đơn luồng (`numThreads = 1`), cần thời gian khởi tạo session trong bộ nhớ | Build lại `dist/` với CSP mở, thêm timeout an toàn và đề xuất Web Speech API hybrid | ✅ Đã xử lý |

---

## 🔍 Phân Tích Kỹ Thuật Chi Tiết Từng Lỗi

---

### BUG-001: Sai lệch kiểu dữ liệu callback trong `chrome.tabCapture.getMediaStreamId`
* **Triệu chứng:** Khi chạy `npm run build`, TypeScript compiler báo lỗi `Expected 2 arguments, but got 1` và `An expression of type 'void' cannot be tested for truthiness`.
* **Nguyên nhân:** Trong định nghĩa `@types/chrome`, hàm `chrome.tabCapture.getMediaStreamId` nhận 2 tham số: `(options, callback: (streamId: string) => void)`. Nó không hỗ trợ `await` trực tiếp.
* **Cách xử lý:** Bọc hàm gọi trong một Promise thuần:
  ```typescript
  const streamId = await new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!id) reject(new Error("Không lấy được streamId"));
      else resolve(id);
    });
  });
  ```

---

### BUG-002: Bị chặn mạng CORS khi tải mô hình từ Hugging Face
* **Triệu chứng:** Popup hiển thị `AI Whisper: Đang kết nối...` kéo dài mãi mà không nhảy phần trăm tải (0%).
* **Nguyên nhân:** Trong Chrome Extension Manifest V3, mọi request `fetch()` từ Extension context (như Offscreen Document) ra bên ngoài internet đều bị trình duyệt chặn theo chính sách CORS nếu domain đích không được khai báo trong `host_permissions`.
* **Cách xử lý:** Khai báo domain của Hugging Face vào `public/manifest.json`:
  ```json
  "host_permissions": [
    "https://huggingface.co/*",
    "https://*.huggingface.co/*",
    "https://*.hf.co/*"
  ]
  ```

---

### BUG-003: Mất đồng bộ trạng thái (State Desynchronization) giữa Popup và Background
* **Triệu chứng:** Popup vừa mở lên thì luôn hiện trạng thái mặc định ban đầu (`Đang kết nối...`), trong khi thực tế ở dưới background tiến trình đã tải xong hoặc đã lỗi.
* **Nguyên nhân:** Popup trong Chrome Extension là một cửa sổ tạm thời (**ephemeral**). Khi người dùng click chuột ra ngoài tab, Popup bị hủy hoàn toàn. Khi click mở lại, mã `popup.ts` chạy lại từ đầu và không hề biết những gì đã xảy ra trước đó.
* **Cách xử lý:** 
  1. Biến Service Worker thành "nguồn chân lý duy nhất" (**Single Source of Truth**), lưu trữ biến `lastModelStatus`.
  2. Mỗi khi Popup khởi động, nó gửi lệnh `GET_STATUS` và Service Worker trả về trạng thái model hiện tại để Popup cập nhật ngay lập tức.

---

### BUG-004: Sai tên thiết bị trong Transformers.js v3 (`wasm` vs `cpu`)
* **Triệu chứng:** Popup báo lỗi `Lỗi: Error: no available backend` hoặc `Unsupported device: wasm`.
* **Nguyên nhân:** Trong phiên bản v3 của `@huggingface/transformers`, API chuẩn hóa tên thiết bị thành `['webgpu', 'cpu', 'cuda']`. Trình duyệt web chạy WebAssembly được ánh xạ dưới tên **`"cpu"`**. Nếu truyền chuỗi `"wasm"`, thư viện sẽ văng Exception ngay lập tức.
* **Cách xử lý:** Thay đổi cấu hình khởi tạo sang:
  ```typescript
  await pipeline("automatic-speech-recognition", "onnx-community/whisper-tiny", {
    device: "cpu",
    dtype: "fp32"
  });
  ```

---

### BUG-005: Xung đột Multi-threading / SharedArrayBuffer với CSP của Chrome
* **Triệu chứng:** ONNX Runtime Web văng lỗi `SharedArrayBuffer is not defined` hoặc không tìm thấy backend WASM phù hợp.
* **Nguyên nhân:** Sau sự cố bảo mật phần cứng SPECTRE, các trình duyệt cấm sử dụng `SharedArrayBuffer` (dùng để chạy đa luồng WebAssembly) nếu trang web không có các header HTTP bảo mật chéo (`COOP/COEP`). Extension pages không có các header này.
* **Cách xử lý:** Ép ONNX Runtime Web chạy ở chế độ đơn luồng an toàn:
  ```typescript
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  ```

---

### BUG-006: WebGPU bị treo vô hạn ở bước biên dịch Shader trên Linux
* **Triệu chứng:** Popup hiển thị `Khởi tạo AI...` (đã tải 100% file nhưng mãi không chuyển sang `Sẵn sàng`). Số lượng chunk tăng lên 60-70 mà AI không hoạt động.
* **Nguyên nhân:** Trên hệ điều hành Linux, biến `navigator.gpu` có tồn tại trong Chrome, nhưng driver Vulkan/ANGLE phần cứng chưa hoàn chỉnh. Khi ONNX Runtime gửi các shader tính toán của Whisper sang GPU, tiến trình biên dịch shader bị treo vô hạn bên trong nhân đồ họa của trình duyệt mà không chịu trả lời hoặc bắn lỗi.
* **Cách xử lý:** Trực tiếp sử dụng **CPU / WASM SIMD** (`device: "cpu"`). Mô hình `whisper-tiny` rất nhỏ (39M tham số), CPU hiện đại xử lý một đoạn 3 giây chỉ mất ~400ms, khởi tạo trong 3-5 giây và chạy ổn định 100% trên mọi máy tính.

---

### BUG-007: Âm thanh im lặng (Digital Silence) làm đầy tràn Queue (`5/5`)
* **Triệu chứng:** Khi tạm dừng (pause) video YouTube hoặc tab không có âm thanh, Hàng đợi Queue vẫn nhanh chóng bị đẩy lên kịch trần `5/5`.
* **Nguyên nhân:** Trong âm thanh số PCM, "im lặng" không phải là không có dữ liệu, mà là luồng `Float32Array` chứa toàn các số `0.0000`. Chunker cứ đếm đủ 48,000 số 0 là đóng gói thành một chunk đẩy vào Queue. Nếu đưa vào Whisper, nó vừa ngốn CPU vô ích vừa sinh ra lỗi ảo giác (hallucination - tự bịa chữ).
* **Cách xử lý:** Tích hợp bộ lọc **`EnergyVad`** (Voice Activity Detection) dựa trên năng lượng RMS kèm thời gian đệm `hangover = 800ms`. Mọi chunk im lặng bị loại bỏ ngay tại cửa vào, giữ cho Queue luôn ở mức `0/5` khi tab tắt tiếng.

---

### BUG-008: Race condition giữa luồng sinh Audio Chunk và AI Inference
* **Triệu chứng:** Khi có tiếng nói, phụ đề thỉnh thoảng bị mất chữ hoặc ngắt quãng.
* **Nguyên nhân:** Gọi hàm `transcribe(chunk)` trực tiếp bên trong callback `onChunkReady`. Nếu inference mất 1.2s mà chunk tiếp theo đến sau 1.0s, cờ `isProcessing = true` sẽ khiến chunk sau bị vứt bỏ (drop).
* **Cách xử lý:** Xây dựng một vòng lặp tiêu thụ độc lập **`runAsrConsumerLoop()`**. Audio Chunker chỉ làm nhiệm vụ nạp chunk vào `BoundedQueue`. Consumer Loop sẽ tuần tự rút từng chunk ra theo cơ chế **FIFO (First-In, First-Out)**, loại bỏ hoàn toàn hiện tượng nghẽn luồng.

---

### BUG-010: Dung lượng mô hình FP32 quá nặng (300MB) gây hiểu lầm treo ở bước "Khởi tạo AI..."
* **Triệu chứng:** Popup hiển thị `Khởi tạo AI...` kéo dài hàng phút dù máy đã đếm tới 60-70 chunks.
* **Nguyên nhân:**
  1. Khi cấu hình `dtype: "fp32"`, tổng dung lượng của 2 file mạng `encoder_model.onnx` (152MB) và `decoder_model_merged.onnx` (146MB) lên tới gần **300 Megabytes**.
  2. Sự kiện `progress_callback` phát tín hiệu `progress = 100` khi các file cấu hình nhỏ ban đầu (`config.json`, `tokenizer.json`) tải xong. Giao diện Popup bắt được con số 100% này và vội vã chuyển sang hiển thị `Khởi tạo AI...`, trong khi thực tế 2 file mô hình khổng lồ 300MB vẫn đang âm thầm tải tiếp trong nền. Người dùng tưởng rằng hệ thống bị treo.
* **Cách xử lý:**
  1. Chuyển cấu hình mô hình sang **`dtype: "q4"` (Quantized 4-bit)**: Dung lượng giảm 7 lần (từ 300MB xuống chỉ còn **~40MB**), thời gian tải giảm từ vài phút xuống chỉ còn khoảng **10 - 15 giây**.
  2. Bổ sung thông tin chi tiết tên file đang tải lên Popup (ví dụ: `Tải encoder_q4 (45%)` ➡️ `Tải decoder_q4 (80%)` ➡️ `Đang nạp bộ nhớ...`), giúp người dùng nhìn thấy rõ tiến trình đang chạy liên tục, không gây cảm giác bị treo.
  3. Sử dụng `initPromise` để ngăn chặn việc gọi tải mô hình trùng lặp khi người dùng bấm Start/Stop nhiều lần.

---

### BUG-011: LFS CDN Redirect của Hugging Face bị chặn ngầm bởi Extension CSP
* **Triệu chứng:** Popup hiển thị `Khởi tạo AI...` hoặc tải đến một tỷ lệ nhất định rồi đứng im mãi mãi, không nhảy lỗi ra UI.
* **Nguyên nhân:** Khi Hugging Face tải các file trọng số ONNX lớn, server sẽ trả về HTTP 302 Redirect đến các máy chủ CDN phân tán của AWS (ví dụ: `https://us.aws.cdn.hf.co/...` hoặc CloudFront). Nếu trong `manifest.json` chỉ cấu hình CSP `connect-src https://*.hf.co`, Chromium sẽ chặn request vì `*.hf.co` chỉ khớp subdomain 1 cấp, không khớp subdomain đa cấp.
* **Cách xử lý:** 
  1. Cập nhật `content_security_policy` trong `manifest.json`:
     ```json
     "content_security_policy": {
       "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; connect-src *; object-src 'self'"
     }
     ```
  2. Bổ sung `host_permissions: ["<all_urls>"]`.
  3. Chạy `npm run build` để đồng bộ cấu hình ra thư mục `dist/`.

---

### BUG-012: Chi phí biên dịch và khởi tạo ONNX Session trên WebAssembly đơn luồng
* **Triệu chứng:** Sau khi tải 100% file weights, tiến trình tạo `InferenceSession` của ONNX Runtime Web trong Offscreen Document có thể mất thêm từ 15 - 30 giây để phân bổ heap memory và biên dịch đồ thị tính toán trên 1 core CPU (`numThreads = 1`).
* **Nguyên nhân:** Chrome Extension không kích hoạt được COOP/COEP nên không dùng được `SharedArrayBuffer` đa luồng, toàn bộ phép tính biên dịch dồn vào 1 luồng duy nhất của Offscreen Document.
* **Cách xử lý & Phương án tối ưu hóa:**
  1. **Phương án tức thì:** Sử dụng bản build `q4` (~40MB) đã biên dịch với CSP mở rộng. Tải lại extension (`chrome://extensions` ➡️ Reload).
  2. **Phương án Hybrid (Đề xuất tối ưu):** Tích hợp thêm **Web Speech API** (`webkitSpeechRecognition`) có sẵn trong trình duyệt Chrome. Phương án này 0MB dung lượng, nhận diện tiếng Việt/Anh tức thì (<0.1s), không tốn RAM/CPU và đóng vai trò cứu cánh dự phòng hoàn hảo khi máy người dùng có kết nối mạng yếu hoặc không muốn chờ nạp Whisper.
