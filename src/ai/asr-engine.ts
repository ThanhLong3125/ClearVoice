import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { AudioChunk, TranscriptSegment } from "../types/audio";

// Configure browser-friendly environment
env.allowLocalModels = false;
env.useBrowserCache = true;

// Configure ONNX Runtime WASM to avoid SharedArrayBuffer issues in extensions
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
}

export type AsrState = "idle" | "loading" | "ready" | "inferring" | "error";

export interface AsrProgress {
  progress: number; // 0 to 100
  file?: string;
  status?: string;
}

/**
 * LocalAsrEngine: Manages on-device Whisper model lifecycle and inference using Transformers.js / ONNX Runtime Web.
 */
export class LocalAsrEngine {
  private transcriber: AutomaticSpeechRecognitionPipeline | null = null;
  private state: AsrState = "idle";
  private activeDevice: "webgpu" | "wasm" = "webgpu";
  private lastError: string | null = null;
  private isProcessing: boolean = false;

  public getState(): AsrState {
    return this.state;
  }

  public getDevice(): string {
    return this.activeDevice;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public isReady(): boolean {
    return this.state === "ready" || this.state === "inferring";
  }

  /**
   * Initialize and load the Whisper model into browser memory/GPU.
   */
  public async initialize(onProgress?: (info: AsrProgress) => void): Promise<void> {
    if (this.transcriber) return;

    this.state = "loading";
    this.lastError = null;

    const progressCallback = (data: { status: string; progress?: number; file?: string }) => {
      if (onProgress && typeof data.progress === "number") {
        onProgress({
          progress: Math.round(data.progress),
          file: data.file,
          status: data.status,
        });
      }
    };

    // Check WebGPU availability first
    const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator && !!navigator.gpu;

    if (hasWebGPU) {
      try {
        console.log("[ClearVoice AI] Attempting to load whisper-tiny via WebGPU...");
        this.transcriber = (await pipeline(
          "automatic-speech-recognition",
          "onnx-community/whisper-tiny",
          {
            device: "webgpu",
            dtype: "fp32",
            progress_callback: progressCallback,
          }
        )) as AutomaticSpeechRecognitionPipeline;
        this.activeDevice = "webgpu";
        this.state = "ready";
        console.log("[ClearVoice AI] Model successfully loaded with WebGPU backend!");
        return;
      } catch (gpuError) {
        console.warn("[ClearVoice AI] WebGPU not available or failed, falling back to CPU (WASM):", gpuError);
      }
    }

    console.log("[ClearVoice AI] Loading whisper-tiny via CPU / WASM backend...");
    try {
      this.transcriber = (await pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-tiny",
        {
          device: "cpu",
          dtype: "fp32",
          progress_callback: progressCallback,
        }
      )) as AutomaticSpeechRecognitionPipeline;
      this.activeDevice = "wasm";
      this.state = "ready";
      console.log("[ClearVoice AI] Model successfully loaded with CPU/WASM backend!");
    } catch (wasmError) {
      this.state = "error";
      this.lastError = wasmError instanceof Error ? wasmError.message : String(wasmError);
      console.error("[ClearVoice AI] Failed to load model on CPU/WASM:", wasmError);
      throw wasmError;
    }
  }

  /**
   * Run ASR inference on a single 16kHz mono AudioChunk.
   */
  public async transcribe(chunk: AudioChunk): Promise<TranscriptSegment | null> {
    if (!this.transcriber || !this.isReady()) {
      console.warn("[ClearVoice AI] Transcribe called before model is ready.");
      return null;
    }

    if (this.isProcessing) {
      console.warn("[ClearVoice AI] Inference already in progress, skipping frame to avoid pileup.");
      return null;
    }

    this.isProcessing = true;
    this.state = "inferring";

    try {
      const startTime = performance.now();

      // Whisper requires 16000Hz mono Float32Array
      // We pass task: 'transcribe' (supports Vietnamese and English automatically)
      const output = (await this.transcriber(chunk.samples, {
        task: "transcribe",
        return_timestamps: true,
      })) as { text: string } | Array<{ text: string }>;

      const inferenceDuration = Math.round(performance.now() - startTime);

      let text = "";
      if (Array.isArray(output)) {
        text = output.map((item) => item.text).join(" ").trim();
      } else if (output && typeof output.text === "string") {
        text = output.text.trim();
      }

      this.state = "ready";
      this.isProcessing = false;

      // Filter out empty or hallucinated noise
      if (!text || text.length === 0) {
        return null;
      }

      console.log(
        `[ClearVoice AI] Inference done in ${inferenceDuration}ms (${this.activeDevice}): "${text}"`
      );

      const startMs = Math.round((chunk.startSample / chunk.sampleRate) * 1000);
      const endMs = Math.round(((chunk.startSample + chunk.samples.length) / chunk.sampleRate) * 1000);

      return {
        id: `seg_${chunk.sessionId}_${chunk.sequence}`,
        sessionId: chunk.sessionId,
        startMs,
        endMs,
        text,
        status: "final",
        sourceSequenceStart: chunk.sequence,
        sourceSequenceEnd: chunk.sequence,
      };
    } catch (err) {
      this.isProcessing = false;
      this.state = "ready";
      console.error("[ClearVoice AI] Inference error:", err);
      return null;
    }
  }
}
