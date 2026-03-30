/**********************************************************************************/
/* filename: 00047-webpage-voice.js                                               */
/* Version 1.0                                                                    */
/* Purpose: Webpage voice interface — serves a browser-based always-on SPA       */
/*          with meeting recording, speaker management, and diarization review.  */
/*                                                                                */
/* Routes (port 3119):                                                            */
/*   GET  /voice                        → SPA (Voice / Speakers / Review tabs)   */
/*   GET  /voice/style.css              → shared stylesheet                       */
/*   POST /voice/audio                  → audio upload for always-on / meeting    */
/*   GET  /voice/api/speakers           → list speakers (?channelId=)             */
/*   POST /voice/api/speakers           → create speaker {name, channelId}        */
/*   DELETE /voice/api/speakers/:id     → delete speaker + sample file            */
/*   POST /voice/api/sample/:speakerId  → upload sample audio → transcribe+store  */
/*   GET  /voice/api/sessions           → list sessions (?channelId=)             */
/*   GET  /voice/api/session/:id        → chunks + speaker mappings for session   */
/*   DELETE /voice/api/session/:id      → delete session + chunks + assignments   */
/*   POST /voice/api/assign             → {chunkId, chunkLabel, speakerId}        */
/*   POST /voice/api/speakers/new-and-assign → {name,channelId,chunkId,chunkLabel}*/
/*                                                                                */
/* Config (config["webpage-voice"]):                                              */
/*   port             — HTTP port (default 3119)                                  */
/*   silenceTimeoutMs — silence before auto-send (default 2500)                  */
/*   maxDurationMs    — hard recording cap (default 30000)                       */
/*   allowedRoles     — role whitelist (empty = open)                            */
/*   channels         — [{id, label}] shown in channel dropdown                  */
/*   clearContextChannels — array of channel IDs whose context DB is purged      */
/*                          (non-frozen rows only) before storing a transcript.  */
/*                          Default: []                                           */
/*   sampleModel      — model for sample transcription (default gpt-4o-mini-transcribe) */
/*   transcribeApiKey — API key placeholder for sample transcription              */
/*   transcribeEndpoint — optional custom API base URL                           */
/**********************************************************************************/

import fs           from "node:fs";
import os           from "node:os";
import path         from "node:path";
import ffmpegImport from "fluent-ffmpeg";
import { fileURLToPath } from "node:url";
import { getPrefixedLogger } from "../core/logging.js";
import { getMenuHtml }       from "../shared/webpage/interface.js";
import { getIsAllowedRoles } from "../shared/webpage/utils.js";
import { getSecret }         from "../core/secrets.js";
import { setContext, setPurgeContext } from "../core/context.js";
import {
  getEnsureDiarizePool, ensureDiarizeTables,
  listSpeakers, getSpeaker, createSpeaker, updateSpeakerSample, deleteSpeaker,
  getSession, listSessions, deleteSession, listChunksForSession, upsertChunkSpeaker
} from "../core/voice-diarize.js";

const ffmpeg = ffmpegImport;
ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || "/usr/bin/ffmpeg");

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

const MODULE_NAME       = "webpage-voice";
const DEFAULT_PORT      = 3119;
const ROUTE_SPA         = "/voice";
const ROUTE_CSS         = "/voice/style.css";
const ROUTE_AUDIO       = "/voice/audio";
const ROUTE_API         = "/voice/api";
const DEFAULT_SAMPLE_MODEL = "gpt-4o-mini-transcribe";

const SAMPLES_DIR = path.join(__dirname, "../pub/documents/voice-samples");
try { fs.mkdirSync(SAMPLES_DIR, { recursive: true }); } catch {}


function getApiUrl(endpoint) {
  const ep = (endpoint || "").trim().replace(/\/+$/, "");
  if (ep) return /\/audio\/transcriptions$/.test(ep) ? ep : `${ep}/v1/audio/transcriptions`;
  const base = (process.env.OPENAI_BASE_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/v1/audio/transcriptions` : "https://api.openai.com/v1/audio/transcriptions";
}


function convertToWav(inputFile, outputFile) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(inputFile)
      .audioCodec("pcm_s16le")
      .audioFrequency(16000)
      .audioChannels(1)
      .format("wav")
      .save(outputFile)
      .on("end",   resolve)
      .on("error", reject);
  });
}


async function transcribeSampleFile(filePath, { apiKey, endpoint, model, language }) {
  let Fetch = globalThis.fetch, FormData = globalThis.FormData, Blob = globalThis.Blob;
  if (!Fetch || !FormData || !Blob) {
    const undici = await import("undici");
    Fetch = undici.fetch; FormData = undici.FormData; Blob = undici.Blob;
  }
  const fd = new FormData();
  fd.set("model", model);
  if (language && language !== "auto") fd.set("language", language);
  const buf = await fs.promises.readFile(filePath);
  fd.set("file", new Blob([buf], { type: "audio/wav" }), path.basename(filePath));
  const res = await Fetch(getApiUrl(endpoint), {
    method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: fd
  });
  if (!res.ok) throw new Error(`Transcribe API HTTP ${res.status}`);
  const data = await res.json();
  return (data?.text || "").trim();
}


function sendJson(res, status, obj) {
  if (!res || res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}


async function getDiarizePool(wo) {
  const pool = await getEnsureDiarizePool(wo);
  await ensureDiarizeTables(pool);
  return pool;
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
<script>window.showTab=function(name){document.querySelectorAll('.tab-pane').forEach(function(el){el.classList.remove('active');});document.querySelectorAll('.tab-btn').forEach(function(el){el.classList.remove('active');});var p=document.getElementById('tab-'+name);if(p)p.classList.add('active');document.querySelectorAll('.tab-btn').forEach(function(el){if(el.getAttribute('onclick')==="showTab('"+name+"')")el.classList.add('active');});if(name==='speakers'&&typeof loadSpeakers==='function')loadSpeakers();if(name==='review'&&typeof loadSessions==='function')loadSessions();};</script>
<style>
  .tabs{display:flex;gap:0;border-bottom:1px solid var(--bdr);margin-top:var(--hh);background:var(--bg2);position:sticky;top:var(--hh);z-index:10}
  .tab-btn{background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;padding:10px 20px;color:var(--muted);font-size:.85rem;font-weight:600;letter-spacing:.04em;transition:color .12s,border-color .12s}
  .tab-btn.active{color:var(--acc);border-bottom-color:var(--acc)}
  .tab-btn:hover{color:var(--txt)}
  .tab-pane{display:none;padding:24px 16px}
  .tab-pane.active{display:flex;flex-direction:column;align-items:center;gap:14px}
  .tab-pane.active.left{align-items:stretch;max-width:600px;margin:0 auto;width:100%}
  .sp-list{display:flex;flex-direction:column;gap:8px;width:100%}
  .sp-row{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:10px 12px}
  .sp-name{font-weight:600;font-size:.9rem;flex:1;min-width:0}
  .sp-sample{font-size:.78rem;color:var(--muted);flex:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sp-btns{display:flex;gap:6px;flex-shrink:0}
  .ic-btn{background:none;border:1px solid var(--bdr);border-radius:4px;cursor:pointer;padding:.2rem .45rem;font-size:.85rem;color:var(--muted)}
  .ic-btn:hover{background:var(--bg3);color:var(--txt)}
  .ic-btn.danger:hover{border-color:var(--dan);color:var(--dan)}
  .ic-btn.recording-active{background:#fecaca;border-color:#f87171;color:#dc2626;animation:pulse-slow 1.4s infinite}
  .add-form{display:flex;gap:8px;width:100%}
  .sess-list{display:flex;flex-direction:column;gap:6px;width:100%;max-height:calc(100vh - var(--hh) - 160px);overflow-y:auto}
  .sess-row{background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:10px 14px;cursor:pointer;font-size:.87rem}
  .sess-row:hover{border-color:var(--acc)}
  .sess-row.selected{border-color:var(--acc);background:var(--bg3)}
  .chunk-panel{display:flex;flex-direction:column;gap:10px;width:100%;max-height:calc(100vh - var(--hh) - 160px);overflow-y:auto}
  .apply-bar{display:flex;align-items:center;gap:12px;margin-top:10px;padding-top:10px;border-top:1px solid var(--bdr);flex-wrap:wrap}
  .apply-btn{background:var(--ok,#22c55e);border:none;border-radius:6px;cursor:pointer;padding:.45rem 1.2rem;font-size:.87rem;font-weight:600;color:#fff;transition:opacity .12s}
  .apply-btn:hover{opacity:.85}
  .apply-btn:disabled{opacity:.5;cursor:default}
  .chunk-card{background:var(--card);border:1px solid var(--bdr);border-radius:8px;padding:12px}
  .chunk-title{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;font-weight:700}
  .speaker-block{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
  .speaker-block:last-child{margin-bottom:0}
  .speaker-hd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .speaker-lbl{font-weight:600;font-size:.82rem;color:var(--acc);min-width:110px}
  .speaker-sel{font-size:.82rem;background:var(--bg2);border:1px solid var(--bdr);border-radius:4px;padding:2px 6px;color:var(--txt);cursor:pointer}
  .speaker-texts{font-size:.83rem;color:var(--txt);line-height:1.5;margin-top:2px;padding-left:4px;border-left:2px solid var(--bdr)}
  .content{margin-top:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;min-height:calc(100vh - var(--hh) - 42px)}
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
  body{overflow-y:auto}
  @media(max-width:640px){
    .content{justify-content:flex-start;padding-top:28px}
  }
</style>
</head>
<body>
<header><h1>&#127897; Voice</h1>${menuHtml}</header>
<div class="tabs">
  <button class="tab-btn active" onclick="showTab('voice')">&#127908; Voice</button>
  <button class="tab-btn" onclick="showTab('speakers')">&#128100; Speakers</button>
  <button class="tab-btn" onclick="showTab('review')">&#128203; Review</button>
</div>
<div class="tab-pane active" id="tab-voice">
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
  if (!recActive) clearVolume();
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
  handleRequest(blob, postUrl);
  processing = false;
  if (alwaysOn) {
    startRecording();
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
        var words = transcript.trim().split(' ').filter(function(w){return w.length>0;}).length;
        setRecStatus('Done \u2014 ' + words + ' word(s)');
        showTab('review');
      } else {
        setRecStatus('Error: ' + resp.status);
      }
    } catch(e) { setRecStatus('Error: ' + e.message); }
    btnRec.className = 'idle';
  }
});

var CURRENT_TAB = 'voice';
var reviewPollTimer = null;
function showTab(name) {
  CURRENT_TAB = name;
  document.querySelectorAll('.tab-pane').forEach(function(el) { el.classList.remove('active'); });
  document.querySelectorAll('.tab-btn').forEach(function(el) { el.classList.remove('active'); });
  var pane = document.getElementById('tab-' + name);
  if (pane) pane.classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(function(el) {
    if (el.getAttribute('onclick') === "showTab('" + name + "')") el.classList.add('active');
  });
  if (name === 'speakers') loadSpeakers();
  if (name === 'review') {
    loadSessions();
    if (!reviewPollTimer) reviewPollTimer = setInterval(function() { if (CURRENT_TAB === 'review') loadSessions(); }, 10000);
  } else {
    if (reviewPollTimer) { clearInterval(reviewPollTimer); reviewPollTimer = null; }
  }
}

var spRecStream = null, spRecRecorder = null;
var spRecChunks = [], spRecActive = false, spRecForId = null;
var reviewSpeakers = [];
var reviewSessionId = null;

function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function loadSpeakers() {
  var cid = getSelectedChannelId();
  var list = document.getElementById('sp-list');
  if (!cid) { list.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Select a channel first.</p>'; return; }
  fetch('/voice/api/speakers?channelId=' + encodeURIComponent(cid))
    .then(function(r) { return r.json(); })
    .then(function(d) { renderSpeakers(d.speakers || []); })
    .catch(function() { list.innerHTML = '<p style="color:var(--dan);font-size:.85rem">Load error.</p>'; });
}

function renderSpeakers(speakers) {
  var list = document.getElementById('sp-list');
  if (!speakers.length) { list.innerHTML = '<p style="color:var(--muted);font-size:.85rem">No speakers yet. Add one below.</p>'; return; }
  list.innerHTML = speakers.map(function(sp) {
    var sampleTxt = sp.sample_text ? escHtml(sp.sample_text.slice(0, 80)) + (sp.sample_text.length > 80 ? '\u2026' : '') : '<em style="color:var(--muted)">no sample</em>';
    return '<div class="sp-row" id="sp-row-' + sp.id + '">' +
      '<span class="sp-name">' + escHtml(sp.name) + '</span>' +
      '<span class="sp-sample">' + sampleTxt + '</span>' +
      '<span class="sp-btns">' +
        '<button class="ic-btn" id="sp-rec-btn-' + sp.id + '" onclick="toggleSampleRecord(' + sp.id + ')" title="Record sample">\uD83C\uDFA4</button>' +
        '<button class="ic-btn danger" onclick="deleteSpeaker(' + sp.id + ')" title="Delete">\uD83D\uDDD1\uFE0F</button>' +
      '</span></div>';
  }).join('');
}

async function addSpeaker() {
  var name = (document.getElementById('sp-name-input').value || '').trim();
  var cid  = getSelectedChannelId();
  var msg  = document.getElementById('sp-msg');
  if (!name) { msg.textContent = 'Enter a name first.'; return; }
  if (!cid)  { msg.textContent = 'Select a channel first.'; return; }
  msg.textContent = 'Adding\u2026';
  try {
    var r = await fetch('/voice/api/speakers', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name: name, channelId: cid }) });
    var d = await r.json();
    if (!r.ok) { msg.textContent = 'Error: ' + (d.error || r.status); return; }
    document.getElementById('sp-name-input').value = '';
    msg.textContent = 'Added.';
    loadSpeakers();
  } catch(e) { msg.textContent = 'Error: ' + e.message; }
}

async function deleteSpeaker(id) {
  if (!confirm('Delete this speaker and their sample?')) return;
  try {
    await fetch('/voice/api/speakers/' + id, { method: 'DELETE' });
    loadSpeakers();
  } catch(e) { alert('Error: ' + e.message); }
}

async function toggleSampleRecord(id) {
  var btn = document.getElementById('sp-rec-btn-' + id);
  if (spRecActive && spRecForId === id) {
    spRecActive = false;
    if (spRecRecorder) { await new Promise(function(res) { spRecRecorder.onstop = res; spRecRecorder.stop(); }); }
    if (spRecStream) { spRecStream.getTracks().forEach(function(t) { t.stop(); }); spRecStream = null; }
    btn.classList.remove('recording-active');
    btn.textContent = '\u23F3';
    var blob = new Blob(spRecChunks, { type: 'audio/webm' });
    try {
      var r = await fetch('/voice/api/sample/' + id, { method: 'POST', headers: {'Content-Type': blob.type}, body: blob });
      var d = await r.json();
      if (!r.ok) { alert('Sample error: ' + (d.error || r.status)); }
      else { document.getElementById('sp-msg').textContent = 'Sample saved: ' + (d.sampleText || ''); }
    } catch(e) { alert('Error: ' + e.message); }
    btn.textContent = '\uD83C\uDFA4';
    loadSpeakers();
    spRecForId = null;
    return;
  }
  if (spRecActive) { alert('Already recording for another speaker. Stop that first.'); return; }
  var deviceId = (typeof micSelect !== 'undefined' && micSelect) ? micSelect.value : '';
  var audioCfg = { echoCancellation: true, noiseSuppression: true };
  if (deviceId) audioCfg.deviceId = { exact: deviceId };
  try {
    spRecStream = await navigator.mediaDevices.getUserMedia({ audio: audioCfg, video: false });
  } catch(e) { alert('Mic error: ' + e.message); return; }
  var mt = ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'].find(function(m) { return MediaRecorder.isTypeSupported(m); }) || '';
  spRecRecorder = new MediaRecorder(spRecStream, mt ? { mimeType: mt } : {});
  spRecChunks = [];
  spRecRecorder.ondataavailable = function(e) { if (e.data.size > 0) spRecChunks.push(e.data); };
  spRecRecorder.start(250);
  spRecActive = true;
  spRecForId  = id;
  btn.classList.add('recording-active');
  btn.textContent = '\u23F9';
}

async function deleteSessionRow(sessionId, evt) {
  evt.stopPropagation();
  var r = await fetch('/voice/api/session/' + sessionId, { method: 'DELETE' });
  if (r.ok) {
    var el = document.getElementById('sess-row-' + sessionId);
    if (el) el.remove();
    if (reviewSessionId === sessionId) {
      reviewSessionId = null;
      var panel = document.getElementById('chunk-panel');
      if (panel) panel.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Select a session.</p>';
    }
  }
}

function loadSessions() {
  var cid = getSelectedChannelId();
  var list = document.getElementById('sess-list');
  if (!cid) { list.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Select a channel first.</p>'; return; }
  list.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Loading\u2026</p>';
  fetch('/voice/api/sessions?channelId=' + encodeURIComponent(cid))
    .then(function(r) {
      if (!r.ok) { list.innerHTML = '<p style="color:var(--dan);font-size:.85rem">API error ' + r.status + '</p>'; return null; }
      return r.json();
    })
    .then(function(d) {
      if (!d) return;
      if (d.error) { list.innerHTML = '<p style="color:var(--dan);font-size:.85rem">Error: ' + escHtml(String(d.error)) + (d.detail ? ' \u2014 ' + escHtml(String(d.detail)) : '') + '</p>'; return; }
      var sessions = d.sessions || [];
      if (!sessions.length) { list.innerHTML = '<p style="color:var(--muted);font-size:.85rem">No sessions yet. (channelId: ' + escHtml(cid) + ')</p>'; return; }
      list.innerHTML = sessions.map(function(s) {
        var dt = new Date(s.started_at).toLocaleString();
        return '<div class="sess-row" id="sess-row-' + s.id + '">' +
          '<span style="flex:1;cursor:pointer" onclick="loadChunks(' + s.id + ')">' + escHtml(dt) + '</span>' +
          '<button class="ic-btn danger" style="font-size:.75rem;padding:2px 6px;margin-left:6px" onclick="deleteSessionRow(' + s.id + ',event)" title="Delete session">\uD83D\uDDD1\uFE0F</button>' +
          '</div>';
      }).join('');
      fetch('/voice/api/speakers?channelId=' + encodeURIComponent(cid))
        .then(function(r2) { return r2.json(); })
        .then(function(d2) { reviewSpeakers = d2.speakers || []; });
    })
    .catch(function(e) { list.innerHTML = '<p style="color:var(--dan);font-size:.85rem">Load error: ' + escHtml(String(e)) + '</p>'; });
}

async function loadChunks(sessionId) {
  reviewSessionId = sessionId;
  document.querySelectorAll('.sess-row').forEach(function(el) { el.classList.remove('selected'); });
  var sr = document.getElementById('sess-row-' + sessionId);
  if (sr) sr.classList.add('selected');
  var panel = document.getElementById('chunk-panel');
  panel.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Loading\u2026</p>';
  try {
    var r = await fetch('/voice/api/session/' + sessionId);
    var d = await r.json();
    renderChunks(d.chunks || []);
  } catch(e) { panel.innerHTML = '<p style="color:var(--dan);font-size:.85rem">Load error.</p>'; }
}

function renderChunks(chunks) {
  var panel = document.getElementById('chunk-panel');
  if (!chunks.length) { panel.innerHTML = '<p style="color:var(--muted);font-size:.85rem">No chunks in this session.</p>'; return; }
  var chunksHtml = chunks.map(function(chunk) {
    var parsed   = parseChunkTranscript(chunk.transcript || '');
    var mappings = {};
    (chunk.speakers || []).forEach(function(m) { mappings[m.chunk_label] = m.speaker_id; });
    var labels = Object.keys(parsed);
    if (!labels.length) return '';
    var blocksHtml = labels.map(function(lbl) {
      var texts    = parsed[lbl].map(function(t) { return escHtml(t); }).join('<br>');
      var assigned = mappings[lbl] !== undefined ? mappings[lbl] : '';
      var selHtml  = buildSpeakerSelect(lbl, chunk.id, Number(assigned) || null);
      return '<div class="speaker-block">' +
        '<div class="speaker-hd"><span class="speaker-lbl">' + escHtml(lbl) + '</span>' + selHtml + '</div>' +
        '<div class="speaker-texts">' + texts + '</div></div>';
    }).join('');
    return '<div class="chunk-card"><div class="chunk-title">Chunk ' + (chunk.chunk_index + 1) + '</div>' + blocksHtml + '</div>';
  }).join('');
  var applyBar =
    '<div class="apply-bar">' +
    '<button class="ic-btn" id="save-all-btn" onclick="saveAllClicked()">\uD83D\uDCBE Save All</button>' +
    '<button class="apply-btn" id="apply-btn" onclick="applySession()">\u2713 Apply to Channel</button>' +
    '<span id="apply-status" style="font-size:.82rem;color:var(--ok);min-height:1em"></span>' +
    '</div>';
  panel.innerHTML = chunksHtml + applyBar;
}

async function saveAll() {
  var sels = document.querySelectorAll('.speaker-sel');
  for (var i = 0; i < sels.length; i++) {
    var sel = sels[i];
    if (sel.value === '__new__') continue;
    var chunkId    = Number(sel.getAttribute('data-chunk-id'));
    var chunkLabel = sel.getAttribute('data-chunk-label');
    var speakerId  = sel.value ? Number(sel.value) : null;
    await fetch('/voice/api/assign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunkId: chunkId, chunkLabel: chunkLabel, speakerId: speakerId })
    });
  }
}

async function saveAllClicked() {
  var saveBtn = document.getElementById('save-all-btn');
  var status  = document.getElementById('apply-status');
  if (saveBtn) saveBtn.disabled = true;
  if (status)  status.textContent = '';
  try {
    await saveAll();
    if (status) {
      status.textContent = '\u2713 Saved';
      setTimeout(function() { if (status) status.textContent = ''; }, 2000);
    }
  } catch(e) {
    if (status) status.textContent = '\u2717 ' + escHtml(String(e.message));
  }
  if (saveBtn) saveBtn.disabled = false;
}

async function applySession() {
  if (!reviewSessionId) return;
  var applyBtn = document.getElementById('apply-btn');
  var saveBtn  = document.getElementById('save-all-btn');
  var status   = document.getElementById('apply-status');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = '\u2026 Saving'; }
  if (saveBtn)  saveBtn.disabled = true;
  if (status)   status.textContent = '';
  try {
    await saveAll();
  } catch(e) {
    if (status)   status.textContent = '\u2717 Save error: ' + escHtml(String(e.message));
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '\u2713 Apply to Channel'; }
    if (saveBtn)  saveBtn.disabled = false;
    return;
  }
  if (applyBtn) applyBtn.textContent = '\u2026 Applying';
  try {
    var r = await fetch('/voice/api/session/' + reviewSessionId + '/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    var d = await r.json();
    if (!r.ok) {
      if (status)   status.textContent = '\u2717 Error: ' + escHtml(String(d.error || r.status));
      if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '\u2713 Apply to Channel'; }
      if (saveBtn)  saveBtn.disabled = false;
      return;
    }
    var el = document.getElementById('sess-row-' + reviewSessionId);
    if (el) el.remove();
    var panel = document.getElementById('chunk-panel');
    if (panel) panel.innerHTML = '<p style="color:var(--ok);font-size:.9rem">\u2713 Applied \u2014 ' + (d.words || 0) + ' words written to channel.</p>';
    reviewSessionId = null;
  } catch(e) {
    if (status)   status.textContent = '\u2717 ' + escHtml(String(e.message));
    if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = '\u2713 Apply to Channel'; }
    if (saveBtn)  saveBtn.disabled = false;
  }
}

function parseChunkTranscript(transcript) {
  var result = {};
  var lines = String(transcript || '').split(String.fromCharCode(10));
  for (var i = 0; i < lines.length; i++) {
    var colon = lines[i].indexOf(':');
    if (colon < 1) continue;
    var lbl = lines[i].slice(0, colon).trim();
    var txt = lines[i].slice(colon + 1).trim();
    if (!lbl || !txt) continue;
    if (!result[lbl]) result[lbl] = [];
    result[lbl].push(txt);
  }
  return result;
}

function buildSpeakerSelect(chunkLabel, chunkId, currentSpeakerId) {
  var uid = 'sel-' + chunkId + '-' + chunkLabel.replace(/[^a-z0-9]/gi, '_');
  var opts = '<option value="">\u2014 unassigned \u2014</option>';
  reviewSpeakers.forEach(function(sp) {
    var sel = (currentSpeakerId != null && String(sp.id) === String(currentSpeakerId)) ? ' selected' : '';
    opts += '<option value="' + sp.id + '"' + sel + '>' + escHtml(sp.name) + '</option>';
  });
  opts += '<option value="__new__">+ New speaker\u2026</option>';
  return '<select id="' + uid + '" class="speaker-sel"' +
    ' data-chunk-id="' + chunkId + '" data-chunk-label="' + escHtml(chunkLabel) + '"' +
    ' onchange="handleSpeakerSelChange(this)">' + opts + '</select>';
}

function showNewSpeakerInline(sel) {
  var chunkId    = Number(sel.getAttribute('data-chunk-id'));
  var chunkLabel = sel.getAttribute('data-chunk-label');
  var wrap = sel.parentNode;
  sel.style.display = 'none';
  var row = document.createElement('span');
  row.style.cssText = 'display:inline-flex;gap:4px;align-items:center;flex-wrap:nowrap';
  var inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'New speaker name\u2026';
  inp.autocomplete = 'off';
  inp.style.cssText = 'font-size:.8rem;padding:2px 6px;border:1px solid var(--border,#555);border-radius:4px;background:var(--bg2,#333);color:inherit;width:140px';
  var ok = document.createElement('button');
  ok.textContent = 'OK';
  ok.className = 'ic-btn';
  ok.style.cssText = 'font-size:.75rem;padding:2px 7px;color:var(--acc)';
  var cancel = document.createElement('button');
  cancel.textContent = '\u2715';
  cancel.className = 'ic-btn';
  cancel.style.cssText = 'font-size:.75rem;padding:2px 7px';
  row.appendChild(inp);
  row.appendChild(ok);
  row.appendChild(cancel);
  wrap.appendChild(row);
  inp.focus();
  function cleanup() { row.remove(); sel.style.display = ''; sel.value = ''; }
  cancel.onclick = cleanup;
  ok.onclick = async function() {
    var name = inp.value.trim();
    if (!name) { inp.focus(); return; }
    var cid = getSelectedChannelId();
    ok.disabled = true; ok.textContent = '\u2026';
    try {
      var r = await fetch('/voice/api/speakers/new-and-assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, channelId: cid, chunkId: chunkId, chunkLabel: chunkLabel })
      });
      var d = await r.json();
      if (!r.ok) { ok.textContent = 'OK'; ok.disabled = false; inp.style.borderColor = 'red'; return; }
      reviewSpeakers.push({ id: d.speakerId, name: d.name });
      row.remove(); sel.style.display = '';
      await loadChunks(reviewSessionId);
    } catch(e) { ok.textContent = 'OK'; ok.disabled = false; }
  };
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') ok.click();
    if (e.key === 'Escape') cleanup();
  });
}

function handleSpeakerSelChange(sel) {
  if (sel.value === '__new__') showNewSpeakerInline(sel);
}

</script>
</div>
</div>

<div class="tab-pane left" id="tab-speakers">
  <div class="sp-list" id="sp-list"><p style="color:var(--muted);font-size:.85rem">Loading\u2026</p></div>
  <div class="add-form">
    <input id="sp-name-input" type="text" placeholder="Speaker name\u2026" autocomplete="off" spellcheck="false" style="flex:1">
    <button class="ic-btn" onclick="addSpeaker()" style="padding:.4rem .9rem;font-size:.85rem;color:var(--acc)">+ Add</button>
  </div>
  <p id="sp-msg" style="font-size:.8rem;color:var(--muted);min-height:1em"></p>
</div>

<div class="tab-pane left" id="tab-review">
  <div style="display:flex;gap:10px;flex-wrap:wrap;width:100%">
    <div style="flex:1;min-width:180px">
      <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px">Sessions <button class="ic-btn" onclick="loadSessions()" title="Refresh" style="font-size:.75rem;padding:1px 5px">&#x1F504;</button></div>
      <div class="sess-list" id="sess-list"><p style="color:var(--muted);font-size:.85rem">Select a channel first.</p></div>
    </div>
    <div style="flex:3;min-width:260px">
      <div style="font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px">Chunks</div>
      <div class="chunk-panel" id="chunk-panel"><p style="color:var(--muted);font-size:.85rem">Select a session.</p></div>
    </div>
  </div>
</div>

</body>
</html>`;
}


function getRes(wo) {
  return wo?.http?.res || null;
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
  const menuHtml     = getMenuHtml(menu, ROUTE_SPA, role, null, null, wo.webAuth);

  if (method === "GET" && url === ROUTE_CSS) {
    const res = await getRes(wo);
    if (res && !res.headersSent) {
      try {
        const css = fs.readFileSync(path.join(__dirname, "../shared/webpage/style.css"), "utf-8");
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
        res.end(css);
      } catch { res.writeHead(404); res.end(); }
    }
    wo.jump = true; wo.jumpReason = "voice_request_handled";
    return coreData;
  }

  if (method === "GET" && (url === ROUTE_SPA || url.startsWith(ROUTE_SPA + "?"))) {
    const res = await getRes(wo);
    if (res && !res.headersSent) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(isAllowed ? getSpaHtml(cfg, menuHtml) : getAccessDeniedHtml(menuHtml));
    }
    wo.jump = true; wo.jumpReason = "voice_request_handled";
    return coreData;
  }

  if (method === "POST" && url.startsWith(ROUTE_AUDIO)) {
    if (!isAllowed) {
      const res = await getRes(wo);
      if (res && !res.headersSent) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
      }
      wo.jump = true; wo.jumpReason = "forbidden";
    }
    return coreData;
  }

  if (url.startsWith(ROUTE_API)) {
    const res = getRes(wo);
    if (!isAllowed) {
      sendJson(res, 403, { error: "forbidden" });
      wo.jump = true; wo.jumpReason = "forbidden";
      return coreData;
    }

    const urlPath = url.split("?")[0];
    const qIdx    = url.indexOf("?");
    const params  = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : "");

    const SAMPLE_MODEL    = String(cfg.sampleModel      || DEFAULT_SAMPLE_MODEL);
    const TRANSCRIBE_KEY  = await getSecret(wo, (cfg.transcribeApiKey || process.env.OPENAI_API_KEY || "").trim());
    const TRANSCRIBE_EP   = String(cfg.transcribeEndpoint || "");
    const TRANSCRIBE_LANG = String(cfg.transcribeLanguage || "auto");

    try {
      let pool = null;
      try { pool = await getDiarizePool(wo); } catch (e) {
        sendJson(res, 500, { error: "db_unavailable", detail: e?.message });
        wo.jump = true; wo.jumpReason = "db_error"; return coreData;
      }

      if (method === "GET" && urlPath === ROUTE_API + "/speakers") {
        const channelId = params.get("channelId") || "";
        const rows      = channelId ? await listSpeakers(pool, channelId) : [];
        sendJson(res, 200, { speakers: rows });
        wo.jump = true; wo.jumpReason = "api_handled"; return coreData;
      }

      if (method === "POST" && urlPath === ROUTE_API + "/speakers") {
        const body = wo.http?.json || {};
        const name = String(body.name || "").trim();
        const cid  = String(body.channelId || "").trim();
        if (!name || !cid) { sendJson(res, 400, { error: "missing_name_or_channelId" }); wo.jump = true; return coreData; }
        const id = await createSpeaker(pool, { channelId: cid, name });
        sendJson(res, 200, { id });
        wo.jump = true; wo.jumpReason = "api_handled"; return coreData;
      }

      if (method === "DELETE" && urlPath.startsWith(ROUTE_API + "/speakers/")) {
        const id = Number(urlPath.split("/").pop());
        if (!id) { sendJson(res, 400, { error: "invalid_id" }); wo.jump = true; return coreData; }
        await deleteSpeaker(pool, id);
        sendJson(res, 200, { ok: true });
        wo.jump = true; wo.jumpReason = "api_handled"; return coreData;
      }

      if (method === "POST" && urlPath.startsWith(ROUTE_API + "/sample/")) {
        const speakerId = Number(urlPath.split("/").pop());
        if (!speakerId) { sendJson(res, 400, { error: "invalid_id" }); wo.jump = true; return coreData; }
        const sp = await getSpeaker(pool, speakerId);
        if (!sp) { sendJson(res, 404, { error: "speaker_not_found" }); wo.jump = true; return coreData; }

        const rawBody = wo.http?.rawBodyBytes;
        if (!rawBody?.length) { sendJson(res, 400, { error: "empty_body" }); wo.jump = true; return coreData; }

        const ct      = (wo.http?.headers?.["content-type"] || "audio/webm").split(";")[0].trim();
        const extMap  = { "audio/webm": ".webm", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/mpeg": ".mp3" };
        const ext     = extMap[ct] || ".webm";
        const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), "vsamp-"));
        const inFile  = path.join(tmpDir, `input${ext}`);
        const wavFile = path.join(tmpDir, "sample.wav");

        try {
          await fs.promises.writeFile(inFile, rawBody);
          if (ext !== ".wav") { await convertToWav(inFile, wavFile); } else { fs.copyFileSync(inFile, wavFile); }

          if (!TRANSCRIBE_KEY) { sendJson(res, 500, { error: "no_api_key" }); wo.jump = true; return coreData; }
          const sampleText = await transcribeSampleFile(wavFile, {
            apiKey: TRANSCRIBE_KEY, endpoint: TRANSCRIBE_EP, model: SAMPLE_MODEL, language: TRANSCRIBE_LANG
          });

          const destFile = path.join(SAMPLES_DIR, `sample_${speakerId}.wav`);
          await fs.promises.copyFile(wavFile, destFile);
          await updateSpeakerSample(pool, speakerId, { sampleAudioPath: destFile, sampleText });

          sendJson(res, 200, { sampleText });
        } finally {
          try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
        }
        wo.jump = true; wo.jumpReason = "api_handled"; return coreData;
      }

      if (method === "GET" && urlPath === ROUTE_API + "/sessions") {
        const channelId = params.get("channelId") || "";
        const rows      = channelId ? await listSessions(pool, channelId) : [];
        sendJson(res, 200, { sessions: rows });
        wo.jump = true; wo.jumpReason = "api_handled"; return coreData;
      }

      if (method === "GET" && urlPath.startsWith(ROUTE_API + "/session/")) {
        const sessionId = Number(urlPath.split("/").pop());
        if (!sessionId) { sendJson(res, 400, { error: "invalid_id" }); wo.jump = true; return coreData; }
        const chunks = await listChunksForSession(pool, sessionId);
        sendJson(res, 200, { chunks });
        wo.jump = true; wo.jumpReason = "api_handled"; return coreData;
      }

      if (method === "DELETE" && urlPath.startsWith(ROUTE_API + "/session/")) {
        const sessionId = Number(urlPath.split("/").pop());
        if (!sessionId) { sendJson(res, 400, { error: "invalid_id" }); wo.jump = true; return coreData; }
        await deleteSession(pool, sessionId);
        sendJson(res, 200, { ok: true });
        wo.jump = true; wo.jumpReason = "api_handled"; return coreData;
      }

      if (method === "POST" && urlPath === ROUTE_API + "/assign") {
        const body      = wo.http?.json || {};
        const chunkId   = Number(body.chunkId);
        const chunkLabel = String(body.chunkLabel || "").trim();
        const speakerId  = body.speakerId != null ? Number(body.speakerId) : null;
        if (!chunkId || !chunkLabel) { sendJson(res, 400, { error: "missing_fields" }); wo.jump = true; return coreData; }
        await upsertChunkSpeaker(pool, { chunkId, chunkLabel, speakerId });
        sendJson(res, 200, { ok: true });
        wo.jump = true; wo.jumpReason = "api_handled"; return coreData;
      }

      const applyMatch = urlPath.match(/^\/voice\/api\/session\/(\d+)\/apply$/);
      if (method === "POST" && applyMatch) {
        const sessionId = Number(applyMatch[1]);
        if (!sessionId) { sendJson(res, 400, { error: "invalid_id" }); wo.jump = true; return coreData; }

        const sess = await getSession(pool, sessionId);
        if (!sess) { sendJson(res, 404, { error: "session_not_found" }); wo.jump = true; return coreData; }

        const chunks = await listChunksForSession(pool, sessionId);

        const prevChannelId = wo.channelID;
        wo.channelID = sess.channel_id;

        if (Array.isArray(cfg.clearContextChannels) && cfg.clearContextChannels.includes(sess.channel_id)) await setPurgeContext(wo);

        let words = 0;
        for (const chunk of chunks) {
          const nameMap = {};
          for (const m of (chunk.speakers || [])) {
            if (m.speaker_name) nameMap[m.chunk_label] = m.speaker_name;
          }
          for (const line of (chunk.transcript || "").split("\n")) {
            const colon = line.indexOf(":");
            if (colon < 1) continue;
            const speakerName = nameMap[line.slice(0, colon).trim()] || line.slice(0, colon).trim();
            const speakerText = line.slice(colon + 1).trim();
            if (!speakerText) continue;
            words += (speakerText.match(/\S+/g) || []).length;
            await setContext(wo, {
              role:       "user",
              text:       speakerText,
              content:    speakerText,
              userId:     speakerName,
              authorName: speakerName,
              source:     "voice-transcribe"
            });
          }
        }

        wo.channelID = prevChannelId;

        await deleteSession(pool, sessionId);

        sendJson(res, 200, { ok: true, words });
        wo.jump = true; wo.jumpReason = "api_handled"; return coreData;
      }

      if (method === "POST" && urlPath === ROUTE_API + "/speakers/new-and-assign") {
        const body       = wo.http?.json || {};
        const name       = String(body.name       || "").trim();
        const channelId  = String(body.channelId  || "").trim();
        const chunkId    = Number(body.chunkId);
        const chunkLabel = String(body.chunkLabel || "").trim();
        if (!name || !channelId || !chunkId || !chunkLabel) {
          sendJson(res, 400, { error: "missing_fields" }); wo.jump = true; return coreData;
        }
        const speakerId = await createSpeaker(pool, { channelId, name });
        await upsertChunkSpeaker(pool, { chunkId, chunkLabel, speakerId });
        sendJson(res, 200, { speakerId, name });
        wo.jump = true; wo.jumpReason = "api_handled"; return coreData;
      }

    } catch (e) {
      log("API error", "error", { moduleName: MODULE_NAME, error: e?.message });
      sendJson(res, 500, { error: "internal_error" });
      wo.jump = true; wo.jumpReason = "api_error";
    }
    return coreData;
  }

  return coreData;
}
