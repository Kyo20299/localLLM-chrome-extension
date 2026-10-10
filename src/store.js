// src/store.js - settings persistence via chrome.storage.local

const DEFAULTS = {
  baseUrl: "http://localhost:11434/v1",
  apiKey: "",
  model: "",
  temperature: 0.7,
  maxTokens: null,
  systemPrompt: "You are a helpful assistant.",
};

export async function loadSettings() {
  const data = await chrome.storage.local.get("settings");
  return { ...DEFAULTS, ...(data.settings || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
}
