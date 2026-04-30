/**************************************************************/
/* filename: "options.js"                                    */
/* Version 1.0                                               */
/* Purpose: Extension settings page for Jenny Bot.           */
/**************************************************************/
"use strict";

var FIELDS = ["apiUrl", "channelId", "apiSecret", "webBaseUrl"];

function migrateStorage(callback) {
  chrome.storage.sync.get(["channelID", "channelId"], function(stored) {
    var oldVal = stored["channelID"];
    var newVal = stored["channelId"];
    if (oldVal && !newVal) {
      var migration = { channelId: oldVal };
      chrome.storage.sync.set(migration, function() {
        chrome.storage.sync.remove("channelID", callback);
      });
    } else {
      callback();
    }
  });
}

function generateBrowserCode() {
  var bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var out = "";
  for (var i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out.slice(0, 5) + "-" + out.slice(5, 10) + "-" + out.slice(10, 15);
}

function setBrowserCode(code) {
  var normalized = (code || generateBrowserCode()).trim().toUpperCase();
  chrome.storage.sync.set({ browserCode: normalized }, function() {
    var el = document.getElementById("browserCode");
    if (el) el.value = normalized;
  });
}

function init() {
  migrateStorage(function() {
    chrome.storage.sync.get(FIELDS.concat(["browserCode"]), function(stored) {
      FIELDS.forEach(function(key) {
        var el = document.getElementById(key);
        if (el) el.value = stored[key] || "";
      });
      setBrowserCode(stored.browserCode || "");
    });
  });

  function updateLoginLink() {
    var base = (document.getElementById("webBaseUrl").value || "").trim().replace(/\/$/, "");
    var a = document.getElementById("open-login");
    if (base) { a.href = base + "/auth/login"; a.style.display = ""; }
    else       { a.href = "#"; a.style.display = "none"; }
  }
  updateLoginLink();
  document.getElementById("webBaseUrl").addEventListener("input", updateLoginLink);

  document.getElementById("regen-code-btn").addEventListener("click", function() {
    setBrowserCode(generateBrowserCode());
  });

  document.getElementById("save-btn").addEventListener("click", function() {
    var data = {};
    FIELDS.forEach(function(key) {
      var el = document.getElementById(key);
      data[key] = el ? el.value.trim() : "";
    });

    chrome.storage.sync.set(data, function() {
      var st = document.getElementById("status");
      st.textContent = "Saved!";
      setTimeout(function() { st.textContent = ""; }, 2500);
    });
  });

  FIELDS.forEach(function(key) {
    var el = document.getElementById(key);
    if (el) {
      el.addEventListener("keydown", function(e) {
        if (e.key === "Enter") document.getElementById("save-btn").click();
      });
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
