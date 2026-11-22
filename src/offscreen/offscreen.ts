import { MessageType, type ExtensionMessage } from "../types/messages";
import { AudioPipeline } from "../audio/pipeline";
import type { AudioChunk, TranscriptSegment } from "../types/audio";
import type { WorkerInMessage, WorkerOutMessage } from "./asr-worker";

let currentStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let currentSessionId: string | null = null;
let analyserNode: AnalyserNode | null = null;
let workletNode: AudioWorkletNode | null = null;
let volumeInterval: number | null = null;
let pipeline: AudioPipeline | null = null;
let consumerLoopActive: boolean = false;

// Dedicated Web Worker for ASR so WASM never blocks the Extension UI thread
let asrWorker: Worker | null = null;
let workerState: "idle" | "loading" | "ready" | "error" = "idle";
let nextRequestId = 1;
const pendingRequests = new Map<number, (segment: TranscriptSegment | null) => void>();
let lastProgressSentAt = 0;

function ensureAsrWorker(): void {
  if (!asrWorker) {
    asrWorker = new Worker(new URL("./asr-worker.ts", import.meta.url), { type: "module" });
    asrWorker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === "PROGRESS") {
        if (workerState !== "loading") return;
        const now = performance.now();
        if (now - lastProgressSentAt < 150 && msg.progress.progress < 100) {
          return;
        }
        lastProgressSentAt = now;
        chrome.runtime.sendMessage<ExtensionMessage>({
          type: MessageType.MODEL_STATUS,
          status: "loading",
          progress: msg.progress.progress,
          file: msg.progress.file,
        }).catch(() => {});
      } else if (msg.type === "READY") {
        workerState = "ready";
        chrome.runtime.sendMessage<ExtensionMessage>({
          type: MessageType.MODEL_STATUS,
          status: "ready",
          device: msg.device,
        }).catch(() => {});
      } else if (msg.type === "ERROR") {
        workerState = "error";
        chrome.runtime.sendMessage<ExtensionMessage>({
          type: MessageType.MODEL_STATUS,
          status: "error",
          error: msg.error,
        }).catch(() => {});
      } else if (msg.type === "RESULT") {
        const resolver = pendingRequests.get(msg.requestId);
        if (resolver) {
          pendingRequests.delete(msg.requestId);
          resolver(msg.segment);
        }
      }
    };
  }

  if (workerState !== "ready" && workerState !== "loading") {
    workerState = "loading";
    asrWorker.postMessage({ type: "INIT" } satisfies WorkerInMessage);
  }
}

function transcribeInWorker(chunk: AudioChunk): Promise<TranscriptSegment | null> {
  return new Promise((resolve) => {
    if (!asrWorker || workerState !== "ready") {
      resolve(null);
      return;
    }
    const requestId = nextRequestId++;
    pendingRequests.set(requestId, resolve);
    asrWorker.postMessage({
      type: "TRANSCRIBE",
      requestId,
      chunk,
    } satisfies WorkerInMessage);
  });
}

/**
 * Dedicated Consumer Loop: Pulls audio chunks from bounded queue and dispatches them to the ASR Web Worker.
 */
async function runAsrConsumerLoop(): Promise<void> {
  if (consumerLoopActive) return;
  consumerLoopActive = true;
  console.log("[ClearVoice Offscreen] ASR Consumer Loop started.");

  while (consumerLoopActive) {
    if (workerState === "ready" && pipeline) {
      const chunk = pipeline.nextChunk();
      if (chunk) {
        try {
          const segment = await transcribeInWorker(chunk);
          if (segment && segment.text) {
            console.log(`[ClearVoice ASR] Subtitle emitted: "${segment.text}"`);
            chrome.runtime.sendMessage<ExtensionMessage>({
              type: MessageType.TRANSCRIPT_UPDATE,
              segment,
            }).catch(() => {});
          }
        } catch (err) {
          console.error("[ClearVoice ASR] Error in consumer loop:", err);
        }
        continue;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  console.log("[ClearVoice Offscreen] ASR Consumer Loop stopped.");
}

/**
 * Start capturing audio from tab MediaStream ID.
 */
async function handleInitAudioCapture(streamId: string, sessionId: string): Promise<void> {
  try {
    currentSessionId = sessionId;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      } as unknown as MediaTrackConstraints,
      video: false,
    });

    currentStream = stream;

    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        console.warn("[ClearVoice Offscreen] Audio track ended unexpectedly.");
        stopAudioCapture();
      };
    });

    audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaStreamSource(stream);

    // 1. Passthrough so user hears tab audio normally
    sourceNode.connect(audioContext.destination);

    // 2. Real-time volume & pipeline stats (throttled to 250ms to keep IPC & Popup responsive)
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    sourceNode.connect(analyserNode);

    const buffer = new Float32Array(analyserNode.fftSize);

    volumeInterval = window.setInterval(() => {
      if (!analyserNode) return;
      analyserNode.getFloatTimeDomainData(buffer);

      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
      }
      const rms = Math.sqrt(sum / buffer.length);
      const volume = Math.min(100, Math.round(rms * 250));

      chrome.runtime.sendMessage<ExtensionMessage>({
        type: MessageType.AUDIO_VOLUME,
        volume,
        rms: Number(rms.toFixed(4)),
      }).catch(() => {});

      if (pipeline) {
        const stats = pipeline.getStats();
        chrome.runtime.sendMessage<ExtensionMessage>({
          type: MessageType.PIPELINE_METRICS,
          totalChunks: stats.totalEmittedChunks,
          durationSec: Number((stats.totalEmittedChunks * 2.5).toFixed(1)),
          queueDepth: stats.queueMetrics.currentDepth,
          queueCapacity: stats.queueMetrics.maxCapacity,
          isSpeechActive: stats.isSpeechActive,
          silenceChunksFiltered: stats.silenceChunksFiltered,
        }).catch(() => {});
      }
    }, 250);

    // 3. Initialize AudioWorklet & Audio Processing Pipeline
    const workletUrl = chrome.runtime.getURL("audio-processor.js");
    await audioContext.audioWorklet.addModule(workletUrl);
    workletNode = new AudioWorkletNode(audioContext, "audio-stream-processor");

    // 4. Warm up Local AI ASR Engine in background Web Worker
    ensureAsrWorker();

    pipeline = new AudioPipeline(sessionId, {
      sourceSampleRate: audioContext.sampleRate,
      targetSampleRate: 16000,
      windowDurationSec: 3.2,
      hopDurationSec: 3.2,
      maxQueueCapacity: 2,
      onChunkReady: (chunk) => {
        console.log(
          `[ClearVoice Pipeline] Phrase Chunk #${chunk.sequence} | Duration: ${(chunk.samples.length / 16000).toFixed(2)}s | Timeline: ${(chunk.startSample / 16000).toFixed(2)}s`
        );
      },
    });

    runAsrConsumerLoop();

    workletNode.port.onmessage = (event: MessageEvent<{ channels: Float32Array[] }>) => {
      if (pipeline && event.data && event.data.channels) {
        pipeline.pushFrames(event.data.channels);
      }
    };

    sourceNode.connect(workletNode);

    console.log(
      `[ClearVoice Offscreen] Audio capture & pipeline active. Source: ${audioContext.sampleRate}Hz, Target: 16000Hz mono. Session: ${sessionId}`
    );
  } catch (err) {
    console.error("[ClearVoice Offscreen] Failed to start audio capture:", err);
    chrome.runtime.sendMessage<ExtensionMessage>({
      type: MessageType.STATUS_UPDATE,
      state: "error",
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
  }
}

/**
 * Stop capturing audio, release tracks, and close AudioContext.
 */
function stopAudioCapture(): void {
  consumerLoopActive = false;
  if (volumeInterval) {
    clearInterval(volumeInterval);
    volumeInterval = null;
  }

  if (pipeline) {
    console.log("[ClearVoice Offscreen] Final pipeline stats:", pipeline.getStats());
    pipeline.reset();
    pipeline = null;
  }

  if (workletNode) {
    workletNode.port.onmessage = null;
    workletNode.disconnect();
    workletNode = null;
  }

  if (analyserNode) {
    analyserNode.disconnect();
    analyserNode = null;
  }

  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }

  if (audioContext && audioContext.state !== "closed") {
    audioContext.close();
    audioContext = null;
  }

  chrome.runtime.sendMessage<ExtensionMessage>({
    type: MessageType.AUDIO_VOLUME,
    volume: 0,
    rms: 0,
  }).catch(() => {});

  console.log(`[ClearVoice Offscreen] Audio resources released for session: ${currentSessionId ?? "none"}`);
  currentSessionId = null;
}

// Listen for commands from Service Worker
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  switch (message.type) {
    case MessageType.INIT_AUDIO_CAPTURE:
      handleInitAudioCapture(message.streamId, message.sessionId);
      break;

    case MessageType.STOP_AUDIO_CAPTURE:
      stopAudioCapture();
      break;
  }
});
