// sidepanel.js - main entry: chat UI + settings wiring.
import { loadSettings, saveSettings } from "./src/store.js";
import { fetchModels, streamChatCompletion } from "./src/api.js";
import { renderMarkdown } from "./src/markdown.js";

const $ = (id) => document.getElementById(id);

let settings = null;
let history = []; // [{role, content}]
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
  btn.disabled = true;
  try {
    const models = await fetchModels(settings.baseUrl, settings.apiKey);
    const dl = $("dl-models");
    dl.innerHTML = models.map((m) => `<option value="${escapeAttr(m)}">`).join("");
    if (models.length && !models.includes(settings.model)) {
      $("inp-model").value = models[0];
      settings.model = models[0];
    }
  } catch (e) {
    console.warn("Model list unavailable:", e.message);
    dl.innerHTML = ""; // manual entry still works
  } finally {
    btn.disabled = false;
  }
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
    currentController = null;
    $("btn-send").hidden = false;
    $("btn-stop").hidden = true;
  }
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

  // Settings toggle
  $("settings-btn").addEventListener("click", () => {
    const panel = $("settings-panel");
    panel.hidden = !panel.hidden;
  });

  // Presets
  $("preset-ollama").addEventListener("click", () => {
    $("inp-base-url").value = "http://localhost:11434/v1";
  });
  $("preset-lmstudio").addEventListener("click", () => {
    $("inp-base-url").value = "http://localhost:1234/v1";
  });

  // Save settings
  $("btn-save-settings").addEventListener("click", async () => {
    settings = {
      baseUrl: $("inp-base-url").value.trim() || DEFAULT_BASE,
      apiKey: $("inp-api-key").value.trim(),
      model: $("inp-model").value.trim(),
      temperature: Number($("inp-temperature").value) || 0.7,
      maxTokens: $("inp-max-tokens").value ? Number($("inp-max-tokens").value) : null,
      systemPrompt: $("inp-system-prompt").value,
    };
    await saveSettings(settings);
    refreshModels();
  });

  // Model list refresh (also run on load, best-effort)
  $("btn-refresh-models").addEventListener("click", refreshModels);
  refreshModels();

  // Composer
  const input = $("inp-message");
  input.addEventListener("input", autoresize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $("btn-send").addEventListener("click", send);
  $("btn-stop").addEventListener("click", () => currentController?.abort());
}

const DEFAULT_BASE = "http://localhost:11434/v1";
init().catch((e) => console.error(e));
