/**
 * Core Audio Chunk contract based on ClearVoice specification.
 */
export interface AudioChunk {
  sessionId: string;
  sequence: number;              // Monotonically increasing counter
  startSample: number;           // Absolute position in session timeline
  sampleRate: number;            // Actual sample rate (e.g. 16000 or 48000)
  channels: number;              // Number of channels (1 for mono, 2 for stereo)
  format: "f32";                 // Float32 PCM format
  samples: Float32Array;         // Raw audio buffer [-1.0, 1.0]
  capturedAtMonotonicMs: number; // Monotonic timestamp (performance.now())
}

/**
 * Core Transcript Segment contract.
 */
export interface TranscriptSegment {
  id: string;
  sessionId: string;
  startMs: number;
  endMs: number;
  text: string;
  language?: string;
  status: "partial" | "final" | "uncertain";
  sourceSequenceStart?: number;
  sourceSequenceEnd?: number;
}
