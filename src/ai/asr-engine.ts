import {
  pipeline,
  env,
  LogitsProcessor,
  LogitsProcessorList,
  WhisperTextStreamer,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";
import type { AudioChunk, TranscriptSegment } from "../types/audio";

// Configure browser-friendly environment
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = false;

function resolveExtensionWasmPaths(): { mjs: string; wasm: string } | undefined {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      return {
        mjs: chrome.runtime.getURL("wasm/ort-wasm-simd-threaded.asyncify.mjs"),
        wasm: chrome.runtime.getURL("wasm/ort-wasm-simd-threaded.asyncify.wasm"),
      };
    }
  } catch {
    // Fallback below
  }
  try {
    if (typeof self !== "undefined" && self.location?.origin?.startsWith("chrome-extension://")) {
      return {
        mjs: `${self.location.origin}/wasm/ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${self.location.origin}/wasm/ort-wasm-simd-threaded.asyncify.wasm`,
      };
    }
  } catch {
    // Ignore in Node/non-extension environments
  }
  return undefined;
}

// Configure ONNX Runtime WASM with multi-threading (SharedArrayBuffer via MV3 COOP/COEP)
if (env.backends?.onnx?.wasm) {
  const isIsolated = typeof self !== "undefined" && self.crossOriginIsolated === true;
  const hwThreads =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  env.backends.onnx.wasm.numThreads = isIsolated ? Math.min(4, Math.max(2, Math.floor(hwThreads / 2))) : 1;
  env.backends.onnx.wasm.proxy = false;
  const paths = resolveExtensionWasmPaths();
  if (paths) {
    env.backends.onnx.wasm.wasmPaths = paths;
  }
  console.log(
    `[ClearVoice AI] WASM Config | crossOriginIsolated=${isIsolated} | numThreads=${env.backends.onnx.wasm.numThreads} (hw=${hwThreads})`
  );
}

export type AsrState = "idle" | "loading" | "ready" | "inferring" | "error";

export interface AsrProgress {
  progress: number; // 0 to 100
  file?: string;
  status?: string;
}

// Candidate languages for auto-detection (prevents tiny model from misfiring into obscure languages on noise)
const ALLOWED_AUTO_LANG_TOKENS = new Set([
  "<|vi|>",
  "<|en|>",
  "<|zh|>",
  "<|ja|>",
  "<|ko|>",
  "<|fr|>",
  "<|de|>",
  "<|es|>",
  "<|ru|>",
]);

/**
 * Single-pass Whisper Automatic Language Detection + Prefix Enforcer:
 * - Step 1 (seqLen === 1): Lets Whisper's cross-attention pick the highest-probability language token from audio.
 * - Step 2 (seqLen === 2): Forces <|transcribe|> token (never translates to English when another language is spoken).
 * - Step 3 (seqLen === 3): Forces <|notimestamps|> token.
 * - Step 4 (seqLen === 4): Suppresses blank/EOS tokens so actual speech tokens are decoded.
 */
class WhisperAutoLangLogitsProcessor extends LogitsProcessor {
  private readonly allowedLangIds: Set<number>;
  private readonly transcribeTokenId: number;
  private readonly noTimestampsTokenId: number;
  private readonly beginSuppressTokens: number[];

  constructor(
    allowedLangIds: Set<number>,
    transcribeTokenId: number,
    noTimestampsTokenId: number,
    beginSuppressTokens: number[]
  ) {
    super();
    this.allowedLangIds = allowedLangIds;
    this.transcribeTokenId = transcribeTokenId;
    this.noTimestampsTokenId = noTimestampsTokenId;
    this.beginSuppressTokens = beginSuppressTokens;
  }

  public _call(input_ids: bigint[][], logits: { data: Float32Array }): { data: Float32Array } {
    const seqLen = input_ids[0].length;
    const data = logits.data;

    if (seqLen === 1) {
      for (let i = 0; i < data.length; i++) {
        if (!this.allowedLangIds.has(i)) {
          data[i] = -Infinity;
        }
      }
    } else if (seqLen === 2) {
      data.fill(-Infinity);
      data[this.transcribeTokenId] = 0;
    } else if (seqLen === 3) {
      data.fill(-Infinity);
      data[this.noTimestampsTokenId] = 0;
    } else if (seqLen === 4) {
      for (const tokenId of this.beginSuppressTokens) {
        if (tokenId >= 0 && tokenId < data.length) {
          data[tokenId] = -Infinity;
        }
      }
    }
    return logits;
  }
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
  private initPromise: Promise<void> | null = null;

  private decoderStartTokenId: number = 50258;
  private autoLangProcessorList: LogitsProcessorList | null = null;

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
   * Initialize and load the Whisper model into browser/worker memory.
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

        this.prepareAutoLanguageDetector();
        this.activeDevice = "wasm";
        this.state = "ready";
        console.log("[ClearVoice AI] Whisper Q4 Model successfully initialized with Auto-Language Detection!");
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
   * Build the logits processor from the loaded model's generation_config for single-pass auto language detection.
   */
  private prepareAutoLanguageDetector(): void {
    const model = (this.transcriber as unknown as {
      model?: {
        generation_config?: {
          decoder_start_token_id?: number;
          lang_to_id?: Record<string, number>;
          task_to_id?: Record<string, number>;
          no_timestamps_token_id?: number;
          begin_suppress_tokens?: number[];
        };
      };
    })?.model;

    const gc = model?.generation_config;
    if (!gc || !gc.lang_to_id || !gc.task_to_id) {
      return;
    }

    this.decoderStartTokenId = gc.decoder_start_token_id ?? 50258;
    const allowedIds = new Set<number>();
    for (const [token, id] of Object.entries(gc.lang_to_id)) {
      if (ALLOWED_AUTO_LANG_TOKENS.has(token)) {
        allowedIds.add(id);
      }
    }
    if (allowedIds.size === 0) {
      for (const id of Object.values(gc.lang_to_id)) {
        allowedIds.add(id);
      }
    }

    const transcribeId = gc.task_to_id.transcribe ?? 50359;
    const noTimestampsId = gc.no_timestamps_token_id ?? 50363;
    const beginSuppress = gc.begin_suppress_tokens ?? [220, 50257];

    const list = new LogitsProcessorList();
    list.push(new WhisperAutoLangLogitsProcessor(allowedIds, transcribeId, noTimestampsId, beginSuppress));
    this.autoLangProcessorList = list;
  }

  /**
   * Run ASR inference on a single 16kHz mono AudioChunk with automatic language detection
   * and real-time token-by-token streaming via WhisperTextStreamer.
   */
  public async transcribe(
    chunk: AudioChunk,
    onPartial?: (segment: TranscriptSegment) => void
  ): Promise<TranscriptSegment | null> {
    if (!this.transcriber || !this.isReady()) {
      console.warn("[ClearVoice AI] Transcribe called before model is ready.");
      return null;
    }

    if (this.isProcessing) {
      return null;
    }

    this.isProcessing = true;
    this.state = "inferring";

    try {
      const startTime = performance.now();
      const startMs = Math.round((chunk.startSample / chunk.sampleRate) * 1000);
      const endMs = Math.round(((chunk.startSample + chunk.samples.length) / chunk.sampleRate) * 1000);
      const segId = `seg_${chunk.sessionId}_${chunk.sequence}`;

      const options: Record<string, unknown> = {
        return_timestamps: false,
        max_new_tokens: 40,
      };

      if (this.autoLangProcessorList) {
        options.decoder_input_ids = [this.decoderStartTokenId];
        options.logits_processor = this.autoLangProcessorList;
      } else {
        options.task = "transcribe";
      }

      // Attach WhisperTextStreamer to emit partial words immediately as each token is decoded (~40-60ms/token)
      const tokenizer = (this.transcriber as unknown as { tokenizer?: unknown }).tokenizer;
      let streamedRaw = "";
      let lastPartialText = "";

      if (onPartial && tokenizer) {
        try {
          const streamer = new WhisperTextStreamer(
            tokenizer as ConstructorParameters<typeof WhisperTextStreamer>[0],
            {
              skip_prompt: true,
              skip_special_tokens: true,
              callback_function: (piece: string) => {
                streamedRaw += piece;
                const partialClean = this.cleanHallucinatedText(streamedRaw);
                if (partialClean && partialClean !== lastPartialText) {
                  lastPartialText = partialClean;
                  onPartial({
                    id: segId,
                    sessionId: chunk.sessionId,
                    startMs,
                    endMs,
                    text: partialClean,
                    status: "partial",
                    sourceSequenceStart: chunk.sequence,
                    sourceSequenceEnd: chunk.sequence,
                  });
                }
              },
            }
          );
          options.streamer = streamer;
        } catch {
          // Fallback to batch mode if streamer construction fails
        }
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

      text = this.cleanHallucinatedText(text);

      this.state = "ready";
      this.isProcessing = false;

      if (!text || text.length === 0) {
        return null;
      }

      console.log(
        `[ClearVoice AI] Inference done in ${inferenceDuration}ms (${this.activeDevice}): "${text}"`
      );

      return {
        id: segId,
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

  /**
   * Filters out common Whisper non-speech hallucinations and collapses repetitive phrase loops.
   */
  private cleanHallucinatedText(raw: string): string {
    if (!raw) return "";
    // Remove bracketed/parenthesized noise tags such as [Music], (nhạc), [Applause]
    let cleaned = raw.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (!cleaned || /^[\p{P}\p{S}\s]+$/u.test(cleaned)) {
      return "";
    }
    // Collapse consecutive 3+ repetitions of the same word/phrase (e.g. "bây giờ, bây giờ, bây giờ")
    cleaned = cleaned.replace(/\b(\w+(?:[\s,]+\w+){0,2})(?:[\s,]+\1){2,}\b/giu, "$1");
    return cleaned.trim();
  }
}
