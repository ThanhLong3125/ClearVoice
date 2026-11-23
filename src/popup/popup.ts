import { MessageType, type ExtensionMessage, type CaptureState } from "../types/messages";

const btnStart = document.getElementById("btnStart") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;
const statusDot = document.getElementById("statusDot") as HTMLDivElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const statusSubtext = document.getElementById("statusSubtext") as HTMLDivElement;
const errorMsg = document.getElementById("errorMsg") as HTMLDivElement;

let currentCaptureState: CaptureState = "idle";

function updateUI(state: CaptureState, error?: string): void {
  currentCaptureState = state;
  statusDot.className = `status-dot ${state}`;
  errorMsg.style.display = error ? "block" : "none";
  if (error) {
    errorMsg.textContent = error;
  }

  switch (state) {
    case "idle":
      statusText.textContent = "Trạng thái: Sẵn sàng";
      statusSubtext.style.display = "none";
      btnStart.disabled = false;
      btnStop.disabled = true;
      break;
    case "starting":
      statusText.textContent = "Đang khởi tạo...";
      statusSubtext.style.display = "block";
      statusSubtext.textContent = "Chuẩn bị thu âm và mô hình AI...";
      btnStart.disabled = true;
      btnStop.disabled = true;
      break;
    case "capturing":
      statusText.textContent = "Đang thu âm tab";
      statusSubtext.style.display = "block";
      statusSubtext.textContent = "Phụ đề đang hiển thị trực tiếp trên video";
      btnStart.disabled = true;
      btnStop.disabled = false;
      break;
    case "stopping":
      statusText.textContent = "Đang dừng...";
      statusSubtext.style.display = "none";
      btnStart.disabled = true;
      btnStop.disabled = true;
      break;
    case "error":
      statusText.textContent = "Lỗi capture";
      statusSubtext.style.display = "none";
      btnStart.disabled = false;
      btnStop.disabled = true;
      break;
  }
}

function updateModelUI(modelStatus?: {
  status: "idle" | "loading" | "ready" | "error";
  progress?: number;
  file?: string;
  device?: string;
  error?: string;
}): void {
  if (!modelStatus || currentCaptureState !== "starting") return;

  if (modelStatus.status === "loading") {
    const rawFile = modelStatus.file?.split("/").pop()?.replace(".onnx", "").replace("_model", "") ?? "AI";
    const percent = modelStatus.progress ?? 0;
    statusSubtext.style.display = "block";
    if (percent === 100 && (rawFile.includes("decoder") || rawFile.includes("q4"))) {
      statusSubtext.textContent = "Đang nạp bộ nhớ AI...";
    } else {
      statusSubtext.textContent = `Đang tải mô hình ${rawFile} (${percent}%)...`;
    }
  } else if (modelStatus.status === "ready") {
    statusSubtext.style.display = "block";
    statusSubtext.textContent = "Mô hình AI đã sẵn sàng";
  } else if (modelStatus.status === "error") {
    statusSubtext.style.display = "block";
    statusSubtext.textContent = "Lỗi khi tải AI";
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
  }
});

// Listen for status updates
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === MessageType.STATUS_UPDATE) {
    updateUI(message.state, message.error);
  } else if (message.type === MessageType.MODEL_STATUS) {
    updateModelUI(message);
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
