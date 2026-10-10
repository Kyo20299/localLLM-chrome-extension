// Local LLM Side Panel - Manifest V3 service worker.
// Registers the native side panel and wires toolbar-click behavior.

const PANEL_PATH = "sidepanel.html";

async function configureSidePanel() {
  // Clicking the toolbar icon instantly opens/closes the side panel.
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  // Point the native side panel at our page (default for all tabs).
  await chrome.sidePanel.setOptions({ path: PANEL_PATH });
}

// Runs when the extension is installed / updated, and on browser startup.
chrome.runtime.onInstalled.addListener(configureSidePanel);
chrome.runtime.onStartup.addListener(configureSidePanel);
