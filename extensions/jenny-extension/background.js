/* background.js — service worker for Jenny Bot browser extension */
"use strict";

/* Open the side panel when the user clicks the extension icon. */
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);
