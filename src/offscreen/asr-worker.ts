import { LocalAsrEngine, type AsrProgress } from "../ai/asr-engine";
import type { AudioChunk, TranscriptSegment } from "../types/audio";

export type WorkerInMessage =
  | { type: "INIT" }
  | { type: "TRANSCRIBE"; requestId: number; chunk: AudioChunk };

export type WorkerOutMessage =
  | { type: "PROGRESS"; progress: AsrProgress }
  | { type: "READY"; device: string }
  | { type: "ERROR"; error: string }
  | { type: "RESULT"; requestId: number; segment: TranscriptSegment | null };

const engine = new LocalAsrEngine();

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "INIT") {
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
      const segment = await engine.transcribe(msg.chunk);
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
