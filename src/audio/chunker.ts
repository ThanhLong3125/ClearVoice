import type { AudioChunk } from "../types/audio";

export interface SlidingWindowConfig {
  sampleRate: number;           // e.g. 16000
  windowDurationSec: number;    // Max chunk duration before forced valley cut (e.g. 3.0s)
  minChunkDurationSec?: number; // Minimum speech duration before pause cut (default: 1.4s)
  pauseDurationMs?: number;     // Natural breath/pause duration to trigger endpoint cut (default: 280ms)
  speechThresholdRms?: number;  // Initial/floor RMS threshold to enter/maintain speech (default: 0.004)
}

/**
 * SlidingWindowChunker (Dynamic Adaptive-Noise VAD-Pause & Minimum-Energy Valley Chunker):
 * - Eliminates fixed-clock mid-word slicing and overlap.
 * - Continuously tracks ambient noise floor so background music or quiet speakers adapt automatically.
 * - Accumulates active speech and cuts cleanly at natural pauses (>= 280ms silence after >= 1.4s speech).
 * - If continuous speech reaches max duration (e.g. 3.0s), searches the last 0.45s for the lowest-energy
 *   32ms valley (syllable boundary) and cuts there with 0% overlap.
 */
export class SlidingWindowChunker {
  private readonly sessionId: number | string;
  private readonly sampleRate: number;
  private readonly maxWindowSamples: number;
  private readonly minWindowSamples: number;
  private readonly frameSamples: number; // 32ms frame = 512 samples @ 16kHz
  private readonly pauseFramesRequired: number;
  private readonly speechThresholdRms: number;
  private readonly preRollSamples: number; // 160ms pre-roll so initial consonant is never clipped

  private buffer: Float32Array;
  private bufferLength: number = 0;
  private sequence: number = 0;
  private currentSampleOffset: number = 0;

  private inSpeech: boolean = false;
  private consecutiveSilentFrames: number = 0;
  private inspectedOffset: number = 0;
  private noiseFloorRms: number;

  constructor(sessionId: string, config: SlidingWindowConfig) {
    this.sessionId = sessionId;
    this.sampleRate = config.sampleRate;
    this.maxWindowSamples = Math.round((config.windowDurationSec || 3.0) * config.sampleRate);
    this.minWindowSamples = Math.round((config.minChunkDurationSec ?? 1.4) * config.sampleRate);
    this.frameSamples = Math.round(0.032 * config.sampleRate); // 512 samples @ 16kHz
    const pauseMs = config.pauseDurationMs ?? 280;
    this.pauseFramesRequired = Math.max(4, Math.round(pauseMs / 32));
    this.speechThresholdRms = config.speechThresholdRms ?? 0.004;
    this.noiseFloorRms = this.speechThresholdRms * 0.5;
    this.preRollSamples = this.frameSamples * 5; // ~160ms pre-roll

    this.buffer = new Float32Array(this.maxWindowSamples * 4);
  }

  /**
   * Push incoming 16kHz mono samples and emit complete, non-overlapping phrase chunks.
   */
  public push(samples: Float32Array): AudioChunk[] {
    if (samples.length === 0) return [];

    if (this.bufferLength + samples.length > this.buffer.length) {
      const newCap = Math.max(this.buffer.length * 2, this.bufferLength + samples.length + 2048);
      const newBuf = new Float32Array(newCap);
      newBuf.set(this.buffer.subarray(0, this.bufferLength));
      this.buffer = newBuf;
    }

    this.buffer.set(samples, this.bufferLength);
    this.bufferLength += samples.length;

    const chunks: AudioChunk[] = [];

    while (this.inspectedOffset + this.frameSamples <= this.bufferLength) {
      const frameStart = this.inspectedOffset;
      const frameEnd = frameStart + this.frameSamples;
      const rms = this.computeRms(frameStart, frameEnd);
      this.inspectedOffset = frameEnd;

      // Adaptive noise floor tracking: fast decay toward quiet frames, slow rise during sustained background noise
      if (rms < this.noiseFloorRms) {
        this.noiseFloorRms = 0.85 * this.noiseFloorRms + 0.15 * rms;
      } else {
        this.noiseFloorRms = 0.995 * this.noiseFloorRms + 0.005 * Math.min(rms, 0.04);
      }
      const dynamicThreshold = Math.max(this.speechThresholdRms, Math.min(0.06, this.noiseFloorRms * 2.2));

      if (rms >= dynamicThreshold) {
        this.inSpeech = true;
        this.consecutiveSilentFrames = 0;
      } else if (this.inSpeech) {
        this.consecutiveSilentFrames++;
      } else {
        // Not in speech yet: trim leading dead silence, keeping only 160ms pre-roll
        if (this.inspectedOffset > this.preRollSamples) {
          const trimCount = this.inspectedOffset - this.preRollSamples;
          this.discardPrefix(trimCount);
        }
        continue;
      }

      // Condition 1: Natural breath/clause pause detected after minimum speech duration
      if (
        this.inSpeech &&
        this.consecutiveSilentFrames >= this.pauseFramesRequired &&
        this.inspectedOffset >= this.minWindowSamples
      ) {
        chunks.push(this.emitSlice(this.inspectedOffset));
        continue;
      }

      // Condition 2: Continuous speech reached maxWindowSamples without a full pause
      // Search backwards over the last 0.45s for the lowest-energy 32ms syllable boundary
      if (this.inSpeech && this.inspectedOffset >= this.maxWindowSamples) {
        const cutIndex = this.findMinimumEnergyCutIndex(this.inspectedOffset);
        chunks.push(this.emitSlice(cutIndex));
      }
    }

    return chunks;
  }

  private computeRms(start: number, end: number): number {
    let sum = 0;
    const len = end - start;
    if (len <= 0) return 0;
    for (let i = start; i < end; i++) {
      const v = this.buffer[i];
      sum += v * v;
    }
    return Math.sqrt(sum / len);
  }

  /**
   * Finds the quietest 32ms window in the last ~0.45s before `maxIndex` so we never slice mid-vowel.
   */
  private findMinimumEnergyCutIndex(maxIndex: number): number {
    const searchSpan = Math.round(0.45 * this.sampleRate); // 7,200 samples
    const minSearchStart = Math.max(this.minWindowSamples, maxIndex - searchSpan);

    let bestCutEnd = maxIndex;
    let lowestRms = Infinity;

    for (let pos = minSearchStart; pos + this.frameSamples <= maxIndex; pos += this.frameSamples) {
      const rms = this.computeRms(pos, pos + this.frameSamples);
      if (rms <= lowestRms) {
        lowestRms = rms;
        bestCutEnd = pos + this.frameSamples;
      }
    }

    return bestCutEnd;
  }

  private emitSlice(cutLength: number): AudioChunk {
    const chunkSamples = new Float32Array(cutLength);
    chunkSamples.set(this.buffer.subarray(0, cutLength));

    const chunk: AudioChunk = {
      sessionId: String(this.sessionId),
      sequence: this.sequence++,
      startSample: this.currentSampleOffset,
      sampleRate: this.sampleRate,
      channels: 1,
      format: "f32",
      samples: chunkSamples,
      capturedAtMonotonicMs: performance.now(),
    };

    this.discardPrefix(cutLength);
    this.inSpeech = false;
    this.consecutiveSilentFrames = 0;
    return chunk;
  }

  private discardPrefix(count: number): void {
    const remaining = this.bufferLength - count;
    if (remaining > 0) {
      this.buffer.copyWithin(0, count, this.bufferLength);
    }
    this.bufferLength = Math.max(0, remaining);
    this.inspectedOffset = Math.max(0, this.inspectedOffset - count);
    this.currentSampleOffset += count;
  }

  /**
   * Reset the chunker for a new session.
   */
  public reset(): void {
    this.bufferLength = 0;
    this.sequence = 0;
    this.currentSampleOffset = 0;
    this.inSpeech = false;
    this.consecutiveSilentFrames = 0;
    this.inspectedOffset = 0;
    this.noiseFloorRms = this.speechThresholdRms * 0.5;
  }
}
