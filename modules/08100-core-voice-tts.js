/**************************************************************/
/* filename: "08100-core-voice-tts.js"                              */
/* Version 1.0                                               */
/* Purpose: Pipeline module implementation.                 */
/**************************************************************/




















import { getPrefixedLogger } from "../core/logging.js";
import { getSecret } from "../core/secrets.js";

const MODULE_NAME = "core-voice-tts";


function getSanitizedTTSText(text) {
  if (!text) return "";
  let s = String(text);
  s = s.replace(/!\[([^\]]*)\]\(\s*https?:\/\/[^\s)]+?\s*\)/gi, (_, alt) => (alt || "").trim());
  s = s.replace(/\[([^\]]+)\]\(\s*https?:\/\/[^\s)]+?\s*\)/gi, (_, alt) => (alt || "").trim());
  s = s.replace(/<\s*https?:\/\/[^>]+>/gi, "");
  s = s.replace(/\bhttps?:\/\/[^\s)>\]}]+/gi, "");
  s = s.replace(/[ \t]{2,}/g, " ");
  s = s.replace(/\s*\n\s*\n\s*\n+/g, "\n\n");
  s = s.replace(/\s+([,.;:!?])/g, "$1");
  s = s.replace(/\(\s*\)/g, "");
  s = s.replace(/\[\s*\]/g, "");
  s = s.replace(/\{\s*\}/g, "");
  return s.trim();
}


function getNormalizedVoiceKey(voiceRaw) {
  let v = voiceRaw ?? "";
  if (typeof v !== "string") v = String(v);
  return v.trim().toLowerCase();
}


function getIsVoiceSessionRefUsable(ref) {
  if (ref == null) return false;
  const s = String(ref).trim().toLowerCase();
  return s !== "" && s !== "null" && s !== "undefined";
}


function getTTSSpeakerSegments(rawText) {
  const src  = typeof rawText === "string" ? rawText : String(rawText ?? "");
  const re   = /\[\s*speaker\s*:\s*([^\]]*?)\s*\]/gi;
  const segs = [];
  let current   = "default";
  let lastIndex = 0;
  let m;

  while ((m = re.exec(src)) !== null) {
    const chunk = src.slice(lastIndex, m.index);
    if (chunk) segs.push({ voice: current, text: chunk });
    const tag = m[1].trim().replace(/^<\s*/,"").replace(/\s*>$/,"").replace(/\s+/g," ").toLowerCase();
    current   = (!tag || tag === "default") ? "default" : tag;
    lastIndex = m.index + m[0].length;
  }
  const tail = src.slice(lastIndex);
  if (tail) segs.push({ voice: current, text: tail });

  const out = [];
  for (const seg of segs) {
    const t     = getSanitizedTTSText(seg.text);
    if (!t) continue;
    const voice = getNormalizedVoiceKey(seg.voice) || "default";
    if (out.length && out[out.length - 1].voice === voice) {
      out[out.length - 1].text += `\n\n${t}`;
    } else {
      out.push({ voice, text: t });
    }
  }
  return out;
}


async function getTTSBuffer(text, voice, { model, endpoint, apiKey, format, fetchTimeoutMs }) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), fetchTimeoutMs);
  let resp;
  try {
    resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, voice, input: text, response_format: format }),
      signal: controller.signal
    });
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e?.name === "AbortError" || String(e?.message || "").includes("aborted");
    throw new Error(isAbort
      ? `TTS fetch timeout after ${fetchTimeoutMs}ms (voice=${voice})`
      : `TTS network error: ${e?.message}`);
  }
  clearTimeout(timer);
  if (!resp.ok) throw new Error(`TTS API HTTP ${resp.status} (voice=${voice})`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf?.length) throw new Error("Empty TTS audio buffer");
  return buf;
}


export default async function getCoreVoiceTTS(coreData) {
  const wo  = coreData?.workingObject || {};
  const log = getPrefixedLogger(wo, import.meta.url);

  if (wo.deactivateSpeech) return coreData;
  if (wo.stop) return coreData;

  const raw = typeof wo.response === "string" ? wo.response.trim() : "";
  if (!raw) return coreData;

  if (!getIsVoiceSessionRefUsable(wo.voiceSessionRef) && wo.synthesizeSpeech !== true) {
    return coreData;
  }

  const cfg = coreData?.config?.[MODULE_NAME] || {};

  const segments = getTTSSpeakerSegments(raw);
  if (!segments.length) {
    log("No speakable content after sanitizing", "info", { moduleName: MODULE_NAME });
    return coreData;
  }

  const model           = (wo.ttsModel    || cfg.ttsModel    || "gpt-4o-mini-tts").trim();
  const defaultVoiceRaw = (wo.ttsVoice    || cfg.ttsVoice    || "alloy").trim();
  const endpoint        = (wo.ttsEndpoint || cfg.ttsEndpoint || "https://api.openai.com/v1/audio/speech").trim();
  const apiKey          = await getSecret(wo, (wo.ttsApiKey   || cfg.ttsApiKey   || process.env.OPENAI_API_KEY || "").trim());
  const format          = (wo.ttsFormat   || cfg.ttsFormat   || "opus").trim();
  const fetchTimeoutMs  = Number(wo.TTSFetchTimeoutMs  || cfg.TTSFetchTimeoutMs  || 30000);

  const defaultVoice = getNormalizedVoiceKey(defaultVoiceRaw) || "alloy";

  if (!apiKey) {
    log("Missing TTS API key", "error", { moduleName: MODULE_NAME });
    wo.ttsSkipped = "no_api_key";
    return coreData;
  }

  const renderItems = segments.map((seg, i) => ({
    index: i,
    text:  seg.text,
    voice: (!seg.voice || seg.voice === "default") ? defaultVoice : (getNormalizedVoiceKey(seg.voice) || defaultVoice)
  }));

  const concurrency = renderItems.length <= 1 ? 1 : Math.min(2, renderItems.length);
  const results     = new Array(renderItems.length);
  let   nextIdx     = 0;

  const worker = async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= renderItems.length) return;
      const it  = renderItems[i];
      const buf = await getTTSBuffer(it.text, it.voice, { model, endpoint, apiKey, format, fetchTimeoutMs });
      results[i] = { voice: it.voice, text: it.text, buffer: buf };
    }
  };

  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } catch (e) {
    log("TTS render failed", "error", { moduleName: MODULE_NAME, error: e?.message });
    wo.ttsSkipped = "render_error";
    return coreData;
  }

  wo.ttsSegments    = results;
  wo.ttsDefaultVoice = defaultVoice;

  log("TTS rendered", "info", {
    moduleName: MODULE_NAME,
    segments:   results.length,
    format,
    model,
    bytesTotal: results.reduce((a, s) => a + (s?.buffer?.length || 0), 0)
  });

  return coreData;
}
