import type { ExtensionMessage } from "../types/messages";
import "./overlay.css";

let overlayContainer: HTMLDivElement | null = null;
let subtitleBox: HTMLDivElement | null = null;
let prevLineBox: HTMLDivElement | null = null;
let currLineBox: HTMLDivElement | null = null;
let hideTimer: number | null = null;
let lastFinalText: string = "";

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

  prevLineBox = document.createElement("div");
  prevLineBox.className = "clearvoice-line prev";
  prevLineBox.style.display = "none";

  currLineBox = document.createElement("div");
  currLineBox.className = "clearvoice-line curr";

  subtitleBox.appendChild(prevLineBox);
  subtitleBox.appendChild(currLineBox);
  overlayContainer.appendChild(subtitleBox);

  document.body.appendChild(overlayContainer);
}

function displaySubtitle(text: string, status: "partial" | "final" | "uncertain"): void {
  ensureOverlayDOM();
  if (!overlayContainer || !currLineBox || !prevLineBox) return;

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
