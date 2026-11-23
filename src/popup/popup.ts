import { MessageType, type ExtensionMessage, type CaptureState } from "../types/messages";

const btnStart = document.getElementById("btnStart") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;
const statusDot = document.getElementById("statusDot") as HTMLDivElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const statusSubtext = document.getElementById("statusSubtext") as HTMLDivElement;
const errorMsg = document.getElementById("errorMsg") as HTMLDivElement;
const langSelect = document.getElementById("langSelect") as HTMLSelectElement | null;

let currentCaptureState: CaptureState = "idle";
let currentModelStatus: {
  status: "idle" | "loading" | "ready" | "error";
  progress?: number;
  file?: string;
  device?: string;
  error?: string;
} = { status: "idle" };

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

  renderModelStatus();
}

function renderModelStatus(): void {
  if (currentCaptureState !== "starting" && currentCaptureState !== "capturing") {
    return;
  }

  if (currentModelStatus.status === "loading") {
    const rawFile = currentModelStatus.file?.split("/").pop()?.replace(".onnx", "").replace("_model", "") ?? "AI";
    const percent = currentModelStatus.progress ?? 0;
    statusSubtext.style.display = "block";
    if (percent === 100 && (rawFile.includes("decoder") || rawFile.includes("q4"))) {
      statusSubtext.textContent = "Đang nạp bộ nhớ AI...";
    } else {
      statusSubtext.textContent = `Đang tải mô hình ${rawFile} (${percent}%)...`;
    }
  } else if (currentModelStatus.status === "ready") {
    statusSubtext.style.display = "block";
    const badge = currentModelStatus.device ? ` (${currentModelStatus.device.toUpperCase()})` : "";
    statusSubtext.textContent =
      currentCaptureState === "capturing"
        ? `Phụ đề trực tiếp trên video${badge}`
        : `Mô hình AI đã sẵn sàng${badge}`;
  } else if (currentModelStatus.status === "error") {
    statusSubtext.style.display = "block";
    statusSubtext.textContent = currentModelStatus.error || "Lỗi khi tải mô hình AI";
  }
}

function updateModelUI(modelStatus?: typeof currentModelStatus): void {
  if (!modelStatus) return;
  currentModelStatus = modelStatus;
  renderModelStatus();
}

// Request initial status when popup opens and trigger fast pre-warm
chrome.runtime.sendMessage<ExtensionMessage>(
  { type: MessageType.GET_STATUS },
  (response?: {
    state?: CaptureState;
    error?: string;
    modelStatus?: typeof currentModelStatus;
    language?: string;
  }) => {
    if (chrome.runtime.lastError) {
      updateUI("idle");
      return;
    }
    if (response?.language && langSelect) {
      langSelect.value = response.language;
    }
    if (response?.modelStatus) {
      currentModelStatus = response.modelStatus;
    }
    if (response?.state) {
      updateUI(response.state, response.error);
    }

    // Proactively pre-warm model in background worker while user reviews popup
    if (response?.modelStatus?.status !== "ready") {
      chrome.runtime.sendMessage<ExtensionMessage>({ type: MessageType.PREWARM_MODEL }).catch(() => {});
    }
  }
);

// Listen for status updates
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === MessageType.STATUS_UPDATE) {
    updateUI(message.state, message.error);
  } else if (message.type === MessageType.MODEL_STATUS) {
    updateModelUI(message);
  }
});

langSelect?.addEventListener("change", () => {
  chrome.runtime.sendMessage<ExtensionMessage>({
    type: MessageType.SET_LANGUAGE,
    language: langSelect.value,
  }).catch(() => {});
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
    {
      type: MessageType.START_CAPTURE,
      tabId: tab.id,
      language: langSelect?.value ?? "auto",
    },
    (response?: { error?: string }) => {
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
