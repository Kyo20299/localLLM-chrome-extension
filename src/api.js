// src/api.js - OpenAI-compatible chat client (Ollama, LM Studio, llama.cpp, vLLM).

/** Build an Authorization header if a key is configured. */
function authHeaders(apiKey) {
  return apiKey ? { "Authorization": `Bearer ${apiKey}` } : {};
}

/** Fetch the list of models exposed by the server (`GET /models`). */
export async function fetchModels(baseUrl, apiKey) {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: authHeaders(apiKey),
  });
  if (!res.ok) throw new Error(`Model list failed: HTTP ${res.status}`);
  const data = await res.json();
  return (data.data || []).map((m) => m.id).sort();
}

/**
 * Stream a chat completion. Calls `onDelta(text)` for each text chunk.
 * Returns an AbortController so the caller can cancel generation.
 */
export function streamChatCompletion({ baseUrl, apiKey, model, messages, temperature, maxTokens }, onDelta) {
  const controller = new AbortController();

  // Resolves when the stream ends; rejects on HTTP/parse errors or abort.
  const done = (async () => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(apiKey) },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by blank lines; parse each `data:` line.
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") return;
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) onDelta(delta);
        } catch { /* ignore keep-alive / partial frames */ }
      }
    }
  })();

  return { controller, done };
}
