/* background.js — service worker for Jenny Bot browser extension */
"use strict";

/* Open the side panel when the user clicks the extension icon. */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

/* ============================================================
   Active-tab URL tracking — per window
   The side panel runs in its own window (Chrome 117+), so a
   single global lastActiveTabUrl breaks when multiple browser
   windows are open: chrome.tabs.onActivated fires for ALL
   windows, so the global variable always holds the URL of the
   most-recently-activated tab across ALL windows.

   Fix:
   - Track the active-tab URL keyed by windowId.
   - Track which normal window was focused last.
   - When getActiveTabUrl is requested, return the active tab
     URL of the last-focused normal window, not the global one.
   ============================================================ */

/** @type {Object.<number, string>} windowId → last active tab URL */
var lastActiveTabPerWindow = {};

/** windowId of the last normal browser window that received focus */
var lastNormalWindowId = 0;

/* ---- Window focus tracking --------------------------------- */
chrome.windows.onFocusChanged.addListener(function (windowId) {
  /* WINDOW_ID_NONE (-1) means no Chrome window has focus (e.g. OS switch).
     Ignore it so lastNormalWindowId keeps pointing at a real window. */
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;

  /* Only track normal browser windows, not devtools / popup / panel. */
  chrome.windows.get(windowId, function (win) {
    if (chrome.runtime.lastError) return;
    if (win && win.type === "normal") {
      lastNormalWindowId = windowId;
    }
  });
});

/* ---- Per-window active-tab tracking ------------------------ */
chrome.tabs.onActivated.addListener(function (activeInfo) {
  chrome.tabs.get(activeInfo.tabId, function (tab) {
    if (chrome.runtime.lastError) return;
    if (tab && tab.url) {
      lastActiveTabPerWindow[tab.windowId] = tab.url;
    }
  });
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === "complete" && tab.active && tab.url) {
    lastActiveTabPerWindow[tab.windowId] = tab.url;
  }
});

/* ============================================================
   Message handler — answers { type: "getActiveTabUrl" }
   ============================================================ */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === "getActiveTabUrl") {

    /* Fast path: we already know the URL for the last focused normal window */
    if (lastNormalWindowId && lastActiveTabPerWindow[lastNormalWindowId]) {
      sendResponse({ url: lastActiveTabPerWindow[lastNormalWindowId] });
      return;
    }

    /* Slow path: ask Chrome for the active tab in the last focused normal
       window, falling back to any normal window if we never tracked focus. */
    var queryOpts = lastNormalWindowId
      ? { active: true, windowId: lastNormalWindowId }
      : { active: true, windowType: "normal" };

    chrome.tabs.query(queryOpts, function (tabs) {
      var tab = tabs && tabs[0];
      var url = (tab && tab.url) || "";
      /* Cache the result for next time */
      if (tab && tab.windowId && url) {
        lastActiveTabPerWindow[tab.windowId] = url;
        if (!lastNormalWindowId) lastNormalWindowId = tab.windowId;
      }
      sendResponse({ url: url });
    });

    /* Return true to keep the message channel open for async sendResponse */
    return true;
  }
});
