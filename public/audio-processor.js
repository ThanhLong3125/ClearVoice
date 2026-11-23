/**
 * AudioStreamProcessor: Low-latency AudioWorkletProcessor running on the dedicated Audio Thread.
 * Batches 128-sample render quanta into 2048-sample mono blocks (~42.6ms @ 48kHz)
 * to reduce main-thread message overhead by 16x and halve memory transfer.
 */
const BATCH_SIZE = 2048;

class AudioStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.monoBuffer = new Float32Array(BATCH_SIZE);
    this.writeOffset = 0;
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const ch0 = input[0];
    if (!ch0 || ch0.length === 0) {
      return true;
    }

    const ch1 = input.length > 1 ? input[1] : null;
    const len = ch0.length;

    for (let i = 0; i < len; i++) {
      this.monoBuffer[this.writeOffset++] = ch1 ? (ch0[i] + ch1[i]) * 0.5 : ch0[i];
      if (this.writeOffset >= BATCH_SIZE) {
        const chunk = this.monoBuffer;
        this.port.postMessage({ channels: [chunk] }, [chunk.buffer]);
        this.monoBuffer = new Float32Array(BATCH_SIZE);
        this.writeOffset = 0;
      }
    }

    return true;
  }
}

registerProcessor("audio-stream-processor", AudioStreamProcessor);
