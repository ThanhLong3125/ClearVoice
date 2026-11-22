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
const statModel = document.getElementById("statModel") as HTMLElement;
const statVad = document.getElementById("statVad") as HTMLElement;
const statQueue = document.getElementById("statQueue") as HTMLElement;
const subtitleCard = document.getElementById("subtitleCard") as HTMLDivElement;
const popupSubtitle = document.getElementById("popupSubtitle") as HTMLDivElement;

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
      if (subtitleCard) subtitleCard.style.display = "none";
      updateVolume(0);
      resetStats();
      break;
    case "starting":
      statusText.textContent = "Đang khởi tạo capture...";
      btnStart.disabled = true;
      btnStop.disabled = true;
      volumeContainer.style.display = "block";
      if (pipelineStats) pipelineStats.style.display = "block";
      if (subtitleCard) subtitleCard.style.display = "block";
      break;
    case "capturing":
      statusText.textContent = "Đang thu âm tab";
      btnStart.disabled = true;
      btnStop.disabled = false;
      volumeContainer.style.display = "block";
      if (pipelineStats) pipelineStats.style.display = "block";
      if (subtitleCard) subtitleCard.style.display = "block";
      break;
    case "stopping":
      statusText.textContent = "Đang dừng...";
      btnStart.disabled = true;
      btnStop.disabled = true;
      volumeContainer.style.display = "none";
      if (pipelineStats) pipelineStats.style.display = "none";
      if (subtitleCard) subtitleCard.style.display = "none";
      updateVolume(0);
      break;
    case "error":
      statusText.textContent = "Lỗi capture";
      btnStart.disabled = false;
      btnStop.disabled = true;
      volumeContainer.style.display = "none";
      if (pipelineStats) pipelineStats.style.display = "none";
      if (subtitleCard) subtitleCard.style.display = "none";
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
  if (statModel) {
    statModel.textContent = "Đang kết nối...";
    statModel.style.color = "#38bdf8";
  }
  if (statVad) {
    statVad.textContent = "Chờ âm thanh...";
    statVad.style.color = "#94a3b8";
  }
  if (statQueue) statQueue.textContent = "0/5 (0 chunks)";
  if (popupSubtitle) popupSubtitle.textContent = "Đang lắng nghe...";
}

function updateModelUI(modelStatus?: {
  status: "idle" | "loading" | "ready" | "error";
  progress?: number;
  file?: string;
  device?: string;
  error?: string;
}): void {
  if (!statModel || !modelStatus) return;
  if (modelStatus.status === "loading") {
    const rawFile = modelStatus.file?.split("/").pop()?.replace(".onnx", "").replace("_model", "") ?? "AI";
    const percent = modelStatus.progress ?? 0;
    if (percent === 100 && (rawFile.includes("decoder") || rawFile.includes("q4"))) {
      statModel.textContent = "Đang nạp bộ nhớ...";
      statModel.style.color = "#38bdf8";
    } else {
      statModel.textContent = `Tải ${rawFile} (${percent}%)`;
      statModel.style.color = "#38bdf8";
    }
  } else if (modelStatus.status === "ready") {
    statModel.textContent = `Sẵn sàng (${modelStatus.device?.toUpperCase() ?? "WASM"})`;
    statModel.style.color = "#10b981";
  } else if (modelStatus.status === "error") {
    statModel.textContent = "Lỗi nạp AI (Xem log)";
    statModel.title = modelStatus.error ?? "";
    statModel.style.color = "#ef4444";
  } else if (modelStatus.status === "idle") {
    statModel.textContent = "Chờ khởi tạo...";
    statModel.style.color = "#94a3b8";
  }
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
    if (response.modelStatus) {
      updateModelUI(response.modelStatus);
    }
    if (response.lastTranscript && popupSubtitle) {
      popupSubtitle.textContent = response.lastTranscript;
    }
  }
});

// Listen for status updates and volume from background
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === MessageType.STATUS_UPDATE) {
    updateUI(message.state, message.error);
  } else if (message.type === MessageType.AUDIO_VOLUME) {
    updateVolume(message.volume);
  } else if (message.type === MessageType.MODEL_STATUS) {
    updateModelUI(message);
  } else if (message.type === MessageType.TRANSCRIPT_UPDATE) {
    if (popupSubtitle && message.segment?.text) {
      popupSubtitle.textContent = message.segment.text;
    }
  } else if (message.type === MessageType.PIPELINE_METRICS) {
    if (statVad) {
      if (message.isSpeechActive) {
        statVad.textContent = "Đang có tiếng nói";
        statVad.style.color = "#10b981";
      } else {
        statVad.textContent = "Im lặng (Đã lọc)";
        statVad.style.color = "#94a3b8";
      }
    }
    if (statQueue) {
      statQueue.textContent = `${message.queueDepth}/${message.queueCapacity} (${message.totalChunks} chunks)`;
    }
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
