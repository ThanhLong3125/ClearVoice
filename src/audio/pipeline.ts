import { downmixToMono } from "./format";
import { StreamResampler } from "./resampler";
import { SlidingWindowChunker, type SlidingWindowConfig } from "./chunker";
import { BoundedQueue, type QueueMetrics } from "./queue";
import type { AudioChunk } from "../types/audio";

export interface AudioPipelineConfig {
  sourceSampleRate: number;     // e.g. 48000
  targetSampleRate: number;     // e.g. 16000
  windowDurationSec: number;    // Max chunk duration (e.g. 3.0s)
  minChunkDurationSec?: number; // e.g. 1.4s
  pauseDurationMs?: number;     // e.g. 280ms
  maxQueueCapacity: number;     // e.g. 4
  vadThresholdRms?: number;     // default: 0.004
  onChunkReady?: (chunk: AudioChunk) => void;
}

/**
 * AudioPipeline: Coordinates format conversion, anti-aliased streaming resampling,
 * adaptive VAD-pause segmentation (0% overlap), and low-latency drop-stale queueing.
 */
export class AudioPipeline {
  private readonly resampler: StreamResampler;
  private readonly chunker: SlidingWindowChunker;
  private readonly queue: BoundedQueue<AudioChunk>;
  private readonly targetSampleRate: number;
  private readonly maxCoalescedSamples: number;
  private readonly minSpeechRms: number;
  private readonly onChunkReady?: (chunk: AudioChunk) => void;

  private totalInputFrames: number = 0;
  private totalEmittedChunks: number = 0;
  private silenceChunksFiltered: number = 0;

  constructor(sessionId: string, config: AudioPipelineConfig) {
    this.targetSampleRate = config.targetSampleRate;
    this.maxCoalescedSamples = Math.round(4.2 * config.targetSampleRate);
    this.minSpeechRms = (config.vadThresholdRms ?? 0.004) * 0.75;
    this.resampler = new StreamResampler(config.sourceSampleRate, config.targetSampleRate);

    const chunkerConfig: SlidingWindowConfig = {
      sampleRate: config.targetSampleRate,
      windowDurationSec: config.windowDurationSec,
      minChunkDurationSec: config.minChunkDurationSec ?? 1.4,
      pauseDurationMs: config.pauseDurationMs ?? 280,
      speechThresholdRms: config.vadThresholdRms ?? 0.004,
    };
    this.chunker = new SlidingWindowChunker(sessionId, chunkerConfig);
    this.queue = new BoundedQueue<AudioChunk>(config.maxQueueCapacity);
    this.onChunkReady = config.onChunkReady;
  }

  /**
   * Feed raw multi-channel audio frames (from AudioWorklet) into the pipeline.
   */
  public pushFrames(channels: Float32Array[]): void {
    if (channels.length === 0) return;
    this.totalInputFrames += channels[0].length;

    // 1. Downmix stereo -> mono (no-op copy if worklet already downmixed to 1 channel)
    const mono = downmixToMono(channels);

    // 2. Continuous FIR anti-aliased resampling (e.g. 48kHz -> 16kHz)
    const resampled = this.resampler.process(mono);

    // 3. Dynamic adaptive VAD-pause & minimum-energy valley segmentation (0% overlap)
    const newChunks = this.chunker.push(resampled);

    for (const chunk of newChunks) {
      if (AudioPipeline.computeRms(chunk.samples) < this.minSpeechRms) {
        this.silenceChunksFiltered++;
        continue;
      }

      this.totalEmittedChunks++;
      this.queue.enqueue(chunk);
      if (this.onChunkReady) {
        this.onChunkReady(chunk);
      }
    }
  }

  private static computeRms(samples: Float32Array): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  /**
   * Dequeue the latest speech for AI inference:
   * - If 1 chunk is waiting, returns it immediately.
   * - If multiple short chunks arrived while AI was busy and their combined duration <= 4.2s,
   *   coalesces them into one contiguous phrase so no words are lost AND latency stays real-time.
   * - If total queued audio exceeds 4.2s, drops the oldest chunk(s) and keeps the most recent speech.
   */
  public nextChunk(): AudioChunk | undefined {
    const pending = this.queue.drainAll();
    if (pending.length === 0) return undefined;
    if (pending.length === 1) return pending[0];

    // Walk backwards from the newest chunk, keeping as many recent chunks as fit within 4.2s
    const kept: AudioChunk[] = [];
    let totalSamples = 0;

    for (let i = pending.length - 1; i >= 0; i--) {
      const candidate = pending[i];
      if (kept.length === 0 || totalSamples + candidate.samples.length <= this.maxCoalescedSamples) {
        kept.unshift(candidate);
        totalSamples += candidate.samples.length;
      } else {
        this.queue.recordDropped(1);
      }
    }

    if (kept.length === 1) {
      return kept[0];
    }

    // Merge contiguous kept chunks into a single phrase chunk
    const mergedSamples = new Float32Array(totalSamples);
    let offset = 0;
    for (const c of kept) {
      mergedSamples.set(c.samples, offset);
      offset += c.samples.length;
    }

    const first = kept[0];
    const last = kept[kept.length - 1];
    return {
      sessionId: first.sessionId,
      sequence: last.sequence,
      startSample: first.startSample,
      sampleRate: this.targetSampleRate,
      channels: 1,
      format: "f32",
      samples: mergedSamples,
      capturedAtMonotonicMs: last.capturedAtMonotonicMs,
    };
  }

  public getStats(): {
    totalInputFrames: number;
    totalEmittedChunks: number;
    silenceChunksFiltered: number;
    queueMetrics: QueueMetrics;
  } {
    return {
      totalInputFrames: this.totalInputFrames,
      totalEmittedChunks: this.totalEmittedChunks,
      silenceChunksFiltered: this.silenceChunksFiltered,
      queueMetrics: this.queue.getMetrics(),
    };
  }

  public reset(): void {
    this.resampler.reset();
    this.chunker.reset();
    this.queue.clear();
    this.totalInputFrames = 0;
    this.totalEmittedChunks = 0;
    this.silenceChunksFiltered = 0;
  }
}
