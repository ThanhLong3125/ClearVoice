import { MessageType, type ExtensionMessage, type CaptureState } from "../types/messages";

let currentState: CaptureState = "idle";
let activeSessionId: string | null = null;
let activeTabId: number | null = null;
let lastErrorMsg: string | undefined = undefined;
let lastTranscript: string | null = null;
let lastModelStatus: {
  status: "idle" | "loading" | "ready" | "error";
  progress?: number;
  file?: string;
  device?: string;
  error?: string;
} = { status: "idle" };

const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/offscreen.html";

/**
 * Ensure an Offscreen Document is active for audio processing.
 */
async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Capturing tab audio and processing local ASR inference",
  });
}

/**
 * Broadcast state update to all components (popup, etc.).
 */
function setCaptureState(state: CaptureState, error?: string): void {
  currentState = state;
  lastErrorMsg = error;
  chrome.runtime.sendMessage<ExtensionMessage>({
    type: MessageType.STATUS_UPDATE,
    state,
    error,
  }).catch(() => {
    // Ignore error if no listeners (e.g. popup is closed)
  });
}

/**
 * Start tab audio capture session.
 */
async function startCapture(targetTabId: number): Promise<void> {
  try {
    setCaptureState("starting");
    if (lastModelStatus.status === "error") {
      lastModelStatus = { status: "idle" };
    }
    activeTabId = targetTabId;
    activeSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Ensure Offscreen document exists
    await ensureOffscreenDocument();

    // 2. Get Media Stream ID for the tab using callback wrapped in Promise
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!id) {
          reject(new Error("Không thể lấy streamId từ tabCapture."));
        } else {
          resolve(id);
        }
      });
    });

    // 3. Send command to Offscreen document to begin getUserMedia (with retry while offscreen module loads)
    const initMsg: ExtensionMessage = {
      type: MessageType.INIT_AUDIO_CAPTURE,
      streamId,
      sessionId: activeSessionId,
    };
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const ack = await chrome.runtime.sendMessage<ExtensionMessage, { ok?: boolean }>(initMsg);
        if (ack && ack.ok) break;
      } catch {
        // Offscreen document script still initializing
      }
      await new Promise((r) => setTimeout(r, 60));
    }

    // 4. Ensure Content Script & CSS are injected into the captured tab
    try {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: targetTabId },
        files: ["content.css"],
      });
      console.log(`[ClearVoice SW] Verified content script injection in tab ${targetTabId}`);
    } catch {
      // Ignore if already injected or on internal/restricted browser page
    }

    setCaptureState("capturing");
    console.log(`[ClearVoice SW] Started capture for tab ${targetTabId}, session: ${activeSessionId}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ClearVoice SW] Failed to start capture:", message);
    setCaptureState("error", message);
  }
}

/**
 * Stop active audio capture session and release resources.
 */
async function stopCapture(): Promise<void> {
  try {
    setCaptureState("stopping");
    // Send stop command to offscreen document
    chrome.runtime.sendMessage<ExtensionMessage>({
      type: MessageType.STOP_AUDIO_CAPTURE,
    }).catch(() => {});

    activeTabId = null;
    activeSessionId = null;
    setCaptureState("idle");
    console.log("[ClearVoice SW] Stopped capture session.");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ClearVoice SW] Error stopping capture:", message);
    setCaptureState("error", message);
  }
}

// Handle messages from popup, offscreen, and content scripts
chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  switch (message.type) {
    case MessageType.GET_STATUS:
      sendResponse({ state: currentState, error: lastErrorMsg, modelStatus: lastModelStatus, lastTranscript });
      break;

    case MessageType.STATUS_UPDATE:
      currentState = message.state;
      lastErrorMsg = message.error;
      break;

    case MessageType.MODEL_STATUS:
      if (lastModelStatus.status === "error" && message.status === "loading") {
        break;
      }
      lastModelStatus = {
        status: message.status,
        progress: message.progress,
        file: message.file,
        device: message.device,
        error: message.error,
      };
      break;

    case MessageType.START_CAPTURE:
      if (message.tabId) {
        startCapture(message.tabId);
        sendResponse({ success: true });
      } else {
        sendResponse({ error: "Missing tabId" });
      }
      break;

    case MessageType.STOP_CAPTURE:
      stopCapture();
      sendResponse({ success: true });
      break;

    case MessageType.AUDIO_VOLUME:
      // Live volume bar has been removed from tab overlay to avoid blocking user tasks
      break;

    case MessageType.TRANSCRIPT_UPDATE:
      lastTranscript = message.segment?.text ?? null;
      // Broadcast transcript to active tab's content script
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, message).catch(() => {});
      }
      break;
  }
  return true; // Keep message channel open for async response
});

// Watch for tab close to gracefully stop capture
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabId === tabId) {
    console.log(`[ClearVoice SW] Captured tab ${tabId} was closed. Stopping session.`);
    stopCapture();
  }
});

// Pre-warm offscreen document & ASR worker when extension loads
ensureOffscreenDocument().catch(() => {});
