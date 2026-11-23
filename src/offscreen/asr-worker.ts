import { LocalAsrEngine, type AsrProgress } from "../ai/asr-engine";
import type { AudioChunk, TranscriptSegment } from "../types/audio";

export type WorkerInMessage =
  | { type: "INIT"; language?: string }
  | { type: "SET_LANGUAGE"; language: string }
  | { type: "TRANSCRIBE"; requestId: number; chunk: AudioChunk };

export type WorkerOutMessage =
  | { type: "PROGRESS"; progress: AsrProgress }
  | { type: "READY"; device: string }
  | { type: "ERROR"; error: string }
  | { type: "PARTIAL"; requestId: number; segment: TranscriptSegment }
  | { type: "RESULT"; requestId: number; segment: TranscriptSegment | null };

const engine = new LocalAsrEngine();

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "SET_LANGUAGE") {
    engine.setLanguage(msg.language);
    return;
  }

  if (msg.type === "INIT") {
    if (msg.language) {
      engine.setLanguage(msg.language);
    }
    if (engine.isReady()) {
      self.postMessage({ type: "READY", device: engine.getDevice() } satisfies WorkerOutMessage);
      return;
    }
    if (engine.getState() === "loading") {
      return;
    }
    try {
      await engine.initialize((progress) => {
        self.postMessage({ type: "PROGRESS", progress } satisfies WorkerOutMessage);
      });
      self.postMessage({ type: "READY", device: engine.getDevice() } satisfies WorkerOutMessage);
    } catch (err) {
      self.postMessage({
        type: "ERROR",
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerOutMessage);
    }
  } else if (msg.type === "TRANSCRIBE") {
    try {
      const segment = await engine.transcribe(msg.chunk, (partialSegment) => {
        self.postMessage({
          type: "PARTIAL",
          requestId: msg.requestId,
          segment: partialSegment,
        } satisfies WorkerOutMessage);
      });
      self.postMessage({
        type: "RESULT",
        requestId: msg.requestId,
        segment,
      } satisfies WorkerOutMessage);
    } catch {
      self.postMessage({
        type: "RESULT",
        requestId: msg.requestId,
        segment: null,
      } satisfies WorkerOutMessage);
    }
  }
};
