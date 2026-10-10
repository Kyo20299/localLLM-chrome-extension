// src/pageContext.js - read the active tab's page content ON DEMAND via chrome.scripting.
// No persistent content script: code is injected only when the user enables page context and sends a message.

/** Lightweight tab lookup (title/url for the chip UI). */
export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// Runs inside the target page. Must be fully self-contained — no references to
// module-level bindings — because chrome.scripting serializes this function
// (via .toString()) into a plain page context where those identifiers don't exist.
function extractPageContext() {
  const MAX_CHARS = 12000; // ~3k token budget so small local models can handle it
  const clone = document.body.cloneNode(true);
  for (const sel of [
    "script", "style", "noscript", "template", "svg",
    "nav", "header", "footer", "aside", "form", "iframe",
  ]) {
    clone.querySelectorAll(sel).forEach((el) => el.remove());
  }
  let text = clone.innerText
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  if (text.length > MAX_CHARS) {
    const head = Math.floor(MAX_CHARS * 0.75); // keep more from the start
    const tail = MAX_CHARS - head;
    text = text.slice(0, head) + "\n…[truncated]…\n" + text.slice(-tail);
  }
  return { title: document.title, url: location.href, text };
}

/**
 * Fetch the full page context of the active tab.
 * Returns {title,url,text} or null (no tab) / {unavailable:true} on restricted pages.
 */
export async function getPageContext() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) return null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContext,
    });
    const ctx = result.result;
    if (!ctx.text.trim()) return { ...ctx, unavailable: true, error: "page has no readable text" };
    return ctx;
  } catch (e) {
    // chrome:// pages, Web Store, PDF viewer, etc. reject injection.
    console.warn("Page context unavailable:", e.message);
    return { title: tab.title || "", url: tab.url || "", text: "", unavailable: true, error: e.message };
  }
}
