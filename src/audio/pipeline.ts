import { downmixToMono } from "./format";
import { StreamResampler } from "./resampler";
import { SlidingWindowChunker, type SlidingWindowConfig } from "./chunker";
import { BoundedQueue, type QueueMetrics } from "./queue";
import { EnergyVad } from "./vad";
import type { AudioChunk } from "../types/audio";

export interface AudioPipelineConfig {
  sourceSampleRate: number; // e.g. 48000
  targetSampleRate: number; // e.g. 16000
  windowDurationSec: number;// Max chunk duration (e.g. 3.2s)
  hopDurationSec: number;   // Kept for interface compatibility
  maxQueueCapacity: number; // e.g. 2
  vadThresholdRms?: number; // default: 0.004
  onChunkReady?: (chunk: AudioChunk) => void;
}

/**
 * AudioPipeline: Coordinates format conversion, streaming resampling,
 * dynamic VAD-pause segmentation (0% overlap), and low-latency drop-stale queueing.
 */
export class AudioPipeline {
  private readonly resampler: StreamResampler;
  private readonly chunker: SlidingWindowChunker;
  private readonly queue: BoundedQueue<AudioChunk>;
  private readonly vad: EnergyVad;
  private readonly targetSampleRate: number;
  private readonly maxCoalescedSamples: number;
  private readonly onChunkReady?: (chunk: AudioChunk) => void;

  private totalInputFrames: number = 0;
  private totalEmittedChunks: number = 0;
  private silenceChunksFiltered: number = 0;

  constructor(sessionId: string, config: AudioPipelineConfig) {
    this.targetSampleRate = config.targetSampleRate;
    this.maxCoalescedSamples = Math.round(2.2 * config.targetSampleRate);
    this.resampler = new StreamResampler(config.sourceSampleRate, config.targetSampleRate);

    const chunkerConfig: SlidingWindowConfig = {
      sampleRate: config.targetSampleRate,
      windowDurationSec: config.windowDurationSec,
      hopDurationSec: config.hopDurationSec,
      speechThresholdRms: config.vadThresholdRms ?? 0.004,
    };
    this.chunker = new SlidingWindowChunker(sessionId, chunkerConfig);
    this.queue = new BoundedQueue<AudioChunk>(config.maxQueueCapacity);
    this.vad = new EnergyVad({ thresholdRms: config.vadThresholdRms ?? 0.004, hangoverMs: 400 });
    this.onChunkReady = config.onChunkReady;
  }

  /**
   * Feed raw multi-channel audio frames (from AudioWorklet) into the pipeline.
   */
  public pushFrames(channels: Float32Array[]): void {
    if (channels.length === 0) return;
    this.totalInputFrames += channels[0].length;

    // 1. Downmix stereo -> mono
    const mono = downmixToMono(channels);

    // 2. Update live VAD state indicator on incoming audio
    this.vad.process(mono);

    // 3. Continuous resampling (e.g. 48kHz -> 16kHz)
    const resampled = this.resampler.process(mono);

    // 4. Dynamic VAD-pause & minimum-energy valley segmentation (0% overlap)
    const newChunks = this.chunker.push(resampled);

    for (const chunk of newChunks) {
      const vadCheck = this.vad.process(chunk.samples);
      if (!vadCheck.isActive && vadCheck.rms < 0.003) {
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

  public isSpeechActive(): boolean {
    return this.vad.speechActive;
  }

  /**
   * Dequeue the latest speech for AI inference:
   * - If 1 chunk is waiting, returns it immediately.
   * - If 2 short chunks arrived while AI was busy and their combined duration <= 3.5s,
   *   coalesces them into one contiguous phrase so no words are lost AND latency stays real-time.
   * - If total queued audio exceeds 3.5s, drops the oldest chunk(s) and returns only the newest chunk.
   */
  public nextChunk(): AudioChunk | undefined {
    const pending = this.queue.drainAll();
    if (pending.length === 0) return undefined;
    if (pending.length === 1) return pending[0];

    // Walk backwards from the newest chunk, keeping as many recent chunks as fit within 3.5s
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
    isSpeechActive: boolean;
    queueMetrics: QueueMetrics;
  } {
    return {
      totalInputFrames: this.totalInputFrames,
      totalEmittedChunks: this.totalEmittedChunks,
      silenceChunksFiltered: this.silenceChunksFiltered,
      isSpeechActive: this.vad.speechActive,
      queueMetrics: this.queue.getMetrics(),
    };
  }

  public reset(): void {
    this.resampler.reset();
    this.chunker.reset();
    this.queue.clear();
    this.vad.reset();
    this.totalInputFrames = 0;
    this.totalEmittedChunks = 0;
    this.silenceChunksFiltered = 0;
  }
}
