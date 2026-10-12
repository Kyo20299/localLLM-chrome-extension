// sidepanel.js - main entry: chat UI + settings wiring.
import { loadSettings, saveSettings } from "./src/store.js";
import { fetchModels, streamChatCompletion } from "./src/api.js";
import { renderMarkdown } from "./src/markdown.js";
import { listConversations, saveConversation, deleteConversation } from "./src/conversations.js";

const $ = (id) => document.getElementById(id);

let settings = null;
let history = []; // messages of the ACTIVE conversation: [{role, content}]
let currentConvId = null; // id of the active conversation (null until first message)
let currentController = null;

/* ---------- Settings UI ---------- */

function applyToInputs() {
  $("inp-base-url").value = settings.baseUrl;
  $("inp-api-key").value = settings.apiKey || "";
  $("inp-model").value = settings.model;
  $("inp-temperature").value = settings.temperature;
  $("inp-max-tokens").value = settings.maxTokens ?? "";
  $("inp-system-prompt").value = settings.systemPrompt;
}

async function refreshModels() {
  const btn = $("btn-refresh-models");
  const dl = $("dl-models");
  btn.disabled = true;
  try {
    const models = await fetchModels(settings.baseUrl, settings.apiKey);
    dl.innerHTML = models.map((m) => `<option value="${escapeAttr(m)}">`).join("");
    if (models.length && !models.includes(settings.model)) {
      $("inp-model").value = models[0];
      settings.model = models[0];
    }
    return true;
  } catch (e) {
    console.warn("Model list unavailable:", e.message);
    dl.innerHTML = ""; // manual entry still works
    return false;
  } finally {
    btn.disabled = false;
  }
}

function showStatus(text, kind) {
  const el = $("settings-status");
  if (!el) return;
  el.textContent = text;
  el.className = kind || "";
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => {
    el.textContent = "";
    el.className = "";
  }, 5000);
}

function escapeAttr(s) {
  return s.replace(/"/g, "&quot;");
}

/* ---------- Chat UI ---------- */

function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = renderMarkdown(text);
  div.appendChild(bubble);
  $("messages").appendChild(div);
  scrollDown();
  return bubble;
}

function scrollDown() {
  const area = $("chat-area");
  area.scrollTop = area.scrollHeight;
}

async function send() {
  const input = $("inp-message");
  const text = input.value.trim();
  if (!text || currentController) return;

  if (!$("inp-model").value.trim()) {
    addMessage("bot", "No model selected — open settings (&#9881;) and pick one.");
    return;
  }

  input.value = "";
  autoresize();
  history.push({ role: "user", content: text });
  addMessage("user", text);
  if (!currentConvId) currentConvId = crypto.randomUUID();
  await persistCurrentConversation();

  const bubble = addMessage("bot", "");
  bubble.classList.add("typing");
  $("btn-send").hidden = true;
  $("btn-stop").hidden = false;

  let acc = "";
  let rafPending = false;
  const paint = () => {
    rafPending = false;
    bubble.innerHTML = renderMarkdown(acc);
    scrollDown();
  };

  try {
    const { controller, done } = streamChatCompletion(
      {
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: $("inp-model").value.trim(),
        messages: [
          ...(settings.systemPrompt ? [{ role: "system", content: settings.systemPrompt }] : []),
          ...history,
        ],
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      },
      (delta) => {
        acc += delta;
        if (!rafPending) { rafPending = true; requestAnimationFrame(paint); }
      }
    );
    currentController = controller;
    await done;
  } catch (e) {
    if (e.name === "AbortError") acc += "\n\n*[stopped]*";
    else bubble.innerHTML = `<p style="color:#d9534f">${renderMarkdown(`**Request failed:** ${e.message}`)}</p>`;
  } finally {
    if (rafPending) paint();
    bubble.classList.remove("typing");
    history.push({ role: "assistant", content: acc.trim() || "(no response)" });
    await persistCurrentConversation();
    currentController = null;
    $("btn-send").hidden = false;
    $("btn-stop").hidden = true;
  }
}

/* ---------- Conversation persistence + history UI ---------- */

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function persistCurrentConversation() {
  if (!currentConvId || !history.length) return;
  const firstUser = history.find((m) => m.role === "user");
  await saveConversation({
    id: currentConvId,
    title: truncate(firstUser ? firstUser.content : "New chat", 40),
    updatedAt: Date.now(),
    messages: history,
  });
}

async function renderHistoryList() {
  const list = $("conv-list");
  list.innerHTML = "";
  const convs = await listConversations();
  for (const c of convs) {
    const item = document.createElement("div");
    item.className = "conv-item" + (c.id === currentConvId ? " active" : "");

    const open = document.createElement("button");
    open.className = "conv-open";
    const title = document.createElement("span");
    title.className = "conv-title";
    title.textContent = c.title || "New chat";
    const time = document.createElement("small");
    time.className = "conv-time";
    time.textContent = new Date(c.updatedAt).toLocaleString();
    open.append(title, time);
    open.addEventListener("click", () => loadConversation(c.id));

    const del = document.createElement("button");
    del.className = "conv-del";
    del.title = "Delete conversation";
    del.textContent = "\u2715";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete “${c.title}”?`)) return;
      await deleteConversation(c.id);
      if (c.id === currentConvId) startNewChat();
      renderHistoryList();
    });

    item.append(open, del);
    list.appendChild(item);
  }
}

async function loadConversation(id) {
  const convs = await listConversations();
  const c = convs.find((x) => x.id === id);
  if (!c) return;
  currentConvId = id;
  history = [...c.messages];
  $("messages").innerHTML = "";
  for (const m of history) addMessage(m.role === "assistant" ? "bot" : "user", m.content);
  $("empty-hint").hidden = true;
}

function startNewChat() {
  currentConvId = null;
  history = [];
  $("messages").innerHTML = "";
  $("empty-hint").hidden = false;
}

/* ---------- Composer helpers ---------- */

function autoresize() {
  const el = $("inp-message");
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

/* ---------- Init ---------- */

async function init() {
  settings = await loadSettings();
  applyToInputs();

  // Panel toggles (mutually exclusive)
  const closePanels = (except) => {
    $("settings-panel").hidden = except !== "settings";
    $("history-panel").hidden = except !== "history";
  };
  $("settings-btn").addEventListener("click", () => {
    closePanels($("settings-panel").hidden ? "settings" : null);
  });
  $("history-btn").addEventListener("click", async () => {
    if ($("history-panel").hidden) {
      await renderHistoryList(); // refresh before showing
      closePanels("history");
    } else {
      closePanels(null);
    }
  });

  // New chat
  $("btn-new-chat").addEventListener("click", startNewChat);

  // Presets
  $("preset-ollama").addEventListener("click", () => {
    $("inp-base-url").value = "http://localhost:11434/v1";
  });
  $("preset-lmstudio").addEventListener("click", () => {
    $("inp-base-url").value = "http://localhost:1234/v1";
  });

  // Save settings
  $("btn-save-settings").addEventListener("click", async () => {
    const baseUrl = $("inp-base-url").value.trim();
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      showStatus(`Invalid base URL: "${baseUrl || "(empty)"}"`, "err");
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      showStatus("Base URL must use http:// or https://", "err");
      return;
    }
    settings = {
      baseUrl,
      apiKey: $("inp-api-key").value.trim(),
      model: $("inp-model").value.trim(),
      temperature: Number($("inp-temperature").value) || 0.7,
      maxTokens: $("inp-max-tokens").value ? Number($("inp-max-tokens").value) : null,
      systemPrompt: $("inp-system-prompt").value,
    };
    try {
      await saveSettings(settings);
    } catch (e) {
      showStatus(`Save failed: ${e.message}`, "err");
      return;
    }
    const modelsOk = await refreshModels();
    showStatus(
      modelsOk
        ? "Settings saved"
        : `Saved — model list unavailable at ${baseUrl} (server down or CORS blocked)`,
      modelsOk ? "ok" : "warn"
    );
  });

  // Model list refresh (also run on load, best-effort)
  $("btn-refresh-models").addEventListener("click", refreshModels);
  refreshModels();

  // Restore the most recent conversation (persists across panel/tab closes)
  const convs = await listConversations();
  if (convs.length) {
    await loadConversation(convs[0].id);
  }

  // Composer
  const input = $("inp-message");
  input.addEventListener("input", autoresize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $("btn-send").addEventListener("click", send);
  $("btn-stop").addEventListener("click", () => currentController?.abort());
}

init().catch((e) => console.error(e));
