import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { downmixToMono } from "../src/audio/format";
import { StreamResampler } from "../src/audio/resampler";
import { SlidingWindowChunker } from "../src/audio/chunker";
import { BoundedQueue } from "../src/audio/queue";
import { AudioPipeline } from "../src/audio/pipeline";
import { VoiceBandpassFilter } from "../src/audio/filter";

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

  it("VoiceBandpassFilter attenuates 60Hz sub-bass and preserves 1000Hz vocal formant", () => {
    const filter = new VoiceBandpassFilter(16000, 260, 3400);
    const samples = 1600; // 100ms
    const bass = new Float32Array(samples);
    const vocal = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
      bass[i] = Math.sin((2 * Math.PI * 60 * i) / 16000);
      vocal[i] = Math.sin((2 * Math.PI * 1000 * i) / 16000);
    }

    const bassOut = filter.process(bass);
    filter.reset();
    const vocalOut = filter.process(vocal);

    const computeRms = (arr: Float32Array) => {
      let sum = 0;
      for (let i = 200; i < arr.length; i++) sum += arr[i] * arr[i];
      return Math.sqrt(sum / (arr.length - 200));
    };

    const bassRms = computeRms(bassOut);
    const vocalRms = computeRms(vocalOut);

    // 60Hz kick/bass must be attenuated heavily (< 0.1 RMS from initial 0.707)
    assert.ok(bassRms < 0.1, `Expected bass RMS < 0.1, got ${bassRms}`);
    // 1000Hz vocal formant must be preserved (> 0.6 RMS from initial 0.707)
    assert.ok(vocalRms > 0.6, `Expected vocal RMS > 0.6, got ${vocalRms}`);
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

  it("SlidingWindowChunker preserves stride overlap on continuous speech forced cuts", () => {
    const chunker = new SlidingWindowChunker("sess_forced", {
      sampleRate: 16000,
      windowDurationSec: 2.0, // 32,000 samples max
      minChunkDurationSec: 1.0,
      pauseDurationMs: 280,
      speechThresholdRms: 0.004,
      forcedOverlapDurationSec: 0.35, // 5,600 samples overlap
    });

    // Feed 2.5s of continuous active speech with no pauses
    const speech = new Float32Array(40000);
    for (let i = 0; i < speech.length; i++) {
      speech[i] = 0.2 * Math.sin((2 * Math.PI * 500 * i) / 16000);
    }

    const emitted = chunker.push(speech);
    assert.equal(emitted.length, 1);
    const chunk1 = emitted[0];
    assert.ok(chunk1.samples.length >= 24000);

    // Feed another 1.0s speech followed by silence to trigger chunk 2
    const speech2 = new Float32Array(16000);
    for (let i = 0; i < speech2.length; i++) {
      speech2[i] = 0.2 * Math.sin((2 * Math.PI * 500 * i) / 16000);
    }
    const silence = new Float32Array(5600);
    chunker.push(speech2);
    const emitted2 = chunker.push(silence);
    assert.equal(emitted2.length, 1);
    const chunk2 = emitted2[0];

    // Chunk 2's startSample should overlap before chunk 1's end
    const chunk1End = chunk1.startSample + chunk1.samples.length;
    assert.ok(chunk2.startSample < chunk1End, `Chunk 2 start (${chunk2.startSample}) should overlap before Chunk 1 end (${chunk1End})`);
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

  it("AudioPipeline coalesces short consecutive chunks and assigns dynamic token budget", () => {
    const pipeline = new AudioPipeline("sess_coalesce", {
      sourceSampleRate: 16000,
      targetSampleRate: 16000,
      windowDurationSec: 3.0,
      minChunkDurationSec: 1.4,
      pauseDurationMs: 280,
      maxQueueCapacity: 6,
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
    assert.equal(merged.isCongested, true);
    assert.equal(merged.maxNewTokens, 32);
  });
});

describe("Unicode Hallucination & Repetition Filter", () => {
  it("collapses 3+ consecutive Vietnamese and English phrase repetitions and removes CJK on English/Vietnamese", () => {
    const UNICODE_WORD = "[\\p{L}\\p{M}\\p{N}]+";
    const REPETITION_REGEX = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}])(${UNICODE_WORD}(?:[\\s,]+${UNICODE_WORD}){0,3})(?:[\\s,]+\\1){2,}(?![\\p{L}\\p{M}\\p{N}])`,
      "giu"
    );
    const CHAR_REPEAT_REGEX = /(.)\1{2,}/gu;
    const CJK_HALLUCINATION_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/gu;

    const clean = (raw: string, targetLanguage?: string) => {
      let cleaned = raw.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
      if (!cleaned || /^[\p{P}\p{S}\s]+$/u.test(cleaned)) {
        return "";
      }
      if (targetLanguage === "en" || targetLanguage === "vi") {
        cleaned = cleaned.replace(CJK_HALLUCINATION_REGEX, " ").replace(/\s+/g, " ").trim();
        if (!cleaned) return "";
      }
      cleaned = cleaned.replace(CHAR_REPEAT_REGEX, "$1");
      cleaned = cleaned.replace(REPETITION_REGEX, "$1");
      return cleaned.trim();
    };

    assert.equal(clean("bây giờ, bây giờ, bây giờ"), "bây giờ");
    assert.equal(clean("xin chào các bạn, xin chào các bạn, xin chào các bạn"), "xin chào các bạn");
    assert.equal(clean("[Music] (nhạc) cảm ơn cảm ơn cảm ơn"), "cảm ơn");
    assert.equal(clean("hello world hello world hello world"), "hello world");
    // Test the exact bug from user's screenshot
    assert.equal(clean("I, 介紹紹紹紹紹紹紹紹紹紹紹紹紹紹紹紹紹紹y介紹紹", "en"), "I, y");
    assert.equal(clean("모르", "en"), "");
  });
});
