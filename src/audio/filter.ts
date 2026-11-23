/**
 * VoiceBandpassFilter: 4th-order cascaded Biquad IIR filter (2nd-order High-Pass 260Hz + 2nd-order Low-Pass 3400Hz)
 * designed specifically for human vocal formant passband (telephone / speech band).
 * 
 * Attenuates sub-bass / 808s / kick drums (< 250Hz) and hi-hats / synth harmonics (> 3500Hz)
 * so that energy-based VAD and pause detection are not blinded by background music.
 */

export class BiquadFilter {
  private b0: number = 0;
  private b1: number = 0;
  private b2: number = 0;
  private a1: number = 0;
  private a2: number = 0;

  private x1: number = 0;
  private x2: number = 0;
  private y1: number = 0;
  private y2: number = 0;

  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.setCoefficients(b0, b1, b2, a1, a2);
  }

  public setCoefficients(b0: number, b1: number, b2: number, a1: number, a2: number): void {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
  }

  public process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  public reset(): void {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }

  public static highpass(sampleRate: number, cutoffHz: number, q: number = 0.707): BiquadFilter {
    const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cosw0 = Math.cos(w0);
    const a0 = 1 + alpha;
    return new BiquadFilter(
      (1 + cosw0) / (2 * a0),
      -(1 + cosw0) / a0,
      (1 + cosw0) / (2 * a0),
      (-2 * cosw0) / a0,
      (1 - alpha) / a0
    );
  }

  public static lowpass(sampleRate: number, cutoffHz: number, q: number = 0.707): BiquadFilter {
    const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cosw0 = Math.cos(w0);
    const a0 = 1 + alpha;
    return new BiquadFilter(
      (1 - cosw0) / (2 * a0),
      (1 - cosw0) / a0,
      (1 - cosw0) / (2 * a0),
      (-2 * cosw0) / a0,
      (1 - alpha) / a0
    );
  }
}

export class VoiceBandpassFilter {
  private readonly hp: BiquadFilter;
  private readonly lp: BiquadFilter;

  constructor(sampleRate: number = 16000, lowCutoffHz: number = 260, highCutoffHz: number = 3400) {
    this.hp = BiquadFilter.highpass(sampleRate, lowCutoffHz, 0.707);
    this.lp = BiquadFilter.lowpass(sampleRate, highCutoffHz, 0.707);
  }

  public processSample(x: number): number {
    return this.lp.process(this.hp.process(x));
  }

  public process(input: Float32Array): Float32Array {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      out[i] = this.processSample(input[i]);
    }
    return out;
  }

  public reset(): void {
    this.hp.reset();
    this.lp.reset();
  }
}
