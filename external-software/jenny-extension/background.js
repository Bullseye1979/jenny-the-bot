/**************************************************************/
/* filename: "background.js"                                 */
/* Version 1.0                                               */
/* Purpose: Service worker for Jenny Bot browser extension.  */
/**************************************************************/
"use strict";

/* Open the side panel when the user clicks the extension icon. */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

/* ============================================================
   Offscreen document — provides continuous browser-action
   polling every 5 s without relying on the service worker
   staying alive. Created once on startup; Chrome keeps it
   running as long as the extension is active.
   ============================================================ */

function ensureOffscreen() {
  chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }, function (contexts) {
    if (chrome.runtime.lastError || (contexts && contexts.length)) return;
    chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Continuous browser-action polling"
    }).catch(function () {});
  });
}

ensureOffscreen();

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

/* ---- Per-window active-tab tracking + immediate status send */
chrome.tabs.onActivated.addListener(function (activeInfo) {
  chrome.tabs.get(activeInfo.tabId, function (tab) {
    if (chrome.runtime.lastError) return;
    if (tab && tab.url) {
      lastActiveTabPerWindow[tab.windowId] = tab.url;
    }
    sendBrowserStatusNow();
    checkBrowserActionOnce();
  });
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (changeInfo.status === "complete" && tab.active && tab.url) {
    lastActiveTabPerWindow[tab.windowId] = tab.url;
    /* Only trigger for the focused normal window. */
    if (!lastNormalWindowId || tab.windowId === lastNormalWindowId) {
      sendBrowserStatusNow();
      checkBrowserActionOnce();
    }
  }
});

/* ============================================================
   Browser-status sender — runs in the background regardless
   of whether the side panel is open.

   Triggered by:
     - Tab activation change (immediate, see onActivated above)
     - Active tab finishes loading (see onUpdated above)
     - Periodic alarm (every 1 minute, see below)
   ============================================================ */

function sendBrowserStatusNow() {
  chrome.storage.sync.get(["webBaseUrl", "statusEnabled", "browserCode"], function (sync) {
    if (sync.statusEnabled === false) return;
    var webBaseUrl = (sync.webBaseUrl || "").trim().replace(/\/$/, "");
    var browserCode = (sync.browserCode || "").trim().toUpperCase();
    if (!webBaseUrl) return;

    chrome.storage.local.get(["loggedIn"], function (local) {
      if (!local.loggedIn && !browserCode) return;

      var queryOpts = lastNormalWindowId
        ? { active: true, windowId: lastNormalWindowId }
        : { active: true, windowType: "normal" };

      chrome.tabs.query(queryOpts, function (tabs) {
        if (chrome.runtime.lastError || !tabs || !tabs.length) return;
        var tab = tabs[0];
        if (!tab || !tab.url) return;
        try {
          var p = new URL(tab.url);
          if (p.protocol !== "https:" && p.protocol !== "http:") return;
        } catch (e) { return; }

        fetch(webBaseUrl + "/browser-status", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: tab.url, title: tab.title || "", browserCode: browserCode })
        }).catch(function () {});
      });
    });
  });
}

/* ============================================================
   Browser-action handler — opens tabs requested by the bot.

   checkBrowserActionOnce() executes a single check and is
   called directly from tab events for immediate response.

   The offscreen document (offscreen.js) calls this every 5 s
   continuously via the "checkBrowserAction" message, covering
   the case where the user does nothing and the side panel is
   closed — no tab switch required.
   ============================================================ */

function checkBrowserActionOnce() {
  chrome.storage.sync.get(["webBaseUrl", "browserCode"], function (sync) {
    var webBaseUrl = (sync.webBaseUrl || "").trim().replace(/\/$/, "");
    var browserCode = (sync.browserCode || "").trim().toUpperCase();
    if (!webBaseUrl) return;

    chrome.storage.local.get(["loggedIn"], function (local) {
      if (!local.loggedIn && !browserCode) return;

      var actionUrl = webBaseUrl + "/browser-action";
      if (browserCode) actionUrl += "?browserCode=" + encodeURIComponent(browserCode);

      fetch(actionUrl, { credentials: "include" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok || !d.action) return;
          if (d.action.type === "openTab") {
            var u = String(d.action.url || "");
            try {
              var p = new URL(u);
              if (p.protocol === "https:" || p.protocol === "http:") {
                chrome.tabs.create({ url: u });
              }
            } catch (e) {}
          }
        })
        .catch(function () {});
    });
  });
}

/* ---- Periodic alarm (survives service-worker termination) -- */
var STATUS_ALARM_NAME = "jenny-browser-status";

chrome.alarms.get(STATUS_ALARM_NAME, function (alarm) {
  if (!alarm) {
    chrome.alarms.create(STATUS_ALARM_NAME, { periodInMinutes: 1 });
  }
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === STATUS_ALARM_NAME) {
    sendBrowserStatusNow();
    ensureOffscreen();
  }
});

/* ============================================================
   Message handler
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
      if (chrome.runtime.lastError) { sendResponse({ url: "" }); return; }
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

  if (msg && msg.type === "checkBrowserAction") {
    checkBrowserActionOnce();
    return;
  }

  if (msg && msg.type === "setLoggedIn") {
    chrome.storage.local.set({ loggedIn: !!msg.value });
    /* Immediately send status when the user logs in. */
    if (msg.value) sendBrowserStatusNow();
  }
});
