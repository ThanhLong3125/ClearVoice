import type { ExtensionMessage } from "../types/messages";
import "./overlay.css";

let overlayContainer: HTMLDivElement | null = null;
let subtitleBox: HTMLDivElement | null = null;
let hideTimer: number | null = null;

function ensureOverlayDOM(): void {
  if (overlayContainer) return;

  overlayContainer = document.createElement("div");
  overlayContainer.className = "clearvoice-overlay-container";
  overlayContainer.style.display = "none";

  subtitleBox = document.createElement("div");
  subtitleBox.className = "clearvoice-subtitle-box";
  overlayContainer.appendChild(subtitleBox);

  document.body.appendChild(overlayContainer);
}

function displaySubtitle(text: string, status: "partial" | "final" | "uncertain"): void {
  ensureOverlayDOM();
  if (!overlayContainer || !subtitleBox) return;

  subtitleBox.textContent = text;
  subtitleBox.className = `clearvoice-subtitle-box ${status}`;
  overlayContainer.style.display = "block";

  // Auto-hide subtitle after 5 seconds of inactivity if final
  if (hideTimer) {
    window.clearTimeout(hideTimer);
  }

  if (status === "final") {
    hideTimer = window.setTimeout(() => {
      if (overlayContainer) {
        overlayContainer.style.display = "none";
      }
    }, 5000);
  }
}

// Listen for transcript updates from Background
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "TRANSCRIPT_UPDATE") {
    displaySubtitle(message.segment.text, message.segment.status);
  }
});
