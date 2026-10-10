# Local LLM Chrome Extension

Chat with **local LLM services** directly from Chrome's native side panel. No cloud, no accounts — your prompts stay on your machine.

Works with any server exposing an **OpenAI-compatible API**:

| Server | Default base URL |
|---|---|
| [Ollama](https://ollama.com) | `http://localhost:11434/v1` |
| [LM Studio](https://lmstudio.ai) | `http://localhost:1234/v1` |
| llama.cpp server | `http://localhost:8080/v1` |
| vLLM / others | any `/v1` endpoint |

## Features

- 🪟 Chrome **native side panel** (Manifest V3, `sidePanel` API) — click the toolbar icon to open/close
- ⚡ **Streaming responses** (SSE), token by token
- ⚙️ Per-server settings: base URL, optional API key, model picker (auto-fetched from `/v1/models`), temperature, max tokens, system prompt
- 📝 Lightweight markdown rendering (code blocks, bold, italic, links) — zero dependencies
- 🌗 Dark-mode aware UI
- ⏹️ Stop generation button

## Install (developer mode)

1. Start your local LLM server, e.g.:
   ```bash
   ollama serve        # http://localhost:11434
   ```
2. Chrome → `chrome://extensions` → enable **Developer mode**
3. **Load unpacked extension** → select this folder
4. Click the toolbar icon to open the side panel
5. Open settings (⚙️), pick a preset (Ollama / LM Studio) or enter your endpoint, click **Save**, then chat

> **CORS note:** Ollama and LM Studio allow cross-origin requests by default. If your server does not send `Access-Control-Allow-Origin`, the fetch will fail — enable CORS on the server side.

## Project layout

```
manifest.json      MV3 manifest (sidePanel + storage)
background.js      Service worker: opens panel on toolbar click
sidepanel.html     Chat UI shell
sidepanel.css      Styles (light/dark)
sidepanel.js       Main entry: chat loop, settings wiring
src/api.js         OpenAI-compatible streaming client
src/store.js       chrome.storage.local settings persistence
src/markdown.js    Safe mini-markdown renderer
icons/             16 / 48 / 128 px icons
```

## Security

- All HTML is escaped before rendering (no raw HTML injection from model output)
- Only `http(s)` links are rendered clickable
- Settings stored locally via `chrome.storage.local` — nothing leaves your machine
