import type { TranscriptSegment } from "./audio";

export type CaptureState = "idle" | "starting" | "capturing" | "stopping" | "error";

export type ExtensionMessage =
  | { type: "START_CAPTURE"; tabId?: number }
  | { type: "STOP_CAPTURE" }
  | { type: "GET_STATUS" }
  | { type: "STATUS_UPDATE"; state: CaptureState; error?: string }
  | { type: "INIT_AUDIO_CAPTURE"; streamId: string; sessionId: string }
  | { type: "STOP_AUDIO_CAPTURE" }
  | { type: "AUDIO_VOLUME"; volume: number; rms: number }
  | { type: "TRANSCRIPT_UPDATE"; segment: TranscriptSegment };
