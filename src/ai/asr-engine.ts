import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import type { AudioChunk, TranscriptSegment } from "../types/audio";

// Configure browser-friendly environment
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = false;

// Configure ONNX Runtime WASM to avoid SharedArrayBuffer and MV3 external script CSP issues
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      env.backends.onnx.wasm.wasmPaths = {
        mjs: chrome.runtime.getURL("wasm/ort-wasm-simd-threaded.asyncify.mjs"),
        wasm: chrome.runtime.getURL("wasm/ort-wasm-simd-threaded.asyncify.wasm"),
      };
    }
  } catch {
    // Ignore in non-extension environments (e.g. testing)
  }
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
  private activeDevice: "webgpu" | "wasm" = "wasm";
  private lastError: string | null = null;
  private isProcessing: boolean = false;
  private currentLanguage: string = "vietnamese";
  private initPromise: Promise<void> | null = null;

  public setLanguage(language: string): void {
    this.currentLanguage = language;
    console.log(`[ClearVoice AI] Target language set to: ${language}`);
  }

  public getLanguage(): string {
    return this.currentLanguage;
  }

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
   * Initialize and load the Whisper model into browser memory.
   */
  public async initialize(onProgress?: (info: AsrProgress) => void): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.state = "loading";
    this.lastError = null;

    this.initPromise = (async () => {
      const progressCallback = (data: { status: string; progress?: number; file?: string }) => {
        if (!onProgress || this.state !== "loading") {
          return;
        }
        if (data.status === "progress" && typeof data.progress === "number" && data.file) {
          onProgress({
            progress: Math.round(data.progress),
            file: data.file,
            status: data.status,
          });
        }
      };

      console.log("[ClearVoice AI] Initializing whisper-tiny via WASM Q4 (~96MB)...");
      try {
        this.transcriber = (await pipeline(
          "automatic-speech-recognition",
          "onnx-community/whisper-tiny",
          {
            device: "wasm",
            dtype: "q4",
            progress_callback: progressCallback,
          }
        )) as AutomaticSpeechRecognitionPipeline;

        this.activeDevice = "wasm";
        this.state = "ready";
        console.log("[ClearVoice AI] Whisper Q4 Model successfully initialized and ready!");
      } catch (wasmError) {
        this.initPromise = null; // Allow retry on failure
        this.state = "error";
        this.lastError = wasmError instanceof Error ? wasmError.message : String(wasmError);
        console.error("[ClearVoice AI] Failed to load model on WASM:", wasmError);
        throw wasmError;
      }
    })();

    return this.initPromise;
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

      // Whisper parameters: pass language explicitly and cap tokens for 3s chunk to prevent repetition loops on music/noise
      const options: Record<string, unknown> = {
        task: "transcribe",
        return_timestamps: false,
        max_new_tokens: 64,
      };
      if (this.currentLanguage && this.currentLanguage !== "auto") {
        options.language = this.currentLanguage;
      }

      const output = (await this.transcriber(chunk.samples, options)) as
        | { text: string }
        | Array<{ text: string }>;

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
