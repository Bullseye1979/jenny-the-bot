/* options.js — Jenny Bot extension settings page */
"use strict";

var FIELDS = ["apiUrl", "channelID", "apiSecret", "webBaseUrl"];

function init() {
  chrome.storage.sync.get(FIELDS, function(stored) {
    FIELDS.forEach(function(key) {
      var el = document.getElementById(key);
      if (el) el.value = stored[key] || "";
    });
  });

  /* Update login link when webBaseUrl changes */
  function updateLoginLink() {
    var base = (document.getElementById("webBaseUrl").value || "").trim().replace(/\/$/, "");
    var a = document.getElementById("open-login");
    if (base) { a.href = base + "/auth/login"; a.style.display = ""; }
    else       { a.href = "#"; a.style.display = "none"; }
  }
  updateLoginLink();
  document.getElementById("webBaseUrl").addEventListener("input", updateLoginLink);

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

  /* Save on Enter in any field */
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
