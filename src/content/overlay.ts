import type { ExtensionMessage } from "../types/messages";
import "./overlay.css";

let overlayContainer: HTMLDivElement | null = null;
let subtitleBox: HTMLDivElement | null = null;
let hideTimer: number | null = null;

let liveBadge: HTMLDivElement | null = null;
let badgeVolumeLevel: HTMLDivElement | null = null;

function ensureBadgeDOM(): void {
  if (liveBadge) return;

  liveBadge = document.createElement("div");
  liveBadge.className = "clearvoice-live-badge";
  liveBadge.style.display = "none";

  const dot = document.createElement("div");
  dot.className = "indicator-dot";

  const label = document.createElement("span");
  label.textContent = "ClearVoice Audio";

  const track = document.createElement("div");
  track.className = "volume-track";

  badgeVolumeLevel = document.createElement("div");
  badgeVolumeLevel.className = "volume-level";
  track.appendChild(badgeVolumeLevel);

  liveBadge.appendChild(dot);
  liveBadge.appendChild(label);
  liveBadge.appendChild(track);

  document.body.appendChild(liveBadge);
}

function updateBadgeVolume(volume: number): void {
  ensureBadgeDOM();
  if (!liveBadge || !badgeVolumeLevel) return;

  if (volume > 0) {
    liveBadge.style.display = "flex";
    badgeVolumeLevel.style.width = `${volume}%`;
  } else {
    badgeVolumeLevel.style.width = "0%";
  }
}

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

// Prevent duplicate listeners if content script is injected both declaratively and programmatically
const globalOverlayState = window as unknown as { __clearVoiceOverlayLoaded?: boolean };
if (!globalOverlayState.__clearVoiceOverlayLoaded) {
  globalOverlayState.__clearVoiceOverlayLoaded = true;

  chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
    if (message.type === "TRANSCRIPT_UPDATE") {
      displaySubtitle(message.segment.text, message.segment.status);
    } else if (message.type === "AUDIO_VOLUME") {
      updateBadgeVolume(message.volume);
    } else if (message.type === "STATUS_UPDATE") {
      if (message.state === "idle" || message.state === "error") {
        if (liveBadge) {
          liveBadge.style.display = "none";
        }
      }
    }
  });
}
