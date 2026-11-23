import { MessageType, type ExtensionMessage } from "../types/messages";
import { AudioPipeline } from "../audio/pipeline";
import type { AudioChunk, TranscriptSegment } from "../types/audio";
import type { WorkerInMessage, WorkerOutMessage } from "./asr-worker";

let currentStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let currentSessionId: string | null = null;
let workletNode: AudioWorkletNode | null = null;
let pipeline: AudioPipeline | null = null;
let loopGeneration: number = 0;
let chunkWakeResolver: (() => void) | null = null;
let selectedLanguage: string = "auto";

// Dedicated Web Worker for ASR so WASM never blocks the Extension UI thread
let asrWorker: Worker | null = null;
let workerState: "idle" | "loading" | "ready" | "error" = "idle";
let nextRequestId = 1;
const pendingRequests = new Map<number, { resolve: (segment: TranscriptSegment | null) => void; timer: number }>();
let lastProgressSentAt = 0;
let workerRestartAttempts = 0;

const TRANSCRIBE_TIMEOUT_MS = 12000;

function flushPendingRequests(): void {
  for (const [, entry] of pendingRequests) {
    clearTimeout(entry.timer);
    entry.resolve(null);
  }
  pendingRequests.clear();
}

function handleWorkerCrash(reason: string): void {
  workerState = "error";
  flushPendingRequests();
  if (asrWorker) {
    try {
      asrWorker.terminate();
    } catch {
      // Ignore terminate errors
    }
    asrWorker = null;
  }

  chrome.runtime.sendMessage<ExtensionMessage>({
    type: MessageType.MODEL_STATUS,
    status: "error",
    error: reason,
  }).catch(() => {});

  if (currentSessionId && workerRestartAttempts < 3) {
    const backoffMs = 1000 * Math.pow(2, workerRestartAttempts++);
    setTimeout(() => {
      if (currentSessionId) {
        ensureAsrWorker();
      }
    }, backoffMs);
  }
}

function ensureAsrWorker(): void {
  if (!asrWorker) {
    asrWorker = new Worker(new URL("./asr-worker.ts", import.meta.url), { type: "module" });
    asrWorker.onerror = (err) => {
      console.error("[ClearVoice Offscreen] ASR Worker error:", err);
      handleWorkerCrash(err.message || "Lỗi khởi tạo ASR Worker");
    };
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
        workerRestartAttempts = 0;
        console.log(`[ClearVoice Offscreen] ASR Worker READY on device: ${msg.device}`);
        chrome.runtime.sendMessage<ExtensionMessage>({
          type: MessageType.MODEL_STATUS,
          status: "ready",
          device: msg.device,
        }).catch(() => {});
        if (chunkWakeResolver) {
          const wake = chunkWakeResolver;
          chunkWakeResolver = null;
          wake();
        }
      } else if (msg.type === "ERROR") {
        handleWorkerCrash(msg.error);
      } else if (msg.type === "PARTIAL") {
        if (msg.segment && msg.segment.text && msg.segment.sessionId === currentSessionId) {
          chrome.runtime.sendMessage<ExtensionMessage>({
            type: MessageType.TRANSCRIPT_UPDATE,
            segment: msg.segment,
          }).catch(() => {});
        }
      } else if (msg.type === "RESULT") {
        const entry = pendingRequests.get(msg.requestId);
        if (entry) {
          clearTimeout(entry.timer);
          pendingRequests.delete(msg.requestId);
          entry.resolve(msg.segment);
        }
      }
    };
  }

  if (workerState !== "ready" && workerState !== "loading") {
    workerState = "loading";
    chrome.runtime.sendMessage<ExtensionMessage>({
      type: MessageType.MODEL_STATUS,
      status: "loading",
      progress: 0,
      file: "whisper-tiny",
    }).catch(() => {});
    asrWorker.postMessage({ type: "INIT", language: selectedLanguage } satisfies WorkerInMessage);
  }
}

function transcribeInWorker(chunk: AudioChunk): Promise<TranscriptSegment | null> {
  return new Promise((resolve) => {
    if (!asrWorker || workerState !== "ready") {
      resolve(null);
      return;
    }
    const requestId = nextRequestId++;
    const timer = window.setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        console.warn(`[ClearVoice Offscreen] ASR request #${requestId} timed out after ${TRANSCRIBE_TIMEOUT_MS}ms`);
        resolve(null);
      }
    }, TRANSCRIBE_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, timer });
    asrWorker.postMessage({
      type: "TRANSCRIBE",
      requestId,
      chunk,
    } satisfies WorkerInMessage);
  });
}

/**
 * Dedicated Consumer Loop: Pulls audio chunks from bounded queue and dispatches them to the ASR Web Worker.
 * Uses generation token and event wakeup so stop/start cycles never spawn duplicate loops or leak stale segments.
 */
async function runAsrConsumerLoop(): Promise<void> {
  const myGen = ++loopGeneration;
  const mySessionId = currentSessionId;
  console.log(`[ClearVoice Offscreen] ASR Consumer Loop #${myGen} started for session ${mySessionId}.`);

  while (myGen === loopGeneration) {
    if (workerState === "ready" && pipeline) {
      const chunk = pipeline.nextChunk();
      if (chunk) {
        try {
          const segment = await transcribeInWorker(chunk);
          if (
            myGen === loopGeneration &&
            segment &&
            segment.text &&
            segment.sessionId === currentSessionId
          ) {
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

    await new Promise<void>((resolve) => {
      const fallbackTimer = window.setTimeout(() => {
        if (chunkWakeResolver === wake) {
          chunkWakeResolver = null;
        }
        resolve();
      }, 200);
      const wake = () => {
        clearTimeout(fallbackTimer);
        resolve();
      };
      chunkWakeResolver = wake;
    });
  }
  console.log(`[ClearVoice Offscreen] ASR Consumer Loop #${myGen} stopped.`);
}

/**
 * Start capturing audio from tab MediaStream ID.
 */
async function handleInitAudioCapture(streamId: string, sessionId: string, language?: string): Promise<void> {
  // Release any previous session resources first
  if (currentStream || audioContext) {
    stopAudioCapture(false);
  }

  currentSessionId = sessionId;
  if (language) {
    selectedLanguage = language;
  }

  // Immediately start warming up the Local AI ASR Engine in background Web Worker
  ensureAsrWorker();
  if (asrWorker && language) {
    asrWorker.postMessage({ type: "SET_LANGUAGE", language } satisfies WorkerInMessage);
  }

  try {
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
        stopAudioCapture(true);
      };
    });

    audioContext = new AudioContext();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    const sourceNode = audioContext.createMediaStreamSource(stream);

    // 1. Passthrough so user hears tab audio normally
    sourceNode.connect(audioContext.destination);

    // 2. Initialize AudioWorklet & Audio Processing Pipeline
    const workletUrl = chrome.runtime.getURL("audio-processor.js");
    await audioContext.audioWorklet.addModule(workletUrl);
    workletNode = new AudioWorkletNode(audioContext, "audio-stream-processor");

    pipeline = new AudioPipeline(sessionId, {
      sourceSampleRate: audioContext.sampleRate,
      targetSampleRate: 16000,
      windowDurationSec: 3.0,
      minChunkDurationSec: 1.4,
      pauseDurationMs: 280,
      maxQueueCapacity: 4,
      onChunkReady: (chunk) => {
        console.log(
          `[ClearVoice Pipeline] Phrase Chunk #${chunk.sequence} | Duration: ${(chunk.samples.length / 16000).toFixed(2)}s | Timeline: ${(chunk.startSample / 16000).toFixed(2)}s`
        );
        if (chunkWakeResolver) {
          const wake = chunkWakeResolver;
          chunkWakeResolver = null;
          wake();
        }
      },
    });

    void runAsrConsumerLoop();

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
    stopAudioCapture(false);
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ClearVoice Offscreen] Failed to start audio capture:", message);
    throw new Error(message);
  }
}

/**
 * Stop capturing audio, release tracks, and close AudioContext.
 */
function stopAudioCapture(notifyIdle: boolean = false): void {
  loopGeneration++;
  if (chunkWakeResolver) {
    const wake = chunkWakeResolver;
    chunkWakeResolver = null;
    wake();
  }
  flushPendingRequests();

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

  if (currentStream) {
    currentStream.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    currentStream = null;
  }

  if (audioContext && audioContext.state !== "closed") {
    void audioContext.close();
    audioContext = null;
  }

  const endedSession = currentSessionId;
  currentSessionId = null;
  console.log(`[ClearVoice Offscreen] Audio resources released for session: ${endedSession ?? "none"}`);

  if (notifyIdle && endedSession) {
    chrome.runtime.sendMessage<ExtensionMessage>({
      type: MessageType.STATUS_UPDATE,
      state: "idle",
    }).catch(() => {});
  }
}

// Listen for commands from Service Worker
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case MessageType.INIT_AUDIO_CAPTURE:
      handleInitAudioCapture(message.streamId, message.sessionId, message.language)
        .then(() => sendResponse({ ok: true }))
        .catch((err: unknown) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
        );
      return true;

    case MessageType.STOP_AUDIO_CAPTURE:
      stopAudioCapture(false);
      sendResponse({ ok: true });
      return false;

    case MessageType.SET_LANGUAGE:
      selectedLanguage = message.language;
      if (asrWorker) {
        asrWorker.postMessage({ type: "SET_LANGUAGE", language: message.language } satisfies WorkerInMessage);
      }
      sendResponse({ ok: true });
      return false;
  }
  return false;
});
