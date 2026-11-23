import type { ExtensionMessage } from "../types/messages";
import overlayStyles from "./overlay.css?inline";

let shadowHost: HTMLDivElement | null = null;
let overlayContainer: HTMLDivElement | null = null;
let subtitleBox: HTMLDivElement | null = null;
let prevLineBox: HTMLDivElement | null = null;
let currLineBox: HTMLDivElement | null = null;
let hideTimer: number | null = null;
let lastFinalText: string = "";
let activeSessionId: string | null = null;

function resolveOverlayMountTarget(): HTMLElement {
  const fs = document.fullscreenElement as HTMLElement | null;
  if (fs && fs.tagName !== "VIDEO" && fs.tagName !== "IFRAME") {
    return fs;
  }
  return document.body;
}

function syncOverlayParent(): void {
  if (!shadowHost) return;
  const target = resolveOverlayMountTarget();
  if (shadowHost.parentElement !== target) {
    target.appendChild(shadowHost);
  }
}

function ensureOverlayDOM(): void {
  if (overlayContainer && shadowHost) {
    syncOverlayParent();
    return;
  }

  shadowHost = document.createElement("div");
  shadowHost.id = "clearvoice-shadow-host";
  const shadowRoot = shadowHost.attachShadow({ mode: "closed" });

  const styleEl = document.createElement("style");
  styleEl.textContent = overlayStyles;
  shadowRoot.appendChild(styleEl);

  overlayContainer = document.createElement("div");
  overlayContainer.className = "clearvoice-overlay-container";
  overlayContainer.style.display = "none";

  subtitleBox = document.createElement("div");
  subtitleBox.className = "clearvoice-subtitle-box";

  prevLineBox = document.createElement("div");
  prevLineBox.className = "clearvoice-line prev";
  prevLineBox.style.display = "none";

  currLineBox = document.createElement("div");
  currLineBox.className = "clearvoice-line curr";

  subtitleBox.appendChild(prevLineBox);
  subtitleBox.appendChild(currLineBox);
  overlayContainer.appendChild(subtitleBox);
  shadowRoot.appendChild(overlayContainer);

  syncOverlayParent();
  document.addEventListener("fullscreenchange", syncOverlayParent);
}

function displaySubtitle(sessionId: string, text: string, status: "partial" | "final" | "uncertain"): void {
  ensureOverlayDOM();
  if (!overlayContainer || !currLineBox || !prevLineBox) return;

  if (activeSessionId !== sessionId) {
    activeSessionId = sessionId;
    lastFinalText = "";
    prevLineBox.textContent = "";
    prevLineBox.style.display = "none";
  }

  const clean = text.trim();
  if (!clean) return;

  currLineBox.textContent = clean;
  currLineBox.className = `clearvoice-line curr ${status}`;

  if (lastFinalText && lastFinalText !== clean) {
    prevLineBox.textContent = lastFinalText;
    prevLineBox.style.display = "block";
  }

  overlayContainer.style.display = "block";

  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }

  if (status === "final") {
    lastFinalText = clean;
    hideTimer = window.setTimeout(() => {
      if (overlayContainer) {
        overlayContainer.style.display = "none";
      }
    }, 6000);
  }
}

// Prevent duplicate listeners if content script is injected multiple times
const globalOverlayState = window as unknown as { __clearVoiceOverlayLoaded?: boolean };
if (!globalOverlayState.__clearVoiceOverlayLoaded) {
  globalOverlayState.__clearVoiceOverlayLoaded = true;

  chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message.type === "TRANSCRIPT_UPDATE") {
      displaySubtitle(message.segment.sessionId, message.segment.text, message.segment.status);
    } else if (message.type === "STATUS_UPDATE") {
      if (message.state === "idle" || message.state === "error") {
        activeSessionId = null;
        lastFinalText = "";
        if (overlayContainer) {
          overlayContainer.style.display = "none";
        }
      }
    }
  });
}
