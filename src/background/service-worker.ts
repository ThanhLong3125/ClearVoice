import type { ExtensionMessage, CaptureState } from "../types/messages";

let currentState: CaptureState = "idle";
let activeSessionId: string | null = null;
let activeTabId: number | null = null;
let lastErrorMsg: string | undefined = undefined;

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
    type: "STATUS_UPDATE",
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

    // 3. Send command to Offscreen document to begin getUserMedia
    chrome.runtime.sendMessage<ExtensionMessage>({
      type: "INIT_AUDIO_CAPTURE",
      streamId,
      sessionId: activeSessionId,
    });

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
      type: "STOP_AUDIO_CAPTURE",
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
    case "GET_STATUS":
      sendResponse({ state: currentState, error: lastErrorMsg });
      break;

    case "START_CAPTURE":
      if (message.tabId) {
        startCapture(message.tabId);
        sendResponse({ success: true });
      } else {
        sendResponse({ error: "Missing tabId" });
      }
      break;

    case "STOP_CAPTURE":
      stopCapture();
      sendResponse({ success: true });
      break;

    case "TRANSCRIPT_UPDATE":
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
