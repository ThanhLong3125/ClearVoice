/**
 * AudioStreamProcessor: Low-latency AudioWorkletProcessor running on the dedicated Audio Thread.
 * Extracts 128-sample audio frames and transfers them to the Offscreen Pipeline via zero-copy message transfer.
 */
class AudioStreamProcessor extends AudioWorkletProcessor {
  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true; // Keep alive
    }

    const channelCount = input.length;
    const channels = [];
    const transferables = [];

    for (let c = 0; c < channelCount; c++) {
      const channelData = input[c];
      if (channelData && channelData.length > 0) {
        // Clone into fresh buffer for zero-copy transfer
        const clone = new Float32Array(channelData);
        channels.push(clone);
        transferables.push(clone.buffer);
      }
    }

    if (channels.length > 0) {
      this.port.postMessage({ channels }, transferables);
    }

    return true;
  }
}

registerProcessor("audio-stream-processor", AudioStreamProcessor);
