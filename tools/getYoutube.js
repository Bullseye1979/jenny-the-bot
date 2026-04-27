/**************************************************************/
/* filename: "getYoutube.js"                                        */
/* Version 1.0                                               */
/* Purpose: LLM-callable tool implementation.               */
/**************************************************************/


import { getSecret } from "../core/secrets.js";
import { fetchWithTimeout } from "../core/fetch.js";
import { getPrefixedLogger } from "../core/logging.js";
import { getStr, getNum } from "../core/utils.js";

const MODULE_NAME = "getYoutube";
let YT_LIB = null;


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


function getClamp(n, min, max) { const x = Number.isFinite(n) ? n : min; return Math.max(min, Math.min(max, x)); }


function getToSeconds(offset) { const n = Number(offset || 0); return n > 10000 ? Math.round(n / 1000) : Math.round(n); }


function getFmtTime(s) { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60; const pad = (x) => String(x).padStart(2, "0"); return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`; }


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


async function getFetchJsonWithTimeout(url, ms) {
  try {
    const res = await fetchWithTimeout(url, { method: "GET" }, Math.max(1, ms || 15000));
    const data = await res.json().catch(() => ({}));
    return { ok: true, res, data };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}


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


async function getFetchVideoMeta(googleApiKey, videoId, region = "DE") {
  if (!googleApiKey) return { ok: false, error: "YT_NO_API_KEY", meta: null };
  const params = new URLSearchParams({ key: googleApiKey, id: videoId, part: "snippet" });
  const url = `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;
  const r = await getFetchJsonWithTimeout(url, 15000);
  const item = r?.data?.items?.[0];
  if (!item?.snippet) return { ok: false, error: "YT_META_NOT_FOUND", meta: null };
  const sn = item.snippet;
  return { ok: true, meta: { video_id: videoId, title: sn.title || "", channel_title: sn.channelTitle || "", channelId: sn.channelId || "", published_at: sn.publishedAt || "", region } };
}


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
  if (!r.ok) return { ok: false, error: r.error || "YT_SEARCH_FETCH_FAILED" };
  if (r?.data?.error) {
    const apiErr = r.data.error;
    const msg = apiErr?.message || JSON.stringify(apiErr);
    const code = apiErr?.code ? `[${apiErr.code}] ` : "";
    return { ok: false, error: `YT_API_ERROR: ${code}${msg}` };
  }
  const items = Array.isArray(r?.data?.items) ? r.data.items : [];
  const results = items.map((it) => {
    const id = it?.id?.videoId || "";
    const sn = it?.snippet || {};
    return { video_id: id, video_url: id ? `https://www.youtube.com/watch?v=${id}` : "", title: sn.title || "", channel_title: sn.channelTitle || "", channelId: sn.channelId || "", published_at: sn.publishedAt || "", description: (sn.description || "").slice(0, 400) };
  });
  return { ok: true, results };
}


async function getInvoke(args, coreData) {
  const log = getPrefixedLogger(coreData?.workingObject, import.meta.url);
  const started = Date.now();
  const wo = coreData?.workingObject || {};
  const cfg = wo?.toolsconfig?.getYoutube || {};
  const googleApiKey = await getSecret(wo, getStr(cfg.googleApiKey, ""));
  const transcriptLangs = Array.isArray(cfg.transcriptLangs) ? cfg.transcriptLangs : [];
  const dumpThresholdChars = getNum(cfg.dumpThresholdChars, 24000);
  const regionCode = getStr(cfg.regionCode, "DE");
  const relevanceLanguage = getStr(cfg.relevanceLanguage, "de");
  const searchMaxResults = getNum(cfg.searchMaxResults, 5);
  const obj = args?.json || args || {};
  const mode = getStr(obj.mode, "transcript");
  const userPrompt = getStr(obj.userPrompt, getStr(obj.user_prompt, ""));
  const videoRaw = getStr(obj.videoUrl, getStr(obj.video_url, obj.url || obj.videoId || obj.video_id || ""));
  const videoId = mode === "transcript" ? getExtractVideoId(videoRaw) : null;
  const wantMetaOnly = obj.metaOnly === true;
  if (mode === "search") {
    const q = getStr(obj.query, userPrompt);
    if (!q) return { ok: false, error: "YT_SEARCH_NO_QUERY", took_ms: Date.now() - started };
    const res = await getSearchVideos({ googleApiKey, query: q, maxResults: obj.maxResults ?? obj.max_results ?? searchMaxResults, relevanceLanguage, regionCode, safeSearch: obj.safeSearch || obj.safe_search || "none" });
    const rows = res.results || [];
    return { ok: !!res.ok, count: rows.length, has_more: false, next_start_ctx_id: null, rows, mode: "search", query: q, ...(res.error && { error: res.error }), took_ms: Date.now() - started };
  }
  if (!videoId) return { ok: false, error: "YT_BAD_ID — provide videoUrl or 11-char ID", took_ms: Date.now() - started };
  const [tRes, mRes] = await Promise.all([getFetchTranscript(videoId, transcriptLangs), getFetchVideoMeta(googleApiKey, videoId, regionCode)]);
  const meta = mRes?.meta ? mRes.meta : (googleApiKey ? null : { warning: "No googleApiKey configured – metadata omitted." });
  if (!tRes.ok || !tRes.items.length) {
    return { ok: false, error: tRes.error || "YT_NO_TRANSCRIPT", video_id: videoId, video_url: `https://www.youtube.com/watch?v=${videoId}`, meta, took_ms: Date.now() - started };
  }
  if (wantMetaOnly) {
    return { ok: true, count: 0, has_more: false, next_start_ctx_id: null, rows: [], mode: "meta", video_id: videoId, video_url: `https://www.youtube.com/watch?v=${videoId}`, meta, took_ms: Date.now() - started };
  }
  const maxItems    = getClamp(getNum(cfg.maxItems, 200), 10, 5000);
  const startOffset = Math.max(0, getNum(obj.start_ctx_id, 0));
  const pageItems   = tRes.items.slice(startOffset, startOffset + maxItems);
  const hasMore     = (startOffset + maxItems) < tRes.items.length;
  return {
    ok:               true,
    count:            pageItems.length,
    has_more:         hasMore,
    next_start_ctx_id: hasMore ? startOffset + maxItems : null,
    rows:             pageItems,
    mode:             "transcript",
    video_id:         videoId,
    video_url:        `https://www.youtube.com/watch?v=${videoId}`,
    meta,
    lang:             tRes.lang || null,
    total_items:      tRes.items.length,
    took_ms:          Date.now() - started,
  };
}

export default {
  name: MODULE_NAME,
  invoke: getInvoke
};
