/**
 * StreamResampler: Continuous audio resampler with a windowed-sinc FIR low-pass anti-aliasing filter
 * and linear interpolation. Preserves filter history and fractional phase across calls.
 */
export class StreamResampler {
  private readonly sourceRate: number;
  private readonly targetRate: number;
  private readonly ratio: number; // sourceRate / targetRate
  private readonly filterTaps: Float32Array;
  private history: Float32Array;
  private phase: number = 0;

  constructor(sourceRate: number, targetRate: number, numTaps: number = 31) {
    if (sourceRate <= 0 || targetRate <= 0) {
      throw new Error(`Invalid sample rates: source=${sourceRate}, target=${targetRate}`);
    }
    this.sourceRate = sourceRate;
    this.targetRate = targetRate;
    this.ratio = sourceRate / targetRate;
    this.filterTaps =
      sourceRate > targetRate
        ? StreamResampler.designLowPassFir(numTaps | 1, (targetRate * 0.45) / sourceRate)
        : new Float32Array([1]);
    this.history = new Float32Array(this.filterTaps.length - 1);
  }

  /**
   * Windowed-sinc (Blackman) low-pass FIR filter design.
   * normalizedCutoff is f_c / f_s in (0, 0.5).
   */
  private static designLowPassFir(taps: number, normalizedCutoff: number): Float32Array {
    const coeffs = new Float32Array(taps);
    const mid = (taps - 1) / 2;
    let sum = 0;
    for (let n = 0; n < taps; n++) {
      const x = n - mid;
      const sinc = x === 0 ? 2 * normalizedCutoff : Math.sin(2 * Math.PI * normalizedCutoff * x) / (Math.PI * x);
      const win =
        0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (taps - 1));
      const val = sinc * win;
      coeffs[n] = val;
      sum += val;
    }
    if (sum !== 0) {
      for (let n = 0; n < taps; n++) {
        coeffs[n] /= sum;
      }
    }
    return coeffs;
  }

  /**
   * Resamples an incoming mono Float32Array slice to targetSampleRate.
   */
  public process(input: Float32Array): Float32Array {
    if (input.length === 0) {
      return new Float32Array(0);
    }

    if (this.sourceRate === this.targetRate) {
      return new Float32Array(input);
    }

    const histLen = this.history.length;
    const padded = new Float32Array(histLen + input.length);
    padded.set(this.history, 0);
    padded.set(input, histLen);

    const taps = this.filterTaps;
    const tapCount = taps.length;

    const filterAt = (idx: number): number => {
      let acc = 0;
      const base = idx + histLen;
      for (let k = 0; k < tapCount; k++) {
        acc += padded[base - k] * taps[k];
      }
      return acc;
    };

    const expectedOutputCount = Math.max(0, Math.floor((input.length - 1 - this.phase) / this.ratio) + 1);
    const output = new Float32Array(expectedOutputCount);
    let outIdx = 0;
    let currentPos = this.phase;

    while (currentPos + 1 <= input.length) {
      const idx0 = Math.floor(currentPos);
      const frac = currentPos - idx0;
      const s0 = filterAt(idx0);
      const s1 = idx0 + 1 < input.length ? filterAt(idx0 + 1) : s0;
      output[outIdx++] = (1 - frac) * s0 + frac * s1;
      currentPos += this.ratio;
    }

    this.phase = currentPos - input.length;
    if (histLen > 0) {
      this.history.set(padded.subarray(padded.length - histLen));
    }

    return output.subarray(0, outIdx);
  }

  /**
   * Reset internal state for a new session.
   */
  public reset(): void {
    this.phase = 0;
    this.history.fill(0);
  }
}
