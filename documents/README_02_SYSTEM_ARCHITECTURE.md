# ClearVoice -- Kiến trúc tổng quát và lưu ý kỹ thuật

> Tài liệu mô tả kiến trúc mục tiêu cho MVP ClearVoice: Browser
> Extension, local-first, không yêu cầu backend server để xử lý audio
> hoặc AI.

## 1. Architectural goals

### Mục tiêu

-   Thu âm thanh từ tab trình duyệt do người dùng chủ động chọn.
-   Xử lý audio theo luồng, tránh phải chờ toàn bộ file.
-   Chạy ASR local, không upload audio lên cloud.
-   Hiển thị transcript có timestamp.
-   Đo được latency, CPU/RAM và độ chính xác.
-   Có thể thay thế model hoặc audio-processing component mà không viết
    lại toàn bộ hệ thống.
-   Có thể mở rộng sang native helper/desktop sau này.

### Không phải mục tiêu của MVP

-   Hỗ trợ mọi ứng dụng desktop như Zoom Desktop, Discord Desktop hoặc
    VLC.
-   Truy cập RTP/UDP packet bên trong mọi cuộc gọi.
-   Khôi phục chính xác audio đã mất hoàn toàn.
-   Đảm bảo realtime trên mọi máy tính.
-   Huấn luyện model ASR riêng.
-   Xây dựng cloud account, database hoặc backend SaaS.

## 2. High-level architecture

``` text
┌──────────────────────────────────────────────────────────┐
│                  Chromium Browser                        │
│                                                          │
│  ┌─────────────────┐       ┌───────────────────────────┐ │
│  │ Popup / Options │       │ Content Script / Overlay  │ │
│  │ User Controls   │       │ Subtitle Presentation     │ │
│  └────────┬────────┘       └─────────────▲─────────────┘ │
│           │                              │               │
│           ▼                              │               │
│  ┌───────────────────────────────────────┴─────────────┐ │
│  │ Background Service Worker / Extension Coordinator   │ │
│  │ Permissions · Session · Lifecycle · Message Routing │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Audio Capture Adapter                               │ │
│  │ chrome.tabCapture · MediaStream · AudioContext      │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Audio Pipeline                                       │ │
│  │ Frame Reader · Format Adapter · Chunker · Buffer     │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Local AI Runtime                                     │ │
│  │ ASR · Optional VAD · Optional Enhancement            │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Transcript Engine                                    │ │
│  │ Merge · Deduplicate · Timestamp · Partial/Final      │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                │
│                         ▼                                │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Subtitle UI / Local Settings                         │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘

       No application backend required for core processing
```

Đây là logical architecture, không phải yêu cầu mọi module phải nằm
trong cùng một JavaScript context. Khi triển khai, cần quyết định rõ
component nào chạy trong service worker, offscreen document, popup,
content script hoặc worker riêng.

## 3. Thành phần và trách nhiệm

### 3.1 Popup / Options UI

Trách nhiệm:

-   Người dùng chọn tab hoặc bắt đầu capture.
-   Chọn ngôn ngữ nguồn nếu cần.
-   Chọn model đã tải.
-   Bật/tắt phụ đề.
-   Hiển thị trạng thái capture, model loading và lỗi.
-   Cung cấp nút dừng capture.

Không xử lý audio nặng trong popup vì popup có thể đóng khi người dùng
click ra ngoài.

### 3.2 Background Service Worker

Trách nhiệm:

-   Điều phối session.
-   Nhận lệnh từ popup.
-   Quản lý trạng thái extension.
-   Điều phối capture lifecycle.
-   Gửi message giữa các thành phần.

Lưu ý: Manifest V3 service worker có lifecycle riêng và có thể bị
suspend. Không coi nó như một process chạy thường trực để giữ audio
buffer hoặc chạy inference dài hạn. Thiết kế tác vụ audio liên tục ở
context phù hợp, chẳng hạn offscreen document hoặc worker chuyên trách,
theo khả năng API của browser.

### 3.3 Audio Capture Adapter

Trách nhiệm:

-   Yêu cầu quyền capture theo thao tác của người dùng.
-   Lấy audio stream từ tab được chọn.
-   Theo dõi track state.
-   Dừng capture và giải phóng tài nguyên đúng cách.
-   Báo lỗi khi stream kết thúc hoặc quyền bị thu hồi.

Giới hạn:

-   `chrome.tabCapture` phục vụ capture tab được cấp quyền, không phải
    capture toàn bộ âm thanh hệ điều hành.
-   Không giả định extension thu được audio từ ứng dụng desktop.
-   Hành vi cần được kiểm thử trên các phiên bản Chromium được hỗ trợ.

### 3.4 Audio Pipeline

Trách nhiệm:

-   Đọc audio frames.
-   Chuẩn hóa format nội bộ.
-   Chuyển đổi channel/sample rate khi cần.
-   Chia chunk.
-   Giữ timeline và sequence number.
-   Quản lý buffer/backpressure.
-   Cung cấp metrics.

Định dạng nội bộ cần được chốt sau khi chọn ASR runtime. Một lựa chọn
thường gặp là Float32 PCM mono với sample rate mà model yêu cầu. Không
hard-code 16 kHz nếu model/runtime thực tế yêu cầu khác.

Mỗi chunk nên có metadata tối thiểu:

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

`startSample` là vị trí sample đầu tiên trong timeline của session.
Không chỉ dựa vào thời điểm message được xử lý để suy ra timestamp
audio.

### 3.5 Local AI Runtime

Trách nhiệm:

-   Load model một lần.
-   Chạy inference trên các cửa sổ audio.
-   Trả kết quả text và timestamp.
-   Có cancellation/timeout phù hợp.
-   Báo trạng thái model loading và inference.
-   Không tải lại model trên mỗi chunk.

Các lựa chọn cần benchmark:

-   ONNX Runtime Web.
-   WebGPU khi thiết bị/browser hỗ trợ.
-   WASM fallback nếu phù hợp.
-   Model ASR nhỏ hơn nếu model Whisper quá nặng.

Không quyết định model chỉ dựa trên độ chính xác. Cần đánh giá model
size, download time, RAM, CPU/GPU, latency và license.

### 3.6 Transcript Engine

Trách nhiệm:

-   Quản lý partial và final transcript.
-   Ghép kết quả từ các cửa sổ overlap.
-   Loại bỏ đoạn lặp.
-   Giữ timestamp.
-   Không để kết quả cũ ghi đè kết quả mới.
-   Phát trạng thái uncertain nếu pipeline không đủ dữ liệu.

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

Không tự tạo confidence score nếu model không cung cấp confidence có ý
nghĩa.

### 3.7 Subtitle Presentation

Trách nhiệm:

-   Hiển thị transcript theo timestamp.
-   Phân biệt partial và final.
-   Không che các control quan trọng của trang.
-   Có thể bật/tắt hoặc thay đổi vị trí.
-   Có phương án fallback nếu content script không thể inject vào một
    trang.

## 4. Data flow

1.  Người dùng chủ động chọn tab và bắt đầu capture.
2.  Extension kiểm tra quyền và tạo session.
3.  Capture adapter nhận MediaStream.
4.  Audio pipeline đọc frames và chuẩn hóa format.
5.  Chunker tạo audio chunks có sequence/timeline.
6.  Scheduler đưa audio vào ASR theo cửa sổ phù hợp.
7.  ASR trả transcript segments.
8.  Transcript Engine merge, deduplicate và ổn định kết quả.
9.  UI nhận event và cập nhật subtitle.
10. Khi dừng, pipeline ngừng nhận dữ liệu, xử lý hoặc hủy tác vụ đang
    chờ theo policy, giải phóng stream và model resources nếu cần.

## 5. Streaming và backpressure

Không dùng queue không giới hạn.

Cần xác định:

-   Giới hạn queue theo số chunk hoặc số mili giây audio.
-   Số inference task đồng thời.
-   Chính sách khi inference chậm.
-   Chính sách khi người dùng dừng session.
-   Cách xử lý chunk đến trễ.
-   Cách quan sát backlog.

Đối với phụ đề realtime, một chính sách có thể là ưu tiên dữ liệu mới và
đánh dấu rõ khoảng audio bị bỏ qua. Tuy nhiên, phải đánh giá tác động
lên transcript trước khi chọn.

Không được âm thầm bỏ audio rồi hiển thị transcript như thể liên tục và
đầy đủ.

## 6. Latency model

End-to-end latency có thể phân rã thành:

``` text
Capture delay
+ frame/chunk accumulation
+ queue waiting time
+ preprocessing
+ model inference
+ transcript stabilization
+ UI rendering
```

Đo riêng từng thành phần để biết bottleneck nằm ở đâu.

Nên báo cáo P50 và P95, không chỉ average. Mục tiêu latency ban đầu là
mục tiêu thử nghiệm, không phải cam kết sản phẩm; chỉ đặt con số sau khi
đo trên phần cứng xác định.

## 7. Model strategy

### MVP

-   Chọn một model ASR có thể chạy local trong browser.
-   Ưu tiên model nhỏ để kiểm chứng pipeline.
-   Download model khi người dùng yêu cầu hoặc qua bước setup rõ ràng.
-   Hiển thị dung lượng và trạng thái tải.
-   Cache model trên thiết bị nếu license và cơ chế lưu trữ cho phép.

### Sau MVP

-   Thử VAD để giảm inference trên đoạn im lặng.
-   Benchmark enhancement trước/sau.
-   Thử dịch local.
-   Đánh giá model quantization.
-   So sánh WebGPU và WASM.

Không train model riêng trong giai đoạn đầu.

## 8. Error handling và lifecycle

Các tình huống bắt buộc kiểm thử:

-   Người dùng từ chối quyền.
-   Tab bị đóng.
-   Track kết thúc bất ngờ.
-   Người dùng chuyển tab.
-   Popup bị đóng.
-   Service worker bị suspend/restart.
-   Model chưa tải xong.
-   Model load thất bại.
-   Inference bị treo hoặc lỗi.
-   Queue đầy.
-   Bộ nhớ gần giới hạn.
-   Browser không hỗ trợ API cần thiết.
-   Máy không có WebGPU.
-   Người dùng dừng capture khi inference đang chạy.

Mỗi lỗi cần có trạng thái có thể quan sát được và hướng xử lý hợp lý.
Không để UI báo "đang chạy" khi capture đã dừng.

## 9. Privacy và security

-   Capture chỉ bắt đầu sau hành động rõ ràng của người dùng.
-   Có chỉ báo capture đang hoạt động.
-   Không ghi audio mặc định.
-   Không upload audio hoặc transcript trong MVP.
-   Không yêu cầu permission rộng hơn mức cần thiết.
-   Không đưa transcript/audio vào logs.
-   Không yêu cầu người dùng đính kèm dữ liệu cuộc gọi khi tạo GitHub
    Issue.
-   Nếu có telemetry trong tương lai, phải opt-in, tài liệu hóa dữ liệu
    thu thập và có cách tắt.
-   Tuân thủ Chrome Web Store policies và quyền riêng tư của các
    website/người tham gia cuộc gọi.

## 10. Testing strategy

### Unit tests

-   Chunk boundary và sequence.
-   Resampling/format conversion.
-   Timestamp calculations.
-   Transcript merge/deduplication.
-   Queue limit và drop policy.
-   Session state transitions.

### Integration tests

-   Tab capture đến audio pipeline.
-   Audio pipeline đến ASR.
-   ASR đến transcript engine.
-   Transcript engine đến subtitle UI.

### Audio fixtures

Dùng các audio sample có transcript/ground truth hợp pháp. Có thể tạo
biến thể noisy/dropout từ audio sạch để benchmark.

Giữ manifest mô tả:

-   File ID.
-   Sample rate.
-   Channels.
-   Duration.
-   Language.
-   Transcript reference.
-   Transformation condition.
-   License/source.

Không commit dataset có bản quyền hoặc dung lượng lớn vào repository nếu
chưa có quyền phân phối.

### Performance tests

-   Warm-up riêng.
-   Đo P50/P95 latency.
-   Đo CPU/RAM.
-   Đo queue depth.
-   Đo dropped chunks.
-   So sánh model và runtime trên cùng điều kiện.

## 11. Deployment model

MVP không cần application server.

Phân phối:

1.  Source code trên GitHub.
2.  CI chạy lint, typecheck và tests.
3.  Build extension package.
4.  Release package và changelog.
5.  Publish Chrome Web Store hoặc cung cấp build thử nghiệm có hướng
    dẫn.
6.  Người dùng gửi feedback qua GitHub Issues.

Cần lưu ý Chrome Web Store review, developer account requirements, chính
sách và thời gian cập nhật. Không coi GitHub là kênh tự động cập nhật
extension cho người dùng cuối.

## 12. Khi nào cần Native Helper?

Chỉ cân nhắc native helper nếu có nhu cầu đã được xác minh, ví dụ:

-   Capture audio hệ thống ngoài browser.
-   Cần xử lý nền ổn định hơn giới hạn browser.
-   Cần tận dụng native audio API.
-   Cần dùng Go Core/Python Worker vì browser runtime không đáp ứng hiệu
    năng.

Native helper làm tăng độ phức tạp cài đặt, ký/đóng gói, tương thích OS
và Native Messaging. Không thêm chỉ để dùng thêm ngôn ngữ.

## 13. Architecture decision principles

1.  MVP nhỏ, đo được, chạy được.
2.  Local-first; không có server dependency cho core processing.
3.  Model là component có thể thay thế.
4.  Capture, processing, inference và presentation có ranh giới rõ.
5.  Mọi queue đều có giới hạn.
6.  Mọi session đều có lifecycle và cleanup.
7.  Không che giấu dữ liệu bị mất.
8.  Không suy diễn packet loss từ waveform.
9.  Không tuyên bố realtime nếu chưa benchmark.
10. Chỉ thêm abstraction khi có nhu cầu thực tế.

## 14. Known limitations

-   Browser extension không capture mọi âm thanh của hệ điều hành.
-   `tabCapture` không đảm bảo hoạt động giống nhau trên mọi
    website/browser.
-   Browser local inference có thể tốn RAM, CPU/GPU và thời gian tải
    model.
-   Whisper sliding-window có thể tạo transcript lặp hoặc thay đổi trước
    khi ổn định.
-   Audio-level dropout không chứng minh RTP packet loss.
-   Context-based reconstruction có thể sai và phải được đánh dấu là suy
    luận.
