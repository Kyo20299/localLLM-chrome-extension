# Local LLM Chrome Extension

Chat with **local LLM services** directly from Chrome's native side panel — no cloud, no accounts, no data leaving your machine.

The extension speaks the **OpenAI-compatible HTTP API**, so it works with any server that exposes `/v1/chat/completions` and `/v1/models`: Ollama, LM Studio, llama.cpp server, vLLM, LocalAI, and similar.

---

## Features

- 🪟 **Chrome native side panel** (Manifest V3 `sidePanel` API) — one toolbar click opens/closes the chat beside any tab
- ⚡ **Streaming responses** — Server-Sent Events parsed token-by-token with a live typing indicator
- ⏹️ **Stop generation** mid-stream (AbortController)
- 🤖 **Model picker** auto-fetched from your server's `/v1/models` (with manual entry fallback and `<datalist>` suggestions)
- ⚙️ **Full inference controls**: base URL, optional API key, temperature, max tokens, system prompt
- 🔌 **One-tap presets** for Ollama (`http://localhost:11434/v1`) and LM Studio (`http://localhost:1234/v1`), plus free-form custom endpoints
- 📄 **Page context (opt-in)** — toggle the 📄 bar to include your current tab's text in every message, so you can ask things like *“write a conclusion for this article”* or *“summarize what this page says about X”*. Content is fetched on demand, truncated to ~12k chars, and sent only to your own endpoint
- 📝 **Lightweight markdown rendering** — code blocks, bold, italic, links. Zero dependencies, all output HTML-escaped (no injection from model text)
- 💾 **Persistent settings** via `chrome.storage.local`
- 🌗 **Dark mode aware** UI following your OS preference

## Supported servers

| Server | Default base URL | Start it |
|---|---|---|
| [Ollama](https://ollama.com) | `http://localhost:11434/v1` | `ollama serve` (runs by default after install) |
| [LM Studio](https://lmstudio.ai) | `http://localhost:1234/v1` | open LM Studio → Developer tab → start server |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | `http://localhost:8080/v1` | `./server -m model.gguf` |
| [vLLM](https://docs.vllm.ai) | `http://localhost:8000/v1` | `vllm serve <model>` |
| Any OpenAI-compatible | any `/v1` URL | — |

## Install (developer mode)

1. **Start your local LLM server** and load a model, e.g.:
   ```bash
   ollama pull llama3.2
   ollama serve
   ```
2. Open `chrome://extensions` in Chrome (v114+) and enable **Developer mode** (top-right toggle)
3. Click **Load unpacked extension** and select this folder (`localLLM-chrome-extension`)
4. Click the extension's **toolbar icon** — the side panel opens
5. Open **Settings** (⚙️ in the header), pick a preset or enter your endpoint, choose a model, click **Save settings** — you'll see `Settings saved` in green
6. Chat away: `Enter` sends, `Shift+Enter` inserts a newline

> **Update after changes:** `chrome://extensions` → reload the extension card (circular arrow) → reopen the side panel.

## Settings reference

| Field | Type | Default | Notes |
|---|---|---|---|
| Base URL | text (`url`) | — (validated on save) | Must be `http(s)`; trailing `/` is handled automatically |
| API Key | password | empty | Sent as `Authorization: Bearer …` only when non-empty; most local servers don't need one |
| Model | text + datalist | first server model | Auto-populated from `GET /models`; manual entry always works |
| Temperature | number 0–2 | `0.7` | Sampling creativity |
| Max tokens | number ≥ 1, optional | unset | Omitted from the request when blank (server default applies) |
| System prompt | textarea | "You are a helpful assistant." | Prepended as a `system` message; leave empty to disable |

Settings persist in `chrome.storage.local` and survive browser restarts.

### Using page context

1. Navigate to the page you want help with (article, docs, paper…)
2. Click the **📄 bar** above the input — it shows the active tab's host + title and turns blue when enabled (`include: on`)
3. Ask your question normally (*“draft a conclusion for this page”*)

What happens under the hood:
- On each send, the panel injects a small extractor into the **active tab** via `chrome.scripting.executeScript` (nothing runs in your pages unless you toggle it on and send)
- The extractor strips `script/style/nav/header/footer/form/iframe/…`, collapses whitespace, and keeps at most ~12k characters (75% from the start + 25% from the end) so small local models can handle it
- The result is appended as a **per-turn system message** (`TITLE / URL / CONTENT`) — it is *not* stored in chat memory, so turning the toggle off stops it immediately
- Restricted pages (`chrome://`, Web Store, PDF viewer, blank tabs) are detected and reported inline instead of failing silently

## How it works

```
┌─────────────── Chrome ───────────────┐        ┌─────────────────────┐
│  background.js (service worker)      │        │  Local LLM server   │
│    • sidePanel.setOptions            │        │                     │
│    • opens panel on toolbar click    │        │  GET  /v1/models     │
│                                       │        │  POST /v1/chat/…     │
│  sidepanel.html + JS (panel page)    │  SSE   │       completions   │
│    • settings UI ────────────────────┼──────►│                     │
│    • chat loop: streamChatCompletion │ ◄───── │  data: {delta} …    │
│    • renderMarkdown (escaped)        │        │  data: [DONE]       │
│    • chrome.storage.local            │        └─────────────────────┘
└──────────────────────────────────────┘
```

- **Manifest V3** declares `sidePanel` + `storage` permissions and points the native side panel at `sidepanel.html`.
- The **service worker** only registers panel behavior (`openPanelOnActionClick: true`) — no content scripts, no network interception.
- The **panel page** makes direct `fetch()` calls to your server with `stream: true`, reads the response body as a byte stream, and parses SSE frames (`data:` lines) incrementally; partial frames are buffered across TCP chunks.
- **Rendering** goes through a tiny safe markdown renderer: everything is HTML-escaped first, then limited formatting (code, bold, italic, http(s)-only links) is applied — model output can never inject raw HTML or script.

### Request shape

```jsonc
POST {baseUrl}/chat/completions
{
  "model": "<your-model>",
  "messages": [ {"role":"system","content":"…"}, …history ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 512            // only included when set
}
```

## Project layout

| Path | Purpose |
|---|---|
| `manifest.json` | MV3 manifest: `sidePanel`, `storage`; service worker + icons |
| `background.js` | Service worker — registers side panel behavior on install/startup |
| `sidepanel.html` | Panel DOM shell (settings form, chat area, composer) |
| `sidepanel.css` | Styles; CSS custom properties with light/dark palettes |
| `sidepanel.js` | Main entry: settings wiring, chat loop, streaming paint (rAF-batched), stop button |
| `src/api.js` | OpenAI-compatible client — SSE stream parser + model listing |
| `src/store.js` | Settings load/save over `chrome.storage.local` with defaults |
| `src/pageContext.js` | On-demand active-tab extraction via `chrome.scripting.executeScript` |
| `src/markdown.js` | Dependency-free safe markdown renderer |
| `icons/` | 16 / 48 / 128 px PNG icons |

## Security & privacy

- **No network calls except to the endpoint you configure.** No telemetry, no third-party requests.
- All model and user text is HTML-escaped before rendering; only `http(s)` URLs become clickable links (`javascript:` etc. stay inert).
- Settings (including any API key) live in local browser storage only.
- Permission surface: `sidePanel`, `storage`, plus `tabs` + `scripting` with host permission `<all_urls>` (required to read page text). The broad host permission is **only exercised when you enable the 📄 toggle and send a message** — there is no persistent content script, so your pages are untouched at all other times. Page text goes only to the endpoint *you* configure; it is truncated (~12k chars) and never stored.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Request failed: HTTP 403/405` or CORS errors in DevTools console | Your server doesn't send `Access-Control-Allow-Origin`. Ollama & LM Studio allow it by default; for others, enable CORS on the server side. |
| `Saved — model list unavailable…` (amber status) | Server not running, wrong port, or `/v1/models` unsupported. You can still type a model name manually and send messages. |
| `Invalid base URL` / `must use http://` (red status) | Fix the endpoint field; save is aborted until valid. |
| Response stops immediately with empty bubble | Model name mismatch — check `/v1/models` output or your server logs. |
| Panel doesn't open on icon click | Reload the extension at `chrome://extensions`; the service worker re-registers panel behavior on startup/reload. |

Open DevTools for diagnostics: right-click inside the side panel → **Inspect** — Console and Network tabs show the exact requests to your server.

## Browser requirements

- Chrome / Chromium / Microsoft Edge **114+** (Manifest V3 `sidePanel` API)
- Firefox: not supported (`chrome.sidePanel` is unavailable there)

## Development notes

- The logic modules in `src/` are plain ES modules with no browser-only APIs, so they're unit-testable directly in Node (e.g. spin up a mock SSE HTTP server and drive `streamChatCompletion`).
- No build step: the extension is loaded unpacked as-is; no bundler or transpilation needed.
