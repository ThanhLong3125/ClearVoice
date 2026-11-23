import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { downmixToMono } from "../src/audio/format";
import { StreamResampler } from "../src/audio/resampler";
import { SlidingWindowChunker } from "../src/audio/chunker";
import { BoundedQueue } from "../src/audio/queue";
import { AudioPipeline } from "../src/audio/pipeline";

describe("AudioPipeline & DSP Modules", () => {
  it("downmixToMono averages stereo channels accurately", () => {
    const left = new Float32Array([0.4, -0.4, 1.0]);
    const right = new Float32Array([0.2, 0.4, -1.0]);
    const mono = downmixToMono([left, right]);
    assert.equal(mono.length, 3);
    assert.ok(Math.abs(mono[0] - 0.3) < 1e-6);
    assert.ok(Math.abs(mono[1] - 0.0) < 1e-6);
    assert.ok(Math.abs(mono[2] - 0.0) < 1e-6);
  });

  it("StreamResampler preserves 1kHz sine wave and attenuates 12kHz aliasing frequency (48kHz -> 16kHz)", () => {
    const resampler = new StreamResampler(48000, 16000);
    const totalSamples = 4800; // 100ms @ 48kHz
    const lowFreq = new Float32Array(totalSamples);
    const highFreq = new Float32Array(totalSamples);

    for (let i = 0; i < totalSamples; i++) {
      lowFreq[i] = Math.sin((2 * Math.PI * 1000 * i) / 48000);
      highFreq[i] = Math.sin((2 * Math.PI * 12000 * i) / 48000);
    }

    const outLow = resampler.process(lowFreq);
    resampler.reset();
    const outHigh = resampler.process(highFreq);

    // 4800 samples at 3:1 ratio => 1600 samples
    assert.equal(outLow.length, 1600);

    const rms = (arr: Float32Array) => {
      let s = 0;
      for (let i = 64; i < arr.length; i++) s += arr[i] * arr[i];
      return Math.sqrt(s / (arr.length - 64));
    };

    // 1kHz passband signal should retain strong amplitude (~0.707 RMS)
    assert.ok(rms(outLow) > 0.55, `Expected 1kHz passband RMS > 0.55, got ${rms(outLow)}`);
    // 12kHz stopband signal (> 8kHz Nyquist) must be heavily attenuated by FIR low-pass filter
    assert.ok(rms(outHigh) < 0.08, `Expected 12kHz aliasing RMS < 0.08, got ${rms(outHigh)}`);
  });

  it("SlidingWindowChunker cuts cleanly at natural pauses after minimum speech duration", () => {
    const chunker = new SlidingWindowChunker("sess_1", {
      sampleRate: 16000,
      windowDurationSec: 3.0,
      minChunkDurationSec: 1.4,
      pauseDurationMs: 280,
      speechThresholdRms: 0.004,
    });

    // 1.5s of active speech (16000 * 1.5 = 24000 samples) followed by 0.35s silence (5600 samples)
    const speech = new Float32Array(24000);
    for (let i = 0; i < speech.length; i++) {
      speech[i] = 0.15 * Math.sin((2 * Math.PI * 440 * i) / 16000);
    }
    const silence = new Float32Array(5600);

    assert.equal(chunker.push(speech).length, 0);
    const emitted = chunker.push(silence);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].sessionId, "sess_1");
    assert.equal(emitted[0].sequence, 0);
    assert.ok(emitted[0].samples.length >= 24000);
  });

  it("BoundedQueue drops oldest item when capacity is exceeded", () => {
    const q = new BoundedQueue<number>(2);
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);

    const drained = q.drainAll();
    assert.deepEqual(drained, [2, 3]);
    assert.equal(q.getMetrics().droppedCount, 1);
  });

  it("AudioPipeline coalesces short consecutive chunks within 4.2s budget", () => {
    const pipeline = new AudioPipeline("sess_coalesce", {
      sourceSampleRate: 16000,
      targetSampleRate: 16000,
      windowDurationSec: 3.0,
      minChunkDurationSec: 1.4,
      pauseDurationMs: 280,
      maxQueueCapacity: 4,
    });

    const makePhrase = () => {
      const phrase = new Float32Array(24000 + 5600);
      for (let i = 0; i < 24000; i++) {
        phrase[i] = 0.2 * Math.sin((2 * Math.PI * 300 * i) / 16000);
      }
      return phrase;
    };

    pipeline.pushFrames([makePhrase()]);
    pipeline.pushFrames([makePhrase()]);

    const merged = pipeline.nextChunk();
    assert.ok(merged);
    assert.ok(merged.samples.length > 40000);
  });
});

describe("Unicode Hallucination & Repetition Filter", () => {
  it("collapses 3+ consecutive Vietnamese and English phrase repetitions", () => {
    const UNICODE_WORD = "[\\p{L}\\p{M}\\p{N}]+";
    const REPETITION_REGEX = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])(${UNICODE_WORD}(?:[\\s,]+${UNICODE_WORD}){0,3})(?:[\\s,]+\\1){2,}(?![\\p{L}\\p{M}\\p{N}])`,
      "giu"
    );
    const clean = (raw: string) =>
      raw
        .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(REPETITION_REGEX, "$1")
        .trim();

    assert.equal(clean("bây giờ, bây giờ, bây giờ"), "bây giờ");
    assert.equal(clean("xin chào các bạn, xin chào các bạn, xin chào các bạn"), "xin chào các bạn");
    assert.equal(clean("[Music] (nhạc) cảm ơn cảm ơn cảm ơn"), "cảm ơn");
    assert.equal(clean("hello world hello world hello world"), "hello world");
  });
});
