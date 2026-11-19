import { MessageType, type ExtensionMessage, type CaptureState } from "../types/messages";

const btnStart = document.getElementById("btnStart") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;
const statusDot = document.getElementById("statusDot") as HTMLDivElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const errorMsg = document.getElementById("errorMsg") as HTMLDivElement;
const volumeContainer = document.getElementById("volumeContainer") as HTMLDivElement;
const volumeBar = document.getElementById("volumeBar") as HTMLDivElement;
const volumePercent = document.getElementById("volumePercent") as HTMLSpanElement;

const pipelineStats = document.getElementById("pipelineStats") as HTMLDivElement;
const statChunks = document.getElementById("statChunks") as HTMLElement;
const statDuration = document.getElementById("statDuration") as HTMLElement;
const statQueue = document.getElementById("statQueue") as HTMLElement;

function updateUI(state: CaptureState, error?: string): void {
  statusDot.className = `status-dot ${state}`;
  errorMsg.style.display = error ? "block" : "none";
  if (error) {
    errorMsg.textContent = error;
  }

  switch (state) {
    case "idle":
      statusText.textContent = "Trạng thái: Sẵn sàng";
      btnStart.disabled = false;
      btnStop.disabled = true;
      volumeContainer.style.display = "none";
      if (pipelineStats) pipelineStats.style.display = "none";
      updateVolume(0);
      resetStats();
      break;
    case "starting":
      statusText.textContent = "Đang khởi tạo capture...";
      btnStart.disabled = true;
      btnStop.disabled = true;
      volumeContainer.style.display = "block";
      if (pipelineStats) pipelineStats.style.display = "block";
      break;
    case "capturing":
      statusText.textContent = "Đang thu âm tab";
      btnStart.disabled = true;
      btnStop.disabled = false;
      volumeContainer.style.display = "block";
      if (pipelineStats) pipelineStats.style.display = "block";
      break;
    case "stopping":
      statusText.textContent = "Đang dừng...";
      btnStart.disabled = true;
      btnStop.disabled = true;
      volumeContainer.style.display = "none";
      if (pipelineStats) pipelineStats.style.display = "none";
      updateVolume(0);
      break;
    case "error":
      statusText.textContent = "Lỗi capture";
      btnStart.disabled = false;
      btnStop.disabled = true;
      volumeContainer.style.display = "none";
      if (pipelineStats) pipelineStats.style.display = "none";
      updateVolume(0);
      break;
  }
}

function updateVolume(percent: number): void {
  if (volumeBar && volumePercent) {
    volumeBar.style.width = `${percent}%`;
    volumePercent.textContent = `${percent}%`;
  }
}

function resetStats(): void {
  if (statChunks) statChunks.textContent = "0";
  if (statDuration) statDuration.textContent = "0.0s";
  if (statQueue) statQueue.textContent = "0/5";
}

// Request initial status when popup opens
chrome.runtime.sendMessage<ExtensionMessage>({ type: MessageType.GET_STATUS }, (response) => {
  if (chrome.runtime.lastError) {
    console.error("Error getting status:", chrome.runtime.lastError);
    updateUI("idle");
    return;
  }
  if (response && response.state) {
    updateUI(response.state, response.error);
  }
});

// Listen for status updates and volume from background
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === MessageType.STATUS_UPDATE) {
    updateUI(message.state, message.error);
  } else if (message.type === MessageType.AUDIO_VOLUME) {
    updateVolume(message.volume);
  } else if (message.type === MessageType.PIPELINE_METRICS) {
    if (statChunks) statChunks.textContent = String(message.totalChunks);
    if (statDuration) statDuration.textContent = `${message.durationSec}s`;
    if (statQueue) statQueue.textContent = `${message.queueDepth}/${message.queueCapacity}`;
  }
});

// User clicks Start
btnStart.addEventListener("click", async () => {
  updateUI("starting");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    updateUI("error", "Không tìm thấy tab hiện tại.");
    return;
  }

  chrome.runtime.sendMessage<ExtensionMessage>(
    { type: MessageType.START_CAPTURE, tabId: tab.id },
    (response) => {
      if (chrome.runtime.lastError) {
        updateUI("error", chrome.runtime.lastError.message);
        return;
      }
      if (response && response.error) {
        updateUI("error", response.error);
      }
    }
  );
});

// User clicks Stop
btnStop.addEventListener("click", () => {
  updateUI("stopping");
  chrome.runtime.sendMessage<ExtensionMessage>({ type: MessageType.STOP_CAPTURE }, () => {
    if (chrome.runtime.lastError) {
      updateUI("error", chrome.runtime.lastError.message);
    }
  });
});
