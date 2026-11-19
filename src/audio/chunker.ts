import type { AudioChunk } from "../types/audio";

export interface SlidingWindowConfig {
  sampleRate: number;        // e.g. 16000
  windowDurationSec: number; // e.g. 3.0s
  hopDurationSec: number;    // e.g. 1.0s (overlap = window - hop = 2.0s)
}

/**
 * SlidingWindowChunker: Buffers streaming audio samples and emits overlapping AudioChunks.
 */
export class SlidingWindowChunker {
  private readonly sessionId: string;
  private readonly sampleRate: number;
  private readonly windowSizeSamples: number;
  private readonly hopSizeSamples: number;

  private buffer: Float32Array;
  private bufferLength: number = 0;
  private sequence: number = 0;
  private currentSampleOffset: number = 0; // Absolute start sample in session timeline

  constructor(sessionId: string, config: SlidingWindowConfig) {
    this.sessionId = sessionId;
    this.sampleRate = config.sampleRate;
    this.windowSizeSamples = Math.round(config.windowDurationSec * config.sampleRate);
    this.hopSizeSamples = Math.round(config.hopDurationSec * config.sampleRate);

    // Pre-allocate buffer capacity (at least 2x window size)
    this.buffer = new Float32Array(this.windowSizeSamples * 4);
  }

  /**
   * Push incoming audio samples and return any complete chunks ready for inference.
   */
  public push(samples: Float32Array): AudioChunk[] {
    if (samples.length === 0) return [];

    // Ensure capacity
    if (this.bufferLength + samples.length > this.buffer.length) {
      const newCap = Math.max(this.buffer.length * 2, this.bufferLength + samples.length + 1024);
      const newBuf = new Float32Array(newCap);
      newBuf.set(this.buffer.subarray(0, this.bufferLength));
      this.buffer = newBuf;
    }

    // Append new samples
    this.buffer.set(samples, this.bufferLength);
    this.bufferLength += samples.length;

    const chunks: AudioChunk[] = [];

    // Extract complete windows
    while (this.bufferLength >= this.windowSizeSamples) {
      const chunkSamples = new Float32Array(this.windowSizeSamples);
      chunkSamples.set(this.buffer.subarray(0, this.windowSizeSamples));

      chunks.push({
        sessionId: this.sessionId,
        sequence: this.sequence++,
        startSample: this.currentSampleOffset,
        sampleRate: this.sampleRate,
        channels: 1,
        format: "f32",
        samples: chunkSamples,
        capturedAtMonotonicMs: performance.now(),
      });

      // Advance by hop size (sliding window)
      this.currentSampleOffset += this.hopSizeSamples;
      const remaining = this.bufferLength - this.hopSizeSamples;
      this.buffer.copyWithin(0, this.hopSizeSamples, this.bufferLength);
      this.bufferLength = remaining;
    }

    return chunks;
  }

  /**
   * Reset the chunker for a new session.
   */
  public reset(): void {
    this.bufferLength = 0;
    this.sequence = 0;
    this.currentSampleOffset = 0;
  }
}
