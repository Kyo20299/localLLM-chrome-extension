// sidepanel.js - main entry: chat UI + settings wiring.
import { loadSettings, saveSettings } from "./src/store.js";
import { fetchModels, streamChatCompletion } from "./src/api.js";
import { renderMarkdown } from "./src/markdown.js";
import { getPageContext, getActiveTab } from "./src/pageContext.js";

const $ = (id) => document.getElementById(id);

let settings = null;
let history = []; // [{role, content}]
let currentController = null;
let includePage = false; // opt-in: append active tab's text to each request

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

  // Opt-in page context: fetched per-turn so it never pollutes chat memory.
  let pageMsg = null;
  if (includePage) {
    const ctx = await getPageContext();
    if (!ctx || ctx.unavailable) {
      addMessage("bot", "Page content is not available on this tab (restricted or empty). Try a normal web page.");
      return;
    }
    pageMsg = {
      role: "system",
      content: `The user is currently viewing this web page. Use its content as context for their question.\n\nTITLE: ${ctx.title}\nURL: ${ctx.url}\n\nCONTENT:\n${ctx.text}`,
    };
  }

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
          ...(pageMsg ? [pageMsg] : []),
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

/* ---------- Page context chip ---------- */

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

async function updatePageChip() {
  const bar = $("page-bar");
  let tab = null;
  try { tab = await getActiveTab(); } catch (e) { /* ignore */ }
  if (!tab || !tab.url) { bar.hidden = true; return; }
  bar.hidden = false;
  let host;
  try { host = new URL(tab.url).host; } catch { host = tab.url; }
  $("page-title").textContent = truncate(`${host} — ${tab.title || "untitled"}`, 48);
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

  // Page context chip (toggle + live tab title)
  $("btn-page-ctx").addEventListener("click", () => {
    includePage = !includePage;
    $("btn-page-ctx").classList.toggle("on", includePage);
    $("page-state").textContent = `include: ${includePage ? "on" : "off"}`;
  });
  chrome.tabs.onActivated.addListener(updatePageChip);
  window.addEventListener("focus", updatePageChip);
  updatePageChip();

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
