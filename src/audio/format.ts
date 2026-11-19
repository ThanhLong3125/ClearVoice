/**
 * Audio format utility functions for ClearVoice.
 */

/**
 * Downmixes multi-channel audio (e.g. stereo) into mono Float32Array.
 * If single channel, returns a copy of channel 0.
 * If 2 channels, performs: mono[i] = (left[i] + right[i]) * 0.5
 */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) {
    return new Float32Array(0);
  }

  const length = channels[0].length;
  if (channels.length === 1) {
    return new Float32Array(channels[0]);
  }

  const mono = new Float32Array(length);
  const left = channels[0];
  const right = channels[1];

  for (let i = 0; i < length; i++) {
    mono[i] = (left[i] + right[i]) * 0.5;
  }

  return mono;
}
