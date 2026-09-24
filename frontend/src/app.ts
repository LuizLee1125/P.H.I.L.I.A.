// P.H.I.L.I.A. Desktop Client Logic

const API_BASE = "http://127.0.0.1:4172";

// DOM Elements
const chatMessages = document.getElementById("chat-messages") as HTMLElement;
const chatForm = document.getElementById("chat-form") as HTMLFormElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;
const voiceBtn = document.getElementById("voice-btn") as HTMLButtonElement;
const micIcon = document.getElementById("mic-icon") as unknown as SVGElement;
const waveformVisualizer = document.getElementById("waveform-visualizer") as HTMLElement;
const voiceLabel = document.getElementById("voice-label") as HTMLElement;
const statusIndicator = document.getElementById("status-indicator") as HTMLElement;
const statusText = document.getElementById("status-text") as HTMLElement;
const activityBanner = document.getElementById("activity-banner") as HTMLElement;
const activityText = document.getElementById("activity-text") as HTMLElement;
const clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
const ttsToggle = document.getElementById("tts-toggle") as HTMLButtonElement;

// Computer Access Elements
const accessBtn = document.getElementById("access-btn") as HTMLButtonElement;
const accessIcon = document.getElementById("access-icon") as HTMLElement;
const accessText = document.getElementById("access-text") as HTMLElement;
const accessModal = document.getElementById("access-modal") as HTMLElement;
const grantAccessBtn = document.getElementById("grant-access-btn") as HTMLButtonElement;
const dismissAccessBtn = document.getElementById("dismiss-access-btn") as HTMLButtonElement;

// Minimized widget elements
const mainWindow = document.querySelector(".main-window") as HTMLElement;
const minimizeBtn = document.getElementById("minimize-btn") as HTMLButtonElement;
const minimizedWidget = document.getElementById("minimized-widget") as HTMLElement;
const expandBtn = document.getElementById("expand-btn") as HTMLElement;
const pillRestoreBtn = document.getElementById("pill-restore-btn") as HTMLButtonElement;
const miniVoiceBtn = document.getElementById("mini-voice-btn") as HTMLButtonElement;
const miniStatus = document.getElementById("mini-status") as HTMLElement;

let isVoiceActive = true;
let isBusy = false;
let isFullAccessGranted = false;

function updateAccessBadge(granted: boolean) {
  isFullAccessGranted = granted;
  if (accessBtn && accessIcon && accessText) {
    if (granted) {
      accessBtn.className = "access-badge granted";
      accessBtn.title = "Full Computer Access: Active (Permission granted, will never ask again)";
      accessIcon.textContent = "🔓";
      accessText.textContent = "Full Access";
      hideAccessModal();
    } else {
      accessBtn.className = "access-badge restricted";
      accessBtn.title = "Computer Access: Restricted. Tap to grant full access.";
      accessIcon.textContent = "🔒";
      accessText.textContent = "Access: Restricted";
    }
  }
}

function showAccessModal() {
  if (accessModal) accessModal.classList.remove("hidden");
}

function hideAccessModal() {
  if (accessModal) accessModal.classList.add("hidden");
}

async function requestGrantAccess() {
  try {
    const res = await fetch(`${API_BASE}/api/permissions/grant`, { method: "POST" });
    if (res.ok) {
      updateAccessBadge(true);
      appendAssistantMessage("Full computer access has been granted to Philia. All restrictions are lifted and you will never be asked again.");
    }
  } catch (err) {
    console.error("Failed to grant full access:", err);
  }
}

// Connect to Server-Sent Events (SSE) for live status & wake-word updates
function setupEventStream() {
  const eventSource = new EventSource(`${API_BASE}/api/events`);

  eventSource.onopen = () => {
    updateStatus("online", "Online");
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerEvent(data);
    } catch (e) {
      console.error("SSE parse error:", e);
    }
  };

  eventSource.onerror = () => {
    updateStatus("offline", "Reconnecting...");
    setTimeout(setupEventStream, 3000);
    eventSource.close();
  };
}

interface ServerEventData {
  type: string;
  message?: string;
  tool?: string;
  fullAccessGranted?: boolean;
  fullAccessRequired?: boolean;
}

function handleServerEvent(event: ServerEventData) {
  switch (event.type) {
    case "connected":
      updateStatus("online", "Online");
      break;

    case "permissions_updated":
      updateAccessBadge(Boolean(event.fullAccessGranted));
      break;

    case "confirmation_required":
      if (!isFullAccessGranted) {
        showAccessModal();
      }
      break;

    case "wake_word":
      setVoiceState("listening", "Listening to voice...");
      showActivity("Wake word detected: PHILIA");
      break;

    case "listening":
      setVoiceState("listening", "Listening...");
      showActivity("Listening for your command...");
      break;

    case "transcribing":
      setVoiceState("busy", "Transcribing...");
      showActivity("Transcribing spoken audio...");
      break;

    case "thinking":
      setVoiceState("busy", "Thinking...");
      showActivity(event.message || "Philia is analyzing...");
      break;

    case "tool_start":
      showActivity(`Running tool: ${event.tool}...`);
      break;

    case "tool_done":
      showActivity(`Completed: ${event.tool}`);
      break;

    case "user_command":
      if (event.message) appendUserMessage(event.message);
      break;

    case "reply":
      hideActivity();
      setVoiceState("idle", "Tap to Speak");
      if (event.message) appendAssistantMessage(event.message);
      break;

    case "idle":
    case "error":
      hideActivity();
      setVoiceState("idle", "Tap to Speak");
      break;
  }
}

function updateStatus(state: "online" | "busy" | "offline", label: string) {
  statusIndicator.className = `status-dot ${state}`;
  statusText.textContent = label;
  miniStatus.textContent = label;
}

function showActivity(text: string) {
  activityText.textContent = text;
  activityBanner.classList.remove("hidden");
}

function hideActivity() {
  activityBanner.classList.add("hidden");
}

function setVoiceState(state: "idle" | "listening" | "busy", label: string) {
  voiceLabel.textContent = label;

  if (state === "listening") {
    voiceBtn.classList.add("listening");
    micIcon.classList.add("hidden");
    waveformVisualizer.classList.remove("hidden");
    updateStatus("busy", "Listening");
  } else if (state === "busy") {
    voiceBtn.classList.remove("listening");
    voiceBtn.classList.add("speaking");
    micIcon.classList.remove("hidden");
    waveformVisualizer.classList.add("hidden");
    updateStatus("busy", "Processing");
  } else {
    voiceBtn.classList.remove("listening", "speaking");
    micIcon.classList.remove("hidden");
    waveformVisualizer.classList.add("hidden");
    updateStatus("online", "Online");
  }
}

function appendUserMessage(text: string) {
  const lastMsg = chatMessages.lastElementChild;
  if (lastMsg && lastMsg.classList.contains("user-message") && lastMsg.textContent?.includes(text)) {
    return;
  }

  const msgDiv = document.createElement("div");
  msgDiv.className = "message user-message";

  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content";
  contentDiv.textContent = text;

  msgDiv.appendChild(contentDiv);
  chatMessages.appendChild(msgDiv);
  scrollToBottom();
}

interface ToolExecutionInfo {
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
}

function appendAssistantMessage(text: string, toolsUsed: ToolExecutionInfo[] = []) {
  const lastMsg = chatMessages.lastElementChild;
  if (lastMsg && lastMsg.classList.contains("assistant-message") && lastMsg.textContent === text) {
    return;
  }

  const msgDiv = document.createElement("div");
  msgDiv.className = "message assistant-message";

  const avatarDiv = document.createElement("div");
  avatarDiv.className = "msg-avatar";
  const avatarDot = document.createElement("div");
  avatarDot.className = "avatar-dot";
  avatarDiv.appendChild(avatarDot);

  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content";

  const formatted = text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
  contentDiv.innerHTML = `<p>${formatted}</p>`;

  if (toolsUsed && toolsUsed.length > 0) {
    for (const tool of toolsUsed) {
      const chip = document.createElement("div");
      chip.className = "tool-chip";
      chip.innerHTML = `<span>⚡</span> <span>${tool.tool}</span>`;
      contentDiv.appendChild(chip);
    }
  }

  msgDiv.appendChild(avatarDiv);
  msgDiv.appendChild(contentDiv);
  chatMessages.appendChild(msgDiv);
  scrollToBottom();
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendCommand(prompt: string) {
  if (!prompt || prompt.trim().length === 0 || isBusy) return;

  isBusy = true;
  appendUserMessage(prompt);
  chatInput.value = "";
  showActivity("Analyzing command...");
  setVoiceState("busy", "Thinking...");

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: prompt.trim(),
        playVoice: isVoiceActive,
      }),
    });

    const data = await res.json();
    hideActivity();
    setVoiceState("idle", "Tap to Speak");

    if (data.reply) {
      appendAssistantMessage(data.reply, data.toolsUsed);
    }
  } catch {
    hideActivity();
    setVoiceState("idle", "Tap to Speak");
    appendAssistantMessage("Could not connect to Philia backend. Please ensure the backend is running.");
  } finally {
    isBusy = false;
  }
}

async function triggerVoiceListen() {
  if (isBusy) return;
  isBusy = true;

  setVoiceState("listening", "Listening (speak now)...");
  showActivity("Recording speech from microphone...");

  try {
    const res = await fetch(`${API_BASE}/api/voice/listen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json();
    hideActivity();
    setVoiceState("idle", "Tap to Speak");

    if (data.transcript) {
      appendUserMessage(data.transcript);
    }

    if (data.reply) {
      appendAssistantMessage(data.reply, data.toolsUsed);
    }
  } catch {
    hideActivity();
    setVoiceState("idle", "Tap to Speak");
    appendAssistantMessage("Microphone capture error. Ensure your microphone is plugged in.");
  } finally {
    isBusy = false;
  }
}

// Form event listeners
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendCommand(chatInput.value);
});

voiceBtn.addEventListener("click", () => {
  triggerVoiceListen();
});

miniVoiceBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  triggerVoiceListen();
});

clearBtn.addEventListener("click", async () => {
  chatMessages.innerHTML = `
    <div class="message assistant-message initial-message">
      <div class="msg-avatar"><div class="avatar-dot"></div></div>
      <div class="msg-content"><p>Conversation cleared. Standing by, sir.</p></div>
    </div>
  `;
  await fetch(`${API_BASE}/api/reset`, { method: "POST" }).catch(() => {});
});

ttsToggle.addEventListener("click", () => {
  isVoiceActive = !isVoiceActive;
  ttsToggle.classList.toggle("active", isVoiceActive);
  ttsToggle.title = isVoiceActive ? "Voice Speech Enabled" : "Voice Speech Muted";
});

// Access button and modal listeners
if (accessBtn) {
  accessBtn.addEventListener("click", () => {
    if (!isFullAccessGranted) {
      showAccessModal();
    }
  });
}

if (grantAccessBtn) {
  grantAccessBtn.addEventListener("click", () => {
    requestGrantAccess();
  });
}

if (dismissAccessBtn) {
  dismissAccessBtn.addEventListener("click", async () => {
    hideAccessModal();
    await fetch(`${API_BASE}/api/permissions/asked`, { method: "POST" }).catch(() => {});
  });
}

minimizeBtn.addEventListener("click", () => {
  mainWindow.classList.add("hidden");
  minimizedWidget.classList.remove("hidden");
});

expandBtn.addEventListener("click", () => {
  mainWindow.classList.remove("hidden");
  minimizedWidget.classList.add("hidden");
});

pillRestoreBtn.addEventListener("click", () => {
  mainWindow.classList.remove("hidden");
  minimizedWidget.classList.add("hidden");
});

async function init() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    if (res.ok) {
      const data = await res.json();
      updateStatus("online", `Online (${data.model})`);
      if (typeof data.fullAccessGranted === "boolean") {
        updateAccessBadge(data.fullAccessGranted);
      }
    } else {
      updateStatus("offline", "Backend Offline");
    }
  } catch {
    updateStatus("offline", "Connecting...");
  }

  try {
    const permRes = await fetch(`${API_BASE}/api/permissions`);
    if (permRes.ok) {
      const perm = await permRes.json();
      updateAccessBadge(perm.fullAccessGranted);
      if (!perm.fullAccessGranted && !perm.asked) {
        showAccessModal();
      }
    }
  } catch {}

  setupEventStream();
}

init();
