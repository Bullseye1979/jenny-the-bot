/**********************************************************************************/
/* filename: 00047-webpage-voice.js                                               */
/* Version 1.0                                                                    */
/* Purpose: Webpage voice interface — serves a browser-based always-on SPA       */
/*          and handles incoming audio POST requests, bridging the browser into   */
/*          the same pipeline as the Discord voice flow.                          */
/*                                                                                */
/* Routes (port 3119):                                                            */
/*   GET  /voice          → serves the SPA (always-on + meeting recorder UI)     */
/*   GET  /voice/style.css → shared stylesheet                                   */
/*   POST /voice/audio    → receives raw audio body, converts to WAV, sets       */
/*                          wo.audioFile / wo.transcribeAudio / wo.channelID      */
/*                          so the downstream pipeline runs identically to        */
/*                          the Discord voice flow.                               */
/*                                                                                */
/* Config (config["webpage-voice"]):                                              */
/*   port             — HTTP port (default 3119)                                  */
/*   silenceTimeoutMs — silence before auto-send (default 2500)                  */
/*   maxDurationMs    — hard recording cap (default 30000)                       */
/*   allowedRoles     — role whitelist (empty = open)                            */
/*   channels         — [{id, label}] shown in channel dropdown                  */
/**********************************************************************************/

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPrefixedLogger } from "../core/logging.js";
import { getItem }           from "../core/registry.js";
import { getMenuHtml }       from "../shared/webpage/interface.js";

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

const MODULE_NAME  = "webpage-voice";
const DEFAULT_PORT = 3119;
const ROUTE_SPA    = "/voice";
const ROUTE_CSS    = "/voice/style.css";
const ROUTE_AUDIO  = "/voice/audio";


function getIsAllowedRoles(wo, allowedRoles) {
  const req = Array.isArray(allowedRoles) ? allowedRoles : [];
  if (!req.length) return true;
  const have = new Set();
  const primary = String(wo?.webAuth?.role || "").trim().toLowerCase();
  if (primary) have.add(primary);
  const roles = wo?.webAuth?.roles;
  if (Array.isArray(roles)) roles.forEach(r => { const v = String(r || "").trim().toLowerCase(); if (v) have.add(v); });
  return req.some(r => { const n = String(r || "").trim().toLowerCase(); return n && have.has(n); });
}


function getAccessDeniedHtml(menuHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voice Interface</title>
<link rel="stylesheet" href="/voice/style.css">
<style>
  .content{margin-top:var(--hh);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;padding:24px;min-height:calc(100vh - var(--hh))}
</style>
</head><body>
<header><h1>&#127897; Voice</h1>${menuHtml}</header>
<div class="content"><p>&#128274; Access denied.</p><p><a href="/auth/login">Log in</a></p></div>
</body></html>`;
}


function getSpaHtml(cfg, menuHtml) {
  const silenceMs = Number(cfg.silenceTimeoutMs ?? 2500);
  const maxMs     = Number(cfg.maxDurationMs    ?? 30000);

  const channels    = Array.isArray(cfg.channels) ? cfg.channels : [];
  const chanCfgMap  = {};
  channels.forEach(c => {
    const id = String(c.id || "").trim();
    if (!id) return;
    chanCfgMap[id] = {};
  });
  const chanCfgJson = JSON.stringify(chanCfgMap).replace(/<\/script>/gi, "<\\/script>");

  const chanOptHtml = channels.map(c => {
    const id  = String(c.id  || "").trim();
    const lbl = String(c.label || c.name || id).trim();
    if (!id) return "";
    return `<option value="${id.replace(/"/g, "&quot;")}">${lbl.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</option>`;
  }).filter(Boolean).join("");

  const channelRowHtml = channels.length
    ? `<div class="row">
  <select id="channelSelect">
    ${chanOptHtml}
    <option value="__custom__">Custom ID\u2026</option>
  </select>
</div>
<div class="row" id="custom-row" style="display:none">
  <input id="channelId" type="text" placeholder="Custom channel ID\u2026" autocomplete="off" spellcheck="false">
</div>`
    : `<div class="row">
  <input id="channelId" type="text" placeholder="Enter channel ID\u2026" autocomplete="off" spellcheck="false">
</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Voice Interface</title>
<link rel="stylesheet" href="/voice/style.css">
<style>
  .content{margin-top:var(--hh);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;min-height:calc(100vh - var(--hh))}
  .row{display:flex;gap:10px;width:100%;max-width:380px}
  input,select{flex:1;background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:10px 14px;color:var(--txt);font-size:.9rem;outline:none}
  input:focus,select:focus{border-color:var(--acc)}
  select{cursor:pointer}
  .btn-row{display:flex;gap:24px;align-items:center;justify-content:center}
  .btn-wrap{display:flex;flex-direction:column;align-items:center;gap:6px}
  .btn-label{font-size:.73rem;color:var(--muted);text-align:center;letter-spacing:.04em}
  #btn-mic{width:88px;height:88px;border-radius:50%;border:none;cursor:pointer;font-size:1.8rem;display:flex;align-items:center;justify-content:center;background:var(--bg);box-shadow:0 0 0 3px var(--bdr);transition:background .12s}
  #btn-mic.idle{color:var(--muted)}
  #btn-mic.recording{background:#fecaca;box-shadow:0 0 0 4px #f87171aa;animation:pulse-slow 1.4s infinite}
  #btn-mic.speaking{background:#ef4444;color:#fff;box-shadow:0 0 0 6px #f8717166;animation:none}
  @keyframes pulse-slow{0%,100%{box-shadow:0 0 0 4px #f87171aa}50%{box-shadow:0 0 0 10px #f8717133}}
  #btn-rec{width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;font-size:1.3rem;display:flex;align-items:center;justify-content:center;transition:background .12s}
  #btn-rec.idle{background:var(--bg);color:var(--muted);box-shadow:0 0 0 3px var(--bdr)}
  #btn-rec.recording{background:#fecaca;color:#dc2626;box-shadow:0 0 0 4px #f87171aa;animation:pulse-slow 1.4s infinite}
  #btn-rec.processing{background:#dbeafe;color:var(--acc);cursor:default;animation:none}
  #vol-track{width:96px;height:5px;background:var(--bdr);border-radius:3px;overflow:hidden}
  #vol-fill{height:100%;width:0%;background:var(--muted);border-radius:3px;transition:width .05s,background .08s}
  #vol-fill.active{background:var(--ok)}
  #status{font-size:.85rem;color:var(--muted);min-height:1.2em;text-align:center}
  #rec-status{font-size:.8rem;color:var(--ok);min-height:1em;text-align:center}
  #transcript-box{width:100%;max-width:500px;background:var(--card);border:1px solid var(--bdr);border-radius:10px;padding:16px;display:none;gap:12px;flex-direction:column}
  #transcript-box.visible{display:flex}
  .t-label{font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
  .t-text{font-size:.95rem;color:var(--txt);line-height:1.5;white-space:pre-wrap}
  #error-msg{color:var(--dan);font-size:.85rem;text-align:center;min-height:1em}
</style>
</head>
<body>
<header><h1>&#127897; Voice</h1>${menuHtml}</header>
<div class="content">

${channelRowHtml}

<div class="row">
  <select id="micSelect"><option value="">\u2014 Loading microphones \u2014</option></select>
</div>

<div class="btn-row">
  <div class="btn-wrap">
    <button id="btn-mic" class="idle" title="Toggle always-on listening">&#127908;</button>
    <div class="btn-label">Voice</div>
  </div>
  <div class="btn-wrap">
    <button id="btn-rec" class="idle" title="Record full meeting for diarized transcription">&#9210;</button>
    <div class="btn-label">Record</div>
  </div>
</div>

<div id="vol-track"><div id="vol-fill"></div></div>
<div id="status">Select a channel, then press the mic button</div>
<div id="rec-status"></div>
<div id="error-msg"></div>

<div id="transcript-box">
  <div><div class="t-label">You</div><div class="t-text" id="txt-you"></div></div>
  <div><div class="t-label">Reply</div><div class="t-text" id="txt-bot"></div></div>
</div>

<script>
/* server config */
var SILENCE_TIMEOUT_MS  = ${silenceMs};
var MAX_DURATION_MS     = ${maxMs};
var SILENCE_RMS_THRESH  = 0.015;
var CHECK_INTERVAL_MS   = 80;
var MIN_SPEECH_MS       = 500;
var CHANNELS_CONFIGURED = ${channels.length > 0 ? "true" : "false"};
var CHANNEL_CONFIGS     = ${chanCfgJson};

/* DOM */
var channelSelect = document.getElementById('channelSelect');
var customRow     = document.getElementById('custom-row');
var channelInput  = document.getElementById('channelId');
var micSelect     = document.getElementById('micSelect');
var btn           = document.getElementById('btn-mic');
var btnRec        = document.getElementById('btn-rec');
var statusEl      = document.getElementById('status');
var recStatusEl   = document.getElementById('rec-status');
var errorEl       = document.getElementById('error-msg');
var box           = document.getElementById('transcript-box');
var volFill       = document.getElementById('vol-fill');

/* channel helpers */
function getSelectedChannelId() {
  if (channelSelect && channelSelect.value && channelSelect.value !== '__custom__') return channelSelect.value;
  return channelInput ? channelInput.value.trim() : '';
}
function getEffectiveSilenceMs() {
  var id = getSelectedChannelId();
  if (id && CHANNEL_CONFIGS[id] && typeof CHANNEL_CONFIGS[id].silenceTimeoutMs === 'number') return CHANNEL_CONFIGS[id].silenceTimeoutMs;
  return SILENCE_TIMEOUT_MS;
}
if (channelSelect) {
  var savedSel = localStorage.getItem('voiceChannelSel');
  if (savedSel && channelSelect.querySelector('option[value="' + CSS.escape(savedSel) + '"]')) channelSelect.value = savedSel;
  function updateCustomRow() { if (customRow) customRow.style.display = (channelSelect.value === '__custom__') ? '' : 'none'; }
  updateCustomRow();
  channelSelect.addEventListener('change', function() { localStorage.setItem('voiceChannelSel', channelSelect.value); updateCustomRow(); });
}
if (channelInput) {
  channelInput.value = localStorage.getItem('voiceChannelId') || '';
  channelInput.addEventListener('change', function() { localStorage.setItem('voiceChannelId', channelInput.value.trim()); });
}

/* mic enumeration */
function populateMics() {
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(tmp) {
    tmp.getTracks().forEach(function(t) { t.stop(); });
  }).catch(function() {}).finally(function() {
    navigator.mediaDevices.enumerateDevices().then(function(devices) {
      var mics = devices.filter(function(d) { return d.kind === 'audioinput'; });
      micSelect.innerHTML = '';
      if (!mics.length) { micSelect.innerHTML = '<option value="">No microphone found</option>'; return; }
      mics.forEach(function(d, i) {
        var opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || ('Microphone ' + (i + 1));
        micSelect.appendChild(opt);
      });
      var saved = localStorage.getItem('voiceMicId');
      if (saved && micSelect.querySelector('option[value="' + CSS.escape(saved) + '"]')) micSelect.value = saved;
      micSelect.addEventListener('change', function() { localStorage.setItem('voiceMicId', micSelect.value); });
    }).catch(function() { micSelect.innerHTML = '<option value="">Failed to load</option>'; });
  });
}
if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) populateMics();
else micSelect.innerHTML = '<option value="">Not supported</option>';

var alwaysOn    = false;
var mediaRecorder = null;
var chunks        = [];
var recording     = false;
var processing    = false;
var stream        = null;
var audioCtx      = null;
var analyser      = null;
var vadTimer      = null;
var maxTimer      = null;
var silenceMsAcc  = 0;
var speechMsAcc   = 0;
var hasSpokeFirst = false;

/* audio playback queue — responses play in order, never overlap */
var audioQueue   = [];
var audioPlaying = false;

function playNextAudio() {
  if (audioPlaying || !audioQueue.length) return;
  audioPlaying = true;
  var item  = audioQueue.shift();
  var audio = new Audio(item.url);
  setStatus('Playing response\u2026');
  function done() {
    URL.revokeObjectURL(item.url);
    audioPlaying = false;
    if (audioQueue.length) { playNextAudio(); }
    else { setStatus(alwaysOn ? 'Always on \u2014 listening\u2026' : 'Ready'); }
  }
  audio.onended = done; audio.onerror = done; audio.play().catch(done);
}

/* fire-and-forget request — no mutex, responses queue for playback */
async function handleRequest(blob, postUrl) {
  try {
    var resp = await fetch(postUrl, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
    var transcript = resp.headers.get('X-Transcript') || '';
    var replyText  = resp.headers.get('X-Response')   || '';
    if (!resp.ok) { if (transcript) showTranscript(transcript, ''); return; }
    var ct = resp.headers.get('Content-Type') || '';
    if (ct.indexOf('audio/') === 0) {
      var audioBlob = await resp.blob();
      showTranscript(transcript, replyText);
      audioQueue.push({ url: URL.createObjectURL(audioBlob) });
      playNextAudio();
    } else { showTranscript(transcript, replyText); }
  } catch(e) { /* silent — network errors don't break the recording loop */ }
}

function setStatus(msg)    { statusEl.textContent    = msg || ''; }
function setError(msg)     { errorEl.textContent     = msg || ''; }
function setRecStatus(msg) { recStatusEl.textContent = msg || ''; }

function showTranscript(you, bot) {
  document.getElementById('txt-you').textContent = you || '';
  document.getElementById('txt-bot').textContent = bot || '';
  box.classList.toggle('visible', !!(you || bot));
}

/* volume meter */
function setVolume(rms) {
  volFill.style.width = Math.min(100, rms * 700) + '%';
  if (rms > SILENCE_RMS_THRESH) volFill.classList.add('active');
  else volFill.classList.remove('active');
}
function clearVolume() { volFill.style.width = '0%'; volFill.classList.remove('active'); }

/* VAD */
function startVAD() {
  if (!stream) return;
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    var src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
  } catch(e) { return; }
  var buf = new Uint8Array(analyser.frequencyBinCount);
  hasSpokeFirst = false; silenceMsAcc = 0; speechMsAcc = 0;
  vadTimer = setInterval(function() {
    if (!recording) return;
    analyser.getByteTimeDomainData(buf);
    var s = 0;
    for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; s += v * v; }
    var rms = Math.sqrt(s / buf.length);
    setVolume(rms);
    if (rms > SILENCE_RMS_THRESH) {
      speechMsAcc += CHECK_INTERVAL_MS; silenceMsAcc = 0;
      if (speechMsAcc >= MIN_SPEECH_MS) { hasSpokeFirst = true; btn.className = 'speaking'; }
    } else {
      speechMsAcc = 0;
      if (hasSpokeFirst) btn.className = 'recording';
      if (hasSpokeFirst) {
        silenceMsAcc += CHECK_INTERVAL_MS;
        if (silenceMsAcc >= getEffectiveSilenceMs()) { setStatus('Sending\u2026'); stopAndSend(); }
      }
    }
  }, CHECK_INTERVAL_MS);
}

function stopVAD() {
  if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
  if (analyser) { try { analyser.disconnect(); } catch(e) {} analyser = null; }
  if (audioCtx) { audioCtx.close().catch(function(){}); audioCtx = null; }
  if (!recActive) clearVolume(); /* keep bar alive if rec is still running */
}

async function startRecording() {
  if (processing || recording) return;
  setError('');
  var channelId = getSelectedChannelId();
  if (!channelId) {
    setError(CHANNELS_CONFIGURED ? 'Please select a channel.' : 'Please enter a channel ID.');
    alwaysOn = false; btn.className = 'idle'; return;
  }
  var deviceId = micSelect.value;
  var audioCfg = { echoCancellation: true, noiseSuppression: true };
  if (deviceId) audioCfg.deviceId = { exact: deviceId };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: audioCfg, video: false });
  } catch(e) {
    setError('Microphone access denied: ' + e.message);
    alwaysOn = false; btn.className = 'idle'; return;
  }
  var mimeType = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg']
    .find(function(m) { return MediaRecorder.isTypeSupported(m); }) || '';
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType: mimeType } : {});
  chunks = [];
  mediaRecorder.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
  mediaRecorder.start(250);
  recording = true;
  btn.className = 'recording';
  setStatus('Listening\u2026');
  startVAD();
  maxTimer = setTimeout(function() { if (recording) { setStatus('Sending\u2026'); stopAndSend(); } }, MAX_DURATION_MS);
}

async function stopAndSend() {
  if (!recording || processing) return;
  recording  = false;
  processing = true;
  stopVAD();
  if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
  btn.className = alwaysOn ? 'recording' : 'idle';
  setStatus('Sending\u2026');
  await new Promise(function(res) { mediaRecorder.onstop = res; mediaRecorder.stop(); });
  stream.getTracks().forEach(function(t) { t.stop(); });
  stream = null;
  var channelId = getSelectedChannelId();
  var blob      = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
  var postUrl   = '/voice/audio?channelId=' + encodeURIComponent(channelId);
  if (alwaysOn) postUrl += '&alwaysOn=1';
  handleRequest(blob, postUrl); /* fire-and-forget */
  processing = false;
  if (alwaysOn) {
    startRecording(); /* restart immediately for continuous listening */
  } else {
    btn.className = 'idle';
    setStatus('Ready');
  }
}

/* Mic button: click toggles always-on mode */
btn.addEventListener('click', function() {
  if (processing) return;
  alwaysOn = !alwaysOn;
  if (alwaysOn) {
    btn.className = 'recording';
    setStatus('Starting\u2026');
    if (!recording) startRecording();
  } else {
    setStatus('Stopping\u2026');
    if (recording) stopAndSend();
    else { btn.className = 'idle'; setStatus('Ready'); }
  }
});

var recActive    = false;
var recRecorder  = null;
var recChunks    = [];
var recOwnStream = null;
var recAudioCtx  = null;
var recAnalyser  = null;
var recVolTimer  = null;

function startRecVAD(src) {
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    recAudioCtx = new AC();
    var msrc = recAudioCtx.createMediaStreamSource(src);
    recAnalyser = recAudioCtx.createAnalyser();
    recAnalyser.fftSize = 512;
    msrc.connect(recAnalyser);
    var buf = new Uint8Array(recAnalyser.frequencyBinCount);
    recVolTimer = setInterval(function() {
      if (!recActive) return;
      recAnalyser.getByteTimeDomainData(buf);
      var s = 0;
      for (var i = 0; i < buf.length; i++) { var v = (buf[i] - 128) / 128; s += v * v; }
      setVolume(Math.sqrt(s / buf.length));
    }, CHECK_INTERVAL_MS);
  } catch(e) {}
}

function stopRecVAD() {
  if (recVolTimer) { clearInterval(recVolTimer); recVolTimer = null; }
  if (recAudioCtx) { try { recAudioCtx.close(); } catch(e) {} recAudioCtx = null; recAnalyser = null; }
  if (!alwaysOn) clearVolume();
}

btnRec.addEventListener('click', async function() {
  if (btnRec.className === 'processing') return;
  if (!recActive) {
    /* Start meeting recording */
    recActive = true;
    recChunks = [];
    /* Always open a dedicated stream for rec — never reuse the voice stream,
       so stopping voice mid-recording does not kill the rec media source. */
    var deviceId = micSelect.value;
    var audioCfg = { echoCancellation: true, noiseSuppression: true };
    if (deviceId) audioCfg.deviceId = { exact: deviceId };
    try {
      recOwnStream = await navigator.mediaDevices.getUserMedia({ audio: audioCfg, video: false });
    } catch(e) {
      setError('Mic access denied: ' + e.message);
      recActive = false; return;
    }
    var src = recOwnStream;
    var mt = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg']
      .find(function(m) { return MediaRecorder.isTypeSupported(m); }) || '';
    recRecorder = new MediaRecorder(src, mt ? { mimeType: mt } : {});
    recRecorder.ondataavailable = function(e) { if (e.data.size > 0) recChunks.push(e.data); };
    recRecorder.start(500);
    startRecVAD(src);
    btnRec.className = 'recording';
    setRecStatus('Recording meeting\u2026');
  } else {
    /* Stop and transcribe */
    recActive = false;
    btnRec.className = 'processing';
    setRecStatus('Transcribing\u2026');
    stopRecVAD();
    await new Promise(function(res) { recRecorder.onstop = res; recRecorder.stop(); });
    if (recOwnStream) { recOwnStream.getTracks().forEach(function(t) { t.stop(); }); recOwnStream = null; }
    recRecorder = null;
    var channelId = getSelectedChannelId();
    if (!channelId) { setRecStatus('No channel selected.'); btnRec.className = 'idle'; return; }
    var blob = new Blob(recChunks, { type: 'audio/webm' });
    try {
      var resp = await fetch('/voice/audio?channelId=' + encodeURIComponent(channelId) + '&transcribeOnly=1', {
        method: 'POST', headers: { 'Content-Type': blob.type }, body: blob
      });
      var transcript = resp.headers.get('X-Transcript') || '';
      if (resp.ok) {
        var words = transcript.trim().split(/\s+/).filter(Boolean).length;
        setRecStatus('Done \u2014 ' + words + ' word(s)' + (transcript ? ': ' + transcript.substring(0, 100) + (transcript.length > 100 ? '\u2026' : '') : ''));
      } else {
        setRecStatus('Error: ' + resp.status);
      }
    } catch(e) { setRecStatus('Error: ' + e.message); }
    btnRec.className = 'idle';
  }
});
</script>
</div>
</body>
</html>`;
}


async function getRes(wo) {
  const key = wo?.http?.requestKey;
  if (!key) return null;
  const entry = await Promise.resolve(getItem(key)).catch(() => null);
  return entry?.res || null;
}


export default async function getWebpageVoice(coreData) {
  const wo  = coreData?.workingObject || (coreData.workingObject = {});
  const log = getPrefixedLogger(wo, import.meta.url);

  const cfg    = coreData?.config?.[MODULE_NAME] || {};
  const port   = Number(cfg.port ?? DEFAULT_PORT);
  const method = (wo.http?.method || "").toUpperCase();
  const url    = wo.http?.url || "";

  if (Number(wo.http?.port) !== port) return coreData;

  const allowedRoles = Array.isArray(cfg.allowedRoles) ? cfg.allowedRoles : [];
  const isAllowed    = getIsAllowedRoles(wo, allowedRoles);
  const menu         = wo.web?.menu || [];
  const role         = wo.webAuth?.role || "";
  const menuHtml     = getMenuHtml(menu, ROUTE_SPA, role);

  /* GET /voice/style.css */
  if (method === "GET" && url === ROUTE_CSS) {
    const res = await getRes(wo);
    if (res && !res.headersSent) {
      try {
        const css = fs.readFileSync(path.join(__dirname, "../shared/webpage/style.css"), "utf-8");
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
        res.end(css);
      } catch { res.writeHead(404); res.end(); }
    }
    wo.stop = true;
    return coreData;
  }

  /* GET /voice — serve SPA */
  if (method === "GET" && (url === ROUTE_SPA || url.startsWith(ROUTE_SPA + "?"))) {
    const res = await getRes(wo);
    if (res && !res.headersSent) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(isAllowed ? getSpaHtml(cfg, menuHtml) : getAccessDeniedHtml(menuHtml));
    }
    wo.stop = true;
    return coreData;
  }

  /* POST /voice/audio — auth gate (downstream modules handle the audio) */
  if (method === "POST" && url.startsWith(ROUTE_AUDIO)) {
    if (!isAllowed) {
      const res = await getRes(wo);
      if (res && !res.headersSent) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
      }
      wo.stop = true;
    }
    return coreData;
  }

  return coreData;
}
