import type { ExtensionMessage, CaptureState } from "../types/messages";

const btnStart = document.getElementById("btnStart") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;
const statusDot = document.getElementById("statusDot") as HTMLDivElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const errorMsg = document.getElementById("errorMsg") as HTMLDivElement;
const volumeContainer = document.getElementById("volumeContainer") as HTMLDivElement;
const volumeBar = document.getElementById("volumeBar") as HTMLDivElement;
const volumePercent = document.getElementById("volumePercent") as HTMLSpanElement;

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
      updateVolume(0);
      break;
    case "starting":
      statusText.textContent = "Đang khởi tạo capture...";
      btnStart.disabled = true;
      btnStop.disabled = true;
      volumeContainer.style.display = "block";
      break;
    case "capturing":
      statusText.textContent = "Đang thu âm tab";
      btnStart.disabled = true;
      btnStop.disabled = false;
      volumeContainer.style.display = "block";
      break;
    case "stopping":
      statusText.textContent = "Đang dừng...";
      btnStart.disabled = true;
      btnStop.disabled = true;
      volumeContainer.style.display = "none";
      updateVolume(0);
      break;
    case "error":
      statusText.textContent = "Lỗi capture";
      btnStart.disabled = false;
      btnStop.disabled = true;
      volumeContainer.style.display = "none";
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

// Request initial status when popup opens
chrome.runtime.sendMessage<ExtensionMessage>({ type: "GET_STATUS" }, (response) => {
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
  if (message.type === "STATUS_UPDATE") {
    updateUI(message.state, message.error);
  } else if (message.type === "AUDIO_VOLUME") {
    updateVolume(message.volume);
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
    { type: "START_CAPTURE", tabId: tab.id },
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
  chrome.runtime.sendMessage<ExtensionMessage>({ type: "STOP_CAPTURE" }, () => {
    if (chrome.runtime.lastError) {
      updateUI("error", chrome.runtime.lastError.message);
    }
  });
});
