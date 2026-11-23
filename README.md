# ClearVoice 🎙️

> **A local-first browser tab audio capture, streaming DSP pipeline, and on-device AI speech transcription extension for meetings and video learning.**

[![Version](https://img.shields.io/badge/Version-v0.5.0-success.svg?style=flat)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![Chrome Extension](https://img.shields.io/badge/Manifest-V3-success.svg?style=flat&logo=googlechrome)](https://developer.chrome.com/docs/extensions/)
[![Vite](https://img.shields.io/badge/Bundler-Vite%206-purple.svg?style=flat&logo=vite)](https://vitejs.dev/)
[![Hardware Acceleration](https://img.shields.io/badge/Engine-WebGPU%20%7C%20WASM%20SIMD-orange.svg)]()
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Offline%20Local-green.svg)]()

ClearVoice là một Chrome Extension chạy ngầm theo thời gian thực, cho phép thu âm thanh trực tiếp từ bất kỳ tab trình duyệt nào (YouTube, Google Meet, Zoom Web, Microsoft Teams, Coursera, Podcast...), lọc âm giọng nói bằng chuỗi xử lý tín hiệu số (DSP) chuyên dụng và chuyển đổi giọng nói thành văn bản (ASR) bằng mô hình AI Whisper chạy **100% offline trực tiếp trên trình duyệt (On-Device)**.

---

## 🌟 Tính Năng Nổi Bật (Key Features)

* 🛡️ **Bảo Mật & Riêng Tư Tuyệt Đối (100% Offline):**
  - Mô hình AI Whisper Q4 (~94MB) và WebAssembly runtime được đóng gói sẵn hoàn toàn trong extension.
  - Không gửi bất kỳ byte âm thanh nào ra máy chủ bên ngoài (`connect-src 'self'`). Hoạt động ổn định ngay cả khi ngắt kết nối Internet.
* ⚡ **Tăng Tốc Phần Cứng WebGPU & WASM SIMD:**
  - Tự động phát hiện và chạy suy luận phần cứng trên GPU thông qua **WebGPU** (thời gian xử lý câu 3.5s chỉ tốn ~0.7s – RTF ~0.25).
  - Tự động fallback mượt mà sang **WASM SIMD đơn luồng** trên các máy không hỗ trợ WebGPU.
* 🎧 **Âm Thanh Loa Giữ Nguyên (Full Passthrough):**
  - Khi bắt đầu thu âm tab, âm thanh video/cuộc họp vẫn phát ra loa bình thường qua `AudioContext.destination` mà không bị tắt tiếng hay giật lag.
* 💬 **Kiến Trúc Nhận Dạng Tuần Tự Theo Mệnh Đề (Sequential Clause Captioning):**
  - Thay vì ép streaming nhả từng từ vụn vặt gây giật cục và vỡ chữ, hệ thống gom âm thanh theo nhịp câu nói tự nhiên (2.5s – 4.0s) và hiển thị trọn vẹn từng câu hoàn chỉnh (8–15 từ) đúng ngữ pháp.
* 🎛️ **Bộ Lọc Âm Thanh Dải Giọng Nói (VoiceBandpassFilter 260Hz – 3400Hz):**
  - Sử dụng bộ lọc IIR Biquad 4th-order để triệt tiêu tiếng trống kick/bass siêu trầm (< 250Hz) và tiếng cymbals cao tần (> 3500Hz) của nhạc nền, giúp thuật toán VAD bắt trúng khoảng nghỉ câu ngay cả trong video ca nhạc hoặc podcast có nhạc nền lớn.
* 🔄 **Cơ Chế Stride Overlap (~0.3s) Chống Cắt Đôi Chữ:**
  - Khi người nói nói liên tục không nghỉ chạm ngưỡng tối đa (4.0s), thuật toán tìm đáy năng lượng âm tiết và giữ lại 300ms nối sang chunk sau, triệt tiêu lỗi chém đứt đôi từ ngữ.
* 📑 **Phụ Đề Cuộn 2 Dòng Chuẩn Cuộc Họp (Rolling 2-Line Subtitle):**
  - Phụ đề nổi trực tiếp trên video với công nghệ **Closed Shadow DOM**, cách ly hoàn toàn với CSS trang web.
  - Dòng trên hiển thị câu vừa nói trước đó; dòng dưới hiển thị câu mới hoàn thành, lưu giữ 8 giây giúp người tham gia cuộc họp dễ dàng theo dõi.
* 🌐 **Khóa Cứng Ngôn Ngữ & Bộ Lọc Diệt Ảo Giác CJK:**
  - Khóa chặt token ngôn ngữ (`en`, `vi`, `ja`, `ko`, `zh`, v.v.), loại bỏ hiện tượng Whisper tự nhảy sang tiếng Hàn/Trung trên video tiếng Anh.
  - Quét sạch các chuỗi ký tự lặp vô tận và dập tắt hoàn toàn ảo giác ký tự CJK.

---

## 🏛️ Kiến Trúc Hệ Thống (System Architecture)

Tuân thủ nghiêm ngặt ranh giới **Manifest V3 (MV3)** của Chrome, dự án được module hóa thành các tầng độc lập giao tiếp qua Typed Message Bus:

```mermaid
flowchart TD
    subgraph UI ["1. Giao diện (Presentation Layer)"]
        Popup["Popup UI (popup.ts)<br/>- Bắt đầu / Dừng thu âm<br/>- Chọn ngôn ngữ nguồn (en, vi, ja, ...)<br/>- Hiển thị trạng thái & thiết bị (WebGPU / WASM)"]
        Overlay["Content Script (overlay.ts)<br/>- Closed Shadow DOM cách ly CSS<br/>- Rolling 2-Line Subtitle Container<br/>- Tự động mount vào Fullscreen Video"]
    end

    subgraph Coordinator ["2. Điều phối Trung tâm (Coordination Layer)"]
        SW["Background Service Worker (service-worker.ts)<br/>- Quản lý vòng đời Tab & Session State<br/>- Quản lý tabCapture Stream ID<br/>- Đồng bộ hóa chuyển tiếp ngôn ngữ (SET_LANGUAGE)"]
    end

    subgraph AudioEngine ["3. Xử lý Tín hiệu Số (Offscreen Document)"]
        MediaCapture["getUserMedia(tabCapture streamId)"]
        Worklet["AudioWorkletNode<br/>(audio-processor.js - Gom block 2048 samples)"]
        Dest["audioContext.destination<br/>(Phát tiếng tab ra loa người dùng)"]
        DSP["AudioPipeline<br/>- Downmix Stereo -> Mono<br/>- Windowed-Sinc FIR Resampler (48kHz -> 16kHz)<br/>- VoiceBandpassFilter (260Hz - 3400Hz)<br/>- SlidingWindowChunker (2.4s - 4.0s + 0.3s Overlap)<br/>- Zero-Drop BoundedQueue (8 chunks)"]
    end

    subgraph AIRuntime ["4. Suy Luận AI (Dedicated Web Worker)"]
        Worker["ASR Web Worker (asr-worker.ts)<br/>- Chạy nền độc lập không block UI"]
        Engine["LocalAsrEngine (asr-engine.ts)<br/>- Transformers.js v3<br/>- whisper-tiny Q4 On-Device<br/>- Direct Language Pinning<br/>- Unicode & CJK Hallucination Cleaner"]
    end

    Popup -->|START_CAPTURE + language| SW
    SW -->|Init Audio Stream| MediaCapture
    MediaCapture --> Dest
    MediaCapture --> Worklet
    Worklet --> DSP
    DSP -->|AudioChunk (2.5s - 4.0s)| Worker
    Worker --> Engine
    Engine -->|TranscriptSegment (final)| SW
    SW -->|TRANSCRIPT_UPDATE| Overlay
```

---

## 📂 Cấu Trúc Thư Mục (Project Layout)

```text
ClearVoice/
├── public/
│   ├── manifest.json            # Manifest V3 configuration
│   ├── audio-processor.js       # AudioWorkletProcessor thu gom mẫu âm thanh
│   ├── wasm/                    # ONNX Runtime WebAssembly SIMD binaries
│   └── models/
│       └── whisper-tiny/        # Mô hình ONNX Q4 Whisper (~94MB) đóng gói sẵn 100% offline
├── src/
│   ├── types/
│   │   ├── audio.ts             # Hợp đồng AudioChunk, TranscriptSegment
│   │   └── messages.ts          # Định nghĩa kiểu thông điệp IPC mở rộng
│   ├── background/
│   │   └── service-worker.ts    # Service Worker quản lý phiên và điều phối luồng
│   ├── popup/
│   │   ├── index.html           # Popup HTML
│   │   ├── popup.css            # Giao diện Dark-mode hiện đại
│   │   └── popup.ts             # Logic điều khiển, chọn ngôn ngữ & pre-warm
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   ├── offscreen.ts         # Khởi tạo Web Audio graph & consumer loop
│   │   └── asr-worker.ts        # Dedicated Web Worker chạy suy luận ASR
│   ├── audio/
│   │   ├── format.ts            # Downmix Stereo sang Mono
│   │   ├── resampler.ts         # FIR Low-Pass Anti-Aliasing Resampler (48k -> 16k)
│   │   ├── filter.ts            # 4th-order Biquad VoiceBandpassFilter (260Hz - 3400Hz)
│   │   ├── chunker.ts           # SlidingWindowChunker ngắt câu tự nhiên + Stride Overlap
│   │   ├── queue.ts             # BoundedQueue hàng đợi đo lường backpressure
│   │   └── pipeline.ts          # Tích hợp toàn bộ chuỗi DSP & điều phối token budget
│   ├── ai/
│   │   └── asr-engine.ts        # LocalAsrEngine: WebGPU/WASM, Language Pinning, Diệt Hallucination
│   └── content/
│       ├── overlay.css          # Giao diện phụ đề 2 dòng cuộn Closed Shadow DOM
│       └── overlay.ts           # Quản lý hiển thị phụ đề trực tiếp trên video
├── tests/
│   └── audio-pipeline.test.ts   # 8 bài kiểm thử tự động cho DSP, Filter, Chunker & Lọc Unicode
├── CHANGELOG.md                 # Nhật ký thay đổi chi tiết qua các phiên bản
├── package.json                 # v0.5.0
├── tsconfig.json                # TypeScript Strict Configuration
└── vite.config.ts               # Multi-entrypoint Vite Build cho MV3
```

---

## 📊 Hợp Đồng Dữ Liệu Cốt Lõi (Data Contracts)

### 1. `AudioChunk` ([src/types/audio.ts](src/types/audio.ts))
```typescript
export interface AudioChunk {
  sessionId: string;             // ID phiên thu âm duy nhất
  sequence: number;              // Số thứ tự tăng dần (phát hiện mất gói)
  startSample: number;           // Vị trí mẫu âm thanh trong dòng thời gian
  sampleRate: number;            // Tần số lấy mẫu chuẩn (16000 Hz)
  channels: number;              // Kênh âm thanh (1 = Mono)
  format: "f32";                 // Định dạng Float32Array [-1.0, 1.0]
  samples: Float32Array;         // Dữ liệu sóng âm thô nguyên bản
  capturedAtMonotonicMs: number; // Mốc thời gian đơn điệu (performance.now())
  isCongested?: boolean;         // Cờ báo hiệu hàng đợi dồn ứ âm thanh
  maxNewTokens?: number;         // Ngân sách token sinh linh hoạt (32 khi nghẽn, 64 khi rảnh)
}
```

### 2. `TranscriptSegment` ([src/types/audio.ts](src/types/audio.ts))
```typescript
export interface TranscriptSegment {
  id: string;                    // ID duy nhất của câu phụ đề
  sessionId: string;
  startMs: number;               // Khớp chính xác theo timeline âm thanh
  endMs: number;
  text: string;                  // Nội dung câu thoại hoàn chỉnh
  language?: string;             // Ngôn ngữ nhận diện
  status: "partial" | "final" | "uncertain";
  sourceSequenceStart?: number;
  sourceSequenceEnd?: number;
}
```

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Thử Nghiệm

### 1. Yêu Cầu Môi Trường
* **Node.js**: `v18.0.0` trở lên (Khuyến nghị Node 20 hoặc 22 LTS).
* **npm**: Phiên bản `9.0.0` trở lên.
* **Trình duyệt**: Google Chrome, Brave, Edge hoặc Chromium browser phiên bản 116+ (hỗ trợ WebGPU và Offscreen Document).

### 2. Cài Đặt Dependencies & Biên Dịch
```bash
# Clone kho mã nguồn
git clone https://github.com/ThanhLong3125/ClearVoice.git
cd ClearVoice

# Cài đặt thư viện phụ thuộc
npm install

# Chạy kiểm thử tự động (8/8 test suites)
npm test

# Biên dịch mã nguồn ra thư mục dist/
npm run build

# (Tùy chọn) Chạy chế độ watch tự động biên dịch khi sửa mã:
npm run dev
```

### 3. Nạp Extension Vào Google Chrome
1. Mở Chrome và điều hướng đến: `chrome://extensions/`
2. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Nhấp vào nút **Load unpacked** (Tải tiện ích đã giải nén).
4. Chọn thư mục `dist` trong dự án (`ClearVoice/dist`).
5. Biểu tượng **ClearVoice v0.5.0** sẽ xuất hiện trên thanh tiện ích của bạn.

### 4. Sử Dụng Thực Tế (YouTube, Google Meet, Zoom)
1. Mở một tab có phát âm thanh hoặc cuộc họp trực tuyến.
2. Bấm vào biểu tượng **ClearVoice** trên thanh Extension.
3. Chọn ngôn ngữ âm thanh trong danh sách (ví dụ: *English*, *Tiếng Việt*, v.v.).
4. Nhấn nút **"Bắt đầu thu âm Tab"**:
   - Tiện ích bắt đầu nạp model lên WebGPU và xử lý âm thanh.
   - Khi người trong video/cuộc họp nói một câu, phụ đề câu thoại hoàn chỉnh sẽ xuất hiện trực tiếp ở chân video sau 1.5 – 2 giây.
5. Nhấn **"Dừng thu âm"** khi kết thúc.

---

## 🧪 Kiểm Thử Tự Động (Automated Tests)

Dự án trang bị bộ kiểm thử tự động toàn diện kiểm chứng các thuật toán DSP và bộ lọc văn bản tại [tests/audio-pipeline.test.ts](tests/audio-pipeline.test.ts):

```bash
npm test
```

**Các kịch bản kiểm thử bao gồm:**
* ✔️ `downmixToMono`: Kiểm tra chính xác trung bình cộng tín hiệu Stereo $\rightarrow$ Mono.
* ✔️ `StreamResampler`: Giữ nguyên sóng sin 1kHz trong passband và triệt tiêu sóng aliasing 12kHz ở stopband (48kHz $\rightarrow$ 16kHz).
* ✔️ `VoiceBandpassFilter`: Suy hao mạnh âm bass 60Hz (< 0.1 RMS) và bảo toàn năng lượng thanh quản 1000Hz (> 0.6 RMS).
* ✔️ `SlidingWindowChunker (Pause Cut)`: Cắt chuẩn xác ở khoảng lặng tự nhiên khi đạt độ dài tối thiểu.
* ✔️ `SlidingWindowChunker (Stride Overlap)`: Đảm bảo chunk kế tiếp bắt đầu đè trước 300ms so với điểm cắt cưỡng bức của chunk trước.
* ✔️ `BoundedQueue`: Chính xác chính sách drop-oldest khi vượt quá dung lượng.
* ✔️ `AudioPipeline`: Kiểm tra gộp cụm câu và tự động kích hoạt điều tiết token budget khi nghẽn.
* ✔️ `Unicode & CJK Hallucination Filter`: Co cụm lặp từ tiếng Việt/tiếng Anh và quét sạch ký tự CJK lạc ngữ cảnh.

---

## 🗺️ Lộ Trình Phát Triển (Milestones)

- [x] **Milestone 0:** Khởi tạo khung dự án Vite + TypeScript + MV3 & Git workflow.
- [x] **Milestone 1:** Tab Audio Capture & Web Audio Graph Passthrough ra loa ngoài.
- [x] **Milestone 2:** Streaming DSP Pipeline (Resampler 48kHz $\rightarrow$ 16kHz, VAD Adaptive Noise Floor, Bounded Queue).
- [x] **Milestone 3:** Tích hợp mô hình AI Whisper Q4 On-Device 100% Offline qua WebGPU / WASM SIMD.
- [x] **Milestone 4:** Thiết kế giao diện phụ đề cuộn 2 dòng Closed Shadow DOM, chống xung đột CSS.
- [x] **Milestone 5 (v0.5.0):** 
  - Chuyển đổi sang kiến trúc **Sequential Clause Captioning** chuẩn cuộc họp.
  - Bộ lọc thông dải thanh quản `VoiceBandpassFilter` (260Hz – 3400Hz).
  - Cơ chế Stride Overlap (~0.3s) chống cắt đôi từ ngữ.
  - Khóa cứng ngôn ngữ và bộ lọc diệt ảo giác CJK/lặp ký tự vô tận.
- [ ] **Milestone 6 (Kế hoạch tiếp theo):**
  - Tích hợp module dịch thuật offline (ví dụ Opus-MT EN $\rightarrow$ VI) phục vụ dịch song ngữ song song.
  - Bảng tổng hợp nội dung cuộc họp (Meeting Summary Notes) xuất file Markdown sau khi kết thúc phiên.

---

## 📄 Bản Quyền (License)

Dự án được xây dựng và phát triển cho mục đích học tập kỹ thuật hệ thống, portfolio cá nhân và nghiên cứu giải pháp Local-first AI trong trình duyệt web.
