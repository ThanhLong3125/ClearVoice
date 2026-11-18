# ClearVoice -- Project Context and Implementation Guide for AI Agents

> **Tài liệu ngữ cảnh chính dành cho AI coding agents.**
>
> Đọc tài liệu này trước khi đề xuất kiến trúc, tạo file, sửa code hoặc
> triển khai milestone. Tài liệu này định nghĩa mục tiêu, phạm vi,
> nguyên tắc và cách làm việc. Nếu code hiện tại khác tài liệu, hãy kiểm
> tra repository và báo rõ khác biệt; không được giả định tài liệu luôn
> phản ánh trạng thái code mới nhất.

## 1. Project identity

**Project name:** ClearVoice

**Working description:** A local-first browser audio capture, streaming
audio processing, and AI transcription project.

**Primary purpose:** Đây là project học tập và portfolio cá nhân cho một
sinh viên/người phát triển có nền tảng Backend. Mục tiêu là học thêm
audio processing, browser APIs, streaming, AI inference và system
engineering; đồng thời tạo ra một project có chất lượng kỹ thuật đủ tốt
để trình bày trong CV.

**This is not primarily a commercial SaaS product.**

Không tối ưu dự án theo hướng xây dựng công ty, tăng trưởng người dùng
hoặc monetization. Ưu tiên learning value, engineering quality,
reproducibility, documentation và khả năng demo.

## 2. Product vision

ClearVoice cho phép người dùng thu âm thanh từ một tab trình duyệt do họ
chủ động chọn, xử lý audio local và tạo transcript/phụ đề bằng ASR model
chạy trên thiết bị.

Định hướng dài hạn có thể bao gồm:

-   Dịch transcript sang tiếng Việt.
-   Voice Activity Detection.
-   Noise suppression.
-   Audio quality assessment.
-   Phát hiện dropout.
-   Transcript uncertainty/recovery.
-   Hỗ trợ nhiều nguồn audio và native helper.

Đây là tầm nhìn dài hạn, không phải yêu cầu MVP.

## 3. User and development context

-   Người phát triển có nền tảng Backend.
-   Chưa giả định người phát triển đã có kiến thức chuyên sâu về DSP,
    ASR, Web Audio hoặc WebRTC.
-   Cần giải thích thuật ngữ và quyết định kỹ thuật từ nền tảng.
-   Ưu tiên hướng dẫn từng bước, có bài tập/prototype nhỏ.
-   Không được mặc định người phát triển hiểu ML hoặc audio processing.
-   Ngôn ngữ trao đổi và tài liệu mặc định: tiếng Việt; tên API, thuật
    ngữ và identifier giữ nguyên tiếng Anh khi phù hợp.

## 4. Core goals

1.  Học và áp dụng Digital Audio Fundamentals.
2.  Xây dựng browser audio capture có lifecycle rõ ràng.
3.  Xử lý audio theo streaming/chunk.
4.  Tích hợp local ASR.
5.  Xây dựng transcript engine có timestamp.
6.  Đo hiệu năng và độ chính xác.
7.  Có testing, documentation và release workflow.
8.  Tạo repository dễ hiểu để nhà tuyển dụng hoặc contributor có thể
    đọc.

## 5. MVP scope -- Definition of Done

MVP được coi là hoàn thành khi:

-   [ ] Người dùng cài được extension ở môi trường phát triển.
-   [ ] Người dùng chủ động chọn tab và bắt đầu capture.
-   [ ] Extension hiển thị trạng thái capture.
-   [ ] Audio được đọc và chuẩn hóa theo format được tài liệu hóa.
-   [ ] Audio được chia thành chunk/window với timeline rõ.
-   [ ] Một ASR model local có thể load và inference.
-   [ ] Transcript được trả về và hiển thị.
-   [ ] Transcript có timestamp hợp lý.
-   [ ] Xử lý được lỗi cơ bản: permission denied, tab closed, track
    ended, model load failure.
-   [ ] Có cách dừng capture và giải phóng tài nguyên.
-   [ ] Có benchmark cơ bản cho latency và tài nguyên.
-   [ ] README hướng dẫn cài đặt, sử dụng và nêu rõ giới hạn.
-   [ ] Không yêu cầu application backend để xử lý audio/AI.

MVP không bắt buộc có translation, denoising, packet loss detection,
transcript recovery hoặc desktop support.

## 6. Non-goals

AI agent không được tự ý mở rộng MVP thành:

-   Cloud transcription SaaS.
-   User account/authentication backend.
-   Database server.
-   Subscription/payment system.
-   Model training pipeline.
-   WebRTC SFU hoặc voice calling application.
-   Công cụ ghi âm toàn hệ điều hành.
-   Hệ thống khôi phục chính xác packet/audio đã mất.
-   Hỗ trợ tất cả browser và OS ngay từ đầu.

Nếu cho rằng một tính năng ngoài scope là cần thiết, hãy giải thích lý
do, chi phí và đề xuất dưới dạng optional future milestone. Không tự
triển khai.

## 7. Technology direction

Đây là định hướng ban đầu, không phải quyết định bất biến. Trước khi
thêm dependency hoặc chọn runtime, kiểm tra compatibility và benchmark.

  -----------------------------------------------------------------------
  Layer                   Preferred direction     Notes
  ----------------------- ----------------------- -----------------------
  Browser extension       Chrome/Chromium         MVP target
                          Manifest V3             

  Language                TypeScript              Ưu tiên type-safe code

  UI                      React nếu UI cần độ     Không over-engineer
                          phức tạp tương ứng      

  Build                   Vite hoặc tooling tương Kiểm tra MV3 output
                          thích extension         

  Audio capture           `chrome.tabCapture`     Tab audio, không phải
                                                  system audio

  Audio processing        Web Audio API,          Tránh API deprecated
                          AudioWorklet            

  AI runtime              ONNX Runtime Web hoặc   Benchmark WASM/WebGPU
                          runtime phù hợp         

  ASR                     Model pretrained có thể Chưa train model
                          chạy local              

  Storage                 `chrome.storage` cho    Không lưu audio mặc
                          settings; IndexedDB cho định
                          dữ liệu lớn nếu cần     

  Tests                   Unit + integration +    Reproducible
                          audio fixtures          

  CI                      GitHub Actions          Lint, typecheck, tests,
                                                  build
  -----------------------------------------------------------------------

Go Core và Python AI Worker không nằm trong MVP mặc định. Chỉ đề xuất
khi có lý do kỹ thuật được chứng minh. Không thêm Go/Python chỉ để làm
stack đa dạng.

## 8. High-level processing flow

``` text
User action
  -> Select tab
  -> Request/validate capture permission
  -> Start tab audio capture
  -> Read audio frames
  -> Normalize format
  -> Chunk/window audio
  -> Local ASR inference
  -> Transcript merge and stabilization
  -> Subtitle UI
  -> Stop and cleanup
```

Mỗi bước phải có ranh giới trách nhiệm và lỗi có thể quan sát được.

## 9. Audio data contract

Trước khi implement pipeline, agent phải kiểm tra format thật mà capture
API cung cấp và format mà ASR runtime yêu cầu.

Không tự giả định sample rate cố định.

Một contract tham khảo:

``` ts
interface AudioChunk {
  sessionId: string;
  sequence: number;
  startSample: number;
  sampleRate: number;
  channels: number;
  format: "f32";
  samples: Float32Array;
  capturedAtMonotonicMs: number;
}
```

Yêu cầu:

-   `sequence` tăng đơn điệu trong một session.
-   `startSample` mô tả vị trí sample trong timeline session.
-   `sampleRate` là sample rate thực của dữ liệu.
-   `channels` phải khớp layout dữ liệu.
-   Không sửa metadata để giả vờ resample.
-   Nếu resample, thực hiện phép biến đổi tín hiệu thực sự.
-   Tránh copy buffer không cần thiết.
-   Xác định ownership/lifecycle của transferable buffers nếu dùng
    Worker messaging.

## 10. Transcript data contract

Schema tham khảo:

``` ts
interface TranscriptSegment {
  id: string;
  sessionId: string;
  startMs: number;
  endMs: number;
  text: string;
  language?: string;
  status: "partial" | "final" | "uncertain";
  sourceSequenceStart?: number;
  sourceSequenceEnd?: number;
}
```

Quy tắc:

-   Partial có thể thay đổi.
-   Final không bị ghi đè bởi kết quả partial cũ.
-   Overlapping windows không tạo câu lặp.
-   Timestamp phải dựa trên audio timeline.
-   Không bịa confidence.
-   Không biến phần suy luận thành recognized text.

## 11. Streaming and resource rules

-   Không dùng queue không giới hạn.
-   Không tạo một model instance cho mỗi chunk.
-   Không tải model lại cho mỗi inference.
-   Không tạo vô hạn tác vụ inference đồng thời.
-   Có cancellation khi session dừng.
-   Có cleanup cho stream, track, AudioContext, worker và event
    listener.
-   Theo dõi queue depth, inference duration và dropped chunks.
-   Nếu cần bỏ chunk, ghi nhận và phản ánh gap; không che giấu mất dữ
    liệu.
-   Tránh giữ reference đến audio buffers cũ sau khi xử lý xong.

AI agent phải giải thích trade-off của queue policy. Không tự chọn "drop
oldest" hoặc "drop newest" mà không nêu tác động.

## 12. ASR integration rules

-   Ưu tiên pretrained model.
-   Chọn model nhỏ để chứng minh pipeline trước.
-   Kiểm tra license và điều kiện phân phối model.
-   Tách model loading khỏi inference.
-   Có trạng thái loading/ready/error.
-   Có timeout/cancellation hợp lý.
-   Ghi lại model name/version, runtime, compute backend và cấu hình
    benchmark.
-   Whisper không phải native frame-by-frame streaming engine. Nếu dùng
    sliding window, phải xử lý overlap và transcript stabilization.
-   Không tuyên bố realtime nếu chưa đo.

## 13. Scientific and technical correctness rules

Các điểm sau phải được giữ chính xác trong mọi tài liệu, code comment và
CV description:

1.  Browser tab capture không tương đương system-wide audio capture.
2.  Extension không thể mặc định thu âm thanh từ ứng dụng desktop.
3.  Audio waveform dropout không chứng minh RTP/UDP packet loss.
4.  Nếu không có quyền hoặc API phù hợp, không tuyên bố quan sát trực
    tiếp RTP/RTCP stats.
5.  Audio đã mất hoàn toàn không thể được khôi phục chính xác chỉ từ
    phía receiver.
6.  Context-based reconstruction là dự đoán, phải đánh dấu
    uncertain/reconstructed.
7.  Noise suppression không luôn cải thiện ASR.
8.  Sample rate metadata change không phải resampling.
9.  Whisper sliding window không tự động đảm bảo streaming transcript ổn
    định.
10. Benchmark phải là số đo thực tế, không được bịa.

## 14. Privacy and security requirements

-   Capture chỉ bắt đầu từ hành động rõ ràng của người dùng.
-   UI phải thể hiện capture đang hoạt động.
-   Không capture microphone nếu MVP không cần.
-   Không upload audio/transcript.
-   Không lưu audio mặc định.
-   Không log raw audio hoặc nội dung hội thoại.
-   Không yêu cầu người dùng đưa audio nhạy cảm vào GitHub Issue.
-   Không xin permission rộng hơn mức cần thiết.
-   Kiểm tra input và message boundaries giữa extension contexts.
-   Không expose local service/network endpoint trong MVP nếu không cần.
-   Nếu thêm telemetry, phải opt-in và tài liệu hóa.

## 15. Repository organization proposal

Có thể bắt đầu đơn giản:

``` text
clearvoice/
├── src/
│   ├── background/
│   ├── popup/
│   ├── content/
│   ├── offscreen/
│   ├── audio/
│   │   ├── capture/
│   │   ├── processing/
│   │   └── chunking/
│   ├── ai/
│   │   ├── runtime/
│   │   └── asr/
│   ├── transcript/
│   ├── messaging/
│   └── shared/
├── public/
│   └── manifest.json
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── scripts/
├── docs/
│   ├── architecture/
│   ├── decisions/
│   └── benchmarks/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   └── workflows/
├── README.md
└── package.json
```

Không cần tạo mọi thư mục ngay từ đầu. Tạo theo nhu cầu thực tế và tránh
module rỗng chỉ để giữ cấu trúc.

## 16. Milestones

### M0 -- Learning and technical spikes

Deliverables:

-   Extension skeleton.
-   WAV inspection script.
-   PCM/sample rate notes.
-   Audio chunking prototype.
-   Decision note về browser capture API.

Exit criteria: giải thích được format audio và chứng minh được chunking
offline.

### M1 -- Browser Audio Capture

Deliverables:

-   User-triggered tab capture.
-   Capture status.
-   Audio stream lifecycle.
-   Audio frame reader.
-   Stop/cleanup handling.

Exit criteria: capture audio từ một tab thử nghiệm và kiểm chứng được
output.

### M2 -- Audio Pipeline

Deliverables:

-   Internal audio contract.
-   Format conversion/resampling nếu cần.
-   Chunk/window manager.
-   Bounded queue.
-   Timeline/sequence handling.
-   Basic metrics.

Exit criteria: pipeline xử lý audio liên tục mà không tăng backlog vô
hạn trong test đã xác định.

### M3 -- Local ASR

Deliverables:

-   Model/runtime integration.
-   Model loading lifecycle.
-   Inference API.
-   Error handling.
-   Benchmark baseline.

Exit criteria: chạy ASR local trên audio fixture và có kết quả đo.

### M4 -- Transcript Engine and Subtitle

Deliverables:

-   Transcript schema.
-   Sliding-window/overlap handling nếu cần.
-   Deduplication.
-   Partial/final state.
-   Subtitle presentation.

Exit criteria: transcript không lặp nghiêm trọng và timestamp có thể
kiểm tra.

### M5 -- Reliability and Benchmark

Deliverables:

-   Lifecycle/error tests.
-   CPU/RAM/latency report.
-   Queue/drop metrics.
-   Failure reproduction instructions.

Exit criteria: có báo cáo benchmark tái lập được.

### M6 -- Optional enhancements

Chọn từng tính năng dựa trên thời gian và giá trị học tập:

-   VAD.
-   Noise suppression.
-   Vietnamese translation.
-   Quality assessment.
-   Audio-level dropout simulation.
-   Transcript uncertainty/recovery.

### M7 -- Release and portfolio

Deliverables:

-   README sử dụng.
-   Architecture diagram.
-   Changelog.
-   GitHub Issue templates.
-   CI workflow.
-   Demo.
-   Limitations.
-   Benchmark report.
-   Release package.

## 17. Testing and dataset policy

-   Dùng public datasets hoặc audio tự tạo/được phép sử dụng.
-   Kiểm tra license trước khi sử dụng hoặc phân phối.
-   Không commit dataset lớn/có bản quyền khi không có quyền.
-   Giữ manifest, script tạo biến thể và hướng dẫn download.
-   Giữ transcript ground truth để tính WER.
-   Tạo noisy/dropout fixture từ clean audio khi phù hợp.
-   Phân biệt audio-level degradation với network-level packet loss.

Benchmark report phải ghi môi trường:

-   OS.
-   Browser/version.
-   CPU/GPU.
-   RAM.
-   Model/version.
-   Runtime/backend.
-   Audio format.
-   Dataset/fixture.
-   Số lần chạy.
-   Warm-up policy.

## 18. GitHub workflow

Issue categories:

-   `bug`
-   `enhancement`
-   `performance`
-   `audio-capture`
-   `ai-inference`
-   `compatibility`
-   `documentation`

Suggested workflow:

1.  Issue mô tả vấn đề và reproduction steps.
2.  Xác nhận lỗi hoặc ghi nhận feature request.
3.  Tạo branch theo issue.
4.  Implement thay đổi nhỏ.
5.  Chạy lint, typecheck, tests và build.
6.  Tạo PR liên kết issue.
7.  Review trade-off và regression.
8.  Merge.
9.  Update changelog và release khi phù hợp.

Không yêu cầu người dùng đính kèm cuộc gọi, transcript hoặc audio riêng
tư. Hãy yêu cầu log đã redact.

## 19. How AI agents should work on this project

### Trước khi sửa code

1.  Đọc tài liệu này.
2.  Kiểm tra repository hiện tại và trạng thái git.
3.  Đọc package manifest và các module liên quan.
4.  Xác định milestone hiện tại.
5.  Tóm tắt hiểu biết và nêu file dự kiến sửa.
6.  Nêu các giả định hoặc API compatibility cần kiểm tra.

### Khi triển khai

-   Làm từng task nhỏ, không rewrite toàn bộ project.
-   Ưu tiên code dễ đọc và type-safe.
-   Không thêm dependency nếu API nền tảng đã đủ.
-   Kiểm tra phiên bản thư viện và API hiện hành.
-   Viết tests cho logic quan trọng.
-   Xử lý cleanup/lifecycle rõ ràng.
-   Không để placeholder hoặc TODO giả vờ là chức năng đã hoàn thành.
-   Không hard-code machine-specific path.
-   Không thêm backend server khi chưa có yêu cầu.
-   Không tự ý đổi kiến trúc hoặc stack đã được xác nhận.

### Sau khi triển khai

Báo cáo:

1.  Đã thay đổi gì?
2.  Vì sao chọn cách đó?
3.  File nào đã thay đổi?
4.  Test nào đã chạy và kết quả?
5.  Hạn chế còn lại?
6.  Cách người dùng tự kiểm chứng?
7.  Bước tiếp theo đề xuất?

Nếu chưa chạy được test, phải nói rõ. Không được khẳng định "đã test"
nếu chỉ đọc code.

### Khi chưa đủ thông tin

-   Không bịa API hoặc hành vi browser.
-   Nêu rõ điều chưa chắc chắn.
-   Ưu tiên kiểm tra tài liệu chính thức.
-   Nếu có nhiều lựa chọn, đưa trade-off và đề xuất một lựa chọn MVP.
-   Chỉ hỏi người dùng khi thiếu thông tin làm thay đổi đáng kể thiết kế
    hoặc kết quả.

## 20. Decision record template

Khi có quyết định kiến trúc đáng kể, tạo file trong `docs/decisions/`:

``` md
# ADR-0001: <Decision title>

## Status
Proposed | Accepted | Superseded

## Context
Vấn đề cần giải quyết là gì?

## Options
Các phương án đã cân nhắc.

## Decision
Chọn phương án nào?

## Consequences
Ưu điểm, nhược điểm và rủi ro.

## Validation
Cách kiểm chứng quyết định.
```

## 21. Definition of a good portfolio project

ClearVoice không được đánh giá chỉ bằng số lượng tính năng.

Một kết quả tốt cần có:

-   Kiến trúc dễ giải thích.
-   Code có ranh giới module hợp lý.
-   Streaming pipeline có kiểm soát tài nguyên.
-   Error handling và lifecycle rõ.
-   Tests có thể chạy lại.
-   Benchmark có số liệu thật.
-   Tài liệu giải thích trade-off.
-   Demo hoạt động.
-   Known limitations trung thực.
-   Git history/PR/Issues thể hiện quy trình phát triển.

## 22. Current project status

Khi bắt đầu một phiên làm việc mới, AI agent cần hỏi hoặc kiểm tra
repository để xác định milestone hiện tại. Không giả định M0/M1 đã hoàn
thành chỉ vì roadmap mô tả chúng.

**Default next step nếu repository chưa có code:** thực hiện M0 --
learning and technical spikes. Tạo extension skeleton tối thiểu và một
prototype đọc/chia WAV offline. Chưa tích hợp ASR, chưa làm UI phức tạp
và chưa thêm native helper.
