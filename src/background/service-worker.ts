import { MessageType, type ExtensionMessage, type CaptureState } from "../types/messages";

let currentState: CaptureState = "idle";
let activeSessionId: string | null = null;
let activeTabId: number | null = null;
let selectedLanguage: string = "auto";
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
let creatingOffscreenPromise: Promise<void> | null = null;

function persistSessionState(): void {
  chrome.storage.session
    .set({
      currentState,
      activeSessionId,
      activeTabId,
      selectedLanguage,
      lastErrorMsg,
      lastTranscript,
      lastModelStatus,
    })
    .catch(() => {});
}

async function restoreSessionState(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get([
      "currentState",
      "activeSessionId",
      "activeTabId",
      "selectedLanguage",
      "lastErrorMsg",
      "lastTranscript",
      "lastModelStatus",
    ]);
    if (typeof stored.selectedLanguage === "string") {
      selectedLanguage = stored.selectedLanguage;
    }
    if (stored.lastModelStatus) {
      lastModelStatus = stored.lastModelStatus;
    }
    if (typeof stored.lastTranscript === "string") {
      lastTranscript = stored.lastTranscript;
    }

    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    const hasOffscreen = contexts.length > 0;

    if (stored.currentState === "capturing" && hasOffscreen && typeof stored.activeTabId === "number") {
      currentState = "capturing";
      activeTabId = stored.activeTabId;
      activeSessionId = typeof stored.activeSessionId === "string" ? stored.activeSessionId : null;
    } else {
      currentState = "idle";
      activeTabId = null;
      activeSessionId = null;
      persistSessionState();
    }
  } catch {
    // Ignore storage restore errors
  }
}

void restoreSessionState();

/**
 * Ensure an Offscreen Document is active for audio processing.
 * Memoizes concurrent creation calls to prevent duplicate document race errors.
 */
async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (!creatingOffscreenPromise) {
    creatingOffscreenPromise = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: "Capturing tab audio and processing local ASR inference",
      })
      .finally(() => {
        creatingOffscreenPromise = null;
      });
  }

  await creatingOffscreenPromise;
}

/**
 * Broadcast state update to all components (popup, active tab overlay).
 */
function setCaptureState(state: CaptureState, error?: string): void {
  const prevTabId = activeTabId;
  currentState = state;
  lastErrorMsg = error;
  if (state === "idle" || state === "error") {
    activeTabId = null;
    activeSessionId = null;
  }
  persistSessionState();

  const statusMsg: ExtensionMessage = {
    type: MessageType.STATUS_UPDATE,
    state,
    error,
  };
  chrome.runtime.sendMessage<ExtensionMessage>(statusMsg).catch(() => {});
  if (prevTabId && (state === "idle" || state === "error")) {
    chrome.tabs.sendMessage(prevTabId, statusMsg).catch(() => {});
  }
}

async function injectOverlayIntoTab(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    console.log(`[ClearVoice SW] Verified content script injection in tab ${tabId}`);
  } catch {
    // Ignore if on restricted chrome:// page
  }
}

/**
 * Start tab audio capture session.
 */
async function startCapture(targetTabId: number, language?: string): Promise<void> {
  try {
    if (language) {
      selectedLanguage = language;
    }
    setCaptureState("starting");
    if (lastModelStatus.status === "error") {
      lastModelStatus = { status: "idle" };
    }
    activeTabId = targetTabId;
    activeSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    persistSessionState();

    // 1. Ensure Offscreen document exists (lazy on-demand creation)
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

    // 3. Send command to Offscreen document and wait for real getUserMedia confirmation
    const initMsg: ExtensionMessage = {
      type: MessageType.INIT_AUDIO_CAPTURE,
      streamId,
      sessionId: activeSessionId,
      language: selectedLanguage,
    };

    let initialized = false;
    let lastInitError: string | undefined;

    for (let attempt = 0; attempt < 12; attempt++) {
      try {
        const ack = await chrome.runtime.sendMessage<
          ExtensionMessage,
          { ok?: boolean; error?: string } | undefined
        >(initMsg);
        if (ack && ack.ok) {
          initialized = true;
          break;
        }
        if (ack && ack.ok === false) {
          lastInitError = ack.error || "Offscreen từ chối khởi tạo thu âm.";
          break;
        }
      } catch {
        // Offscreen document script still loading
      }
      await new Promise((r) => setTimeout(r, 60));
    }

    if (!initialized) {
      throw new Error(lastInitError || "Không thể kết nối với bộ xử lý âm thanh Offscreen.");
    }

    // 4. Inject Content Script (Shadow DOM + inline CSS) into the captured tab
    await injectOverlayIntoTab(targetTabId);

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
    await chrome.runtime
      .sendMessage<ExtensionMessage>({
        type: MessageType.STOP_AUDIO_CAPTURE,
      })
      .catch(() => {});

    setCaptureState("idle");
    console.log("[ClearVoice SW] Stopped capture session.");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ClearVoice SW] Error stopping capture:", message);
    setCaptureState("error", message);
  }
}

function isTrustedExtensionSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab;
}

// Handle messages from popup and offscreen document
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (!isTrustedExtensionSender(sender)) {
    return false;
  }

  switch (message.type) {
    case MessageType.GET_STATUS:
      sendResponse({
        state: currentState,
        error: lastErrorMsg,
        modelStatus: lastModelStatus,
        lastTranscript,
        language: selectedLanguage,
      });
      return false;

    case MessageType.PREWARM_MODEL:
      void ensureOffscreenDocument();
      sendResponse({ success: true });
      return false;

    case MessageType.STATUS_UPDATE:
      setCaptureState(message.state, message.error);
      return false;

    case MessageType.MODEL_STATUS:
      if (lastModelStatus.status === "error" && message.status === "loading") {
        return false;
      }
      lastModelStatus = {
        status: message.status,
        progress: message.progress,
        file: message.file,
        device: message.device,
        error: message.error,
      };
      persistSessionState();
      return false;

    case MessageType.SET_LANGUAGE:
      selectedLanguage = message.language;
      persistSessionState();
      return false;

    case MessageType.START_CAPTURE:
      if (message.tabId) {
        void startCapture(message.tabId, message.language);
        sendResponse({ success: true });
      } else {
        sendResponse({ error: "Missing tabId" });
      }
      return false;

    case MessageType.STOP_CAPTURE:
      void stopCapture();
      sendResponse({ success: true });
      return false;

    case MessageType.TRANSCRIPT_UPDATE:
      if (!activeSessionId || message.segment?.sessionId !== activeSessionId) {
        return false;
      }
      lastTranscript = message.segment?.text ?? null;
      persistSessionState();
      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, message).catch(() => {});
      }
      return false;
  }
  return false;
});

// Re-inject overlay if the captured tab reloads or navigates while capturing
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (activeTabId === tabId && currentState === "capturing" && changeInfo.status === "complete") {
    void injectOverlayIntoTab(tabId);
  }
});

// Watch for tab close to gracefully stop capture
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabId === tabId) {
    console.log(`[ClearVoice SW] Captured tab ${tabId} was closed. Stopping session.`);
    void stopCapture();
  }
});
