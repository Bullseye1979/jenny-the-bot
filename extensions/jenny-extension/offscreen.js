/**************************************************************/
/* filename: "offscreen.js"                                  */
/* Version 1.0                                               */
/* Purpose: Persistent offscreen document — polls for       */
/*          pending browser actions every 5 seconds and     */
/*          notifies the background service worker.          */
/*          Unlike a service worker this document is never   */
/*          terminated by Chrome while the extension is      */
/*          active, giving reliable continuous polling.      */
/**************************************************************/
"use strict";

setInterval(function () {
  try { chrome.runtime.sendMessage({ type: "checkBrowserAction" }); } catch (e) {}
}, 5000);
