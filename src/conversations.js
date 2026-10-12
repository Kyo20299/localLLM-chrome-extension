// src/conversations.js - persist chat conversations in chrome.storage.local so they
// survive side-panel closes and browser restarts.

const KEY = "conversations";
export const MAX_CONVERSATIONS = 30; // cap to keep the local storage quota healthy

/** @returns {Array<{id,title,updatedAt,messages}>} sorted by updatedAt desc */
export async function listConversations() {
  try {
    const stored = await chrome.storage.local.get(KEY);
    return (stored[KEY] || []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) {
    console.warn("listConversations failed:", e.message);
    return [];
  }
}

/** Upsert one conversation; evicts the oldest when over the cap. */
export async function saveConversation(conv) {
  const convs = await listConversations(); // already desc
  const idx = convs.findIndex((c) => c.id === conv.id);
  if (idx >= 0) convs[idx] = conv;
  else convs.unshift(conv);
  while (convs.length > MAX_CONVERSATIONS) convs.pop();
  await chrome.storage.local.set({ [KEY]: convs });
}

export async function deleteConversation(id) {
  const convs = await listConversations();
  const kept = convs.filter((c) => c.id !== id);
  await chrome.storage.local.set({ [KEY]: kept });
}
