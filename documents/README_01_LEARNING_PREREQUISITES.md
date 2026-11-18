# ClearVoice -- Kiến thức cần học trước khi triển khai

> Mục đích: tài liệu học tập dành cho người phát triển có nền tảng
> Backend nhưng chưa có nhiều kinh nghiệm về xử lý âm thanh số, ASR và
> streaming audio.
>
> Nguyên tắc: **không cần học hết mọi thứ trước khi code**. Học theo
> từng chặng, hoàn thành bài tập nhỏ rồi áp dụng ngay vào ClearVoice.

## 1. ClearVoice đang giải quyết bài toán gì?

ClearVoice là project cá nhân theo hướng local-first: thu âm thanh từ
một tab trình duyệt, xử lý audio theo luồng, nhận dạng giọng nói bằng mô
hình chạy local và hiển thị transcript/phụ đề.

Phạm vi MVP được khuyến nghị:

1.  Chạy trên Chromium browser.
2.  Người dùng chủ động chọn tab và bật capture.
3.  Thu âm thanh đầu ra của tab được cấp quyền.
4.  Chuyển audio thành định dạng nội bộ nhất quán.
5.  Chia audio thành chunk và đưa vào pipeline.
6.  Chạy speech-to-text local.
7.  Hiển thị transcript có timestamp.
8.  Đo latency, tài nguyên và độ chính xác.

Các tính năng như dịch tiếng Việt, khử nhiễu, phát hiện packet loss,
transcript recovery và hỗ trợ desktop là phần mở rộng, không phải điều
kiện để MVP được xem là hoàn thành.

## 2. Lộ trình học tổng thể

  ------------------------------------------------------------------------------
  Thứ tự           Chủ đề                           Mức ưu tiên Kết quả cần đạt
  ---------------- ---------------------- --------------------- ----------------
  1                TypeScript và Chrome                     Cao Tạo extension,
                   Extension                                    hiểu lifecycle
                                                                và permissions

  2                Digital Audio                            Cao Đọc và hiểu
                   Fundamentals                                 PCM/WAV, sample
                                                                rate, channels

  3                Web Audio API và                         Cao Capture audio
                   capture                                      tab và đọc audio
                                                                frames

  4                Streaming và                             Cao Hiểu chunk,
                   concurrency                                  buffer, queue,
                                                                backpressure

  5                ASR / Whisper                            Cao Chạy model local
                                                                và hiểu đầu ra

  6                Transcript/timestamp                     Cao Ghép kết quả
                                                                thành phụ đề ổn
                                                                định

  7                Testing và                               Cao Đo latency, WER,
                   benchmarking                                 CPU/RAM

  8                VAD và denoising                  Trung bình Giảm đoạn im
                                                                lặng, thử cải
                                                                thiện audio

  9                WebRTC/RTP/network                Trung bình Hiểu giới hạn
                   impairment                                   packet loss và
                                                                dropout

  10               Translation và                    Thấp ở MVP Mở rộng sau khi
                   recovery                                     pipeline ổn định
  ------------------------------------------------------------------------------

## 3. TypeScript và Chrome Extension

### Cần nắm

-   TypeScript cơ bản: type, interface, union, generics ở mức sử dụng.
-   Promise, async/await, event loop.
-   Message passing giữa extension components.
-   Chrome Extension Manifest V3.
-   `service_worker`, `content_scripts`, popup/options page.
-   Permissions và host permissions.
-   Tab lifecycle và service worker lifecycle.
-   `chrome.tabCapture` và giới hạn của nó.
-   Content Security Policy của extension.

### Cần thực hành

-   Tạo một extension Manifest V3 tối giản.
-   Hiển thị danh sách tab hoặc cho người dùng chọn tab.
-   Bắt đầu/dừng capture bằng thao tác rõ ràng của người dùng.
-   Hiển thị trạng thái capture.
-   Gửi message giữa popup và background/service worker.
-   Dừng stream khi tab đóng hoặc người dùng tắt capture.

### Tài liệu tham khảo

-   Chrome Extensions: https://developer.chrome.com/docs/extensions/
-   `tabCapture`:
    https://developer.chrome.com/docs/extensions/reference/api/tabCapture
-   Manifest V3:
    https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3/
-   TypeScript Handbook:
    https://www.typescriptlang.org/docs/handbook/intro.html

## 4. Digital Audio Fundamentals

Đây là nền tảng để tránh xử lý sai dữ liệu âm thanh.

### Khái niệm cần hiểu

  -----------------------------------------------------------------------
  Khái niệm                           Ý nghĩa
  ----------------------------------- -----------------------------------
  Sample                              Một giá trị đo biên độ tín hiệu tại
                                      một thời điểm

  Sample rate                         Số sample mỗi giây, ví dụ 16 kHz
                                      hoặc 48 kHz

  Channel                             Số kênh âm thanh: mono hoặc stereo

  Bit depth                           Số bit dùng biểu diễn mỗi sample
                                      trong định dạng PCM integer

  PCM                                 Dữ liệu âm thanh thô đã số hóa

  WAV                                 Container thường dùng để lưu PCM

  Float32                             Dạng sample dấu phẩy động thường
                                      gặp trong Web Audio API

  Resampling                          Chuyển audio từ sample rate này
                                      sang sample rate khác

  Clipping                            Tín hiệu bị cắt do vượt biên độ
                                      biểu diễn

  RMS                                 Thước đo mức năng lượng/âm lượng
                                      trung bình

  SNR                                 Tỷ số tín hiệu trên nhiễu

  Silence/dropout                     Đoạn im lặng hoặc mất tín hiệu
  -----------------------------------------------------------------------

### Các điểm dễ nhầm

-   WAV không đồng nghĩa với PCM; WAV là container, có thể chứa nhiều
    codec.
-   Sample rate không phải bitrate.
-   Stereo không phải lúc nào cũng tốt hơn mono cho ASR.
-   Đổi metadata sample rate không giống resampling thực sự.
-   Không được bỏ qua timestamp hoặc số sample khi chia chunk.
-   Nếu model yêu cầu 16 kHz mono thì phải chuyển đổi dữ liệu đúng cách,
    không chỉ khai báo lại sample rate.

### Bài tập

1.  Tạo hoặc tải một file WAV hợp pháp để thử nghiệm.
2.  Đọc sample rate, channel count, duration.
3.  Vẽ waveform.
4.  Chuyển stereo thành mono.
5.  Resample từ 48 kHz sang 16 kHz bằng thư viện phù hợp.
6.  Chia audio thành các chunk có thời lượng cố định.
7.  Ghép các chunk và so sánh với file gốc.

### Công cụ gợi ý

-   Web Audio API:
    https://developer.mozilla.org/docs/Web/API/Web_Audio_API
-   FFmpeg: https://ffmpeg.org/documentation.html
-   NumPy: https://numpy.org/doc/
-   SoundFile: https://python-soundfile.readthedocs.io/
-   Librosa: https://librosa.org/doc/latest/

## 5. Web Audio API và Audio Capture

### Cần hiểu

-   `MediaStream`
-   `MediaStreamTrack`
-   `AudioContext`
-   `AudioWorklet`
-   `AudioNode`
-   `AudioBuffer`
-   `AudioWorkletProcessor`
-   Sample rate của `AudioContext`
-   Quyền capture và vòng đời stream

Ưu tiên tìm hiểu `AudioWorklet` cho xử lý audio theo luồng. Tránh xây
dựng pipeline realtime dựa trên `ScriptProcessorNode` vì API này đã lỗi
thời.

### Bài tập

-   Capture audio từ một tab bằng `chrome.tabCapture`.
-   Đưa stream vào Web Audio graph.
-   Đọc các frame audio.
-   Theo dõi sample rate và số channel.
-   Dừng toàn bộ track đúng cách.
-   Kiểm tra trường hợp tab bị đóng hoặc capture bị thu hồi.

### Tài liệu

-   AudioWorklet:
    https://developer.mozilla.org/docs/Web/API/AudioWorklet
-   MediaStream: https://developer.mozilla.org/docs/Web/API/MediaStream
-   Web Audio API:
    https://developer.mozilla.org/docs/Web/API/Web_Audio_API

## 6. Streaming, Buffer và Backpressure

Đây là phần liên hệ trực tiếp với tư duy Backend.

### Khái niệm cần học

-   Producer--Consumer
-   Queue và bounded queue
-   Ring/Circular Buffer
-   Chunking
-   Buffer ownership
-   Backpressure
-   Latency và throughput
-   Concurrency và synchronization
-   Cancellation
-   Graceful shutdown
-   Dropping policy

### Ví dụ bài toán

Audio capture tạo dữ liệu nhanh hơn tốc độ ASR xử lý. Nếu cứ đưa dữ liệu
vào queue không giới hạn, bộ nhớ sẽ tăng mãi và phụ đề ngày càng trễ.

Bạn cần xác định:

-   Queue tối đa bao nhiêu audio hoặc bao nhiêu mili giây?
-   Khi queue đầy thì chặn producer, bỏ chunk cũ hay giảm tải?
-   Có được phép bỏ chunk không?
-   Nếu bỏ chunk, transcript phải biểu thị khoảng trống thế nào?
-   Làm sao không phát sinh memory leak?
-   Làm sao dừng pipeline mà không để worker treo?

Không có một chính sách phù hợp cho mọi tình huống. Hãy ghi lại lý do
lựa chọn và đo kết quả.

## 7. Speech-to-Text và Whisper

### Cần hiểu

-   ASR (Automatic Speech Recognition)
-   Inference và pretrained model
-   Batch transcription và streaming-like transcription
-   Sliding window
-   Overlap
-   Partial/final transcript
-   Timestamp
-   Word Error Rate (WER)
-   Model size, quantization và compute type

Whisper/faster-whisper là lựa chọn tốt để làm baseline. Tuy nhiên,
Whisper không phải API streaming native theo nghĩa nhận kết quả ổn định
ngay sau từng frame audio. Có thể xây dựng trải nghiệm gần realtime bằng
cửa sổ trượt, overlap và cơ chế ổn định transcript.

### Bài tập

1.  Chạy một model ASR trên file WAV.
2.  Lấy text và timestamp.
3.  Thử với audio sạch và audio có tiếng ồn.
4.  Đo thời gian inference.
5.  Thử nhiều model size nếu phần cứng cho phép.
6.  Tạo sliding-window prototype.
7.  Phát hiện và xử lý đoạn transcript trùng lặp.

### Tài liệu

-   Whisper: https://github.com/openai/whisper
-   faster-whisper: https://github.com/SYSTRAN/faster-whisper
-   Hugging Face Audio Course:
    https://huggingface.co/learn/audio-course/

## 8. Transcript và Subtitle Engine

Không nên xem transcript chỉ là một chuỗi text.

Một segment nên có ít nhất:

-   ID ổn định.
-   Start/end timestamp.
-   Text.
-   Language.
-   Trạng thái partial/final.
-   Nguồn audio hoặc sequence number để truy vết.
-   Confidence nếu model thực sự cung cấp giá trị có ý nghĩa.

Cần xử lý:

-   Transcript trùng do overlap.
-   Kết quả đến trễ hoặc sai thứ tự.
-   Partial transcript thay đổi.
-   Final transcript không bị ghi đè bởi partial cũ.
-   Timestamp nhất quán với timeline audio gốc.

Không tự đặt confidence giả nếu model không cung cấp confidence đáng tin
cậy.

## 9. VAD, Noise Suppression và Audio Quality

Các nội dung này chỉ nên học sâu sau khi ASR cơ bản hoạt động.

### VAD

Voice Activity Detection xác định đoạn có giọng nói và đoạn không có
giọng nói. Có thể dùng để giảm xử lý các đoạn im lặng, nhưng cần tránh
cắt mất âm đầu/cuối của từ.

### Noise suppression

Tìm hiểu RNNoise hoặc các giải pháp noise suppression phù hợp với môi
trường browser. Không giả định rằng audio đã khử nhiễu luôn giúp ASR tốt
hơn.

### Quality metrics

Có thể đo:

-   RMS/energy.
-   Clipping ratio.
-   Silence/dropout duration.
-   SNR nếu có cách ước lượng phù hợp.
-   Queue depth.
-   Processing latency.

Không được gọi một khoảng im lặng là packet loss nếu không có bằng chứng
ở tầng mạng.

## 10. Networking và WebRTC -- học sau MVP

Cần hiểu:

-   UDP và TCP.
-   RTP/RTCP.
-   Jitter.
-   Packet loss.
-   Packet reordering.
-   Jitter buffer.
-   Packet Loss Concealment (PLC).
-   WebRTC statistics.

Phân biệt hai loại thử nghiệm:

1.  **Audio-level dropout:** sửa waveform để tạo đoạn im lặng/mất tín
    hiệu.
2.  **Network-level packet loss:** làm suy giảm luồng mạng bằng công cụ
    mô phỏng như `tc netem` trong môi trường kiểm thử.

Nếu chỉ thu âm thanh đầu ra của tab, extension thường không có quyền
truy cập trực tiếp vào RTP packet hoặc WebRTC stats của mọi website.
Không được tuyên bố đo packet loss thực tế chỉ từ waveform.

## 11. Testing và Benchmarking

### Bộ chỉ số nên có

  Metric                   Mục đích
  ------------------------ -----------------------------------------
  WER                      Độ chính xác ASR
  End-to-end latency       Thời gian từ audio đến transcript
  P50/P95 latency          Phân bố độ trễ
  Real-time factor (RTF)   Thời gian xử lý so với thời lượng audio
  CPU utilization          Mức sử dụng CPU
  Peak RAM                 Bộ nhớ cao nhất
  Queue depth              Mức backlog
  Dropped chunks           Số chunk bị bỏ
  Recovery time            Thời gian phục hồi sau lỗi

### Nguyên tắc benchmark

-   Dùng cùng audio fixture khi so sánh.
-   Ghi rõ model, model version, compute backend và cấu hình.
-   Tách warm-up khỏi số đo chính.
-   Lặp lại nhiều lần.
-   Không so sánh kết quả từ máy khác nhau như thể điều kiện giống nhau.
-   Không đưa số liệu minh họa thành kết quả thật.

## 12. Thứ tự học và tiêu chí sẵn sàng

Bạn có thể bắt đầu MVP khi làm được các việc sau:

-   [ ] Tạo được Chrome Extension Manifest V3.
-   [ ] Giải thích được cách xin quyền và capture audio tab.
-   [ ] Hiểu PCM, sample rate, channel và resampling.
-   [ ] Đọc được audio frame và chia chunk.
-   [ ] Biết cách quản lý stream lifecycle.
-   [ ] Chạy được một model ASR trên audio sample.
-   [ ] Hiểu latency và queue backlog.

Không cần biết trước toàn bộ VAD, denoising, WebRTC hoặc translation.

## 13. Nguyên tắc học

1.  Học để giải quyết một vấn đề cụ thể trong milestone hiện tại.
2.  Ưu tiên prototype nhỏ có thể đo và kiểm thử.
3.  Không train model khi pretrained model đáp ứng mục tiêu.
4.  Đọc tài liệu chính thức trước khi dựa vào blog hoặc câu trả lời AI.
5.  Ghi lại điều chưa biết và giả định chưa được kiểm chứng.
6.  Không thêm công nghệ chỉ để làm stack trông ấn tượng.
