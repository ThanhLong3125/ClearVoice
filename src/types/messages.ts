import type { TranscriptSegment } from "./audio";

export type CaptureState = "idle" | "starting" | "capturing" | "stopping" | "error";

export const MessageType = {
  START_CAPTURE: "START_CAPTURE",
  STOP_CAPTURE: "STOP_CAPTURE",
  GET_STATUS: "GET_STATUS",
  PREWARM_MODEL: "PREWARM_MODEL",
  STATUS_UPDATE: "STATUS_UPDATE",
  INIT_AUDIO_CAPTURE: "INIT_AUDIO_CAPTURE",
  STOP_AUDIO_CAPTURE: "STOP_AUDIO_CAPTURE",
  MODEL_STATUS: "MODEL_STATUS",
  SET_LANGUAGE: "SET_LANGUAGE",
  TRANSCRIPT_UPDATE: "TRANSCRIPT_UPDATE",
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export type ExtensionMessage =
  | { type: typeof MessageType.START_CAPTURE; tabId?: number; language?: string }
  | { type: typeof MessageType.STOP_CAPTURE }
  | { type: typeof MessageType.GET_STATUS }
  | { type: typeof MessageType.PREWARM_MODEL }
  | { type: typeof MessageType.STATUS_UPDATE; state: CaptureState; error?: string }
  | { type: typeof MessageType.INIT_AUDIO_CAPTURE; streamId: string; sessionId: string; language?: string }
  | { type: typeof MessageType.STOP_AUDIO_CAPTURE }
  | { type: typeof MessageType.SET_LANGUAGE; language: string }
  | {
      type: typeof MessageType.MODEL_STATUS;
      status: "idle" | "loading" | "ready" | "error";
      progress?: number;
      file?: string;
      device?: string;
      error?: string;
    }
  | { type: typeof MessageType.TRANSCRIPT_UPDATE; segment: TranscriptSegment };
