import type { TranscriptSegment } from "./audio";

export type CaptureState = "idle" | "starting" | "capturing" | "stopping" | "error";

export enum MessageType {
  START_CAPTURE = "START_CAPTURE",
  STOP_CAPTURE = "STOP_CAPTURE",
  GET_STATUS = "GET_STATUS",
  STATUS_UPDATE = "STATUS_UPDATE",
  INIT_AUDIO_CAPTURE = "INIT_AUDIO_CAPTURE",
  STOP_AUDIO_CAPTURE = "STOP_AUDIO_CAPTURE",
  AUDIO_VOLUME = "AUDIO_VOLUME",
  TRANSCRIPT_UPDATE = "TRANSCRIPT_UPDATE",
}

export type ExtensionMessage =
  | { type: MessageType.START_CAPTURE; tabId?: number }
  | { type: MessageType.STOP_CAPTURE }
  | { type: MessageType.GET_STATUS }
  | { type: MessageType.STATUS_UPDATE; state: CaptureState; error?: string }
  | { type: MessageType.INIT_AUDIO_CAPTURE; streamId: string; sessionId: string }
  | { type: MessageType.STOP_AUDIO_CAPTURE }
  | { type: MessageType.AUDIO_VOLUME; volume: number; rms: number }
  | { type: MessageType.TRANSCRIPT_UPDATE; segment: TranscriptSegment };
