import type { ExtensionMessage } from "../types/messages";

let currentStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let currentSessionId: string | null = null;
let analyserNode: AnalyserNode | null = null;
let volumeInterval: number | null = null;

/**
 * Start capturing audio from tab MediaStream ID.
 */
async function handleInitAudioCapture(streamId: string, sessionId: string): Promise<void> {
  try {
    currentSessionId = sessionId;

    // Request tab audio stream using chromeMediaSourceId constraint
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      } as unknown as MediaTrackConstraints,
      video: false,
    });

    currentStream = stream;

    // Track state change listener
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        console.warn("[ClearVoice Offscreen] Audio track ended unexpectedly.");
        stopAudioCapture();
      };
    });

    // Initialize AudioContext
    audioContext = new AudioContext();

    const sourceNode = audioContext.createMediaStreamSource(stream);

    // CRITICAL 1: Connect to audioContext.destination so the user still hears tab audio
    sourceNode.connect(audioContext.destination);

    // CRITICAL 2: Connect to AnalyserNode to read real-time PCM frames and calculate RMS
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    sourceNode.connect(analyserNode);

    const buffer = new Float32Array(analyserNode.fftSize);

    // Stream volume updates every 70ms
    volumeInterval = window.setInterval(() => {
      if (!analyserNode) return;
      analyserNode.getFloatTimeDomainData(buffer);

      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] * buffer[i];
      }
      const rms = Math.sqrt(sum / buffer.length);
      // Amplify RMS to human-observable volume percentage 0 - 100%
      const volume = Math.min(100, Math.round(rms * 250));

      chrome.runtime.sendMessage<ExtensionMessage>({
        type: "AUDIO_VOLUME",
        volume,
        rms: Number(rms.toFixed(4)),
      }).catch(() => {});
    }, 70);

    console.log(
      `[ClearVoice Offscreen] Audio capture active. Sample rate: ${audioContext.sampleRate}Hz, Session: ${sessionId}`
    );
  } catch (err) {
    console.error("[ClearVoice Offscreen] Failed to start audio capture:", err);
    chrome.runtime.sendMessage<ExtensionMessage>({
      type: "STATUS_UPDATE",
      state: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Stop capturing audio, release tracks, and close AudioContext.
 */
function stopAudioCapture(): void {
  if (volumeInterval) {
    clearInterval(volumeInterval);
    volumeInterval = null;
  }

  if (analyserNode) {
    analyserNode.disconnect();
    analyserNode = null;
  }

  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }

  if (audioContext && audioContext.state !== "closed") {
    audioContext.close();
    audioContext = null;
  }

  // Send zero volume when stopping
  chrome.runtime.sendMessage<ExtensionMessage>({
    type: "AUDIO_VOLUME",
    volume: 0,
    rms: 0,
  }).catch(() => {});

  console.log(`[ClearVoice Offscreen] Audio resources released for session: ${currentSessionId ?? "none"}`);
  currentSessionId = null;
}

// Listen for commands from Service Worker
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  switch (message.type) {
    case "INIT_AUDIO_CAPTURE":
      handleInitAudioCapture(message.streamId, message.sessionId);
      break;

    case "STOP_AUDIO_CAPTURE":
      stopAudioCapture();
      break;
  }
});
