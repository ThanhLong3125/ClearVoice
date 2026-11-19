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

### BUG-009: Chi phí nhận diện ngôn ngữ tự động (Language Detection Overhead)
* **Triệu chứng:** Video tiếng Việt nhận diện bị chậm, đôi khi nhận nhầm sang tiếng Anh hoặc ra ký tự lạ.
* **Nguyên nhân:** Nếu không chỉ định ngôn ngữ, Whisper phải chạy một mạng phụ để dự đoán xác suất ngôn ngữ trước mỗi câu, làm tăng thời gian xử lý và giảm độ chính xác trên các câu thoại ngắn.
* **Cách xử lý:** Bổ sung menu chọn ngôn ngữ trên giao diện Popup. Khi chọn `Tiếng Việt`, pipeline truyền trực tiếp tham số `language: "vietnamese"`, giúp Whisper bỏ qua bước đoán ngôn ngữ và tăng tốc độ giải mã lên gấp đôi.
