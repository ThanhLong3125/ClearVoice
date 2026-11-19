/**
 * EnergyVad: Low-overhead Voice Activity Detection based on RMS energy with hangover time.
 * Filters out silence and digital-zero chunks before reaching the AI inference engine.
 */
export interface VadConfig {
  thresholdRms?: number; // Minimum RMS amplitude to consider active speech (default: 0.003)
  hangoverMs?: number;   // Duration to hold speech active state across brief pauses (default: 800ms)
}

export class EnergyVad {
  private readonly thresholdRms: number;
  private readonly hangoverMs: number;
  private isSpeaking: boolean = false;
  private lastSpeechTimestampMs: number = 0;

  constructor(config?: VadConfig) {
    this.thresholdRms = config?.thresholdRms ?? 0.003;
    this.hangoverMs = config?.hangoverMs ?? 800;
  }

  /**
   * Evaluates audio samples and determines if speech or audio activity is present.
   */
  public process(samples: Float32Array): { isActive: boolean; rms: number } {
    if (samples.length === 0) {
      return { isActive: this.isSpeaking, rms: 0 };
    }

    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    const now = performance.now();

    if (rms >= this.thresholdRms) {
      this.isSpeaking = true;
      this.lastSpeechTimestampMs = now;
    } else if (this.isSpeaking) {
      // Hangover period: maintain active state during natural brief pauses between syllables
      if (now - this.lastSpeechTimestampMs > this.hangoverMs) {
        this.isSpeaking = false;
      }
    }

    return { isActive: this.isSpeaking, rms };
  }

  public get speechActive(): boolean {
    return this.isSpeaking;
  }

  public reset(): void {
    this.isSpeaking = false;
    this.lastSpeechTimestampMs = 0;
  }
}
