/********************************************************************************
/* filename: "getYoutube.js"                                                     *
/* Version 1.0                                                                   *
/* Purpose: Fetch YouTube transcripts, then dump or summarize; optional search.  *
/********************************************************************************/
/********************************************************************************
/*                                                                              *
/********************************************************************************/

const MODULE_NAME = "getYoutube";
let YT_LIB = null;

/********************************************************************************
/* functionSignature: getYoutubeLib ()                                           *
/* Lazy-loads youtube-transcript-plus and caches the module reference.          *
/********************************************************************************/
async function getYoutubeLib() {
  if (YT_LIB) return YT_LIB;
  try {
    const m = await import("youtube-transcript-plus");
    YT_LIB = m.YoutubeTranscript || m.default?.YoutubeTranscript || m.default;
  } catch (err) {
    YT_LIB = null;
  }
  return YT_LIB;
}

/********************************************************************************
/* functionSignature: getStr (v, f)                                             *
/* Returns v if it is a non-empty string, otherwise f.                          *
/********************************************************************************/
function getStr(v, f = "") { return typeof v === "string" && v.length ? v : f; }

/********************************************************************************
/* functionSignature: getNum (v, f)                                             *
/* Returns a finite number or the fallback value f.                             *
/********************************************************************************/
function getNum(v, f = 0) { return Number.isFinite(v) ? Number(v) : f; }

/********************************************************************************
/* functionSignature: getClamp (n, min, max)                                    *
/* Clamps a number n between min and max.                                       *
/********************************************************************************/
function getClamp(n, min, max) { const x = Number.isFinite(n) ? n : min; return Math.max(min, Math.min(max, x)); }

/********************************************************************************
/* functionSignature: getToSeconds (offset)                                     *
/* Normalizes millisecond or second offsets to whole seconds.                   *
/********************************************************************************/
function getToSeconds(offset) { const n = Number(offset || 0); return n > 10000 ? Math.round(n / 1000) : Math.round(n); }

/********************************************************************************
/* functionSignature: getFmtTime (s)                                            *
/* Formats seconds as H:MM:SS or M:SS.                                          *
/********************************************************************************/
function getFmtTime(s) { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60; const pad = (x) => String(x).padStart(2, "0"); return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`; }

/********************************************************************************
/* functionSignature: getExtractVideoId (input)                                 *
/* Extracts an 11-char YouTube video ID from various URL forms.                 *
/********************************************************************************/
function getExtractVideoId(input) {
  if (!input) return null;
  const plain = String(input).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(plain)) return plain;
  try {
    const u = new URL(plain);
    if (u.hostname === "youtu.be") return u.pathname.slice(1);
    if (u.pathname.startsWith("/watch")) return u.searchParams.get("v");
    if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || null;
    if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || null;
    return u.searchParams.get("v");
  } catch { return null; }
}

/********************************************************************************
/* functionSignature: getFetchJsonWithTimeout (url, ms)                         *
/* Fetches a URL and returns parsed JSON, aborting after ms milliseconds.       *
/********************************************************************************/
async function getFetchJsonWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1, ms || 15000));
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    return { ok: true, res, data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

/********************************************************************************
/* functionSignature: getFetchTranscript (videoId, langsWanted)                 *
/* Retrieves a transcript in preferred languages with normalized entries.       *
/********************************************************************************/
async function getFetchTranscript(videoId, langsWanted = []) {
  const yt = await getYoutubeLib();
  if (!yt) return { ok: false, error: "YTLIB_MISSING — install youtube-transcript-plus", items: [] };
  const fallbackLangs = ["de", "a.de", "de-DE", "en", "a.en", "en-US", "en-GB"];
  const tryLangs = Array.isArray(langsWanted) && langsWanted.length ? [...langsWanted, ...fallbackLangs] : fallbackLangs;
  for (const lang of tryLangs) {
    try {
      const items = await yt.fetchTranscript(videoId, { lang });
      if (Array.isArray(items) && items.length) {
        const norm = items.map((it) => ({ start: getToSeconds(it.offset ?? it.start ?? 0), text: String(it.text || "").trim() })).filter((x) => x.text);
        return { ok: true, items: norm, lang };
      }
    } catch {}
  }
  try {
    const items = await yt.fetchTranscript(videoId);
    if (Array.isArray(items) && items.length) {
      const norm = items.map((it) => ({ start: getToSeconds(it.offset ?? it.start ?? 0), text: String(it.text || "").trim() })).filter((x) => x.text);
      return { ok: true, items: norm };
    }
  } catch {}
  return { ok: false, error: "YT_NO_TRANSCRIPT", items: [] };
}

/********************************************************************************
/* functionSignature: getFetchVideoMeta (googleApiKey, videoId, region)         *
/* Retrieves basic video metadata via YouTube Data API v3.                      *
/********************************************************************************/
async function getFetchVideoMeta(googleApiKey, videoId, region = "DE") {
  if (!googleApiKey) return { ok: false, error: "YT_NO_API_KEY", meta: null };
  const params = new URLSearchParams({ key: googleApiKey, id: videoId, part: "snippet" });
  const url = `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;
  const r = await getFetchJsonWithTimeout(url, 15000);
  const item = r?.data?.items?.[0];
  if (!item?.snippet) return { ok: false, error: "YT_META_NOT_FOUND", meta: null };
  const sn = item.snippet;
  return { ok: true, meta: { video_id: videoId, title: sn.title || "", channel_title: sn.channelTitle || "", channel_id: sn.channelId || "", published_at: sn.publishedAt || "", region } };
}

/********************************************************************************
/* functionSignature: getSearchVideos (opts)                                    *
/* Executes a YouTube search and returns normalized results.                    *
/********************************************************************************/
async function getSearchVideos({ googleApiKey, query, maxResults, relevanceLanguage, regionCode, safeSearch }) {
  if (!googleApiKey) return { ok: false, error: "YT_NO_API_KEY" };
  const params = new URLSearchParams({
    key: googleApiKey,
    part: "snippet",
    type: "video",
    q: query,
    maxResults: String(getClamp(maxResults, 1, 10)),
    relevanceLanguage: relevanceLanguage || "de",
    regionCode: regionCode || "DE",
    safeSearch: safeSearch || "none"
  });
  const url = `https://www.googleapis.com/youtube/v3/search?${params.toString()}`;
  const r = await getFetchJsonWithTimeout(url, 15000);
  const items = Array.isArray(r?.data?.items) ? r.data.items : [];
  const results = items.map((it) => {
    const id = it?.id?.videoId || "";
    const sn = it?.snippet || {};
    return { video_id: id, video_url: id ? `https://www.youtube.com/watch?v=${id}` : "", title: sn.title || "", channel_title: sn.channelTitle || "", channel_id: sn.channelId || "", published_at: sn.publishedAt || "", description: (sn.description || "").slice(0, 400) };
  });
  return { ok: true, results };
}

/********************************************************************************
/* functionSignature: getCallOpenAI (opts)                                      *
/* Calls an OpenAI-compatible chat completions endpoint and returns content.     *
/********************************************************************************/
async function getCallOpenAI({ endpoint, apiKey, model, messages, temperature, max_tokens, timeoutMs }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1, timeoutMs || 45000));
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature, max_tokens })
    });
    const data = await res.json().catch(() => ({}));
    const content = data?.choices?.[0]?.message?.content || "";
    return { ok: true, text: content, raw: data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(t);
  }
}

/********************************************************************************
/* functionSignature: getInvoke (args, coreData)                                *
/* Main entry: transcript dump/summary/QA or YouTube search based on mode.      *
/********************************************************************************/
async function getInvoke(args, coreData) {
  const started = Date.now();
  const wo = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.getYoutube || {};
  const googleApiKey = getStr(cfg.googleApiKey, "");
  const transcriptLangs = Array.isArray(cfg.transcriptLangs) ? cfg.transcriptLangs : [];
  const dumpThresholdChars = getNum(cfg.dump_threshold_chars, 24000);
  const endpoint = getStr(cfg.endpoint, wo?.Endpoint || "https://api.openai.com/v1/chat/completions");
  const apiKey = getStr(cfg.apiKey, wo?.APIKey || wo?.apiKey || process.env.OPENAI_API_KEY || "");
  const model = getStr(cfg.model, wo?.Model || "gpt-4o-mini");
  const temperature = getNum(cfg.temperature, 0.2);
  const max_tokens = getNum(cfg.max_tokens, 1400);
  const aiTimeoutMs = getNum(cfg.aiTimeoutMs, 45000);
  const regionCode = getStr(cfg.regionCode, "DE");
  const relevanceLanguage = getStr(cfg.relevanceLanguage, "de");
  const searchMaxResults = getNum(cfg.searchMaxResults, 5);
  const obj = args?.json || args || {};
  const mode = getStr(obj.mode, "transcript");
  const userPrompt = getStr(obj.user_prompt, "");
  const videoRaw = getStr(obj.video_url, obj.url || obj.videoId || obj.video_id || "");
  const videoId = mode === "transcript" ? getExtractVideoId(videoRaw) : null;
  const wantMetaOnly = obj.metaOnly === true;
  if (mode === "search") {
    const q = getStr(obj.query, userPrompt);
    if (!q) return { ok: false, error: "YT_SEARCH_NO_QUERY", took_ms: Date.now() - started };
    const res = await getSearchVideos({ googleApiKey, query: q, maxResults: obj.max_results ?? searchMaxResults, relevanceLanguage, regionCode, safeSearch: obj.safe_search || "none" });
    return { ok: !!res.ok, mode: "search", query: q, results: res.results || [], error: res.error, took_ms: Date.now() - started };
  }
  if (!videoId) return { ok: false, error: "YT_BAD_ID — provide video_url or 11-char ID", took_ms: Date.now() - started };
  const [tRes, mRes] = await Promise.all([getFetchTranscript(videoId, transcriptLangs), getFetchVideoMeta(googleApiKey, videoId, regionCode)]);
  if (!tRes.ok || !tRes.items.length) {
    return { ok: false, error: tRes.error || "YT_NO_TRANSCRIPT", video_id: videoId, video_url: `https://www.youtube.com/watch?v=${videoId}`, meta: mRes?.meta || null, took_ms: Date.now() - started };
  }
  let linear = "";
  for (const entry of tRes.items) { linear += `[${getFmtTime(entry.start)}] ${entry.text}\n`; if (linear.length > 250000) break; }
  const meta = mRes?.meta ? mRes.meta : (googleApiKey ? null : { warning: "No googleApiKey configured – metadata omitted." });
  if (wantMetaOnly) {
    return { ok: true, mode: "meta", video_id: videoId, video_url: `https://www.youtube.com/watch?v=${videoId}`, meta, took_ms: Date.now() - started };
  }
  const isBelowThreshold = linear.length <= dumpThresholdChars;
  const hasUserPrompt = !!userPrompt;
  if (isBelowThreshold && !hasUserPrompt) {
    return { ok: true, mode: "dump", video_id: videoId, video_url: `https://www.youtube.com/watch?v=${videoId}`, meta, lang: tRes.lang || null, text: linear, chars: linear.length, took_ms: Date.now() - started };
  }
  if (!apiKey) {
    return { ok: true, mode: "dump", warning: "NO_API_KEY_FOR_SUMMARY — returning raw transcript", video_id: videoId, video_url: `https://www.youtube.com/watch?v=${videoId}`, meta, text: linear.slice(0, dumpThresholdChars), truncated: linear.length > dumpThresholdChars, took_ms: Date.now() - started };
  }
  const systemMsg = ["You are a YouTube transcript analyst.", "You get a transcript with timestamps.", "If the user asked a specific question, answer it using ONLY the transcript.", "If the user did not ask a question, write a structured summary with sections and keep timestamps where they help.", "Do NOT invent content that is not in the transcript.", "Language: keep the language of the user prompt, otherwise use English."].join(" ");
  const messages = [{ role: "system", content: systemMsg }, ...(hasUserPrompt ? [{ role: "user", content: `User request:\n${userPrompt}` }] : []), { role: "user", content: `Transcript (truncated to ${dumpThresholdChars} chars if long):\n\n${linear.slice(0, 180000)}` }];
  const aiRes = await getCallOpenAI({ endpoint, apiKey, model, messages, temperature, max_tokens, timeoutMs: aiTimeoutMs });
  if (!aiRes.ok) {
    return { ok: false, error: aiRes.error || "YT_SUMMARY_FAILED", video_id: videoId, video_url: `https://www.youtube.com/watch?v=${videoId}`, meta, took_ms: Date.now() - started };
  }
  return { ok: true, mode: hasUserPrompt ? "qa" : "summary", video_id: videoId, video_url: `https://www.youtube.com/watch?v=${videoId}`, meta, lang: tRes.lang || null, summary: aiRes.text, raw_chars: linear.length, used_chars: linear.slice(0, 180000).length, took_ms: Date.now() - started };
}

export default {
  name: MODULE_NAME,
  definition: {
    type: "function",
    function: {
      name: MODULE_NAME,
      description: "Fetch and process YouTube videos. If mode='transcript': fetch transcript, dump if short, summarize/QA if long. If mode='search': run YouTube Data API search. All config (API keys, thresholds, languages) is taken from toolsconfig.getYoutube. To attach files, call a different tool – this one only returns structured JSON.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          mode: { type: "string", enum: ["transcript", "search"], description: "transcript = fetch + dump/summary; search = YouTube search via Data API" },
          video_url: { type: "string", description: "Full YouTube URL or 11-char videoId. Needed when mode='transcript'." },
          user_prompt: { type: "string", description: "Optional: if provided, the tool will run a QA over the transcript instead of a generic summary." },
          metaOnly: { type: "boolean", description: "If true, only metadata for the video is returned (requires valid googleApiKey)." },
          query: { type: "string", description: "Search query when mode='search'." },
          max_results: { type: "number", description: "Max search results when mode='search' (1-10)." },
          safe_search: { type: "string", description: "YouTube search safeSearch setting, e.g. 'none' | 'moderate' | 'strict'." }
        }
      }
    }
  },
  invoke: getInvoke
};
