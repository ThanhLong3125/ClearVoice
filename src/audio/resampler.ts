/**
 * StreamResampler: Continuous audio resampler using linear interpolation.
 * Preserves fractional phase and boundary samples across calls to prevent clicks and gaps.
 */
export class StreamResampler {
  private readonly sourceRate: number;
  private readonly targetRate: number;
  private readonly ratio: number; // sourceRate / targetRate
  private phase: number = 0; // Fractional offset into current input
  private lastInputSample: number = 0;
  private hasPreviousSample: boolean = false;

  constructor(sourceRate: number, targetRate: number) {
    if (sourceRate <= 0 || targetRate <= 0) {
      throw new Error(`Invalid sample rates: source=${sourceRate}, target=${targetRate}`);
    }
    this.sourceRate = sourceRate;
    this.targetRate = targetRate;
    this.ratio = sourceRate / targetRate;
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

    // Estimate output length based on ratio and current phase
    const expectedOutputCount = Math.floor((input.length - this.phase) / this.ratio) + 1;
    const output = new Float32Array(Math.max(0, expectedOutputCount));
    let outIdx = 0;

    let currentPos = this.phase;

    while (currentPos < input.length) {
      const idx0 = Math.floor(currentPos);
      const frac = currentPos - idx0;

      const s0 = idx0 >= 0 ? input[idx0] : (this.hasPreviousSample ? this.lastInputSample : input[0]);
      const s1 = idx0 + 1 < input.length ? input[idx0 + 1] : input[input.length - 1];

      output[outIdx++] = (1 - frac) * s0 + frac * s1;
      currentPos += this.ratio;
    }

    // Save fractional phase remaining for next chunk
    this.phase = currentPos - input.length;
    this.lastInputSample = input[input.length - 1];
    this.hasPreviousSample = true;

    return output.subarray(0, outIdx);
  }

  /**
   * Reset internal state for a new session.
   */
  public reset(): void {
    this.phase = 0;
    this.lastInputSample = 0;
    this.hasPreviousSample = false;
  }
}
