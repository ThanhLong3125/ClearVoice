import { downmixToMono } from "./format";
import { StreamResampler } from "./resampler";
import { SlidingWindowChunker, type SlidingWindowConfig } from "./chunker";
import { BoundedQueue, type QueueMetrics } from "./queue";
import { EnergyVad } from "./vad";
import type { AudioChunk } from "../types/audio";

export interface AudioPipelineConfig {
  sourceSampleRate: number; // e.g. 48000
  targetSampleRate: number; // e.g. 16000
  windowDurationSec: number;// e.g. 3.0
  hopDurationSec: number;   // e.g. 1.0
  maxQueueCapacity: number; // e.g. 5
  vadThresholdRms?: number; // default: 0.003
  onChunkReady?: (chunk: AudioChunk) => void;
}

/**
 * AudioPipeline: Coordinates format conversion, streaming resampling,
 * VAD silence filtering, sliding-window chunking, and backpressure queueing.
 */
export class AudioPipeline {
  private readonly resampler: StreamResampler;
  private readonly chunker: SlidingWindowChunker;
  private readonly queue: BoundedQueue<AudioChunk>;
  private readonly vad: EnergyVad;
  private readonly onChunkReady?: (chunk: AudioChunk) => void;

  private totalInputFrames: number = 0;
  private totalEmittedChunks: number = 0;
  private silenceChunksFiltered: number = 0;

  constructor(sessionId: string, config: AudioPipelineConfig) {
    this.resampler = new StreamResampler(config.sourceSampleRate, config.targetSampleRate);

    const chunkerConfig: SlidingWindowConfig = {
      sampleRate: config.targetSampleRate,
      windowDurationSec: config.windowDurationSec,
      hopDurationSec: config.hopDurationSec,
    };
    this.chunker = new SlidingWindowChunker(sessionId, chunkerConfig);
    this.queue = new BoundedQueue<AudioChunk>(config.maxQueueCapacity);
    this.vad = new EnergyVad({ thresholdRms: config.vadThresholdRms ?? 0.003 });
    this.onChunkReady = config.onChunkReady;
  }

  /**
   * Feed raw multi-channel audio frames (e.g. from AudioWorklet) into the pipeline.
   */
  public pushFrames(channels: Float32Array[]): void {
    if (channels.length === 0) return;
    this.totalInputFrames += channels[0].length;

    // 1. Downmix stereo -> mono
    const mono = downmixToMono(channels);

    // 2. Continuous resampling (e.g. 48kHz -> 16kHz)
    const resampled = this.resampler.process(mono);

    // 3. Sliding window chunking
    const newChunks = this.chunker.push(resampled);

    // 4. VAD silence filtering before queueing
    for (const chunk of newChunks) {
      const vadResult = this.vad.process(chunk.samples);
      if (!vadResult.isActive) {
        // Drop pure silence chunk to protect AI from hallucination and preserve queue capacity
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

  /**
   * Check if speech activity is currently active.
   */
  public isSpeechActive(): boolean {
    return this.vad.speechActive;
  }

  /**
   * Dequeue next chunk for AI inference.
   */
  public nextChunk(): AudioChunk | undefined {
    return this.queue.dequeue();
  }

  /**
   * Diagnostic statistics.
   */
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

  /**
   * Reset pipeline for clean stop.
   */
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
