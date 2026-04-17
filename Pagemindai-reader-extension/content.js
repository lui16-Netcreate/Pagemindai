// content.js — Injected into every page
// This file is intentionally minimal — all heavy logic is in background.js
// Could be extended to highlight text, add context menus, etc.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    sendResponse({ alive: true });
  }
});
